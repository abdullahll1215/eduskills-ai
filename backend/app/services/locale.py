"""The interface language of the current request (sent by the frontend in the X-Lang header)."""
from contextvars import ContextVar

current_lang: ContextVar[str] = ContextVar("current_lang", default="en")


def lang_from_header(value: str | None) -> str:
    return "ar" if (value or "").strip().lower().startswith("ar") else "en"
