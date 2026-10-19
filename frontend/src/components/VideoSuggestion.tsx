import { ExternalLink, PlayCircle } from "lucide-react";
import { useState } from "react";
import type { Metric, Resource } from "../api/types";

// Default YouTube searches per soft skill, used when the AI did not suggest a more specific one.
const QUERIES: Record<string, { en: string; ar: string }> = {
  COMMUNICATION: { en: "how to communicate clearly in a team project", ar: "مهارات التواصل الفعال في فريق العمل" },
  LEADERSHIP: { en: "how to delegate tasks effectively as a team leader", ar: "كيف تفوض المهام كقائد فريق" },
  ADAPTABILITY: { en: "how to adapt to change and accept feedback at work", ar: "مهارة التكيف مع التغيير وتقبل النقد" },
  COLLABORATION: { en: "how to collaborate effectively in a student team project", ar: "مهارات العمل الجماعي والتعاون في الفريق" },
  PROBLEM_SOLVING: { en: "problem solving techniques root cause analysis", ar: "مهارات حل المشكلات والتفكير النقدي" },
};

export function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

const search = (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

/** Recommended video for the skill the student most needs to develop. */
export default function VideoSuggestion({ metrics, resources, aiQuery }: { metrics: Metric[]; resources: Resource[]; aiQuery?: string }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const focus = [...metrics].sort((a, b) => (b.direction === "overestimate" ? b.gap : 0) - (a.direction === "overestimate" ? a.gap : 0) || a.external - b.external)[0];
  if (!focus) return null;
  const q = QUERIES[focus.code] ?? { en: `${focus.skill} soft skill tutorial`, ar: `تطوير مهارة ${focus.skill}` };

  // A real video added by the admin (YouTube link) wins; otherwise a targeted YouTube search.
  const video = resources.find((r) => r.kind === "video" && youtubeId(r.url));
  const vid = video ? youtubeId(video.url) : null;
  const title = video ? video.title : `How to improve your ${focus.skill.toLowerCase()}`;
  const href = video ? video.url : search(aiQuery || q.en);

  return (
    <div className="mt-6">
      <div className="text-sm font-semibold text-slate-800">Recommended video</div>
      <a href={href} target="_blank" rel="noreferrer" className="group mt-2 flex flex-col overflow-hidden rounded-xl border border-slate-200 transition hover:border-brand-300 hover:shadow-md sm:flex-row">
        <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-gradient-to-br from-brand-600 to-indigo-400 sm:w-64">
          {vid && !thumbFailed ? (
            <img src={`https://i.ytimg.com/vi/${vid}/hqdefault.jpg`} alt="" className="h-full w-full object-cover" onError={() => setThumbFailed(true)} />
          ) : (
            <div className="flex h-full flex-col justify-end p-4 text-white">
              <div className="text-xs uppercase tracking-wide text-brand-100">Focus skill</div>
              <div className="text-lg font-bold">{focus.skill}</div>
            </div>
          )}
          <PlayCircle className="absolute left-1/2 top-[38%] h-12 w-12 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow-lg transition group-hover:scale-110" />
        </div>
        <div className="flex flex-1 flex-col justify-center gap-1 p-4">
          <div className="font-semibold text-slate-900 group-hover:text-brand-700">{title}</div>
          <div className="text-sm text-slate-500">
            {video ? `${video.provider || "YouTube"}${video.duration ? ` · ${video.duration}` : ""}` : `Videos matched to your ${focus.skill} gap (Δ ${focus.gap.toFixed(1)})`}
          </div>
          <div className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-brand-600">Watch on YouTube <ExternalLink className="h-3.5 w-3.5" /></div>
        </div>
      </a>
      {!video && (
        <a href={search(q.ar)} target="_blank" rel="noreferrer" dir="rtl" className="mt-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
          شاهد فيديوهات بالعربي عن {q.ar} <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}
