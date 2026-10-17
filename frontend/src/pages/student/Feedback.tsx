import { Lock, MessageSquareQuote } from "lucide-react";
import { api } from "../../api/client";
import { Alert, Empty, Loading, PageHeader, fmt, useFetch } from "../../components/ui";
import { MilestoneTabs, useStudentMilestone } from "./shared";

interface FeedbackData {
  peer_count: number;
  min_peers: number;
  released: boolean;
  comments: { text: string; sentiment: number }[];
  skills: { name: string; code: string; peer_avg: number | null }[];
}

export default function Feedback() {
  const { milestones, milestone, select, loading: l1, error: e1 } = useStudentMilestone("latest-report");
  const { data, loading, error } = useFetch(
    () => (milestone ? api<FeedbackData>("/api/student/feedback", { params: { milestone_id: milestone.id } }) : Promise.resolve(null)),
    [milestone?.id],
  );

  if (l1 || (loading && !data)) return <Loading />;
  if (e1 || error) return <Alert kind="error">{e1 || error}</Alert>;
  if (!milestone || !data) return <Alert>No milestones available.</Alert>;

  return (
    <div>
      <PageHeader title="Peer Feedback Summary" subtitle="Anonymous feedback from your teammates. Reviewer identities are never revealed." />
      <MilestoneTabs milestones={milestones} value={milestone.id} onChange={select} />
      {!data.released ? (
        <Empty title="Feedback not released yet" icon={<Lock className="h-8 w-8 text-slate-400" />}>
          To protect reviewer anonymity, feedback is shown once at least {data.min_peers} teammates have evaluated you ({data.peer_count} received so far).
        </Empty>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <div className="card h-fit p-5">
            <h3 className="font-semibold text-slate-900">Peer averages</h3>
            <div className="mt-1 text-xs text-slate-500">{data.peer_count} anonymous reviews</div>
            <div className="mt-4 space-y-3">
              {data.skills.map((s) => (
                <div key={s.code}>
                  <div className="flex justify-between text-sm"><span>{s.name}</span><span className="font-semibold">{fmt(s.peer_avg)}</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${((s.peer_avg ?? 0) / 5) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            {data.comments.length === 0 && <Empty title="No written comments" />}
            {data.comments.map((c, i) => (
              <div key={i} className="card flex gap-3 p-5">
                <MessageSquareQuote className={`h-5 w-5 shrink-0 ${c.sentiment > 0.1 ? "text-emerald-500" : c.sentiment < -0.1 ? "text-amber-500" : "text-slate-400"}`} />
                <div>
                  <p className="text-sm italic text-slate-700">"{c.text}"</p>
                  <div className="mt-1 text-xs text-slate-400">Anonymous teammate</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
