import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui";
import Perspectives from "../../components/Perspectives";
import { useT } from "../../i18n";
import { TeamStrip } from "./TeamSetup";

const paths = [
  { to: "/student/feedback", title: "Explore student feedback", detail: "Read published score summaries. Peer evaluations are for your own teammates." },
  { to: "/student/artifacts", title: "My Projects", detail: "Keep your work, evidence and project files in one place." },
  { to: "/student/coach", title: "AI Coach", detail: "Ask a question and find a practical next step for your skills." },
];

export default function Explore() {
  const t = useT();
  return <div>
    <PageHeader title={t("Your workspace")} subtitle={t("Start with yourself. Joining a course or team is optional.")} />
    <div className="explore-layout">
      <section className="explore-primary" aria-labelledby="personal-heading">
        <div className="section-kicker">01 / {t("Individual practice")}</div>
        <h2 id="personal-heading">{t("Personal self-assessment")}</h2>
        <p>{t("Assess your own skills privately, without a course or team. Personal ratings are separate from your course assessment.")}</p>
        <Link className="btn-primary" to="/student/self-assessment">{t("Start now")}<ArrowRight className="h-4 w-4 rtl:rotate-180" /></Link>
        <Perspectives />
      </section>
      <section aria-labelledby="explore-heading">
        <div className="explore-list-header"><h2 className="section-kicker" id="explore-heading">{t("Also in your workspace")}</h2><span className="section-kicker" aria-hidden="true" dir="ltr">02 — 04</span></div>
        {paths.map((path, index) => <Link key={path.to} to={path.to} className="explore-row">
          <span className="explore-row-number" aria-hidden="true">0{index + 2}</span>
          <div><h3>{t(path.title)}</h3><p>{t(path.detail)}</p></div>
          <ArrowRight className="explore-row-arrow h-4 w-4 rtl:rotate-180" />
        </Link>)}
      </section>
    </div>
    <section className="explore-membership">
      <div><h2 className="text-sm font-semibold">{t("Coursework & teammates")}</h2><p className="mt-1 text-xs leading-relaxed text-slate-500">{t("Have a course or team code? You can connect it whenever you are ready.")}</p></div>
      <TeamStrip />
    </section>
  </div>;
}
