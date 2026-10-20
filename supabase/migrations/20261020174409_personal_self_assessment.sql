-- Apply during the coordinated API deployment; existing API revisions require their exact Alembic head.
BEGIN;

DO $$ BEGIN
  IF (SELECT version_num FROM eduskills.alembic_version) IS DISTINCT FROM 'eduskills_0004' THEN
    RAISE EXCEPTION 'Expected eduskills_0004 before personal assessment migration';
  END IF;
END $$;

-- Running upgrade eduskills_0004 -> eduskills_0005

CREATE TABLE eduskills.personal_self_assessments (
    student_id VARCHAR(36) NOT NULL,
    ratings JSON NOT NULL,
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (student_id),
    FOREIGN KEY(student_id) REFERENCES eduskills.users (id) ON DELETE CASCADE
);

UPDATE eduskills.system_settings SET value='true' WHERE eduskills.system_settings.key = 'public_feedback_profiles';

ALTER TABLE "eduskills".personal_self_assessments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "eduskills".personal_self_assessments FROM PUBLIC;

DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON "eduskills".personal_self_assessments FROM anon;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON "eduskills".personal_self_assessments FROM authenticated;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduskills_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON "eduskills".personal_self_assessments TO eduskills_app;
        CREATE POLICY backend_access ON "eduskills".personal_self_assessments FOR ALL TO eduskills_app USING (true) WITH CHECK (true);
      END IF;
    END $$;;

UPDATE eduskills.alembic_version SET version_num='eduskills_0005' WHERE eduskills.alembic_version.version_num = 'eduskills_0004';

COMMIT;
