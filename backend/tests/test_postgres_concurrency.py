"""Real PostgreSQL serialization tests; never run against production."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic
from unittest.mock import patch

import pytest
from sqlalchemy import select, text

from app.database import SessionLocal, engine
from app.models import AIReport, Milestone
from app.services import ai_engine
from conftest import login

pytestmark = pytest.mark.skipif(engine.dialect.name != "postgresql", reason="requires PostgreSQL")


def test_report_generation_serializes_with_global_scoring_changes(client):
    from app.services.settings_store import scoring

    headers = login(client, "admin@kfu.edu.sa")
    with SessionLocal() as db:
        rep = db.scalar(select(AIReport).join(Milestone).where(Milestone.status == "active"))
        target, mid = rep.student_id, rep.milestone_id
    captured, release, writer_started = Event(), Event(), Event()

    def pause_after_read(db):
        cfg = scoring(db)
        captured.set()
        assert release.wait(10)
        return cfg

    def generate():
        with SessionLocal() as db:
            ai_engine.generate_report(db, target, mid, force=True)
            db.commit()

    def update():
        writer_started.set()
        return client.put("/api/admin/settings", headers=headers,
            json={"values": {"instructor_weight": "0.7", "peer_weight": "0.3"}})

    try:
        with ThreadPoolExecutor(2) as pool, patch.object(ai_engine, "scoring", side_effect=pause_after_read):
            report = pool.submit(generate)
            assert captured.wait(10)
            writer = pool.submit(update)
            assert writer_started.wait(5)
            try:
                deadline = monotonic() + 5
                waiting = False
                while not writer.done() and monotonic() < deadline:
                    with engine.connect() as conn:
                        waiting = bool(conn.scalar(text("SELECT count(*) FROM pg_stat_activity "
                            "WHERE wait_event='advisory' AND query LIKE '%pg_advisory_xact_lock(%'")))
                    if waiting:
                        break
                    Event().wait(0.01)
                assert waiting
                assert not writer.done()
            finally:
                release.set()
            report.result(timeout=15)
            assert writer.result(timeout=15).status_code == 200
    finally:
        release.set()
        client.put("/api/admin/settings", headers=headers,
            json={"values": {"instructor_weight": "0.6", "peer_weight": "0.4"}})
