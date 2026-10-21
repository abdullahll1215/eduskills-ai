"""Intentional course creation and supervisor assignment preserve enrollment."""
from uuid import uuid4


def student(client):
    r = client.post('/api/auth/register', json={'full_name': 'Course Explorer', 'email': f'{uuid4().hex}@student.kfu.edu.sa', 'password': 'Password123!'})
    assert r.status_code == 201
    return {'Authorization': f"Bearer {r.json()['access_token']}"}


def create(client, headers, number):
    return client.post('/api/student/team/create', headers=headers, json={
        'course_code': number, 'team_name': 'Research Team', 'confirm_new_course': True})


def test_unknown_course_requires_confirmation_without_creating_records(client, admin):
    h = student(client)
    before = client.get('/api/projects', headers=admin).json()
    r = client.post('/api/student/team/create', headers=h, json={'course_code': '9876543201', 'team_name': 'Research Team'})
    assert r.status_code == 409
    assert client.get('/api/student/team', headers=h).json() == []
    assert len(client.get('/api/projects', headers=admin).json()) == len(before)
    assert client.get('/api/student/personal-self-assessment', headers=h).status_code == 200


def test_course_preview_is_read_only_and_protected(client, admin):
    h = student(client)
    count = len(client.get('/api/projects', headers=admin).json())
    r = client.get('/api/student/team/course-preview', headers=h, params={'code': '9876543202'})
    assert r.status_code == 200 and r.json()['exists'] is False
    assert r.json()['course_number'] == '9876543202'
    assert len(client.get('/api/projects', headers=admin).json()) == count
    assert client.get('/api/student/team/course-preview', params={'code': '9876543202'}).status_code == 401
    assert client.get('/api/student/team/course-preview', headers=h, params={'code': '12ab'}).status_code == 422


def test_confirmed_course_exposes_pending_instructor(client):
    h = student(client)
    r = create(client, h, '9876543203')
    assert r.status_code == 201
    assert r.json()['project']['instructor'] is None
    assert r.json()['project']['course_number'] == '9876543203'
    assert client.get('/api/student/team', headers=h).json()[0]['project']['instructor'] is None


def test_admin_assignment_preserves_course_team_and_enrollment(client, admin):
    h = student(client)
    created = create(client, h, '9876543204').json()
    pid, tid = created['project']['id'], created['team']['id']
    email = f'{uuid4().hex}@kfu.edu.sa'
    staff = client.post('/api/admin/users', headers=admin, json={'full_name':'Course Supervisor', 'email':email, 'password':'Password123!', 'role':'instructor'}).json()
    login = client.post('/api/auth/login', json={'email':email, 'password':'Password123!'}).json()
    instructor = {'Authorization':f"Bearer {login['access_token']}"}
    before = client.get(f'/api/projects/{pid}', headers=admin).json()
    assert pid not in [p['id'] for p in client.get('/api/instructor/projects', headers=instructor).json()]
    r = client.put(f'/api/projects/{pid}/instructor', headers=admin, json={'instructor_id': staff['id']})
    assert r.status_code == 200
    assert r.json()['instructor']['id'] == staff['id']
    assert [m['id'] for m in r.json()['milestones']] == [m['id'] for m in before['milestones']]
    assert r.json()['teams'] == before['teams']
    assert pid in [p['id'] for p in client.get('/api/instructor/projects', headers=instructor).json()]
    team = client.get('/api/student/team', headers=h).json()[0]
    assert team['team']['id'] == tid
    assert team['project']['instructor']['id'] == staff['id']
    preview = client.get('/api/student/team/course-preview', headers=h, params={'code': '9876543204'}).json()
    assert preview['exists'] and preview['instructor']['id'] == staff['id']
    mate = student(client)
    r = client.post('/api/student/team/create', headers=mate, json={'course_code':'9876543204', 'team_name':'Another Team'})
    assert r.status_code == 201
    assert r.json()['project']['id'] == pid


def test_only_admin_can_assign_an_instructor(client, admin, instructor):
    h = student(client)
    pid = create(client, h, '9876543205').json()['project']['id']
    staff = client.get('/api/auth/me', headers=instructor).json()
    pupil = client.get('/api/auth/me', headers=h).json()
    for headers in [h, instructor]:
        assert client.put(f'/api/projects/{pid}/instructor', headers=headers, json={'instructor_id':staff['id']}).status_code == 403
    assert client.put(f'/api/projects/{pid}/instructor', headers=admin, json={'instructor_id':pupil['id']}).status_code == 422
    assert client.put(f'/api/projects/{pid}/instructor', headers=admin, json={'instructor_id':'missing'}).status_code == 404
    assert client.get(f'/api/projects/{pid}', headers=admin).json()['instructor'] is None


def test_readable_long_team_code_can_be_used_to_join(client):
    h = student(client)
    r = client.post('/api/student/team/create', headers=h, json={
        'course_code':'9876543206', 'team_name':'CollaborativeResearchLaboratoryTeam', 'confirm_new_course':True})
    assert r.status_code == 201
    code = r.json()['team']['invite_code']
    assert len(code) > 20
    mate = student(client)
    joined = client.post('/api/student/team/join', headers=mate, json={'code':code})
    assert joined.status_code == 200
    assert joined.json()['team']['id'] == r.json()['team']['id']


def test_admin_owned_legacy_course_can_still_be_updated(client, admin):
    owner = client.get('/api/auth/me', headers=admin).json()
    body = {'title':'Legacy admin course', 'instructor_id':owner['id'], 'is_active':True}
    r = client.post('/api/projects', headers=admin, json=body)
    assert r.status_code == 201
    updated = client.put(f"/api/projects/{r.json()['id']}", headers=admin, json={**body,'is_active':False})
    assert updated.status_code == 200 and updated.json()['is_active'] is False


def test_inactive_instructor_cannot_be_assigned(client, admin):
    h = student(client)
    course = create(client, h, '9876543207').json()
    staff = client.post('/api/admin/users', headers=admin, json={
        'full_name':'Inactive Supervisor', 'email':f'{uuid4().hex}@kfu.edu.sa',
        'password':'Password123!', 'role':'instructor', 'is_active':False}).json()
    pid = course['project']['id']
    assert client.put(f'/api/projects/{pid}/instructor', headers=admin, json={'instructor_id':staff['id']}).status_code == 422
    assert client.put(f'/api/projects/{pid}', headers=admin, json={
        'title':'Unassigned course', 'instructor_id':staff['id'], 'is_active':True}).status_code == 422
    assert client.get(f'/api/projects/{pid}', headers=admin).json()['instructor'] is None
