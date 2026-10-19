"""AI Engine (UC-05): prompt engineering over an OpenAI-compatible Chat Completions API,
with a deterministic fallback template based on numeric data only (UC-05 E4a)."""
import json
import logging
import re
import time
from dataclasses import dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session, object_session

from ..models import (
    AIReport,
    BlindSpotLevel,
    DeltaMetric,
    Intervention,
    LearningResource,
    Milestone,
    Role,
    User,
    utcnow,
)
from . import audit, nlp
from .analytics import StudentSnapshot, classify, overall_level, snapshot
from .locale import current_lang
from .settings_store import AIConfig, ai_config, scoring

logger = logging.getLogger("eduskills.ai")

SYSTEM_PROMPT = """You are EduSkills AI, a professional soft-skills development coach for undergraduate students
working on team projects. You write evidence-based developmental feedback grounded in the Johari Window model.

Strict rules:
- Use ONLY the data provided (scores, deltas, anonymized peer comments, instructor notes). Never invent facts,
  names, events or numbers. If the evidence is thin, say so.
- Never reveal or guess the identity of any peer reviewer.
- Be supportive, specific and professional. Address the student directly as "you".
- A "blind spot" means the student rates themselves notably HIGHER than others do; a "hidden strength" means
  others rate them notably HIGHER than they rate themselves.
- Respond with a single JSON object, no markdown, matching exactly this schema:
{"headline": str, "narrative": [str, str, str], "strengths": [str], "focus_skill": str,
 "actionable_steps": [str, str, str], "johari_insight": str, "video_search_query": str}
- "narrative" has 2-4 short paragraphs. "actionable_steps" are concrete behaviors for the next evaluation period.
- "video_search_query" is a short English YouTube search phrase (4-8 words) that finds a practical tutorial
  for the student's focus area, e.g. "how to delegate tasks as a team leader"."""


ARABIC_INSTRUCTION = """
- Write every text value (headline, narrative, strengths, focus_skill, actionable_steps, johari_insight) in clear
  Modern Standard Arabic for a Saudi university student. Quote peer comments exactly as written. Begin every paragraph with an Arabic word (not a Latin name).
  Keep "video_search_query" in English."""


@dataclass
class GeneratedReport:
    headline: str
    narrative: list[str]
    strengths: list[str]
    focus_skill: str
    actionable_steps: list[str]
    johari_insight: str
    source: str
    model: str | None
    video_query: str = ""


# ------------------------------------------------------------------ prompt --


def build_prompt(student_name: str, milestone: Milestone, snap: StudentSnapshot, themes: dict) -> str:
    rows = []
    for s in snap.skills:
        rows.append(
            f"- {s.name}: self={s.self_score}, peer_avg={s.peer_avg}, instructor={s.instructor_score}, "
            f"external_weighted={s.external}, delta={s.gap}, level={s.level}, direction={s.direction}"
        )
    comments = "\n".join(f'- "{c}"' for c in snap.peer_comments[:25]) or "- (no qualitative peer comments)"
    theme_lines = []
    for code, t in themes.get("themes", {}).items():
        theme_lines.append(f"- {code}: {t['mentions']} mentions, {len(t['positive'])} positive, {len(t['negative'])} negative")
    first = student_name.split()[0] if student_name else "the student"
    return f"""Student first name: {first}
Project milestone: M{milestone.number} - {milestone.name}

Quantitative metrics per soft skill (1-5 Likert scale, external = 60% instructor + 40% peer average):
{chr(10).join(rows)}

Overall: self={snap.overall_self}, external={snap.overall_external}

NLP pipeline output (behavioral themes from peer comments, overall sentiment {themes.get('overall_sentiment')}):
{chr(10).join(theme_lines) or '- none'}

Anonymized peer comments:
{comments}

Instructor supervisory notes:
{snap.instructor_notes or '(none)'}

Student's own evidence / reflection:
{snap.self_evidence or '(none)'}

Write the developmental report JSON now. Focus on the skill with the largest delta."""


# -------------------------------------------------------------- API calls --


GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
_resolved_models: dict[str, str] = {}  # configured model -> model actually available for the key


def _is_gemini(cfg: AIConfig) -> bool:
    return "generativelanguage.googleapis.com" in cfg.base_url


def _provider_error(resp: httpx.Response) -> str:
    try:
        return resp.json().get("error", {}).get("message") or resp.text[:300]
    except ValueError:
        return resp.text[:300]


