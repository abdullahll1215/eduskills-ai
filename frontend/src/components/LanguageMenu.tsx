import { Check, Globe } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LANGUAGES, useLang, useT } from "../i18n";

/** Globe button that lists the available interface languages. */
export default function LanguageMenu() {
  const { lang, setLang } = useLang();
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(!open)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label={t("Language")} title={t("Language")}>
        <Globe className="h-5 w-5" />
      </button>
      {open && (
        <div className="card absolute end-0 z-40 mt-2 w-44 overflow-hidden py-1">
          <div className="px-4 py-2 text-xs font-medium text-slate-400">{t("Language")}</div>
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              onClick={() => {
                setOpen(false);
                setLang(l.code);
              }}
              className={`flex w-full items-center justify-between px-4 py-2 text-start text-sm hover:bg-slate-50 ${l.code === lang ? "font-semibold text-brand-700" : "text-slate-700"}`}
            >
              {l.name}
              {l.code === lang && <Check className="h-4 w-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
