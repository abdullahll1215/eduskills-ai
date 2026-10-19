import { Activity, BrainCircuit, Eye, LineChart, Loader2, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, DEMO as IS_DEMO } from "../api/client";
import { Alert, askConfirm } from "../components/ui";
import LanguageMenu from "../components/LanguageMenu";
import { homeFor, useAuth } from "../context/AuthContext";
import { useT } from "../i18n";

const DEMO = [
  { label: "Student (Khalid S.)", email: "khalid@student.kfu.edu.sa" },
  { label: "Instructor (Dr. Ahmed)", email: "ahmed@kfu.edu.sa" },
  { label: "Student Advisor", email: "advisor@kfu.edu.sa" },
  { label: "System Admin", email: "admin@kfu.edu.sa" },
];

interface SignupProject {
  id: string;
  title: string;
  teams: { id: string; team_name: string }[];
}

function SignupForm({ onDone, onCancel }: { onDone: (role: string) => void; onCancel: () => void }) {
  const { register } = useAuth();
  const t = useT();
  const [form, setForm] = useState({ full_name: "", student_number: "", email: "", password: "", confirm: "", team_id: "" });
  const [projects, setProjects] = useState<SignupProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  useEffect(() => {
    api<SignupProject[]>("/api/auth/signup-options").then(setProjects).catch(() => setProjects([]));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.password.length < 8) return setError(t("The password must have at least 8 characters."));
    if (form.password !== form.confirm) return setError(t("The two passwords do not match."));
    setBusy(true);
    try {
      const user = await register({ full_name: form.full_name, email: form.email, password: form.password, student_number: form.student_number, team_id: form.team_id || null });
      onDone(user.role);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="text-2xl font-bold text-slate-900">{t("Create a student account")}</h2>
      <p className="mt-1 text-sm text-slate-500">{t("Instructor and advisor accounts are created by the system administrator.")}</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <div>
          <label className="label" htmlFor="su-name">{t("Full name")}</label>
          <input id="su-name" required minLength={2} className="input" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} autoComplete="name" />
        </div>
        <div>
          <label className="label" htmlFor="su-number">{t("University ID")}</label>
          <input id="su-number" className="input" value={form.student_number} onChange={(e) => set("student_number", e.target.value)} placeholder={t("e.g. {id}", { id: "222435057" })} inputMode="numeric" />
        </div>
        <div>
          <label className="label" htmlFor="su-email">{t("Email")}</label>
          <input id="su-email" type="email" required className="input" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="name@student.kfu.edu.sa" autoComplete="email" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="su-password">{t("Password")}</label>
            <input id="su-password" type="password" required minLength={8} className="input" value={form.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" />
          </div>
          <div>
            <label className="label" htmlFor="su-confirm">{t("Confirm password")}</label>
            <input id="su-confirm" type="password" required className="input" value={form.confirm} onChange={(e) => set("confirm", e.target.value)} autoComplete="new-password" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="su-team">{t("Project team (optional)")}</label>
          <select id="su-team" className="input" value={form.team_id} onChange={(e) => set("team_id", e.target.value)}>
            <option value="">{t("I'll be added by my instructor")}</option>
            {projects.map((p) => (
              <optgroup key={p.id} label={p.title}>
                {p.teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.team_name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <button className="btn-primary w-full" disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Create account")}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        {t("Already have an account?")}{" "}
        <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={onCancel}>{t("Sign in")}</button>
      </p>
    </>
  );
}

export default function Login() {
  const { login } = useAuth();
  const t = useT();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(email, password);
      navigate(homeFor(user.role));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-500 p-12 text-white lg:flex">
        <div className="flex items-center gap-2 text-2xl font-bold">
          <Activity className="h-6 w-6" /> EduSkills AI
        </div>
        <div>
          <h1 className="text-4xl font-bold leading-tight">{t("AI-Driven Soft Skills Assessment & Development")}</h1>
          <p className="mt-4 max-w-md text-brand-100">
            {t("360° feedback from yourself, your peers and your instructor — turned into blind-spot insights and a personal growth plan.")}
          </p>
          <div className="mt-10 grid max-w-md gap-4">
            {[
              [Eye, "Blind-spot detection", "Weighted Johari-window gap analysis (60% instructor, 40% peers)."],
              [BrainCircuit, "AI developmental narratives", "Generative AI turns feedback into actionable growth reports."],
              [LineChart, "Longitudinal growth", "Track five core soft skills across project milestones."],
              [ShieldCheck, "Anonymous & secure", "Salted SHA-256 anonymization and encrypted feedback."],
            ].map(([Icon, title, text]) => {
              const I = Icon as typeof Eye;
              return (
                <div key={title as string} className="flex gap-3">
                  <div className="rounded-lg bg-white/15 p-2">
                    <I className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-semibold">{t(title as string)}</div>
                    <div className="text-sm text-brand-100">{t(text as string)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="text-xs text-brand-200">{t("King Faisal University · College of Computer Sciences & Information Technology")}</div>
      </div>

      <div className="relative flex items-center justify-center p-6">
        <div className="absolute end-4 top-4"><LanguageMenu /></div>
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2 text-2xl font-bold text-brand-600">
              <Activity className="h-6 w-6" /> EduSkills AI
            </div>
          </div>
          {mode === "signup" ? (
            <SignupForm onDone={(role) => navigate(homeFor(role))} onCancel={() => setMode("login")} />
          ) : (
          <>
          <h2 className="text-2xl font-bold text-slate-900">{t("Sign in")}</h2>
          <p className="mt-1 text-sm text-slate-500">{t("Use your institutional email address.")}</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            {error && <Alert kind="error">{error}</Alert>}
            <div>
              <label className="label" htmlFor="email">{t("Email")}</label>
              <input id="email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@kfu.edu.sa" autoComplete="username" />
            </div>
            <div>
              <label className="label" htmlFor="password">{t("Password")}</label>
              <input id="password" type="password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            <button className="btn-primary w-full" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Sign in")}
            </button>
          </form>
          <p className="mt-4 text-center text-sm text-slate-500">
            {t("New student?")}{" "}
            <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => setMode("signup")}>{t("Create an account")}</button>
          </p>

          <div className="mt-8 rounded-xl border border-dashed border-slate-300 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("Demo accounts")}</div>
            <div className="mt-1 text-xs text-slate-400">{t("Password: {pw}", { pw: "Password123!" })}</div>
            {IS_DEMO && (
              <div className="mt-2 text-xs text-slate-500">
                {t("Online demo: everything runs in your browser and your changes are saved on this device only.")}{" "}
                <button
                  type="button"
                  className="font-semibold text-brand-600 underline"
                  onClick={async () => {
                    if (!(await askConfirm(t("Reset all demo data to the original sample cohort?")))) return;
                    const { resetDB } = await import("../demo/store");
                    resetDB();
                    setError(null);
                  }}
                >
                  {t("Reset demo data")}
                </button>
              </div>
            )}
            <div className="mt-3 grid gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  className="btn-outline justify-start text-start"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword("Password123!");
                  }}
                >
                  {t(d.label)}
                </button>
              ))}
            </div>
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
