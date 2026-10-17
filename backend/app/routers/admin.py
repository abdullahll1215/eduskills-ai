"""System administration (UC-08): users, configuration, AI parameters, health, backups, retention, audit."""
import time
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import admin_only
from ..models import (
    AIReport,
    AuditLog,
    Competency,
    Evaluation,
    LearningResource,
    Project,
    Role,
    User,
    utcnow,
)
from ..schemas import CompetencyIn, ResourceIn, SettingsIn, UserIn
from ..security import hash_password
from ..services import ai_engine, audit, backup
from ..services.common import competency_out, get_or_404, user_out
from ..services.settings_store import DEFAULTS, ai_config, get_raw, public_settings, set_value

router = APIRouter(prefix="/api/admin", tags=["admin"])
STARTED_AT = time.time()


# --------------------------------------------------------------- users --


@router.get("/users")
def list_users(q: str = "", role: str | None = None, _: User = Depends(admin_only), db: Session = Depends(get_db)):
    query = select(User)
    if role:
        query = query.where(User.role == role)
    if q:
        like = f"%{q.lower()}%"
        query = query.where((User.full_name.ilike(like)) | (User.email.ilike(like)) | (User.student_number.ilike(like)))
    return [user_out(u) for u in db.scalars(query.order_by(User.role, User.full_name))]


@router.post("/users", status_code=201)
def create_user(body: UserIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.email == body.email.lower())):
        raise HTTPException(409, "A user with this email already exists")
    if not body.password:
        raise HTTPException(422, "A password is required for new users")
    data = body.model_dump(exclude={"password"})
    data["email"] = data["email"].lower()
    u = User(**data, password_hash=hash_password(body.password))
    db.add(u)
    audit.log(db, admin, "user.created", "user", u.id, f"{u.email} ({u.role})")
    db.commit()
    return user_out(u)


