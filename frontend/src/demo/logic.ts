// Browser port of backend/app/services (analytics, nlp, ai_engine fallback, artifacts).
// Used only by the self-contained demo build, where no Python server is available.
import { aiConfig, chatCompletion, parseJson } from "./ai";
import type { DemoDB, Ev, Rep } from "./store";

export const DEFAULTS: Record<string, string> = {
  instructor_weight: "0.6",
  peer_weight: "0.4",
  moderate_threshold: "1.5",
  critical_threshold: "2.0",
  instructor_peer_warning: "2.0",
  min_peer_evaluations: "3",
  require_self_before_peer: "true",
  ai_enabled: "true",
  ai_base_url: "https://generativelanguage.googleapis.com/v1beta",
  ai_model: "gemini-2.5-flash",
  ai_api_key: "",
  retention_days: "730",
};

export const setting = (db: DemoDB, k: string) => db.settings[k] ?? DEFAULTS[k] ?? "";

export function scoring(db: DemoDB) {
  return {
    wi: Number(setting(db, "instructor_weight")),
    wp: Number(setting(db, "peer_weight")),
    moderate: Number(setting(db, "moderate_threshold")),
    critical: Number(setting(db, "critical_threshold")),
    warn: Number(setting(db, "instructor_peer_warning")),
    minPeers: Number(setting(db, "min_peer_evaluations")),
    selfFirst: setting(db, "require_self_before_peer") === "true",
  };
}
export type Cfg = ReturnType<typeof scoring>;

export const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

export function classify(gap: number, c: Cfg) {
  return gap <= c.moderate ? "ALIGNED" : gap <= c.critical ? "MODERATE_GAP" : "CRITICAL_GAP";
}
export function direction(ext: number, self: number, c: Cfg) {
  return Math.abs(ext - self) <= c.moderate ? "aligned" : self > ext ? "overestimate" : "underestimate";
}

export interface SkillMetric {
  competency_id: string;
  code: string;
  name: string;
  self: number | null;
  peer: number | null;
  inst: number | null;
  ext: number | null;
  gap: number | null;
  level: string | null;
  dir: string | null;
}

export function competencies(db: DemoDB) {
  return [...db.competencies].sort((a, b) => a.sort_order - b.sort_order);
}

export function snapshot(db: DemoDB, sid: string, mid: string, c = scoring(db)) {
  const evs = db.evaluations.filter((e) => e.target_id === sid && e.milestone_id === mid);
  const self = evs.find((e) => e.eval_type === "self");
  const inst = evs.find((e) => e.eval_type === "instructor");
  const peers = evs.filter((e) => e.eval_type === "peer");
  const skills: SkillMetric[] = competencies(db).map((comp) => {
    const pv = peers.map((p) => p.ratings[comp.id]).filter((x) => x != null);
    const m: SkillMetric = {
      competency_id: comp.id, code: comp.code, name: comp.skill_name,
      self: self?.ratings[comp.id] ?? null, peer: pv.length ? round(mean(pv)) : null, inst: inst?.ratings[comp.id] ?? null,
      ext: null, gap: null, level: null, dir: null,
    };
    if (m.inst != null && m.peer != null) m.ext = round((c.wi * m.inst + c.wp * m.peer) / (c.wi + c.wp));
    else if (m.peer != null) m.ext = m.peer;
    if (m.ext != null && m.self != null) {
      m.gap = round(Math.abs(m.ext - m.self));
      m.level = classify(m.gap, c);
      m.dir = direction(m.ext, m.self, c);
    }
    return m;
  });
  const avg = (k: keyof SkillMetric) => {
    const v = skills.map((s) => s[k]).filter((x): x is number => typeof x === "number");
    return v.length ? round(mean(v)) : null;
  };
  const scored = skills.filter((s) => s.gap != null);
  const worst = scored.length ? scored.reduce((a, b) => ((b.gap ?? 0) > (a.gap ?? 0) ? b : a)) : null;
  return {
    hasSelf: !!self, hasInst: !!inst, peerCount: peers.length, minPeers: c.minPeers,
    peerComplete: peers.length >= c.minPeers,
    complete: !!self && !!inst && peers.length >= c.minPeers,
    skills, worst,
    comments: peers.filter((p) => p.comment && (p.moderation_status === "none" || p.moderation_status === "approved")).map((p) => p.comment as string),
    instNotes: inst?.notes ?? "", selfEvidence: self?.comment ?? "",
    oSelf: avg("self"), oPeer: avg("peer"), oInst: avg("inst"), oExt: avg("ext"),
  };
}
export type Snap = ReturnType<typeof snapshot>;
export const overallLevel = (s: Snap, c: Cfg) => (s.worst?.gap != null ? classify(s.worst.gap, c) : "ALIGNED");

