"""End-to-end API tests of the use cases UC-01 .. UC-08 against the seeded demo cohort."""
from conftest import login


def _project(client, headers):
    projects = client.get("/api/student/projects", headers=headers).json()
    return projects[0]


def _active(project):
    return next(m for m in project["milestones"] if m["status"] == "active")


def _closed(project):
    return next(m for m in project["milestones"] if m["status"] == "closed")


def _ratings(client, headers, value=4):
    comps = client.get("/api/competencies", headers=headers).json()
    return {c["id"]: value for c in comps}


def test_login_rejects_bad_password(client):
    r = client.post("/api/auth/login", json={"email": "khalid@student.kfu.edu.sa", "password": "wrong"})
    assert r.status_code == 401


def test_rbac_blocks_students_from_instructor_console(client, khalid):
    assert client.get("/api/instructor/projects", headers=khalid).status_code == 403
    assert client.get("/api/admin/users", headers=khalid).status_code == 403


def test_uc01_self_assessment_validation_lock_and_closed_period(client, khalid):
    project = _project(client, khalid)
    m3 = _active(project)
    ratings = _ratings(client, khalid, 5)
    partial = dict(list(ratings.items())[:3])
    r = client.post("/api/student/self-assessment", headers=khalid, json={"milestone_id": m3["id"], "ratings": partial})
    assert r.status_code == 422  # E3a: fields missing

    r = client.post("/api/student/self-assessment", headers=khalid, json={"milestone_id": _closed(project)["id"], "ratings": ratings})
    assert r.status_code == 409  # E1a: period closed

    r = client.post("/api/student/self-assessment", headers=khalid, json={"milestone_id": m3["id"], "ratings": ratings, "evidence": "Led the API work."})
    assert r.status_code == 201
    edited = {k: 3 for k in ratings}
    r = client.post("/api/student/self-assessment", headers=khalid, json={"milestone_id": m3["id"], "ratings": edited})
    assert r.status_code == 201  # editable while the period is open
    saved = client.get("/api/student/self-assessment", headers=khalid, params={"milestone_id": m3["id"]}).json()["submission"]
    assert set(saved["ratings"].values()) == {3}


def test_uc02_peer_evaluation_rules(client, khalid):
    project = _project(client, khalid)
    m3 = _active(project)
    ratings = _ratings(client, khalid, 3)
    me = client.get("/api/auth/me", headers=khalid).json()
    r = client.post("/api/student/peer-evaluations", headers=khalid,
                    json={"milestone_id": m3["id"], "target_id": me["id"], "ratings": ratings, "comment": "x"})
    assert r.status_code == 422  # E2a: cannot select themselves

    peers = client.get("/api/student/peers", headers=khalid, params={"milestone_id": m3["id"]}).json()["peers"]
    ali = next(p for p in peers if p["full_name"].startswith("Ali"))
    good = "Ali explains ideas clearly and helps the team when we are stuck on integration problems."
    r = client.post("/api/student/peer-evaluations", headers=khalid,
                    json={"milestone_id": m3["id"], "target_id": ali["id"], "ratings": ratings, "comment": good})
    assert r.status_code == 201 and r.json()["flagged"] is False
    r = client.post("/api/student/peer-evaluations", headers=khalid,
                    json={"milestone_id": m3["id"], "target_id": ali["id"], "ratings": ratings, "comment": good})
    assert r.status_code == 409  # one evaluation per reviewer

    nasser = next(p for p in peers if p["full_name"].startswith("Nasser"))
    r = client.post("/api/student/peer-evaluations", headers=khalid,
                    json={"milestone_id": m3["id"], "target_id": nasser["id"], "ratings": ratings, "comment": "Nasser is lazy and stupid."})
    assert r.status_code == 201 and r.json()["flagged"] is True  # E5a


def test_peer_identity_is_never_stored(client, instructor):
    projects = client.get("/api/instructor/projects", headers=instructor).json()
    evs = client.get("/api/instructor/evaluations", headers=instructor, params={"project_id": projects[0]["id"], "eval_type": "peer"}).json()
    assert evs and all(e["evaluator"] == "Anonymous" for e in evs)


