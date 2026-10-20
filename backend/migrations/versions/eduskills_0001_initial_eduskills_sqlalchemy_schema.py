"""Initial EduSkills SQLAlchemy schema

Revision ID: eduskills_0001
Revises: 
Create Date: 2026-10-20 17:41:27.246408

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
revision: str = 'eduskills_0001'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('backups', sa.Column('id', sa.String(length=36), nullable=False), sa.Column('filename', sa.String(length=200), nullable=False), sa.Column('size_bytes', sa.Integer(), nullable=False), sa.Column('checksum', sa.String(length=64), nullable=False), sa.Column('verified', sa.Boolean(), nullable=False), sa.Column('details', sa.Text(), nullable=False), sa.Column('created_at', sa.DateTime(), nullable=False), sa.PrimaryKeyConstraint('id'), schema=_schema())
    op.create_table('competencies', sa.Column('id', sa.String(length=36), nullable=False), sa.Column('code', sa.String(length=40), nullable=False), sa.Column('skill_name', sa.String(length=80), nullable=False), sa.Column('description', sa.Text(), nullable=False), sa.Column('rubric', sa.JSON(), nullable=False), sa.Column('sort_order', sa.Integer(), nullable=False), sa.PrimaryKeyConstraint('id'), sa.UniqueConstraint('code'), schema=_schema())
    op.create_table('system_settings', sa.Column('key', sa.String(length=60), nullable=False), sa.Column('value', sa.Text(), nullable=False), sa.PrimaryKeyConstraint('key'), schema=_schema())
    op.create_table('users', sa.Column('id', sa.String(length=36), nullable=False), sa.Column('full_name', sa.String(length=120), nullable=False), sa.Column('email', sa.String(length=160), nullable=False), sa.Column('role', sa.String(length=20), nullable=False), sa.Column('password_hash', sa.String(length=100), nullable=False), sa.Column('student_number', sa.String(length=30), nullable=True), sa.Column('level', sa.String(length=30), nullable=True), sa.Column('mobile', sa.String(length=30), nullable=True), sa.Column('department', sa.String(length=120), nullable=True), sa.Column('is_active', sa.Boolean(), nullable=False), sa.Column('created_at', sa.DateTime(), nullable=False), sa.Column('last_login_at', sa.DateTime(), nullable=True), sa.PrimaryKeyConstraint('id'), schema=_schema())
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True, schema=_schema())
    op.create_index(op.f('ix_users_role'), 'users', ['role'], unique=False, schema=_schema())
    op.create_index(op.f('ix_users_student_number'), 'users', ['student_number'], unique=False, schema=_schema())
    op.create_table('audit_logs', sa.Column('id', sa.String(length=36), nullable=False), sa.Column('actor_id', sa.String(length=36), nullable=True), sa.Column('action', sa.String(length=60), nullable=False), sa.Column('entity', sa.String(length=60), nullable=False), sa.Column('entity_id', sa.String(length=36), nullable=True), sa.Column('details', sa.Text(), nullable=False), sa.Column('created_at', sa.DateTime(), nullable=False), sa.ForeignKeyConstraint(['actor_id'], [_fk('users.id')], ondelete='SET NULL'), sa.PrimaryKeyConstraint('id'), schema=_schema())
    op.create_index(op.f('ix_audit_logs_action'), 'audit_logs', ['action'], unique=False, schema=_schema())
    op.create_index(op.f('ix_audit_logs_created_at'), 'audit_logs', ['created_at'], unique=False, schema=_schema())
    op.create_table('chat_messages', sa.Column('id', sa.String(length=36), nullable=False), sa.Column('user_id', sa.String(length=36), nullable=False), sa.Column('role', sa.String(length=10), nullable=False), sa.Column('content', sa.Text(), nullable=False), sa.Column('created_at', sa.DateTime(), nullable=False), sa.ForeignKeyConstraint(['user_id'], [_fk('users.id')], ondelete='CASCADE'), sa.PrimaryKeyConstraint('id'), schema=_schema())
    op.create_index(op.f('ix_chat_messages_user_id'), 'chat_messages', ['user_id'], unique=False, schema=_schema())
    op.create_table('learning_resources', sa.Column('id', sa.String(length=36), nullable=False), sa.Column('competency_id', sa.String(length=36), nullable=False), sa.Column('title', sa.String(length=200), nullable=False), sa.Column('provider', sa.String(length=80), nullable=False), sa.Column('url', sa.String(length=500), nullable=False), sa.Column('kind', sa.String(length=20), nullable=False), sa.Column('duration', sa.String(length=40), nullable=False), sa.ForeignKeyConstraint(['competency_id'], [_fk('competencies.id')], ondelete='CASCADE'), sa.PrimaryKeyConstraint('id'), schema=_schema())
    op.create_index(op.f('ix_learning_resources_competency_id'), 'learning_resources', ['competency_id'], unique=False, schema=_schema())
    op.create_table('notifications', sa.Column('id', sa.String(length=36), nullable=False), sa.Column('user_id', sa.String(length=36), nullable=False), sa.Column('kind', sa.String(length=30), nullable=False), sa.Column('title', sa.String(length=200), nullable=False), sa.Column('body', sa.Text(), nullable=False), sa.Column('link', sa.String(length=200), nullable=True), sa.Column('is_read', sa.Boolean(), nullable=False), sa.Column('created_at', sa.DateTime(), nullable=False), sa.ForeignKeyConstraint(['user_id'], [_fk('users.id')], ondelete='CASCADE'), sa.PrimaryKeyConstraint('id'), schema=_schema())
    op.create_index(op.f('ix_notifications_user_id'), 'notifications', ['user_id'], unique=False, schema=_schema())
    op.create_table('projects', sa.Column('id', sa.String(length=36), nullable=False), sa.Column('title', sa.String(length=200), nullable=False), sa.Column('description', sa.Text(), nullable=True), sa.Column('instructor_id', sa.String(length=36), nullable=True), sa.Column('is_active', sa.Boolean(), nullable=False), sa.Column('created_at', sa.DateTime(), nullable=False), sa.ForeignKeyConstraint(['instructor_id'], [_fk('users.id')], ondelete='SET NULL'), sa.PrimaryKeyConstraint('id'), schema=_schema())
    op.create_table('work_projects', sa.Column('id', sa.String(length=36), nullable=False), sa.Column('student_id', sa.String(length=36), nullable=False), sa.Column('name', sa.String(length=200), nullable=False), sa.Column('description', sa.Text(), nullable=True), sa.Column('url', sa.String(length=500), nullable=True), sa.Column('stages', sa.Integer(), nullable=False), sa.Column('created_at', sa.DateTime(), nullable=False), sa.ForeignKeyConstraint(['student_id'], [_fk('users.id')], ondelete='CASCADE'), sa.PrimaryKeyConstraint('id'), schema=_schema())
    op.create_index(op.f('ix_work_projects_student_id'), 'work_projects', ['student_id'], unique=False, schema=_schema())
    op.create_table('milestones', sa.Column('id', sa.String(length=36), nullable=False), sa.Column('project_id', sa.String(length=36), nullable=False), sa.Column('number', sa.Integer(), nullable=False), sa.Column('name', sa.String(length=120), nullable=False), sa.Column('description', sa.Text(), nullable=True), sa.Column('due_date', sa.DateTime(), nullable=True), sa.Column('status', sa.String(length=20), nullable=False), sa.ForeignKeyConstraint(['project_id'], [_fk('projects.id')], ondelete='CASCADE'), sa.PrimaryKeyConstraint('id'), sa.UniqueConstraint('project_id', 'number'), schema=_schema())
    op.create_index(op.f('ix_milestones_project_id'), 'milestones', ['project_id'], unique=False, schema=_schema())
    op.create_table('teams', sa.Column('id', sa.String(length=36), nullable=False), sa.Column('project_id', sa.String(length=36), nullable=False), sa.Column('team_name', sa.String(length=120), nullable=False), sa.ForeignKeyConstraint(['project_id'], [_fk('projects.id')], ondelete='CASCADE'), sa.PrimaryKeyConstraint('id'), schema=_schema())
    op.create_index(op.f('ix_teams_project_id'), 'teams', ['project_id'], unique=False, schema=_schema())
    op.create_table('ai_reports', sa.Column('id', sa.String(length=36), nullable=False), sa.Column('student_id', sa.String(length=36), nullable=False), sa.Column('project_id', sa.String(length=36), nullable=False), sa.Column('milestone_id', sa.String(length=36), nullable=False), sa.Column('narrative', sa.Text(), nullable=False), sa.Column('content', sa.JSON(), nullable=False), sa.Column('source', sa.String(length=20), nullable=False), sa.Column('model', sa.String(length=80), nullable=True), sa.Column('overall_self', sa.Float(), nullable=False), sa.Column('overall_external', sa.Float(), nullable=False), sa.Column('overall_gap', sa.Float(), nullable=False), sa.Column('overall_level', sa.String(length=20), nullable=False), sa.Column('generated_at', sa.DateTime(), nullable=False), sa.ForeignKeyConstraint(['milestone_id'], [_fk('milestones.id')], ondelete='CASCADE'), sa.ForeignKeyConstraint(['project_id'], [_fk('projects.id')], ondelete='CASCADE'), sa.ForeignKeyConstraint(['student_id'], [_fk('users.id')], ondelete='CASCADE'), sa.PrimaryKeyConstraint('id'), sa.UniqueConstraint('student_id', 'milestone_id'), schema=_schema())
    op.create_index(op.f('ix_ai_reports_milestone_id'), 'ai_reports', ['milestone_id'], unique=False, schema=_schema())
    op.create_index(op.f('ix_ai_reports_project_id'), 'ai_reports', ['project_id'], unique=False, schema=_schema())
    op.create_index(op.f('ix_ai_reports_student_id'), 'ai_reports', ['student_id'], unique=False, schema=_schema())
    op.create_table('artifacts', sa.Column('id', sa.String(length=36), nullable=False), sa.Column('student_id', sa.String(length=36), nullable=False), sa.Column('project_id', sa.String(length=36), nullable=False), sa.Column('milestone_id', sa.String(length=36), nullable=False), sa.Column('work_project_id', sa.String(length=36), nullable=True), sa.Column('kind', sa.String(length=30), nullable=False), sa.Column('title', sa.String(length=200), nullable=False), sa.Column('url', sa.String(length=500), nullable=True), sa.Column('metrics', sa.JSON(), nullable=False), sa.Column('created_at', sa.DateTime(), nullable=False), sa.ForeignKeyConstraint(['milestone_id'], [_fk('milestones.id')], ondelete='CASCADE'), sa.ForeignKeyConstraint(['project_id'], [_fk('projects.id')], ondelete='CASCADE'), sa.ForeignKeyConstraint(['student_id'], [_fk('users.id')], ondelete='CASCADE'), sa.ForeignKeyConstraint(['work_project_id'], [_fk('work_projects.id')], ondelete='CASCADE'), sa.PrimaryKeyConstraint('id'), schema=_schema())
    op.create_index(op.f('ix_artifacts_milestone_id'), 'artifacts', ['milestone_id'], unique=False, schema=_schema())
    op.create_index(op.f('ix_artifacts_project_id'), 'artifacts', ['project_id'], unique=False, schema=_schema())
    op.create_index(op.f('ix_artifacts_student_id'), 'artifacts', ['student_id'], unique=False, schema=_schema())
    op.create_index(op.f('ix_artifacts_work_project_id'), 'artifacts', ['work_project_id'], unique=False, schema=_schema())
    op.create_table('enrollments', sa.Column('id', sa.String(length=36), nullable=False), sa.Column('user_id', sa.String(length=36), nullable=False), sa.Column('project_id', sa.String(length=36), nullable=False), sa.Column('team_id', sa.String(length=36), nullable=True), sa.ForeignKeyConstraint(['project_id'], [_fk('projects.id')], ondelete='CASCADE'), sa.ForeignKeyConstraint(['team_id'], [_fk('teams.id')], ondelete='SET NULL'), sa.ForeignKeyConstraint(['user_id'], [_fk('users.id')], ondelete='CASCADE'), sa.PrimaryKeyConstraint('id'), sa.UniqueConstraint('user_id', 'project_id'), schema=_schema())
    op.create_index(op.f('ix_enrollments_project_id'), 'enrollments', ['project_id'], unique=False, schema=_schema())
    op.create_index(op.f('ix_enrollments_user_id'), 'enrollments', ['user_id'], unique=False, schema=_schema())
    op.create_table('evaluations', sa.Column('id', sa.String(length=36), nullable=False), sa.Column('project_id', sa.String(length=36), nullable=False), sa.Column('milestone_id', sa.String(length=36), nullable=False), sa.Column('evaluator_id', sa.String(length=36), nullable=True), sa.Column('target_id', sa.String(length=36), nullable=False), sa.Column('eval_type', sa.String(length=20), nullable=False), sa.Column('reviewer_key', sa.String(length=64), nullable=False), sa.Column('comment_enc', sa.Text(), nullable=True), sa.Column('evidence_link', sa.String(length=500), nullable=True), sa.Column('notes_enc', sa.Text(), nullable=True), sa.Column('sentiment', sa.Float(), nullable=True), sa.Column('is_flagged', sa.Boolean(), nullable=False), sa.Column('flag_reason', sa.String(length=200), nullable=True), sa.Column('moderation_status', sa.String(length=20), nullable=False), sa.Column('is_locked', sa.Boolean(), nullable=False), sa.Column('created_at', sa.DateTime(), nullable=False), sa.ForeignKeyConstraint(['evaluator_id'], [_fk('users.id')], ondelete='SET NULL'), sa.ForeignKeyConstraint(['milestone_id'], [_fk('milestones.id')], ondelete='CASCADE'), sa.ForeignKeyConstraint(['project_id'], [_fk('projects.id')], ondelete='CASCADE'), sa.ForeignKeyConstraint(['target_id'], [_fk('users.id')], ondelete='CASCADE'), sa.PrimaryKeyConstraint('id'), sa.UniqueConstraint('milestone_id', 'target_id', 'eval_type', 'reviewer_key'), schema=_schema())
    op.create_index(op.f('ix_evaluations_eval_type'), 'evaluations', ['eval_type'], unique=False, schema=_schema())
    op.create_index(op.f('ix_evaluations_milestone_id'), 'evaluations', ['milestone_id'], unique=False, schema=_schema())
    op.create_index(op.f('ix_evaluations_project_id'), 'evaluations', ['project_id'], unique=False, schema=_schema())
    op.create_index(op.f('ix_evaluations_target_id'), 'evaluations', ['target_id'], unique=False, schema=_schema())
    op.create_table('interventions', sa.Column('id', sa.String(length=36), nullable=False), sa.Column('student_id', sa.String(length=36), nullable=False), sa.Column('project_id', sa.String(length=36), nullable=False), sa.Column('milestone_id', sa.String(length=36), nullable=True), sa.Column('raised_by_id', sa.String(length=36), nullable=True), sa.Column('priority', sa.String(length=10), nullable=False), sa.Column('reason', sa.Text(), nullable=False), sa.Column('status', sa.String(length=20), nullable=False), sa.Column('advisor_notes', sa.Text(), nullable=True), sa.Column('created_at', sa.DateTime(), nullable=False), sa.Column('updated_at', sa.DateTime(), nullable=False), sa.ForeignKeyConstraint(['milestone_id'], [_fk('milestones.id')], ondelete='SET NULL'), sa.ForeignKeyConstraint(['project_id'], [_fk('projects.id')], ondelete='CASCADE'), sa.ForeignKeyConstraint(['raised_by_id'], [_fk('users.id')], ondelete='SET NULL'), sa.ForeignKeyConstraint(['student_id'], [_fk('users.id')], ondelete='CASCADE'), sa.PrimaryKeyConstraint('id'), schema=_schema())
    op.create_index(op.f('ix_interventions_student_id'), 'interventions', ['student_id'], unique=False, schema=_schema())
    op.create_table('delta_metrics', sa.Column('id', sa.String(length=36), nullable=False), sa.Column('report_id', sa.String(length=36), nullable=False), sa.Column('competency_id', sa.String(length=36), nullable=False), sa.Column('self_score', sa.Float(), nullable=False), sa.Column('peer_avg', sa.Float(), nullable=False), sa.Column('instructor_score', sa.Float(), nullable=False), sa.Column('external_avg', sa.Float(), nullable=False), sa.Column('gap_score', sa.Float(), nullable=False), sa.Column('direction', sa.String(length=20), nullable=False), sa.Column('level', sa.String(length=20), nullable=False), sa.ForeignKeyConstraint(['competency_id'], [_fk('competencies.id')], ondelete='CASCADE'), sa.ForeignKeyConstraint(['report_id'], [_fk('ai_reports.id')], ondelete='CASCADE'), sa.PrimaryKeyConstraint('id'), schema=_schema())
    op.create_index(op.f('ix_delta_metrics_report_id'), 'delta_metrics', ['report_id'], unique=False, schema=_schema())
    op.create_table('skill_ratings', sa.Column('id', sa.String(length=36), nullable=False), sa.Column('evaluation_id', sa.String(length=36), nullable=False), sa.Column('competency_id', sa.String(length=36), nullable=False), sa.Column('score', sa.Integer(), nullable=False), sa.ForeignKeyConstraint(['competency_id'], [_fk('competencies.id')], ondelete='CASCADE'), sa.ForeignKeyConstraint(['evaluation_id'], [_fk('evaluations.id')], ondelete='CASCADE'), sa.PrimaryKeyConstraint('id'), sa.UniqueConstraint('evaluation_id', 'competency_id'), schema=_schema())
    op.create_index(op.f('ix_skill_ratings_evaluation_id'), 'skill_ratings', ['evaluation_id'], unique=False, schema=_schema())

def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_skill_ratings_evaluation_id'), table_name='skill_ratings', schema=_schema())
    op.drop_table('skill_ratings', schema=_schema())
    op.drop_index(op.f('ix_delta_metrics_report_id'), table_name='delta_metrics', schema=_schema())
    op.drop_table('delta_metrics', schema=_schema())
    op.drop_index(op.f('ix_interventions_student_id'), table_name='interventions', schema=_schema())
    op.drop_table('interventions', schema=_schema())
    op.drop_index(op.f('ix_evaluations_target_id'), table_name='evaluations', schema=_schema())
    op.drop_index(op.f('ix_evaluations_project_id'), table_name='evaluations', schema=_schema())
    op.drop_index(op.f('ix_evaluations_milestone_id'), table_name='evaluations', schema=_schema())
    op.drop_index(op.f('ix_evaluations_eval_type'), table_name='evaluations', schema=_schema())
    op.drop_table('evaluations', schema=_schema())
    op.drop_index(op.f('ix_enrollments_user_id'), table_name='enrollments', schema=_schema())
    op.drop_index(op.f('ix_enrollments_project_id'), table_name='enrollments', schema=_schema())
    op.drop_table('enrollments', schema=_schema())
    op.drop_index(op.f('ix_artifacts_work_project_id'), table_name='artifacts', schema=_schema())
    op.drop_index(op.f('ix_artifacts_student_id'), table_name='artifacts', schema=_schema())
    op.drop_index(op.f('ix_artifacts_project_id'), table_name='artifacts', schema=_schema())
    op.drop_index(op.f('ix_artifacts_milestone_id'), table_name='artifacts', schema=_schema())
    op.drop_table('artifacts', schema=_schema())
    op.drop_index(op.f('ix_ai_reports_student_id'), table_name='ai_reports', schema=_schema())
    op.drop_index(op.f('ix_ai_reports_project_id'), table_name='ai_reports', schema=_schema())
    op.drop_index(op.f('ix_ai_reports_milestone_id'), table_name='ai_reports', schema=_schema())
    op.drop_table('ai_reports', schema=_schema())
    op.drop_index(op.f('ix_teams_project_id'), table_name='teams', schema=_schema())
    op.drop_table('teams', schema=_schema())
    op.drop_index(op.f('ix_milestones_project_id'), table_name='milestones', schema=_schema())
    op.drop_table('milestones', schema=_schema())
    op.drop_index(op.f('ix_work_projects_student_id'), table_name='work_projects', schema=_schema())
    op.drop_table('work_projects', schema=_schema())
    op.drop_table('projects', schema=_schema())
    op.drop_index(op.f('ix_notifications_user_id'), table_name='notifications', schema=_schema())
    op.drop_table('notifications', schema=_schema())
    op.drop_index(op.f('ix_learning_resources_competency_id'), table_name='learning_resources', schema=_schema())
    op.drop_table('learning_resources', schema=_schema())
    op.drop_index(op.f('ix_chat_messages_user_id'), table_name='chat_messages', schema=_schema())
    op.drop_table('chat_messages', schema=_schema())
    op.drop_index(op.f('ix_audit_logs_created_at'), table_name='audit_logs', schema=_schema())
    op.drop_index(op.f('ix_audit_logs_action'), table_name='audit_logs', schema=_schema())
    op.drop_table('audit_logs', schema=_schema())
    op.drop_index(op.f('ix_users_student_number'), table_name='users', schema=_schema())
    op.drop_index(op.f('ix_users_role'), table_name='users', schema=_schema())
    op.drop_index(op.f('ix_users_email'), table_name='users', schema=_schema())
    op.drop_table('users', schema=_schema())
    op.drop_table('system_settings', schema=_schema())
    op.drop_table('competencies', schema=_schema())
    op.drop_table('backups', schema=_schema())

def _schema():
    return op.get_context().opts.get('version_table_schema')

def _fk(name):
    schema = _schema()
    return f'{schema}.{name}' if schema else name
