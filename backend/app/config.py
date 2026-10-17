"""Application configuration loaded from environment variables (or a .env file)."""
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

    # Generative AI (any OpenAI-compatible Chat Completions endpoint).
    # These are defaults; the admin can override them at runtime from the System Configuration page (UC-08).
    ai_api_key: str = ""
    ai_base_url: str = "https://api.openai.com/v1"
    ai_model: str = "gpt-4o-mini"
    ai_timeout_seconds: float = 20.0

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    backup_dir: Path = BASE_DIR / "data" / "backups"
    seed_demo_data: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