def test_uc03_uc04_uc05_instructor_evaluation_generates_report(client, instructor):
    projects = client.get("/api/instructor/projects", headers=instructor).json()
    pid = projects[0]["id"]
    ov = client.get("/api/instructor/overview", headers=instructor, params={"project_id": pid}).json()
    assert ov["stats"]["flagged_comments"] >= 1
    ready = next(r for r in ov["rows"] if r["ready_for_instructor"])
    ratings = _ratings(client, instructor, 1)
    body = {"milestone_id": ov["milestone"]["id"], "target_id": ready["student_id"], "ratings": ratings, "notes": "Observed in sprint review."}
    r = client.post("/api/instructor/evaluations", headers=instructor, json=body)
    assert r.status_code == 200
    if r.json().get("requires_confirmation"):  # E5a: large instructor/peer difference
        body["acknowledge_warnings"] = True
        r = client.post("/api/instructor/evaluations", headers=instructor, json=body)
    assert r.json()["saved"] is True

    detail = client.get(f"/api/instructor/students/{ready['student_id']}", headers=instructor,
                        params={"project_id": pid, "milestone_id": ov["milestone"]["id"]}).json()
    rep = detail["report"]
    assert rep is not None and rep["source"] == "fallback"
    for m in rep["metrics"]:
        assert abs(m["external"] - (0.6 * m["instructor"] + 0.4 * m["peer_avg"])) < 0.01
        assert abs(m["gap"] - abs(m["external"] - m["self"])) < 0.01
    assert rep["content"]["actionable_steps"]


def test_instructor_precondition_requires_three_peers(client, instructor):
    projects = client.get("/api/instructor/projects", headers=instructor).json()
    pid = projects[0]["id"]
    ov = client.get("/api/instructor/overview", headers=instructor, params={"project_id": pid}).json()
    incomplete = next(r for r in ov["rows"] if r["peer_count"] < 3 and not r["instructor_done"])
    r = client.post("/api/instructor/evaluations", headers=instructor, json={
        "milestone_id": ov["milestone"]["id"], "target_id": incomplete["student_id"], "ratings": _ratings(client, instructor), "notes": ""})
    assert r.status_code == 409


def test_uc07_moderation_and_intervention(client, instructor, advisor):
    pid = client.get("/api/instructor/projects", headers=instructor).json()[0]["id"]
    ov = client.get("/api/instructor/overview", headers=instructor, params={"project_id": pid}).json()
    flagged = ov["flagged"][0]
    r = client.post(f"/api/instructor/moderation/{flagged['id']}", headers=instructor, json={"action": "remove"})
    assert r.json()["status"] == "removed"
    r = client.post("/api/instructor/interventions", headers=instructor,
                    json={"student_id": flagged["target_id"], "reason": "Repeated conflict within the team."})
    assert r.status_code == 201
    items = client.get("/api/advisor/interventions", headers=advisor).json()
    assert any(i["reason"].startswith("Repeated conflict") for i in items)
    iid = items[0]["id"]
    r = client.put(f"/api/advisor/interventions/{iid}", headers=advisor, json={"status": "acknowledged", "advisor_notes": "Meeting booked."})
    assert r.json()["status"] == "acknowledged"


def test_uc06_dashboard_trend_and_passport(client, khalid):
    d = client.get("/api/student/dashboard", headers=khalid).json()
    assert d["latest"] is not None
    assert [t["milestone"] for t in d["trend"]][:2] == ["M1", "M2"]
    pdf = client.get("/api/student/passport.pdf", headers=khalid)
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    csv = client.get("/api/student/passport.csv", headers=khalid)
    assert "Leadership" in csv.text


def test_chatbot_fallback(client, khalid):
    r = client.post("/api/chat", headers=khalid, json={"message": "Which skill should I improve?"})
    assert r.status_code == 200 and r.json()["source"] == "fallback"
    r = client.post("/api/chat", headers=khalid, json={"message": "كيف يتم حساب الفجوة؟"})
    assert "60%" in r.json()["content"]
    assert len(client.get("/api/chat", headers=khalid).json()) == 4


def test_artifact_upload(client, khalid):
    project = _project(client, khalid)
    m3 = _active(project)
    log = "a1|K|2026-10-01T10:00:00|init\na2|K|2026-10-03T11:00:00|api\na3|K|2026-10-05T12:00:00|tests"
    r = client.post("/api/student/artifacts", headers=khalid, json={"milestone_id": m3["id"], "kind": "git_log", "title": "repo", "git_log": log})
    assert r.status_code == 201 and r.json()["metrics"]["commit_count"] == 3


