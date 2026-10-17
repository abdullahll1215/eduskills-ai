"""Unit tests for the blind-spot model, NLP pipeline and behavioral indicators."""
from datetime import datetime, timedelta

import pytest

from app.models import BlindSpotLevel
from app.security import decrypt, encrypt, reviewer_hash
from app.services import artifacts, nlp
from app.services.analytics import classify, delta, direction, external_score
from app.services.settings_store import ScoringConfig

CFG = ScoringConfig(0.6, 0.4, 1.5, 2.0, 2.0, 3, True)


def test_external_score_uses_60_40_weighting():
    assert external_score(4.0, 3.0, CFG) == pytest.approx(0.6 * 4 + 0.4 * 3)


def test_delta_is_absolute():
    assert delta(3.2, 5.0) == pytest.approx(1.8)
    assert delta(5.0, 3.2) == pytest.approx(1.8)


@pytest.mark.parametrize(
    "gap,level",
    [
        (0.0, BlindSpotLevel.ALIGNED),
        (1.5, BlindSpotLevel.ALIGNED),  # E4a: delta <= 1.5
        (1.51, BlindSpotLevel.MODERATE_GAP),  # E4b
        (2.0, BlindSpotLevel.MODERATE_GAP),
        (2.01, BlindSpotLevel.CRITICAL_GAP),  # E4c: delta > 2.0
    ],
)
def test_blind_spot_thresholds(gap, level):
    assert classify(gap, CFG) == level


def test_direction_identifies_blind_spot_and_hidden_strength():
    assert direction(3.0, 5.0, CFG) == "overestimate"
    assert direction(4.5, 2.0, CFG) == "underestimate"
    assert direction(3.5, 4.0, CFG) == "aligned"


def test_content_filter_flags_personal_attacks():
    r = nlp.content_filter("Saad is completely useless and ruined our database schema intentionally.")
    assert r.is_toxic and r.reason


def test_content_filter_accepts_constructive_feedback():
    r = nlp.content_filter("Ahmed is great at organizing meetings, but sometimes struggles to accept alternative ideas.")
    assert not r.is_toxic


def test_skill_mapping_and_sentiment():
    themes = nlp.map_skills("He takes over tasks without asking. The team meetings are well organized.")
    assert "LEADERSHIP" in themes
    assert nlp.sentiment("very helpful and clear") > 0
    assert nlp.sentiment("often late and unresponsive") < 0


def test_encryption_roundtrip_and_reviewer_hash():
    assert decrypt(encrypt("secret comment")) == "secret comment"
    h1, h2 = reviewer_hash("u1", "p1"), reviewer_hash("u1", "p2")
    assert len(h1) == 64 and h1 != h2 and "u1" not in h1


def test_commit_indicators():
    due = datetime(2026, 5, 1, 12)
    log = "\n".join(f"abc{i}|Dev|{(due - timedelta(days=10 - i)).isoformat()}|msg" for i in range(10))
    m = artifacts.commit_indicators(artifacts.parse_git_log(log), due)
    assert m["commit_count"] == 10
    assert 0 < m["consistency"] <= 1
    assert "last_minute_ratio" in m
