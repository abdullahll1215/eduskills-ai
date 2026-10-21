"""Student portal: self-assessment (UC-01), anonymous peer evaluation (UC-02),
dashboard & skills passport (UC-06), AI growth reports (UC-05), artifacts and the AI coach chatbot."""
import random

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from ..database import SessionLocal, get_db
from ..deps import student_only
from ..models import (
    AIReport,
    Artifact,
    ChatMessage,
    Enrollment,
    Evaluation,
    EvalType,
    Milestone,
    Moderation,
    Project,
    PersonalSelfAssessment,
    Role,
    SkillRating,
    Team,
    User,
    WorkProject,
    WorkProjectMember,
    utcnow,
)
from ..schemas import ArtifactIn, ChatIn, CommentCheckIn, CreateTeamIn, JoinTeamIn, MembersIn, PeerEvaluationIn, RatingsMixin, SelfAssessmentIn, WorkProjectIn
from ..security import decrypt, encrypt, reviewer_hash
from ..services import ai_engine, analytics, artifacts, audit, nlp, passport
from ..services.common import competency_out, course_number_of, default_work_project, enrollment_of, find_team_by_code, team_code, get_or_404, milestone_out, teammates, validate_ratings
from ..services.settings_store import get_raw, scoring
from ..services.report_state import is_current, lock_student_milestone

router = APIRouter(prefix="/api/student", tags=["student"])


def _require_enrollment(db: Session, user: User, milestone: Milestone) -> Enrollment:
    enr = enrollment_of(db, user.id, milestone.project_id)
    if not enr:
        raise HTTPException(403, "You are not enrolled in this project")
    return enr


def _require_open(milestone: Milestone):
    if not milestone.is_open:
        raise HTTPException(409, "The evaluation period for this milestone is closed")  # UC-01 E1a


def run_job(bg: BackgroundTasks, fn, *args):
    """Background task locally; inline on serverless platforms, which freeze the process after the response."""
    from ..config import ON_VERCEL

    if ON_VERCEL:
        fn(*args)
    else:
        bg.add_task(fn, *args)


def trigger_report(student_id: str, milestone_id: str, force: bool = False):
    """Background job: UC-04 blind spot detection then UC-05 narrative generation."""
    db = SessionLocal()
    try:
        ai_engine.generate_report(db, student_id, milestone_id, force=force)
        db.commit()
    finally:
        db.close()


def _milestone_status(db: Session, user: User, enr: Enrollment, m: Milestone) -> dict:
    cfg = scoring(db)
    mates = teammates(db, enr)
    snap = analytics.snapshot(db, user.id, m.id, cfg)
    given = {
        e.target_id
        for e in db.scalars(
            select(Evaluation).where(
                Evaluation.milestone_id == m.id,
                Evaluation.eval_type == EvalType.PEER.value,
                Evaluation.reviewer_key == reviewer_hash(user.id, m.project_id),
            )
        )
    }
    report = db.scalar(select(AIReport.id).where(AIReport.student_id == user.id, AIReport.milestone_id == m.id))
    given.intersection_update(t.id for t in mates)
    parts = [
        1.0 if snap.has_self else 0.0,
        (len(given) / len(mates)) if mates else 1.0,
        min(snap.peer_count / cfg.min_peer_evaluations, 1.0),
        1.0 if snap.has_instructor else 0.0,
    ]
    return {
        **milestone_out(m),
        "self_done": snap.has_self,
        "peers_given": len(given),
        "peers_total": len(mates),
        "peers_received": snap.peer_count,
        "min_peers": cfg.min_peer_evaluations,
        "instructor_done": snap.has_instructor,
        "report_id": report,
        "progress": round(100 * sum(parts) / len(parts)),
    }


@router.get("/projects")
def my_projects(user: User = Depends(student_only), db: Session = Depends(get_db)):
    out = []
    for enr in db.scalars(select(Enrollment).where(Enrollment.user_id == user.id)):
        project = db.get(Project, enr.project_id)
        if not project.is_active:
            continue
        out.append(
            {
                "id": project.id,
                "title": project.title,
                "description": project.description,
                "instructor": project.instructor.full_name if project.instructor else None,
                "team": {"id": enr.team.id, "name": enr.team.team_name} if enr.team else None,
                "teammates": [{"id": t.id, "full_name": t.full_name} for t in teammates(db, enr)],
                "milestones": [_milestone_status(db, user, enr, m) for m in project.milestones],
            }
        )
    return out


# ------------------------------------------------------------- UC-01 --


@router.get("/personal-self-assessment")
def get_personal_self_assessment(user: User = Depends(student_only), db: Session = Depends(get_db)):
    assessment = db.get(PersonalSelfAssessment, user.id)
    return {
        "milestone": None,
        "competencies": [competency_out(c) for c in analytics.competencies(db)],
        "submission": {"ratings": assessment.ratings, "created_at": assessment.updated_at, "is_locked": False} if assessment else None,
    }


@router.post("/personal-self-assessment", status_code=201)
def save_personal_self_assessment(body: RatingsMixin, user: User = Depends(student_only), db: Session = Depends(get_db)):
    ratings = validate_ratings(db, body.ratings)
    # Serialize first saves and edits for this owner, including when no assessment exists yet.
    db.execute(select(User.id).where(User.id == user.id).with_for_update())
    assessment = db.get(PersonalSelfAssessment, user.id)
    if assessment is None:
        assessment = PersonalSelfAssessment(student_id=user.id, ratings=ratings)
        db.add(assessment)
    else:
        assessment.ratings = ratings
        assessment.updated_at = utcnow()
    audit.log(db, user, "assessment.personal_saved", "user", user.id)
    db.commit()
    return {"message": "Self-assessment saved", "created_at": assessment.updated_at}


