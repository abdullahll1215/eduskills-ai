import { CheckCircle2, ShieldAlert, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
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

interface Check {
  is_toxic: boolean;
  reason: string | null;
  is_constructive: boolean;
  hints: string[];
}

export default function PeerEvaluation() {
  const { milestone, loading: l1, error: e1, reload: reloadProjects } = useStudentMilestone();
  const { data, loading, error, reload } = useFetch(
    () => (milestone ? api<PeersData>("/api/student/peers", { params: { milestone_id: milestone.id } }) : Promise.resolve(null)),
    [milestone?.id],
  );
  const [target, setTarget] = useState("");
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error" | "warning"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    const init: Record<string, number> = {};
    data?.competencies.forEach((c) => (init[c.id] = 3));
    setRatings(init);
    setComment("");
    setCheck(null);
    setTarget("");
  };
  useEffect(reset, [data]);

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

  if (l1 || (loading && !data)) return <Loading />;
  if (e1 || error) return <Alert kind="error">{e1 || error}</Alert>;
  if (!milestone || !data) return <Alert>No evaluation period is available yet.</Alert>;

  const closed = milestone.status !== "active";
  const pending = data.peers.filter((p) => !p.evaluated);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!target) return setMsg({ kind: "error", text: "Select a teammate to evaluate." });
    setBusy(true);
    try {
      const res = await api<{ flagged: boolean; message: string }>("/api/student/peer-evaluations", {
        body: { milestone_id: milestone.id, target_id: target, ratings, comment },
      });
      setMsg({ kind: res.flagged ? "warning" : "success", text: res.message });
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
      <PageHeader title="Anonymous Peer Evaluation" subtitle="Evaluate your team members securely and confidentially." />

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <form onSubmit={submit} className="card p-6">
          {msg && (
            <div className="mb-4">
              <Alert kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Alert>
            </div>
          )}
          {closed && <div className="mb-4"><Alert kind="warning" title="Evaluation Period Closed">Peer evaluations are closed right now. They open again when your instructor starts the next evaluation period.</Alert></div>}
          {!data.team_size_ok && <div className="mb-4"><Alert kind="warning">Your team needs at least {data.min_peers} peers for anonymous evaluation.</Alert></div>}

          <label className="label">Select Teammate to Evaluate</label>
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} disabled={closed}>
            <option value="">Select a student...</option>
            {data.peers.map((p) => (
              <option key={p.id} value={p.id} disabled={p.evaluated || !p.available}>
                {p.full_name} {p.evaluated ? "(evaluated)" : !p.available ? "(self-assessment pending)" : ""}
              </option>
            ))}
          </select>

          <div className="mt-6 border-t border-slate-100 pt-5">
            <h3 className="font-semibold text-slate-900">Quantitative Assessment (1-5 Scale)</h3>
            <div className="divide-y divide-slate-50">
              {data.competencies.map((c) => (
                <RatingSlider key={c.id} label={c.skill_name} value={ratings[c.id] ?? 3} rubric={c.rubric} disabled={closed} onChange={(v) => setRatings({ ...ratings, [c.id]: v })} />
              ))}
            </div>
          </div>

          <div className="mt-4 border-t border-slate-100 pt-5">
            <h3 className="font-semibold text-slate-900">Qualitative Feedback</h3>
            <p className="mb-2 text-xs text-slate-500">Provide constructive examples of the student's performance.</p>
            <textarea
              className="input min-h-[110px]"
              value={comment}
              disabled={closed}
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
            <button className="btn-primary" disabled={busy || closed || !target}>Submit Evaluation</button>
          </div>
        </form>

        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-900">Your team</h3>
            <ul className="mt-3 space-y-2">
              {data.peers.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{p.full_name}</span>
                  {p.evaluated ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <span className="text-xs text-slate-400">{p.available ? "Pending" : "Waiting"}</span>}
                </li>
              ))}
            </ul>
            <div className="mt-3 text-xs text-slate-500">{pending.length === 0 ? "All teammates evaluated 🎉" : `${pending.length} remaining`}</div>
          </div>
          <div className="card p-5 text-xs leading-relaxed text-slate-500">
            <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-800"><ShieldCheck className="h-4 w-4 text-brand-600" /> How anonymity works</div>
            Your identity is replaced with a salted SHA-256 hash before storage and comments are encrypted. Teammates only see feedback once at least {data.min_peers} reviews are received, and
            comments pass an AI content filter for toxicity and bias.
          </div>
        </div>
      </div>
    </div>
  );
}
