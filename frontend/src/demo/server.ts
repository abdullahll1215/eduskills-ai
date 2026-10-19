// In-browser implementation of the REST API (mirrors backend/app/routers) for the demo build.
import { getDB, saveDB, type DemoDB, type Ev, type Rep } from "./store";
import {
  DEFAULTS, commitIndicators, competencies, contentFilter, generateReport, log, nowIso, notify,
  overallLevel, parseGitLog, round, scoring, sentiment, setting, snapshot, summarizeArtifacts, uid,
} from "./logic";
import { sha256 } from "./sha256";
import { activeModel, aiConfig, chatCompletion } from "./ai";

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
type Ctx = { db: DemoDB; user: any; p: Record<string, string>; q: URLSearchParams; body: any };
type Handler = (c: Ctx) => unknown;
const routes: [string, RegExp, string[], Handler, boolean][] = [];
function route(method: string, path: string, h: Handler, auth = true) {
  const keys: string[] = [];
  const re = new RegExp("^" + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  routes.push([method, re, keys, h, auth]);
}

const fail = (s: number, m: string): never => { throw new HttpError(s, m); };
const need = <T>(v: T | undefined | null, label: string): T => v ?? fail(404, `${label} not found`);
const roleIs = (u: any, ...r: string[]) => r.includes(u.role) || fail(403, "You do not have permission to perform this action");
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const reviewerHash = (rid: string, pid: string) => sha256(`eduskills-peer-salt:${pid}:${rid}`);

// ------------------------------------------------------------- helpers --

const userOut = (u: any) => {
  const { password: _pw, ...rest } = u;
  void _pw;
  return rest;
};
const msOut = (m: any) => ({ id: m.id, project_id: m.project_id, number: m.number, name: m.name, description: m.description, due_date: m.due_date, status: m.status });
const compOut = (c: any) => ({ id: c.id, code: c.code, skill_name: c.skill_name, description: c.description, rubric: c.rubric });
const msOf = (db: DemoDB, pid: string) => db.milestones.filter((m) => m.project_id === pid).sort((a, b) => a.number - b.number);
const enrollmentOf = (db: DemoDB, uid_: string, pid: string) => db.enrollments.find((e) => e.user_id === uid_ && e.project_id === pid);
const teammates = (db: DemoDB, enr: any) =>
  enr?.team_id ? db.enrollments.filter((e) => e.team_id === enr.team_id && e.user_id !== enr.user_id).map((e) => db.users.find((u) => u.id === e.user_id)!).filter((u) => u.is_active).sort((a, b) => a.full_name.localeCompare(b.full_name)) : [];
const studentsOf = (db: DemoDB, pid: string) =>
  db.enrollments.filter((e) => e.project_id === pid).map((e) => ({ u: db.users.find((u) => u.id === e.user_id)!, e })).filter((x) => x.u?.role === "student").sort((a, b) => a.u.full_name.localeCompare(b.u.full_name));
const teamName = (db: DemoDB, tid: string | null) => db.teams.find((t) => t.id === tid)?.team_name ?? null;
const canManage = (u: any, p: any) => u.role === "admin" || p.instructor_id === u.id;
const ensureManage = (u: any, p: any) => canManage(u, p) || fail(403, "You are not the instructor of this project");

function validateRatings(db: DemoDB, r: Record<string, number>) {
  const ids = db.competencies.map((c) => c.id);
  if (!r || ids.some((i) => r[i] == null)) fail(422, "All five soft skills must be rated before submission");
  for (const v of Object.values(r)) if (v < 1 || v > 5) fail(422, "Scores must be on the 1-5 Likert scale");
  return Object.fromEntries(ids.map((i) => [i, Number(r[i])]));
}

function reportOut(db: DemoDB, r: Rep) {
  const m = db.milestones.find((x) => x.id === r.milestone_id)!;
  const comp = (id: string) => db.competencies.find((c) => c.id === id)!;
  return {
    id: r.id, milestone: msOut(m), narrative: r.narrative, content: r.content, source: r.source, overall_self: r.overall_self,
    overall_external: r.overall_external, overall_gap: r.overall_gap, overall_level: r.overall_level, generated_at: r.generated_at,
    metrics: [...r.metrics].sort((a, b) => comp(a.competency_id).sort_order - comp(b.competency_id).sort_order).map((d) => ({
      competency_id: d.competency_id, code: comp(d.competency_id).code, skill: comp(d.competency_id).skill_name, self: d.self_score, peer_avg: d.peer_avg,
      instructor: d.instructor_score, external: d.external_avg, gap: d.gap_score, direction: d.direction, level: d.level,
    })),
  };
}
const studentReports = (db: DemoDB, sid: string, pid?: string | null) =>
  db.reports.filter((r) => r.student_id === sid && (!pid || r.project_id === pid)).sort((a, b) => msNum(db, a.milestone_id) - msNum(db, b.milestone_id));
const msNum = (db: DemoDB, mid: string) => db.milestones.find((m) => m.id === mid)?.number ?? 0;

// -------------------------------------------------------------- auth --

route("POST", "/api/auth/login", ({ db, body }) => {
  const u = db.users.find((x) => x.email === String(body.email).toLowerCase());
  if (!u || u.password !== body.password) fail(401, "Invalid email or password");
  if (!u!.is_active) fail(403, "This account has been disabled");
  u!.last_login_at = nowIso();
  log(db, u!.id, "auth.login", "user", u!.id);
  return { access_token: u!.id, token_type: "bearer", user: userOut(u) };
}, false);
route("GET", "/api/auth/signup-options", ({ db }) =>
  db.projects.filter((p) => p.is_active).map((p) => ({ id: p.id, title: p.title, teams: db.teams.filter((t) => t.project_id === p.id).map((t) => ({ id: t.id, team_name: t.team_name })) })), false);
route("POST", "/api/auth/register", ({ db, body }) => {
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.full_name ?? "").trim();
  if (name.length < 2) fail(422, "Please enter your full name");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(422, "Please enter a valid email address");
  if (String(body.password ?? "").length < 8) fail(422, "The password must have at least 8 characters");
  if (db.users.some((u) => u.email === email)) fail(409, "An account with this email already exists. Sign in instead.");
  const team = body.team_id ? db.teams.find((t) => t.id === body.team_id) ?? fail(400, "The selected team is not available") : null;
  const u = { id: uid(), full_name: name, email, role: "student", student_number: String(body.student_number ?? "").trim() || null, level: null, mobile: null, department: null, is_active: true, created_at: nowIso(), last_login_at: nowIso(), password: body.password };
  db.users.push(u);
  if (team) {
    db.enrollments.push({ id: uid(), user_id: u.id, project_id: team.project_id, team_id: team.id });
    const ins = db.projects.find((p) => p.id === team.project_id)?.instructor_id;
    if (ins) notify(db, ins, `New student joined ${team.team_name}`, name, "info", "/instructor/projects");
  }
  log(db, u.id, "auth.registered", "user", u.id, `team=${team?.team_name ?? "-"}`);
  return { access_token: u.id, token_type: "bearer", user: userOut(u) };
}, false);
route("GET", "/api/auth/me", ({ user }) => userOut(user));
route("PUT", "/api/auth/me", ({ db, user, body }) => {
  for (const k of ["full_name", "mobile", "level", "department"]) if (body[k] !== undefined) user[k] = body[k];
  log(db, user.id, "user.profile_updated", "user", user.id);
  return userOut(user);
});
route("POST", "/api/auth/change-password", ({ db, user, body }) => {
  if (user.password !== body.current_password) fail(400, "Current password is incorrect");
  if (String(body.new_password).length < 8) fail(422, "The new password must have at least 8 characters");
  user.password = body.new_password;
  log(db, user.id, "user.password_changed", "user", user.id);
  return { ok: true };
});
route("GET", "/api/competencies", ({ db }) => competencies(db).map(compOut));
route("GET", "/api/notifications", ({ db, user }) => db.notifications.filter((n) => n.user_id === user.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50));
route("POST", "/api/notifications/:id/read", ({ db, user, p }) => {
  const n = db.notifications.find((x) => x.id === p.id && x.user_id === user.id);
  need(n, "Notification").is_read = true;
  return { ok: true };
});
route("POST", "/api/notifications/read-all", ({ db, user }) => {
  db.notifications.filter((n) => n.user_id === user.id).forEach((n) => (n.is_read = true));
  return { ok: true };
});

