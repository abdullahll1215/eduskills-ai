// In-browser database for the demo build. Seeded from a snapshot of the real backend's demo cohort
// and kept in the viewer's localStorage (falls back to memory when storage is unavailable).
import seed from "./seed.json";

export interface Ev {
  id: string; project_id: string; milestone_id: string; evaluator_id: string | null; target_id: string; eval_type: string;
  reviewer_key: string; comment: string | null; evidence_link: string | null; notes: string | null; sentiment: number | null;
  is_flagged: boolean; flag_reason: string | null; moderation_status: string; is_locked: boolean; created_at: string;
  ratings: Record<string, number>;
}
export interface Metric { competency_id: string; self_score: number; peer_avg: number; instructor_score: number; external_avg: number; gap_score: number; direction: string; level: string }
export interface Rep {
  id: string; student_id: string; project_id: string; milestone_id: string; narrative: string; content: any; source: string;
  overall_self: number; overall_external: number; overall_gap: number; overall_level: string; generated_at: string; metrics: Metric[];
}
type Row = Record<string, any>;
export interface DemoDB {
  users: Row[]; projects: Row[]; milestones: Row[]; teams: Row[]; enrollments: Row[]; competencies: Row[];
  evaluations: Ev[]; reports: Rep[]; resources: Row[]; artifacts: Row[]; work_projects: Row[]; work_project_members: Row[]; personal_assessments: Row[]; notifications: Row[]; interventions: Row[];
  audit: Row[]; chat: Row[]; settings: Record<string, string>; backups: Row[];
}

const KEY = "eduskills.demo.db.v1";
let cache: DemoDB | null = null;

export function getDB(): DemoDB {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Ignore saved data from an older or broken version of the demo.
      if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.chat) && Array.isArray(parsed.evaluations)) cache = parsed;
    }
  } catch {
    /* storage unavailable */
  }
  cache ??= structuredClone(seed) as unknown as DemoDB;
  groupOrphanArtifacts(cache);
  return cache;
}

/** The student's project named after their course project; created on first use (mirrors the backend). */
export function defaultWorkProject(db: DemoDB, studentId: string, projectId: string): Row {
  const course = db.projects.find((p) => p.id === projectId);
  const name = course?.title ?? "My project";
  let wp = db.work_projects.find((w) => w.student_id === studentId && w.name === name);
  if (!wp) {
    const stages = Math.max(1, db.milestones.filter((m) => m.project_id === projectId).length);
    wp = { id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36), student_id: studentId, name, description: course?.description ?? null, url: null, stages, created_at: course?.created_at ?? new Date().toISOString() };
    db.work_projects.push(wp);
  }
  return wp;
}

/** A random unused 6-digit course number (mirrors the backend's new_course_number). */
export function newCourseNumber(db: DemoDB): string {
  for (;;) {
    const number = String(100000 + Math.floor(Math.random() * 900000));
    if (!db.projects.some((p) => p.join_code === number)) return number;
  }
}

// Codes match ignoring case, spaces and dashes (mirrors services/common.py).
export const normaliseCode = (c: unknown) => String(c ?? "").toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
export const findTeamByCode = (db: DemoDB, code: unknown) => {
  const wanted = normaliseCode(code);
  return wanted ? db.teams.find((x) => normaliseCode(x.invite_code) === wanted) : undefined;
};
/** Readable invite code: course number + team name, e.g. 1234-ALPHA. */
export function teamCode(db: DemoDB, courseNumber: string, teamName: string): string {
  const base = `${courseNumber}-${normaliseCode(teamName).slice(0, 40) || "TEAM"}`;
  let code = base;
  for (let n = 2; findTeamByCode(db, code); n++) code = `${base}${n}`;
  return code;
}

function ensureCodes(db: DemoDB) {
  for (const p of db.projects) p.join_code ??= newCourseNumber(db);
  for (const t of db.teams) t.invite_code ??= teamCode(db, db.projects.find((p) => p.id === t.project_id)?.join_code ?? "TEAM", t.team_name);
}

function groupOrphanArtifacts(db: DemoDB) {
  ensureCodes(db);
  db.work_projects ??= [];
  db.work_project_members ??= [];
  db.personal_assessments ??= [];
  for (const a of db.artifacts) {
    if (!a.work_project_id) a.work_project_id = defaultWorkProject(db, a.student_id, a.project_id).id;
    // Files from before stages existed go to the stage matching their milestone number.
    if (a.stage == null) {
      const wp = db.work_projects.find((w) => w.id === a.work_project_id);
      const m = db.milestones.find((x) => x.id === a.milestone_id);
      a.stage = Math.min(m?.number ?? 1, wp?.stages ?? 1);
    }
  }
}

export function saveDB() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* keep in memory only */
  }
}

export function resetDB() {
  cache = structuredClone(seed) as unknown as DemoDB;
  groupOrphanArtifacts(cache);
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
