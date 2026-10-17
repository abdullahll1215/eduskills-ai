import { useState } from "react";
import { api } from "../../api/client";
import { Loading, PageHeader, fmtDate, useFetch } from "../../components/ui";

interface Log {
  id: string;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  details: string;
  created_at: string;
}

export default function Audit() {
  const [action, setAction] = useState("");
  const { data, loading } = useFetch(() => api<Log[]>("/api/admin/audit-logs", { params: { action } }), [action]);

  return (
    <div>
      <PageHeader title="Audit Logs" subtitle="Every administrative and evaluation action is logged. Peer reviewers appear as “System” to preserve anonymity." />
      <div className="card mb-4 p-4">
        <input className="input sm:w-80" placeholder="Filter by action (e.g. moderation, evaluation, settings)" value={action} onChange={(e) => setAction(e.target.value)} />
      </div>
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50"><tr><th className="th">Time</th><th className="th">Actor</th><th className="th">Action</th><th className="th">Entity</th><th className="th">Details</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data?.map((l) => (
                <tr key={l.id}>
                  <td className="td whitespace-nowrap text-xs text-slate-500">{fmtDate(l.created_at, true)}</td>
                  <td className="td">{l.actor}</td>
                  <td className="td font-mono text-xs">{l.action}</td>
                  <td className="td text-xs text-slate-500">{l.entity}</td>
                  <td className="td max-w-md truncate text-xs text-slate-500" title={l.details}>{l.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
