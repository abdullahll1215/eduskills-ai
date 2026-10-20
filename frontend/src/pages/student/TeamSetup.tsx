import { Check, Copy, KeyRound, Loader2, UsersRound } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { Alert, useFetch } from "../../components/ui";
import { useT } from "../../i18n";

export interface MyTeam {
  project: { id: string; title: string };
  team: { id: string; team_name: string; invite_code: string | null } | null;
  members: { id: string; full_name: string }[];
}

export function CopyCode({ code }: { code: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(code).then(() => setCopied(true)).catch(() => setCopied(false))}
      className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-white px-3 py-1.5 font-mono text-sm font-semibold tracking-widest text-brand-700 hover:bg-brand-50"
      title={t("Copy")}
      dir="ltr"
    >
      {code}
      {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4 text-brand-400" />}
    </button>
  );
}

const codeInput = "input text-center font-mono text-base uppercase tracking-[0.3em]";

function JoinCard({ onJoined }: { onJoined: () => void }) {
  const t = useT();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/student/team/join", { body: { code } });
      onJoined();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card flex flex-col p-6">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white"><KeyRound className="h-5 w-5" /></div>
      <h2 className="text-lg font-semibold text-slate-900">{t("Join a team")}</h2>
      <p className="mt-1 text-sm text-slate-500">{t("Enter the invite code a teammate shared with you.")}</p>
      <div className="mt-5 flex-1 space-y-3">
        {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}
        <input className={codeInput} dir="ltr" required maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} placeholder="1234-ALPHA" aria-label={t("Invite code")} />
      </div>
      <button className="btn-primary mt-4 w-full" disabled={busy || code.trim().length < 4}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Join team")}
      </button>
    </form>
  );
}

function CreateCard({ onCreated }: { onCreated: (team: MyTeam) => void }) {
  const t = useT();
  const [courseCode, setCourseCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await api<MyTeam>("/api/student/team/create", { body: { course_code: courseCode, team_name: name } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card flex flex-col p-6">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><UsersRound className="h-5 w-5" /></div>
      <h2 className="text-lg font-semibold text-slate-900">{t("Create a team")}</h2>
      <p className="mt-1 text-sm text-slate-500">{t("Enter the course number and a team name. A course that is not on the platform yet is created for you.")}</p>
      <div className="mt-5 flex-1 space-y-3">
        {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}
        <div>
          <label className="label">{t("Course number")}</label>
          <input className={codeInput} dir="ltr" required inputMode="numeric" pattern="[0-9 -]{4,14}" maxLength={14} value={courseCode} onChange={(e) => setCourseCode(e.target.value)} placeholder="1234" />
        </div>
        <div>
          <label className="label">{t("Team name")}</label>
          <input className="input" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Team Gamma")} />
        </div>
        <p className="text-xs text-slate-400">{t("Your team code will be the course number and team name, e.g. 1234-ALPHA.")}</p>
      </div>
      <button className="btn-outline mt-4 w-full border-brand-200 text-brand-700 hover:bg-brand-50" disabled={busy}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Create team")}
      </button>
    </form>
  );
}

/** Optional team membership, shown on My Projects. It never gates access to other student features. */
export default function TeamSection() {
  const t = useT();
  const { data, loading, error, reload } = useFetch(() => api<MyTeam[]>("/api/student/team"));
  const [created, setCreated] = useState<MyTeam | null>(null);
  const [version, setVersion] = useState(0);
  const done = () => {
    reload();
    setVersion((v) => v + 1);
  };

  if (loading && !data) return null;
  if (error) return <Alert kind="error">{error}</Alert>;

  if (created?.team) {
    return (
      <div className="card flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Check className="h-5 w-5" /></div>
          <div>
            <h2 className="font-semibold text-slate-900">{t("{team} is ready", { team: created.team.team_name })}</h2>
            <p className="text-sm text-slate-500">{t("Share this invite code with your teammates so they can join.")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {created.team.invite_code && <CopyCode code={created.team.invite_code} />}
          <button className="btn-primary" onClick={() => { setCreated(null); done(); }}>{t("Continue")}</button>
        </div>
      </div>
    );
  }

  // One team per course: the join/create forms are only for students without a team.
  if (data?.some((d) => d.team)) return <TeamStrip key={version} />;
  return (
    <section>
      <h2 className="font-semibold text-slate-900">{t("Your team (optional)")}</h2>
      <p className="mb-4 mt-1 text-sm text-slate-500">{t("Join a team to evaluate your teammates. Everything else works without one.")}</p>
      <div className="grid gap-5 md:grid-cols-2">
        <JoinCard onJoined={done} />
        <CreateCard onCreated={setCreated} />
      </div>
    </section>
  );
}

/** The student's team with its invite code, so classmates can be invited at any time. */
export function TeamStrip() {
  const t = useT();
  const { data } = useFetch(() => api<MyTeam[]>("/api/student/team"));
  const mine = data?.find((d) => d.team);
  if (!mine?.team) return <Link className="btn-outline" to="/student/artifacts">{t("Join or create a team (optional)")}</Link>;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-100 bg-brand-50/60 px-5 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white"><UsersRound className="h-4 w-4" /></div>
        <div>
          <div className="text-sm font-semibold text-slate-900">{mine.team.team_name}</div>
          <div className="text-xs text-slate-500">
            {mine.members.length === 0 ? t("Only you so far") : mine.members.length === 1 ? t("You and 1 teammate") : t("You and {n} teammates", { n: mine.members.length })} · {mine.project.title}
          </div>
        </div>
      </div>
      {mine.team.invite_code && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {t("Invite code")}
          <CopyCode code={mine.team.invite_code} />
        </div>
      )}
    </div>
  );
}