// ----------------------------------------------------------- student --

function msStatus(db: DemoDB, user: any, enr: any, m: any) {
  const c = scoring(db);
  const mates = teammates(db, enr);
  const s = snapshot(db, user.id, m.id, c);
  const key = reviewerHash(user.id, m.project_id);
  const given = new Set(db.evaluations.filter((e) => e.milestone_id === m.id && e.eval_type === "peer" && e.reviewer_key === key).map((e) => e.target_id));
  const report = db.reports.find((r) => r.student_id === user.id && r.milestone_id === m.id);
  const parts = [s.hasSelf ? 1 : 0, mates.length ? given.size / mates.length : 1, Math.min(s.peerCount / c.minPeers, 1), s.hasInst ? 1 : 0];
  return { ...msOut(m), self_done: s.hasSelf, peers_given: given.size, peers_total: mates.length, peers_received: s.peerCount, min_peers: c.minPeers, instructor_done: s.hasInst, report_id: report?.id ?? null, progress: Math.round((100 * parts.reduce((a, b) => a + b, 0)) / 4) };
}
const studentOnly = (u: any) => roleIs(u, "student");
const msForStudent = (db: DemoDB, user: any, mid: string | null) => {
  const m = need(db.milestones.find((x) => x.id === mid), "Milestone");
  const enr = enrollmentOf(db, user.id, m.project_id) ?? fail(403, "You are not enrolled in this project");
  return { m, enr };
};
const isOpen = (m: any) => m.status === "active" || fail(409, "The evaluation period for this milestone is closed");

route("GET", "/api/student/projects", ({ db, user }) => {
  studentOnly(user);
  return db.enrollments.filter((e) => e.user_id === user.id).map((enr) => {
    const p = db.projects.find((x) => x.id === enr.project_id)!;
    if (!p.is_active) return null;
    const t = db.teams.find((x) => x.id === enr.team_id);
    return {
      id: p.id, title: p.title, description: p.description, instructor: db.users.find((u) => u.id === p.instructor_id)?.full_name ?? null,
      team: t ? { id: t.id, name: t.team_name } : null, teammates: teammates(db, enr).map((u) => ({ id: u.id, full_name: u.full_name })),
      milestones: msOf(db, p.id).map((m) => msStatus(db, user, enr, m)),
    };
  }).filter(Boolean);
});
route("GET", "/api/student/self-assessment", ({ db, user, q }) => {
  studentOnly(user);
  const { m } = msForStudent(db, user, q.get("milestone_id"));
  const ev = db.evaluations.find((e) => e.milestone_id === m.id && e.target_id === user.id && e.eval_type === "self");
  return { milestone: msOut(m), competencies: competencies(db).map(compOut), submission: ev ? { id: ev.id, ratings: ev.ratings, evidence: ev.comment ?? "", evidence_link: ev.evidence_link, created_at: ev.created_at, is_locked: ev.is_locked } : null };
});
route("POST", "/api/student/self-assessment", async ({ db, user, body }) => {
  studentOnly(user);
  const { m } = msForStudent(db, user, body.milestone_id);
  isOpen(m);
  const ratings = validateRatings(db, body.ratings);
  const ex = db.evaluations.find((e) => e.milestone_id === m.id && e.target_id === user.id && e.eval_type === "self");
  if (ex?.is_locked) fail(409, "Your self-assessment for this milestone is locked (read-only)");
  if (ex) db.evaluations.splice(db.evaluations.indexOf(ex), 1);
  const ev: Ev = { id: uid(), project_id: m.project_id, milestone_id: m.id, evaluator_id: user.id, target_id: user.id, eval_type: "self", reviewer_key: "self", comment: (body.evidence ?? "").trim() || null, evidence_link: body.evidence_link ?? null, notes: null, sentiment: null, is_flagged: false, flag_reason: null, moderation_status: "none", is_locked: true, created_at: nowIso(), ratings };
  db.evaluations.push(ev);
  log(db, user.id, "evaluation.self_submitted", "evaluation", ev.id, `milestone=M${m.number}`);
  await generateReport(db, user.id, m.id);
  return { id: ev.id, created_at: ev.created_at, message: "Self-assessment submitted and locked" };
});
route("GET", "/api/student/peers", ({ db, user, q }) => {
  studentOnly(user);
  const { m, enr } = msForStudent(db, user, q.get("milestone_id"));
  const c = scoring(db);
  const key = reviewerHash(user.id, m.project_id);
  const done = new Set(db.evaluations.filter((e) => e.milestone_id === m.id && e.eval_type === "peer" && e.reviewer_key === key).map((e) => e.target_id));
  const selfDone = new Set(db.evaluations.filter((e) => e.milestone_id === m.id && e.eval_type === "self").map((e) => e.target_id));
  const mates = teammates(db, enr);
  return { milestone: msOut(m), team_size_ok: mates.length >= c.minPeers, min_peers: c.minPeers, competencies: competencies(db).map(compOut), peers: mates.map((t) => ({ id: t.id, full_name: t.full_name, evaluated: done.has(t.id), available: selfDone.has(t.id) || !c.selfFirst })) };
});
route("POST", "/api/student/peer-check", ({ body }) => contentFilter(body.comment ?? ""));
route("POST", "/api/student/peer-evaluations", async ({ db, user, body }) => {
  studentOnly(user);
  const { m, enr } = msForStudent(db, user, body.milestone_id);
  isOpen(m);
  if (body.target_id === user.id) fail(422, "You cannot evaluate yourself as a peer");
  const c = scoring(db);
  const mates = teammates(db, enr);
  if (!mates.some((t) => t.id === body.target_id)) fail(403, "You can only evaluate members of your own team");
  if (mates.length < c.minPeers) fail(409, `Your team needs at least ${c.minPeers} peers for anonymous evaluation`);
  if (c.selfFirst && !db.evaluations.some((e) => e.milestone_id === m.id && e.target_id === body.target_id && e.eval_type === "self")) fail(409, "This teammate has not completed their self-assessment yet");
  const ratings = validateRatings(db, body.ratings);
  const key = reviewerHash(user.id, m.project_id);
  if (db.evaluations.some((e) => e.milestone_id === m.id && e.target_id === body.target_id && e.reviewer_key === key)) fail(409, "You have already evaluated this teammate for this milestone");
  const comment = String(body.comment ?? "").trim();
  if (!comment) fail(422, "Please write a comment");
  const v = contentFilter(comment);
  const ev: Ev = { id: uid(), project_id: m.project_id, milestone_id: m.id, evaluator_id: null, target_id: body.target_id, eval_type: "peer", reviewer_key: key, comment, evidence_link: null, notes: null, sentiment: sentiment(comment), is_flagged: v.is_toxic, flag_reason: v.reason, moderation_status: v.is_toxic ? "pending" : "none", is_locked: true, created_at: nowIso(), ratings };
  db.evaluations.push(ev);
  log(db, null, "evaluation.peer_submitted", "evaluation", ev.id, `milestone=M${m.number} flagged=${v.is_toxic}`);
  const proj = db.projects.find((x) => x.id === m.project_id)!;
  if (v.is_toxic) proj.instructor_id && notify(db, proj.instructor_id, "Peer feedback flagged for review", v.reason ?? "", "moderation", "/instructor");
  else notify(db, body.target_id, "You received new anonymous peer feedback", `Milestone M${m.number}`, "feedback", "/student");
  await generateReport(db, body.target_id, m.id);
  return { id: ev.id, flagged: v.is_toxic, message: v.is_toxic ? "Your comment was flagged by the AI content filter and held for instructor review. Your ratings were recorded." : "Peer evaluation submitted anonymously" };
});
function feedbackSummary(db: DemoDB, sid: string, m: any) {
  const c = scoring(db);
  const s = snapshot(db, sid, m.id, c);
  const released = s.peerCount >= c.minPeers;
  const comments = released ? [...s.comments].sort(() => Math.random() - 0.5) : [];
  const inst = db.evaluations.find((e) => e.milestone_id === m.id && e.target_id === sid && e.eval_type === "instructor");
  return {
    peer_count: s.peerCount, min_peers: c.minPeers, released,
    comments: comments.map((t) => ({ text: t, sentiment: sentiment(t) })),
    skills: s.skills.map((x) => ({ name: x.name, code: x.code, peer_avg: released ? x.peer : null })),
    instructor_comments: inst?.notes ? [{ text: inst.notes, created_at: inst.created_at }] : [],
  };
}
route("GET", "/api/student/feedback", ({ db, user, q }) => {
  studentOnly(user);
  const { m } = msForStudent(db, user, q.get("milestone_id"));
  return feedbackSummary(db, user.id, m);
});
const publicProfiles = (db: DemoDB) => setting(db, "public_feedback_profiles") === "true" || fail(403, "Viewing other students' feedback is turned off by the administrator");
route("GET", "/api/student/directory", ({ db, user, q }) => {
  studentOnly(user);
  publicProfiles(db);
  const term = (q.get("q") ?? "").trim().toLowerCase();
  return db.users
    .filter((u) => u.role === "student" && u.is_active && (!term || `${u.full_name} ${u.student_number ?? ""}`.toLowerCase().includes(term)))
    .sort((a, b) => a.full_name.localeCompare(b.full_name)).slice(0, 20)
    .map((u) => {
      const e = db.enrollments.find((x) => x.user_id === u.id);
      return { id: u.id, full_name: u.full_name, student_number: u.student_number, team: e ? teamName(db, e.team_id) : null, project: e ? db.projects.find((p) => p.id === e.project_id)?.title ?? null : null, is_me: u.id === user.id };
    });
});
function allFeedback(db: DemoDB, sid: string, mss: any[]) {
  const c = scoring(db);
  const comments: string[] = [];
  const notes: { text: string; created_at: string }[] = [];
  const perSkill: Record<string, number[]> = {};
  let reviews = 0;
  for (const m of mss) {
    const s = snapshot(db, sid, m.id, c);
    const inst = db.evaluations.find((e) => e.milestone_id === m.id && e.target_id === sid && e.eval_type === "instructor");
    if (inst?.notes) notes.push({ text: inst.notes, created_at: inst.created_at });
    if (s.peerCount < c.minPeers) continue;
    reviews += s.peerCount;
    comments.push(...s.comments);
    for (const k of s.skills) if (k.peer != null) (perSkill[k.code] ??= []).push(...Array(s.peerCount).fill(k.peer));
  }
  return {
    peer_count: reviews, min_peers: c.minPeers, released: reviews > 0,
    comments: comments.sort(() => Math.random() - 0.5).map((t) => ({ text: t, sentiment: sentiment(t) })),
    skills: competencies(db).filter((k) => perSkill[k.code]).map((k) => ({ name: k.skill_name, code: k.code, peer_avg: round(perSkill[k.code].reduce((a, b) => a + b, 0) / perSkill[k.code].length) })),
    instructor_comments: notes.sort((a, b) => b.created_at.localeCompare(a.created_at)),
  };
}
route("GET", "/api/student/feedback/all", ({ db, user }) => {
  studentOnly(user);
  const e = db.enrollments.find((x) => x.user_id === user.id);
  return e ? allFeedback(db, user.id, msOf(db, e.project_id)) : null;
});
route("GET", "/api/student/profiles/:sid/feedback", ({ db, user, p }) => {
  studentOnly(user);
  publicProfiles(db);
  const t = db.users.find((u) => u.id === p.sid && u.role === "student" && u.is_active) ?? fail(404, "Student not found");
  const e = db.enrollments.find((x) => x.user_id === t.id);
  const info = { id: t.id, full_name: t.full_name, student_number: t.student_number, team: e ? teamName(db, e.team_id) : null };
  if (!e) return { student: info, feedback: null };
  log(db, user.id, "feedback.profile_viewed", "user", t.id);
  return { student: info, feedback: allFeedback(db, t.id, msOf(db, e.project_id)) };
});
route("GET", "/api/student/dashboard", ({ db, user, q }) => {
  studentOnly(user);
  let enrs = db.enrollments.filter((e) => e.user_id === user.id);
  const pid = q.get("project_id");
  if (pid) enrs = enrs.filter((e) => e.project_id === pid);
  if (!enrs.length) return { project: null, reports: [], milestones: [], latest: null, provisional: null, trend: [] };
  const enr = enrs[0];
  const p = db.projects.find((x) => x.id === enr.project_id)!;
  const reps = studentReports(db, user.id, p.id);
  const mss = msOf(db, p.id);
  const active = mss.find((m) => m.status === "active");
  let provisional = null;
  if (active && !reps.some((r) => r.milestone_id === active.id)) {
    const s = snapshot(db, user.id, active.id);
    provisional = { milestone: msOut(active), skills: s.skills.map((x) => ({ skill: x.name, self: x.self, peer_avg: x.peer })) };
  }
  return {
    project: { id: p.id, title: p.title }, latest: reps.length ? reportOut(db, reps[reps.length - 1]) : null,
    trend: reps.map((r) => {
      const m = db.milestones.find((x) => x.id === r.milestone_id)!;
      return { milestone: `M${m.number}`, name: m.name, self: r.overall_self, external: r.overall_external, gap: r.overall_gap, ...Object.fromEntries(r.metrics.map((d) => [db.competencies.find((c) => c.id === d.competency_id)!.code, d.external_avg])) };
    }),
    milestones: mss.map((m) => msStatus(db, user, enr, m)), provisional,
  };
});
route("GET", "/api/student/reports", ({ db, user, q }) => studentReports(db, user.id, q.get("project_id")).map((r) => reportOut(db, r)));
route("GET", "/api/student/reports/:mid", ({ db, user, p }) => reportOut(db, need(db.reports.find((r) => r.student_id === user.id && r.milestone_id === p.mid), "Report")));

