"""Optional developer harness for a real local pg_dump/pg_restore round trip."""

import sys
import tempfile
from pathlib import Path
import pgserver
import psycopg2
from sqlalchemy.engine import make_url

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "backend"))
from app.services.recovery import backup_and_verify  # noqa: E402

pg = pgserver.get_server(Path(tempfile.mkdtemp(prefix="eduskills-pg-recovery-")), cleanup_mode="stop")
try:
    uri = pg.get_uri()
    conn = psycopg2.connect(uri)
    conn.autocommit = True
    with conn.cursor() as c:
        c.execute("CREATE DATABASE restore_test")
    conn.close()
    target = make_url(uri).set(database="restore_test").render_as_string(hide_password=False)
    with psycopg2.connect(uri) as conn:
        with conn.cursor() as c:
            c.execute(
                "CREATE SCHEMA eduskills; CREATE TABLE eduskills.recovery_probe(id integer primary key, content jsonb not null);"
            )
            c.execute("INSERT INTO eduskills.recovery_probe VALUES (%s,%s)", (1, '{"arabic":"اختبار","score":4}'))
        conn.commit()
    output = Path(tempfile.mkdtemp(prefix="eduskills-archive-")) / "backup.dump"
    bins = Path(pgserver.__file__).parent / "pginstall/bin"
    result = backup_and_verify(uri, target, "eduskills", output, str(bins / "pg_dump"), str(bins / "pg_restore"))
    assert result["restore_verified"] and result["tables"]["recovery_probe"]["rows"] == 1
    try:
        backup_and_verify(
            uri, target, "eduskills", output.with_name("second.dump"), str(bins / "pg_dump"), str(bins / "pg_restore")
        )
        raise AssertionError("nonempty target accepted")
    except ValueError as exc:
        assert "empty disposable" in str(exc)
    print(
        "Native pg_dump/pg_restore: content checksums and row counts match; nonempty target refused; archive permissions=",
        oct(output.stat().st_mode & 0o777),
    )
finally:
    pg.cleanup()