def test_uc08_admin_configuration_backup_and_audit(client, admin):
    r = client.put("/api/admin/settings", headers=admin, json={"values": {"instructor_weight": "0.7", "peer_weight": "0.2"}})
    assert r.status_code == 422  # weights must sum to 1
    r = client.put("/api/admin/settings", headers=admin, json={"values": {"instructor_weight": "0.6", "peer_weight": "0.4"}})
    assert r.status_code == 200
    r = client.post("/api/admin/ai/test", headers=admin)
    assert r.json()["mode"] == "fallback"  # E4a: no key -> local fallback configuration
    r = client.post("/api/admin/backups", headers=admin)
    from app.database import engine
    assert r.status_code == 201
    if engine.dialect.name == "sqlite":
        assert r.json()["verified"] is True
    else:
        assert r.json()["verified"] is False  # a data export is not a tested PostgreSQL restore
    r = client.post("/api/admin/retention/purge", headers=admin)
    assert r.status_code == 200
    logs = client.get("/api/admin/audit-logs", headers=admin).json()
    assert any(log["action"] == "backup.created" for log in logs)
    health = client.get("/api/admin/health", headers=admin).json()
    assert health["database"]["ok"]


def test_profile_update(client):
    h = login(client, "omar@student.kfu.edu.sa")
    r = client.put("/api/auth/me", headers=h, json={"mobile": "0500000000"})
    assert r.json()["mobile"] == "0500000000"


def test_student_self_registration(client):
    options = client.get("/api/auth/signup-options").json()
    assert options == []  # academic teams are not disclosed to unauthenticated registrants
    staff = login(client, "ahmed@kfu.edu.sa")
    project_id = client.get("/api/instructor/projects", headers=staff).json()[0]["id"]
    team = client.get(f"/api/projects/{project_id}", headers=staff).json()["teams"][0]
    body = {"full_name": "New Student", "email": "new.student@student.kfu.edu.sa", "password": "Secret123!", "student_number": "223000001", "team_id": team["id"]}
    assert client.post("/api/auth/register", json=body).status_code == 403
    body["team_id"] = None
    r = client.post("/api/auth/register", json=body)
    assert r.status_code == 201 and r.json()["user"]["role"] == "student"
    assert client.post("/api/auth/register", json=body).status_code == 409  # duplicate email
    h = login_as(client, "new.student@student.kfu.edu.sa", "Secret123!")
    assert client.get("/api/student/projects", headers=h).json() == []
    assert client.post(f"/api/projects/{project_id}/enrollments", headers=staff,
        json={"user_id": r.json()["user"]["id"], "team_id": team["id"]}).status_code == 201
    projects = client.get("/api/student/projects", headers=h).json()
    assert projects and projects[0]["team"]["id"] == team["id"]
    r = client.post("/api/auth/register", json={**body, "email": "x@kfu.edu.sa", "password": "short"})
    assert r.status_code == 422


def login_as(client, email, password):
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_ai_base_url_must_be_a_url(client, admin):
    r = client.put("/api/admin/settings", headers=admin, json={"values": {"ai_base_url": "AQ.someKeyPastedInTheWrongBox"}})
    assert r.status_code == 422


def test_student_directory_and_profile_feedback(client, khalid, admin):
    client.put("/api/admin/settings", headers=admin, json={"values": {"public_feedback_profiles": "true"}})
    results = client.get("/api/student/directory", headers=khalid, params={"q": "222433529"}).json()
    assert len(results) == 1 and results[0]["full_name"].startswith("Saad")
    saad = results[0]["id"]
    r = client.get(f"/api/student/profiles/{saad}/feedback", headers=khalid).json()
    fb = r["feedback"]
    # Feedback from all milestones is merged: M1 and M2 each released 3 peer reviews
    assert fb["released"] and fb["peer_count"] >= 6 and len(fb["comments"]) >= 6
    assert len(fb["instructor_comments"]) >= 2
    assert all("[Removed" not in c["text"] for c in fb["comments"])
    # The admin can turn the feature off
    client.put("/api/admin/settings", headers=admin, json={"values": {"public_feedback_profiles": "false"}})
    assert client.get("/api/student/directory", headers=khalid).status_code == 403
    client.put("/api/admin/settings", headers=admin, json={"values": {"public_feedback_profiles": "true"}})


