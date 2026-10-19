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
    Role,
    SkillRating,
    User,
    utcnow,
)
from ..schemas import ArtifactIn, ChatIn, CommentCheckIn, PeerEvaluationIn, SelfAssessmentIn
from ..security import decrypt, encrypt, reviewer_hash
from ..services import ai_engine, analytics, artifacts, audit, nlp, passport
from ..services.common import competency_out, enrollment_of, get_or_404, milestone_out, teammates, validate_ratings
from ..services.settings_store import get_raw, scoring

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
        if ai_engine.generate_report(db, student_id, milestone_id, force=force):
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
    ratings = validate_ratings(db, body.ratings)
    existing = db.scalar(
        select(Evaluation).where(
            Evaluation.milestone_id == m.id, Evaluation.target_id == user.id, Evaluation.eval_type == EvalType.SELF.value
        )
    )
    if existing and existing.is_locked:
        raise HTTPException(409, "Your self-assessment for this milestone is locked (read-only)")
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
        is_locked=True,  # UC-01 step 6: immutable once submitted
    )
    ev.ratings = [SkillRating(competency_id=cid, score=s) for cid, s in ratings.items()]
    db.add(ev)
    audit.log(db, user, "evaluation.self_submitted", "evaluation", ev.id, f"milestone=M{m.number}")
    db.commit()
    run_job(bg, trigger_report, user.id, m.id)  # UC-01 step 7: check 360° completion
    return {"id": ev.id, "created_at": ev.created_at, "message": "Self-assessment submitted and locked"}


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
                "available": (t.id in self_done) or not cfg.require_self_before_peer,
            }
            for t in mates
        ],
    }


@router.post("/peer-check")
def check_comment(body: CommentCheckIn, user: User = Depends(student_only), db: Session = Depends(get_db)):
    """Live feedback for the reviewer (local filter only, fast)."""
    r = nlp.content_filter(body.comment)
    return {"is_toxic": r.is_toxic, "reason": r.reason, "is_constructive": r.is_constructive, "hints": r.hints}


@router.post("/peer-evaluations", status_code=201)
def submit_peer_evaluation(
    body: PeerEvaluationIn, bg: BackgroundTasks, user: User = Depends(student_only), db: Session = Depends(get_db)
):
    m = get_or_404(db, Milestone, body.milestone_id, "Milestone")
    enr = _require_enrollment(db, user, m)
    _require_open(m)
    if body.target_id == user.id:
        raise HTTPException(422, "You cannot evaluate yourself as a peer")  # UC-02 E2a
    cfg = scoring(db)
    mates = teammates(db, enr)
    if body.target_id not in {t.id for t in mates}:
        raise HTTPException(403, "You can only evaluate members of your own team")
    if len(mates) < cfg.min_peer_evaluations:
        raise HTTPException(409, f"Your team needs at least {cfg.min_peer_evaluations} peers for anonymous evaluation")
    if cfg.require_self_before_peer and not db.scalar(
        select(Evaluation.id).where(
            Evaluation.milestone_id == m.id, Evaluation.target_id == body.target_id, Evaluation.eval_type == EvalType.SELF.value
        )
    ):
        raise HTTPException(409, "This teammate has not completed their self-assessment yet")
    ratings = validate_ratings(db, body.ratings)
    key = reviewer_hash(user.id, m.project_id)  # UC-02 step 3: salted SHA-256
    if db.scalar(
        select(Evaluation.id).where(
            Evaluation.milestone_id == m.id, Evaluation.target_id == body.target_id, Evaluation.reviewer_key == key
        )
    ):
        raise HTTPException(409, "You have already evaluated this teammate for this milestone")

    comment = body.comment.strip()
    verdict = ai_engine.moderate(db, comment)  # UC-02 step 5: AI content filter
    ev = Evaluation(
        project_id=m.project_id,
        milestone_id=m.id,
        evaluator_id=None,  # double-blind: identity is never stored in clear
        target_id=body.target_id,
        eval_type=EvalType.PEER.value,
        reviewer_key=key,
        comment_enc=encrypt(comment),
        sentiment=nlp.sentiment(comment),
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


@router.get("/profiles/{student_id}/feedback")
def student_profile_feedback(student_id: str, milestone_id: str | None = None, user: User = Depends(student_only), db: Session = Depends(get_db)):
    """Another student's anonymous peer feedback and instructor comments, milestone by milestone."""
    _require_public_profiles(db)
    target = get_or_404(db, User, student_id, "Student")
    if target.role != Role.STUDENT.value or not target.is_active:
        raise HTTPException(404, "Student not found")
    enr = db.scalar(select(Enrollment).where(Enrollment.user_id == target.id))
    if not enr:
        return {"student": {"id": target.id, "full_name": target.full_name, "student_number": target.student_number, "team": None}, "milestones": [], "milestone": None, "feedback": None}
    project = db.get(Project, enr.project_id)
    milestones = [m for m in project.milestones if m.status != "planned"]
    cfg = scoring(db)
    m = next((x for x in milestones if x.id == milestone_id), None)
    if m is None:  # default to the latest milestone whose feedback is already released
        released = [x for x in milestones if analytics.snapshot(db, target.id, x.id, cfg).peer_count >= cfg.min_peer_evaluations]
        m = (released or milestones or [None])[-1]
    audit.log(db, user, "feedback.profile_viewed", "user", target.id)
    db.commit()
    return {
        "student": {"id": target.id, "full_name": target.full_name, "student_number": target.student_number, "team": enr.team.team_name if enr.team else None},
        "milestones": [milestone_out(x) for x in milestones],
        "milestone": milestone_out(m) if m else None,
        "feedback": _feedback_summary(db, target.id, m) if m else None,
    }


# ------------------------------------------------------------- UC-06 --


def _report_out(rep: AIReport) -> dict:
    return {
        "id": rep.id,
        "milestone": milestone_out(rep.milestone),
        "narrative": rep.narrative,
        "content": rep.content,
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
            "skills": [{"skill": s.name, "self": s.self_score, "peer_avg": s.peer_avg} for s in snap.skills],
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


@router.get("/artifacts")
def list_artifacts(milestone_id: str | None = None, user: User = Depends(student_only), db: Session = Depends(get_db)):
    q = select(Artifact).where(Artifact.student_id == user.id)
    if milestone_id:
        q = q.where(Artifact.milestone_id == milestone_id)
    return [
        {"id": a.id, "milestone_id": a.milestone_id, "kind": a.kind, "title": a.title, "url": a.url, "metrics": a.metrics, "created_at": a.created_at}
        for a in db.scalars(q.order_by(Artifact.created_at.desc()))
    ]


@router.post("/artifacts", status_code=201)
def add_artifact(body: ArtifactIn, user: User = Depends(student_only), db: Session = Depends(get_db)):
    m = get_or_404(db, Milestone, body.milestone_id, "Milestone")
    _require_enrollment(db, user, m)
    metrics: dict = {}
    if body.kind == "git_log":
        commits = artifacts.parse_git_log(body.git_log or "")
        if not commits:
            raise HTTPException(422, "No commits could be parsed. Use: git log --pretty=format:\"%H|%an|%aI|%s\"")
        metrics = artifacts.commit_indicators(commits, m.due_date)
    elif body.kind == "submission":
        metrics = artifacts.submission_indicators(body.submitted_at or utcnow(), m.due_date)
    a = Artifact(student_id=user.id, project_id=m.project_id, milestone_id=m.id, kind=body.kind, title=body.title, url=body.url, metrics=metrics)
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

