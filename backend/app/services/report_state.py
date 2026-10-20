"""Detect changed assessment inputs without generating AI text during reads."""
import hashlib
import json
from dataclasses import asdict

from sqlalchemy import select, text
from sqlalchemy.orm import Session, selectinload

from ..models import AIReport, Competency, Evaluation, LearningResource
from .analytics import snapshot
from .settings_store import scoring

FINGERPRINT_KEY = "_input_fingerprint"
CONFIGURATION_LOCK = 68920261021


def lock_report_configuration(db: Session, *, exclusive: bool = False) -> None:
    """Global rubric/config changes cannot interleave with report computations."""
    if db.get_bind().dialect.name == "postgresql":
        function = "pg_advisory_xact_lock" if exclusive else "pg_advisory_xact_lock_shared"
        db.execute(text(f"SELECT {function}(:key)"), {"key": CONFIGURATION_LOCK})


def lock_student_milestone(db: Session, student_id: str, milestone_id: str) -> None:
    """Serialize writes for one report's inputs, across serverless instances."""
    if db.get_bind().dialect.name == "postgresql":
        lock_report_configuration(db)
        key = int.from_bytes(hashlib.sha256(f"{student_id}:{milestone_id}".encode()).digest()[:8], signed=True)
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def input_fingerprint(db: Session, student_id: str, milestone_id: str) -> str:
    evaluations = db.scalars(select(Evaluation).options(selectinload(Evaluation.ratings)).where(
        Evaluation.target_id == student_id, Evaluation.milestone_id == milestone_id).order_by(Evaluation.id)
        .execution_options(populate_existing=True))
    payload = {
        "version": 1,
        "scoring": asdict(scoring(db)),
        "evaluations": [{
            "id": e.id, "type": e.eval_type, "reviewer": e.reviewer_key,
            "ratings": sorted((r.competency_id, r.score) for r in e.ratings),
            "comment": e.comment_enc, "notes": e.notes_enc, "moderation": e.moderation_status,
        } for e in evaluations],
        "rubric": [(c.id, c.code, c.skill_name, c.rubric) for c in
            db.scalars(select(Competency).order_by(Competency.id))],
        "resources": [(r.id, r.competency_id, r.title, r.url, r.kind, r.provider, r.duration) for r in
            db.scalars(select(LearningResource).order_by(LearningResource.id))],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def is_current(db: Session, report: AIReport) -> bool:
    stored = (report.content or {}).get(FINGERPRINT_KEY)
    return bool(stored and snapshot(db, report.student_id, report.milestone_id).complete
        and stored == input_fingerprint(db, report.student_id, report.milestone_id))