def test_own_feedback_all_milestones(client):
    h = login(client, "ali@student.kfu.edu.sa")
    fb = client.get("/api/student/feedback/all", headers=h).json()
    assert fb["released"] and fb["peer_count"] >= 6 and fb["skills"]


def test_work_projects(client):
    h = login(client, "khalid@student.kfu.edu.sa")
    projects = client.get("/api/student/work-projects", headers=h).json()
    # Seeded artifacts are grouped under the course project
    assert len(projects) == 1 and projects[0]["file_count"] >= 4
    r = client.post("/api/student/work-projects", headers=h, json={"name": "Mobile app", "description": "Flutter app", "url": "https://github.com/x/y", "stages": 4})
    assert r.status_code == 201 and r.json()["files"] == [] and r.json()["stages"] == 4
    assert projects[0]["stages"] == 3  # the course project's three milestones
    assert client.post("/api/student/work-projects", headers=h, json={"name": "Too long", "stages": 11}).status_code == 422
    wp = r.json()["id"]
    assert client.post("/api/student/work-projects", headers=h, json={"name": "Bad", "url": "github.com"}).status_code == 422
    m3 = _active(_project(client, h))
    r = client.post("/api/student/artifacts", headers=h, json={"milestone_id": m3["id"], "work_project_id": wp, "stage": 3, "kind": "link", "title": "Design doc", "url": "https://docs.example.com"})
    assert r.status_code == 201
    bad = {"milestone_id": m3["id"], "work_project_id": wp, "stage": 5, "kind": "link", "title": "x"}
    assert client.post("/api/student/artifacts", headers=h, json=bad).status_code == 422  # only 4 stages
    detail = client.get(f"/api/student/work-projects/{wp}", headers=h).json()
    assert [(f["title"], f["stage"]) for f in detail["files"]] == [("Design doc", 3)]
    seeded = client.get(f"/api/student/work-projects/{projects[0]['id']}", headers=h).json()["files"]
    assert {f["stage"] for f in seeded} == {1, 2}  # M1 and M2 files land in stages 1 and 2
    other = login(client, "ali@student.kfu.edu.sa")
    assert client.get(f"/api/student/work-projects/{wp}", headers=other).status_code == 404
    assert client.delete(f"/api/student/work-projects/{wp}", headers=h).json()["ok"]
    assert len(client.get("/api/student/work-projects", headers=h).json()) == 1


def test_students_outside_team_are_view_only(client):
    h = login(client, "omar@student.kfu.edu.sa")
    targets = client.get("/api/student/evaluation-targets", headers=h).json()
    me = client.get("/api/auth/me", headers=h).json()
    assert targets and all(t["id"] != me["id"] for t in targets)
    mates = [t for t in targets if t["is_teammate"]]
    assert mates and targets[:len(mates)] == mates
    other = next(t for t in targets if not t["is_teammate"])
    assert other["status"] == "view_only"
    r = client.post("/api/student/peer-evaluations", headers=h,
        json={"target_id": other["id"], "ratings": _ratings(client, h, 4)})
    assert r.status_code == 403


def test_report_in_arabic(client, khalid):
    rep = client.get("/api/student/dashboard", headers=khalid).json()["latest"]
    mid = rep["milestone"]["id"]
    en = client.get(f"/api/student/reports/{mid}", headers=khalid).json()["content"]
    ar = client.get(f"/api/student/reports/{mid}", headers={**khalid, "X-Lang": "ar"}).json()["content"]
    assert en["headline"].startswith("Your focus area")
    assert ar["headline"].startswith("مجال التركيز") and "التقييم" in ar["paragraphs"][0]
    assert ar["resources"] == en["resources"] and "i18n" not in en
    # Stored once, English untouched
    again = client.get(f"/api/student/reports/{mid}", headers={**khalid, "X-Lang": "ar"}).json()["content"]
    assert again["paragraphs"] == ar["paragraphs"]
    assert client.get(f"/api/student/reports/{mid}", headers=khalid).json()["content"]["headline"] == en["headline"]


