import { Lock, Trash2, Unlock } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";
import { Alert, askConfirm, Loading, PageHeader, fmt, fmtDate, useFetch } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { ProjectPicker, useInstructorSelection } from "./shared";

interface EvalRow {
  id: string;
  milestone: string;
  student: string;
  eval_type: string;
  evaluator: string;
  average: number | null;
  ratings: Record<string, number>;
  moderation: string;
  is_locked: boolean;
  created_at: string;
}

const MODERATION: Record<string, string> = { pending: "Pending review", approved: "Approved", removed: "Removed" };

export default function EvaluationRecords() {
  const t = useT();
  const { user } = useAuth();
  const sel = useInstructorSelection();
  const [milestone, setMilestone] = useState("");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const { data, loading, error, reload } = useFetch(
    () => (sel.project ? api<EvalRow[]>("/api/instructor/evaluations", { params: { project_id: sel.project.id, milestone_id: milestone, eval_type: type } }) : Promise.resolve([])),
    [sel.project?.id, milestone, type],
  );
  const [msg, setMsg] = useState<string | null>(null);

  if (sel.loading) return <Loading />;
  if (sel.error || error) return <Alert kind="error">{sel.error || error}</Alert>;

  const rows = (data ?? []).filter((r) => r.student.toLowerCase().includes(search.toLowerCase()));
  const isAdmin = user?.role === "admin";

  const act = async (id: string, action: "unlock" | "delete") => {
    if (action === "delete" && !(await askConfirm(t("Permanently delete this evaluation record? This is logged in the audit trail.")))) return;
    try {
      await api(`/api/admin/evaluations/${id}${action === "unlock" ? "/unlock" : ""}`, { method: action === "unlock" ? "POST" : "DELETE" });
      setMsg(action === "unlock" ? t("Record unlocked — the evaluator can now resubmit.") : t("Record deleted."));
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div>
      <PageHeader
        title={t("Evaluation Records")}
        subtitle={t("Search and filter evaluations by student, milestone or source. Peer reviewers always remain anonymous.")}
        actions={<ProjectPicker projects={sel.projects ?? []} value={sel.project?.id} onChange={(id) => sel.set({ project: id })} />}
      />
      {msg && <div className="mb-4"><Alert kind="info" onClose={() => setMsg(null)}>{msg}</Alert></div>}
      <div className="card mb-4 flex flex-wrap gap-3 p-4">
        <input className="input sm:w-60" placeholder={t("Search student...")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input w-auto" value={milestone} onChange={(e) => setMilestone(e.target.value)}>
          <option value="">{t("All milestones")}</option>
          {sel.project?.milestones.map((m) => <option key={m.id} value={m.id}>M{m.number} · {m.name}</option>)}
        </select>
        <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">{t("All sources")}</option>
          <option value="self">{t("Self")}</option>
          <option value="peer">{t("Peer")}</option>
          <option value="instructor">{t("Instructor")}</option>
        </select>
      </div>
      {loading ? (
        <Loading />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">{t("Date")}</th><th className="th">{t("MS")}</th><th className="th">{t("Student")}</th><th className="th">{t("Source")}</th><th className="th">{t("Avg")}</th><th className="th">{t("Ratings")}</th><th className="th">{t("State")}</th>{isAdmin && <th className="th"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="td whitespace-nowrap text-xs text-slate-500">{fmtDate(r.created_at, true)}</td>
                  <td className="td">{r.milestone}</td>
                  <td className="td font-medium">{r.student}</td>
                  <td className="td capitalize">{t(r.evaluator)}</td>
                  <td className="td font-semibold">{fmt(r.average, 2)}</td>
                  <td className="td text-xs text-slate-500">{Object.entries(r.ratings).map(([k, v]) => `${t(k.split(" ")[0])} ${v}`).join(" · ")}</td>
                  <td className="td text-xs">
                    {r.is_locked && <Lock className="inline h-3.5 w-3.5 text-slate-400" />} {r.moderation !== "none" && <span className="badge bg-amber-100 text-amber-700">{t(MODERATION[r.moderation] ?? r.moderation)}</span>}
                  </td>
                  {isAdmin && (
                    <td className="td whitespace-nowrap text-end">
                      {r.eval_type !== "peer" && r.is_locked && <button className="btn-ghost p-1.5" title={t("Unlock")} onClick={() => act(r.id, "unlock")}><Unlock className="h-4 w-4" /></button>}
                      <button className="btn-ghost p-1.5 text-red-500" title={t("Delete")} onClick={() => act(r.id, "delete")}><Trash2 className="h-4 w-4" /></button>
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="td py-10 text-center text-slate-400">{t("No evaluation records match the filters.")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
