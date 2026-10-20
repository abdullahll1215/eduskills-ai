import { ArrowLeft, BriefcaseBusiness, ChevronRight, GraduationCap, Loader2, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DEMO as IS_DEMO } from "../api/client";
import { Alert, askConfirm } from "../components/ui";
import LanguageMenu from "../components/LanguageMenu";
import Brand from "../components/Brand";
import Perspectives from "../components/Perspectives";
import { homeFor, Portal, useAuth } from "../context/AuthContext";
import { useT } from "../i18n";

/** Sample accounts exist only in the in-browser demo and in local development. */
const SHOW_DEMO_ACCOUNTS = IS_DEMO || import.meta.env.DEV;
const DEMO_PASSWORD = "Password123!";
const DEMO_ACCOUNTS: Record<Portal, { label: string; email: string }[]> = {
  student: [{ label: "Student (Khalid S.)", email: "khalid@student.kfu.edu.sa" }],
  staff: [
    { label: "Instructor (Dr. Ahmed)", email: "ahmed@kfu.edu.sa" },
    { label: "Student Advisor", email: "advisor@kfu.edu.sa" },
    { label: "System Admin", email: "admin@kfu.edu.sa" },
  ],
};

type Step = "choose" | Portal | "signup";

function BackLink({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick} className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700">
      <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t("Choose another portal")}
    </button>
  );
}

function PortalChooser({ onPick }: { onPick: (step: Step) => void }) {
  const t = useT();
  const option = (portal: Portal, icon: JSX.Element, title: string, text: string) => (
    <button
      type="button"
      onClick={() => onPick(portal)}
      className="portal-option group"
    >
      <div className="portal-icon">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-slate-900">{t(title)}</div>
        <div className="text-sm text-slate-500">{t(text)}</div>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:text-brand-600 rtl:rotate-180" />
    </button>
  );
  return (
    <>
      <h2 className="text-2xl font-bold text-slate-900">{t("Welcome")}</h2>
      <p className="mt-1 text-sm text-slate-500">{t("Choose how you want to sign in.")}</p>
      <div className="mt-6 space-y-3">
        {option("student", <GraduationCap className="h-6 w-6" />, "Students", "Assess your skills, give feedback and follow your growth.")}
        {option("staff", <BriefcaseBusiness className="h-6 w-6" />, "Faculty & staff", "Instructors, academic advisors and administrators.")}
      </div>
      <p className="mt-6 text-center text-sm text-slate-500">
        {t("New student?")}{" "}
        <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => onPick("signup")}>{t("Create an account")}</button>
      </p>
    </>
  );
}

