export type Role = "student" | "instructor" | "advisor" | "admin";

export interface User {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  student_number?: string | null;
  level?: string | null;
  mobile?: string | null;
  department?: string | null;
  is_active: boolean;
  created_at?: string;
  last_login_at?: string | null;
}

export interface Competency {
  id: string;
  code: string;
  skill_name: string;
  description: string;
  rubric: Record<string, string>;
}

export interface Milestone {
  id: string;
  project_id: string;
  number: number;
  name: string;
  description?: string | null;
  due_date?: string | null;
  status: "planned" | "active" | "closed";
}

export interface MilestoneStatus extends Milestone {
  self_done: boolean;
  peers_given: number;
  peers_total: number;
  peers_received: number;
  min_peers: number;
  instructor_done: boolean;
  report_id: string | null;
  progress: number;
}

export interface StudentProject {
  id: string;
  title: string;
  description?: string;
  instructor?: string | null;
  team: { id: string; name: string } | null;
  teammates: { id: string; full_name: string }[];
  milestones: MilestoneStatus[];
}

export type Level = "ALIGNED" | "MODERATE_GAP" | "CRITICAL_GAP";

export interface Metric {
  competency_id: string;
  code: string;
  skill: string;
  self: number;
  peer_avg: number;
  instructor: number;
  external: number;
  gap: number;
  direction: "overestimate" | "underestimate" | "aligned";
  level: Level;
}

export interface Resource {
  title: string;
  provider: string;
  url: string;
  kind: string;
  duration: string;
  skill?: string;
}

export interface Report {
  id: string;
  milestone: Milestone;
  narrative: string;
  source: "ai" | "fallback";
  overall_self: number;
  overall_external: number;
  overall_gap: number;
  overall_level: Level;
  generated_at: string;
  metrics: Metric[];
  content: {
    headline: string;
    paragraphs: string[];
    strengths: string[];
    focus_skill: string;
    actionable_steps: string[];
    johari_insight: string;
    resources: Resource[];
    themes: Record<string, { mentions: number; positive: number; negative: number }>;
    overall_sentiment: number;
    peer_count: number;
  };
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link?: string | null;
  is_read: boolean;
  created_at: string;
}
