import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";
import { Alert, Empty, LevelBadge, Loading, PageHeader, StatusBadge, fmt, fmtDate, useFetch } from "../../components/ui";
import { useT } from "../../i18n";

interface Item {
  id: string;
  student: { id: string; full_name: string; email: string; student_number: string };
  project: string;
  milestone: string | null;
  raised_by: string;
  priority: string;
  reason: string;
  status: "open" | "acknowledged" | "resolved";
  advisor_notes: string | null;
  created_at: string;
  latest_report: { milestone: string; headline: string; overall_self: number; overall_external: number; level: string; skills: { skill: string; self: number; external: number; gap: number; level: string }[] } | null;
}

const FILTERS: Record<string, string> = { open: "Open", acknowledged: "Acknowledged", resolved: "Resolved", "": "All" };
const PRIORITY: Record<string, string> = { high: "High priority", medium: "Medium priority", normal: "Normal priority", low: "Low priority" };

export default function Interventions() {
  const t = useT();
  const [filter, setFilter] = useState("open");
  const { data, loading, error, reload } = useFetch(() => api<Item[]>("/api/advisor/interventions", { params: { status: filter } }), [filter]);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const update = async (i: Item, status: string) => {
    await api(`/api/advisor/interventions/${i.id}`, { method: "PUT", body: { status, advisor_notes: notes[i.id] ?? i.advisor_notes ?? "" } });
    reload();
  };

  return (
    <div>
      <PageHeader title={t("Intervention Alerts")} subtitle={t("High-priority blind spots and instructor referrals that need advisor follow-up.")} />
      <div className="mb-4 inline-flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {["open", "acknowledged", "resolved", ""].map((s) => (
          <button key={s || "all"} onClick={() => setFilter(s)} className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${filter === s ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            {t(FILTERS[s])}
          </button>
        ))}
      </div>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <Alert kind="error">{error}</Alert>
      ) : data?.length === 0 ? (
        <Empty title={t("No alerts")} icon={<ShieldAlert className="h-8 w-8 text-emerald-500" />}>{t("Nothing needs your attention right now.")}</Empty>
      ) : (
        <div className="space-y-4">
          {data?.map((i) => (
            <div key={i.id} className="card p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-900">{i.student.full_name}</h3>
                    <StatusBadge status={i.status} />
                    <span className={`badge ${i.priority === "high" ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-600"}`}>{PRIORITY[i.priority] ? t(PRIORITY[i.priority]) : t("{p} priority", { p: i.priority })}</span>
                  </div>
                  <div className="text-xs text-slate-500">{i.student.student_number} · {i.student.email} · {i.project} {i.milestone && `· ${i.milestone}`}</div>
                </div>
                <div className="text-end text-xs text-slate-400">{t("Raised by {name}", { name: t(i.raised_by) })}<br />{fmtDate(i.created_at, true)}</div>
              </div>
              <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{i.reason}</p>
              {i.latest_report && (
                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase text-slate-500">{t("Latest report ({milestone}) · self {self} / external {external}", { milestone: i.latest_report.milestone, self: fmt(i.latest_report.overall_self), external: fmt(i.latest_report.overall_external) })}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {i.latest_report.skills.map((s) => (
                      <span key={s.skill} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs">
                        {t(s.skill)}: {s.self}→{fmt(s.external)} <LevelBadge level={s.level} />
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-4">
                <label className="label">{t("Advisor notes")}</label>
                <textarea className="input min-h-[70px]" value={notes[i.id] ?? i.advisor_notes ?? ""} onChange={(e) => setNotes({ ...notes, [i.id]: e.target.value })} placeholder={t("Meeting outcome, agreed actions...")} />
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                {i.status !== "acknowledged" && <button className="btn-outline" onClick={() => update(i, "acknowledged")}>{t("Acknowledge")}</button>}
                {i.status !== "resolved" && <button className="btn-primary" onClick={() => update(i, "resolved")}>{t("Mark resolved")}</button>}
                {i.status === "resolved" && <button className="btn-outline" onClick={() => update(i, "open")}>{t("Reopen")}</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