@router.get("/self-assessment")
def get_self_assessment(milestone_id: str, user: User = Depends(student_only), db: Session = Depends(get_db)):
    m = get_or_404(db, Milestone, milestone_id, "Milestone")
    _require_enrollment(db, user, m)
    ev = db.scalar(
        select(Evaluation)
        .options(selectinload(Evaluation.ratings))
        .where(Evaluation.milestone_id == m.id, Evaluation.target_id == user.id, Evaluation.eval_type == EvalType.SELF.value)
    )
    return {
        "milestone": milestone_out(m),
        "competencies": [competency_out(c) for c in analytics.competencies(db)],
        "submission": None
        if not ev
        else {
            "id": ev.id,
            "ratings": {r.competency_id: r.score for r in ev.ratings},
            "evidence": decrypt(ev.comment_enc),
            "evidence_link": ev.evidence_link,
            "created_at": ev.created_at,
            "is_locked": ev.is_locked,
        },
    }


@router.post("/self-assessment", status_code=201)
def submit_self_assessment(
    body: SelfAssessmentIn, bg: BackgroundTasks, user: User = Depends(student_only), db: Session = Depends(get_db)
):
    m = get_or_404(db, Milestone, body.milestone_id, "Milestone")
    _require_enrollment(db, user, m)
    _require_open(m)
    lock_student_milestone(db, user.id, m.id)
    ratings = validate_ratings(db, body.ratings)
    existing = db.scalar(
        select(Evaluation).where(
            Evaluation.milestone_id == m.id, Evaluation.target_id == user.id, Evaluation.eval_type == EvalType.SELF.value
        )
    )
    # The student can keep editing while the evaluation period is open.
    if existing:
        db.delete(existing)
        db.flush()
    ev = Evaluation(
        project_id=m.project_id,
        milestone_id=m.id,
        evaluator_id=user.id,
        target_id=user.id,
        eval_type=EvalType.SELF.value,
        reviewer_key=EvalType.SELF.value,
        comment_enc=encrypt(body.evidence.strip()),
        evidence_link=body.evidence_link,
        is_locked=False,
    )
    ev.ratings = [SkillRating(competency_id=cid, score=s) for cid, s in ratings.items()]
    db.add(ev)
    audit.log(db, user, "evaluation.self_submitted", "evaluation", ev.id, f"milestone=M{m.number}")
    db.commit()
    run_job(bg, trigger_report, user.id, m.id, existing is not None)  # UC-01 step 7; refresh the report after an edit
    return {"id": ev.id, "created_at": ev.created_at, "message": "Self-assessment saved"}


# ------------------------------------------------------- team membership --
# A student without a team joins one with its invite code, or creates one in a course
# using the course join code from the instructor. Nobody can pick a course or team from a list.


def _team_out(db: Session, enr: Enrollment) -> dict:
    project = db.get(Project, enr.project_id)
    team = db.get(Team, enr.team_id) if enr.team_id else None
    return {
        "project": {"id": project.id, "title": project.title, "course_number": project.join_code,
                    "instructor": {"id": project.instructor.id, "full_name": project.instructor.full_name} if project.instructor else None},
        "team": {"id": team.id, "team_name": team.team_name, "invite_code": team.invite_code} if team else None,
        "members": [{"id": u.id, "full_name": u.full_name} for u in teammates(db, enr)] if team else [],
    }


def _place_in_team(db: Session, user: User, team: Team) -> Enrollment:
    project = team.project
    if not project.is_active:
        raise HTTPException(409, "This course is no longer active")
    enr = enrollment_of(db, user.id, project.id)
    if enr and enr.team_id:
        raise HTTPException(409, "You are already in a team in this course")
    if enr:
        enr.team_id = team.id
    else:
        enr = Enrollment(user_id=user.id, project_id=project.id, team_id=team.id)
        db.add(enr)
    if project.instructor_id:
        audit.notify(db, project.instructor_id, f"{user.full_name} joined {team.team_name}", project.title, "info", "/instructor/projects")
    return enr


@router.get("/team")
def my_teams(user: User = Depends(student_only), db: Session = Depends(get_db)):
    return [_team_out(db, e) for e in db.scalars(select(Enrollment).where(Enrollment.user_id == user.id))]


@router.get("/team/course-preview")
def preview_course(code: str, user: User = Depends(student_only), db: Session = Depends(get_db)):
    number = course_number_of(code)
    project = db.scalar(select(Project).where(Project.join_code == number))
    return {
        "course_number": number, "exists": project is not None,
        "title": project.title if project else None,
        "is_active": project.is_active if project else None,
        "instructor": {"id": project.instructor.id, "full_name": project.instructor.full_name} if project and project.instructor else None,
    }


@router.post("/team/join")
def join_team(body: JoinTeamIn, user: User = Depends(student_only), db: Session = Depends(get_db)):
    team = find_team_by_code(db, body.code)
    if not team:
        raise HTTPException(404, "No team has this invite code")
    enr = _place_in_team(db, user, team)
    for mate in teammates(db, enr):
        audit.notify(db, mate.id, f"{user.full_name} joined your team", team.team_name, "info", "/student")
    audit.log(db, user, "team.joined", "team", team.id, team.team_name)
    db.commit()
    return _team_out(db, enr)