_model_lists: dict[str, list[str]] = {}  # api key -> ranked models available to it
BUSY_CODES = {429, 500, 503, 504}  # overloaded / rate limited: worth retrying or switching model


def _gemini_models(cfg: AIConfig) -> list[str]:
    """Models this key can use for text generation, best general-purpose ones first (cached)."""
    if cfg.api_key in _model_lists:
        return _model_lists[cfg.api_key]
    resp = httpx.get(f"{GEMINI_BASE}/models", params={"pageSize": 200}, headers={"x-goog-api-key": cfg.api_key}, timeout=cfg.timeout)
    if resp.status_code != 200:
        raise RuntimeError(f"Gemini API error {resp.status_code}: {_provider_error(resp)}")
    names = [
        m["name"].removeprefix("models/")
        for m in resp.json().get("models", [])
        if "generateContent" in m.get("supportedGenerationMethods", [])
    ]
    bad = ("image", "tts", "live", "audio", "embedding", "vision", "learnlm", "gemma", "thinking", "exp", "preview")

    def version(name: str) -> float:
        m = re.search(r"gemini-(\d+(?:\.\d+)?)", name)
        return float(m.group(1)) if m else 0.0

    ranked: list[str] = []
    for pattern in (r"^gemini-[\d.]+-flash$", r"^gemini-[\d.]+-flash-lite$", r"^gemini-[\d.]+-pro$", r"^gemini-[\d.]+-flash", r"^gemini"):
        group = sorted((n for n in names if re.search(pattern, n) and not any(b in n for b in bad) and n not in ranked), key=version, reverse=True)
        ranked += group
    _model_lists[cfg.api_key] = ranked or names
    return _model_lists[cfg.api_key]


def _pick_gemini_model(cfg: AIConfig) -> str | None:
    models = _gemini_models(cfg)
    return models[0] if models else None


def _gemini(cfg: AIConfig, messages: list[dict], json_mode: bool, max_tokens: int) -> str:
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    contents = [
        {"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
        for m in messages
        if m["role"] != "system"
    ]
    # Gemini 2.5+ models spend part of the output budget on thinking, so keep the limit generous.
    config: dict = {"temperature": 0.4, "maxOutputTokens": max(max_tokens, 1024)}
    if json_mode:
        config["responseMimeType"] = "application/json"
    body: dict = {"contents": contents, "generationConfig": config}
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}

    model = _resolved_models.get(cfg.model, cfg.model).removeprefix("models/")
    tried: list[str] = []
    last_error = ""
    for attempt in range(4):  # first model, one retry, then up to two other models
        resp = httpx.post(
            f"{GEMINI_BASE}/models/{model}:generateContent",
            headers={"x-goog-api-key": cfg.api_key, "Content-Type": "application/json"},
            json=body,
            timeout=cfg.timeout,
        )
        if resp.status_code == 200:
            data = resp.json()
            parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
            text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
            if not text:
                reason = (data.get("candidates") or [{}])[0].get("finishReason") or data.get("promptFeedback", {}).get("blockReason")
                raise RuntimeError(f"Gemini returned an empty answer ({reason or 'no text'})")
            if model != cfg.model:
                _resolved_models[cfg.model] = model  # remember the model that works
            return text
        last_error = f"Gemini API error {resp.status_code}: {_provider_error(resp)}"
        if resp.status_code not in BUSY_CODES | {404}:
            raise RuntimeError(last_error)
        tried.append(model)
        if resp.status_code in BUSY_CODES and attempt == 0:
            time.sleep(1.5)  # short spike in demand: retry the same model once
            continue
        # Not found or still busy: switch to another model available to this key.
        alternatives = [m for m in _gemini_models(cfg) if m not in tried]
        if not alternatives:
            break
        logger.warning("Gemini model %s unavailable (%s), switching to %s", model, resp.status_code, alternatives[0])
        model = alternatives[0]
    raise RuntimeError(last_error or "Gemini model could not be resolved")


