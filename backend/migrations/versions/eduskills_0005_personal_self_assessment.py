"""Private personal assessments, independent of academic membership."""
from alembic import op
import sqlalchemy as sa

revision = "eduskills_0005"
down_revision = "eduskills_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    schema = op.get_context().opts.get("version_table_schema")
    prefix = f"{schema}." if schema else ""
    op.create_table(
        "personal_self_assessments",
        sa.Column("student_id", sa.String(36), primary_key=True),
        sa.Column("ratings", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["student_id"], [f"{prefix}users.id"], ondelete="CASCADE"),
        schema=schema,
    )
    settings = sa.table("system_settings", sa.column("key", sa.String), sa.column("value", sa.Text), schema=schema)
    # Product policy: registered students may explore released aggregate score profiles.
    # Administrators retain the ability to disable profile search after deployment.
    op.execute(settings.update().where(settings.c.key == "public_feedback_profiles").values(value="true"))
    if op.get_context().dialect.name != "postgresql":
        return
    table = f'"{schema}".personal_self_assessments' if schema else "personal_self_assessments"
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"REVOKE ALL ON {table} FROM PUBLIC")
    op.execute(f"""DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON {table} FROM anon;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON {table} FROM authenticated;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduskills_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO eduskills_app;
        CREATE POLICY backend_access ON {table} FOR ALL TO eduskills_app USING (true) WITH CHECK (true);
      END IF;
    END $$;""")


def downgrade() -> None:
    op.drop_table("personal_self_assessments", schema=op.get_context().opts.get("version_table_schema"))
