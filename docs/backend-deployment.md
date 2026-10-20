# Backend deployment and verification

The application remains React + FastAPI + SQLAlchemy. Supabase is the PostgreSQL host; its Auth/Data API is not substituted for the existing backend authentication. The old graduation-project tables in `public` use a different schema and must not be replaced or merged blindly.

## Database provisioning

Apply `supabase/migrations/20261020144415_eduskills_backend_initial_schema.sql` only to the confirmed graduation project, after verifying that `eduskills` does not already exist. It creates the private `eduskills` schema, records Alembic revisions `eduskills_0001` and `eduskills_0002`, enables RLS, revokes browser role access, and creates a restricted **NOLOGIN** `eduskills_app` role. It preserves the existing `public` schema.

Do not rerun the baseline against an already initialized schema. Future application changes use Alembic migrations generated/reviewed against the same schema. Never use an automatic metadata diff to drop unrelated Supabase tables.

Provision an independent login password for `eduskills_app` through a trusted administrator/secret channel. Do not paste credentials into chat, commit them, print them, or include them in command arguments. This role receives application table DML and schema usage, with no schema creation, role creation, superuser, or RLS bypass privileges. It can only read the migration-version table. Authorization within the application remains FastAPI's responsibility.

Use the connection string copied from the project's Connect panel. For Vercel, use the transaction pooler with SQLAlchemy `NullPool`; direct/session connections are suitable for migration administration. See [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres) and [SQLAlchemy guidance](https://supabase.com/docs/guides/troubleshooting/using-sqlalchemy-with-supabase-FUqebT).

## Required deployment settings

- `ENVIRONMENT=production`
- `DATABASE_URL`: restricted backend PostgreSQL connection, stored in the deployment secret manager
- `DATABASE_SCHEMA=eduskills`
- `AUTO_MIGRATE=false`
- `SEED_DEMO_DATA=false`
- Independent random `SECRET_KEY`, valid Fernet `ENCRYPTION_KEY`, and random `ANONYMIZATION_SALT`
- `AI_API_KEY`, optionally, for actual Gemini responses. Without it, reports disclose the template fallback source.

Production refuses SQLite, built-in secrets, invalid encryption keys and demo seeding. It does not derive secrets from database credentials or fall back to a temporary database. Existing deployed encrypted records need their original encryption key; never rotate that key or import encrypted data without a migration/re-encryption plan.

Install `backend/requirements.lock`. Vercel's root requirements and Docker image use this same lockfile. Run migrations as an administrative deployment step, then start the restricted runtime. The API checks the Alembic revision on startup and `/api/health` checks actual database connectivity, returning 503 on an outage. Development can explicitly set `AUTO_MIGRATE=true`; production should use reviewed deploy-time migrations.

The development Docker Compose configuration intentionally seeds disposable demonstration accounts. It is not the production configuration.

## Existing reports and membership

Old reports lacking an input fingerprint are withheld until regenerated. A student assessment is still editable while its period is open, preserving the current product decision. Recompute approved reports through the instructor regeneration API. Reports fingerprint their evaluations, rubric, resources and scoring settings. PostgreSQL advisory locks prevent simultaneous writes or global scoring edits from certifying inconsistent inputs.

New students may register but cannot assign themselves a team. A teacher/admin assigns enrollment through the existing project API. Other-student feedback is disabled by default; if explicitly enabled, it is restricted to shared active teams and their authorized course milestones. Peer ratings can cross teams only within a course assigned to both students. The browser-only demo is a separate illustrative runtime and is not proof of backend access enforcement.

## Backup and recovery

The administration endpoint makes a local SQLite backup or application-scoped PostgreSQL data export. A PostgreSQL JSON export is explicitly **not restore-verified**. It includes only application tables, from one repeatable-read snapshot, with owner-only file permissions.

For a real PostgreSQL recovery check, provide `BACKUP_SOURCE_URL` and `BACKUP_RESTORE_TEST_URL` via a local environment/secret manager. The target must be an **empty disposable database**. With compatible native PostgreSQL clients installed:

```sh
cd backend
python tools/verify_postgres_backup.py --schema eduskills --output /secure/backup/eduskills.dump
```

The tool uses `pg_dump` with a consistent exported snapshot, restores using `pg_restore --single-transaction`, and compares every table's row count and content checksum. It refuses a nonempty target and never uses `--clean`. Use PostgreSQL client binaries at least as new as the source server. Keep encryption keys in a separate secure recovery channel. Vercel `/tmp` is ephemeral: local exports do not establish durable disaster recovery. Configure a durable backup destination or Supabase platform backups before relying on recovery operationally.

## Reproducible verification

```sh
cd backend
python -m pip install -r requirements.lock
python -m pytest -q
```

For PostgreSQL, use an empty **test** database through `TEST_DATABASE_URL` and `TEST_DATABASE_SCHEMA=test_eduskills`. Never point this suite at a production database: it writes demo users and test assessments. CI runs the suite on PostgreSQL 17.

Optional local developer checks use `pgserver==0.1.4` in a disposable environment:

```sh
python tools/run_postgres_checks.py
python tools/check_native_recovery.py
```

These create disposable local PostgreSQL instances, test migrations/RLS/legacy preservation, run the API suite, replay migrations, and test a real native backup restore. They do not deploy or prove a Supabase or Vercel connection. See the dated verification record for actual observed results.