export function passportCsv(db: DemoDB, user: any, pid?: string | null) {
  const reps = studentReports(db, user.id, pid);
  if (!reps.length) fail(404, "No Data Available");
  const rows = ["student,milestone,skill,self,peer_avg,instructor,external_weighted,delta,level"];
  for (const r of reps) {
    const m = db.milestones.find((x) => x.id === r.milestone_id)!;
    for (const d of r.metrics) rows.push([user.full_name, `M${m.number} ${m.name}`, db.competencies.find((c) => c.id === d.competency_id)!.skill_name, d.self_score, d.peer_avg, d.instructor_score, d.external_avg, d.gap_score, d.level].join(","));
  }
  return rows.join("\n");
}
route("GET", "/api/student/passport.pdf", ({ db, user, q }) => passportCsv(db, user, q.get("project_id")));
route("GET", "/api/student/passport.csv", ({ db, user, q }) => passportCsv(db, user, q.get("project_id")));

route("GET", "/api/student/artifacts", ({ db, user, q }) => db.artifacts.filter((a) => a.student_id === user.id && (!q.get("milestone_id") || a.milestone_id === q.get("milestone_id"))).sort((a, b) => b.created_at.localeCompare(a.created_at)));
route("POST", "/api/student/artifacts", ({ db, user, body }) => {
  const { m } = msForStudent(db, user, body.milestone_id);
  const due = m.due_date ? new Date(m.due_date) : null;
  let metrics: Record<string, unknown> = {};
  if (body.kind === "git_log") {
    const commits = parseGitLog(body.git_log ?? "");
    if (!commits.length) fail(422, 'No commits could be parsed. Use: git log --pretty=format:"%H|%an|%aI|%s"');
    metrics = commitIndicators(commits, due);
  } else if (body.kind === "submission") {
    const at = body.submitted_at ? new Date(body.submitted_at) : new Date();
    metrics = due ? { submitted_at: at.toISOString(), hours_before_due: round((due.getTime() - at.getTime()) / 3600000, 1), on_time: at <= due } : { submitted_at: at.toISOString() };
  }
  const a = { id: uid(), student_id: user.id, project_id: m.project_id, milestone_id: m.id, kind: body.kind, title: body.title, url: body.url ?? null, metrics, created_at: nowIso() };
  db.artifacts.push(a);
  return { id: a.id, metrics };
});
route("DELETE", "/api/student/artifacts/:id", ({ db, user, p }) => {
  const i = db.artifacts.findIndex((a) => a.id === p.id && a.student_id === user.id);
  if (i < 0) fail(404, "Artifact not found");
  db.artifacts.splice(i, 1);
  return { ok: true };
});

