import { ArrowLeft, GraduationCap, Lock, MessageSquareQuote, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { Alert, Empty, Loading, PageHeader, fmt, fmtDate, useFetch } from "../../components/ui";
import { useT } from "../../i18n";

interface FeedbackData {
  peer_count: number;
  min_peers: number;
  released: boolean;
  comments: { text: string; sentiment: number }[];
  skills: { name: string; code: string; peer_avg: number | null }[];
  instructor_comments?: { text: string; created_at: string }[];
}

interface DirectoryEntry {
  id: string;
  full_name: string;
  student_number: string | null;
  team: string | null;
  project: string | null;
  is_me: boolean;
}

interface ProfileData {
  student: { id: string; full_name: string; student_number: string | null; team: string | null };
  feedback: FeedbackData | null;
}

/** `who` is another student's first name; omitted when the student is viewing their own feedback. */
function FeedbackView({ data, who }: { data: FeedbackData; who?: string }) {
  const t = useT();
  if (!data.released && !data.instructor_comments?.length) {
    return (
      <Empty title={t("Feedback not released yet")} icon={<Lock className="h-8 w-8 text-slate-400" />}>
        {who
          ? t("To protect reviewer anonymity, feedback is shown once at least {min} teammates have evaluated {name} ({count} received so far).", { min: data.min_peers, name: who, count: data.peer_count })
          : t("To protect reviewer anonymity, feedback is shown once at least {min} teammates have evaluated you ({count} received so far).", { min: data.min_peers, count: data.peer_count })}
      </Empty>
    );
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <div className="card h-fit p-5">
        <h3 className="font-semibold text-slate-900">{t("Peer averages")}</h3>
        <div className="mt-1 text-xs text-slate-500">{t("{n} anonymous reviews", { n: data.peer_count })}</div>
        {data.released ? (
          <div className="mt-4 space-y-3">
            {data.skills.map((s) => (
              <div key={s.code}>
                <div className="flex justify-between text-sm"><span>{t(s.name)}</span><span className="font-semibold">{fmt(s.peer_avg)}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${((s.peer_avg ?? 0) / 5) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500">{t("Shown after {n} peer reviews.", { n: data.min_peers })}</p>
        )}
      </div>
      <div className="space-y-3">
        {data.instructor_comments?.map((c, i) => (
          <div key={`i${i}`} className="card flex gap-3 border-brand-200 bg-brand-50/40 p-5">
            <GraduationCap className="h-5 w-5 shrink-0 text-brand-600" />
            <div>
              <p className="text-sm text-slate-800">"{c.text}"</p>
              <div className="mt-1 text-xs text-brand-700">{t("Instructor · {date}", { date: fmtDate(c.created_at) })}</div>
            </div>
          </div>
        ))}
        {data.released && data.comments.length === 0 && !data.instructor_comments?.length && <Empty title={t("No written comments")} />}
        {data.comments.map((c, i) => (
          <div key={i} className="card flex gap-3 p-5">
            <MessageSquareQuote className={`h-5 w-5 shrink-0 ${c.sentiment > 0.1 ? "text-emerald-500" : c.sentiment < -0.1 ? "text-amber-500" : "text-slate-400"}`} />
            <div>
              <p className="text-sm italic text-slate-700">"{c.text}"</p>
              <div className="mt-1 text-xs text-slate-400">{t("Anonymous teammate")}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StudentSearch({ onPick }: { onPick: (s: DirectoryEntry) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<DirectoryEntry[]>([]);
  const [disabled, setDisabled] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      api<DirectoryEntry[]>("/api/student/directory", { params: { q } })
        .then(setResults)
        .catch((e) => e.status === 403 && setDisabled(true));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (disabled) return null;
  return (
    <div ref={box} className="relative mb-6 max-w-xl">
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        id="student-search"
        className="input ps-9"
        dir="auto"
        placeholder={t("Search any student by name or university ID...")}
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
      />
      {open && (
        <div className="card absolute z-30 mt-1 max-h-80 w-full overflow-y-auto py-1">
          {results.length === 0 && <div className="px-4 py-3 text-sm text-slate-500">{t("No students found.")}</div>}
          {results.map((s) => (
            <button
              key={s.id}
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-start hover:bg-slate-50"
              onClick={() => {
                onPick(s);
                setOpen(false);
                setQ("");
              }}
            >
              <span>
                <span className="block text-sm font-medium text-slate-800">{s.full_name}{s.is_me && ` ${t("(you)")}`}</span>
                <span className="block text-xs text-slate-500">{[s.student_number, s.team, s.project].filter(Boolean).join(" · ")}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OtherStudent({ id, onBack }: { id: string; onBack: () => void }) {
  const t = useT();
  const { data, loading, error } = useFetch(() => api<ProfileData>(`/api/student/profiles/${id}/feedback`), [id]);

  if (loading && !data) return <Loading />;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return null;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{data.student.full_name}</h2>
          <p className="text-sm text-slate-500">{[data.student.student_number, data.student.team].filter(Boolean).join(" · ")}</p>
        </div>
        <button className="btn-outline" onClick={onBack}><ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t("Back to my feedback")}</button>
      </div>
      {data.feedback ? <FeedbackView data={data.feedback} who={data.student.full_name.split(" ")[0]} /> : <Empty title={t("No feedback yet")}>{t("This student has not been evaluated yet.")}</Empty>}
    </div>
  );
}

export default function Feedback() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const viewing = params.get("student");
  const { data, loading, error } = useFetch(() => api<FeedbackData | null>("/api/student/feedback/all"));

  return (
    <div>
      <PageHeader title={t("360° Feedback")} subtitle={t("Your feedback stays anonymous. Search other students to see released score summaries. Only teammates can give peer evaluations.")} />
      <StudentSearch onPick={(s) => setParams(s.is_me ? {} : { student: s.id })} />
      {viewing ? (
        <OtherStudent key={viewing} id={viewing} onBack={() => setParams({})} />
      ) : loading && !data ? (
        <Loading />
      ) : error ? (
        <Alert kind="error">{error}</Alert>
      ) : !data ? (
        <Empty title={t("No feedback yet")}>{t("Search students above to explore published summaries. Join a team when you want to exchange peer feedback.")}</Empty>
      ) : (
        <FeedbackView data={data} />
      )}
    </div>
  );
}