def _chat(cfg: AIConfig, messages: list[dict], json_mode: bool = False, max_tokens: int = 900) -> str:
    if _is_gemini(cfg):
        return _gemini(cfg, messages, json_mode, max_tokens)
    payload: dict = {"model": cfg.model, "messages": messages, "temperature": 0.4, "max_tokens": max_tokens}
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    resp = httpx.post(
        f"{cfg.base_url}/chat/completions",
        headers={"Authorization": f"Bearer {cfg.api_key}", "Content-Type": "application/json"},
        json=payload,
        timeout=cfg.timeout,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"AI API error {resp.status_code}: {_provider_error(resp)}")
    return resp.json()["choices"][0]["message"]["content"]


def active_model(cfg: AIConfig) -> str:
    return _resolved_models.get(cfg.model, cfg.model) if _is_gemini(cfg) else cfg.model


def check_connection(cfg: AIConfig) -> tuple[bool, str]:
    """UC-08 step 4: verify AI API connection status."""
    if not cfg.api_key:
        return False, "No API key configured - the local fallback engine is active."
    if not cfg.enabled:
        return False, "AI generation is disabled - the local fallback engine is active."
    try:
        out = _chat(cfg, [{"role": "user", "content": "Reply with the single word: OK"}], max_tokens=16)
        return True, f"Connected to {active_model(cfg)}: {out.strip()[:40]}"
    except Exception as exc:  # noqa: BLE001 - surface any provider error to the admin
        return False, f"Connection failed: {str(exc)[:300]}"


def moderate(db: Session, text: str) -> nlp.FilterResult:
    """Local content filter, optionally confirmed by the LLM for borderline cases."""
    local = nlp.content_filter(text)
    if local.is_toxic:
        return local
    cfg = ai_config(db)
    if not cfg.usable or len(text) < 20:
        return local
    try:
        out = _chat(
            cfg,
            [
                {
                    "role": "system",
                    "content": 'Classify peer feedback written by a university student about a teammate. '
                    'Return JSON {"toxic": bool, "reason": str}. toxic=true only for insults, harassment, '
                    "personal attacks, discriminatory bias or threats. Honest but respectful criticism is NOT toxic.",
                },
                {"role": "user", "content": text},
            ],
            json_mode=True,
            max_tokens=60,
        )
        data = _parse_json(out)
        if data.get("toxic"):
            return nlp.FilterResult(True, str(data.get("reason") or "Flagged by AI content filter")[:200], False)
    except Exception as exc:  # noqa: BLE001 - moderation must never block submission on provider errors
        logger.warning("AI moderation unavailable: %s", exc)
    return local


# ------------------------------------------------------------- fallback --

STEP_LIBRARY = {
    "COMMUNICATION": [
        "Send a short written update to your team after each work session (what you did, what is next, blockers).",
        "Summarize decisions at the end of every meeting and confirm everyone understood them.",
        "Practice active listening: paraphrase a teammate's point before responding.",
    ],
    "LEADERSHIP": [
        "Delegate at least two meaningful tasks in the next sprint and agree on the expected outcome.",
        "Ask teammates for their ideas before proposing your own solution in planning meetings.",
        "Request direct feedback on your coordination style halfway through the next evaluation period.",
    ],
    "ADAPTABILITY": [
        "When requirements change, write down the impact and propose an adjusted plan within 24 hours.",
        "Treat critical feedback as data: thank the reviewer and note one change you will try.",
        "Volunteer for one task outside your comfort zone in the next evaluation period.",
    ],
    "COLLABORATION": [
        "Agree on a visible task board and update your items before every stand-up.",
        "Offer help to one teammate each week and pair on a difficult task.",
        "Make sure workload is shared fairly: review the task split with your team at the start of each milestone.",
    ],
    "PROBLEM_SOLVING": [
        "Before coding or writing, break each problem into steps and list at least two alternative solutions.",
        "Use a short root-cause analysis (5 Whys) when an issue repeats.",
        "Document how you solved one hard issue and share it with your team.",
    ],
}


SKILL_AR = {
    "COMMUNICATION": "التواصل",
    "LEADERSHIP": "القيادة",
    "ADAPTABILITY": "القدرة على التكيف",
    "COLLABORATION": "التعاون",
    "PROBLEM_SOLVING": "حل المشكلات",
}