@router.post("/team/create", status_code=201)
def create_team(body: CreateTeamIn, user: User = Depends(student_only), db: Session = Depends(get_db)):
    number = course_number_of(body.course_code)
    project = db.scalar(select(Project).where(Project.join_code == number))
    if not project:
        if not body.confirm_new_course:
            raise HTTPException(409, "This course number is new. Confirm creating a course without an instructor, or check the number.")
        # Explicit consent creates a flexible workspace; only an admin assigns its instructor.
        project = Project(title=f"Course {number}", join_code=number, is_active=True)
        db.add(project)
        db.flush()
        for i, stage in enumerate(["Requirements", "Design", "Implementation"], start=1):
            db.add(Milestone(project_id=project.id, number=i, name=stage, status="active" if i == 1 else "planned"))
        audit.log(db, user, "project.created_by_student", "project", project.id, number)
    name = body.team_name.strip()
    if db.scalar(select(Team.id).where(Team.project_id == project.id, Team.team_name.ilike(name))):
        raise HTTPException(409, "A team with this name already exists in this course")
    team = Team(project_id=project.id, team_name=name, invite_code=team_code(db, number, name))
    db.add(team)
    db.flush()
    db.refresh(team)
    enr = _place_in_team(db, user, team)
    audit.log(db, user, "team.created", "team", team.id, name)
    db.commit()
    return _team_out(db, enr)


# ------------------------------------------------------------- UC-02 --


@router.get("/peers")
def peers_to_evaluate(milestone_id: str, user: User = Depends(student_only), db: Session = Depends(get_db)):
    m = get_or_404(db, Milestone, milestone_id, "Milestone")
    enr = _require_enrollment(db, user, m)
    cfg = scoring(db)
    my_hash = reviewer_hash(user.id, m.project_id)
    done = set(
        db.scalars(
            select(Evaluation.target_id).where(
                Evaluation.milestone_id == m.id, Evaluation.eval_type == EvalType.PEER.value, Evaluation.reviewer_key == my_hash
            )
        )
    )
    self_done = set(
        db.scalars(
            select(Evaluation.target_id).where(Evaluation.milestone_id == m.id, Evaluation.eval_type == EvalType.SELF.value)
        )
    )
    mates = teammates(db, enr)
    return {
        "milestone": milestone_out(m),
        "team_size_ok": len(mates) >= cfg.min_peer_evaluations,
        "min_peers": cfg.min_peer_evaluations,
        "competencies": [competency_out(c) for c in analytics.competencies(db)],
        "peers": [
            {
                "id": t.id,
                "full_name": t.full_name,
                "evaluated": t.id in done,
                "available": m.is_open and ((t.id in self_done) or not cfg.require_self_before_peer),
            }
            for t in mates
        ],
    }


def _open_milestone_of(db: Session, student_id: str, prefer_project: str | None = None, allowed_projects: set[str] | None = None) -> Milestone | None:
    """The evaluation period currently open for a student (their own project's first when several)."""
    projects = list(db.scalars(select(Enrollment.project_id).where(Enrollment.user_id == student_id)))
    projects.sort(key=lambda p: p != prefer_project)
    for pid in projects:
        if allowed_projects is not None and pid not in allowed_projects:
            continue
        m = db.scalar(select(Milestone).where(Milestone.project_id == pid, Milestone.status == "active").order_by(Milestone.number))
        if m:
            return m
    return None


def _evaluation_status(db: Session, reviewer: User, target_id: str, m: Milestone | None, self_first: bool) -> str:
    if m is None:
        return "closed"
    key = reviewer_hash(reviewer.id, m.project_id)
    if db.scalar(select(Evaluation.id).where(Evaluation.milestone_id == m.id, Evaluation.target_id == target_id, Evaluation.reviewer_key == key)):
        return "evaluated"
    if self_first and not db.scalar(
        select(Evaluation.id).where(Evaluation.milestone_id == m.id, Evaluation.target_id == target_id, Evaluation.eval_type == EvalType.SELF.value)
    ):
        return "waiting_self"
    return "available"


def _shared_team_projects(db: Session, reviewer_id: str, target_id: str) -> set[str]:
    mine = select(Enrollment.team_id).where(Enrollment.user_id == reviewer_id, Enrollment.team_id.is_not(None))
    return set(db.scalars(select(Enrollment.project_id).join(Project, Project.id == Enrollment.project_id).where(
        Enrollment.user_id == target_id, Enrollment.team_id.in_(mine), Project.is_active.is_(True))))


