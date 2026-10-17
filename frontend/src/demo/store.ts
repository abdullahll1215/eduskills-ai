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
  evaluations: Ev[]; reports: Rep[]; resources: Row[]; artifacts: Row[]; notifications: Row[]; interventions: Row[];
  audit: Row[]; chat: Row[]; settings: Record<string, string>; backups: Row[];
}

const KEY = "eduskills.demo.db.v1";
let cache: DemoDB | null = null;

export function getDB(): DemoDB {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) cache = JSON.parse(raw);
  } catch {
    /* storage unavailable */
  }
  cache ??= structuredClone(seed) as unknown as DemoDB;
  return cache;
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
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
