"""Regression cases reproduced during the backend audit, isolated from the demo suite."""
import shutil
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import sessionmaker

from app import seed
from app.database import Base, get_db
from app.main import app
from app.models import AIReport, Evaluation, Intervention, Milestone, Team, User
from app.routers import student
from app.services import ai_engine
from conftest import login


@pytest.fixture(scope="module")
def integrity_seed(tmp_path_factory):
    path = tmp_path_factory.mktemp("integrity-seed") / "seed.db"
    engine = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as db:
        seed.seed_demo(db)
        db.commit()
    engine.dispose()
    return path


@pytest.fixture
def isolated(integrity_seed, tmp_path):
    path = tmp_path / "test.db"
    shutil.copyfile(integrity_seed, path)
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    factory = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)

    def session():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = session
    try:
        with patch.object(student, "SessionLocal", factory):
            yield TestClient(app, raise_server_exceptions=False), factory
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def active_report(factory):
    with factory() as db:
        report = db.scalar(select(AIReport).join(Milestone).where(Milestone.status == "active"))
        return report.student_id, report.milestone_id, db.get(User, report.student_id).email


def test_fourth_peer_refreshes_existing_report(isolated):
    client, factory = isolated
    target, mid, email = active_report(factory)
    reviewer = login(client, "khalid@student.kfu.edu.sa")
    comps = client.get("/api/competencies", headers=reviewer).json()
    response = client.post("/api/student/peer-evaluations", headers=reviewer, json={
        "target_id": target, "milestone_id": mid, "ratings": {c["id"]: 1 for c in comps},
        "comment": "Please share progress updates and explain decisions more clearly."})
    assert response.status_code == 201
    report = client.get(f"/api/student/reports/{mid}", headers=login(client, email)).json()
    assert report["content"]["peer_count"] == 4
    assert report["metrics"][0]["peer_avg"] == 3.25


def test_deleting_required_sources_withholds_report_and_exports(isolated):
    client, factory = isolated
    target, mid, email = active_report(factory)
    with factory() as db:
        eid = db.scalar(select(Evaluation.id).where(Evaluation.target_id == target,
            Evaluation.milestone_id == mid, Evaluation.eval_type == "peer"))
    response = client.delete(f"/api/admin/evaluations/{eid}", headers=login(client, "admin@kfu.edu.sa"))
    assert response.status_code == 200
    headers = login(client, email)
    assert client.get(f"/api/student/reports/{mid}", headers=headers).status_code in (404, 409)
    assert all(r["milestone"]["id"] != mid for r in client.get("/api/student/reports", headers=headers).json())
    assert all(t["milestone"] != "M3" for t in client.get("/api/student/dashboard", headers=headers).json()["trend"])
    assert "M3 Implementation" not in client.get("/api/student/passport.csv", headers=headers).text


def test_changed_scoring_does_not_serve_an_old_report_as_current(isolated):
    client, factory = isolated
    _, mid, email = active_report(factory)
    response = client.put("/api/admin/settings", headers=login(client, "admin@kfu.edu.sa"),
        json={"values": {"instructor_weight": "0.7", "peer_weight": "0.3"}})
    assert response.status_code == 200
    assert client.get(f"/api/student/reports/{mid}", headers=login(client, email)).status_code in (404, 409)


def test_hidden_strength_does_not_raise_a_blind_spot_intervention(isolated):
    _, factory = isolated
    with factory() as db:
        u = db.scalar(select(User).where(User.email == "khalid@student.kfu.edu.sa"))
        m = db.scalar(select(Milestone).where(Milestone.number == 1))
        db.execute(delete(Intervention).where(Intervention.student_id == u.id, Intervention.milestone_id == m.id))
        for ev in db.scalars(select(Evaluation).where(Evaluation.target_id == u.id, Evaluation.milestone_id == m.id)):
            for rating in ev.ratings:
                rating.score = 1 if ev.eval_type == "self" else 5
        db.flush()
        report = ai_engine.generate_report(db, u.id, m.id, force=True)
        db.flush()
        assert all(x.direction == "underestimate" for x in report.metrics)
        assert db.scalar(select(Intervention.id).where(Intervention.student_id == u.id,
            Intervention.milestone_id == m.id)) is None


@pytest.mark.parametrize("values", [
    {"min_peer_evaluations": "0"}, {"min_peer_evaluations": "1000000"},
    {"instructor_weight": "NaN"}, {"moderate_threshold": "Infinity"},
    {"retention_days": "-1"}, {"retention_days": "abc"},
    {"public_feedback_profiles": "maybe"}, {"ai_enabled": "yes"},
    {"instructor_weight": "abc"},
])
def test_invalid_settings_are_rejected_atomically(isolated, values):
    client, _ = isolated
    headers = login(client, "admin@kfu.edu.sa")
    before = client.get("/api/admin/settings", headers=headers).json()
    response = client.put("/api/admin/settings", headers=headers, json={"values": values})
    assert response.status_code == 422
    assert client.get("/api/admin/settings", headers=headers).json() == before


def test_registration_cannot_self_assign_academic_membership(isolated):
    client, factory = isolated
    with factory() as db:
        team = db.scalar(select(Team.id))
    response = client.post("/api/auth/register", json={"full_name": "Unapproved Student",
        "email": "unapproved@student.kfu.edu.sa", "password": "Password123!", "team_id": team})
    assert response.status_code == 403


def test_unenrolled_registration_cannot_read_or_submit_academic_feedback(isolated):
    client, factory = isolated
    admin = login(client, "admin@kfu.edu.sa")
    client.put("/api/admin/settings", headers=admin, json={"values": {"public_feedback_profiles": "true"}})
    registered = client.post("/api/auth/register", json={"full_name": "Unassigned Student",
        "email": "unassigned@student.kfu.edu.sa", "password": "Password123!"})
    assert registered.status_code == 201
    headers = {"Authorization": "Bearer " + registered.json()["access_token"]}
    target, mid, _ = active_report(factory)
    assert client.get(f"/api/student/profiles/{target}/feedback", headers=headers).status_code == 403
    assert client.get("/api/student/directory", headers=headers).json() == []
    comps = client.get("/api/competencies", headers=headers).json()
    response = client.post("/api/student/peer-evaluations", headers=headers, json={
        "target_id": target, "milestone_id": mid, "ratings": {c["id"]: 4 for c in comps},
        "comment": "Clear communication and thoughtful preparation for each review."})
    assert response.status_code == 403


def test_feedback_profiles_are_private_by_default():
    from app.services.settings_store import DEFAULTS
    assert DEFAULTS["public_feedback_profiles"] == "false"


def test_provisional_dashboard_hides_below_threshold_peer_scores(isolated):
    client, _ = isolated
    headers = login(client, "ali@student.kfu.edu.sa")
    provisional = client.get("/api/student/dashboard", headers=headers).json()["provisional"]
    assert provisional is not None
    assert all(skill["peer_avg"] is None for skill in provisional["skills"])