function SignInForm({ portal, onSignup }: { portal: Portal; onSignup: () => void }) {
  const { login } = useAuth();
  const t = useT();
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
      const user = await login(email, password, portal);
      navigate(homeFor(user.role));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white">
          {portal === "student" ? <GraduationCap className="h-5 w-5" /> : <BriefcaseBusiness className="h-5 w-5" />}
        </div>
        <h2 className="text-2xl font-bold text-slate-900">{portal === "student" ? t("Student sign-in") : t("Faculty & staff sign-in")}</h2>
      </div>
      <p className="mt-2 text-sm text-slate-500">{t("Use your institutional email address.")}</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <div>
          <label className="label" htmlFor="email">{t("Email")}</label>
          <input id="email" type="email" required className="input" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder={portal === "student" ? "name@student.kfu.edu.sa" : "name@kfu.edu.sa"} autoComplete="username" />
        </div>
        <div>
          <label className="label" htmlFor="password">{t("Password")}</label>
          <input id="password" type="password" required className="input" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <button className="btn-primary w-full" disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Sign in")}
        </button>
      </form>
      {portal === "student" ? (
        <p className="mt-4 text-center text-sm text-slate-500">
          {t("New student?")}{" "}
          <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={onSignup}>{t("Create an account")}</button>
        </p>
      ) : (
        <p className="mt-4 text-center text-xs text-slate-400">{t("Staff accounts are created by the system administrator.")}</p>
      )}

      {SHOW_DEMO_ACCOUNTS && (
        <div className="mt-8 rounded-xl border border-dashed border-brand-200 bg-brand-50/40 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">{t("Demo accounts")}</div>
          <div className="mt-1 text-xs text-slate-500">{t("Password: {pw}", { pw: DEMO_PASSWORD })}</div>
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
            {DEMO_ACCOUNTS[portal].map((d) => (
              <button
                key={d.email}
                type="button"
                className="btn-outline justify-start bg-white text-start"
                onClick={() => {
                  setEmail(d.email);
                  setPassword(DEMO_PASSWORD);
                }}
              >
                {t(d.label)}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function SignupForm({ onDone, onCancel }: { onDone: (role: string) => void; onCancel: () => void }) {
  const { register } = useAuth();
  const t = useT();
  const [form, setForm] = useState({ full_name: "", student_number: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.password.length < 8) return setError(t("The password must have at least 8 characters."));
    if (form.password !== form.confirm) return setError(t("The two passwords do not match."));
    setBusy(true);
    try {
      const user = await register({ full_name: form.full_name, email: form.email, password: form.password, student_number: form.student_number });
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
      <p className="mt-1 text-sm text-slate-500">{t("Start exploring and assess yourself after signing up. Joining a team is optional.")}</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <div>
          <label className="label" htmlFor="su-name">{t("Full name")}</label>
          <input id="su-name" required minLength={2} className="input" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} autoComplete="name" />
        </div>
        <div>
          <label className="label" htmlFor="su-number">{t("University ID")}</label>
          <input id="su-number" className="input" dir="ltr" value={form.student_number} onChange={(e) => set("student_number", e.target.value)} placeholder={t("e.g. {id}", { id: "222435057" })} inputMode="numeric" />
        </div>
        <div>
          <label className="label" htmlFor="su-email">{t("Email")}</label>
          <input id="su-email" type="email" required className="input" dir="ltr" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="name@student.kfu.edu.sa" autoComplete="email" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="su-password">{t("Password")}</label>
            <input id="su-password" type="password" required minLength={8} className="input" dir="ltr" value={form.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" />
          </div>
          <div>
            <label className="label" htmlFor="su-confirm">{t("Confirm password")}</label>
            <input id="su-confirm" type="password" required className="input" dir="ltr" value={form.confirm} onChange={(e) => set("confirm", e.target.value)} autoComplete="new-password" />
          </div>
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
  const t = useT();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("choose");

  return (
    <div className="login-shell">
      <section className="login-story" aria-label={t("About EduSkills")}>
        <Brand caption={t("Assessment & development")} />
        <div className="login-story-content">
          <div className="login-index">{t("Three perspectives. A clearer picture.")}</div>
          <h1>{t("Your skills,")}<br />{t("in perspective.")}</h1>
          <p className="login-story-intro">{t("Self-reflection, teammate feedback and instructor insight — connected in one place.")}</p>
          <Perspectives />
        </div>
        <div className="login-story-footer">{t("King Faisal University · College of Computer Sciences & Information Technology")}</div>
      </section>

      <div className="login-form-side">
        <div className="absolute end-5 top-5"><LanguageMenu /></div>
        <div className="login-form">
          <div className="mb-10 lg:hidden"><Brand caption={t("Assessment & development")} /></div>
          <div className="section-kicker mb-4">{t("Access your workspace")}</div>
          <div key={step} className="login-form-enter">
          {step === "choose" && <PortalChooser onPick={setStep} />}
          {(step === "student" || step === "staff") && (
            <>
              <BackLink onClick={() => setStep("choose")} />
              <SignInForm key={step} portal={step} onSignup={() => setStep("signup")} />
            </>
          )}
          {step === "signup" && (
            <>
              <BackLink onClick={() => setStep("choose")} />
              <SignupForm onDone={(role) => navigate(homeFor(role))} onCancel={() => setStep("student")} />
            </>
          )}
          </div>
          <div className="login-form-note flex items-center gap-2"><ShieldCheck className="h-4 w-4 shrink-0" />{t("Peer feedback is anonymous. Your personal assessment stays private.")}</div>
        </div>
      </div>
    </div>
  );
}
