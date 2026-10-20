"""Work project members (students added to a project's team)

Revision ID: eduskills_0003
Revises: eduskills_0002
Create Date: 2026-10-20 19:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'eduskills_0003'
down_revision: Union[str, Sequence[str], None] = 'eduskills_0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    schema = op.get_context().opts.get('version_table_schema')
    prefix = f"{schema}." if schema else ""
    op.create_table(
        'work_project_members',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('work_project_id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('added_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['work_project_id'], [f'{prefix}work_projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], [f'{prefix}users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('work_project_id', 'user_id'),
        schema=schema,
    )
    op.create_index(op.f('ix_work_project_members_work_project_id'), 'work_project_members', ['work_project_id'], schema=schema)
    op.create_index(op.f('ix_work_project_members_user_id'), 'work_project_members', ['user_id'], schema=schema)


def downgrade() -> None:
    schema = op.get_context().opts.get('version_table_schema')
    op.drop_index(op.f('ix_work_project_members_user_id'), table_name='work_project_members', schema=schema)
    op.drop_index(op.f('ix_work_project_members_work_project_id'), table_name='work_project_members', schema=schema)
    op.drop_table('work_project_members', schema=schema)
