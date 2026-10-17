import { CheckCircle2, HardDriveDownload, Loader2, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";
import { Alert, askConfirm, Loading, PageHeader, fmtDate, useFetch } from "../../components/ui";

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
  const { data, loading, reload } = useFetch(() => api<Backup[]>("/api/admin/backups"));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);

  const backup = async () => {
    setBusy(true);
    try {
      const r = await api<Backup>("/api/admin/backups", { method: "POST" });
      setMsg({ kind: r.verified ? "success" : "error", text: r.verified ? `Backup ${r.filename} created and verified (${r.details}).` : `Backup verification FAILED — emergency alert raised. ${r.details}` });
      reload();
    } finally {
      setBusy(false);
    }
  };

  const purge = async () => {
    if (!(await askConfirm("Run the data-retention purge? Chat history, notifications and audit logs older than the retention window will be permanently deleted."))) return;
    const r = await api<{ retention_days: number; deleted: Record<string, number | string> }>("/api/admin/retention/purge", { method: "POST" });
    const counts = Object.entries(r.deleted).filter(([k]) => k !== "cutoff").map(([k, v]) => `${k}: ${v}`).join(", ");
    setMsg({ kind: "info", text: `Retention purge complete (${r.retention_days} days). Deleted — ${counts}.` });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Backup & Retention" subtitle="Disaster recovery: database backups with restore-integrity verification, and data-retention policy (GDPR-style compliance)." />
      {msg && <Alert kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-6">
          <h2 className="font-semibold text-slate-900">Database backup</h2>
          <p className="mt-1 text-sm text-slate-500">Creates a consistent copy, re-opens it to run an integrity check and stores a SHA-256 checksum.</p>
          <button className="btn-primary mt-4" onClick={backup} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDriveDownload className="h-4 w-4" />} Run backup now</button>
        </div>
        <div className="card p-6">
          <h2 className="font-semibold text-slate-900">Data retention purge</h2>
          <p className="mt-1 text-sm text-slate-500">Removes operational personal data (chat, notifications, audit logs) older than the configured retention window. Evaluation history is preserved for longitudinal tracking.</p>
          <button className="btn-danger mt-4" onClick={purge}><Trash2 className="h-4 w-4" /> Run purge</button>
        </div>
      </div>
      {loading ? (
        <Loading />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50"><tr><th className="th">Created</th><th className="th">File</th><th className="th">Size</th><th className="th">Verified</th><th className="th">Details</th><th className="th">SHA-256</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data?.map((b) => (
                <tr key={b.id}>
                  <td className="td whitespace-nowrap">{fmtDate(b.created_at, true)}</td>
                  <td className="td font-mono text-xs">{b.filename}</td>
                  <td className="td">{(b.size_bytes / 1024).toFixed(0)} KB</td>
                  <td className="td">{b.verified ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <XCircle className="h-5 w-5 text-red-500" />}</td>
                  <td className="td text-xs text-slate-500">{b.details}</td>
                  <td className="td font-mono text-[10px] text-slate-400">{b.checksum.slice(0, 16)}…</td>
                </tr>
              ))}
              {data?.length === 0 && <tr><td colSpan={6} className="td py-8 text-center text-slate-400">No backups yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
