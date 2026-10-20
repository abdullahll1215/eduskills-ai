BEGIN;

CREATE SCHEMA IF NOT EXISTS "eduskills";

-- Running upgrade eduskills_0002 -> eduskills_0003

CREATE TABLE eduskills.work_project_members (
    id VARCHAR(36) NOT NULL, 
    work_project_id VARCHAR(36) NOT NULL, 
    user_id VARCHAR(36) NOT NULL, 
    added_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(work_project_id) REFERENCES eduskills.work_projects (id) ON DELETE CASCADE, 
    FOREIGN KEY(user_id) REFERENCES eduskills.users (id) ON DELETE CASCADE, 
    UNIQUE (work_project_id, user_id)
);

CREATE INDEX ix_work_project_members_work_project_id ON eduskills.work_project_members (work_project_id);

CREATE INDEX ix_work_project_members_user_id ON eduskills.work_project_members (user_id);

ALTER TABLE "eduskills".work_project_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            REVOKE ALL ON "eduskills".work_project_members FROM PUBLIC, anon, authenticated;
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduskills_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON "eduskills".work_project_members TO eduskills_app;
            CREATE POLICY backend_access ON "eduskills".work_project_members FOR ALL TO eduskills_app USING (true) WITH CHECK (true);
          END IF;
        END $$;;

UPDATE eduskills.alembic_version SET version_num='eduskills_0003' WHERE eduskills.alembic_version.version_num = 'eduskills_0002';

-- Running upgrade eduskills_0003 -> eduskills_0004

ALTER TABLE eduskills.projects ADD COLUMN join_code VARCHAR(12);

ALTER TABLE eduskills.projects ADD CONSTRAINT uq_projects_join_code UNIQUE (join_code);

ALTER TABLE eduskills.teams ADD COLUMN invite_code VARCHAR(12);

ALTER TABLE eduskills.teams ADD CONSTRAINT uq_teams_invite_code UNIQUE (invite_code);

UPDATE eduskills.alembic_version SET version_num='eduskills_0004' WHERE eduskills.alembic_version.version_num = 'eduskills_0003';

COMMIT;

