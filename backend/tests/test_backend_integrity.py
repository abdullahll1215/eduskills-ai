"""Regression cases reproduced during the backend audit, isolated from the demo suite."""
import shutil
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import sessionmaker

from app import seed
from app.database import Base, get_db
from app.config import get_settings
from app.main import app
from app.models import AIReport, Enrollment, Evaluation, Intervention, Milestone, Project, Team, User
from app.routers import student
from app.services import ai_engine
from conftest import login


@pytest.fixture(scope="module")
def integrity_seed(tmp_path_factory):
    path = tmp_path_factory.mktemp("integrity-seed") / "seed.db"
    engine = create_engine(f"sqlite:///{path}", execution_options={"schema_translate_map": {get_settings().database_schema or None: None}})
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
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False},
        execution_options={"schema_translate_map": {get_settings().database_schema or None: None}})
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
    # A fourth reviewer must now be a member of the same team as the target.
    with factory() as db:
        target_enrollment = db.scalar(select(Enrollment).where(Enrollment.user_id == target))
        reviewer_user = db.scalar(select(User).where(User.email == "khalid@student.kfu.edu.sa"))
        reviewer_enrollment = db.scalar(select(Enrollment).where(Enrollment.user_id == reviewer_user.id))
        reviewer_enrollment.team_id = target_enrollment.team_id
        db.commit()
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


def test_report_and_coach_describe_the_configured_weights(isolated):
    client, factory = isolated
    target, mid, email = active_report(factory)
    client.put("/api/admin/settings", headers=login(client, "admin@kfu.edu.sa"),
        json={"values": {"instructor_weight": "0.7", "peer_weight": "0.3"}})
    response = client.post(f"/api/instructor/reports/{target}/{mid}/regenerate",
        headers=login(client, "ahmed@kfu.edu.sa"))
    assert response.status_code == 200
    assert "70%" in response.json()["content"]["paragraphs"][0]
    headers = login(client, email)
    arabic = client.get(f"/api/student/reports/{mid}", headers={**headers, "X-Lang": "ar"}).json()
    assert "70%" in arabic["content"]["paragraphs"][0]
    reply = client.post("/api/chat", headers=headers, json={"message": "How is the score calculated?"}).json()
    assert "70%" in reply["content"] and "30%" in reply["content"]


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
    {"min_peer_evaluations": "²"},
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


def test_unenrolled_student_can_read_only_released_summary_but_cannot_evaluate(isolated):
    client, factory = isolated
    admin = login(client, "admin@kfu.edu.sa")
    client.put("/api/admin/settings", headers=admin, json={"values": {"public_feedback_profiles": "true"}})
    registered = client.post("/api/auth/register", json={"full_name": "Unassigned Student",
        "email": "unassigned@student.kfu.edu.sa", "password": "Password123!"})
    assert registered.status_code == 201
    headers = {"Authorization": "Bearer " + registered.json()["access_token"]}
    target, mid, _ = active_report(factory)
    profile = client.get(f"/api/student/profiles/{target}/feedback", headers=headers)
    assert profile.status_code == 200
    assert profile.json()["feedback"]["skills"]
    assert profile.json()["feedback"]["comments"] == []
    assert profile.json()["feedback"]["instructor_comments"] == []
    assert client.get("/api/student/directory", headers=headers).json()
    comps = client.get("/api/competencies", headers=headers).json()
    response = client.post("/api/student/peer-evaluations", headers=headers, json={
        "target_id": target, "milestone_id": mid, "ratings": {c["id"]: 4 for c in comps},
        "comment": "Clear communication and thoughtful preparation for each review."})
    assert response.status_code == 403


def test_released_score_profiles_are_enabled_by_default():
    from app.services.settings_store import DEFAULTS
    assert DEFAULTS["public_feedback_profiles"] == "true"


def test_provisional_dashboard_hides_below_threshold_peer_scores(isolated):
    client, _ = isolated
    headers = login(client, "ali@student.kfu.edu.sa")
    provisional = client.get("/api/student/dashboard", headers=headers).json()["provisional"]
    assert provisional is not None
    assert all(skill["peer_avg"] is None for skill in provisional["skills"])


def test_advisor_does_not_read_a_stale_report(isolated):
    client, factory = isolated
    target, mid, _ = active_report(factory)
    with factory() as db:
        db.add(Intervention(student_id=target, milestone_id=mid,
            project_id=db.get(Milestone, mid).project_id, reason="Review the current assessment"))
        db.commit()
    admin = login(client, "admin@kfu.edu.sa")
    client.put("/api/admin/settings", headers=admin,
        json={"values": {"instructor_weight": "0.7", "peer_weight": "0.3"}})
    items = client.get("/api/advisor/interventions", headers=login(client, "advisor@kfu.edu.sa")).json()
    assert all(i["latest_report"] is None for i in items)


def test_cohort_team_summary_excludes_stale_reports(isolated):
    client, _ = isolated
    headers = login(client, "ahmed@kfu.edu.sa")
    project = client.get("/api/instructor/projects", headers=headers).json()[0]
    client.put("/api/admin/settings", headers=login(client, "admin@kfu.edu.sa"),
        json={"values": {"instructor_weight": "0.7", "peer_weight": "0.3"}})
    result = client.get("/api/instructor/cohort-report", headers=headers, params={"project_id": project["id"]}).json()
    assert all(team["avg_external"] is None for team in result["teams"])


