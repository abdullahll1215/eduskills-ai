import { Activity, BrainCircuit, Eye, LineChart, Loader2, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert } from "../components/ui";
import { homeFor, useAuth } from "../context/AuthContext";

const DEMO = [
  { label: "Student (Khalid S.)", email: "khalid@student.kfu.edu.sa" },
  { label: "Instructor (Dr. Ahmed)", email: "ahmed@kfu.edu.sa" },
  { label: "Student Advisor", email: "advisor@kfu.edu.sa" },
  { label: "System Admin", email: "admin@kfu.edu.sa" },
];

export default function Login() {
  const { login } = useAuth();
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
          <h1 className="text-4xl font-bold leading-tight">AI-Driven Soft Skills Assessment & Development</h1>
          <p className="mt-4 max-w-md text-brand-100">
            360° feedback from yourself, your peers and your instructor — turned into blind-spot insights and a personal growth plan.
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
                    <div className="font-semibold">{title as string}</div>
                    <div className="text-sm text-brand-100">{text as string}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="text-xs text-brand-200">King Faisal University · College of Computer Sciences & Information Technology</div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2 text-2xl font-bold text-brand-600">
              <Activity className="h-6 w-6" /> EduSkills AI
            </div>
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use your institutional email address.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            {error && <Alert kind="error">{error}</Alert>}
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@kfu.edu.sa" autoComplete="username" />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" type="password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            <button className="btn-primary w-full" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Sign in
            </button>
          </form>

          <div className="mt-8 rounded-xl border border-dashed border-slate-300 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Demo accounts</div>
            <div className="mt-1 text-xs text-slate-400">Password: Password123!</div>
            <div className="mt-3 grid gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  className="btn-outline justify-start text-left"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword("Password123!");
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
