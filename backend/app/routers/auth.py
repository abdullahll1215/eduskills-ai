from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Competency, Enrollment, Notification, Project, Role, Team, User, utcnow
from ..schemas import LoginIn, PasswordIn, ProfileIn, RegisterIn
from ..security import create_access_token, hash_password, verify_password
from ..services import audit
from ..services.common import competency_out, user_out

router = APIRouter(prefix="/api", tags=["auth & common"])


@router.post("/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password")
    if not user.is_active:
        raise HTTPException(403, "This account has been disabled")
    user.last_login_at = utcnow()
    audit.log(db, user, "auth.login", "user", user.id)
    db.commit()
    return {"access_token": create_access_token(user.id, user.role), "token_type": "bearer", "user": user_out(user)}


@router.get("/auth/signup-options")
def signup_options(db: Session = Depends(get_db)):
    """Academic memberships are assigned by staff, never by an unauthenticated registrant."""
    return []


@router.post("/auth/register", status_code=201)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    """Self-registration is for students only; staff accounts are created by an administrator."""
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists. Sign in instead.")
    team = None
    if body.team_id:
        raise HTTPException(403, "Team membership must be assigned by an instructor")
    user = User(
        full_name=body.full_name.strip(),
        email=email,
        role=Role.STUDENT.value,
        password_hash=hash_password(body.password),
        student_number=(body.student_number or "").strip() or None,
        last_login_at=utcnow(),
    )
    db.add(user)
    db.flush()
    if team:
        db.add(Enrollment(user_id=user.id, project_id=team.project_id, team_id=team.id))
        if team.project.instructor_id:
            audit.notify(db, team.project.instructor_id, f"New student joined {team.team_name}", user.full_name, "info", "/instructor/projects")
    audit.log(db, user, "auth.registered", "user", user.id, f"team={team.team_name if team else '-'}")
    db.commit()
    return {"access_token": create_access_token(user.id, user.role), "token_type": "bearer", "user": user_out(user)}


@router.get("/auth/me")
def me(user: User = Depends(get_current_user)):
    return user_out(user)


@router.put("/auth/me")
def update_profile(body: ProfileIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    audit.log(db, user, "user.profile_updated", "user", user.id)
    db.commit()
    return user_out(user)


@router.post("/auth/change-password")
def change_password(body: PasswordIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    audit.log(db, user, "user.password_changed", "user", user.id)
    db.commit()
    return {"ok": True}


@router.get("/competencies")
def list_competencies(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [competency_out(c) for c in db.scalars(select(Competency).order_by(Competency.sort_order))]


@router.get("/notifications")
def notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(50)
    )
    return [
        {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "link": n.link, "is_read": n.is_read, "created_at": n.created_at}
        for n in rows
    ]


@router.post("/notifications/{notification_id}/read")
def mark_read(notification_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    n = db.get(Notification, notification_id)
    if not n or n.user_id != user.id:
        raise HTTPException(404, "Notification not found")
    n.is_read = True
    db.commit()
    return {"ok": True}


@router.post("/notifications/read-all")
def mark_all_read(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.execute(update(Notification).where(Notification.user_id == user.id).values(is_read=True))
    db.commit()
    return {"ok": True}
