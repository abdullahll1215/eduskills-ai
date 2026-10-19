"""Application configuration loaded from environment variables (or a .env file)."""
import hashlib
import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    app_name: str = "EduSkills AI"
    environment: str = "development"

    # Database: SQLite by default, any SQLAlchemy URL (e.g. PostgreSQL) in production.
    database_url: str = f"sqlite:///{BASE_DIR / 'data' / 'eduskills.db'}"

    # Security
    secret_key: str = "change-me-in-production-please-use-a-long-random-string"
    access_token_minutes: int = 60 * 8
    # Fernet key for encrypting qualitative feedback at rest. Derived from secret_key when empty.
    encryption_key: str = ""
    # Salt used when hashing peer reviewer identities (Salted SHA-256, UC-02).
    anonymization_salt: str = "eduskills-peer-salt"

    # Generative AI: Google AI Studio (Gemini, via its OpenAI-compatible endpoint) by default,
    # or any other OpenAI-compatible Chat Completions endpoint.
    # These are defaults; the admin can override them at runtime from the System Configuration page (UC-08).
    ai_api_key: str = ""
    ai_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    ai_model: str = "gemini-2.5-flash"
    ai_timeout_seconds: float = 20.0

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    backup_dir: Path = BASE_DIR / "data" / "backups"
    seed_demo_data: bool = True


ON_VERCEL = bool(os.environ.get("VERCEL"))


def _normalise_db_url(url: str) -> str:
    """Accepts the URLs Vercel/Neon provide (postgres://...) and maps them to the SQLAlchemy driver."""
    if url.startswith("postgres://"):
        return "postgresql+psycopg2://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg2://" + url[len("postgresql://"):]
    return url


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    # Vercel's Postgres (Neon) integration exposes the connection string under these names.
    for name in ("DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"):
        if os.environ.get(name):
            s.database_url = os.environ[name]
            break
    else:
        if ON_VERCEL:
            # Read-only file system: fall back to a temporary SQLite file (data resets on cold starts).
            s.database_url = "sqlite:////tmp/eduskills.db"
    s.database_url = _normalise_db_url(s.database_url)
    defaults = Settings.model_fields
    if ON_VERCEL and not s.database_url.startswith("sqlite"):
        # The repository is public, so the built-in secrets must never be used in production.
        # Unless SECRET_KEY / ANONYMIZATION_SALT are set, derive stable private values from the
        # database credentials, which only the Vercel project knows.
        seed_value = hashlib.sha256(("eduskills:" + s.database_url).encode()).hexdigest()
        if s.secret_key == defaults["secret_key"].default:
            s.secret_key = seed_value
        if s.anonymization_salt == defaults["anonymization_salt"].default:
            s.anonymization_salt = hashlib.sha256((seed_value + ":salt").encode()).hexdigest()
    if ON_VERCEL:
        s.backup_dir = Path("/tmp/eduskills-backups")
    return s
