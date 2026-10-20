"""Instructor portal: evaluation (UC-03), analytics console & moderation (UC-07), cohort reports."""
import csv
import io
from statistics import mean

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import instructor_only
from ..models import (
    AIReport,
    Artifact,
    Evaluation,
    EvalType,
    Intervention,
    Milestone,
    Moderation,
    Project,
    Role,
    SkillRating,
    User,
)
from ..schemas import InstructorEvaluationIn, InterventionIn, ModerationIn
from ..security import decrypt, encrypt
from ..services import ai_engine, analytics, artifacts, audit
from ..services.common import (
    can_manage_project,
    competency_out,
    ensure_manage,
    get_or_404,
    milestone_out,
    students_of_project,
    validate_ratings,
)
from ..services.settings_store import scoring
from .student import _report_out, run_job, trigger_report
from ..services.report_state import is_current, lock_student_milestone

router = APIRouter(prefix="/api/instructor", tags=["instructor"])

STATUS_LABEL = {"ALIGNED": "Aligned", "MODERATE_GAP": "Moderate", "CRITICAL_GAP": "Critical"}


def _project(db: Session, user: User, project_id: str) -> Project:
    p = get_or_404(db, Project, project_id, "Project")
    ensure_manage(user, p)
    return p


def _milestone(db: Session, project: Project, milestone_id: str | None) -> Milestone:
    if milestone_id:
        m = get_or_404(db, Milestone, milestone_id, "Milestone")
        if m.project_id != project.id:
            raise HTTPException(400, "Milestone does not belong to this project")
        return m
    active = next((m for m in project.milestones if m.is_open), None)
    started = [m for m in project.milestones if m.status != "planned"]
    m = active or (started[-1] if started else (project.milestones[0] if project.milestones else None))
    if not m:
        raise HTTPException(404, "This project has no milestones yet")
    return m


