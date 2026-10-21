"""Catalog selection resolves real study-plan codes without provisioning courses."""
from app.services.course_catalog import COURSES, course_title
from test_course_onboarding import student


def test_catalog_contains_unique_exact_codes_and_bilingual_names():
    codes = [course['code'] for course in COURSES]
    assert len(codes) == len(set(codes)) == 59
    assert all(code.isdigit() and len(code) == 7 for code in codes)
    assert all(course['name_ar'] and course['name_en'] for course in COURSES)
    assert course_title('0924214') == 'Fundamentals of Computer Networks'
    assert course_title('0922414') == 'Mining of Massive Datasets'
    assert course_title('0602233') == 'Fundamentals of Entrepreneurship'
    assert course_title('9999999999') is None


def test_catalog_course_keeps_leading_zero_and_requires_confirmation(client, admin):
    h = student(client)
    before = len(client.get('/api/projects', headers=admin).json())
    preview = client.get('/api/student/team/course-preview', headers=h, params={'code': '0922222'}).json()
    assert preview['course_number'] == '0922222'
    assert preview['exists'] is False
    assert preview['title'] == 'Database Concepts and Design'
    assert len(client.get('/api/projects', headers=admin).json()) == before
    body = {'course_code': '0922222', 'team_name': 'Database Studio'}
    assert client.post('/api/student/team/create', headers=h, json=body).status_code == 409
    r = client.post('/api/student/team/create', headers=h, json={**body, 'confirm_new_course': True})
    assert r.status_code == 201
    course = r.json()['project']
    assert course['course_number'] == '0922222'
    assert course['title'] == 'Database Concepts and Design'
    assert course['instructor'] is None
    assert r.json()['team']['invite_code'] == '0922222-DATABASESTUDIO'


def test_demo_cohort_matches_project_implementation_course(client, khalid):
    team = client.get('/api/student/team', headers=khalid).json()[0]
    assert team['project']['course_number'] == '0922420'
    assert team['project']['title'] == 'Project Implementation · IS 2026'
    assert team['team']['invite_code'] == '0922420-TEAMALPHA'
    assert len(team['members']) == 3
    assert client.get('/api/student/reports', headers=khalid).json()


def test_showcase_does_not_repurpose_a_real_curriculum_course():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from app.database import Base
    from app.models import Project, Team
    from app.seed import seed_demo

    engine = create_engine('sqlite:///:memory:', execution_options={
        'schema_translate_map': {Base.metadata.schema: None}})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        real = Project(title='Existing real course', join_code='0922410', is_active=True)
        db.add(real)
        db.flush()
        team = Team(project_id=real.id, team_name='Existing class', invite_code='0922410-EXISTING')
        db.add(team)
        db.flush()
        original_id, team_id = real.id, team.id
        sample = seed_demo(db, showcase=True)
        db.commit()
        assert sample.id != original_id and sample.join_code != '0922410'
        assert sample.title == 'Showcase - Project Proposal · IS 2026'
        assert db.get(Project, original_id).title == 'Existing real course'
        assert db.get(Team, team_id).invite_code == '0922410-EXISTING'
        assert db.get(Team, team_id).project_id == original_id
    engine.dispose()
