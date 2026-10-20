"""Optional developer harness: pip install pgserver==0.1.4; uses disposable local PostgreSQL only."""

import os
import subprocess
import sys
import tempfile
from pathlib import Path
import pgserver
import psycopg2

root = Path(__file__).resolve().parents[2]
pg = pgserver.get_server(Path(tempfile.mkdtemp(prefix="eduskills-pg-check-")), cleanup_mode="stop")
try:
    uri = pg.get_uri()
    with psycopg2.connect(uri) as conn:
        with conn.cursor() as c:
            c.execute("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;")
            c.execute(
                "CREATE TABLE public.preservation_marker(id integer primary key, label text not null); INSERT INTO public.preservation_marker VALUES(1,'preserved');"
            )
            sql = next((root / "supabase/migrations").glob("*_eduskills_backend_initial_schema.sql")).read_text()
            c.execute(sql)
            c.execute("SELECT version_num FROM eduskills.alembic_version")
            assert c.fetchone()[0] == "eduskills_0002"
            c.execute(
                "SELECT has_schema_privilege('anon','eduskills','USAGE'),has_schema_privilege('authenticated','eduskills','USAGE')"
            )
            assert c.fetchone() == (False, False)
            c.execute("SELECT count(*) FROM pg_tables WHERE schemaname='eduskills' AND rowsecurity")
            assert c.fetchone()[0] == 20
            c.execute("SELECT label FROM public.preservation_marker WHERE id=1")
            assert c.fetchone()[0] == "preserved"
        conn.commit()
    print("Migration SQL: 20 tables, RLS enabled, browser roles denied, legacy data preserved", flush=True)
    with psycopg2.connect(uri) as conn:
        with conn.cursor() as c:
            c.execute("SET ROLE eduskills_app")
            c.execute("SELECT count(*) FROM eduskills.users")
            assert c.fetchone()[0] == 0
            c.execute("INSERT INTO eduskills.system_settings(key,value) VALUES('permission_probe','test')")
            c.execute("SELECT value FROM eduskills.system_settings WHERE key='permission_probe'")
            assert c.fetchone()[0] == "test"
        conn.rollback()
    for role in ("anon", "authenticated", "eduskills_app"):
        with psycopg2.connect(uri) as conn:
            with conn.cursor() as c:
                c.execute(f"SET ROLE {role}")
                try:
                    c.execute("SELECT * FROM public.preservation_marker")
                    raise AssertionError("Role gained access to the unrelated public table")
                except psycopg2.errors.InsufficientPrivilege:
                    conn.rollback()
    print("Restricted backend role: application DML works; unrelated public data denied", flush=True)
    env = dict(
        os.environ,
        TEST_DATABASE_URL=uri,
        TEST_DATABASE_SCHEMA="test_eduskills",
        DATABASE_URL=uri,
        DATABASE_SCHEMA="test_eduskills",
        ENVIRONMENT="test",
        SEED_DEMO_DATA="true",
        AUTO_MIGRATE="true",
    )
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "--tb=short"],
        cwd=root / "backend",
        env=env,
        stdout=open(str(Path(tempfile.gettempdir()) / "eduskills-postgres-suite.log"), "w"),
        stderr=subprocess.STDOUT,
    )
    print("PostgreSQL suite exit:", result.returncode, flush=True)
    with psycopg2.connect(uri) as conn:
        with conn.cursor() as c:
            c.execute("SELECT count(*) FROM test_eduskills.users")
            count = c.fetchone()[0]
            c.execute("SELECT label FROM public.preservation_marker WHERE id=1")
            assert c.fetchone()[0] == "preserved"
    env2 = dict(env, SEED_DEMO_DATA="false")
    rerun = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=root / "backend",
        env=env2,
        capture_output=True,
        text=True,
    )
    assert rerun.returncode == 0, rerun.stderr
    with psycopg2.connect(uri) as conn:
        with conn.cursor() as c:
            c.execute("SELECT count(*) FROM test_eduskills.users")
            assert c.fetchone()[0] == count
    print("Migration replay: preserved users and legacy schema", flush=True)
    bootstrap_env = dict(env, DATABASE_SCHEMA="startup_probe", SEED_DEMO_DATA="false")
    children = [subprocess.Popen([sys.executable, "-c", "from app.main import init_db; init_db()"],
        cwd=root / "backend", env=bootstrap_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(2)]
    for child in children:
        _, stderr = child.communicate(timeout=30)
        assert child.returncode == 0, stderr.decode()
    with psycopg2.connect(uri) as conn:
        with conn.cursor() as c:
            c.execute("SELECT count(*) FROM startup_probe.competencies")
            assert c.fetchone()[0] == 5
            c.execute("SELECT count(*) FROM startup_probe.users")
            assert c.fetchone()[0] == 0
    print("Concurrent startup: reference data bootstrapped once; no demo users", flush=True)
    sys.exit(result.returncode)
finally:
    pg.cleanup()
