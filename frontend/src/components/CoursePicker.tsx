import { Check, Search } from "lucide-react";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { courseByCode, courseName, latinDigits, searchCourses, type Course } from "../data/courseCatalog";
import { useLang, useT } from "../i18n";

/** Catalog lookup is local; choosing a subject never enrolls or creates a course. */
export default function CoursePicker({ code, onChange, required = true }: { code: string; onChange: (code: string) => void; required?: boolean }) {
  const t = useT();
  const { lang } = useLang();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const results = searchCourses(query);
  const selected = courseByCode(code);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const choose = (course: Course) => {
    onChange(course.code); setQuery(courseName(course, lang)); setOpen(false); setActive(-1); input.current?.focus();
  };
  useEffect(() => {
    if (open && active >= 0) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); setActive(-1); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setOpen(true);
      setActive(index => Math.max(0, Math.min(results.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      if (results[active]) choose(results[active]);
      else if (results.length === 1) choose(results[0]);
    }
  };
  return <div className="course-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <label className="label" htmlFor="course-search">{t("Find your IS course")}</label>
    <div className="course-search-wrap"><Search size={17} aria-hidden="true" />
      <input ref={input} id="course-search" className="input" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls="course-search-results" aria-activedescendant={open && active >= 0 && results[active] ? `course-option-${results[active].code}` : undefined} aria-describedby="course-search-hint" autoComplete="off" spellCheck={false} value={query} placeholder={t("Search by subject name or number…")} onFocus={() => setOpen(true)} onKeyDown={keyDown} onChange={event => { setQuery(event.target.value); onChange(""); setOpen(true); setActive(-1); }} />
    </div>
    <p id="course-search-hint" className="course-field-hint">{t("Arabic or English. Choose a subject to fill its number.")}</p>
    {open && <div className="course-search-panel">
      <div className="course-search-caption" role="status">{t("{n} matching courses", { n: results.length })}</div>
      <ul ref={list} id="course-search-results" role="listbox" aria-label={t("IS study-plan courses")}>
        {results.map((course, index) => <li key={course.code} id={`course-option-${course.code}`} role="option" aria-selected={selected?.code === course.code} className={active === index ? "is-active" : ""} onMouseDown={event => event.preventDefault()} onClick={() => choose(course)}>
          <div><strong>{courseName(course, lang)}</strong><span lang={lang === "ar" ? "en" : "ar"} dir="auto">{lang === "ar" ? course.name_en : course.name_ar}</span></div>
          <code dir="ltr" translate="no">{course.code}</code>{selected?.code === course.code && <Check size={15} aria-hidden="true" />}
        </li>)}
      </ul>
      {!results.length && <p className="course-search-empty">{t("No matching subject. You can enter a course number below.")}</p>}
    </div>}
    <label className="label course-number-label" htmlFor="team-course-number">{t("Course number")}</label>
    <input id="team-course-number" name="course_number" className="input course-number-input" dir="ltr" required={required} inputMode="numeric" pattern="[0-9 -]{4,14}" maxLength={14} autoComplete="off" spellCheck={false} value={code} onFocus={() => setOpen(false)} onChange={event => { const value = latinDigits(event.target.value); onChange(value); const course = courseByCode(value); setQuery(course ? courseName(course, lang) : ""); }} placeholder="0922420" aria-describedby="course-number-hint" />
    <p id="course-number-hint" className="course-field-hint">{t(required ? "You can also enter a number for a course outside this plan." : "Enter another number, or leave blank to generate one.")}</p>
  </div>;
}
