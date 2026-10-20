"""Fail-closed production configuration and observable database failures."""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.exc import OperationalError

from app import main
from app.config import Settings


def test_readiness_is_unavailable_when_database_is_unreachable():
    with patch.object(main.engine, "connect", side_effect=OperationalError("SELECT 1", {}, Exception("offline"))):
        response = TestClient(main.app, raise_server_exceptions=False).get("/api/health")
    assert response.status_code == 503
    assert "offline" not in response.text


def test_initialization_does_not_swallow_errors():
    with patch.object(main.seed, "run", side_effect=RuntimeError("seed failed")):
        with pytest.raises(RuntimeError, match="seed failed"):
            main.init_db()


@pytest.mark.parametrize("overrides", [
    {"database_url": "sqlite:///:memory:"},
    {"secret_key": "change-me-in-production-please-use-a-long-random-string"},
    {"anonymization_salt": "eduskills-peer-salt"},
    {"seed_demo_data": True},
])
def test_production_rejects_unsafe_configuration(overrides):
    values = dict(environment="production", database_url="postgresql://user:password@localhost/app",
        secret_key="test-only-signing-key-with-more-than-32-characters",
        anonymization_salt="test-only-anonymization-salt-32-characters",
        encryption_key="gCUU9dB_uF1ojQ5XxRcfGnyoe2CKzwT1dKSrCCSpNLU=", seed_demo_data=False)
    values.update(overrides)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **values)