// ----------------------------------------------------------- chatbot --

function chatReply(db: DemoDB, user: any, msg: string) {
  const low = msg.toLowerCase();
  const ar = /[؀-ۿ]/.test(msg);
  const reps = db.reports.filter((r) => r.student_id === user.id).sort((a, b) => b.generated_at.localeCompare(a.generated_at));
  const rep = reps[0];
  if (!rep) return ar ? "لا يوجد تقرير مكتمل بعد. أكمل التقييم الذاتي وانتظر تقييمات زملائك والمدرّس ليتم إنشاء تقريرك." : "You don't have a completed 360° report yet. Submit your self-assessment and wait for your peers and instructor - your AI Growth Report will be generated automatically.";
  const name = (id: string) => db.competencies.find((c) => c.id === id)!.skill_name;
  const worst = rep.metrics.reduce((a, b) => (b.gap_score > a.gap_score ? b : a));
  const best = rep.metrics.reduce((a, b) => (b.external_avg > a.external_avg ? b : a));
  const steps = (rep.content.actionable_steps ?? []).slice(0, 3).map((s: string) => `• ${s}`).join("\n");
  if (["resource", "course", "learn", "مصادر", "دورة", "تعلم"].some((k) => low.includes(k)))
    return (ar ? "هذه مصادر مقترحة لك:\n" : "Here are resources matched to your gaps:\n") + ((rep.content.resources ?? []).map((r: any) => `• ${r.title} (${r.provider})`).join("\n") || "-");
  if (["how", "calculat", "formula", "delta", "كيف", "حساب", "المعادلة"].some((k) => low.includes(k)))
    return ar ? "الدرجة الخارجية = 60% تقييم المدرّس + 40% متوسط تقييم الزملاء. الفجوة Δ = |الخارجية − الذاتية|. إذا Δ ≤ 1.5 فأنت متوافق، بين 1.5 و2.0 فجوة متوسطة، وأكثر من 2.0 نقطة عمياء حرجة." : "External score = 60% instructor + 40% peer average. Delta = |external − self|. Delta ≤ 1.5 is aligned, 1.5–2.0 is a moderate gap and above 2.0 is a critical blind spot.";
  if (["strength", "good at", "best", "قوة", "أفضل"].some((k) => low.includes(k)))
    return ar ? `أقوى مهارة لديك حسب تقييم الآخرين هي ${name(best.competency_id)} (${best.external_avg.toFixed(1)}/5).` : `According to others, your strongest skill is ${name(best.competency_id)} (${best.external_avg.toFixed(1)}/5).`;
  return ar
    ? `أكبر فجوة لديك في مهارة ${name(worst.competency_id)}: قيّمت نفسك ${worst.self_score} بينما التقييم الخارجي ${worst.external_avg.toFixed(1)} (Δ=${worst.gap_score.toFixed(1)}).\nخطوات مقترحة:\n${steps}`
    : `Your largest perception gap is in ${name(worst.competency_id)}: you rated yourself ${worst.self_score} while others rated you ${worst.external_avg.toFixed(1)} (delta ${worst.gap_score.toFixed(1)}).\nSuggested next steps:\n${steps}`;
}
route("GET", "/api/chat", ({ db, user }) => db.chat.filter((c) => c.user_id === user.id));
const CHAT_SYSTEM = `You are EduSkills Coach, a friendly soft-skills mentor inside a university platform.
Answer the student's question using ONLY their data below and general, well-established soft-skills advice.
Never reveal peer identities. Keep answers under 180 words. Reply in the same language the student uses (Arabic or English).`;

function studentContext(db: DemoDB, user: any) {
  const rep = db.reports.filter((r) => r.student_id === user.id).sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0];
  if (!rep) return `Name: ${user.full_name}. No completed 360-degree report yet.`;
  const m = db.milestones.find((x) => x.id === rep.milestone_id)!;
  const lines = [`Name: ${user.full_name}. Latest report: M${m.number} (${m.name}).`];
  for (const d of rep.metrics) lines.push(`${db.competencies.find((c) => c.id === d.competency_id)!.skill_name}: self ${d.self_score}, external ${d.external_avg}, delta ${d.gap_score}, ${d.level}, ${d.direction}`);
  lines.push("Report headline: " + (rep.content.headline ?? ""));
  lines.push("Actionable steps: " + (rep.content.actionable_steps ?? []).join("; "));
  return lines.join("\n");
}

route("POST", "/api/chat", async ({ db, user, body }) => {
  const message = String(body.message ?? "");
  const cfg = aiConfig(db);
  let reply = "";
  let source = "fallback";
  let ai_error: string | null = null;
  if (cfg.usable) {
    try {
      const history = db.chat.filter((c) => c.user_id === user.id).slice(-8).map((c) => ({ role: c.role, content: c.content }));
      reply = (await chatCompletion(cfg, CHAT_SYSTEM + "\n\nStudent data:\n" + studentContext(db, user), [...history, { role: "user", content: message }], false, 500)).trim();
      source = "ai";
    } catch (e) {
      console.warn("Chat AI unavailable:", e);
      ai_error = (e as Error).name === "AbortError" ? "The AI service did not answer in time." : (e as Error).message;
    }
  }
  if (!reply) reply = chatReply(db, user, message);
  db.chat.push({ id: uid(), user_id: user.id, role: "user", content: body.message, created_at: nowIso() });
  const m = { id: uid(), user_id: user.id, role: "assistant", content: reply, created_at: nowIso(), source, model: source === "ai" ? activeModel(cfg) : null };
  db.chat.push(m);
  return { ...m, ai_error };
});
route("GET", "/api/chat/status", ({ db }) => {
  const cfg = aiConfig(db);
  return { mode: cfg.usable ? "genai" : "fallback", configured: !!cfg.key, model: cfg.model };
});
route("DELETE", "/api/chat", ({ db, user }) => {
  db.chat = db.chat.filter((c) => c.user_id !== user.id);
  return { ok: true };
});

// -------------------------------------------------------- instructor --

const instr = (u: any) => roleIs(u, "instructor", "admin");
const projFor = (db: DemoDB, user: any, pid: string | null) => {
  instr(user);
  const p = need(db.projects.find((x) => x.id === pid), "Project");
  ensureManage(user, p);
  return p;
};
function pickMs(db: DemoDB, p: any, mid: string | null) {
  const mss = msOf(db, p.id);
  if (mid) return need(mss.find((m) => m.id === mid), "Milestone");
  const started = mss.filter((m) => m.status !== "planned");
  return mss.find((m) => m.status === "active") ?? started[started.length - 1] ?? mss[0] ?? fail(404, "This project has no milestones yet");
}
const LABEL: Record<string, string> = { ALIGNED: "Aligned", MODERATE_GAP: "Moderate", CRITICAL_GAP: "Critical" };

function cohortRows(db: DemoDB, p: any, m: any) {
  const c = scoring(db);
  return studentsOf(db, p.id).map(({ u, e }) => {
    const s = snapshot(db, u.id, m.id, c);
    const rep = db.reports.find((r) => r.student_id === u.id && r.milestone_id === m.id);
    let gap: number | null, level: string | null, maxGap: number | null;
    if (rep) {
      gap = rep.overall_gap; level = rep.overall_level; maxGap = Math.max(...rep.metrics.map((d) => d.gap_score));
    } else {
      level = s.worst && s.hasInst ? overallLevel(s, c) : null;
      gap = level ? round(Math.abs((s.oExt ?? 0) - (s.oSelf ?? 0))) : null;
      maxGap = level ? s.worst!.gap : null;
    }
    const status = s.complete ? LABEL[level ?? ""] ?? "Processing" : s.hasSelf && s.peerComplete ? "Awaiting instructor" : "Incomplete";
    return {
      student_id: u.id, full_name: u.full_name, student_number: u.student_number, team: teamName(db, e.team_id), team_id: e.team_id,
      self_done: s.hasSelf, peer_count: s.peerCount, instructor_done: s.hasInst, self_avg: s.hasInst ? s.oSelf : null, peer_avg: s.oPeer,
      instructor_avg: s.oInst, external: s.hasInst ? s.oExt : null, gap, max_skill_gap: maxGap, level, status,
      ready_for_instructor: s.hasSelf && s.peerComplete && !s.hasInst, report_id: rep?.id ?? null,
    };
  });
}

