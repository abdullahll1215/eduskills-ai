"""Skills Passport export (UC-06): PDF with a CSV fallback (UC-06 E6a)."""
import csv
import io
from xml.sax.saxutils import escape

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AIReport, Milestone, User

LEVEL_LABEL = {"ALIGNED": "Aligned", "MODERATE_GAP": "Moderate gap", "CRITICAL_GAP": "Critical blind spot"}


def student_reports(db: Session, student_id: str, project_id: str | None = None) -> list[AIReport]:
    q = select(AIReport).join(Milestone, AIReport.milestone_id == Milestone.id).where(AIReport.student_id == student_id)
    if project_id:
        q = q.where(AIReport.project_id == project_id)
    return list(db.scalars(q.order_by(Milestone.number)))


def to_csv(db: Session, student: User, project_id: str | None = None) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["student", "milestone", "skill", "self", "peer_avg", "instructor", "external_weighted", "delta", "level"])
    for rep in student_reports(db, student.id, project_id):
        for m in rep.metrics:
            w.writerow([
                student.full_name, f"M{rep.milestone.number} {rep.milestone.name}", m.competency.skill_name,
                m.self_score, m.peer_avg, m.instructor_score, m.external_avg, m.gap_score, m.level,
            ])
    return buf.getvalue()


def to_pdf(db: Session, student: User, project_id: str | None = None) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import cm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    reports = student_reports(db, student.id, project_id)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=1.6 * cm, bottomMargin=1.6 * cm,
                            title=f"Skills Passport - {student.full_name}")
    styles = getSampleStyleSheet()
    brand = colors.HexColor("#4f46e5")
    h1 = ParagraphStyle("h1", parent=styles["Title"], textColor=brand, alignment=0, fontSize=20)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], textColor=colors.HexColor("#111827"), spaceBefore=12)
    body = ParagraphStyle("body", parent=styles["BodyText"], fontSize=9.5, leading=13)
    small = ParagraphStyle("small", parent=body, textColor=colors.HexColor("#6b7280"), fontSize=8.5)

    story = [
        Paragraph("EduSkills AI - Skills Passport", h1),
        Paragraph(
            f"<b>{escape(student.full_name)}</b> &nbsp;|&nbsp; {escape(student.student_number or '')} &nbsp;|&nbsp; "
            f"{escape(student.email)}", body),
        Paragraph("Longitudinal 360-degree soft-skills record (self, anonymous peers, instructor). "
                  "External score = 60% instructor + 40% peer average.", small),
        Spacer(1, 10),
    ]
    if not reports:
        story.append(Paragraph("No completed assessments are available yet.", body))

    # Growth summary across milestones
    if reports:
        rows = [["Milestone", "Self", "External", "Delta", "Status"]]
        for rep in reports:
            rows.append([f"M{rep.milestone.number} - {rep.milestone.name}", f"{rep.overall_self:.2f}",
                         f"{rep.overall_external:.2f}", f"{rep.overall_gap:.2f}", LEVEL_LABEL.get(rep.overall_level, rep.overall_level)])
        story += [Paragraph("Growth trajectory", h2), _table(rows, brand)]

    for rep in reports:
        story.append(Paragraph(f"M{rep.milestone.number} - {escape(rep.milestone.name)}", h2))
        rows = [["Skill", "Self", "Peers", "Instructor", "External", "Delta", "Level"]]
        for m in rep.metrics:
            rows.append([m.competency.skill_name, _f(m.self_score), _f(m.peer_avg), _f(m.instructor_score),
                         _f(m.external_avg), _f(m.gap_score), LEVEL_LABEL.get(m.level, m.level)])
        story.append(_table(rows, brand))
        story.append(Spacer(1, 6))
        content = rep.content or {}
        if content.get("headline"):
            story.append(Paragraph(f"<b>{escape(content['headline'])}</b>", body))
        for p in content.get("paragraphs", []):
            story.append(Paragraph(escape(p), body))
        if content.get("actionable_steps"):
            story.append(Paragraph("<b>Actionable steps</b>", body))
            for s in content["actionable_steps"]:
                story.append(Paragraph("• " + escape(s), body))
        story.append(Paragraph(f"Generated {rep.generated_at:%Y-%m-%d} ({'AI' if rep.source == 'ai' else 'template'})", small))

    doc.build(story)
    return buf.getvalue()


def _f(v):
    return "-" if v is None else f"{v:.2f}".rstrip("0").rstrip(".")


def _table(rows, brand):
    from reportlab.lib import colors
    from reportlab.platypus import Table, TableStyle

    t = Table(rows, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), brand),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f4f6")]),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d1d5db")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t