// ------------------------------------------------------------------ NLP --

const POSITIVE = new Set("great good excellent helpful clear organized organised reliable proactive supportive creative strong responsive punctual respectful collaborative efficient flexible patient motivated listens insightful thorough dedicated improved ممتاز رائع متعاون منظم واضح مبدع ملتزم مفيد جيد محترم".split(" "));
const NEGATIVE = new Set("late struggles struggle rarely never ignores ignored unclear confusing slow missed misses difficult rigid defensive interrupts dominates micromanages micromanagement absent unresponsive poor weak disorganized hard conflict doesn't didn't fails متأخر ضعيف غائب يتجاهل صعب".split(" "));
const NEG_PHRASES = ["takes over", "without asking", "does not", "لا يتواصل"];
const NEGATORS = new Set(["not", "never", "no", "hardly", "لا", "ليس", "لم"]);
const SKILL_KEYWORDS: Record<string, string[]> = {
  COMMUNICATION: ["communicat", "explain", "present", "listen", "message", "reply", "respond", "update", "clear", "discuss", "meeting", "express", "write", "email", "تواصل", "شرح", "عرض", "يستمع"],
  LEADERSHIP: ["lead", "leader", "initiative", "decision", "delegat", "organiz", "organis", "coordinat", "guide", "motivat", "takes over", "manage", "direction", "قياد", "مبادر", "قرار", "ينظم"],
  ADAPTABILITY: ["adapt", "flexib", "change", "feedback", "criticism", "learn", "adjust", "resilien", "pressure", "new tool", "pivot", "مرون", "تكيف", "يتقبل", "تغيير"],
  COLLABORATION: ["team", "collaborat", "help", "support", "share", "contribut", "together", "cooperat", "workload", "pair", "inclusive", "فريق", "تعاون", "يساعد", "مشارك"],
  PROBLEM_SOLVING: ["problem", "solve", "solution", "debug", "fix", "analy", "creative", "idea", "issue", "logic", "critical think", "approach", "حل", "مشكل", "تحليل", "فكرة"],
};
const TOXIC = ["useless", "stupid", "idiot", "dumb", "lazy", "worthless", "incompetent", "pathetic", "hate", "moron", "loser", "trash", "garbage", "shut up", "disgusting", "ruined", "intentionally", "sabotag", "fool", "غبي", "فاشل", "كسول", "حمار", "تافه", "أكرهه", "اكرهه", "زبالة", "سخيف", "متخلف"];
const BIAS = [/\bbecause (he|she|they) (is|are) (a )?(girl|boy|woman|man|foreigner|saudi|non-saudi)\b/, /\b(all|those) (girls|boys|women|men|foreigners) (are|always)\b/];