@router.get("/evaluation-targets")
def evaluation_targets(q: str = "", user: User = Depends(student_only), db: Session = Depends(get_db)):
    """Only teammates can be evaluated. Other published profiles are view-only."""
    cfg = scoring(db)
    query = select(User).where(User.role == Role.STUDENT.value, User.is_active.is_(True), User.id != user.id)
    if get_raw(db, "public_feedback_profiles") != "true":
        team_ids = _team_ids(db, user.id)
        query = query.join(Enrollment, Enrollment.user_id == User.id).where(Enrollment.team_id.in_(team_ids)).distinct()
    if q.strip():
        like = f"%{q.strip().lower()}%"
        query = query.where(User.full_name.ilike(like) | User.student_number.ilike(like))
    out = []
    teammates_first = select(Enrollment.user_id).where(Enrollment.team_id.in_(_team_ids(db, user.id)))
    for u in db.scalars(query.order_by(User.id.in_(teammates_first).desc(), User.full_name).limit(20)):
        shared = _shared_team_projects(db, user.id, u.id)
        m = _open_milestone_of(db, u.id, allowed_projects=shared) if shared else None
        enrollments = select(Enrollment).join(Project, Project.id == Enrollment.project_id).where(
            Enrollment.user_id == u.id, Project.is_active.is_(True))
        if shared:
            enrollments = enrollments.where(Enrollment.project_id.in_(shared))
        enr = db.scalar(enrollments.order_by(Enrollment.project_id))
        out.append({
            "id": u.id, "full_name": u.full_name, "student_number": u.student_number,
            "team": enr.team.team_name if enr and enr.team else None,
            "project": db.get(Project, enr.project_id).title if enr else None,
            "is_teammate": bool(shared),
            "status": _evaluation_status(db, user, u.id, m, cfg.require_self_before_peer) if shared else "view_only",
        })
    out.sort(key=lambda r: not r["is_teammate"])
    return out[:20]


@router.post("/peer-check")
def check_comment(body: CommentCheckIn, user: User = Depends(student_only), db: Session = Depends(get_db)):
    """Live feedback for the reviewer (local filter only, fast)."""
    r = nlp.content_filter(body.comment)
    return {"is_toxic": r.is_toxic, "reason": r.reason, "is_constructive": r.is_constructive, "hints": r.hints}


@router.post("/peer-evaluations", status_code=201)
def submit_peer_evaluation(
    body: PeerEvaluationIn, bg: BackgroundTasks, user: User = Depends(student_only), db: Session = Depends(get_db)
):
    if body.target_id == user.id:
        raise HTTPException(422, "You cannot evaluate yourself as a peer")  # UC-02 E2a
    target = db.get(User, body.target_id)
    if not target or target.role != Role.STUDENT.value or not target.is_active:
        raise HTTPException(404, "Student not found")
    shared_projects = _shared_team_projects(db, user.id, target.id)
    if not shared_projects:
        raise HTTPException(403, "You may only evaluate students in your own team")
    preferred = get_or_404(db, Milestone, body.milestone_id, "Milestone") if body.milestone_id else None
    if preferred and preferred.project_id not in shared_projects:
        raise HTTPException(403, "You may only evaluate students in your own team")
    m = preferred or _open_milestone_of(db, target.id, allowed_projects=shared_projects)
    if m is None:
        raise HTTPException(409, "No evaluation period is open for this student right now")
    _require_open(m)
    lock_student_milestone(db, body.target_id, m.id)
    cfg = scoring(db)
    if cfg.require_self_before_peer and not db.scalar(
        select(Evaluation.id).where(
            Evaluation.milestone_id == m.id, Evaluation.target_id == body.target_id, Evaluation.eval_type == EvalType.SELF.value
        )
    ):
        raise HTTPException(409, "This student has not completed their self-assessment yet")
    ratings = validate_ratings(db, body.ratings)
    key = reviewer_hash(user.id, m.project_id)  # UC-02 step 3: salted SHA-256
    if db.scalar(
        select(Evaluation.id).where(
            Evaluation.milestone_id == m.id, Evaluation.target_id == body.target_id, Evaluation.reviewer_key == key
        )
    ):
        raise HTTPException(409, "You have already evaluated this student in the current evaluation period")

    comment = body.comment.strip()
    # UC-02 step 5: AI content filter (the written comment is optional)
    verdict = ai_engine.moderate(db, comment) if comment else nlp.FilterResult(False, None, True)
    ev = Evaluation(
        project_id=m.project_id,
        milestone_id=m.id,
        evaluator_id=None,  # double-blind: identity is never stored in clear
        target_id=body.target_id,
        eval_type=EvalType.PEER.value,
        reviewer_key=key,
        comment_enc=encrypt(comment) if comment else None,
        sentiment=nlp.sentiment(comment) if comment else None,
        is_flagged=verdict.is_toxic,
        flag_reason=verdict.reason,
        moderation_status=Moderation.PENDING.value if verdict.is_toxic else Moderation.NONE.value,
    )
    ev.ratings = [SkillRating(competency_id=cid, score=s) for cid, s in ratings.items()]
    db.add(ev)
    audit.log(db, None, "evaluation.peer_submitted", "evaluation", ev.id, f"milestone=M{m.number} flagged={verdict.is_toxic}")
    if verdict.is_toxic:
        if m.project.instructor_id:
            audit.notify(db, m.project.instructor_id, "Peer feedback flagged for review", verdict.reason or "", "moderation", "/instructor")
    else:
        audit.notify(db, body.target_id, "You received new anonymous peer feedback", f"Milestone M{m.number}", "feedback", "/student")
    db.commit()
    run_job(bg, trigger_report, body.target_id, m.id)
    return {
        "id": ev.id,
        "flagged": verdict.is_toxic,
        "message": "Your comment was flagged by the AI content filter and held for instructor review. Your ratings were recorded."
        if verdict.is_toxic
        else "Peer evaluation submitted anonymously",
    }


