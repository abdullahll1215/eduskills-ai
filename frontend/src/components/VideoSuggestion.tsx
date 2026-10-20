import { ExternalLink, PlayCircle } from "lucide-react";
import { useState } from "react";
import type { Metric, Resource } from "../api/types";
import { useT } from "../i18n";

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

const AR_SKILL: Record<string, string> = {
  COMMUNICATION: "التواصل",
  LEADERSHIP: "القيادة",
  ADAPTABILITY: "التكيّف",
  COLLABORATION: "العمل الجماعي",
  PROBLEM_SOLVING: "حل المشكلات",
};

function VideoCard({ href, thumb, label, skill, title, subtitle, cta, rtl }: { href: string; thumb?: string | null; label: string; skill: string; title: string; subtitle: string; cta: string; rtl?: boolean }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  return (
    <a href={href} target="_blank" rel="noreferrer" dir={rtl ? "rtl" : undefined} className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 transition hover:border-brand-300 hover:shadow-md sm:flex-row">
      <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-brand-600 sm:w-64">
        {thumb && !thumbFailed ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" onError={() => setThumbFailed(true)} />
        ) : (
          <div className="flex h-full flex-col justify-end p-4 text-white">
            <div className={`text-xs text-brand-100 ${rtl ? "" : "uppercase tracking-wide"}`}>{label}</div>
            <div className="text-lg font-bold">{skill}</div>
          </div>
        )}
        <PlayCircle className="absolute left-1/2 top-[38%] h-12 w-12 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow-lg transition group-hover:scale-110" />
      </div>
      <div className="flex flex-1 flex-col justify-center gap-1 p-4">
        <div className="font-semibold text-slate-900 group-hover:text-brand-700">{title}</div>
        <div className="text-sm text-slate-500">{subtitle}</div>
        <div className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-brand-600">{cta} <ExternalLink className="h-3.5 w-3.5" /></div>
      </div>
    </a>
  );
}

/** Recommended videos (English and Arabic) for the skill the student most needs to develop. */
export default function VideoSuggestion({ metrics, resources, aiQuery }: { metrics: Metric[]; resources: Resource[]; aiQuery?: string }) {
  const t = useT();
  const focus = [...metrics].sort((a, b) => (b.direction === "overestimate" ? b.gap : 0) - (a.direction === "overestimate" ? a.gap : 0) || a.external - b.external)[0];
  if (!focus) return null;
  const q = QUERIES[focus.code] ?? { en: `${focus.skill} soft skill tutorial`, ar: `تطوير مهارة ${focus.skill}` };
  const arSkill = AR_SKILL[focus.code] ?? focus.skill;

  // A real video added by the admin (YouTube link) wins; otherwise a targeted YouTube search.
  const video = resources.find((r) => r.kind === "video" && youtubeId(r.url));
  const vid = video ? youtubeId(video.url) : null;

  return (
    <div className="mt-6">
      <div className="text-sm font-semibold text-slate-800">{t("Recommended videos")}</div>
      <div className="mt-2 grid gap-3">
        {video ? (
          <VideoCard
            href={video.url}
            thumb={vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : null}
            label={t("Focus skill")}
            skill={t(focus.skill)}
            title={video.title}
            subtitle={`${video.provider || "YouTube"}${video.duration ? ` · ${video.duration}` : ""}`}
            cta={t("Watch on YouTube")}
          />
        ) : (
          <VideoCard
            href={search(aiQuery || q.en)}
            label={t("Focus skill")}
            skill={t(focus.skill)}
            title={t("How to improve your {skill}", { skill: t(focus.skill).toLowerCase() })}
            subtitle={t("Videos matched to your {skill} gap (Δ {gap})", { skill: t(focus.skill), gap: focus.gap.toFixed(1) })}
            cta={t("Watch on YouTube")}
          />
        )}
        <VideoCard
          rtl
          href={search(q.ar)}
          label="المهارة المستهدفة"
          skill={arSkill}
          title={`كيف تطوّر مهارة ${arSkill}`}
          subtitle={`فيديوهات بالعربي تناسب الفجوة في مهارة ${arSkill} (Δ ${focus.gap.toFixed(1)})`}
          cta="شاهد على يوتيوب"
        />
      </div>
    </div>
  );
}
