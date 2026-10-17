"""AI Engine (UC-05): prompt engineering over an OpenAI-compatible Chat Completions API,
with a deterministic fallback template based on numeric data only (UC-05 E4a)."""
import json
import logging
from dataclasses import dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

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
 "actionable_steps": [str, str, str], "johari_insight": str}
- "narrative" has 2-4 short paragraphs. "actionable_steps" are concrete behaviors for the next milestone."""


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


def _chat(cfg: AIConfig, messages: list[dict], json_mode: bool = False, max_tokens: int = 900) -> str:
    payload: dict = {"model": cfg.model, "messages": messages, "temperature": 0.4, "max_tokens": max_tokens}
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    resp = httpx.post(
        f"{cfg.base_url}/chat/completions",
        headers={"Authorization": f"Bearer {cfg.api_key}", "Content-Type": "application/json"},
        json=payload,
        timeout=cfg.timeout,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def check_connection(cfg: AIConfig) -> tuple[bool, str]:
    """UC-08 step 4: verify AI API connection status."""
    if not cfg.api_key:
        return False, "No API key configured - the local fallback engine is active."
    if not cfg.enabled:
        return False, "AI generation is disabled - the local fallback engine is active."
    try:
        out = _chat(cfg, [{"role": "user", "content": "Reply with the single word: OK"}], max_tokens=5)
        return True, f"Connected to {cfg.model}: {out.strip()[:40]}"
    except Exception as exc:  # noqa: BLE001 - surface any provider error to the admin
        return False, f"Connection failed: {exc.__class__.__name__}: {str(exc)[:200]}"


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
        data = json.loads(out)
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
        "Request direct feedback on your coordination style halfway through the next milestone.",
    ],
    "ADAPTABILITY": [
        "When requirements change, write down the impact and propose an adjusted plan within 24 hours.",
        "Treat critical feedback as data: thank the reviewer and note one change you will try.",
        "Volunteer for one task outside your comfort zone in the next milestone.",
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


def fallback_report(student_name: str, snap: StudentSnapshot, themes: dict) -> GeneratedReport:
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
        headline=f"Focus area for the next milestone: {focus}",
        narrative=paragraphs,
        strengths=strengths,
        focus_skill=focus,
        actionable_steps=steps,
        johari_insight=johari,
        source="fallback",
        model=None,
    )


def ai_report(cfg: AIConfig, prompt: str) -> GeneratedReport:
    raw = _chat(cfg, [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}], json_mode=True)
    data = json.loads(raw)
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
        source="ai",
        model=cfg.model,
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
    return out[:limit]


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
        f"Your AI Growth Report for M{milestone.number} is ready",
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