def test_shared_team_cannot_reveal_an_unrelated_course_profile(isolated):
    client, factory = isolated
    with factory() as db:
        me = db.scalar(select(User).where(User.email == "khalid@student.kfu.edu.sa"))
        target = db.scalar(select(User).where(User.email == "omar@student.kfu.edu.sa"))
        instructor = db.scalar(select(User).where(User.role == "instructor"))
        # Their existing courses/teams are unrelated to a newly shared course.
        shared = Project(title="Shared course only", instructor_id=instructor.id)
        db.add(shared)
        db.flush()
        team = Team(project_id=shared.id, team_name="Shared team")
        db.add(team)
        db.flush()
        db.add_all([Enrollment(user_id=me.id, project_id=shared.id, team_id=team.id),
                    Enrollment(user_id=target.id, project_id=shared.id, team_id=team.id)])
        db.commit()
        target_id = target.id
    client.put("/api/admin/settings", headers=login(client, "admin@kfu.edu.sa"),
        json={"values": {"public_feedback_profiles": "true"}})
    response = client.get(f"/api/student/profiles/{target_id}/feedback", headers=login(client, "khalid@student.kfu.edu.sa"))
    assert response.status_code == 200
    assert response.json()["feedback"]["comments"] == []
    assert response.json()["feedback"]["instructor_comments"] == []


def test_postgres_backup_claims_no_restore_verification_without_a_restore(isolated, tmp_path):
    from types import SimpleNamespace
    from app.services import backup
    from app.database import Base

    _, factory = isolated
    engine = factory.kw["bind"]
    with factory() as db:
        with patch.object(backup, "get_settings", return_value=SimpleNamespace(
            backup_dir=tmp_path, database_url="postgresql://unused", database_schema="")), \
             patch.object(backup, "engine", engine):
            record = backup.run_backup(db)
    assert record.verified is False
    import json
    exported = json.loads((tmp_path / record.filename).read_text())
    assert set(exported["tables"]) == {t.name for t in Base.metadata.tables.values()}
    assert exported["restore_verified"] is False


def test_personal_self_assessment_needs_no_course_and_is_private(isolated):
    client, _ = isolated
    registered = client.post("/api/auth/register", json={"full_name": "Independent Student",
        "email": "independent@example.com", "password": "Password123!"})
    headers = {"Authorization": "Bearer " + registered.json()["access_token"]}
    assert client.get("/api/student/projects", headers=headers).json() == []
    initial = client.get("/api/student/personal-self-assessment", headers=headers)
    assert initial.status_code == 200
    assert initial.json()["submission"] is None
    ratings = {c["id"]: 4 for c in initial.json()["competencies"]}
    assert client.post("/api/student/personal-self-assessment", headers=headers, json={"ratings": ratings}).status_code == 201
    assert client.get("/api/student/personal-self-assessment", headers=headers).json()["submission"]["ratings"] == ratings
    assert client.get("/api/student/personal-self-assessment", headers=login(client, "ali@student.kfu.edu.sa")).json()["submission"] is None
    changed = {c: 2 for c in ratings}
    assert client.post("/api/student/personal-self-assessment", headers=headers, json={"ratings": changed}).status_code == 201
    assert client.get("/api/student/personal-self-assessment", headers=headers).json()["submission"]["ratings"] == changed
    assert client.post("/api/student/personal-self-assessment", headers=headers, json={"ratings": {}}).status_code == 422
    assert client.post("/api/student/personal-self-assessment", headers=headers, json={"ratings": {c: 6 for c in ratings}}).status_code == 422
    # A failed optional join never removes access to personal assessment.
    assert client.post("/api/student/team/create", headers=headers, json={"course_code": "WRONG123", "team_name": "My team"}).status_code == 404
    assert client.get("/api/student/personal-self-assessment", headers=headers).status_code == 200
    assert client.get("/api/student/reports", headers=headers).json() == []


def test_peer_evaluation_requires_same_team_even_in_same_course(isolated):
    client, factory = isolated
    headers = login(client, "omar@student.kfu.edu.sa")
    client.put("/api/admin/settings", headers=login(client, "admin@kfu.edu.sa"), json={"values": {"public_feedback_profiles": "true"}})
    with factory() as db:
        me = db.scalar(select(User).where(User.email == "omar@student.kfu.edu.sa"))
        mine = db.scalar(select(Enrollment).where(Enrollment.user_id == me.id))
        other = db.scalar(select(Enrollment).where(Enrollment.project_id == mine.project_id, Enrollment.team_id != mine.team_id))
        target_id = other.user_id
        mid = db.scalar(select(Milestone.id).where(Milestone.project_id == mine.project_id, Milestone.status == "active"))
    targets = client.get("/api/student/evaluation-targets", headers=headers, params={"q": ""}).json()
    row = next(t for t in targets if t["id"] == target_id)
    assert row["status"] == "view_only" and not row["is_teammate"]
    ratings = {c["id"]: 4 for c in client.get("/api/competencies", headers=headers).json()}
    for period in (None, mid, "missing-milestone"):
        response = client.post("/api/student/peer-evaluations", headers=headers,
            json={"target_id": target_id, "milestone_id": period, "ratings": ratings})
        assert response.status_code == 403
