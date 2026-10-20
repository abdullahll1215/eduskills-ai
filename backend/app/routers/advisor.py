"""Student Advisor: receives high-priority alerts and records interventions (context diagram)."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import advisor_only
from ..models import AIReport, Intervention, Milestone, User
from ..schemas import InterventionUpdateIn
from ..services import audit
from ..services.common import get_or_404
from ..services.report_state import is_current

router = APIRouter(prefix="/api/advisor", tags=["advisor"])


def _out(db: Session, i: Intervention) -> dict:
    latest = next((r for r in db.scalars(
        select(AIReport).join(Milestone, AIReport.milestone_id == Milestone.id)
        .where(AIReport.student_id == i.student_id, AIReport.project_id == i.project_id).order_by(Milestone.number.desc())
    ) if is_current(db, r)), None)
    return {
        "id": i.id,
        "student": {"id": i.student.id, "full_name": i.student.full_name, "email": i.student.email, "student_number": i.student.student_number},
        "project": i.project.title,
        "milestone": f"M{i.milestone.number}" if i.milestone else None,
        "raised_by": i.raised_by.full_name if i.raised_by else "System (Analytics Engine)",
        "priority": i.priority,
        "reason": i.reason,
        "status": i.status,
        "advisor_notes": i.advisor_notes,
        "created_at": i.created_at,
        "updated_at": i.updated_at,
        "latest_report": None
        if not latest
        else {
            "milestone": f"M{latest.milestone.number}",
            "headline": latest.content.get("headline"),
            "overall_self": latest.overall_self,
            "overall_external": latest.overall_external,
            "level": latest.overall_level,
            "skills": [{"skill": d.competency.skill_name, "self": d.self_score, "external": d.external_avg, "gap": d.gap_score, "level": d.level} for d in latest.metrics],
        },
    }


@router.get("/interventions")
def list_interventions(status: str | None = None, user: User = Depends(advisor_only), db: Session = Depends(get_db)):
    q = select(Intervention).order_by(Intervention.created_at.desc())
    if status:
        q = q.where(Intervention.status == status)
    return [_out(db, i) for i in db.scalars(q)]


@router.put("/interventions/{intervention_id}")
def update_intervention(intervention_id: str, body: InterventionUpdateIn, user: User = Depends(advisor_only), db: Session = Depends(get_db)):
    i = get_or_404(db, Intervention, intervention_id, "Intervention")
    i.status = body.status
    if body.advisor_notes is not None:
        i.advisor_notes = body.advisor_notes
    if i.raised_by_id:
        audit.notify(db, i.raised_by_id, f"Intervention {body.status}: {i.student.full_name}", body.advisor_notes or "", "alert", "/instructor")
    audit.log(db, user, f"intervention.{body.status}", "intervention", i.id)
    db.commit()
    return _out(db, i)