STEP_LIBRARY_AR = {
    "COMMUNICATION": [
        "أرسل تحديثًا مكتوبًا قصيرًا لفريقك بعد كل جلسة عمل (ما أنجزته، وما التالي، وما الذي يعيقك).",
        "لخّص القرارات في نهاية كل اجتماع وتأكد أن الجميع فهمها.",
        "مارس الإصغاء الفعّال: أعد صياغة فكرة زميلك قبل أن ترد عليها.",
    ],
    "LEADERSHIP": [
        "فوّض مهمتين مهمتين على الأقل في الدورة القادمة واتفق على النتيجة المتوقعة منهما.",
        "اسأل زملاءك عن أفكارهم قبل أن تطرح حلك في اجتماعات التخطيط.",
        "اطلب ملاحظات مباشرة على أسلوبك في التنسيق في منتصف فترة التقييم القادمة.",
    ],
    "ADAPTABILITY": [
        "عندما تتغير المتطلبات، اكتب أثر التغيير واقترح خطة معدّلة خلال 24 ساعة.",
        "تعامل مع النقد كمعلومة مفيدة: اشكر صاحبه ودوّن تغييرًا واحدًا ستجربه.",
        "تطوّع لمهمة واحدة خارج منطقة راحتك في فترة التقييم القادمة.",
    ],
    "COLLABORATION": [
        "اتفقوا على لوحة مهام واضحة للجميع وحدّث مهامك قبل كل اجتماع يومي.",
        "اعرض المساعدة على زميل واحد كل أسبوع واعملا معًا على مهمة صعبة.",
        "تأكد من توزيع العمل بعدل: راجع تقسيم المهام مع فريقك في بداية كل مرحلة.",
    ],
    "PROBLEM_SOLVING": [
        "قبل أن تبدأ البرمجة أو الكتابة، قسّم كل مشكلة إلى خطوات واذكر حلّين بديلين على الأقل.",
        "استخدم تحليل السبب الجذري المختصر (الأسئلة الخمسة: لماذا؟) عندما تتكرر المشكلة.",
        "وثّق طريقة حلك لمشكلة صعبة واحدة وشاركها مع فريقك.",
    ],
}


def _fallback_report_ar(student_name: str, snap: StudentSnapshot, themes: dict) -> GeneratedReport:
    worst = snap.max_gap_skill
    code = worst.code if worst else "COMMUNICATION"
    focus = SKILL_AR.get(code, worst.name if worst else "التواصل")
    first = student_name.split()[0] if student_name else ""
    ext, slf = snap.overall_external or 0, snap.overall_self or 0
    paragraphs = [
        f"مرحبًا {first}، يجمع هذا التقرير بين تقييمك الذاتي والتقييمات المجهولة من {snap.peer_count} من زملائك وتقييم معلمك. "
        f"متوسط تقييمك لنفسك {slf:.1f} من 5، بينما الدرجة الخارجية الموزونة (60% المعلم، 40% الزملاء) {ext:.1f} من 5."
    ]
    if worst and worst.gap is not None and worst.direction == "overestimate":
        paragraphs.append(
            f"أكبر فجوة في الإدراك في مهارة {focus}: قيّمت نفسك {worst.self_score}، بينما قيّمك الآخرون {worst.external:.1f} "
            f"(الفرق {worst.gap:.1f}). وفق نافذة جوهاري هذه نقطة عمياء محتملة، أي سلوك يلاحظه فريقك ومعلمك وقد لا تكون منتبهًا له تمامًا."
        )
    elif worst and worst.gap is not None and worst.direction == "underestimate":
        paragraphs.append(
            f"في مهارة {focus} يقيّمك الآخرون أعلى ({worst.external:.1f}) مما تقيّم نفسك ({worst.self_score}). "
            f"هذه نقطة قوة خفية، ويمكنك الاعتماد عليها بثقة أكبر."
        )
    else:
        paragraphs.append("نظرتك لنفسك متوافقة مع نظرة الآخرين لك في المهارات الخمس.")
    focus_theme = themes.get("themes", {}).get(code, {})
    if focus_theme.get("negative"):
        quote = focus_theme["negative"][0].rstrip(".")
        paragraphs.append(f"من ملاحظات الزملاء المتعلقة بمهارة {focus}: «{quote}».")
    elif snap.peer_comments:
        paragraphs.append(f"كتب أحد زملائك: «{snap.peer_comments[0].rstrip('.')}».")

    strengths = [
        f"{SKILL_AR.get(s.code, s.name)} ({s.external:.1f} من 5 من الآخرين)"
        for s in sorted((s for s in snap.skills if s.external is not None), key=lambda s: -s.external)[:2]
        if s.external >= 3.5
    ]
    johari = (
        f"أكبر تباين (الفرق {worst.gap:.1f}) في مهارة {focus}."
        if worst and worst.gap is not None
        else "لا توجد بيانات كافية لتحليل نافذة جوهاري بعد."
    )
    return GeneratedReport(
        headline=f"مجال التركيز: {focus}",
        narrative=paragraphs,
        strengths=strengths,
        focus_skill=focus,
        actionable_steps=STEP_LIBRARY_AR.get(code, STEP_LIBRARY_AR["COMMUNICATION"]),
        johari_insight=johari,
        source="fallback",
        model=None,
    )