route("GET", "/api/instructor/projects", ({ db, user }) => {
  instr(user);
  return db.projects.filter((p) => user.role === "admin" || p.instructor_id === user.id).map((p) => ({ id: p.id, title: p.title, is_active: p.is_active, milestones: msOf(db, p.id).map(msOut), student_count: studentsOf(db, p.id).length }));
});
route("GET", "/api/instructor/overview", ({ db, user, q }) => {
  const p = projFor(db, user, q.get("project_id"));
  const m = pickMs(db, p, q.get("milestone_id"));
  const rows = cohortRows(db, p, m);
  const flagged = db.evaluations.filter((e) => e.project_id === p.id && e.moderation_status === "pending").map((e) => ({ id: e.id, target: db.users.find((u) => u.id === e.target_id)!.full_name, target_id: e.target_id, milestone: `M${msNum(db, e.milestone_id)}`, comment: e.comment, reason: e.flag_reason, created_at: e.created_at }));
  const risk = [...new Set(rows.filter((r) => r.level === "CRITICAL_GAP" && r.team).map((r) => r.team as string))].sort();
  const open = db.interventions.filter((i) => i.project_id === p.id && i.status !== "resolved");
  return {
    project: { id: p.id, title: p.title }, milestone: msOut(m), milestones: msOf(db, p.id).map(msOut),
    stats: { total_students: rows.length, pending_reviews: rows.filter((r) => r.ready_for_instructor).length, at_risk_groups: risk.length, flagged_comments: flagged.length, completed: rows.filter((r) => r.instructor_done).length, open_interventions: open.length },
    at_risk_teams: risk, rows, flagged,
    interventions: open.map((i) => ({ id: i.id, student: db.users.find((u) => u.id === i.student_id)!.full_name, reason: i.reason, status: i.status, priority: i.priority, created_at: i.created_at })),
  };
});
route("GET", "/api/instructor/students/:sid", ({ db, user, p: params, q }) => {
  const p = projFor(db, user, q.get("project_id"));
  const m = pickMs(db, p, q.get("milestone_id"));
  const st = need(db.users.find((u) => u.id === params.sid), "Student");
  const enr = enrollmentOf(db, st.id, p.id) ?? fail(404, "Student is not enrolled in this project");
  const c = scoring(db);
  const s = snapshot(db, st.id, m.id, c);
  const inst = db.evaluations.find((e) => e.milestone_id === m.id && e.target_id === st.id && e.eval_type === "instructor");
  const peers = db.evaluations.filter((e) => e.milestone_id === m.id && e.target_id === st.id && e.eval_type === "peer");
  const arts = db.artifacts.filter((a) => a.student_id === st.id && a.milestone_id === m.id);
  const rep = db.reports.find((r) => r.student_id === st.id && r.milestone_id === m.id);
  const reveal = !!inst;
  return {
    student: { id: st.id, full_name: st.full_name, email: st.email, student_number: st.student_number, level: st.level }, team: teamName(db, enr.team_id),
    milestone: msOut(m), milestones: msOf(db, p.id).map(msOut), competencies: competencies(db).map(compOut),
    status: { self_done: s.hasSelf, peer_count: s.peerCount, min_peers: c.minPeers, instructor_done: s.hasInst },
    skills: s.skills.map((x) => ({ competency_id: x.competency_id, code: x.code, name: x.name, peer_avg: x.peer, self: reveal ? x.self : null, instructor: x.inst, external: reveal ? x.ext : null, gap: reveal ? x.gap : null, level: reveal ? x.level : null })),
    self_evidence: reveal ? s.selfEvidence : null,
    peer_comments: peers.map((e) => ({ id: e.id, text: e.comment, moderation: e.moderation_status, flag_reason: e.flag_reason, sentiment: e.sentiment })),
    artifacts: arts, artifact_summary: summarizeArtifacts(arts.map((a) => a.metrics)),
    instructor_evaluation: inst ? { ratings: inst.ratings, notes: inst.notes ?? "", created_at: inst.created_at, is_locked: inst.is_locked } : null,
    report: rep ? reportOut(db, rep) : null,
    history: studentReports(db, st.id, p.id).map((r) => ({ milestone: `M${msNum(db, r.milestone_id)}`, self: r.overall_self, external: r.overall_external, gap: r.overall_gap, level: r.overall_level })),
    warning_threshold: c.warn,
  };
});
route("POST", "/api/instructor/evaluations", async ({ db, user, body }) => {
  const m = need(db.milestones.find((x) => x.id === body.milestone_id), "Milestone");
  const p = projFor(db, user, m.project_id);
  if (m.status === "planned") fail(409, "This milestone has not started yet");
  if (!studentsOf(db, p.id).some((x) => x.u.id === body.target_id)) fail(404, "Student is not enrolled in this project");
  const c = scoring(db);
  const s = snapshot(db, body.target_id, m.id, c);
  if (!s.hasSelf) fail(409, "Precondition failed: the student has not submitted the self-assessment (UC-01)");
  if (!s.peerComplete) fail(409, `Precondition failed: at least ${c.minPeers} peer evaluations are required (UC-02)`);
  const ex = db.evaluations.find((e) => e.milestone_id === m.id && e.target_id === body.target_id && e.eval_type === "instructor");
  if (ex?.is_locked) fail(409, "The evaluation for this student is locked. An administrator can unlock it.");
  const ratings = validateRatings(db, body.ratings);
  const warnings = s.skills.filter((x) => x.peer != null && Math.abs(ratings[x.competency_id] - x.peer) > c.warn).map((x) => `${x.name}: your score ${ratings[x.competency_id]} vs peer average ${x.peer!.toFixed(1)}`);
  if (warnings.length && !body.acknowledge_warnings) return { saved: false, requires_confirmation: true, warnings };
  if (ex) db.evaluations.splice(db.evaluations.indexOf(ex), 1);
  const ev: Ev = { id: uid(), project_id: m.project_id, milestone_id: m.id, evaluator_id: user.id, target_id: body.target_id, eval_type: "instructor", reviewer_key: "instructor", comment: null, evidence_link: null, notes: (body.notes ?? "").trim(), sentiment: null, is_flagged: false, flag_reason: null, moderation_status: "none", is_locked: true, created_at: nowIso(), ratings };
  db.evaluations.push(ev);
  log(db, user.id, "evaluation.instructor_submitted", "evaluation", ev.id, `milestone=M${m.number} warnings=${warnings.length}`);
  await generateReport(db, body.target_id, m.id, true);
  return { saved: true, warnings, external: snapshot(db, body.target_id, m.id, c).oExt, id: ev.id };
});
route("POST", "/api/instructor/moderation/:id", async ({ db, user, p, body }) => {
  const ev = need(db.evaluations.find((e) => e.id === p.id), "Evaluation");
  projFor(db, user, ev.project_id);
  if (body.action === "approve") ev.moderation_status = "approved";
  else { ev.moderation_status = "removed"; ev.comment = "[Removed by moderator]"; }
  log(db, user.id, `moderation.${body.action}`, "evaluation", ev.id, ev.flag_reason ?? "");
  await generateReport(db, ev.target_id, ev.milestone_id, true);
  return { ok: true, status: ev.moderation_status };
});
route("POST", "/api/instructor/interventions", ({ db, user, body }) => {
  const st = need(db.users.find((u) => u.id === body.student_id), "Student");
  const pid = body.milestone_id ? need(db.milestones.find((m) => m.id === body.milestone_id), "Milestone").project_id : db.enrollments.find((e) => e.user_id === st.id)?.project_id;
  projFor(db, user, pid ?? null);
  if (String(body.reason ?? "").length < 5) fail(422, "Please describe the reason");
  const i = { id: uid(), student_id: st.id, project_id: pid, milestone_id: body.milestone_id ?? null, raised_by_id: user.id, priority: body.priority ?? "high", reason: body.reason, status: "open", advisor_notes: null, created_at: nowIso(), updated_at: nowIso() };
  db.interventions.push(i);
  db.users.filter((u) => u.role === "advisor").forEach((u) => notify(db, u.id, `Intervention requested: ${st.full_name}`, body.reason, "alert", "/advisor"));
  log(db, user.id, "intervention.raised", "intervention", i.id, body.reason);
  return { id: i.id };
});
route("POST", "/api/instructor/reports/:sid/:mid/regenerate", async ({ db, user, p }) => {
  const m = need(db.milestones.find((x) => x.id === p.mid), "Milestone");
  projFor(db, user, m.project_id);
  const rep = (await generateReport(db, p.sid, p.mid, true)) ?? fail(409, "The 360° evaluation is not complete for this student yet");
  return reportOut(db, rep);
});
route("GET", "/api/instructor/cohort-report", ({ db, user, q }) => {
  const p = projFor(db, user, q.get("project_id"));
  const comps = competencies(db);
  const milestones = msOf(db, p.id).map((m) => {
    const reps = db.reports.filter((r) => r.milestone_id === m.id);
    if (!reps.length) return null;
    const skills = Object.fromEntries(comps.map((c) => {
      const ds = reps.flatMap((r) => r.metrics.filter((d) => d.competency_id === c.id));
      return [c.code, { name: c.skill_name, self: round(mean(ds.map((d) => d.self_score))), external: round(mean(ds.map((d) => d.external_avg))), gap: round(mean(ds.map((d) => d.gap_score))), blind_spots: ds.filter((d) => d.level !== "ALIGNED").length }];
    }));
    return { milestone: `M${m.number}`, name: m.name, reports: reps.length, avg_self: round(mean(reps.map((r) => r.overall_self))), avg_external: round(mean(reps.map((r) => r.overall_external))), avg_gap: round(mean(reps.map((r) => r.overall_gap))), levels: Object.fromEntries(Object.keys(LABEL).map((l) => [l, reps.filter((r) => r.overall_level === l).length])), skills };
  }).filter(Boolean);
  const teams = db.teams.filter((t) => t.project_id === p.id).map((t) => {
    const members = db.enrollments.filter((e) => e.team_id === t.id).map((e) => e.user_id);
    const latest = members.map((id) => studentReports(db, id, p.id).slice(-1)[0]).filter(Boolean);
    return { team: t.team_name, members: members.length, avg_external: latest.length ? round(mean(latest.map((r) => r.overall_external))) : null, critical: latest.filter((r) => r.overall_level === "CRITICAL_GAP").length, moderate: latest.filter((r) => r.overall_level === "MODERATE_GAP").length };
  });
  return { project: { id: p.id, title: p.title }, milestones, teams, competencies: comps.map(compOut) };
});
route("GET", "/api/instructor/evaluations", ({ db, user, q }) => {
  const p = projFor(db, user, q.get("project_id"));
  const comps = Object.fromEntries(db.competencies.map((c) => [c.id, c.skill_name]));
  return db.evaluations.filter((e) => e.project_id === p.id && (!q.get("milestone_id") || e.milestone_id === q.get("milestone_id")) && (!q.get("student_id") || e.target_id === q.get("student_id")) && (!q.get("eval_type") || e.eval_type === q.get("eval_type")))
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 500)
    .map((e) => ({ id: e.id, milestone: `M${msNum(db, e.milestone_id)}`, student: db.users.find((u) => u.id === e.target_id)!.full_name, eval_type: e.eval_type, evaluator: e.eval_type === "peer" ? "Anonymous" : e.eval_type === "self" ? "Self" : "Instructor", average: round(mean(Object.values(e.ratings))), ratings: Object.fromEntries(Object.entries(e.ratings).map(([k, v]) => [comps[k], v])), moderation: e.moderation_status, is_locked: e.is_locked, created_at: e.created_at }));
});
export function cohortCsv(db: DemoDB, user: any, q: URLSearchParams) {
  const p = projFor(db, user, q.get("project_id"));
  const m = pickMs(db, p, q.get("milestone_id"));
  const rows = ["student,student_number,team,self_done,peer_count,instructor_done,self_avg,peer_avg,instructor_avg,external,gap,status"];
  for (const r of cohortRows(db, p, m)) rows.push([r.full_name, r.student_number, r.team, r.self_done, r.peer_count, r.instructor_done, r.self_avg ?? "", r.peer_avg ?? "", r.instructor_avg ?? "", r.external ?? "", r.gap ?? "", r.status].join(","));
  return rows.join("\n");
}
route("GET", "/api/instructor/export.csv", ({ db, user, q }) => cohortCsv(db, user, q));

