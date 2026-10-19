"""GenAI path with Google AI Studio (Gemini API), with the HTTP calls mocked."""
import json

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.models import AIReport
from app.services import ai_engine, settings_store

REPORT = {
    "headline": "Grow your delegation skills",
    "narrative": ["Paragraph one.", "Paragraph two."],
    "strengths": ["Communication"],
    "focus_skill": "Leadership",
    "actionable_steps": ["Delegate two tasks.", "Ask for feedback."],
    "johari_insight": "Blind spot in Leadership.",
}


class FakeResponse:
    def __init__(self, status_code: int, data: dict):
        self.status_code = status_code
        self._data = data
        self.text = json.dumps(data)

    def json(self):
        return self._data


def gemini_answer(text: str) -> FakeResponse:
    return FakeResponse(200, {"candidates": [{"content": {"parts": [{"text": text}]}}]})


@pytest.fixture
def gemini_settings():
    db = SessionLocal()
    settings_store.set_value(db, "ai_api_key", "AQ.test-key")
    settings_store.set_value(db, "ai_base_url", "https://generativelanguage.googleapis.com/v1beta/openai")
    settings_store.set_value(db, "ai_model", "gemini-2.5-flash")
    db.commit()
    ai_engine._resolved_models.clear()
    yield db
    settings_store.set_value(db, "ai_api_key", "")
    db.commit()
    db.close()
    ai_engine._resolved_models.clear()


def test_gemini_report_generation(client, gemini_settings, monkeypatch):
    calls = []

    def fake_post(url, headers, json, timeout):  # noqa: A002 - mirrors httpx.post
        calls.append((url, headers, json))
        return gemini_answer("```json\n" + __import__("json").dumps(REPORT) + "\n```")

    monkeypatch.setattr(ai_engine.httpx, "post", fake_post)
    db = gemini_settings
    existing = db.scalar(select(AIReport).limit(1))
    rep = ai_engine.generate_report(db, existing.student_id, existing.milestone_id, force=True)
    db.commit()
    assert rep.source == "ai" and rep.model == "gemini-2.5-flash"
    assert rep.content["headline"] == "Grow your delegation skills"
    url, headers, body = calls[0]
    assert url == "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    assert headers["x-goog-api-key"] == "AQ.test-key"
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    assert "systemInstruction" in body


def test_gemini_unknown_model_is_replaced_automatically(client, gemini_settings, monkeypatch):
    """A 404 for the configured model triggers a lookup of the models available to the key."""
    posted = []

    def fake_post(url, headers, json, timeout):  # noqa: A002
        posted.append(url)
        if "gemini-2.5-flash:" in url:
            return FakeResponse(404, {"error": {"message": "models/gemini-2.5-flash is not found"}})
        return gemini_answer("OK")

    def fake_get(url, params, headers, timeout):
        return FakeResponse(200, {"models": [
            {"name": "models/gemini-3.0-flash-lite", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/gemini-3.0-flash", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/gemini-3.0-pro", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/text-embedding-005", "supportedGenerationMethods": ["embedContent"]},
        ]})

    monkeypatch.setattr(ai_engine.httpx, "post", fake_post)
    monkeypatch.setattr(ai_engine.httpx, "get", fake_get)
    ok, message = ai_engine.check_connection(settings_store.ai_config(gemini_settings))
    assert ok, message
    assert "gemini-3.0-flash" in message and "lite" not in message
    assert posted[-1].endswith("/models/gemini-3.0-flash:generateContent")


def test_gemini_error_message_is_shown(client, gemini_settings, monkeypatch):
    monkeypatch.setattr(ai_engine.httpx, "post", lambda url, headers, json, timeout: FakeResponse(400, {"error": {"message": "API key not valid."}}))
    ok, message = ai_engine.check_connection(settings_store.ai_config(gemini_settings))
    assert not ok and "API key not valid." in message
