"""Explicit, versioned database lifecycle; runtime never silently patches a schema."""
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import text

from .config import get_settings


def migration_config(connection=None) -> Config:
    root = Path(__file__).resolve().parent.parent
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "migrations"))
    if connection is not None:
        config.attributes["connection"] = connection
    return config


def upgrade_database(engine) -> None:
    schema = get_settings().database_schema or None
    with engine.begin() as connection:
        if connection.dialect.name == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(68920261020)"))
            if schema:
                connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
        command.upgrade(migration_config(connection), "head")


def verify_database_revision(engine) -> None:
    expected = set(ScriptDirectory.from_config(migration_config()).get_heads())
    with engine.connect() as connection:
        actual = set(MigrationContext.configure(connection, opts={
            "version_table_schema": get_settings().database_schema or None}).get_current_heads())
    if actual != expected:
        raise RuntimeError("Database migrations are not current; run alembic upgrade head before starting the API")
