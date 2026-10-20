"""Application configuration loaded from environment variables (or a .env file)."""
import os
import re
from functools import lru_cache
from pathlib import Path

from cryptography.fernet import Fernet
from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore", populate_by_name=True)

    app_name: str = "EduSkills AI"
    environment: str = "production" if os.environ.get("VERCEL") else "development"

    # Database: SQLite by default, any SQLAlchemy URL (e.g. PostgreSQL) in production.
    database_url: str = Field(default=f"sqlite:///{BASE_DIR / 'data' / 'eduskills.db'}",
        validation_alias=AliasChoices("DATABASE_URL", "POSTGRES_URL", "STORAGE_URL", "POSTGRES_URL_NON_POOLING", "DATABASE_URL_UNPOOLED"))
    database_schema: str = ""
    auto_migrate: bool = False

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
    seed_demo_data: bool = False

    @model_validator(mode="after")
    def validate_deployment(self):
        self.database_url = _normalise_db_url(self.database_url)
        if self.database_schema and not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", self.database_schema):
            raise ValueError("DATABASE_SCHEMA must be a valid lowercase SQL identifier")
        if self.environment == "production":
            if not self.database_url.startswith("postgresql"):
                raise ValueError("Production requires an explicit PostgreSQL DATABASE_URL")
            if self.seed_demo_data:
                raise ValueError("Demo accounts must not be seeded in production")
            for name, default in (("secret_key", "change-me-in-production-please-use-a-long-random-string"),
                                  ("anonymization_salt", "eduskills-peer-salt")):
                value = getattr(self, name)
                if len(value) < 32 or value == default or value.startswith("change-me"):
                    raise ValueError(f"Production requires an independent, strong {name.upper()}")
            try:
                Fernet(self.encryption_key.encode())
            except (ValueError, TypeError) as exc:
                raise ValueError("Production requires a valid independent ENCRYPTION_KEY") from exc
        return self


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
    if ON_VERCEL:
        s.backup_dir = Path("/tmp/eduskills-backups")
    return s
