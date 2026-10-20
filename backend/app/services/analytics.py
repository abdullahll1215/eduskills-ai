"""Analytics Engine: weighted 360° scoring and blind-spot detection (UC-03 / UC-04).

    ExternalScore = w_i * InstructorScore + w_p * PeerAverage        (default 0.6 / 0.4)
    delta         = | ExternalScore - SelfScore |
    delta <= 1.5  -> ALIGNED           ("Good Alignment")
    1.5 < delta <= 2.0 -> MODERATE_GAP
    delta > 2.0   -> CRITICAL_GAP      ("Critical Blind Spot")
"""
from dataclasses import dataclass, field
from statistics import mean

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..models import BlindSpotLevel, Competency, Evaluation, EvalType
from .settings_store import ScoringConfig, scoring


def external_score(instructor: float, peer_avg: float, cfg: ScoringConfig) -> float:
    total = cfg.instructor_weight + cfg.peer_weight
    return (cfg.instructor_weight * instructor + cfg.peer_weight * peer_avg) / total


def delta(external: float, self_score: float) -> float:
    return abs(external - self_score)


def classify(gap: float, cfg: ScoringConfig) -> BlindSpotLevel:
    if gap <= cfg.moderate_threshold:
        return BlindSpotLevel.ALIGNED
    if gap <= cfg.critical_threshold:
        return BlindSpotLevel.MODERATE_GAP
    return BlindSpotLevel.CRITICAL_GAP


def direction(external: float, self_score: float, cfg: ScoringConfig) -> str:
    if abs(external - self_score) <= cfg.moderate_threshold:
        return "aligned"
    # Johari window: self > others -> blind spot (overestimate); self < others -> hidden strength
    return "overestimate" if self_score > external else "underestimate"


@dataclass
class SkillMetric:
    competency_id: str
    code: str
    name: str
    self_score: float | None
    peer_avg: float | None
    instructor_score: float | None
    external: float | None = None
    gap: float | None = None
    level: str | None = None
    direction: str | None = None


@dataclass
class StudentSnapshot:
    student_id: str
    milestone_id: str
    has_self: bool
    peer_count: int
    has_instructor: bool
    min_peers: int
    instructor_weight: float = 0.6
    peer_weight: float = 0.4
    skills: list[SkillMetric] = field(default_factory=list)
    peer_comments: list[str] = field(default_factory=list)
    instructor_notes: str = ""
    self_evidence: str = ""

    @property
    def peer_complete(self) -> bool:
        return self.peer_count >= self.min_peers

    @property
    def complete(self) -> bool:
        return self.has_self and self.peer_complete and self.has_instructor

    def _avg(self, attr: str) -> float | None:
        vals = [getattr(s, attr) for s in self.skills if getattr(s, attr) is not None]
        return round(mean(vals), 2) if vals else None

    @property
    def overall_self(self):
        return self._avg("self_score")

    @property
    def overall_peer(self):
        return self._avg("peer_avg")

    @property
    def overall_instructor(self):
        return self._avg("instructor_score")

    @property
    def overall_external(self):
        return self._avg("external")

    @property
    def max_gap_skill(self) -> SkillMetric | None:
        scored = [s for s in self.skills if s.gap is not None]
        return max(scored, key=lambda s: s.gap) if scored else None


def competencies(db: Session) -> list[Competency]:
    return list(db.scalars(select(Competency).order_by(Competency.sort_order)))


def snapshot(db: Session, student_id: str, milestone_id: str, cfg: ScoringConfig | None = None) -> StudentSnapshot:
    """Batch-fetch Self, Peer and Instructor evaluations and compute per-skill metrics."""
    from ..security import decrypt

    cfg = cfg or scoring(db)
    evals = list(
        db.scalars(
            select(Evaluation)
            .options(selectinload(Evaluation.ratings))
            .where(Evaluation.target_id == student_id, Evaluation.milestone_id == milestone_id)
        )
    )
    self_ev = next((e for e in evals if e.eval_type == EvalType.SELF.value), None)
    inst_ev = next((e for e in evals if e.eval_type == EvalType.INSTRUCTOR.value), None)
    peers = [e for e in evals if e.eval_type == EvalType.PEER.value]

    snap = StudentSnapshot(
        student_id=student_id,
        milestone_id=milestone_id,
        has_self=self_ev is not None,
        peer_count=len(peers),
        has_instructor=inst_ev is not None,
        min_peers=cfg.min_peer_evaluations,
        instructor_weight=cfg.instructor_weight,
        peer_weight=cfg.peer_weight,
        instructor_notes=decrypt(inst_ev.notes_enc) if inst_ev else "",
        self_evidence=(decrypt(self_ev.comment_enc) if self_ev else ""),
    )
    # Only comments that passed moderation feed the AI narrative.
    snap.peer_comments = [
        decrypt(p.comment_enc) for p in peers if p.comment_enc and p.moderation_status in ("none", "approved")
    ]

    def scores_of(ev: Evaluation | None) -> dict[str, int]:
        return {r.competency_id: r.score for r in ev.ratings} if ev else {}

    self_scores, inst_scores = scores_of(self_ev), scores_of(inst_ev)
    peer_scores = [scores_of(p) for p in peers]

    for comp in competencies(db):
        p_vals = [ps[comp.id] for ps in peer_scores if comp.id in ps]
        m = SkillMetric(
            competency_id=comp.id,
            code=comp.code,
            name=comp.skill_name,
            self_score=self_scores.get(comp.id),
            peer_avg=round(mean(p_vals), 2) if p_vals else None,
            instructor_score=inst_scores.get(comp.id),
        )
        if m.instructor_score is not None and m.peer_avg is not None:
            m.external = round(external_score(m.instructor_score, m.peer_avg, cfg), 2)
        elif m.peer_avg is not None:
            m.external = m.peer_avg  # provisional, before the instructor evaluation
        if m.external is not None and m.self_score is not None:
            m.gap = round(delta(m.external, m.self_score), 2)
            m.level = classify(m.gap, cfg).value
            m.direction = direction(m.external, m.self_score, cfg)
        snap.skills.append(m)
    return snap


def overall_level(snap: StudentSnapshot, cfg: ScoringConfig) -> BlindSpotLevel:
    """The student's status is driven by the worst skill-level gap."""
    worst = snap.max_gap_skill
    return classify(worst.gap, cfg) if worst else BlindSpotLevel.ALIGNED