const words = (t: string) => t.toLowerCase().match(/[\p{L}\p{N}_']+/gu) ?? [];

export function sentiment(text: string) {
  if (!text) return 0;
  const low = text.toLowerCase();
  const w = words(low);
  let score = 0;
  w.forEach((x, i) => {
    let p = (POSITIVE.has(x) ? 1 : 0) - (NEGATIVE.has(x) ? 1 : 0);
    if (p && i > 0 && NEGATORS.has(w[i - 1])) p = -p;
    score += p;
  });
  NEG_PHRASES.forEach((p) => low.includes(p) && (score -= 1));
  const hits = w.filter((x) => POSITIVE.has(x) || NEGATIVE.has(x)).length || 1;
  return Math.max(-1, Math.min(1, score / hits));
}

const sentences = (t: string) => (t || "").split(/(?<=[.!?؟\n])\s+/).map((s) => s.trim()).filter((s) => s.length > 3);

export function mapSkills(text: string) {
  const out: Record<string, string[]> = {};
  for (const s of sentences(text)) {
    const low = s.toLowerCase();
    for (const [code, keys] of Object.entries(SKILL_KEYWORDS)) if (keys.some((k) => low.includes(k))) (out[code] ??= []).push(s);
  }
  return out;
}

export function analyzeComments(comments: string[]) {
  const themes: Record<string, { mentions: number; positive: string[]; negative: string[] }> = {};
  for (const c of comments)
    for (const [code, ss] of Object.entries(mapSkills(c))) {
      const t = (themes[code] ??= { mentions: 0, positive: [], negative: [] });
      for (const s of ss) {
        t.mentions++;
        (sentiment(s) >= 0 ? t.positive : t.negative).push(s);
      }
    }
  const overall = comments.length ? comments.reduce((a, c) => a + sentiment(c), 0) / comments.length : 0;
  return { overall: round(overall), themes };
}

export function contentFilter(text: string) {
  const low = (text || "").toLowerCase();
  for (const t of TOXIC) if (low.includes(t)) return { is_toxic: true, reason: "Unconstructive / Personal Attack", is_constructive: false, hints: [`Avoid hostile wording ('${t}').`] };
  for (const b of BIAS) if (b.test(low)) return { is_toxic: true, reason: "Potential bias / Stereotyping", is_constructive: false, hints: ["Focus on observable behavior, not identity."] };
  const hints: string[] = [];
  if (words(low).length < 8) hints.push("Add a concrete example (at least one full sentence).");
  if (!Object.keys(mapSkills(text)).length) hints.push("Mention a specific behavior (communication, leadership, teamwork...).");
  if (sentiment(text) < -0.6 && !["could", "should", "suggest", "try", "would", "يمكن", "أقترح"].some((k) => low.includes(k))) hints.push("Balance criticism with a suggestion for improvement.");
  return { is_toxic: false, reason: null as string | null, is_constructive: hints.length === 0, hints };
}

// ------------------------------------------------------- report engine --

export const STEPS: Record<string, string[]> = {
  COMMUNICATION: ["Send a short written update to your team after each work session (what you did, what is next, blockers).", "Summarize decisions at the end of every meeting and confirm everyone understood them.", "Practice active listening: paraphrase a teammate's point before responding."],
  LEADERSHIP: ["Delegate at least two meaningful tasks in the next sprint and agree on the expected outcome.", "Ask teammates for their ideas before proposing your own solution in planning meetings.", "Request direct feedback on your coordination style halfway through the next milestone."],
  ADAPTABILITY: ["When requirements change, write down the impact and propose an adjusted plan within 24 hours.", "Treat critical feedback as data: thank the reviewer and note one change you will try.", "Volunteer for one task outside your comfort zone in the next milestone."],
  COLLABORATION: ["Agree on a visible task board and update your items before every stand-up.", "Offer help to one teammate each week and pair on a difficult task.", "Make sure workload is shared fairly: review the task split with your team at the start of each milestone."],
  PROBLEM_SOLVING: ["Before coding or writing, break each problem into steps and list at least two alternative solutions.", "Use a short root-cause analysis (5 Whys) when an issue repeats.", "Document how you solved one hard issue and share it with your team."],
};

function fallback(name: string, s: Snap, th: ReturnType<typeof analyzeComments>) {
  const w = s.worst;
  const focus = w?.name ?? "Communication";
  const first = name.split(" ")[0] || "Student";
  const ext = s.oExt ?? 0, slf = s.oSelf ?? 0;
  const p = [`${first}, this report combines your self-assessment, the anonymous evaluations of ${s.peerCount} teammates and your instructor's evaluation. Your overall self-rating is ${slf.toFixed(1)}/5 while the weighted external score (60% instructor, 40% peers) is ${ext.toFixed(1)}/5.`];
  if (w?.gap != null && w.dir === "overestimate") p.push(`The largest perception gap is in ${w.name}: you rated yourself ${w.self}, but others rated you ${w.ext!.toFixed(1)} (delta ${w.gap.toFixed(1)}). In Johari Window terms this is a potential blind spot - a behavior visible to your team and instructor that you may not be fully aware of.`);
  else if (w?.gap != null && w.dir === "underestimate") p.push(`In ${w.name} others rate you higher (${w.ext!.toFixed(1)}) than you rate yourself (${w.self}). This is a hidden strength - you can rely on it with more confidence.`);
  else p.push("Your self-perception is well aligned with how others see you across all five skills.");
  const ft = th.themes[w?.code ?? ""];
  if (ft?.negative.length) p.push(`Peer comments related to ${focus} include observations such as: "${ft.negative[0].replace(/\.$/, "")}."`);
  else if (s.comments.length) p.push(`One teammate wrote: "${s.comments[0].replace(/\.$/, "")}."`);
  const strengths = s.skills.filter((x) => x.ext != null).sort((a, b) => b.ext! - a.ext!).slice(0, 2).filter((x) => x.ext! >= 3.5).map((x) => `${x.name} (${x.ext!.toFixed(1)}/5 from others)`);
  return {
    headline: `Focus area for the next milestone: ${focus}`,
    paragraphs: p, strengths, focus_skill: focus,
    actionable_steps: STEPS[w?.code ?? "COMMUNICATION"] ?? STEPS.COMMUNICATION,
    johari_insight: w?.gap != null ? `Largest variance (delta ${w.gap.toFixed(1)}) found in ${w.name}.` : "Not enough data for a Johari analysis yet.",
  };
}

function resources(db: DemoDB, s: Snap) {
  const ranked = s.skills.filter((x) => x.ext != null).sort((a, b) => {
    const ka = a.dir === "overestimate" ? -(a.gap ?? 0) : 0, kb = b.dir === "overestimate" ? -(b.gap ?? 0) : 0;
    return ka - kb || a.ext! - b.ext!;
  });
  const out: Record<string, string>[] = [];
  for (const sk of ranked.slice(0, 2))
    for (const r of db.resources.filter((r) => r.competency_id === sk.competency_id).slice(0, 2))
      out.push({ title: r.title, provider: r.provider, url: r.url, kind: r.kind, duration: r.duration, skill: sk.name });
  const top = out.slice(0, 4);
  // A video the admin added for the focus skill is always offered (shown as the recommended video).
  const video = ranked[0] && db.resources.find((r) => r.competency_id === ranked[0].competency_id && r.kind === "video");
  if (video && !top.some((r) => r.url === video.url)) top.push({ title: video.title, provider: video.provider, url: video.url, kind: video.kind, duration: video.duration, skill: ranked[0].name });
  return top;
}

export const nowIso = () => new Date().toISOString();
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export function notify(db: DemoDB, user_id: string, title: string, body = "", kind = "info", link: string | null = null) {
  db.notifications.push({ id: uid(), user_id, kind, title, body, link, is_read: false, created_at: nowIso() });
}
export function log(db: DemoDB, actor_id: string | null, action: string, entity = "", entity_id: string | null = null, details = "") {
  db.audit.push({ id: uid(), actor_id, action, entity, entity_id, details, created_at: nowIso() });
}

export const SYSTEM_PROMPT = `You are EduSkills AI, a professional soft-skills development coach for undergraduate students
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
- "narrative" has 2-4 short paragraphs. "actionable_steps" are concrete behaviors for the next milestone.
- "video_search_query" is a short English YouTube search phrase (4-8 words) that finds a practical tutorial
  for the student's focus area, e.g. "how to delegate tasks as a team leader".`;

export function buildPrompt(name: string, m: Record<string, any>, s: Snap, th: ReturnType<typeof analyzeComments>) {
  const rows = s.skills.map((x) => `- ${x.name}: self=${x.self}, peer_avg=${x.peer}, instructor=${x.inst}, external_weighted=${x.ext}, delta=${x.gap}, level=${x.level}, direction=${x.dir}`).join("\n");
  const comments = s.comments.slice(0, 25).map((c) => `- "${c}"`).join("\n") || "- (no qualitative peer comments)";
  const themes = Object.entries(th.themes).map(([k, t]) => `- ${k}: ${t.mentions} mentions, ${t.positive.length} positive, ${t.negative.length} negative`).join("\n") || "- none";
  return `Student first name: ${name.split(" ")[0] || "the student"}
Project milestone: M${m.number} - ${m.name}

Quantitative metrics per soft skill (1-5 Likert scale, external = 60% instructor + 40% peer average):
${rows}

Overall: self=${s.oSelf}, external=${s.oExt}

NLP pipeline output (behavioral themes from peer comments, overall sentiment ${th.overall}):
${themes}

Anonymized peer comments:
${comments}

Instructor supervisory notes:
${s.instNotes || "(none)"}

Student's own evidence / reflection:
${s.selfEvidence || "(none)"}

Write the developmental report JSON now. Focus on the skill with the largest delta.`;
}

async function aiNarrative(db: DemoDB, prompt: string) {
  const cfg = aiConfig(db);
  if (!cfg.usable) return null;
  try {
    const d = parseJson(await chatCompletion(cfg, SYSTEM_PROMPT, [{ role: "user", content: prompt }], true, 1200));
    let paragraphs = d.narrative ?? [];
    if (typeof paragraphs === "string") paragraphs = paragraphs.split("\n").filter((x: string) => x.trim());
    if (!paragraphs.length) return null;
    return {
      headline: String(d.headline ?? "").slice(0, 300), paragraphs: paragraphs.slice(0, 5).map(String),
      strengths: (d.strengths ?? []).slice(0, 5).map(String), focus_skill: String(d.focus_skill ?? ""),
      actionable_steps: (d.actionable_steps ?? []).slice(0, 6).map(String), johari_insight: String(d.johari_insight ?? ""), video_query: String(d.video_search_query ?? "").slice(0, 120), model: cfg.model,
    };
  } catch (e) {
    console.warn("GenAI unavailable, using the fallback template:", e);
    return null;
  }
}

export async function generateReport(db: DemoDB, sid: string, mid: string, force = false): Promise<Rep | null> {
  const c = scoring(db);
  const s = snapshot(db, sid, mid, c);
  if (!s.complete) return null;
  const existing = db.reports.find((r) => r.student_id === sid && r.milestone_id === mid);
  if (existing && !force) return existing;
  const student = db.users.find((u) => u.id === sid)!;
  const m = db.milestones.find((x) => x.id === mid)!;
  const th = analyzeComments(s.comments);
  const ai = await aiNarrative(db, buildPrompt(student.full_name, m, s, th));
  const g = ai ?? fallback(student.full_name, s, th);
  const level = overallLevel(s, c);
  const rep: Rep = existing ?? ({ id: uid(), student_id: sid, project_id: m.project_id, milestone_id: mid } as Rep);
  Object.assign(rep, {
    narrative: g.paragraphs.join("\n\n"),
    content: {
      ...g, resources: resources(db, s),
      themes: Object.fromEntries(Object.entries(th.themes).map(([k, v]) => [k, { mentions: v.mentions, positive: v.positive.length, negative: v.negative.length }])),
      overall_sentiment: th.overall, peer_count: s.peerCount,
    },
    source: ai ? "ai" : "fallback", model: ai?.model ?? null, overall_self: s.oSelf ?? 0, overall_external: s.oExt ?? 0,
    overall_gap: round(Math.abs((s.oExt ?? 0) - (s.oSelf ?? 0))), overall_level: level, generated_at: nowIso(),
    metrics: s.skills.map((x) => ({ competency_id: x.competency_id, self_score: x.self!, peer_avg: x.peer!, instructor_score: x.inst!, external_avg: x.ext!, gap_score: x.gap!, direction: x.dir!, level: classify(x.gap!, c) })),
  });
  if (!existing) db.reports.push(rep);
  notify(db, sid, `Your AI Growth Report for M${m.number} is ready`, g.headline, "report", "/student/report");
  if (level === "CRITICAL_GAP" && !db.interventions.some((i) => i.student_id === sid && i.milestone_id === mid && i.status !== "resolved")) {
    const w = s.worst!;
    const reason = `Critical blind spot detected in ${w.name} at M${m.number}: self ${w.self} vs external ${w.ext!.toFixed(1)} (delta ${w.gap!.toFixed(1)}).`;
    db.interventions.push({ id: uid(), student_id: sid, project_id: m.project_id, milestone_id: mid, raised_by_id: null, priority: "high", reason, status: "open", advisor_notes: null, created_at: nowIso(), updated_at: nowIso() });
    db.users.filter((u) => u.role === "advisor").forEach((u) => notify(db, u.id, `High-priority alert: ${student.full_name}`, reason, "alert", "/advisor"));
  }
  log(db, null, "report.generated", "ai_report", rep.id, `source=${ai ? "ai" : "fallback"} level=${level}`);
  return rep;
}

// ------------------------------------------------------------ artifacts --

export function parseGitLog(text: string) {
  const out: { at: Date }[] = [];
  for (const raw of (text || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split("|");
    const d = new Date(parts.length >= 3 ? parts[2].trim() : line);
    if (!isNaN(d.getTime())) out.push({ at: d });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function commitIndicators(commits: { at: Date }[], due: Date | null) {
  if (!commits.length) return { commit_count: 0 };
  const t = commits.map((c) => c.at);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const days = new Set(t.map(day));
  const span = Math.max(1, Math.round((new Date(day(t[t.length - 1])).getTime() - new Date(day(t[0])).getTime()) / 86400000) + 1);
  const gaps = t.slice(1).map((x, i) => (x.getTime() - t[i].getTime()) / 3600000);
  const out: Record<string, number | string | null> = {
    commit_count: t.length, active_days: days.size, span_days: span, first_commit: t[0].toISOString(), last_commit: t[t.length - 1].toISOString(),
    consistency: round(days.size / span), avg_hours_between_commits: gaps.length ? round(mean(gaps), 1) : null,
  };
  if (due) {
    const lm = t.filter((x) => x.getTime() >= due.getTime() - 48 * 3600000 && x <= due).length;
    out.last_minute_ratio = round(lm / t.length);
    out.commits_after_due = t.filter((x) => x > due).length;
  }
  return out;
}

export function summarizeArtifacts(list: Record<string, unknown>[]) {
  const num = (k: string) => list.map((m) => m[k]).filter((x): x is number => typeof x === "number");
  const indicators: { label: string; value: string; signal: string }[] = [];
  const cons = num("consistency"), lm = num("last_minute_ratio");
  const onTime = list.filter((m) => "on_time" in m).map((m) => m.on_time as boolean);
  if (cons.length) { const c = Math.max(...cons); indicators.push({ label: "Work consistency", value: `${Math.round(c * 100)}% of days active`, signal: c >= 0.4 ? "positive" : "warning" }); }
  if (lm.length) { const l = Math.max(...lm); indicators.push({ label: "Last-minute work", value: `${Math.round(l * 100)}% of commits in final 48h`, signal: l >= 0.5 ? "warning" : "positive" }); }
  if (onTime.length) { const ok = onTime.filter(Boolean).length; indicators.push({ label: "Punctuality", value: `${ok}/${onTime.length} submissions on time`, signal: ok === onTime.length ? "positive" : "warning" }); }
  return { total_commits: num("commit_count").reduce((a, b) => a + b, 0), indicators };
}

export type { Ev };
