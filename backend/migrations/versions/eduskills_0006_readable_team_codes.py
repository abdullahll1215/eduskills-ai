"""Readable team codes (course number + team name) need a longer column

Revision ID: eduskills_0006
Revises: eduskills_0005
Create Date: 2026-10-21 10:00:00

"""
from alembic import op
import sqlalchemy as sa

revision = "eduskills_0006"
down_revision = "eduskills_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    schema = op.get_context().opts.get("version_table_schema")
    with op.batch_alter_table("teams", schema=schema) as batch:
        batch.alter_column("invite_code", existing_type=sa.String(length=12), type_=sa.String(length=60), existing_nullable=True)


def downgrade() -> None:
    schema = op.get_context().opts.get("version_table_schema")
    with op.batch_alter_table("teams", schema=schema) as batch:
        batch.alter_column("invite_code", existing_type=sa.String(length=60), type_=sa.String(length=12), existing_nullable=True)
