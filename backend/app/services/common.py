"""Shared queries and validation helpers used by several routers."""
import secrets

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Artifact, Competency, Enrollment, Milestone, Project, Role, Team, User, WorkProject

def new_course_number(db: Session) -> str:
    """A random 6-digit course number for a course created without one (the instructor can change it)."""
    while True:
        number = f"{secrets.randbelow(900000) + 100000}"
        if not db.scalar(select(Project.id).where(Project.join_code == number)):
            return number


def ensure_codes(db: Session) -> None:
    """Gives every course a course number and every team a readable invite code (existing codes are kept)."""
    for p in db.scalars(select(Project).where(Project.join_code.is_(None))).all():
        p.join_code = new_course_number(db)
        db.flush()
    for t in db.scalars(select(Team).where(Team.invite_code.is_(None))).all():
        t.invite_code = team_code(db, db.get(Project, t.project_id).join_code, t.team_name)
        db.flush()
    db.commit()


def normalise_code(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


def course_number_of(raw: str) -> str:
    """A course number is 4 to 10 digits (spaces and dashes are ignored)."""
    number = "".join(ch for ch in raw if ch.isdigit())
    if len(number) < 4 or len(number) > 10 or len(number) != len(normalise_code(raw)):
        raise HTTPException(422, "The course number must be 4 to 10 digits")
    return number


def team_code(db: Session, course_number: str, team_name: str) -> str:
    """Readable invite code: course number + team name, e.g. 1234-ALPHA (a suffix keeps it unique)."""
    base = f"{course_number}-{normalise_code(team_name)[:40] or 'TEAM'}"
    code, n = base, 2
    while find_team_by_code(db, code):
        code, n = f"{base}{n}", n + 1
    return code


def find_team_by_code(db: Session, code: str) -> Team | None:
    """Codes match ignoring case, spaces and dashes."""
    wanted = normalise_code(code)
    if not wanted:
        return None
    return db.scalar(select(Team).where(func.upper(func.replace(Team.invite_code, "-", "")) == wanted))


def default_work_project(db: Session, student_id: str, project_id: str) -> WorkProject:
    """The student's project named after their course project; created on first use."""
    course = db.get(Project, project_id)
    name = course.title if course else "My project"
    wp = db.scalar(select(WorkProject).where(WorkProject.student_id == student_id, WorkProject.name == name))
    if wp is None:
        stages = len(course.milestones) if course else 1
        wp = WorkProject(student_id=student_id, name=name, description=course.description if course else None, stages=max(1, stages))
        db.add(wp)
        db.flush()
    return wp


def assign_orphan_artifacts(db: Session) -> None:
    """Artifacts created before "My Projects" existed are grouped under the course project."""
    for a in db.scalars(select(Artifact).where(Artifact.work_project_id.is_(None))).all():
        wp = default_work_project(db, a.student_id, a.project_id)
        a.work_project_id = wp.id
        m = db.get(Milestone, a.milestone_id)
        a.stage = min(m.number, wp.stages or 1) if m else 1
    db.commit()


def get_or_404(db: Session, model, obj_id: str, label: str):
    obj = db.get(model, obj_id)
    if obj is None:
        raise HTTPException(404, f"{label} not found")
    return obj


def user_out(u: User) -> dict:
    return {
        "id": u.id,
        "full_name": u.full_name,
        "email": u.email,
        "role": u.role,
        "student_number": u.student_number,
        "level": u.level,
        "mobile": u.mobile,
        "department": u.department,
        "is_active": u.is_active,
        "created_at": u.created_at,
        "last_login_at": u.last_login_at,
    }


def milestone_out(m: Milestone) -> dict:
    return {
        "id": m.id,
        "project_id": m.project_id,
        "number": m.number,
        "name": m.name,
        "description": m.description,
        "due_date": m.due_date,
        "status": m.status,
    }


def competency_out(c: Competency) -> dict:
    return {"id": c.id, "code": c.code, "skill_name": c.skill_name, "description": c.description, "rubric": c.rubric}


def enrollment_of(db: Session, user_id: str, project_id: str) -> Enrollment | None:
    return db.scalar(select(Enrollment).where(Enrollment.user_id == user_id, Enrollment.project_id == project_id))


def teammates(db: Session, enrollment: Enrollment) -> list[User]:
    if not enrollment.team_id:
        return []
    return list(
        db.scalars(
            select(User)
            .join(Enrollment, Enrollment.user_id == User.id)
            .where(Enrollment.team_id == enrollment.team_id, User.id != enrollment.user_id, User.is_active.is_(True))
            .order_by(User.full_name)
        )
    )


def validate_ratings(db: Session, ratings: dict[str, int]) -> dict[str, int]:
    """UC-01 step 4 / E3a: every one of the five skills must be rated."""
    comp_ids = set(db.scalars(select(Competency.id)))
    missing = comp_ids - set(ratings)
    if missing:
        raise HTTPException(422, "All five soft skills must be rated before submission")
    unknown = set(ratings) - comp_ids
    if unknown:
        raise HTTPException(422, "Unknown competency in ratings")
    return {k: int(v) for k, v in ratings.items()}


def can_manage_project(user: User, project: Project) -> bool:
    return user.role == Role.ADMIN.value or project.instructor_id == user.id


def ensure_manage(user: User, project: Project):
    if not can_manage_project(user, project):
        raise HTTPException(403, "You are not the instructor of this project")


def students_of_project(db: Session, project_id: str) -> list[tuple[User, Enrollment]]:
    rows = db.execute(
        select(User, Enrollment)
        .join(Enrollment, Enrollment.user_id == User.id)
        .where(Enrollment.project_id == project_id, User.role == Role.STUDENT.value)
        .order_by(User.full_name)
    ).all()
    return [(u, e) for u, e in rows]
