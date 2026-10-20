"""Course join codes and team invite codes

Revision ID: eduskills_0004
Revises: eduskills_0003
Create Date: 2026-10-20 20:00:00

"""
import secrets
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'eduskills_0004'
down_revision: Union[str, Sequence[str], None] = 'eduskills_0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _backfill(table: sa.Table, column: str) -> None:
    """Existing rows get a unique code so instructors can share it straight away."""
    bind = op.get_bind()
    used: set[str] = set()
    for (row_id,) in bind.execute(sa.select(table.c.id).where(table.c[column].is_(None))).all():
        code = "".join(secrets.choice(ALPHABET) for _ in range(8))
        while code in used:
            code = "".join(secrets.choice(ALPHABET) for _ in range(8))
        used.add(code)
        bind.execute(table.update().where(table.c.id == row_id).values({column: code}))


def upgrade() -> None:
    schema = op.get_context().opts.get('version_table_schema')
    with op.batch_alter_table('projects', schema=schema) as batch:
        batch.add_column(sa.Column('join_code', sa.String(length=12), nullable=True))
        batch.create_unique_constraint('uq_projects_join_code', ['join_code'])
    with op.batch_alter_table('teams', schema=schema) as batch:
        batch.add_column(sa.Column('invite_code', sa.String(length=12), nullable=True))
        batch.create_unique_constraint('uq_teams_invite_code', ['invite_code'])
    meta = sa.MetaData(schema=schema)
    _backfill(sa.Table('projects', meta, sa.Column('id', sa.String(36)), sa.Column('join_code', sa.String(12))), 'join_code')
    _backfill(sa.Table('teams', meta, sa.Column('id', sa.String(36)), sa.Column('invite_code', sa.String(12))), 'invite_code')


def downgrade() -> None:
    schema = op.get_context().opts.get('version_table_schema')
    with op.batch_alter_table('teams', schema=schema) as batch:
        batch.drop_constraint('uq_teams_invite_code', type_='unique')
        batch.drop_column('invite_code')
    with op.batch_alter_table('projects', schema=schema) as batch:
        batch.drop_constraint('uq_projects_join_code', type_='unique')
        batch.drop_column('join_code')
