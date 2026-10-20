"""Showcase data: an administrator adds a sample cohort to a live system to demonstrate every feature."""


def _sign_in(client, email, password, portal):
    r = client.post("/api/auth/login", json={"email": email, "password": password, "portal": portal})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_showcase_creates_working_accounts(client, admin, instructor):
    assert client.post("/api/admin/showcase", headers=instructor, json={}).status_code == 403
    assert client.get("/api/admin/showcase", headers=admin).json()["exists"] is False

    r = client.post("/api/admin/showcase", headers=admin, json={})
    assert r.status_code == 201, r.text
    data = r.json()
    password = data["password"]
    assert password.startswith("Demo-") and data["course_number"].isdigit()
    emails = {a["role"]: a["email"] for a in data["accounts"]}
    assert emails == {"Instructor": "ahmed@demo.example.com", "Student": "khalid@demo.example.com", "Academic advisor": "advisor@demo.example.com"}
    assert client.post("/api/admin/showcase", headers=admin, json={}).status_code == 409

    # The instructor sees only the showcase course, with its teams and pending moderation
    doctor = _sign_in(client, emails["Instructor"], password, "staff")
    courses = client.get("/api/instructor/projects", headers=doctor).json()
    assert [c["title"] for c in courses] == [data["project"]]
    overview = client.get("/api/instructor/overview", headers=doctor, params={"project_id": courses[0]["id"]}).json()
    assert overview["flagged"]

    # The student has reports, a team with a readable code, files and a private practice assessment
    student = _sign_in(client, emails["Student"], password, "student")
    team = client.get("/api/student/team", headers=student).json()[0]
    assert team["team"]["invite_code"] == f"{data['course_number']}-TEAMALPHA" and len(team["members"]) == 3
    assert client.get("/api/student/reports", headers=student).json()
    assert client.get("/api/student/personal-self-assessment", headers=student).json()["submission"]
    assert client.get("/api/student/work-projects", headers=student).json()

    # Showcase students carry clearly fake university IDs
    mates = client.get("/api/student/directory", headers=student, params={"q": "DEMO-"}).json()
    assert len(mates) >= 7 and all(m["student_number"].startswith("DEMO-") for m in mates)

    # Showcase accounts cannot use the other portal, and the existing demo course is untouched
    assert client.post("/api/auth/login", json={"email": emails["Student"], "password": password, "portal": "staff"}).status_code == 403
    assert all(c["title"] != data["project"] for c in client.get("/api/instructor/projects", headers=instructor).json())