// ------------------------------------------------------------ projects --

function projectOut(db: DemoDB, p: any) {
  const members = studentsOf(db, p.id);
  const ins = db.users.find((u) => u.id === p.instructor_id);
  return {
    id: p.id, title: p.title, description: p.description, is_active: p.is_active, instructor: ins ? { id: ins.id, full_name: ins.full_name } : null,
    milestones: msOf(db, p.id).map(msOut),
    teams: db.teams.filter((t) => t.project_id === p.id).map((t) => ({ id: t.id, team_name: t.team_name, members: members.filter((x) => x.e.team_id === t.id).map((x) => ({ id: x.u.id, full_name: x.u.full_name, student_number: x.u.student_number })) })),
    unassigned: members.filter((x) => !x.e.team_id).map((x) => ({ id: x.u.id, full_name: x.u.full_name })),
  };
}
route("GET", "/api/projects", ({ db, user }) => (instr(user), db.projects.filter((p) => canManage(user, p)).map((p) => projectOut(db, p))));
route("GET", "/api/projects/directory/students", ({ db, user, q }) => {
  instr(user);
  const s = (q.get("q") ?? "").toLowerCase();
  return db.users.filter((u) => u.role === "student" && u.is_active && (!s || `${u.full_name} ${u.email} ${u.student_number}`.toLowerCase().includes(s))).map(userOut);
});
route("GET", "/api/projects/:id", ({ db, user, p }) => projectOut(db, projFor(db, user, p.id)));
route("POST", "/api/projects", ({ db, user, body }) => {
  instr(user);
  const p = { id: uid(), title: body.title, description: body.description, instructor_id: user.role === "admin" && body.instructor_id ? body.instructor_id : user.id, is_active: body.is_active ?? true, created_at: nowIso() };
  db.projects.push(p);
  ["Requirements", "Design", "Implementation"].forEach((n, i) => db.milestones.push({ id: uid(), project_id: p.id, number: i + 1, name: n, description: null, due_date: null, status: "planned" }));
  log(db, user.id, "project.created", "project", p.id, p.title);
  return projectOut(db, p);
});
route("PUT", "/api/projects/:id", ({ db, user, p: params, body }) => {
  const p = projFor(db, user, params.id);
  Object.assign(p, { title: body.title, description: body.description, is_active: body.is_active });
  if (user.role === "admin" && body.instructor_id) p.instructor_id = body.instructor_id;
  return projectOut(db, p);
});
route("DELETE", "/api/projects/:id", ({ db, user, p: params }) => {
  const p = projFor(db, user, params.id);
  db.projects = db.projects.filter((x) => x !== p);
  db.milestones = db.milestones.filter((m) => m.project_id !== p.id);
  db.teams = db.teams.filter((t) => t.project_id !== p.id);
  db.enrollments = db.enrollments.filter((e) => e.project_id !== p.id);
  db.evaluations = db.evaluations.filter((e) => e.project_id !== p.id);
  db.reports = db.reports.filter((r) => r.project_id !== p.id);
  log(db, user.id, "project.deleted", "project", p.id, p.title);
  return { ok: true };
});
route("POST", "/api/projects/:id/milestones", ({ db, user, p: params, body }) => {
  const p = projFor(db, user, params.id);
  if (msOf(db, p.id).some((m) => m.number === body.number)) fail(409, `Milestone M${body.number} already exists`);
  const m = { id: uid(), project_id: p.id, number: body.number, name: body.name, description: body.description ?? null, due_date: body.due_date ?? null, status: body.status ?? "planned" };
  db.milestones.push(m);
  return msOut(m);
});
route("PUT", "/api/projects/milestones/:id", ({ db, user, p: params, body }) => {
  const m = need(db.milestones.find((x) => x.id === params.id), "Milestone");
  const p = projFor(db, user, m.project_id);
  const opened = body.status === "active" && m.status !== "active";
  Object.assign(m, { number: body.number, name: body.name, description: body.description, due_date: body.due_date, status: body.status });
  if (opened) studentsOf(db, p.id).forEach(({ u }) => notify(db, u.id, `Evaluation period open: M${m.number} ${m.name}`, "Submit your self-assessment and evaluate your teammates.", "milestone", "/student/self-assessment"));
  log(db, user.id, "milestone.updated", "milestone", m.id, `status=${m.status}`);
  return msOut(m);
});
route("DELETE", "/api/projects/milestones/:id", ({ db, user, p: params }) => {
  const m = need(db.milestones.find((x) => x.id === params.id), "Milestone");
  projFor(db, user, m.project_id);
  db.milestones = db.milestones.filter((x) => x !== m);
  db.evaluations = db.evaluations.filter((e) => e.milestone_id !== m.id);
  db.reports = db.reports.filter((r) => r.milestone_id !== m.id);
  return { ok: true };
});
route("POST", "/api/projects/:id/teams", ({ db, user, p: params, body }) => {
  const p = projFor(db, user, params.id);
  const t = { id: uid(), project_id: p.id, team_name: body.team_name };
  db.teams.push(t);
  return t;
});
route("PUT", "/api/projects/teams/:id", ({ db, user, p: params, body }) => {
  const t = need(db.teams.find((x) => x.id === params.id), "Team");
  projFor(db, user, t.project_id);
  t.team_name = body.team_name;
  return t;
});
route("DELETE", "/api/projects/teams/:id", ({ db, user, p: params }) => {
  const t = need(db.teams.find((x) => x.id === params.id), "Team");
  projFor(db, user, t.project_id);
  db.teams = db.teams.filter((x) => x !== t);
  db.enrollments.filter((e) => e.team_id === t.id).forEach((e) => (e.team_id = null));
  return { ok: true };
});
route("POST", "/api/projects/:id/enrollments", ({ db, user, p: params, body }) => {
  const p = projFor(db, user, params.id);
  const st = need(db.users.find((u) => u.id === body.user_id), "User");
  if (st.role !== "student") fail(400, "Only students can be enrolled in a project");
  const e = enrollmentOf(db, st.id, p.id);
  if (e) e.team_id = body.team_id ?? null;
  else db.enrollments.push({ id: uid(), user_id: st.id, project_id: p.id, team_id: body.team_id ?? null });
  return { ok: true };
});
route("DELETE", "/api/projects/:id/enrollments/:uid", ({ db, user, p: params }) => {
  const p = projFor(db, user, params.id);
  db.enrollments = db.enrollments.filter((e) => !(e.project_id === p.id && e.user_id === params.uid));
  return { ok: true };
});