def fallback_report(student_name: str, snap: StudentSnapshot, themes: dict, lang: str = "en") -> GeneratedReport:
    if lang == "ar":
        return _fallback_report_ar(student_name, snap, themes)
    worst = snap.max_gap_skill
    focus = worst.name if worst else "Communication"
    first = student_name.split()[0] if student_name else "Student"
    ext, slf = snap.overall_external or 0, snap.overall_self or 0
    paragraphs = [
        f"{first}, this report combines your self-assessment, the anonymous evaluations of {snap.peer_count} "
        f"teammates and your instructor's evaluation. Your overall self-rating is {slf:.1f}/5 while the weighted "
        f"external score (60% instructor, 40% peers) is {ext:.1f}/5."
    ]
    if worst and worst.gap is not None and worst.direction == "overestimate":
        paragraphs.append(
            f"The largest perception gap is in {worst.name}: you rated yourself {worst.self_score}, but others "
            f"rated you {worst.external:.1f} (delta {worst.gap:.1f}). In Johari Window terms this is a potential "
            f"blind spot - a behavior visible to your team and instructor that you may not be fully aware of."
        )
    elif worst and worst.gap is not None and worst.direction == "underestimate":
        paragraphs.append(
            f"In {worst.name} others rate you higher ({worst.external:.1f}) than you rate yourself "
            f"({worst.self_score}). This is a hidden strength - you can rely on it with more confidence."
        )
    else:
        paragraphs.append("Your self-perception is well aligned with how others see you across all five skills.")
    focus_theme = themes.get("themes", {}).get(worst.code if worst else "", {})
    if focus_theme.get("negative"):
        quote = focus_theme["negative"][0].rstrip(".")
        paragraphs.append(f'Peer comments related to {focus} include observations such as: "{quote}."')
    elif snap.peer_comments:
        paragraphs.append(f'One teammate wrote: "{snap.peer_comments[0].rstrip(".")}."')

    strengths = [
        f"{s.name} ({s.external:.1f}/5 from others)"
        for s in sorted((s for s in snap.skills if s.external is not None), key=lambda s: -s.external)[:2]
        if s.external >= 3.5
    ]
    steps = STEP_LIBRARY.get(worst.code if worst else "COMMUNICATION", STEP_LIBRARY["COMMUNICATION"])
    johari = (
        f"Largest variance (delta {worst.gap:.1f}) found in {worst.name}."
        if worst and worst.gap is not None
        else "Not enough data for a Johari analysis yet."
    )
    return GeneratedReport(
        headline=f"Your focus area: {focus}",
        narrative=paragraphs,
        strengths=strengths,
        focus_skill=focus,
        actionable_steps=steps,
        johari_insight=johari,
        source="fallback",
        model=None,
    )


