"""GenAI path with Google AI Studio (Gemini) through its OpenAI-compatible endpoint, with the HTTP call mocked."""


from sqlalchemy import select

from app.database import SessionLocal
from app.models import AIReport
from app.services import ai_engine, settings_store


class FakeResponse:
    def __init__(self, content: str):
        self._content = content

    def raise_for_status(self):
        return None

    def json(self):
        return {"choices": [{"message": {"content": self._content}}]}


def test_gemini_report_generation(client, monkeypatch):
    calls = []
    report = {
        "headline": "Grow your delegation skills",
        "narrative": ["Paragraph one.", "Paragraph two."],
        "strengths": ["Communication"],
        "focus_skill": "Leadership",
        "actionable_steps": ["Delegate two tasks.", "Ask for feedback."],
        "johari_insight": "Blind spot in Leadership.",
    }

    def fake_post(url, headers, json: dict, timeout):  # noqa: A002 - mirrors httpx.post signature
        calls.append((url, headers, json))
        return FakeResponse("```json\n" + __import__("json").dumps(report) + "\n```")

    monkeypatch.setattr(ai_engine.httpx, "post", fake_post)
    db = SessionLocal()
    try:
        settings_store.set_value(db, "ai_api_key", "AIza-test-key")
        settings_store.set_value(db, "ai_base_url", "https://generativelanguage.googleapis.com/v1beta/openai")
        settings_store.set_value(db, "ai_model", "gemini-2.5-flash")
        db.commit()
        existing = db.scalar(select(AIReport).limit(1))
        rep = ai_engine.generate_report(db, existing.student_id, existing.milestone_id, force=True)
        db.commit()
        assert rep.source == "ai" and rep.model == "gemini-2.5-flash"
        assert rep.content["headline"] == "Grow your delegation skills"
        url, headers, body = calls[0]
        assert url == "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        assert headers["Authorization"] == "Bearer AIza-test-key"
        assert body["model"] == "gemini-2.5-flash"
    finally:
        settings_store.set_value(db, "ai_api_key", "")
        db.commit()
        db.close()

