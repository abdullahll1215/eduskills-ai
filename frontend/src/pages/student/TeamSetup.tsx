import { ArrowUpRight, Check, Copy, GraduationCap, KeyRound, Loader2, Plus, UsersRound } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { Alert, useFetch } from "../../components/ui";
import { useLang, useT } from "../../i18n";
import CoursePicker from "../../components/CoursePicker";
import { courseByCode, courseName } from "../../data/courseCatalog";

export interface MyTeam {
  project: { id: string; title: string; course_number?: string | null; instructor?: { id: string; full_name: string } | null };
  team: { id: string; team_name: string; invite_code: string | null } | null;
  members: { id: string; full_name: string }[];
}
interface CoursePreview {
  course_number: string;
  exists: boolean;
  title: string | null;
  is_active: boolean | null;
  instructor: { id: string; full_name: string } | null;
}
interface TeamDraft { course_code: string; team_name: string; course_title?: string | null }

export function CopyCode({ code }: { code: string }) {
  const t = useT();
  const [status, setStatus] = useState<"idle" | "copied" | "unavailable">("idle");
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setStatus("copied"); }
    catch { setStatus("unavailable"); }
  };
  return <span className="course-code-wrap">
    <button type="button" onClick={copy} className="course-code" aria-label={t("Copy invite code {code}", { code })} dir="ltr" translate="no">
      <span>{code}</span>{status === "copied" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
    </button>
    <span className="text-xs text-slate-500" role="status">{status === "copied" ? t("Copied") : status === "unavailable" ? t("Copy unavailable. Select the code to copy it.") : ""}</span>
  </span>;
}

export function CourseSupervision({ instructor }: { instructor: MyTeam["project"]["instructor"] }) {
  const t = useT();
  return <div className={`course-supervision ${instructor ? "is-assigned" : "is-pending"}`}>
    <GraduationCap size={18} aria-hidden="true" />
    <div><strong>{instructor ? t("Supervised by {name}", { name: instructor.full_name }) : t("Instructor not assigned yet")}</strong>
      <p>{instructor ? t("Complete the assessments to unlock your academic report.") : t("An admin can assign an instructor. Personal assessment and exploration remain available.")}</p>
    </div>
  </div>;
}

function TeamMembership({ item }: { item: MyTeam }) {
  const t = useT();
  if (!item.team) return null;
  return <article className="course-membership">
    <div className="course-membership-heading">
      <div className="course-team-mark"><UsersRound size={21} aria-hidden="true" /></div>
      <div className="min-w-0 flex-1"><p className="section-kicker">{item.project.title}</p><h3>{item.team.team_name}</h3></div>
      <span className="course-member-count">{item.members.length === 0 ? t("Only you so far") : t("{n} members", { n: item.members.length + 1 })}</span>
    </div>
    <CourseSupervision instructor={item.project.instructor} />
    <div className="course-membership-footer"><span>{t("Invite your teammates")}</span>{item.team.invite_code && <CopyCode code={item.team.invite_code} />}</div>
  </article>;
}

function JoinCard({ onJoined }: { onJoined: () => Promise<void> }) {
  const t = useT();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api("/api/student/team/join", { body: { code } }); await onJoined(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="course-entry-form">
    <div className="course-form-index"><span>01</span><KeyRound size={19} aria-hidden="true" /></div>
    <h3>{t("Have an invite?")}</h3><p className="course-form-description">{t("Join the team your classmates have already started.")}</p>
    <div className="course-form-fields">
      {error && <div role="alert"><Alert kind="error">{error}</Alert></div>}
      <label className="label" htmlFor="team-invite-code">{t("Invite code")}</label>
      <input id="team-invite-code" name="invite_code" className="input course-number-input" dir="ltr" required minLength={4} maxLength={60} autoComplete="off" spellCheck={false} value={code} onChange={e => { setCode(e.target.value); setError(null); }} placeholder="1234-ALPHA" />
    </div>
    <button className="btn-primary w-full" disabled={busy}>{busy ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <ArrowUpRight size={17} className="rtl:-scale-x-100" aria-hidden="true" />}{t("Join team")}</button>
  </form>;
}

/** Native dialog contains keyboard focus and restores it when dismissed. */
function ConfirmNewCourse({ draft, busy, error, onCancel, onConfirm }: { draft: TeamDraft | null; busy: boolean; error: string | null; onCancel: () => void; onConfirm: () => void }) {
  const t = useT();
  const { lang } = useLang();
  const course = draft ? courseByCode(draft.course_code) : undefined;
  const title = course ? courseName(course, lang) : draft?.course_title;
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (draft) ref.current?.showModal();
    else ref.current?.close();
  }, [draft]);
  return <dialog ref={ref} className="course-confirm" aria-labelledby="new-course-title" aria-describedby="new-course-description" onCancel={e => { e.preventDefault(); if (!busy) onCancel(); }} onClose={() => { if (!busy && draft) onCancel(); }}>
    <div className="course-confirm-icon"><GraduationCap size={26} aria-hidden="true" /></div>
    <p className="section-kicker">{t("Check before you create")}</p>
    <h2 id="new-course-title">{t("Start a new course?")}</h2>
    <p id="new-course-description">{t("Course {number} is not on the platform yet. Check the number, or create it with your team.", { number: draft?.course_code ?? "" })}</p>
    <dl className="course-confirm-summary">{title && <div><dt>{t("Subject")}</dt><dd>{title}</dd></div>}<div><dt>{t("Course number")}</dt><dd dir="ltr">{draft?.course_code}</dd></div><div><dt>{t("Team name")}</dt><dd>{draft?.team_name}</dd></div></dl>
    <CourseSupervision instructor={null} />
    <p className="course-confirm-note">{t("Your academic report will need an assigned instructor and complete assessments.")}</p>
    {error && <div role="alert"><Alert kind="error">{error}</Alert></div>}
    <div className="course-confirm-actions"><button type="button" className="btn-outline" disabled={busy} onClick={onCancel}>{t("Check number")}</button><button type="button" className="btn-primary" disabled={busy} onClick={onConfirm}>{busy && <Loader2 size={17} className="animate-spin" aria-hidden="true" />}{t("Create course & team")}</button></div>
  </dialog>;
}