def _parse_json(raw: str) -> dict:
    """Models (Gemini in particular) sometimes wrap JSON in markdown code fences."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        text = text.rsplit("```", 1)[0]
    return json.loads(text)


def ai_report(cfg: AIConfig, prompt: str, lang: str = "en") -> GeneratedReport:
    system = SYSTEM_PROMPT + (ARABIC_INSTRUCTION if lang == "ar" else "")
    raw = _chat(cfg, [{"role": "system", "content": system}, {"role": "user", "content": prompt}], json_mode=True, max_tokens=2000 if lang == "ar" else 1200)
    data = _parse_json(raw)
    narrative = data.get("narrative") or []
    if isinstance(narrative, str):
        narrative = [p for p in narrative.split("\n") if p.strip()]
    if not narrative:
        raise ValueError("Empty narrative from model")
    return GeneratedReport(
        headline=str(data.get("headline", ""))[:300],
        narrative=[str(p) for p in narrative][:5],
        strengths=[str(s) for s in data.get("strengths", [])][:5],
        focus_skill=str(data.get("focus_skill", "")),
        actionable_steps=[str(s) for s in data.get("actionable_steps", [])][:6],
        johari_insight=str(data.get("johari_insight", "")),
        video_query=str(data.get("video_search_query", ""))[:120],
        source="ai",
        model=active_model(cfg),
    )


# ------------------------------------------------------------ orchestrator --


def recommend_resources(db: Session, snap: StudentSnapshot, limit: int = 4) -> list[dict]:
    """Map skill gaps (and weakest external skills) to the curated learning-resources repository."""
    ranked = sorted(
        (s for s in snap.skills if s.external is not None),
        key=lambda s: (-(s.gap or 0) if s.direction == "overestimate" else 0, s.external),
    )
    out: list[dict] = []
    for skill in ranked[:2]:
        for r in db.scalars(select(LearningResource).where(LearningResource.competency_id == skill.competency_id)).all()[:2]:
            out.append(
                {"title": r.title, "provider": r.provider, "url": r.url, "kind": r.kind, "duration": r.duration, "skill": skill.name}
            )
    out = out[:limit]
    # A video the admin added for the focus skill is always offered (shown as the recommended video).
    if ranked:
        video = db.scalar(
            select(LearningResource).where(LearningResource.competency_id == ranked[0].competency_id, LearningResource.kind == "video")
        )
        if video and all(r["url"] != video.url for r in out):
            out.append({"title": video.title, "provider": video.provider, "url": video.url, "kind": video.kind, "duration": video.duration, "skill": ranked[0].name})
    return out


def generate_report(db: Session, student_id: str, milestone_id: str, force: bool = False) -> AIReport | None:
    """UC-04 + UC-05 pipeline. Returns None when the 360° data is not complete yet."""
    cfg = scoring(db)
    snap = snapshot(db, student_id, milestone_id, cfg)
    if not snap.complete:
        return None
    existing = db.scalar(select(AIReport).where(AIReport.student_id == student_id, AIReport.milestone_id == milestone_id))
    if existing and not force:
        return existing

    student = db.get(User, student_id)
    milestone = db.get(Milestone, milestone_id)
    themes = nlp.analyze_comments(snap.peer_comments)
    prompt = build_prompt(student.full_name, milestone, snap, themes)

    ai_cfg = ai_config(db)
    generated: GeneratedReport | None = None
    if ai_cfg.usable:
        try:
            generated = ai_report(ai_cfg, prompt)
        except Exception as exc:  # noqa: BLE001 - any API failure falls back to the template (UC-05 E4a)
            logger.warning("GenAI API unavailable, applying fallback template: %s", exc)
    if generated is None:
        generated = fallback_report(student.full_name, snap, themes)

    level = overall_level(snap, cfg)
    overall_gap = abs((snap.overall_external or 0) - (snap.overall_self or 0))
    content = {
        "headline": generated.headline,
        "paragraphs": generated.narrative,
        "strengths": generated.strengths,
        "focus_skill": generated.focus_skill,
        "actionable_steps": generated.actionable_steps,
        "johari_insight": generated.johari_insight,
        "video_query": generated.video_query,
        "resources": recommend_resources(db, snap),
        "themes": {k: {"mentions": v["mentions"], "positive": len(v["positive"]), "negative": len(v["negative"])} for k, v in themes["themes"].items()},
        "overall_sentiment": themes["overall_sentiment"],
        "peer_count": snap.peer_count,
    }

    report = existing or AIReport(student_id=student_id, project_id=milestone.project_id, milestone_id=milestone_id)
    report.narrative = "\n\n".join(generated.narrative)
    report.content = content
    report.source = generated.source
    report.model = generated.model
    report.overall_self = snap.overall_self or 0
    report.overall_external = snap.overall_external or 0
    report.overall_gap = round(overall_gap, 2)
    report.overall_level = level.value
    report.generated_at = utcnow()
    if existing:
        report.metrics.clear()
        db.flush()
    else:
        db.add(report)
        db.flush()
    for s in snap.skills:
        report.metrics.append(
            DeltaMetric(
                competency_id=s.competency_id,
                self_score=s.self_score,
                peer_avg=s.peer_avg,
                instructor_score=s.instructor_score,
                external_avg=s.external,
                gap_score=s.gap,
                direction=s.direction,
                level=classify(s.gap, cfg).value,
            )
        )

    audit.notify(
        db,
        student_id,
        "Your AI Growth Report is ready",
        generated.headline,
        kind="report",
        link=f"/student/report?milestone={milestone_id}",
    )
    if content["resources"]:
        audit.notify(
            db,
            student_id,
            "New learning resources recommended",
            ", ".join(r["title"] for r in content["resources"][:3]),
            kind="resource",
            link=f"/student/report?milestone={milestone_id}",
        )

    if level == BlindSpotLevel.CRITICAL_GAP:
        _raise_auto_intervention(db, snap, milestone, student)
    audit.log(db, None, "report.generated", "ai_report", report.id, f"source={generated.source} level={level.value}")
    return report


LOCALIZED_FIELDS = ("headline", "paragraphs", "strengths", "focus_skill", "actionable_steps", "johari_insight")


def _arabic_version(db: Session, rep: AIReport) -> dict | None:
    """Writes the report text in Arabic from the same data (Gemini when connected, otherwise the template)."""
    snap = snapshot(db, rep.student_id, rep.milestone_id, scoring(db))
    if not snap.complete:
        return None
    student = db.get(User, rep.student_id)
    themes = nlp.analyze_comments(snap.peer_comments)
    generated: GeneratedReport | None = None
    ai_cfg = ai_config(db)
    if rep.source == "ai" and ai_cfg.usable:
        try:
            generated = ai_report(ai_cfg, build_prompt(student.full_name, rep.milestone, snap, themes), lang="ar")
        except Exception as exc:  # noqa: BLE001
            logger.warning("Arabic report via GenAI unavailable, using the Arabic template: %s", exc)
    if generated is None:
        generated = fallback_report(student.full_name, snap, themes, lang="ar")
    return {
        "headline": generated.headline,
        "paragraphs": generated.narrative,
        "strengths": generated.strengths,
        "focus_skill": generated.focus_skill,
        "actionable_steps": generated.actionable_steps,
        "johari_insight": generated.johari_insight,
    }


def localized_content(rep: AIReport) -> dict:
    """Report content in the visitor's language. The Arabic text is generated once and stored with the report."""
    content = dict(rep.content or {})
    translations = content.pop("i18n", None) or {}
    if current_lang.get() != "ar":
        return content
    arabic = translations.get("ar")
    if not arabic:
        db = object_session(rep)
        arabic = _arabic_version(db, rep) if db else None
        if not arabic:
            return content
        rep.content = {**content, "i18n": {**translations, "ar": arabic}}
        try:
            db.commit()
        except Exception:  # noqa: BLE001 - serving the text matters more than caching it
            db.rollback()
    return {**content, **{k: arabic[k] for k in LOCALIZED_FIELDS if k in arabic}}


