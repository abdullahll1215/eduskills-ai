"""Project, milestone, team and enrollment management (instructor of the project or admin)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import instructor_only
from ..models import Enrollment, Milestone, Project, Role, Team, User
from ..schemas import EnrollmentIn, MilestoneIn, ProjectIn, TeamIn
from ..services import audit
from ..services.common import ensure_manage, get_or_404, milestone_out, students_of_project, user_out

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _project_out(db: Session, p: Project) -> dict:
    members = students_of_project(db, p.id)
    return {
        "id": p.id,
        "title": p.title,
        "description": p.description,
        "is_active": p.is_active,
        "instructor": {"id": p.instructor.id, "full_name": p.instructor.full_name} if p.instructor else None,
        "milestones": [milestone_out(m) for m in p.milestones],
        "teams": [
            {
                "id": t.id,
                "team_name": t.team_name,
                "members": [{"id": u.id, "full_name": u.full_name, "student_number": u.student_number} for u, e in members if e.team_id == t.id],
            }
            for t in p.teams
        ],
        "unassigned": [{"id": u.id, "full_name": u.full_name} for u, e in members if not e.team_id],
    }


@router.get("")
def list_projects(user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    q = select(Project).order_by(Project.created_at.desc())
    if user.role != Role.ADMIN.value:
        q = q.where(Project.instructor_id == user.id)
    return [_project_out(db, p) for p in db.scalars(q)]


@router.get("/{project_id}")
def get_project(project_id: str, user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    p = get_or_404(db, Project, project_id, "Project")
    ensure_manage(user, p)
    return _project_out(db, p)


@router.post("", status_code=201)
def create_project(body: ProjectIn, user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    instructor_id = body.instructor_id if user.role == Role.ADMIN.value and body.instructor_id else user.id
    p = Project(title=body.title, description=body.description, instructor_id=instructor_id, is_active=body.is_active)
    db.add(p)
    db.flush()
    for i, name in enumerate(["Requirements", "Design", "Implementation"], start=1):
        db.add(Milestone(project_id=p.id, number=i, name=name))
    audit.log(db, user, "project.created", "project", p.id, body.title)
    db.commit()
    db.refresh(p)
    return _project_out(db, p)


@router.put("/{project_id}")
def update_project(project_id: str, body: ProjectIn, user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    p = get_or_404(db, Project, project_id, "Project")
    ensure_manage(user, p)
    p.title, p.description, p.is_active = body.title, body.description, body.is_active
    if user.role == Role.ADMIN.value and body.instructor_id:
        p.instructor_id = body.instructor_id
    audit.log(db, user, "project.updated", "project", p.id)
    db.commit()
    return _project_out(db, p)


@router.delete("/{project_id}")
def delete_project(project_id: str, user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    p = get_or_404(db, Project, project_id, "Project")
    ensure_manage(user, p)
    db.delete(p)
    audit.log(db, user, "project.deleted", "project", project_id, p.title)
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------- milestones --


@router.post("/{project_id}/milestones", status_code=201)
def add_milestone(project_id: str, body: MilestoneIn, user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    p = get_or_404(db, Project, project_id, "Project")
    ensure_manage(user, p)
    m = Milestone(project_id=p.id, **body.model_dump())
    db.add(m)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, f"Milestone M{body.number} already exists")
    return milestone_out(m)


@router.put("/milestones/{milestone_id}")
def update_milestone(milestone_id: str, body: MilestoneIn, user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    m = get_or_404(db, Milestone, milestone_id, "Milestone")
    ensure_manage(user, m.project)
    opened = body.status == "active" and m.status != "active"
    for k, v in body.model_dump().items():
        setattr(m, k, v)
    if opened:
        for u, _ in students_of_project(db, m.project_id):
            audit.notify(db, u.id, f"Evaluation period open: M{m.number} {m.name}", "Submit your self-assessment and evaluate your teammates.", "milestone", "/student/self-assessment")
    audit.log(db, user, "milestone.updated", "milestone", m.id, f"status={m.status}")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, f"Milestone M{body.number} already exists")
    return milestone_out(m)


@router.delete("/milestones/{milestone_id}")
def delete_milestone(milestone_id: str, user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    m = get_or_404(db, Milestone, milestone_id, "Milestone")
    ensure_manage(user, m.project)
    db.delete(m)
    audit.log(db, user, "milestone.deleted", "milestone", milestone_id)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------ teams & members --


@router.post("/{project_id}/teams", status_code=201)
def add_team(project_id: str, body: TeamIn, user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    p = get_or_404(db, Project, project_id, "Project")
    ensure_manage(user, p)
    t = Team(project_id=p.id, team_name=body.team_name)
    db.add(t)
    db.commit()
    return {"id": t.id, "team_name": t.team_name}


@router.put("/teams/{team_id}")
def rename_team(team_id: str, body: TeamIn, user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    t = get_or_404(db, Team, team_id, "Team")
    ensure_manage(user, t.project)
    t.team_name = body.team_name
    db.commit()
    return {"id": t.id, "team_name": t.team_name}


@router.delete("/teams/{team_id}")
def delete_team(team_id: str, user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    t = get_or_404(db, Team, team_id, "Team")
    ensure_manage(user, t.project)
    db.delete(t)
    db.commit()
    return {"ok": True}


@router.post("/{project_id}/enrollments", status_code=201)
def enroll(project_id: str, body: EnrollmentIn, user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    p = get_or_404(db, Project, project_id, "Project")
    ensure_manage(user, p)
    student = get_or_404(db, User, body.user_id, "User")
    if student.role != Role.STUDENT.value:
        raise HTTPException(400, "Only students can be enrolled in a project")
    if body.team_id:
        team = get_or_404(db, Team, body.team_id, "Team")
        if team.project_id != p.id:
            raise HTTPException(400, "Team does not belong to this project")
    enr = db.scalar(select(Enrollment).where(Enrollment.user_id == student.id, Enrollment.project_id == p.id))
    if enr:
        enr.team_id = body.team_id
    else:
        enr = Enrollment(user_id=student.id, project_id=p.id, team_id=body.team_id)
        db.add(enr)
    audit.log(db, user, "enrollment.saved", "enrollment", None, f"{student.full_name} -> {p.title}")
    db.commit()
    return {"ok": True}


@router.delete("/{project_id}/enrollments/{user_id}")
def unenroll(project_id: str, user_id: str, user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    p = get_or_404(db, Project, project_id, "Project")
    ensure_manage(user, p)
    enr = db.scalar(select(Enrollment).where(Enrollment.user_id == user_id, Enrollment.project_id == p.id))
    if not enr:
        raise HTTPException(404, "Enrollment not found")
    db.delete(enr)
    db.commit()
    return {"ok": True}


@router.get("/directory/students")
def student_directory(q: str = "", user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    """Search for student records (by name, email or student number)."""
    query = select(User).where(User.role == Role.STUDENT.value, User.is_active.is_(True))
    if q:
        like = f"%{q.lower()}%"
        query = query.where((User.full_name.ilike(like)) | (User.email.ilike(like)) | (User.student_number.ilike(like)))
    return [user_out(u) for u in db.scalars(query.order_by(User.full_name).limit(100))]