// ------------------------------------------------------------- advisor --

function intOut(db: DemoDB, i: any) {
  const st = db.users.find((u) => u.id === i.student_id)!;
  const latest = studentReports(db, st.id).slice(-1)[0];
  const ms = db.milestones.find((m) => m.id === i.milestone_id);
  return {
    id: i.id, student: { id: st.id, full_name: st.full_name, email: st.email, student_number: st.student_number },
    project: db.projects.find((p) => p.id === i.project_id)?.title, milestone: ms ? `M${ms.number}` : null,
    raised_by: db.users.find((u) => u.id === i.raised_by_id)?.full_name ?? "System (Analytics Engine)", priority: i.priority, reason: i.reason,
    status: i.status, advisor_notes: i.advisor_notes, created_at: i.created_at, updated_at: i.updated_at,
    latest_report: latest ? { milestone: `M${msNum(db, latest.milestone_id)}`, headline: latest.content.headline, overall_self: latest.overall_self, overall_external: latest.overall_external, level: latest.overall_level, skills: latest.metrics.map((d) => ({ skill: db.competencies.find((c) => c.id === d.competency_id)!.skill_name, self: d.self_score, external: d.external_avg, gap: d.gap_score, level: d.level })) } : null,
  };
}
route("GET", "/api/advisor/interventions", ({ db, user, q }) => {
  roleIs(user, "advisor", "admin");
  return db.interventions.filter((i) => !q.get("status") || i.status === q.get("status")).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((i) => intOut(db, i));
});
route("PUT", "/api/advisor/interventions/:id", ({ db, user, p, body }) => {
  roleIs(user, "advisor", "admin");
  const i = need(db.interventions.find((x) => x.id === p.id), "Intervention");
  i.status = body.status;
  if (body.advisor_notes != null) i.advisor_notes = body.advisor_notes;
  i.updated_at = nowIso();
  if (i.raised_by_id) notify(db, i.raised_by_id, `Intervention ${body.status}: ${db.users.find((u) => u.id === i.student_id)!.full_name}`, body.advisor_notes ?? "", "alert", "/instructor");
  log(db, user.id, `intervention.${body.status}`, "intervention", i.id);
  return intOut(db, i);
});

// --------------------------------------------------------------- admin --