def _feedback_summary(db: Session, student_id: str, m: Milestone) -> dict:
    """Peer feedback summary. Comments are only released once the minimum number of reviewers is reached,
    so a single reviewer cannot be identified. Flagged or removed comments are never included."""
    cfg = scoring(db)
    snap = analytics.snapshot(db, student_id, m.id, cfg)
    released = snap.peer_count >= cfg.min_peer_evaluations
    comments = list(snap.peer_comments) if released else []
    random.shuffle(comments)
    inst = db.scalar(
        select(Evaluation).where(Evaluation.milestone_id == m.id, Evaluation.target_id == student_id, Evaluation.eval_type == EvalType.INSTRUCTOR.value)
    )
    notes = decrypt(inst.notes_enc) if inst else ""
    return {
        "peer_count": snap.peer_count,
        "min_peers": cfg.min_peer_evaluations,
        "released": released,
        "comments": [{"text": c, "sentiment": nlp.sentiment(c)} for c in comments],
        "skills": [{"name": s.name, "code": s.code, "peer_avg": s.peer_avg if released else None} for s in snap.skills],
        "instructor_comments": [{"text": notes, "created_at": inst.created_at}] if notes else [],
    }


@router.get("/feedback")
def received_feedback(milestone_id: str, user: User = Depends(student_only), db: Session = Depends(get_db)):
    m = get_or_404(db, Milestone, milestone_id, "Milestone")
    _require_enrollment(db, user, m)
    return _feedback_summary(db, user.id, m)


def _team_ids(db: Session, student_id: str) -> set[str]:
    return set(db.scalars(select(Enrollment.team_id).join(Project, Project.id == Enrollment.project_id)
        .where(Enrollment.user_id == student_id, Enrollment.team_id.is_not(None), Project.is_active.is_(True))))


def _require_public_profiles(db: Session):
    if get_raw(db, "public_feedback_profiles") != "true":
        raise HTTPException(403, "Viewing other students' feedback is turned off by the administrator")


@router.get("/directory")
def student_directory(q: str = "", user: User = Depends(student_only), db: Session = Depends(get_db)):
    """Search students on the platform by name or university ID."""
    _require_public_profiles(db)
    query = select(User).where(User.role == Role.STUDENT.value, User.is_active.is_(True))
    if q.strip():
        like = f"%{q.strip().lower()}%"
        query = query.where(User.full_name.ilike(like) | User.student_number.ilike(like))
    out = []
    for u in db.scalars(query.order_by(User.full_name).limit(20)):
        enr = db.scalar(select(Enrollment).where(Enrollment.user_id == u.id))
        out.append({
            "id": u.id,
            "full_name": u.full_name,
            "student_number": u.student_number,
            "team": enr.team.team_name if enr and enr.team else None,
            "project": db.get(Project, enr.project_id).title if enr else None,
            "is_me": u.id == user.id,
        })
    return out


def _all_feedback(db: Session, student_id: str, milestones: list[Milestone]) -> dict:
    """All of a student's released feedback across every milestone, merged into one summary."""
    cfg = scoring(db)
    comments: list[str] = []
    notes: list[dict] = []
    per_skill: dict[str, list[float]] = {}
    names: dict[str, str] = {}
    reviews = 0
    for m in milestones:
        snap = analytics.snapshot(db, student_id, m.id, cfg)
        if snap.instructor_notes:
            inst = db.scalar(
                select(Evaluation).where(Evaluation.milestone_id == m.id, Evaluation.target_id == student_id, Evaluation.eval_type == EvalType.INSTRUCTOR.value)
            )
            notes.append({"text": snap.instructor_notes, "created_at": inst.created_at if inst else None})
        if snap.peer_count < cfg.min_peer_evaluations:
            continue  # not released yet: keeps reviewers anonymous
        reviews += snap.peer_count
        comments += snap.peer_comments
        for sk in snap.skills:
            names[sk.code] = sk.name
            if sk.peer_avg is not None:
                per_skill.setdefault(sk.code, []).extend([sk.peer_avg] * snap.peer_count)
    random.shuffle(comments)
    order = [c.code for c in analytics.competencies(db)]
    return {
        "peer_count": reviews,
        "min_peers": cfg.min_peer_evaluations,
        "released": reviews > 0,
        "comments": [{"text": c, "sentiment": nlp.sentiment(c)} for c in comments],
        "skills": [
            {"name": names.get(code, code), "code": code, "peer_avg": round(sum(v) / len(v), 2) if (v := per_skill.get(code)) else None}
            for code in order
            if code in names
        ],
        "instructor_comments": sorted(notes, key=lambda n: str(n["created_at"] or ""), reverse=True),
    }


@router.get("/feedback/all")
def my_feedback_all(user: User = Depends(student_only), db: Session = Depends(get_db)):
    """The signed-in student's own feedback, all milestones together."""
    enr = db.scalar(select(Enrollment).where(Enrollment.user_id == user.id))
    if not enr:
        return None
    return _all_feedback(db, user.id, list(db.get(Project, enr.project_id).milestones))


