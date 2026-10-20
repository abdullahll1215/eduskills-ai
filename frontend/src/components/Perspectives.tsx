import { useT } from "../i18n";

/** A conceptual illustration of the three assessment sources, never a chart of student data. */
export default function Perspectives() {
  const t = useT();
  return <div className="perspectives" role="img" aria-label={t("Three assessment perspectives: self, peers and instructor.")}>
    <svg viewBox="0 0 400 240" fill="none" aria-hidden="true">
      <path d="M28 198H372M200 20V218" className="perspective-guide" />
      <circle cx="157" cy="115" r="75" className="perspective-circle perspective-circle-self" />
      <circle cx="243" cy="115" r="75" className="perspective-circle perspective-circle-peer" />
      <circle cx="200" cy="151" r="75" className="perspective-circle perspective-circle-instructor" />
      <path d="M200 92V144M174 118H226" className="perspective-center" />
      <circle cx="200" cy="118" r="5" fill="currentColor" />
      <path d="M82 64L62 40H25M318 64L338 40H375M200 226V238" className="perspective-callout" />
    </svg>
    <span className="perspective-label perspective-label-self">{t("Self")}</span>
    <span className="perspective-label perspective-label-peer">{t("Peers")}</span>
    <span className="perspective-label perspective-label-instructor">{t("Instructor")}</span>
  </div>;
}
