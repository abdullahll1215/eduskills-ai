import { CheckCircle2, Search, ShieldAlert, ShieldCheck, Users, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { Competency, Milestone } from "../../api/types";
import { Alert, Loading, PageHeader, useFetch } from "../../components/ui";
import { RatingSlider, useStudentMilestone } from "./shared";

interface PeersData {
  milestone: Milestone;
  team_size_ok: boolean;
  min_peers: number;
  competencies: Competency[];
  peers: { id: string; full_name: string; evaluated: boolean; available: boolean }[];
}

interface Target {
  id: string;
  full_name: string;
  student_number: string | null;
  team: string | null;
  project: string | null;
  is_teammate: boolean;
  status: "available" | "evaluated" | "waiting_self" | "closed";
}

const STATUS_LABEL: Record<Target["status"], string> = {
  available: "",
  evaluated: "Evaluated",
  waiting_self: "Self-assessment pending",
  closed: "No open evaluation period",
};

function TargetPicker({ value, onPick, version }: { value: Target | null; onPick: (t: Target | null) => void; version: number }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Target[]>([]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api<Target[]>("/api/student/evaluation-targets", { params: { q } }).then(setResults).catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [q, version]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50/50 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{value.full_name}</div>
          <div className="text-xs text-slate-500">{[value.student_number, value.team, value.project].filter(Boolean).join(" · ")}</div>
        </div>
        <button type="button" className="btn-ghost p-2" onClick={() => onPick(null)} aria-label="Change student"><X className="h-4 w-4" /></button>
      </div>
    );
  }
  return (
    <div ref={box} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        id="target-search"
        className="input pl-9"
        dir="auto"
        placeholder="Search any student by name or university ID..."
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
      />
      {open && (
        <div className="card absolute z-30 mt-1 max-h-80 w-full overflow-y-auto py-1">
          {results.length === 0 && <div className="px-4 py-3 text-sm text-slate-500">No students found.</div>}
          {results.map((t) => {
            const ok = t.status === "available";
            return (
              <button
                key={t.id}
                type="button"
                disabled={!ok}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => {
                  onPick(t);
                  setOpen(false);
                  setQ("");
                }}
              >
                <span>
                  <span className="block text-sm font-medium text-slate-800">{t.full_name}</span>
                  <span className="block text-xs text-slate-500">{[t.student_number, t.team, t.project].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {t.is_teammate && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">Teammate</span>}
                  {!ok && <span className="text-[11px] text-slate-400">{STATUS_LABEL[t.status]}</span>}
                  {t.status === "evaluated" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface Check {
  is_toxic: boolean;
  reason: string | null;
  is_constructive: boolean;
  hints: string[];
}

export default function PeerEvaluation() {
  const { milestone, loading: l1, reload: reloadProjects } = useStudentMilestone();
  const { data: comps, loading: l2, error } = useFetch(() => api<Competency[]>("/api/competencies"));
  const { data, reload } = useFetch(
    () => (milestone ? api<PeersData>("/api/student/peers", { params: { milestone_id: milestone.id } }).catch(() => null) : Promise.resolve(null)),
    [milestone?.id],
  );
  const [target, setTarget] = useState<Target | null>(null);
  const [version, setVersion] = useState(0);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error" | "warning"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    const init: Record<string, number> = {};
    comps?.forEach((c) => (init[c.id] = 3));
    setRatings(init);
    setComment("");
    setCheck(null);
    setTarget(null);
  };
  useEffect(reset, [comps]);

  // Live AI content filter feedback (debounced)
  useEffect(() => {
    if (comment.trim().length < 5) {
      setCheck(null);
      return;
    }
    const t = setTimeout(() => {
      api<Check>("/api/student/peer-check", { body: { comment } }).then(setCheck).catch(() => undefined);
    }, 500);
    return () => clearTimeout(t);
  }, [comment]);

  if (l1 || l2) return <Loading />;
  if (error || !comps) return <Alert kind="error">{error}</Alert>;

  const pending = data?.peers.filter((p) => !p.evaluated) ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!target) return setMsg({ kind: "error", text: "Select a student to evaluate." });
    setBusy(true);
    try {
      const res = await api<{ flagged: boolean; message: string }>("/api/student/peer-evaluations", {
        body: { target_id: target.id, ratings, comment },
      });
      setMsg({ kind: res.flagged ? "warning" : "success", text: res.message });
      reset();
      setVersion((v) => v + 1);
      reload();
      reloadProjects();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Give Feedback" subtitle="Evaluate any student on the platform. Your identity stays anonymous and your feedback is confidential." />

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <form onSubmit={submit} className="card p-6">
          {msg && (
            <div className="mb-4">
              <Alert kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Alert>
            </div>
          )}
          <label className="label">Student to evaluate</label>
          <TargetPicker value={target} onPick={setTarget} version={version} />

          <div className="mt-6 border-t border-slate-100 pt-5">
            <h3 className="font-semibold text-slate-900">Quantitative Assessment (1-5 Scale)</h3>
            <div className="divide-y divide-slate-50">
              {comps.map((c) => (
                <RatingSlider key={c.id} label={c.skill_name} value={ratings[c.id] ?? 3} rubric={c.rubric} onChange={(v) => setRatings({ ...ratings, [c.id]: v })} />
              ))}
            </div>
          </div>

          <div className="mt-4 border-t border-slate-100 pt-5">
            <h3 className="font-semibold text-slate-900">Qualitative Feedback</h3>
            <p className="mb-2 text-xs text-slate-500">Provide constructive examples of the student's performance.</p>
            <textarea
              className="input min-h-[110px]"
              value={comment}
              required
              onChange={(e) => setComment(e.target.value)}
              placeholder="e.g., Ahmed is great at organizing meetings, but sometimes struggles to accept alternative ideas..."
            />
            {check && (
              <div className="mt-2 space-y-1">
                {check.is_toxic ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
                    <ShieldAlert className="h-3.5 w-3.5" /> {check.reason} — this comment will be held for instructor review
                  </span>
                ) : check.is_constructive ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                    <ShieldCheck className="h-3.5 w-3.5" /> Constructive Feedback Verified
                  </span>
                ) : (
                  <ul className="list-inside list-disc text-xs text-amber-700">
                    {check.hints.map((h) => <li key={h}>{h}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={reset}>Cancel</button>
            <button className="btn-primary" disabled={busy || !target}>Submit Evaluation</button>
          </div>
        </form>

        <div className="space-y-4">
          {data && data.peers.length > 0 && (
            <div className="card p-5">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Users className="h-4 w-4 text-brand-600" /> Your team</h3>
              <ul className="mt-3 space-y-1">
                {data.peers.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={p.evaluated || !p.available}
                      onClick={() => setTarget({ id: p.id, full_name: p.full_name, student_number: null, team: null, project: null, is_teammate: true, status: "available" })}
                      className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-sm hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span className="text-slate-700">{p.full_name}</span>
                      {p.evaluated ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <span className="text-xs text-slate-400">{p.available ? "Pending" : "Waiting"}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 text-xs text-slate-500">{pending.length === 0 ? "All teammates evaluated 🎉" : `${pending.length} remaining · tap a name to evaluate`}</div>
            </div>
          )}
          <div className="card p-5 text-xs leading-relaxed text-slate-500">
            <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-800"><ShieldCheck className="h-4 w-4 text-brand-600" /> How anonymity works</div>
            Your identity is replaced with a salted SHA-256 hash before storage and comments are encrypted. Students only see feedback once at least {data?.min_peers ?? 3} reviews are received, and
            comments pass an AI content filter for toxicity and bias.
          </div>
        </div>
      </div>
    </div>
  );
}
