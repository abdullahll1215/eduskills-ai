from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AuditLog, Notification, Role, User


def log(db: Session, actor: User | None, action: str, entity: str = "", entity_id: str | None = None, details: str = ""):
    db.add(
        AuditLog(actor_id=actor.id if actor else None, action=action, entity=entity, entity_id=entity_id, details=details)
    )


def notify(db: Session, user_id: str, title: str, body: str = "", kind: str = "info", link: str | None = None):
    db.add(Notification(user_id=user_id, title=title, body=body, kind=kind, link=link))


def notify_role(db: Session, role: Role, title: str, body: str = "", kind: str = "info", link: str | None = None):
    for uid in db.scalars(select(User.id).where(User.role == role.value, User.is_active.is_(True))):
        notify(db, uid, title, body, kind, link)