def test_work_project_team_members(client):
    owner = login(client, "omar@student.kfu.edu.sa")
    cands = client.get("/api/student/work-projects/candidates", headers=owner, params={"q": "yousef"}).json()
    majed = client.get("/api/student/work-projects/candidates", headers=owner, params={"q": "majed"}).json()[0]
    r = client.post("/api/student/work-projects", headers=owner, json={"name": "Team app", "stages": 2, "member_ids": [cands[0]["id"]]})
    assert r.status_code == 201 and [m["full_name"] for m in r.json()["members"]] == [cands[0]["full_name"]]
    wp = r.json()["id"]
    # The member sees the shared project and can add a file to it
    member = login(client, "yousef@student.kfu.edu.sa")
    shared = next(p for p in client.get("/api/student/work-projects", headers=member).json() if p["id"] == wp)
    assert shared["is_owner"] is False and shared["owner"]["full_name"].startswith("Omar")
    m3 = _active(_project(client, member))
    f = client.post("/api/student/artifacts", headers=member, json={"milestone_id": m3["id"], "work_project_id": wp, "stage": 2, "kind": "link", "title": "Specs"})
    assert f.status_code == 201
    files = client.get(f"/api/student/work-projects/{wp}", headers=owner).json()["files"]
    assert files[0]["added_by"].startswith("Yousef") and files[0]["is_mine"] is False
    # Adding another student; only the owner can remove others, a member can leave
    assert client.post(f"/api/student/work-projects/{wp}/members", headers=member, json={"student_ids": [majed["id"]]}).json()["added"] == 1
    assert client.delete(f"/api/student/work-projects/{wp}/members/{majed['id']}", headers=member).status_code == 403
    assert client.delete(f"/api/student/work-projects/{wp}", headers=member).status_code == 404  # only the owner deletes
    me = client.get("/api/auth/me", headers=member).json()["id"]
    assert client.delete(f"/api/student/work-projects/{wp}/members/{me}", headers=member).json()["ok"]
    assert all(p["id"] != wp for p in client.get("/api/student/work-projects", headers=member).json())
    outsider = login(client, "ali@student.kfu.edu.sa")
    assert client.get(f"/api/student/work-projects/{wp}", headers=outsider).status_code == 404


def test_peer_evaluation_without_comment(client):
    h = _new_student(client, "optional.comment@example.com")
    staff = login(client, "ahmed@kfu.edu.sa")
    pid = client.get("/api/instructor/projects", headers=staff).json()[0]["id"]
    teams = client.get(f"/api/projects/{pid}", headers=staff).json()["teams"]
    omar = login(client, "omar@student.kfu.edu.sa")
    team_id = client.get("/api/student/team", headers=omar).json()[0]["team"]["id"]
    code = next(t["invite_code"] for t in teams if t["id"] == team_id)
    assert client.post("/api/student/team/join", headers=h, json={"code": code}).status_code == 200
    target = next(t for t in client.get("/api/student/evaluation-targets", headers=h).json() if t["status"] == "available")
    r = client.post("/api/student/peer-evaluations", headers=h, json={"target_id": target["id"], "ratings": _ratings(client, h, 4)})
    assert r.status_code == 201 and r.json()["flagged"] is False


def _new_student(client, email):
    body = {"full_name": "Team Tester", "email": email, "password": "Secret123!"}
    assert client.post("/api/auth/register", json=body).status_code == 201
    return login_as(client, email, "Secret123!")


def test_join_team_with_invite_code(client, instructor):
    project = client.get("/api/instructor/projects", headers=instructor).json()[0]
    detail = client.get(f"/api/projects/{project['id']}", headers=instructor).json()
    team = detail["teams"][0]
    assert detail["join_code"].isdigit() and team["invite_code"].startswith(detail["join_code"] + "-")
    h = _new_student(client, "joiner@student.kfu.edu.sa")
    assert client.get("/api/student/team", headers=h).json() == []
    assert client.post("/api/student/team/join", headers=h, json={"code": "WRONG123"}).status_code == 404
    # Codes are accepted in lower case and with spaces
    r = client.post("/api/student/team/join", headers=h, json={"code": " " + team["invite_code"].lower()})
    assert r.status_code == 200 and r.json()["team"]["id"] == team["id"]
    assert client.post("/api/student/team/join", headers=h, json={"code": team["invite_code"]}).status_code == 409
    # Now enrolled, the student has an open evaluation period for the self-assessment
    projects = client.get("/api/student/projects", headers=h).json()
    assert projects and any(m["status"] == "active" for m in projects[0]["milestones"])