@router.get("/profiles/{student_id}/feedback")
def student_profile_feedback(student_id: str, user: User = Depends(student_only), db: Session = Depends(get_db)):
    """Another student's anonymous peer feedback and instructor comments, all milestones together."""
    _require_public_profiles(db)
    shared_teams = _team_ids(db, user.id) & _team_ids(db, student_id)
    target = get_or_404(db, User, student_id, "Student")
    if target.role != Role.STUDENT.value or not target.is_active:
        raise HTTPException(404, "Student not found")
    enrollments = select(Enrollment).join(Project, Project.id == Enrollment.project_id).where(
        Enrollment.user_id == target.id, Project.is_active.is_(True))
    authorized_enrollments = list(db.scalars(enrollments.order_by(Enrollment.project_id)))
    enr = authorized_enrollments[0] if authorized_enrollments else None
    info = {"id": target.id, "full_name": target.full_name, "student_number": target.student_number, "team": enr.team.team_name if enr and enr.team else None}
    if not enr:
        return {"student": info, "feedback": None}
    milestones = [m for enrollment in authorized_enrollments for m in db.get(Project, enrollment.project_id).milestones]
    audit.log(db, user, "feedback.profile_viewed", "user", target.id)
    db.commit()
    summary = _all_feedback(db, target.id, milestones)
    if student_id != user.id:
        # Public profiles contain only released aggregate scores. Written feedback and
        # instructor notes remain limited to the courses where both students share a team.
        private_milestones = [m for enrollment in authorized_enrollments if enrollment.team_id in shared_teams
                              for m in db.get(Project, enrollment.project_id).milestones]
        private = _all_feedback(db, target.id, private_milestones)
        summary["comments"] = private["comments"]
        summary["instructor_comments"] = private["instructor_comments"]
    return {"student": info, "feedback": summary}


# ------------------------------------------------------------- UC-06 --


def _report_out(rep: AIReport) -> dict:
    return {
        "id": rep.id,
        "milestone": milestone_out(rep.milestone),
        "narrative": rep.narrative,
        "content": ai_engine.localized_content(rep),
        "source": rep.source,
        "overall_self": rep.overall_self,
        "overall_external": rep.overall_external,
        "overall_gap": rep.overall_gap,
        "overall_level": rep.overall_level,
        "generated_at": rep.generated_at,
        "metrics": [
            {
                "competency_id": d.competency_id,
                "code": d.competency.code,
                "skill": d.competency.skill_name,
                "self": d.self_score,
                "peer_avg": d.peer_avg,
                "instructor": d.instructor_score,
                "external": d.external_avg,
                "gap": d.gap_score,
                "direction": d.direction,
                "level": d.level,
            }
            for d in sorted(rep.metrics, key=lambda d: d.competency.sort_order)
        ],
    }


@router.get("/dashboard")
def dashboard(project_id: str | None = None, user: User = Depends(student_only), db: Session = Depends(get_db)):
    enrs = list(db.scalars(select(Enrollment).where(Enrollment.user_id == user.id)))
    if project_id:
        enrs = [e for e in enrs if e.project_id == project_id]
    if not enrs:
        return {"project": None, "reports": [], "milestones": [], "latest": None, "provisional": None}
    enr = enrs[0]
    project = db.get(Project, enr.project_id)
    reports = passport.student_reports(db, user.id, project.id)
    milestones = [_milestone_status(db, user, enr, m) for m in project.milestones]

    provisional = None
    active = next((m for m in project.milestones if m.is_open), None)
    if active and not any(r.milestone_id == active.id for r in reports):
        snap = analytics.snapshot(db, user.id, active.id)
        provisional = {
            "milestone": milestone_out(active),
            "skills": [{"skill": s.name, "self": s.self_score, "peer_avg": s.peer_avg if snap.peer_complete else None} for s in snap.skills],
        }

    return {
        "project": {"id": project.id, "title": project.title},
        "latest": _report_out(reports[-1]) if reports else None,
        "trend": [
            {
                "milestone": f"M{r.milestone.number}",
                "name": r.milestone.name,
                "self": r.overall_self,
                "external": r.overall_external,
                "gap": r.overall_gap,
                **{d.competency.code: d.external_avg for d in r.metrics},
            }
            for r in reports
        ],
        "milestones": milestones,
        "provisional": provisional,
    }


@router.get("/reports")
def list_reports(project_id: str | None = None, user: User = Depends(student_only), db: Session = Depends(get_db)):
    return [_report_out(r) for r in passport.student_reports(db, user.id, project_id)]


@router.get("/reports/{milestone_id}")
def get_report(milestone_id: str, user: User = Depends(student_only), db: Session = Depends(get_db)):
    rep = db.scalar(select(AIReport).where(AIReport.student_id == user.id, AIReport.milestone_id == milestone_id))
    if not rep:
        raise HTTPException(404, "No report is available for this milestone yet")
    if not is_current(db, rep):
        raise HTTPException(409, "Assessment inputs changed; this report must be regenerated")
    return _report_out(rep)


@router.get("/passport.pdf")
def passport_pdf(project_id: str | None = None, user: User = Depends(student_only), db: Session = Depends(get_db)):
    if not passport.student_reports(db, user.id, project_id):
        raise HTTPException(404, "No Data Available")  # UC-06 E2a
    try:
        pdf = passport.to_pdf(db, user, project_id)
    except Exception:  # noqa: BLE001 - UC-06 E6a: fall back to CSV when PDF generation is not supported
        return _passport_csv(db, user, project_id)
    audit.log(db, user, "passport.exported", "user", user.id, "pdf")
    db.commit()
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="skills-passport.pdf"'})


