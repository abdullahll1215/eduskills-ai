"""Alembic environment shared by the CLI, deployment and development startup."""
from alembic import context
from sqlalchemy import text

from app.config import get_settings
from app.database import Base, engine
from app import models  # noqa: F401

config = context.config
schema = get_settings().database_schema or None
target_metadata = Base.metadata


def configure(connection=None):
    context.configure(connection=connection, url=get_settings().database_url,
        target_metadata=target_metadata, literal_binds=connection is None,
        include_schemas=True, version_table_schema=schema,
        include_name=lambda name, kind, parent: kind != "schema" or name == schema,
        compare_type=True)


if context.is_offline_mode():
    configure()
    with context.begin_transaction():
        if schema:
            context.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
        context.run_migrations()
else:
    provided = config.attributes.get("connection")
    if provided is not None:
        configure(provided)
        with context.begin_transaction():
            context.run_migrations()
    else:
        with engine.begin() as connection:
            if schema:
                connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
            configure(connection)
            with context.begin_transaction():
                context.run_migrations()