function CreateCard({ onCreated }: { onCreated: () => Promise<void> }) {
  const t = useT();
  const [courseCode, setCourseCode] = useState("");
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<TeamDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async (value: TeamDraft, confirmed: boolean) => {
    setBusy(true); setError(null);
    try { await api<MyTeam>("/api/student/team/create", { body: { course_code: value.course_code, team_name: value.team_name, confirm_new_course: confirmed } }); setDraft(null); await onCreated(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const preview = await api<CoursePreview>("/api/student/team/course-preview", { params: { code: courseCode } });
      const value = { course_code: preview.course_number, team_name: name.trim(), course_title: preview.title };
      if (!preview.exists) setDraft(value);
      else if (!preview.is_active) setError(t("This course is no longer active"));
      else await create(value, false);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return <>
    <form onSubmit={submit} className="course-entry-form">
      <div className="course-form-index"><span>02</span><Plus size={19} aria-hidden="true" /></div>
      <h3>{t("Starting your team?")}</h3><p className="course-form-description">{t("Find your subject, then name your team. We will check the course before creating anything.")}</p>
      <div className="course-form-fields">
        {error && !draft && <div role="alert"><Alert kind="error">{error}</Alert></div>}
        <CoursePicker code={courseCode} onChange={setCourseCode} />
        <div className="course-team-name-field"><label className="label" htmlFor="new-team-name">{t("Team name")}</label><input id="new-team-name" name="team_name" className="input" required minLength={2} maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder={t("e.g. Team Gamma")} /></div>
        <p className="course-field-hint">{t("New course numbers need your confirmation. Existing courses keep their instructor.")}</p>
      </div>
      <button className="btn-outline w-full" disabled={busy}>{busy && <Loader2 size={17} className="animate-spin" aria-hidden="true" />}{t("Review course & team")}</button>
    </form>
    <ConfirmNewCourse draft={draft} busy={busy} error={error} onCancel={() => { setDraft(null); setError(null); }} onConfirm={() => { if (draft) void create(draft, true); }} />
  </>;
}

/** Optional academic context remains separate from personal exploration and work projects. */
export default function TeamSection() {
  const t = useT();
  const { data, loading, error, reload } = useFetch(() => api<MyTeam[]>("/api/student/team"));
  const [saved, setSaved] = useState(false);
  const memberships = data?.filter(item => item.team) ?? [];
  const done = async () => { await reload(); setSaved(true); };
  if (loading && !data) return null;
  if (error) return <Alert kind="error">{error}</Alert>;
  return <section className="course-workspace" aria-labelledby="academic-team-title">
    <div className="course-section-heading"><div><p className="section-kicker">{t("ACADEMIC SPACE")}</p><h2 id="academic-team-title">{t("Your course. Your team.")}</h2><p>{t("A shared space for peer feedback. Personal exploration is always yours.")}</p></div>
</div>
    {saved && <div role="status"><Alert kind="success" onClose={() => setSaved(false)}>{t("Your team is ready. Share the invite code with your classmates.")}</Alert></div>}
    {memberships.length > 0 && <div className="course-memberships">{memberships.map(item => <TeamMembership key={item.project.id} item={item} />)}</div>}
    {!memberships.length && <div id="course-entry-options" className="course-entry-options"><JoinCard onJoined={done} /><CreateCard onCreated={done} /></div>}
    <div className="course-explore-note"><Check size={15} aria-hidden="true" /><span>{t("No team needed for personal assessment, resources or exploration.")}</span><Link to="/student/self-assessment?context=personal">{t("Personal assessment")}<ArrowUpRight size={14} aria-hidden="true" /></Link></div>
  </section>;
}

export function TeamStrip() {
  const t = useT();
  const { data } = useFetch(() => api<MyTeam[]>("/api/student/team"));
  const mine = data?.filter(item => item.team) ?? [];
  if (!mine.length) return <Link className="btn-outline" to="/student/artifacts">{t("Join or create a team (optional)")}</Link>;
  return <div className="course-memberships">{mine.map(item => <TeamMembership key={item.project.id} item={item} />)}</div>;
}
