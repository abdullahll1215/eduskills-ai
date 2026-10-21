import catalog from "../../../backend/app/data/is_courses.json";
import type { Lang } from "../i18n";

export const IS_COURSES = catalog.courses;
export type Course = typeof IS_COURSES[number];
export const courseByCode = (code: string) => IS_COURSES.find(course => course.code === code);
export const courseName = (course: Course, lang: Lang) => lang === "ar" ? course.name_ar : course.name_en;
export const latinDigits = (text: string) => text.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) - (digit <= "٩" ? 0x660 : 0x6f0)));
const searchable = (text: string) => latinDigits(text).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f\u064b-\u065f\u0670ـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const index = IS_COURSES.map(course => ({ course, text: searchable(`${course.code} ${course.name_ar} ${course.name_en}`) }));
export function searchCourses(query: string): Course[] {
  const terms = searchable(query).split(/\s+/).filter(Boolean);
  return index.filter(({ text }) => terms.every(term => text.includes(term))).map(({ course }) => course);
}
