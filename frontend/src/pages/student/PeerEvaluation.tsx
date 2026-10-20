import { CheckCircle2, Search, ShieldAlert, ShieldCheck, Users, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { Competency, Milestone } from "../../api/types";
import { Alert, Loading, PageHeader, useFetch } from "../../components/ui";
import { useT } from "../../i18n";
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
  status: "available" | "evaluated" | "waiting_self" | "closed" | "view_only";
}

const STATUS_LABEL: Record<Target["status"], string> = {
  available: "",
  view_only: "View summary only",
  evaluated: "Evaluated",
  waiting_self: "Self-assessment pending",
  closed: "No open evaluation period",
};

function TargetPicker({ value, onPick, version }: { value: Target | null; onPick: (t: Target | null) => void; version: number }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Target[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      api<Target[]>("/api/student/evaluation-targets", { params: { q } }).then(setResults).catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
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
        <button type="button" className="btn-ghost p-2" onClick={() => onPick(null)} aria-label={t("Change student")}><X className="h-4 w-4" /></button>
      </div>
    );
  }
  return (
    <div ref={box} className="relative">
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        id="target-search"
        className="input ps-9"
        dir="auto"
        placeholder={t("Search any student by name or university ID...")}
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          // Enter picks the first student that can be evaluated, instead of submitting the form.
          if (e.key !== "Enter") return;
          e.preventDefault();
          const first = results.find((r) => r.status === "available");
          if (first) {
            onPick(first);
            setOpen(false);
            setQ("");
          }
        }}
      />
      {q.trim() && !open && <p className="mt-1.5 text-xs text-amber-700">{t("Choose the student from the list.")}</p>}
      {open && (
        <div className="card absolute z-30 mt-1 max-h-80 w-full overflow-y-auto py-1">
          {results.length === 0 && <div className="px-4 py-3 text-sm text-slate-500">{t("No students found.")}</div>}
          {results.map((r) => {
            const ok = r.status === "available";
            return (
              <button
                key={r.id}
                type="button"
                disabled={!ok && r.status !== "view_only"}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-start hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => {
                  if (r.status === "view_only") { navigate(`/student/feedback?student=${r.id}`); return; }
                  onPick(r);
                  setOpen(false);
                  setQ("");
                }}
              >
                <span>
                  <span className="block text-sm font-medium text-slate-800">{r.full_name}</span>
                  <span className="block text-xs text-slate-500">{[r.student_number, r.team, r.project].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {r.is_teammate && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">{t("Teammate")}</span>}
                  {!ok && <span className="text-[11px] text-slate-400">{t(STATUS_LABEL[r.status])}</span>}
                  {r.status === "evaluated" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
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
}

export default function PeerEvaluation() {
  const t = useT();
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
    const timer = setTimeout(() => {
      api<Check>("/api/student/peer-check", { body: { comment } }).then(setCheck).catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer);
  }, [comment]);

  if (l1 || l2) return <Loading />;
  if (error || !comps) return <Alert kind="error">{error}</Alert>;

  const pending = data?.peers.filter((p) => !p.evaluated) ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!target) return setMsg({ kind: "error", text: t("Select a student to evaluate.") });
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
      <PageHeader title={t("Give Feedback")} subtitle={t("Evaluate only your own teammates. Search other students to view their published feedback summary; you cannot evaluate them.")} />

      {!data?.peers.length && <div className="mb-5"><Alert>{t("You can explore student summaries now. Join a team when you want to give peer feedback.")} <Link className="underline" to="/student/artifacts">{t("Join a team")}</Link></Alert></div>}
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <form onSubmit={submit} className="card p-6">
          {msg && (
            <div className="mb-4">
              <Alert kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Alert>
            </div>
          )}
          <label className="label">{t("Student to evaluate")}</label>
          <TargetPicker value={target} onPick={setTarget} version={version} />

          <div className="mt-6 border-t border-slate-100 pt-5">
            <h3 className="font-semibold text-slate-900">{t("Quantitative Assessment (1-5 Scale)")}</h3>
            <div className="divide-y divide-slate-50">
              {comps.map((c) => (
                <RatingSlider key={c.id} label={t(c.skill_name)} value={ratings[c.id] ?? 3} rubric={c.rubric} onChange={(v) => setRatings({ ...ratings, [c.id]: v })} />
              ))}
            </div>
          </div>

          <div className="mt-4 border-t border-slate-100 pt-5">
            <h3 className="font-semibold text-slate-900">{t("Qualitative Feedback (optional)")}</h3>
            <p className="mb-2 text-xs text-slate-500">{t("Provide constructive examples of the student's performance.")}</p>
            <textarea
              className="input min-h-[110px]"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t("e.g., Ahmed is great at organizing meetings, but sometimes struggles to accept alternative ideas...")}
            />
            {/* Any comment is accepted; only abusive text is flagged for the instructor. */}
            {check?.is_toxic && (
              <div className="mt-2">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
                  <ShieldAlert className="h-3.5 w-3.5" /> {t("{reason} — this comment will be held for instructor review", { reason: check.reason ?? "" })}
                </span>
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-end gap-2">
            {!target && <span className="me-auto text-xs text-slate-400">{t("Select a student to evaluate.")}</span>}
            <button type="button" className="btn-ghost" onClick={reset}>{t("Cancel")}</button>
            <button className="btn-primary" disabled={busy || !target || !target.is_teammate || target.status !== "available"}>{t("Submit Evaluation")}</button>
          </div>
        </form>

        <div className="space-y-4">
          {data && data.peers.length > 0 && (
            <div className="card p-5">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Users className="h-4 w-4 text-brand-600" /> {t("Your team")}</h3>
              <ul className="mt-3 space-y-1">
                {data.peers.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={p.evaluated || !p.available}
                      onClick={() => setTarget({ id: p.id, full_name: p.full_name, student_number: null, team: null, project: null, is_teammate: true, status: "available" })}
                      className="flex w-full items-center justify-between rounded-md px-2 py-1 text-start text-sm hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span className="text-slate-700">{p.full_name}</span>
                      {p.evaluated ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <span className="text-xs text-slate-400">{p.available ? t("Pending") : t("Waiting")}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 text-xs text-slate-500">{pending.length === 0 ? t("All teammates evaluated 🎉") : t("{n} remaining · tap a name to evaluate", { n: pending.length })}</div>
            </div>
          )}
          <div className="card p-5 text-xs leading-relaxed text-slate-500">
            <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-800"><ShieldCheck className="h-4 w-4 text-brand-600" /> {t("How anonymity works")}</div>
            {t("Your identity is replaced with a salted SHA-256 hash before storage and comments are encrypted. Students only see feedback once at least {n} reviews are received, and comments pass an AI content filter for toxicity and bias.", { n: data?.min_peers ?? 3 })}
          </div>
        </div>
      </div>
    </div>
  );
}
