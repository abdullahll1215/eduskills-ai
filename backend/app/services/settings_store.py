"""Runtime system configuration (UC-08). Values live in the system_settings table and fall back to defaults."""
from dataclasses import dataclass

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import SystemSetting
from ..security import decrypt, encrypt

DEFAULTS: dict[str, str] = {
    # Weighted scoring model (section 3.1): External = 0.6 x Instructor + 0.4 x PeerAverage
    "instructor_weight": "0.6",
    "peer_weight": "0.4",
    # Blind-spot categorisation thresholds (UC-04): <=1.5 aligned, (1.5, 2.0] moderate, >2.0 critical
    "moderate_threshold": "1.5",
    "critical_threshold": "2.0",
    # UC-03 E5a: warn when instructor and peer perceptions differ by more than this
    "instructor_peer_warning": "2.0",
    # UC-02: minimum peer evaluations required for validity
    "min_peer_evaluations": "3",
    # UC-02 precondition: reviewee must have completed self-assessment before being peer reviewed
    "require_self_before_peer": "true",
    "ai_enabled": "true",
    "ai_base_url": "",
    "ai_model": "",
    "ai_api_key": "",  # stored encrypted
    "retention_days": "730",
    # Students may search the platform and read other students' (anonymous) peer and instructor feedback
    "public_feedback_profiles": "true",
}

SECRET_KEYS = {"ai_api_key"}


def get_raw(db: Session, key: str) -> str:
    row = db.get(SystemSetting, key)
    if row is None:
        return DEFAULTS.get(key, "")
    return decrypt(row.value) if key in SECRET_KEYS else row.value


def set_value(db: Session, key: str, value: str) -> None:
    if key not in DEFAULTS:
        raise KeyError(key)
    stored = (encrypt(value) or "") if key in SECRET_KEYS else value
    row = db.get(SystemSetting, key)
    if row is None:
        db.add(SystemSetting(key=key, value=stored))
    else:
        row.value = stored


@dataclass
class ScoringConfig:
    instructor_weight: float
    peer_weight: float
    moderate_threshold: float
    critical_threshold: float
    instructor_peer_warning: float
    min_peer_evaluations: int
    require_self_before_peer: bool


def scoring(db: Session) -> ScoringConfig:
    return ScoringConfig(
        instructor_weight=float(get_raw(db, "instructor_weight")),
        peer_weight=float(get_raw(db, "peer_weight")),
        moderate_threshold=float(get_raw(db, "moderate_threshold")),
        critical_threshold=float(get_raw(db, "critical_threshold")),
        instructor_peer_warning=float(get_raw(db, "instructor_peer_warning")),
        min_peer_evaluations=int(get_raw(db, "min_peer_evaluations")),
        require_self_before_peer=get_raw(db, "require_self_before_peer") == "true",
    )


@dataclass
class AIConfig:
    enabled: bool
    base_url: str
    model: str
    api_key: str
    timeout: float

    @property
    def usable(self) -> bool:
        return self.enabled and bool(self.api_key)


def ai_config(db: Session) -> AIConfig:
    env = get_settings()
    return AIConfig(
        enabled=get_raw(db, "ai_enabled") == "true",
        base_url=(get_raw(db, "ai_base_url") or env.ai_base_url).rstrip("/"),
        model=get_raw(db, "ai_model") or env.ai_model,
        api_key=get_raw(db, "ai_api_key") or env.ai_api_key,
        timeout=env.ai_timeout_seconds,
    )


def public_settings(db: Session) -> dict:
    out = {k: get_raw(db, k) for k in DEFAULTS}
    key = ai_config(db).api_key
    out["ai_api_key"] = ("•" * 8 + key[-4:]) if key else ""
    out["ai_base_url"] = ai_config(db).base_url
    out["ai_model"] = ai_config(db).model
    return out