@router.get("/passport.csv")
def passport_csv(project_id: str | None = None, user: User = Depends(student_only), db: Session = Depends(get_db)):
    if not passport.student_reports(db, user.id, project_id):
        raise HTTPException(404, "No Data Available")
    return _passport_csv(db, user, project_id)


def _passport_csv(db: Session, user: User, project_id: str | None):
    return Response(
        passport.to_csv(db, user, project_id),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="skills-passport.csv"'},
    )


# --------------------------------------------------------- artifacts --


def _artifact_out(a: Artifact) -> dict:
    return {"id": a.id, "milestone_id": a.milestone_id, "work_project_id": a.work_project_id, "stage": a.stage or 1, "kind": a.kind, "title": a.title, "url": a.url, "metrics": a.metrics, "created_at": a.created_at}


def _member_ids(db: Session, wp: WorkProject) -> list[str]:
    return list(db.scalars(select(WorkProjectMember.user_id).where(WorkProjectMember.work_project_id == wp.id).order_by(WorkProjectMember.added_at)))


def _work_project_for(db: Session, user: User, wp_id: str, owner_only: bool = False) -> WorkProject:
    """The project when the user owns it or (unless owner_only) is a member of it."""
    wp = db.get(WorkProject, wp_id)
    if not wp or (wp.student_id != user.id and (owner_only or user.id not in _member_ids(db, wp))):
        raise HTTPException(404, "Project not found")
    return wp


def _own_work_project(db: Session, user: User, wp_id: str) -> WorkProject:
    return _work_project_for(db, user, wp_id, owner_only=True)


def _person(u: User) -> dict:
    return {"id": u.id, "full_name": u.full_name, "student_number": u.student_number}


def _work_project_out(db: Session, wp: WorkProject, user: User, with_files: bool = False) -> dict:
    files = db.scalars(select(Artifact).where(Artifact.work_project_id == wp.id).order_by(Artifact.created_at.desc())).all()
    owner = db.get(User, wp.student_id)
    members = [m for m in (db.get(User, uid) for uid in _member_ids(db, wp)) if m]
    out = {
        "id": wp.id, "name": wp.name, "description": wp.description, "url": wp.url, "stages": wp.stages or 1, "created_at": wp.created_at,
        "file_count": len(files), "updated_at": files[0].created_at if files else wp.created_at,
        "is_owner": wp.student_id == user.id, "owner": _person(owner) if owner else None, "members": [_person(m) for m in members],
    }
    if with_files:
        names = {u.id: u.full_name for u in [owner, *members] if u}
        for a in files:  # files added by a member who has since left the project
            if a.student_id not in names and (u := db.get(User, a.student_id)):
                names[u.id] = u.full_name
        out["files"] = [{**_artifact_out(a), "added_by": names.get(a.student_id), "is_mine": a.student_id == user.id} for a in files]
    return out


def _add_members(db: Session, user: User, wp: WorkProject, student_ids: list[str]) -> int:
    existing = set(_member_ids(db, wp)) | {wp.student_id}
    added = 0
    for sid in dict.fromkeys(student_ids):
        if sid in existing:
            continue
        s = db.get(User, sid)
        if not s or s.role != Role.STUDENT.value or not s.is_active:
            raise HTTPException(404, "Student not found")
        db.add(WorkProjectMember(work_project_id=wp.id, user_id=sid))
        audit.notify(db, sid, f"{user.full_name} added you to a project", wp.name, "project", "/student/artifacts")
        existing.add(sid)
        added += 1
    return added


@router.get("/work-projects")
def list_work_projects(user: User = Depends(student_only), db: Session = Depends(get_db)):
    shared = select(WorkProjectMember.work_project_id).where(WorkProjectMember.user_id == user.id)
    rows = db.scalars(
        select(WorkProject).where((WorkProject.student_id == user.id) | WorkProject.id.in_(shared)).order_by(WorkProject.created_at)
    ).all()
    return [_work_project_out(db, wp, user) for wp in rows]


@router.get("/work-projects/candidates")
def project_member_candidates(q: str = "", user: User = Depends(student_only), db: Session = Depends(get_db)):
    """Students who can be added to a project (search by name or university ID)."""
    query = select(User).where(User.role == Role.STUDENT.value, User.is_active.is_(True), User.id != user.id)
    if q.strip():
        like = f"%{q.strip().lower()}%"
        query = query.where(User.full_name.ilike(like) | User.student_number.ilike(like))
    return [_person(u) for u in db.scalars(query.order_by(User.full_name).limit(20))]


@router.post("/work-projects", status_code=201)
def add_work_project(body: WorkProjectIn, user: User = Depends(student_only), db: Session = Depends(get_db)):
    if body.url and not body.url.lower().startswith(("http://", "https://")):
        raise HTTPException(422, "The project link must start with http:// or https://")
    wp = WorkProject(student_id=user.id, name=body.name.strip(), description=(body.description or "").strip() or None, url=body.url or None, stages=body.stages)
    db.add(wp)
    db.flush()
    _add_members(db, user, wp, body.member_ids)
    audit.log(db, user, "work_project.added", "work_project", wp.id, wp.name)
    db.commit()
    return _work_project_out(db, wp, user, with_files=True)


@router.get("/work-projects/{wp_id}")
def get_work_project(wp_id: str, user: User = Depends(student_only), db: Session = Depends(get_db)):
    return _work_project_out(db, _work_project_for(db, user, wp_id), user, with_files=True)