def test_create_team_in_an_existing_course(client, instructor):
    project = client.get("/api/instructor/projects", headers=instructor).json()[0]
    body = {"title": project["title"], "is_active": True, "course_number": "4242"}
    assert client.put(f"/api/projects/{project['id']}", headers=instructor, json=body).status_code == 200
    h = _new_student(client, "founder@student.kfu.edu.sa")
    assert client.post("/api/student/team/create", headers=h, json={"course_code": "NOPE1234", "team_name": "Gamma"}).status_code == 422
    r = client.post("/api/student/team/create", headers=h, json={"course_code": "4242", "team_name": "Team Gamma"})
    assert r.status_code == 201 and r.json()["project"]["id"] == project["id"] and r.json()["team"]["invite_code"] == "4242-TEAMGAMMA"
    other = _new_student(client, "copycat@student.kfu.edu.sa")
    dup = client.post("/api/student/team/create", headers=other, json={"course_code": "4242", "team_name": "team gamma"})
    assert dup.status_code == 409


def test_sign_in_portal_matches_the_role(client):
    staff = {"email": "ahmed@kfu.edu.sa", "password": "Password123!"}
    student = {"email": "khalid@student.kfu.edu.sa", "password": "Password123!"}
    assert client.post("/api/auth/login", json={**staff, "portal": "student"}).status_code == 403
    assert client.post("/api/auth/login", json={**student, "portal": "staff"}).status_code == 403
    assert client.post("/api/auth/login", json={**staff, "portal": "staff"}).status_code == 200
    assert client.post("/api/auth/login", json={**student, "portal": "student"}).status_code == 200


def test_team_code_is_course_number_and_team_name(client, instructor):
    h = _new_student(client, "newcourse@student.kfu.edu.sa")
    assert client.post("/api/student/team/create", headers=h, json={"course_code": "12ab", "team_name": "X"}).status_code == 422
    # An unknown course number starts a new course
    r = client.post("/api/student/team/create", headers=h, json={"course_code": "7531", "team_name": "Team Nova"})
    assert r.status_code == 201 and r.json()["team"]["invite_code"] == "7531-TEAMNOVA"
    assert r.json()["project"]["title"] == "Course 7531"
    projects = client.get("/api/student/projects", headers=h).json()
    assert any(m["status"] == "active" for m in projects[0]["milestones"])
    # A classmate joins with the readable code, typed loosely
    mate = _new_student(client, "novamate@student.kfu.edu.sa")
    r = client.post("/api/student/team/join", headers=mate, json={"code": "7531 teamnova"})
    assert r.status_code == 200 and r.json()["team"]["team_name"] == "Team Nova"
    # A second team in the same course reuses the course
    third = _new_student(client, "novathird@student.kfu.edu.sa")
    r = client.post("/api/student/team/create", headers=third, json={"course_code": "7531", "team_name": "Team Orion"})
    assert r.json()["project"]["id"] == projects[0]["id"] and r.json()["team"]["invite_code"] == "7531-TEAMORION"
    # The instructor can give an existing course its official number
    pid = client.get("/api/instructor/projects", headers=instructor).json()[0]["id"]
    body = {"title": "Graduation Project - IS 2026", "description": "x", "is_active": True, "course_number": "7531"}
    assert client.put(f"/api/projects/{pid}", headers=instructor, json=body).status_code == 409  # taken
    assert client.put(f"/api/projects/{pid}", headers=instructor, json={**body, "course_number": "4242"}).json()["join_code"] == "4242"


def test_generated_codes_are_course_numbers(client, instructor):
    """Courses and teams without a code get a numeric course number and a readable team code."""
    r = client.post("/api/projects", headers=instructor, json={"title": "Untitled course", "description": "x", "is_active": True})
    assert r.status_code in (200, 201)
    number = r.json()["join_code"]
    assert number.isdigit() and len(number) == 6
    pid = r.json()["id"]
    team = client.post(f"/api/projects/{pid}/teams", headers=instructor, json={"team_name": "Team Vega"}).json()
    assert team["invite_code"] == f"{number}-TEAMVEGA"
    seeded = client.get("/api/instructor/projects", headers=instructor).json()
    for course in seeded:
        for t in course.get("teams", []):
            assert t["invite_code"].startswith(f"{course['join_code']}-") or not course["join_code"].isdigit()