def _raise_auto_intervention(db: Session, snap: StudentSnapshot, milestone: Milestone, student: User):
    """UC-07 step 5: high-priority blind spots trigger an alert for the Student Advisor."""
    open_exists = db.scalar(
        select(Intervention).where(
            Intervention.student_id == student.id,
            Intervention.milestone_id == milestone.id,
            Intervention.status != "resolved",
        )
    )
    if open_exists:
        return
    worst = snap.max_gap_skill
    reason = (
        f"Critical blind spot detected in {worst.name} at M{milestone.number}: "
        f"self {worst.self_score} vs external {worst.external:.1f} (delta {worst.gap:.1f})."
    )
    db.add(Intervention(student_id=student.id, project_id=milestone.project_id, milestone_id=milestone.id, reason=reason))
    audit.notify_role(db, Role.ADVISOR, f"High-priority alert: {student.full_name}", reason, kind="alert", link="/advisor")
    if milestone.project.instructor_id:
        audit.notify(db, milestone.project.instructor_id, f"Critical blind spot: {student.full_name}", reason, kind="alert", link="/instructor")


# ------------------------------------------------------------------ chatbot --

CHAT_SYSTEM = """You are EduSkills Coach, a friendly soft-skills mentor inside a university platform.
Answer the student's question using ONLY their data below and general, well-established soft-skills advice.
Never reveal peer identities. Keep answers under 180 words. Reply in the same language the student uses
(Arabic or English)."""


