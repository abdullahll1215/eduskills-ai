-- Generated from Alembic eduskills_0001 + eduskills_0002. Preserves public.

CREATE SCHEMA IF NOT EXISTS "eduskills";

CREATE TABLE eduskills.alembic_version (
    version_num VARCHAR(32) NOT NULL, 
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Running upgrade  -> eduskills_0001

CREATE TABLE eduskills.backups (
    id VARCHAR(36) NOT NULL, 
    filename VARCHAR(200) NOT NULL, 
    size_bytes INTEGER NOT NULL, 
    checksum VARCHAR(64) NOT NULL, 
    verified BOOLEAN NOT NULL, 
    details TEXT NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    PRIMARY KEY (id)
);

CREATE TABLE eduskills.competencies (
    id VARCHAR(36) NOT NULL, 
    code VARCHAR(40) NOT NULL, 
    skill_name VARCHAR(80) NOT NULL, 
    description TEXT NOT NULL, 
    rubric JSON NOT NULL, 
    sort_order INTEGER NOT NULL, 
    PRIMARY KEY (id), 
    UNIQUE (code)
);

CREATE TABLE eduskills.system_settings (
    key VARCHAR(60) NOT NULL, 
    value TEXT NOT NULL, 
    PRIMARY KEY (key)
);

CREATE TABLE eduskills.users (
    id VARCHAR(36) NOT NULL, 
    full_name VARCHAR(120) NOT NULL, 
    email VARCHAR(160) NOT NULL, 
    role VARCHAR(20) NOT NULL, 
    password_hash VARCHAR(100) NOT NULL, 
    student_number VARCHAR(30), 
    level VARCHAR(30), 
    mobile VARCHAR(30), 
    department VARCHAR(120), 
    is_active BOOLEAN NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    last_login_at TIMESTAMP WITHOUT TIME ZONE, 
    PRIMARY KEY (id)
);

CREATE UNIQUE INDEX ix_users_email ON eduskills.users (email);

CREATE INDEX ix_users_role ON eduskills.users (role);

CREATE INDEX ix_users_student_number ON eduskills.users (student_number);

CREATE TABLE eduskills.audit_logs (
    id VARCHAR(36) NOT NULL, 
    actor_id VARCHAR(36), 
    action VARCHAR(60) NOT NULL, 
    entity VARCHAR(60) NOT NULL, 
    entity_id VARCHAR(36), 
    details TEXT NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(actor_id) REFERENCES eduskills.users (id) ON DELETE SET NULL
);

CREATE INDEX ix_audit_logs_action ON eduskills.audit_logs (action);

CREATE INDEX ix_audit_logs_created_at ON eduskills.audit_logs (created_at);

CREATE TABLE eduskills.chat_messages (
    id VARCHAR(36) NOT NULL, 
    user_id VARCHAR(36) NOT NULL, 
    role VARCHAR(10) NOT NULL, 
    content TEXT NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(user_id) REFERENCES eduskills.users (id) ON DELETE CASCADE
);

CREATE INDEX ix_chat_messages_user_id ON eduskills.chat_messages (user_id);

CREATE TABLE eduskills.learning_resources (
    id VARCHAR(36) NOT NULL, 
    competency_id VARCHAR(36) NOT NULL, 
    title VARCHAR(200) NOT NULL, 
    provider VARCHAR(80) NOT NULL, 
    url VARCHAR(500) NOT NULL, 
    kind VARCHAR(20) NOT NULL, 
    duration VARCHAR(40) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(competency_id) REFERENCES eduskills.competencies (id) ON DELETE CASCADE
);

CREATE INDEX ix_learning_resources_competency_id ON eduskills.learning_resources (competency_id);

CREATE TABLE eduskills.notifications (
    id VARCHAR(36) NOT NULL, 
    user_id VARCHAR(36) NOT NULL, 
    kind VARCHAR(30) NOT NULL, 
    title VARCHAR(200) NOT NULL, 
    body TEXT NOT NULL, 
    link VARCHAR(200), 
    is_read BOOLEAN NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(user_id) REFERENCES eduskills.users (id) ON DELETE CASCADE
);

CREATE INDEX ix_notifications_user_id ON eduskills.notifications (user_id);

CREATE TABLE eduskills.projects (
    id VARCHAR(36) NOT NULL, 
    title VARCHAR(200) NOT NULL, 
    description TEXT, 
    instructor_id VARCHAR(36), 
    is_active BOOLEAN NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(instructor_id) REFERENCES eduskills.users (id) ON DELETE SET NULL
);

CREATE TABLE eduskills.work_projects (
    id VARCHAR(36) NOT NULL, 
    student_id VARCHAR(36) NOT NULL, 
    name VARCHAR(200) NOT NULL, 
    description TEXT, 
    url VARCHAR(500), 
    stages INTEGER NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(student_id) REFERENCES eduskills.users (id) ON DELETE CASCADE
);

CREATE INDEX ix_work_projects_student_id ON eduskills.work_projects (student_id);

CREATE TABLE eduskills.milestones (
    id VARCHAR(36) NOT NULL, 
    project_id VARCHAR(36) NOT NULL, 
    number INTEGER NOT NULL, 
    name VARCHAR(120) NOT NULL, 
    description TEXT, 
    due_date TIMESTAMP WITHOUT TIME ZONE, 
    status VARCHAR(20) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(project_id) REFERENCES eduskills.projects (id) ON DELETE CASCADE, 
    UNIQUE (project_id, number)
);

CREATE INDEX ix_milestones_project_id ON eduskills.milestones (project_id);

CREATE TABLE eduskills.teams (
    id VARCHAR(36) NOT NULL, 
    project_id VARCHAR(36) NOT NULL, 
    team_name VARCHAR(120) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(project_id) REFERENCES eduskills.projects (id) ON DELETE CASCADE
);

CREATE INDEX ix_teams_project_id ON eduskills.teams (project_id);

CREATE TABLE eduskills.ai_reports (
    id VARCHAR(36) NOT NULL, 
    student_id VARCHAR(36) NOT NULL, 
    project_id VARCHAR(36) NOT NULL, 
    milestone_id VARCHAR(36) NOT NULL, 
    narrative TEXT NOT NULL, 
    content JSON NOT NULL, 
    source VARCHAR(20) NOT NULL, 
    model VARCHAR(80), 
    overall_self FLOAT NOT NULL, 
    overall_external FLOAT NOT NULL, 
    overall_gap FLOAT NOT NULL, 
    overall_level VARCHAR(20) NOT NULL, 
    generated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(milestone_id) REFERENCES eduskills.milestones (id) ON DELETE CASCADE, 
    FOREIGN KEY(project_id) REFERENCES eduskills.projects (id) ON DELETE CASCADE, 
    FOREIGN KEY(student_id) REFERENCES eduskills.users (id) ON DELETE CASCADE, 
    UNIQUE (student_id, milestone_id)
);

CREATE INDEX ix_ai_reports_milestone_id ON eduskills.ai_reports (milestone_id);

CREATE INDEX ix_ai_reports_project_id ON eduskills.ai_reports (project_id);

CREATE INDEX ix_ai_reports_student_id ON eduskills.ai_reports (student_id);

CREATE TABLE eduskills.artifacts (
    id VARCHAR(36) NOT NULL, 
    student_id VARCHAR(36) NOT NULL, 
    project_id VARCHAR(36) NOT NULL, 
    milestone_id VARCHAR(36) NOT NULL, 
    work_project_id VARCHAR(36), 
    kind VARCHAR(30) NOT NULL, 
    title VARCHAR(200) NOT NULL, 
    url VARCHAR(500), 
    metrics JSON NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(milestone_id) REFERENCES eduskills.milestones (id) ON DELETE CASCADE, 
    FOREIGN KEY(project_id) REFERENCES eduskills.projects (id) ON DELETE CASCADE, 
    FOREIGN KEY(student_id) REFERENCES eduskills.users (id) ON DELETE CASCADE, 
    FOREIGN KEY(work_project_id) REFERENCES eduskills.work_projects (id) ON DELETE CASCADE
);

CREATE INDEX ix_artifacts_milestone_id ON eduskills.artifacts (milestone_id);

CREATE INDEX ix_artifacts_project_id ON eduskills.artifacts (project_id);

CREATE INDEX ix_artifacts_student_id ON eduskills.artifacts (student_id);

CREATE INDEX ix_artifacts_work_project_id ON eduskills.artifacts (work_project_id);

CREATE TABLE eduskills.enrollments (
    id VARCHAR(36) NOT NULL, 
    user_id VARCHAR(36) NOT NULL, 
    project_id VARCHAR(36) NOT NULL, 
    team_id VARCHAR(36), 
    PRIMARY KEY (id), 
    FOREIGN KEY(project_id) REFERENCES eduskills.projects (id) ON DELETE CASCADE, 
    FOREIGN KEY(team_id) REFERENCES eduskills.teams (id) ON DELETE SET NULL, 
    FOREIGN KEY(user_id) REFERENCES eduskills.users (id) ON DELETE CASCADE, 
    UNIQUE (user_id, project_id)
);

CREATE INDEX ix_enrollments_project_id ON eduskills.enrollments (project_id);

CREATE INDEX ix_enrollments_user_id ON eduskills.enrollments (user_id);

CREATE TABLE eduskills.evaluations (
    id VARCHAR(36) NOT NULL, 
    project_id VARCHAR(36) NOT NULL, 
    milestone_id VARCHAR(36) NOT NULL, 
    evaluator_id VARCHAR(36), 
    target_id VARCHAR(36) NOT NULL, 
    eval_type VARCHAR(20) NOT NULL, 
    reviewer_key VARCHAR(64) NOT NULL, 
    comment_enc TEXT, 
    evidence_link VARCHAR(500), 
    notes_enc TEXT, 
    sentiment FLOAT, 
    is_flagged BOOLEAN NOT NULL, 
    flag_reason VARCHAR(200), 
    moderation_status VARCHAR(20) NOT NULL, 
    is_locked BOOLEAN NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(evaluator_id) REFERENCES eduskills.users (id) ON DELETE SET NULL, 
    FOREIGN KEY(milestone_id) REFERENCES eduskills.milestones (id) ON DELETE CASCADE, 
    FOREIGN KEY(project_id) REFERENCES eduskills.projects (id) ON DELETE CASCADE, 
    FOREIGN KEY(target_id) REFERENCES eduskills.users (id) ON DELETE CASCADE, 
    UNIQUE (milestone_id, target_id, eval_type, reviewer_key)
);

CREATE INDEX ix_evaluations_eval_type ON eduskills.evaluations (eval_type);

CREATE INDEX ix_evaluations_milestone_id ON eduskills.evaluations (milestone_id);

CREATE INDEX ix_evaluations_project_id ON eduskills.evaluations (project_id);

CREATE INDEX ix_evaluations_target_id ON eduskills.evaluations (target_id);

CREATE TABLE eduskills.interventions (
    id VARCHAR(36) NOT NULL, 
    student_id VARCHAR(36) NOT NULL, 
    project_id VARCHAR(36) NOT NULL, 
    milestone_id VARCHAR(36), 
    raised_by_id VARCHAR(36), 
    priority VARCHAR(10) NOT NULL, 
    reason TEXT NOT NULL, 
    status VARCHAR(20) NOT NULL, 
    advisor_notes TEXT, 
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(milestone_id) REFERENCES eduskills.milestones (id) ON DELETE SET NULL, 
    FOREIGN KEY(project_id) REFERENCES eduskills.projects (id) ON DELETE CASCADE, 
    FOREIGN KEY(raised_by_id) REFERENCES eduskills.users (id) ON DELETE SET NULL, 
    FOREIGN KEY(student_id) REFERENCES eduskills.users (id) ON DELETE CASCADE
);

CREATE INDEX ix_interventions_student_id ON eduskills.interventions (student_id);

CREATE TABLE eduskills.delta_metrics (
    id VARCHAR(36) NOT NULL, 
    report_id VARCHAR(36) NOT NULL, 
    competency_id VARCHAR(36) NOT NULL, 
    self_score FLOAT NOT NULL, 
    peer_avg FLOAT NOT NULL, 
    instructor_score FLOAT NOT NULL, 
    external_avg FLOAT NOT NULL, 
    gap_score FLOAT NOT NULL, 
    direction VARCHAR(20) NOT NULL, 
    level VARCHAR(20) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(competency_id) REFERENCES eduskills.competencies (id) ON DELETE CASCADE, 
    FOREIGN KEY(report_id) REFERENCES eduskills.ai_reports (id) ON DELETE CASCADE
);

CREATE INDEX ix_delta_metrics_report_id ON eduskills.delta_metrics (report_id);

CREATE TABLE eduskills.skill_ratings (
    id VARCHAR(36) NOT NULL, 
    evaluation_id VARCHAR(36) NOT NULL, 
    competency_id VARCHAR(36) NOT NULL, 
    score INTEGER NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(competency_id) REFERENCES eduskills.competencies (id) ON DELETE CASCADE, 
    FOREIGN KEY(evaluation_id) REFERENCES eduskills.evaluations (id) ON DELETE CASCADE, 
    UNIQUE (evaluation_id, competency_id)
);

CREATE INDEX ix_skill_ratings_evaluation_id ON eduskills.skill_ratings (evaluation_id);

INSERT INTO eduskills.alembic_version (version_num) VALUES ('eduskills_0001') RETURNING eduskills.alembic_version.version_num;

-- Running upgrade eduskills_0001 -> eduskills_0002

ALTER TABLE eduskills.artifacts ADD COLUMN stage INTEGER;

UPDATE eduskills.alembic_version SET version_num='eduskills_0002' WHERE eduskills.alembic_version.version_num = 'eduskills_0001';


-- Server-only schema. The browser uses FastAPI, never the Supabase Data API.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eduskills_app') THEN
    CREATE ROLE eduskills_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
REVOKE ALL ON SCHEMA eduskills FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA eduskills FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA eduskills FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA eduskills TO eduskills_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA eduskills TO eduskills_app;
REVOKE INSERT, UPDATE, DELETE ON eduskills.alembic_version FROM eduskills_app;
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='eduskills' LOOP
    EXECUTE format('ALTER TABLE eduskills.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    IF t.tablename='alembic_version' THEN
      EXECUTE format('CREATE POLICY backend_read ON eduskills.%I FOR SELECT TO eduskills_app USING (true)', t.tablename);
    ELSE
      EXECUTE format('CREATE POLICY backend_access ON eduskills.%I FOR ALL TO eduskills_app USING (true) WITH CHECK (true)', t.tablename);
    END IF;
  END LOOP;
END $$;
