import os
import tempfile
from pathlib import Path

import pytest

_tmp = Path(tempfile.mkdtemp(prefix="eduskills-test-"))
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", f"sqlite:///{_tmp / 'test.db'}")
os.environ["BACKUP_DIR"] = str(_tmp / "backups")
os.environ["AI_API_KEY"] = ""  # always exercise the deterministic fallback engine in tests
os.environ["SEED_DEMO_DATA"] = "true"
os.environ["ENVIRONMENT"] = "test"
os.environ["AUTO_MIGRATE"] = "true"
os.environ["DATABASE_SCHEMA"] = os.environ.get("TEST_DATABASE_SCHEMA", "")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

PASSWORD = "Password123!"


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def login(client, email: str) -> dict:
    r = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def khalid(client):
    return login(client, "khalid@student.kfu.edu.sa")


@pytest.fixture(scope="session")
def instructor(client):
    return login(client, "ahmed@kfu.edu.sa")


@pytest.fixture(scope="session")
def admin(client):
    return login(client, "admin@kfu.edu.sa")


@pytest.fixture(scope="session")
def advisor(client):
    return login(client, "advisor@kfu.edu.sa")
