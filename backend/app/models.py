"""Relational schema. Follows the ERD / data dictionary of the proposal (section 11),
extended with the supporting tables required by the functional requirements
(milestones, artifacts, learning resources, notifications, interventions, audit, chat)."""
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Role(str, enum.Enum):
    STUDENT = "student"
    INSTRUCTOR = "instructor"
    ADVISOR = "advisor"
    ADMIN = "admin"


class EvalType(str, enum.Enum):
    SELF = "self"
    PEER = "peer"
    INSTRUCTOR = "instructor"


class BlindSpotLevel(str, enum.Enum):
    ALIGNED = "ALIGNED"
    MODERATE_GAP = "MODERATE_GAP"
    CRITICAL_GAP = "CRITICAL_GAP"


class Moderation(str, enum.Enum):
    NONE = "none"          # clean, visible
    PENDING = "pending"    # flagged by the AI content filter, waiting for instructor review
    APPROVED = "approved"  # false flag, instructor kept it visible
    REMOVED = "removed"    # instructor confirmed it as inappropriate, comment hidden


# ---------------------------------------------------------------- core (ERD) --


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    full_name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(20), index=True)
    password_hash: Mapped[str] = mapped_column(String(100))
    student_number: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    level: Mapped[str | None] = mapped_column(String(30), nullable=True)
    mobile: Mapped[str | None] = mapped_column(String(30), nullable=True)
    department: Mapped[str | None] = mapped_column(String(120), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    instructor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    instructor: Mapped[User | None] = relationship()
    milestones: Mapped[list["Milestone"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="Milestone.number"
    )
    teams: Mapped[list["Team"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class Milestone(Base):
    __tablename__ = "milestones"
    __table_args__ = (UniqueConstraint("project_id", "number"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    due_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # planned -> active (evaluation period open) -> closed
    status: Mapped[str] = mapped_column(String(20), default="planned")

    project: Mapped[Project] = relationship(back_populates="milestones")

    @property
    def is_open(self) -> bool:
        return self.status == "active"


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    team_name: Mapped[str] = mapped_column(String(120))

    project: Mapped[Project] = relationship(back_populates="teams")
    enrollments: Mapped[list["Enrollment"]] = relationship(back_populates="team")


class Enrollment(Base):
    __tablename__ = "enrollments"
    __table_args__ = (UniqueConstraint("user_id", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    team_id: Mapped[str | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)

    user: Mapped[User] = relationship()
    team: Mapped[Team | None] = relationship(back_populates="enrollments")


class Competency(Base):
    __tablename__ = "competencies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    code: Mapped[str] = mapped_column(String(40), unique=True)  # SkillDimension enum value
    skill_name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text, default="")
    # Rubric descriptors for the 1-5 Likert scale: {"1": "...", ..., "5": "..."}
    rubric: Mapped[dict] = mapped_column(JSON, default=dict)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Evaluation(Base):
    __tablename__ = "evaluations"
    __table_args__ = (UniqueConstraint("milestone_id", "target_id", "eval_type", "reviewer_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    milestone_id: Mapped[str] = mapped_column(ForeignKey("milestones.id", ondelete="CASCADE"), index=True)
    # NULL for peer evaluations: the reviewer is only known through a salted SHA-256 hash.
    evaluator_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    target_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    eval_type: Mapped[str] = mapped_column(String(20), index=True)
    # Self/instructor: "self"/"instructor"; Peer: hashed reviewer id. Guarantees one evaluation per source.
    reviewer_key: Mapped[str] = mapped_column(String(64))
    comment_enc: Mapped[str | None] = mapped_column(Text, nullable=True)  # Fernet-encrypted text
    evidence_link: Mapped[str | None] = mapped_column(String(500), nullable=True)
    notes_enc: Mapped[str | None] = mapped_column(Text, nullable=True)  # instructor supervisory notes
    sentiment: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    flag_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    moderation_status: Mapped[str] = mapped_column(String(20), default=Moderation.NONE.value)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    ratings: Mapped[list["SkillRating"]] = relationship(back_populates="evaluation", cascade="all, delete-orphan")
    milestone: Mapped[Milestone] = relationship()
    target: Mapped[User] = relationship(foreign_keys=[target_id])


class SkillRating(Base):
    __tablename__ = "skill_ratings"
    __table_args__ = (UniqueConstraint("evaluation_id", "competency_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    evaluation_id: Mapped[str] = mapped_column(ForeignKey("evaluations.id", ondelete="CASCADE"), index=True)
    competency_id: Mapped[str] = mapped_column(ForeignKey("competencies.id", ondelete="CASCADE"))
    score: Mapped[int] = mapped_column(Integer)

    evaluation: Mapped[Evaluation] = relationship(back_populates="ratings")
    competency: Mapped[Competency] = relationship()


class AIReport(Base):
    __tablename__ = "ai_reports"
    __table_args__ = (UniqueConstraint("student_id", "milestone_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    student_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    milestone_id: Mapped[str] = mapped_column(ForeignKey("milestones.id", ondelete="CASCADE"), index=True)
    narrative: Mapped[str] = mapped_column(Text, default="")
    # Structured JSON report: headline, strengths, actionable_steps, focus skill, resources, themes.
    content: Mapped[dict] = mapped_column(JSON, default=dict)
    source: Mapped[str] = mapped_column(String(20), default="fallback")  # "ai" | "fallback"
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    overall_self: Mapped[float] = mapped_column(Float, default=0)
    overall_external: Mapped[float] = mapped_column(Float, default=0)
    overall_gap: Mapped[float] = mapped_column(Float, default=0)
    overall_level: Mapped[str] = mapped_column(String(20), default=BlindSpotLevel.ALIGNED.value)
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    metrics: Mapped[list["DeltaMetric"]] = relationship(back_populates="report", cascade="all, delete-orphan")
    milestone: Mapped[Milestone] = relationship()
    student: Mapped[User] = relationship()


class DeltaMetric(Base):
    __tablename__ = "delta_metrics"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    report_id: Mapped[str] = mapped_column(ForeignKey("ai_reports.id", ondelete="CASCADE"), index=True)
    competency_id: Mapped[str] = mapped_column(ForeignKey("competencies.id", ondelete="CASCADE"))
    self_score: Mapped[float] = mapped_column(Float)
    peer_avg: Mapped[float] = mapped_column(Float)
    instructor_score: Mapped[float] = mapped_column(Float)
    external_avg: Mapped[float] = mapped_column(Float)
    gap_score: Mapped[float] = mapped_column(Float)  # |external - self|
    direction: Mapped[str] = mapped_column(String(20))  # overestimate | underestimate | aligned
    level: Mapped[str] = mapped_column(String(20))

    report: Mapped[AIReport] = relationship(back_populates="metrics")
    competency: Mapped[Competency] = relationship()


# ------------------------------------------------------------ supporting --


class LearningResource(Base):
    __tablename__ = "learning_resources"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    competency_id: Mapped[str] = mapped_column(ForeignKey("competencies.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    provider: Mapped[str] = mapped_column(String(80), default="")
    url: Mapped[str] = mapped_column(String(500))
    kind: Mapped[str] = mapped_column(String(20), default="article")  # article | video | course | exercise
    duration: Mapped[str] = mapped_column(String(40), default="")

    competency: Mapped[Competency] = relationship()


class WorkProject(Base):
    """A project the student works on; groups the student's artifacts (\"My Projects\")."""

    __tablename__ = "work_projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    student_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    stages: Mapped[int] = mapped_column(Integer, default=1)  # how many stages the student plans the project in
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Artifact(Base):
    """Optional project evidence metadata (commit logs, submissions) used for behavioral indicators."""

    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    student_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    milestone_id: Mapped[str] = mapped_column(ForeignKey("milestones.id", ondelete="CASCADE"), index=True)
    work_project_id: Mapped[str | None] = mapped_column(ForeignKey("work_projects.id", ondelete="CASCADE"), nullable=True, index=True)
    stage: Mapped[int | None] = mapped_column(Integer, nullable=True)  # stage of the work project (1..stages)
    kind: Mapped[str] = mapped_column(String(30))  # git_log | submission | link
    title: Mapped[str] = mapped_column(String(200))
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30), default="info")
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Intervention(Base):
    """High-priority alert raised for the Student Advisor (context diagram / UC-07)."""

    __tablename__ = "interventions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    student_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    milestone_id: Mapped[str | None] = mapped_column(ForeignKey("milestones.id", ondelete="SET NULL"), nullable=True)
    raised_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    priority: Mapped[str] = mapped_column(String(10), default="high")
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | acknowledged | resolved
    advisor_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    student: Mapped[User] = relationship(foreign_keys=[student_id])
    raised_by: Mapped[User | None] = relationship(foreign_keys=[raised_by_id])
    project: Mapped[Project] = relationship()
    milestone: Mapped[Milestone | None] = relationship()


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(String(60), index=True)
    entity: Mapped[str] = mapped_column(String(60), default="")
    entity_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    details: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)

    actor: Mapped[User | None] = relationship()


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(10))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class BackupRecord(Base):
    __tablename__ = "backups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    filename: Mapped[str] = mapped_column(String(200))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    checksum: Mapped[str] = mapped_column(String(64), default="")
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    details: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