def chat_reply(db: Session, user: User, history: list[dict], message: str) -> tuple[str, str]:
    """Returns (reply, source)."""
    context = _student_context(db, user)
    cfg = ai_config(db)
    if cfg.usable:
        try:
            msgs = [{"role": "system", "content": CHAT_SYSTEM + "\n\nStudent data:\n" + context}]
            msgs += history[-8:] + [{"role": "user", "content": message}]
            return _chat(cfg, msgs, max_tokens=400).strip(), "ai"
        except Exception as exc:  # noqa: BLE001
            logger.warning("Chat API unavailable: %s", exc)
    return _rule_based_reply(db, user, message), "fallback"


def _latest_report(db: Session, user: User) -> AIReport | None:
    return db.scalar(select(AIReport).where(AIReport.student_id == user.id).order_by(AIReport.generated_at.desc()))


def _student_context(db: Session, user: User) -> str:
    rep = _latest_report(db, user)
    if not rep:
        return f"Name: {user.full_name}. No completed 360-degree report yet."
    lines = [f"Name: {user.full_name}. Latest report: M{rep.milestone.number} ({rep.milestone.name})."]
    for m in rep.metrics:
        lines.append(
            f"{m.competency.skill_name}: self {m.self_score}, external {m.external_avg}, delta {m.gap_score}, {m.level}, {m.direction}"
        )
    lines.append("Report headline: " + rep.content.get("headline", ""))
    lines.append("Actionable steps: " + "; ".join(rep.content.get("actionable_steps", [])))
    return "\n".join(lines)


def _rule_based_reply(db: Session, user: User, message: str) -> str:
    low = message.lower()
    arabic = any("؀" <= ch <= "ۿ" for ch in message)
    rep = _latest_report(db, user)
    if not rep:
        return (
            "لا يوجد تقرير مكتمل بعد. أكمل التقييم الذاتي وانتظر تقييمات زملائك والمدرّس ليتم إنشاء تقريرك."
            if arabic
            else "You don't have a completed 360° report yet. Submit your self-assessment and wait for your peers "
            "and instructor - your AI Growth Report will be generated automatically."
        )
    worst = max(rep.metrics, key=lambda m: m.gap_score or 0)
    best = max(rep.metrics, key=lambda m: m.external_avg or 0)
    steps = rep.content.get("actionable_steps", [])
    res = rep.content.get("resources", [])

    if any(k in low for k in ("resource", "course", "learn", "مصادر", "دورة", "تعلم")):
        items = "\n".join(f"• {r['title']} ({r['provider']})" for r in res) or "-"
        return ("هذه مصادر مقترحة لك:\n" if arabic else "Here are resources matched to your gaps:\n") + items
    if any(k in low for k in ("how", "calculat", "formula", "delta", "كيف", "حساب", "المعادلة")):
        return (
            "الدرجة الخارجية = 60% تقييم المدرّس + 40% متوسط تقييم الزملاء. الفجوة Δ = |الخارجية − الذاتية|. "
            "إذا Δ ≤ 1.5 فأنت متوافق، بين 1.5 و2.0 فجوة متوسطة، وأكثر من 2.0 نقطة عمياء حرجة."
            if arabic
            else "External score = 60% instructor + 40% peer average. Delta = |external − self|. "
            "Delta ≤ 1.5 is aligned, 1.5–2.0 is a moderate gap and above 2.0 is a critical blind spot."
        )
    if any(k in low for k in ("strength", "good at", "best", "قوة", "أفضل")):
        return (
            f"أقوى مهارة لديك حسب تقييم الآخرين هي {best.competency.skill_name} ({best.external_avg:.1f}/5)."
            if arabic
            else f"According to others, your strongest skill is {best.competency.skill_name} ({best.external_avg:.1f}/5)."
        )
    tips = "\n".join(f"• {s}" for s in steps[:3])
    if arabic:
        return (
            f"أكبر فجوة لديك في مهارة {worst.competency.skill_name}: قيّمت نفسك {worst.self_score} "
            f"بينما التقييم الخارجي {worst.external_avg:.1f} (Δ={worst.gap_score:.1f}).\nخطوات مقترحة:\n{tips}"
        )
    return (
        f"Your largest perception gap is in {worst.competency.skill_name}: you rated yourself {worst.self_score} "
        f"while others rated you {worst.external_avg:.1f} (delta {worst.gap_score:.1f}).\nSuggested next steps:\n{tips}"
    )
