from sqlalchemy import select

from app import seed
from app.config import get_settings
from app.database import SessionLocal
from app.models import Role, User


def test_first_admin_is_created_once(client, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "admin_email", "First.Admin@kfu.edu.sa")
    monkeypatch.setattr(settings, "admin_password", "a-long-admin-password")
    with SessionLocal() as db:
        # The demo cohort already has an administrator, so nothing is created.
        assert seed.bootstrap_admin(db) is False
        for admin in db.scalars(select(User).where(User.role == Role.ADMIN.value)):
            admin.role = Role.INSTRUCTOR.value
        db.commit()
        assert seed.bootstrap_admin(db) is True
        assert seed.bootstrap_admin(db) is False  # only once
        created = db.scalar(select(User).where(User.email == "first.admin@kfu.edu.sa"))
        assert created.role == Role.ADMIN.value
        db.delete(created)
        db.commit()
    r = client.post("/api/auth/login", json={"email": "admin@kfu.edu.sa", "password": "Password123!"})
    with SessionLocal() as db:  # restore the demo administrator for other tests
        u = db.scalar(select(User).where(User.email == "admin@kfu.edu.sa"))
        u.role = Role.ADMIN.value
        db.commit()
    assert r.status_code == 200
