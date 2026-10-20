import { CheckCircle2, HardDriveDownload, Info, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";
import { Alert, askConfirm, Loading, PageHeader, fmtDate, useFetch } from "../../components/ui";
import { useT } from "../../i18n";

interface Backup {
  id: string;
  filename: string;
  size_bytes: number;
  checksum: string;
  verified: boolean;
  details: string;
  created_at: string;
}

export default function Maintenance() {
  const t = useT();
  const { data, loading, reload } = useFetch(() => api<Backup[]>("/api/admin/backups"));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);

  const backup = async () => {
    setBusy(true);
    try {
      const r = await api<Backup>("/api/admin/backups", { method: "POST" });
      setMsg({ kind: r.verified ? "success" : "info", text: r.verified ? t("Backup {file} created and verified ({details}).", { file: r.filename, details: r.details }) : t("Data export created. Restore verification is still required. {details}", { details: r.details }) });
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const purge = async () => {
    if (!(await askConfirm(t("Run the data-retention purge? Chat history, notifications and audit logs older than the retention window will be permanently deleted.")))) return;
    const r = await api<{ retention_days: number; deleted: Record<string, number | string> }>("/api/admin/retention/purge", { method: "POST" });
    const counts = Object.entries(r.deleted).filter(([k]) => k !== "cutoff").map(([k, v]) => `${k}: ${v}`).join(", ");
    setMsg({ kind: "info", text: t("Retention purge complete ({days} days). Deleted — {counts}.", { days: r.retention_days, counts }) });
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("Backup & Retention")} subtitle={t("Create database backups and manage data retention. Check verification details before relying on a backup.")} />
      {msg && <Alert kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-6">
          <h2 className="font-semibold text-slate-900">{t("Database backup")}</h2>
          <p className="mt-1 text-sm text-slate-500">{t("Creates a consistent backup with a SHA-256 checksum. PostgreSQL exports require a separate restore test.")}</p>
          <button className="btn-primary mt-4" onClick={backup} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDriveDownload className="h-4 w-4" />} {t("Run backup now")}</button>
        </div>
        <div className="card p-6">
          <h2 className="font-semibold text-slate-900">{t("Data retention purge")}</h2>
          <p className="mt-1 text-sm text-slate-500">{t("Removes operational personal data (chat, notifications, audit logs) older than the configured retention window. Evaluation history is preserved for longitudinal tracking.")}</p>
          <button className="btn-danger mt-4" onClick={purge}><Trash2 className="h-4 w-4" /> {t("Run purge")}</button>
        </div>
      </div>
      {loading ? (
        <Loading />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50"><tr><th className="th">{t("Created")}</th><th className="th">{t("File")}</th><th className="th">{t("Size")}</th><th className="th">{t("Verified")}</th><th className="th">{t("Details")}</th><th className="th">SHA-256</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data?.map((b) => (
                <tr key={b.id}>
                  <td className="td whitespace-nowrap">{fmtDate(b.created_at, true)}</td>
                  <td className="td font-mono text-xs">{b.filename}</td>
                  <td className="td">{t("{n} KB", { n: (b.size_bytes / 1024).toFixed(0) })}</td>
                  <td className="td">{b.verified ? <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-label={t("Verified")} /> : <Info className="h-5 w-5 text-slate-500" aria-label={t("Restore not verified")} />}</td>
                  <td className="td text-xs text-slate-500">{b.details}</td>
                  <td className="td font-mono text-[10px] text-slate-400">{b.checksum.slice(0, 16)}…</td>
                </tr>
              ))}
              {data?.length === 0 && <tr><td colSpan={6} className="td py-8 text-center text-slate-400">{t("No backups yet.")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