@router.get("/projects")
def my_projects(user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    q = select(Project).order_by(Project.created_at.desc())
    if user.role != Role.ADMIN.value:
        q = q.where(Project.instructor_id == user.id)
    return [
        {
            "id": p.id,
            "title": p.title,
            "is_active": p.is_active,
            "milestones": [milestone_out(m) for m in p.milestones],
            "student_count": len(students_of_project(db, p.id)),
        }
        for p in db.scalars(q)
    ]


def _cohort_rows(db: Session, project: Project, m: Milestone) -> list[dict]:
    cfg = scoring(db)
    rows = []
    for student, enr in students_of_project(db, project.id):
        snap = analytics.snapshot(db, student.id, m.id, cfg)
        report = db.scalar(select(AIReport).where(AIReport.student_id == student.id, AIReport.milestone_id == m.id))
        if report and not is_current(db, report):
            report = None
        if report:
            gap, level = report.overall_gap, report.overall_level
            max_gap = max((d.gap_score for d in report.metrics), default=0)
        else:
            worst = snap.max_gap_skill
            level = analytics.overall_level(snap, cfg).value if worst and snap.has_instructor else None
            gap = round(abs((snap.overall_external or 0) - (snap.overall_self or 0)), 2) if level else None
            max_gap = worst.gap if worst and level else None
        if snap.complete:
            status = STATUS_LABEL.get(level or "", "Processing")
        elif snap.has_self and snap.peer_complete:
            status = "Awaiting instructor"
        else:
            status = "Incomplete"
        rows.append(
            {
                "student_id": student.id,
                "full_name": student.full_name,
                "student_number": student.student_number,
                "team": enr.team.team_name if enr.team else None,
                "team_id": enr.team_id,
                "self_done": snap.has_self,
                "peer_count": snap.peer_count,
                "instructor_done": snap.has_instructor,
                "self_avg": snap.overall_self if snap.has_instructor else None,
                "peer_avg": snap.overall_peer,
                "instructor_avg": snap.overall_instructor,
                "external": snap.overall_external if snap.has_instructor else None,
                "gap": gap,
                "max_skill_gap": max_gap,
                "level": level,
                "status": status,
                "ready_for_instructor": snap.has_self and snap.peer_complete and not snap.has_instructor,
                "report_id": report.id if report else None,
            }
        )
    return rows


def _flagged(db: Session, project: Project) -> list[dict]:
    evs = db.scalars(
        select(Evaluation)
        .where(Evaluation.project_id == project.id, Evaluation.moderation_status == Moderation.PENDING.value)
        .order_by(Evaluation.created_at)
    )
    return [
        {
            "id": e.id,
            "target": e.target.full_name,
            "target_id": e.target_id,
            "milestone": f"M{e.milestone.number}",
            "comment": decrypt(e.comment_enc),
            "reason": e.flag_reason,
            "created_at": e.created_at,
        }
        for e in evs
    ]


@router.get("/overview")
def overview(project_id: str, milestone_id: str | None = None, user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    project = _project(db, user, project_id)
    m = _milestone(db, project, milestone_id)
    rows = _cohort_rows(db, project, m)
    flagged = _flagged(db, project)
    at_risk_teams = {r["team"] for r in rows if r["level"] == "CRITICAL_GAP" and r["team"]}
    open_interventions = db.scalars(
        select(Intervention).where(Intervention.project_id == project.id, Intervention.status != "resolved")
    ).all()
    return {
        "project": {"id": project.id, "title": project.title},
        "milestone": milestone_out(m),
        "milestones": [milestone_out(x) for x in project.milestones],
        "stats": {
            "total_students": len(rows),
            "pending_reviews": sum(1 for r in rows if r["ready_for_instructor"]),
            "at_risk_groups": len(at_risk_teams),
            "flagged_comments": len(flagged),
            "completed": sum(1 for r in rows if r["instructor_done"]),
            "open_interventions": len(open_interventions),
        },
        "at_risk_teams": sorted(at_risk_teams),
        "rows": rows,
        "flagged": flagged,
        "interventions": [
            {"id": i.id, "student": i.student.full_name, "reason": i.reason, "status": i.status, "priority": i.priority, "created_at": i.created_at}
            for i in open_interventions
        ],
    }


@router.get("/students/{student_id}")
def student_detail(
    student_id: str, project_id: str, milestone_id: str | None = None, user: User = Depends(instructor_only), db: Session = Depends(get_db)
):
    project = _project(db, user, project_id)
    m = _milestone(db, project, milestone_id)
    student = get_or_404(db, User, student_id, "Student")
    enr = next((e for s, e in students_of_project(db, project.id) if s.id == student.id), None)
    if not enr:
        raise HTTPException(404, "Student is not enrolled in this project")
    cfg = scoring(db)
    snap = analytics.snapshot(db, student.id, m.id, cfg)
    inst = db.scalar(
        select(Evaluation)
        .options(selectinload(Evaluation.ratings))
        .where(Evaluation.milestone_id == m.id, Evaluation.target_id == student.id, Evaluation.eval_type == EvalType.INSTRUCTOR.value)
    )
    peers = db.scalars(
        select(Evaluation).where(Evaluation.milestone_id == m.id, Evaluation.target_id == student.id, Evaluation.eval_type == EvalType.PEER.value)
    ).all()
    arts = db.scalars(select(Artifact).where(Artifact.student_id == student.id, Artifact.milestone_id == m.id)).all()
    report = db.scalar(select(AIReport).where(AIReport.student_id == student.id, AIReport.milestone_id == m.id))
    if report and not is_current(db, report):
        report = None
    history = db.scalars(
        select(AIReport).join(Milestone, AIReport.milestone_id == Milestone.id)
        .where(AIReport.student_id == student.id, AIReport.project_id == project.id).order_by(Milestone.number)
    ).all()
    # The student's self-ratings are hidden until the instructor has submitted, to avoid anchoring bias.
    reveal_self = inst is not None
    return {
        "student": {"id": student.id, "full_name": student.full_name, "email": student.email, "student_number": student.student_number, "level": student.level},
        "team": enr.team.team_name if enr.team else None,
        "milestone": milestone_out(m),
        "milestones": [milestone_out(x) for x in project.milestones],
        "competencies": [competency_out(c) for c in analytics.competencies(db)],
        "status": {"self_done": snap.has_self, "peer_count": snap.peer_count, "min_peers": cfg.min_peer_evaluations, "instructor_done": snap.has_instructor},
        "skills": [
            {
                "competency_id": s.competency_id, "code": s.code, "name": s.name, "peer_avg": s.peer_avg,
                "self": s.self_score if reveal_self else None, "instructor": s.instructor_score,
                "external": s.external if reveal_self else None, "gap": s.gap if reveal_self else None, "level": s.level if reveal_self else None,
            }
            for s in snap.skills
        ],
        "self_evidence": snap.self_evidence if reveal_self else None,
        "peer_comments": [
            {"id": p.id, "text": decrypt(p.comment_enc), "moderation": p.moderation_status, "flag_reason": p.flag_reason, "sentiment": p.sentiment}
            for p in peers
        ],
        "artifacts": [{"id": a.id, "kind": a.kind, "title": a.title, "url": a.url, "metrics": a.metrics, "created_at": a.created_at} for a in arts],
        "artifact_summary": artifacts.summarize([a.metrics for a in arts]),
        "instructor_evaluation": None
        if not inst
        else {"ratings": {r.competency_id: r.score for r in inst.ratings}, "notes": decrypt(inst.notes_enc), "created_at": inst.created_at, "is_locked": inst.is_locked},
        "report": _report_out(report) if report else None,
        "history": [{"milestone": f"M{r.milestone.number}", "self": r.overall_self, "external": r.overall_external, "gap": r.overall_gap, "level": r.overall_level} for r in history if is_current(db, r)],
        "warning_threshold": cfg.instructor_peer_warning,
    }


@router.post("/evaluations")
def submit_instructor_evaluation(
    body: InstructorEvaluationIn, bg: BackgroundTasks, user: User = Depends(instructor_only), db: Session = Depends(get_db)
):
    m = get_or_404(db, Milestone, body.milestone_id, "Milestone")
    project = _project(db, user, m.project_id)
    lock_student_milestone(db, body.target_id, m.id)
    if m.status == "planned":
        raise HTTPException(409, "This milestone has not started yet")
    if not any(s.id == body.target_id for s, _ in students_of_project(db, project.id)):
        raise HTTPException(404, "Student is not enrolled in this project")
    cfg = scoring(db)
    snap = analytics.snapshot(db, body.target_id, m.id, cfg)
    if not snap.has_self:
        raise HTTPException(409, "Precondition failed: the student has not submitted the self-assessment (UC-01)")
    if not snap.peer_complete:
        raise HTTPException(409, f"Precondition failed: at least {cfg.min_peer_evaluations} peer evaluations are required (UC-02)")
    existing = db.scalar(
        select(Evaluation).where(Evaluation.milestone_id == m.id, Evaluation.target_id == body.target_id, Evaluation.eval_type == EvalType.INSTRUCTOR.value)
    )
    if existing and existing.is_locked:
        raise HTTPException(409, "The evaluation for this student is locked. An administrator can unlock it.")
    ratings = validate_ratings(db, body.ratings)

    # UC-03 E5a: significant instructor/peer perception difference
    warnings = []
    for s in snap.skills:
        if s.peer_avg is not None and abs(ratings[s.competency_id] - s.peer_avg) > cfg.instructor_peer_warning:
            warnings.append(f"{s.name}: your score {ratings[s.competency_id]} vs peer average {s.peer_avg:.1f}")
    if warnings and not body.acknowledge_warnings:
        return {"saved": False, "requires_confirmation": True, "warnings": warnings}

    if existing:
        db.delete(existing)
        db.flush()
    ev = Evaluation(
        project_id=m.project_id,
        milestone_id=m.id,
        evaluator_id=user.id,
        target_id=body.target_id,
        eval_type=EvalType.INSTRUCTOR.value,
        reviewer_key=EvalType.INSTRUCTOR.value,
        notes_enc=encrypt(body.notes.strip()),
        is_locked=True,
    )
    ev.ratings = [SkillRating(competency_id=cid, score=s) for cid, s in ratings.items()]
    db.add(ev)
    audit.log(db, user, "evaluation.instructor_submitted", "evaluation", ev.id, f"milestone=M{m.number} warnings={len(warnings)}")
    db.commit()
    run_job(bg, trigger_report, body.target_id, m.id, True)
    final = analytics.snapshot(db, body.target_id, m.id, cfg)
    return {"saved": True, "warnings": warnings, "external": final.overall_external, "id": ev.id}


@router.post("/moderation/{evaluation_id}")
def moderate(evaluation_id: str, body: ModerationIn, bg: BackgroundTasks, user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    ev = get_or_404(db, Evaluation, evaluation_id, "Evaluation")
    lock_student_milestone(db, ev.target_id, ev.milestone_id)
    _project(db, user, ev.project_id)
    if ev.eval_type != EvalType.PEER.value:
        raise HTTPException(400, "Only peer feedback can be moderated")
    if body.action == "approve":
        ev.moderation_status = Moderation.APPROVED.value  # UC-07 E8a: false flag, keep visible
    else:
        ev.moderation_status = Moderation.REMOVED.value
        ev.comment_enc = encrypt("[Removed by moderator]")
    audit.log(db, user, f"moderation.{body.action}", "evaluation", ev.id, ev.flag_reason or "")
    db.commit()
    run_job(bg, trigger_report, ev.target_id, ev.milestone_id, True)
    return {"ok": True, "status": ev.moderation_status}


@router.post("/interventions", status_code=201)
def raise_intervention(body: InterventionIn, user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    student = get_or_404(db, User, body.student_id, "Student")
    project_id = None
    if body.milestone_id:
        project_id = get_or_404(db, Milestone, body.milestone_id, "Milestone").project_id
    else:
        for p in db.scalars(select(Project)):
            if can_manage_project(user, p) and any(s.id == student.id for s, _ in students_of_project(db, p.id)):
                project_id = p.id
                break
    if not project_id:
        raise HTTPException(400, "Could not resolve the project for this student")
    _project(db, user, project_id)
    i = Intervention(
        student_id=student.id, project_id=project_id, milestone_id=body.milestone_id, raised_by_id=user.id, reason=body.reason, priority=body.priority
    )
    db.add(i)
    audit.notify_role(db, Role.ADVISOR, f"Intervention requested: {student.full_name}", body.reason, "alert", "/advisor")
    audit.log(db, user, "intervention.raised", "intervention", i.id, body.reason[:200])
    db.commit()
    return {"id": i.id}


@router.post("/reports/{student_id}/{milestone_id}/regenerate")
def regenerate(student_id: str, milestone_id: str, user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    m = get_or_404(db, Milestone, milestone_id, "Milestone")
    _project(db, user, m.project_id)
    rep = ai_engine.generate_report(db, student_id, milestone_id, force=True)
    if not rep:
        raise HTTPException(409, "The 360° evaluation is not complete for this student yet")
    audit.log(db, user, "report.regenerated", "ai_report", rep.id)
    db.commit()
    return _report_out(rep)


@router.get("/cohort-report")
def cohort_report(project_id: str, user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    project = _project(db, user, project_id)
    comps = analytics.competencies(db)
    by_milestone = []
    for m in project.milestones:
        reports = [r for r in db.scalars(select(AIReport).where(AIReport.milestone_id == m.id)) if is_current(db, r)]
        if not reports:
            continue
        skills = {}
        for c in comps:
            ds = [d for r in reports for d in r.metrics if d.competency_id == c.id]
            skills[c.code] = {
                "name": c.skill_name,
                "self": round(mean(d.self_score for d in ds), 2) if ds else None,
                "external": round(mean(d.external_avg for d in ds), 2) if ds else None,
                "gap": round(mean(d.gap_score for d in ds), 2) if ds else None,
                "blind_spots": sum(1 for d in ds if d.level != "ALIGNED"),
            }
        levels = {lv: sum(1 for r in reports if r.overall_level == lv) for lv in STATUS_LABEL}
        by_milestone.append(
            {
                "milestone": f"M{m.number}",
                "name": m.name,
                "reports": len(reports),
                "avg_self": round(mean(r.overall_self for r in reports), 2),
                "avg_external": round(mean(r.overall_external for r in reports), 2),
                "avg_gap": round(mean(r.overall_gap for r in reports), 2),
                "levels": levels,
                "skills": skills,
            }
        )
    teams = []
    for t in project.teams:
        members = [e.user_id for e in t.enrollments]
        latest = []
        for uid in members:
            r = db.scalar(
                select(AIReport).join(Milestone, AIReport.milestone_id == Milestone.id)
                .where(AIReport.student_id == uid, AIReport.project_id == project.id).order_by(Milestone.number.desc())
            )
            if r:
                latest.append(r)
        teams.append(
            {
                "team": t.team_name,
                "members": len(members),
                "avg_external": round(mean(r.overall_external for r in latest), 2) if latest else None,
                "critical": sum(1 for r in latest if r.overall_level == "CRITICAL_GAP"),
                "moderate": sum(1 for r in latest if r.overall_level == "MODERATE_GAP"),
            }
        )
    return {"project": {"id": project.id, "title": project.title}, "milestones": by_milestone, "teams": teams, "competencies": [competency_out(c) for c in comps]}


@router.get("/evaluations")
def search_evaluations(
    project_id: str,
    milestone_id: str | None = None,
    student_id: str | None = None,
    eval_type: str | None = None,
    user: User = Depends(instructor_only),
    db: Session = Depends(get_db),
):
    """Search and filter evaluation records by student or milestone (peer reviewers stay anonymous)."""
    _project(db, user, project_id)
    q = select(Evaluation).options(selectinload(Evaluation.ratings)).where(Evaluation.project_id == project_id)
    if milestone_id:
        q = q.where(Evaluation.milestone_id == milestone_id)
    if student_id:
        q = q.where(Evaluation.target_id == student_id)
    if eval_type:
        q = q.where(Evaluation.eval_type == eval_type)
    comps = {c.id: c.skill_name for c in analytics.competencies(db)}
    return [
        {
            "id": e.id,
            "milestone": f"M{e.milestone.number}",
            "student": e.target.full_name,
            "eval_type": e.eval_type,
            "evaluator": "Anonymous" if e.eval_type == "peer" else ("Self" if e.eval_type == "self" else "Instructor"),
            "average": round(mean(r.score for r in e.ratings), 2) if e.ratings else None,
            "ratings": {comps.get(r.competency_id, r.competency_id): r.score for r in e.ratings},
            "moderation": e.moderation_status,
            "is_locked": e.is_locked,
            "created_at": e.created_at,
        }
        for e in db.scalars(q.order_by(Evaluation.created_at.desc()).limit(500))
    ]


@router.get("/export.csv")
def export_csv(project_id: str, milestone_id: str | None = None, user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    """Print/Export evaluation reports."""
    project = _project(db, user, project_id)
    m = _milestone(db, project, milestone_id)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["student", "student_number", "team", "self_done", "peer_count", "instructor_done", "self_avg", "peer_avg", "instructor_avg", "external", "gap", "status"])
    for r in _cohort_rows(db, project, m):
        w.writerow([r["full_name"], r["student_number"], r["team"], r["self_done"], r["peer_count"], r["instructor_done"],
                    r["self_avg"], r["peer_avg"], r["instructor_avg"], r["external"], r["gap"], r["status"]])
    audit.log(db, user, "cohort.exported", "project", project.id, f"M{m.number}")
    db.commit()
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="cohort-M{m.number}.csv"'})