@router.post("/work-projects/{wp_id}/members")
def add_work_project_members(wp_id: str, body: MembersIn, user: User = Depends(student_only), db: Session = Depends(get_db)):
    """The owner and the members can add students to a project."""
    wp = _work_project_for(db, user, wp_id)
    added = _add_members(db, user, wp, body.student_ids)
    db.commit()
    return {**_work_project_out(db, wp, user), "added": added}


@router.delete("/work-projects/{wp_id}/members/{student_id}")
def remove_work_project_member(wp_id: str, student_id: str, user: User = Depends(student_only), db: Session = Depends(get_db)):
    """The owner removes anyone; a member can only remove themselves (leave the project)."""
    wp = _work_project_for(db, user, wp_id)
    if wp.student_id != user.id and student_id != user.id:
        raise HTTPException(403, "Only the project owner can remove members")
    db.execute(delete(WorkProjectMember).where(WorkProjectMember.work_project_id == wp.id, WorkProjectMember.user_id == student_id))
    db.commit()
    return {"ok": True}


@router.delete("/work-projects/{wp_id}")
def delete_work_project(wp_id: str, user: User = Depends(student_only), db: Session = Depends(get_db)):
    wp = _own_work_project(db, user, wp_id)
    db.execute(delete(Artifact).where(Artifact.work_project_id == wp.id))
    db.execute(delete(WorkProjectMember).where(WorkProjectMember.work_project_id == wp.id))
    db.delete(wp)
    db.commit()
    return {"ok": True}


@router.get("/artifacts")
def list_artifacts(milestone_id: str | None = None, user: User = Depends(student_only), db: Session = Depends(get_db)):
    q = select(Artifact).where(Artifact.student_id == user.id)
    if milestone_id:
        q = q.where(Artifact.milestone_id == milestone_id)
    return [_artifact_out(a) for a in db.scalars(q.order_by(Artifact.created_at.desc()))]


@router.post("/artifacts", status_code=201)
def add_artifact(body: ArtifactIn, user: User = Depends(student_only), db: Session = Depends(get_db)):
    m = get_or_404(db, Milestone, body.milestone_id, "Milestone")
    _require_enrollment(db, user, m)
    wp = _work_project_for(db, user, body.work_project_id) if body.work_project_id else default_work_project(db, user.id, m.project_id)
    stage = body.stage or 1
    if stage > (wp.stages or 1):
        raise HTTPException(422, "This project does not have that stage")
    metrics: dict = {}
    if body.kind == "git_log":
        commits = artifacts.parse_git_log(body.git_log or "")
        if not commits:
            raise HTTPException(422, "No commits could be parsed. Use: git log --pretty=format:\"%H|%an|%aI|%s\"")
        metrics = artifacts.commit_indicators(commits, m.due_date)
    elif body.kind == "submission":
        metrics = artifacts.submission_indicators(body.submitted_at or utcnow(), m.due_date)
    a = Artifact(student_id=user.id, project_id=m.project_id, milestone_id=m.id, work_project_id=wp.id, stage=stage, kind=body.kind, title=body.title, url=body.url, metrics=metrics)
    db.add(a)
    audit.log(db, user, "artifact.added", "artifact", a.id, body.kind)
    db.commit()
    return {"id": a.id, "metrics": metrics}


@router.delete("/artifacts/{artifact_id}")
def delete_artifact(artifact_id: str, user: User = Depends(student_only), db: Session = Depends(get_db)):
    a = db.get(Artifact, artifact_id)
    if not a or a.student_id != user.id:
        raise HTTPException(404, "Artifact not found")
    db.delete(a)
    db.commit()
    return {"ok": True}


# ----------------------------------------------------------- chatbot --

chat_router = APIRouter(prefix="/api/chat", tags=["chatbot"])


@chat_router.get("")
def chat_history(user: User = Depends(student_only), db: Session = Depends(get_db)):
    rows = db.scalars(select(ChatMessage).where(ChatMessage.user_id == user.id).order_by(ChatMessage.created_at))
    return [{"id": r.id, "role": r.role, "content": r.content, "created_at": r.created_at} for r in rows]


@chat_router.get("/status")
def chat_status(user: User = Depends(student_only), db: Session = Depends(get_db)):
    from ..services.settings_store import ai_config

    cfg = ai_config(db)
    return {"mode": "genai" if cfg.usable else "fallback", "configured": bool(cfg.api_key), "model": cfg.model}


@chat_router.post("")
def chat(body: ChatIn, user: User = Depends(student_only), db: Session = Depends(get_db)):
    history = [
        {"role": r.role, "content": r.content}
        for r in db.scalars(select(ChatMessage).where(ChatMessage.user_id == user.id).order_by(ChatMessage.created_at))
    ]
    reply, source = ai_engine.chat_reply(db, user, history, body.message)
    db.add(ChatMessage(user_id=user.id, role="user", content=body.message))
    msg = ChatMessage(user_id=user.id, role="assistant", content=reply)
    db.add(msg)
    db.commit()
    return {"id": msg.id, "role": "assistant", "content": reply, "source": source, "created_at": msg.created_at}


@chat_router.delete("")
def clear_chat(user: User = Depends(student_only), db: Session = Depends(get_db)):
    db.execute(delete(ChatMessage).where(ChatMessage.user_id == user.id))
    db.commit()
    return {"ok": True}