@router.put("/users/{user_id}")
def update_user(user_id: str, body: UserIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    u = get_or_404(db, User, user_id, "User")
    clash = db.scalar(select(User).where(User.email == body.email.lower(), User.id != u.id))
    if clash:
        raise HTTPException(409, "A user with this email already exists")
    if u.id == admin.id and (body.role != "admin" or not body.is_active):
        raise HTTPException(400, "You cannot remove your own administrator access")
    for k, v in body.model_dump(exclude={"password"}).items():
        setattr(u, k, v.lower() if k == "email" else v)
    if body.password:
        u.password_hash = hash_password(body.password)
    audit.log(db, admin, "user.updated", "user", u.id, u.email)
    db.commit()
    return user_out(u)


@router.delete("/users/{user_id}")
def deactivate_user(user_id: str, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    u = get_or_404(db, User, user_id, "User")
    if u.id == admin.id:
        raise HTTPException(400, "You cannot deactivate your own account")
    u.is_active = False
    audit.log(db, admin, "user.deactivated", "user", u.id, u.email)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------- configuration --


@router.get("/settings")
def get_settings_(_: User = Depends(admin_only), db: Session = Depends(get_db)):
    return public_settings(db)


@router.put("/settings")
def update_settings(body: SettingsIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    vals = body.values
    unknown = set(vals) - set(DEFAULTS)
    if unknown:
        raise HTTPException(422, f"Unknown settings: {', '.join(sorted(unknown))}")
    numeric = {"instructor_weight", "peer_weight", "moderate_threshold", "critical_threshold", "instructor_peer_warning"}
    for k in numeric & set(vals):
        try:
            if float(vals[k]) < 0:
                raise ValueError
        except ValueError:
            raise HTTPException(422, f"{k} must be a non-negative number")
    w_i = float(vals.get("instructor_weight", get_raw(db, "instructor_weight")))
    w_p = float(vals.get("peer_weight", get_raw(db, "peer_weight")))
    if abs(w_i + w_p - 1) > 1e-6:
        raise HTTPException(422, "Instructor and peer weights must add up to 1.0")
    mod = float(vals.get("moderate_threshold", get_raw(db, "moderate_threshold")))
    crit = float(vals.get("critical_threshold", get_raw(db, "critical_threshold")))
    if crit < mod:
        raise HTTPException(422, "The critical threshold must be greater than the moderate threshold")
    if "min_peer_evaluations" in vals and not vals["min_peer_evaluations"].isdigit():
        raise HTTPException(422, "min_peer_evaluations must be a whole number")
    for k, v in vals.items():
        if k == "ai_api_key" and (not v or v.startswith("•")):
            continue  # masked value sent back unchanged
        set_value(db, k, v)
    audit.log(db, admin, "settings.updated", "system_settings", None, ", ".join(k for k in vals if k != "ai_api_key") + (" (+api key)" if vals.get("ai_api_key", "").strip("•") else ""))
    db.commit()
    return public_settings(db)


@router.post("/settings/clear-api-key")
def clear_api_key(admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    set_value(db, "ai_api_key", "")
    audit.log(db, admin, "settings.api_key_cleared", "system_settings")
    db.commit()
    return public_settings(db)


@router.post("/ai/test")
def test_ai(admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    ok, message = ai_engine.check_connection(ai_config(db))
    audit.log(db, admin, "ai.connection_test", "system", None, f"ok={ok}")
    db.commit()
    # UC-08 E4a: on outage the platform keeps working with the local fallback configuration
    return {"ok": ok, "message": message, "mode": "genai" if ok else "fallback"}


# ----------------------------------------------- rubric & learning resources --


@router.put("/competencies/{competency_id}")
def update_competency(competency_id: str, body: CompetencyIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    c = get_or_404(db, Competency, competency_id, "Competency")
    c.skill_name, c.description, c.rubric = body.skill_name, body.description, body.rubric
    audit.log(db, admin, "rubric.updated", "competency", c.id, c.code)
    db.commit()
    return competency_out(c)


def _res_out(r: LearningResource) -> dict:
    return {"id": r.id, "competency_id": r.competency_id, "skill": r.competency.skill_name, "title": r.title, "provider": r.provider, "url": r.url, "kind": r.kind, "duration": r.duration}


@router.get("/resources")
def list_resources(_: User = Depends(admin_only), db: Session = Depends(get_db)):
    return [_res_out(r) for r in db.scalars(select(LearningResource).order_by(LearningResource.competency_id, LearningResource.title))]


@router.post("/resources", status_code=201)
def add_resource(body: ResourceIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    get_or_404(db, Competency, body.competency_id, "Competency")
    r = LearningResource(**body.model_dump())
    db.add(r)
    audit.log(db, admin, "resource.created", "learning_resource", r.id, body.title)
    db.commit()
    return _res_out(r)


@router.delete("/resources/{resource_id}")
def delete_resource(resource_id: str, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    r = get_or_404(db, LearningResource, resource_id, "Resource")
    db.delete(r)
    audit.log(db, admin, "resource.deleted", "learning_resource", resource_id)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------ evaluation records --


@router.post("/evaluations/{evaluation_id}/unlock")
def unlock_evaluation(evaluation_id: str, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    ev = get_or_404(db, Evaluation, evaluation_id, "Evaluation")
    if ev.eval_type == "peer":
        raise HTTPException(400, "Anonymous peer evaluations cannot be edited; delete them instead")
    ev.is_locked = False
    audit.log(db, admin, "evaluation.unlocked", "evaluation", ev.id, ev.eval_type)
    db.commit()
    return {"ok": True}


@router.delete("/evaluations/{evaluation_id}")
def delete_evaluation(evaluation_id: str, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    ev = get_or_404(db, Evaluation, evaluation_id, "Evaluation")
    db.delete(ev)
    audit.log(db, admin, "evaluation.deleted", "evaluation", evaluation_id, ev.eval_type)
    db.commit()
    return {"ok": True}


# -------------------------------------------- health, backup, retention, audit --


@router.get("/health")
def health(_: User = Depends(admin_only), db: Session = Depends(get_db)):
    t0 = time.perf_counter()
    db.execute(text("SELECT 1"))
    db_ms = round((time.perf_counter() - t0) * 1000, 2)
    cfg = ai_config(db)
    reports = db.scalar(select(func.count(AIReport.id))) or 0
    ai_reports = db.scalar(select(func.count(AIReport.id)).where(AIReport.source == "ai")) or 0
    last_backup = backup.list_backups(db)[:1]
    return {
        "status": "ok",
        "uptime_seconds": int(time.time() - STARTED_AT),
        "database": {"ok": True, "latency_ms": db_ms},
        "ai": {"configured": bool(cfg.api_key), "enabled": cfg.enabled, "model": cfg.model, "mode": "genai" if cfg.usable else "fallback"},
        "counts": {
            "users": db.scalar(select(func.count(User.id))),
            "active_users": db.scalar(select(func.count(User.id)).where(User.is_active.is_(True))),
            "projects": db.scalar(select(func.count(Project.id))),
            "evaluations": db.scalar(select(func.count(Evaluation.id))),
            "reports": reports,
            "reports_ai": ai_reports,
            "reports_fallback": reports - ai_reports,
            "flagged_pending": db.scalar(select(func.count(Evaluation.id)).where(Evaluation.moderation_status == "pending")),
        },
        "last_backup": None
        if not last_backup
        else {"created_at": last_backup[0].created_at, "verified": last_backup[0].verified, "filename": last_backup[0].filename},
    }


@router.get("/backups")
def backups(_: User = Depends(admin_only), db: Session = Depends(get_db)):
    return [
        {"id": b.id, "filename": b.filename, "size_bytes": b.size_bytes, "checksum": b.checksum, "verified": b.verified, "details": b.details, "created_at": b.created_at}
        for b in backup.list_backups(db)
    ]


@router.post("/backups", status_code=201)
def create_backup(admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    rec = backup.run_backup(db)
    audit.log(db, admin, "backup.created", "backup", rec.id, f"verified={rec.verified}")
    if not rec.verified:
        # UC-08 E7a: backup verification failed -> emergency alert
        audit.notify_role(db, Role.ADMIN, "EMERGENCY: backup verification failed", rec.details, "alert", "/admin/maintenance")
    db.commit()
    return {"id": rec.id, "filename": rec.filename, "verified": rec.verified, "details": rec.details, "size_bytes": rec.size_bytes}


@router.post("/retention/purge")
def purge(admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    days = int(get_raw(db, "retention_days"))
    result = backup.purge(db, days)
    audit.log(db, admin, "retention.purged", "system", None, str(result))
    db.commit()
    return {"retention_days": days, "deleted": result}


@router.get("/audit-logs")
def audit_logs(action: str = "", limit: int = 200, _: User = Depends(admin_only), db: Session = Depends(get_db)):
    q = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(min(limit, 1000))
    if action:
        q = q.where(AuditLog.action.ilike(f"%{action}%"))
    return [
        {"id": a.id, "actor": a.actor.full_name if a.actor else "System", "action": a.action, "entity": a.entity, "entity_id": a.entity_id, "details": a.details, "created_at": a.created_at}
        for a in db.scalars(q)
    ]


@router.get("/usage")
def usage_report(days: int = 30, _: User = Depends(admin_only), db: Session = Depends(get_db)):
    """System usage report: activity per day and per action over the period."""
    since = utcnow() - timedelta(days=days)
    logs = db.scalars(select(AuditLog).where(AuditLog.created_at >= since)).all()
    per_day: dict[str, int] = {}
    per_action: dict[str, int] = {}
    for log in logs:
        d = log.created_at.strftime("%Y-%m-%d")
        per_day[d] = per_day.get(d, 0) + 1
        per_action[log.action] = per_action.get(log.action, 0) + 1
    logins = db.scalar(select(func.count(func.distinct(AuditLog.actor_id))).where(AuditLog.action == "auth.login", AuditLog.created_at >= since))
    return {
        "days": days,
        "active_users": logins or 0,
        "per_day": [{"date": k, "events": v} for k, v in sorted(per_day.items())],
        "per_action": sorted(({"action": k, "count": v} for k, v in per_action.items()), key=lambda x: -x["count"]),
    }