const admin = (u: any) => roleIs(u, "admin");
const publicSettings = (db: DemoDB) => {
  const o = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, setting(db, k)]));
  const key = setting(db, "ai_api_key");
  o.ai_api_key = key ? "••••••••" + key.slice(-4) : "";
  return o;
};
route("GET", "/api/admin/users", ({ db, user, q }) => {
  admin(user);
  const s = (q.get("q") ?? "").toLowerCase();
  return db.users.filter((u) => (!q.get("role") || u.role === q.get("role")) && (!s || `${u.full_name} ${u.email} ${u.student_number ?? ""}`.toLowerCase().includes(s))).sort((a, b) => a.role.localeCompare(b.role) || a.full_name.localeCompare(b.full_name)).map(userOut);
});
route("POST", "/api/admin/users", ({ db, user, body }) => {
  admin(user);
  const email = String(body.email).toLowerCase();
  if (db.users.some((u) => u.email === email)) fail(409, "A user with this email already exists");
  if (!body.password) fail(422, "A password is required for new users");
  const u = { id: uid(), full_name: body.full_name, email, role: body.role, student_number: body.student_number, level: body.level, mobile: body.mobile, department: body.department, is_active: body.is_active ?? true, created_at: nowIso(), last_login_at: null, password: body.password };
  db.users.push(u);
  log(db, user.id, "user.created", "user", u.id, `${email} (${u.role})`);
  return userOut(u);
});
route("PUT", "/api/admin/users/:id", ({ db, user, p, body }) => {
  admin(user);
  const u = need(db.users.find((x) => x.id === p.id), "User");
  if (u.id === user.id && (body.role !== "admin" || !body.is_active)) fail(400, "You cannot remove your own administrator access");
  for (const k of ["full_name", "role", "student_number", "level", "mobile", "department", "is_active"]) u[k] = body[k];
  u.email = String(body.email).toLowerCase();
  if (body.password) u.password = body.password;
  log(db, user.id, "user.updated", "user", u.id, u.email);
  return userOut(u);
});
route("DELETE", "/api/admin/users/:id", ({ db, user, p }) => {
  admin(user);
  const u = need(db.users.find((x) => x.id === p.id), "User");
  if (u.id === user.id) fail(400, "You cannot deactivate your own account");
  u.is_active = false;
  log(db, user.id, "user.deactivated", "user", u.id, u.email);
  return { ok: true };
});
route("GET", "/api/admin/settings", ({ db, user }) => (admin(user), publicSettings(db)));
route("PUT", "/api/admin/settings", ({ db, user, body }) => {
  admin(user);
  const v = body.values as Record<string, string>;
  const get = (k: string) => Number(v[k] ?? setting(db, k));
  if (Math.abs(get("instructor_weight") + get("peer_weight") - 1) > 1e-6) fail(422, "Instructor and peer weights must add up to 1.0");
  if (get("critical_threshold") < get("moderate_threshold")) fail(422, "The critical threshold must be greater than the moderate threshold");
  if (v.ai_base_url && !/^https?:\/\//.test(v.ai_base_url)) fail(422, "The API base URL must start with https:// - did you paste the API key in the wrong field?");
  for (const [k, val] of Object.entries(v)) {
    if (!(k in DEFAULTS)) fail(422, `Unknown setting: ${k}`);
    if (k === "ai_api_key" && (!val || val.startsWith("•"))) continue;
    db.settings[k] = val;
  }
  log(db, user.id, "settings.updated", "system_settings", null, Object.keys(v).filter((k) => k !== "ai_api_key").join(", "));
  return publicSettings(db);
});
route("POST", "/api/admin/settings/clear-api-key", ({ db, user }) => (admin(user), (db.settings.ai_api_key = ""), publicSettings(db)));
route("POST", "/api/admin/ai/test", async ({ db, user }) => {
  admin(user);
  const cfg = aiConfig(db);
  if (!cfg.key) return { ok: false, mode: "fallback", message: "No API key configured - the local fallback engine is active." };
  if (!cfg.usable) return { ok: false, mode: "fallback", message: "AI generation is disabled - the local fallback engine is active." };
  try {
    const out = await chatCompletion(cfg, "You are a connection test.", [{ role: "user", content: "Reply with the single word: OK" }], false, 16);
    log(db, user.id, "ai.connection_test", "system", null, "ok=true");
    return { ok: true, mode: "genai", message: `Connected to ${activeModel(cfg)}: ${out.trim().slice(0, 40)}` };
  } catch (e) {
    return { ok: false, mode: "fallback", message: `Connection failed: ${(e as Error).message}` };
  }
});
route("PUT", "/api/admin/competencies/:id", ({ db, user, p, body }) => {
  admin(user);
  const c = need(db.competencies.find((x) => x.id === p.id), "Competency");
  Object.assign(c, { skill_name: body.skill_name, description: body.description, rubric: body.rubric });
  log(db, user.id, "rubric.updated", "competency", c.id, c.code);
  return compOut(c);
});
const resOut = (db: DemoDB, r: any) => ({ ...r, skill: db.competencies.find((c) => c.id === r.competency_id)?.skill_name });
route("GET", "/api/admin/resources", ({ db, user }) => (admin(user), db.resources.map((r) => resOut(db, r))));
route("POST", "/api/admin/resources", ({ db, user, body }) => {
  admin(user);
  const r = { id: uid(), competency_id: body.competency_id, title: body.title, provider: body.provider ?? "", url: body.url, kind: body.kind ?? "article", duration: body.duration ?? "" };
  db.resources.push(r);
  return resOut(db, r);
});
route("DELETE", "/api/admin/resources/:id", ({ db, user, p }) => (admin(user), (db.resources = db.resources.filter((r) => r.id !== p.id)), { ok: true }));
route("POST", "/api/admin/evaluations/:id/unlock", ({ db, user, p }) => {
  admin(user);
  const e = need(db.evaluations.find((x) => x.id === p.id), "Evaluation");
  if (e.eval_type === "peer") fail(400, "Anonymous peer evaluations cannot be edited; delete them instead");
  e.is_locked = false;
  log(db, user.id, "evaluation.unlocked", "evaluation", e.id, e.eval_type);
  return { ok: true };
});
route("DELETE", "/api/admin/evaluations/:id", ({ db, user, p }) => {
  admin(user);
  db.evaluations = db.evaluations.filter((e) => e.id !== p.id);
  log(db, user.id, "evaluation.deleted", "evaluation", p.id);
  return { ok: true };
});
const started = Date.now();
route("GET", "/api/admin/health", ({ db, user }) => {
  admin(user);
  const reports = db.reports.length, ai = db.reports.filter((r) => r.source === "ai").length;
  const last = db.backups[db.backups.length - 1];
  return {
    status: "ok", uptime_seconds: Math.round((Date.now() - started) / 1000), database: { ok: true, latency_ms: 0.1 },
    ai: { configured: !!aiConfig(db).key, enabled: setting(db, "ai_enabled") === "true", model: setting(db, "ai_model"), mode: aiConfig(db).usable ? "genai" : "fallback" },
    counts: { users: db.users.length, active_users: db.users.filter((u) => u.is_active).length, projects: db.projects.length, evaluations: db.evaluations.length, reports, reports_ai: ai, reports_fallback: reports - ai, flagged_pending: db.evaluations.filter((e) => e.moderation_status === "pending").length },
    last_backup: last ? { created_at: last.created_at, verified: last.verified, filename: last.filename } : null,
  };
});
route("GET", "/api/admin/backups", ({ db, user }) => (admin(user), [...db.backups].reverse()));
route("POST", "/api/admin/backups", ({ db, user }) => {
  admin(user);
  const snap = JSON.stringify({ ...db, backups: [] });
  const ok = JSON.parse(snap).users.length === db.users.length;
  const b = { id: uid(), filename: `eduskills-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}.json`, size_bytes: snap.length, checksum: sha256(snap), verified: ok, details: `${db.users.length} users, ${db.evaluations.length} evaluations, ${db.reports.length} reports re-read successfully`, created_at: nowIso() };
  db.backups.push(b);
  log(db, user.id, "backup.created", "backup", b.id, `verified=${ok}`);
  return b;
});
route("POST", "/api/admin/retention/purge", ({ db, user }) => {
  admin(user);
  const days = Number(setting(db, "retention_days"));
  const cut = new Date(Date.now() - days * 86400000).toISOString();
  const count = (k: "chat" | "notifications" | "audit") => {
    const before = db[k].length;
    db[k] = db[k].filter((r) => r.created_at >= cut);
    return before - db[k].length;
  };
  const deleted = { chat_messages: count("chat"), notifications: count("notifications"), audit_logs: count("audit"), cutoff: cut };
  log(db, user.id, "retention.purged", "system", null, JSON.stringify(deleted));
  return { retention_days: days, deleted };
});
route("GET", "/api/admin/audit-logs", ({ db, user, q }) => {
  admin(user);
  const a = (q.get("action") ?? "").toLowerCase();
  return db.audit.filter((l) => !a || l.action.toLowerCase().includes(a)).sort((x, y) => y.created_at.localeCompare(x.created_at)).slice(0, 200).map((l) => ({ ...l, actor: db.users.find((u) => u.id === l.actor_id)?.full_name ?? "System" }));
});
route("GET", "/api/admin/usage", ({ db, user, q }) => {
  admin(user);
  const days = Number(q.get("days") ?? 30);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const logs = db.audit.filter((l) => l.created_at >= since);
  const perDay: Record<string, number> = {}, perAction: Record<string, number> = {};
  logs.forEach((l) => { perDay[l.created_at.slice(0, 10)] = (perDay[l.created_at.slice(0, 10)] ?? 0) + 1; perAction[l.action] = (perAction[l.action] ?? 0) + 1; });
  return {
    days, active_users: new Set(logs.filter((l) => l.action === "auth.login").map((l) => l.actor_id)).size,
    per_day: Object.entries(perDay).sort().map(([date, events]) => ({ date, events })),
    per_action: Object.entries(perAction).map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count),
  };
});

// ------------------------------------------------------------- dispatcher --

export async function handle(method: string, url: string, token: string | null, body: unknown): Promise<{ status: number; data: unknown }> {
  const u = new URL(url, "http://demo.local");
  const db = getDB();
  try {
    for (const [m, re, keys, h, auth] of routes) {
      if (m !== method) continue;
      const match = u.pathname.match(re);
      if (!match) continue;
      const user = token ? db.users.find((x) => x.id === token && x.is_active) : null;
      if (auth && !user) fail(401, "Not authenticated");
      const p = Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
      const data = await h({ db, user, p, q: u.searchParams, body: body ?? {} });
      if (method !== "GET") saveDB();
      return { status: 200, data };
    }
    return { status: 404, data: { detail: "Not found" } };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, data: { detail: e.message } };
    console.error(e);
    return { status: 500, data: { detail: (e as Error).message } };
  }
}

