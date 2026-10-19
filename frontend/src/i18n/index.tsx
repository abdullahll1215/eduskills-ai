// Interface translations. Keys are the English source strings, so anything not yet translated
// simply shows in English. Placeholders like {name} are filled from the vars argument.
import { ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import ar from "./ar";

export type Lang = "en" | "ar";

export const LANGUAGES: { code: Lang; name: string }[] = [
  { code: "en", name: "English" },
  { code: "ar", name: "العربية" },
];

const DICTIONARIES: Record<Lang, Record<string, string>> = { en: {}, ar };
const KEY = "eduskills.lang";

function stored(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "en" || v === "ar") return v;
  } catch {
    /* storage unavailable */
  }
  return "en";
}

// Module-level copy so plain helpers (dates, dialogs) can translate outside React components.
let current: Lang = stored();

export function getLang(): Lang {
  return current;
}

export function translate(key: string, vars?: Record<string, string | number>): string {
  const text = DICTIONARIES[current][key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}

/** Locale for dates and numbers: Gregorian calendar and Latin digits in both languages. */
export function locale(): string {
  return current === "ar" ? "ar-u-ca-gregory-nu-latn" : "en-US";
}

function applyToDocument(lang: Lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
}
applyToDocument(current);

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: current, setLang: () => undefined });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setState] = useState<Lang>(current);
  const setLang = useCallback((l: Lang) => {
    current = l;
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* keep for this visit only */
    }
    setState(l);
  }, []);
  useEffect(() => applyToDocument(lang), [lang]);
  // Re-mount the tree on change so every page re-renders in the new language.
  return (
    <LangContext.Provider value={{ lang, setLang }}>
      <div key={lang} className="contents">{children}</div>
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}

/** Returns t(key, vars). Components using it re-render when the language changes. */
export function useT() {
  useContext(LangContext);
  return translate;
}
