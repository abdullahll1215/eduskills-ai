"""Native PostgreSQL backup verification against an explicitly empty disposable database."""
import hashlib
import os
import re
import subprocess
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool


def _libpq_env(url: str) -> dict[str, str]:
    parsed = make_url(url)
    env = dict(os.environ)
    for key in ("PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSERVICE", "PGOPTIONS"):
        env.pop(key, None)
    env.update(PGHOST=parsed.host or str(parsed.query.get("host", "")), PGPORT=str(parsed.port or 5432),
        PGDATABASE=parsed.database or "postgres", PGUSER=parsed.username or "postgres",
        PGPASSWORD=parsed.password or "", PGCONNECT_TIMEOUT="10")
    if parsed.query.get("sslmode"):
        env["PGSSLMODE"] = parsed.query["sslmode"]
    if parsed.query.get("sslrootcert"):
        env["PGSSLROOTCERT"] = parsed.query["sslrootcert"]
    return env


def _manifest(connection, schema: str) -> dict:
    quote = connection.dialect.identifier_preparer.quote
    result = {}
    for table in sorted(inspect(connection).get_table_names(schema=schema)):
        digest, count = hashlib.sha256(), 0
        name = f"{quote(schema)}.{quote(table)}"
        for row in connection.execution_options(yield_per=1000).execute(text(
            f"SELECT to_jsonb(t)::text FROM {name} t ORDER BY to_jsonb(t)::text")):
            digest.update(row[0].encode() + b"\n")
            count += 1
        result[table] = {"rows": count, "sha256": digest.hexdigest()}
    return result


def backup_and_verify(source_url: str, target_url: str, schema: str, output: Path,
                      pg_dump: str = "pg_dump", pg_restore: str = "pg_restore") -> dict:
    """Never cleans or overwrites a target. Caller must supply a disposable empty database."""
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", schema):
        raise ValueError("A valid application schema is required")
    if output.exists():
        raise ValueError("Backup output already exists")
    source = create_engine(source_url, poolclass=NullPool)
    target = create_engine(target_url, poolclass=NullPool)
    try:
        with target.connect() as conn:
            if conn.scalar(text("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")):
                raise ValueError("Restore target must be an empty disposable database")
        with source.connect().execution_options(isolation_level="REPEATABLE READ") as conn:
            with conn.begin():
                conn.execute(text("SET TRANSACTION READ ONLY"))
                snapshot_id = conn.scalar(text("SELECT pg_export_snapshot()"))
                before = _manifest(conn, schema)
                if not before:
                    raise ValueError("Application schema contains no tables")
                with output.open("xb") as stream:
                    output.chmod(0o600)
                    subprocess.run([pg_dump, "--format=custom", "--no-owner", "--no-acl",
                        f"--schema={schema}", f"--snapshot={snapshot_id}"], env=_libpq_env(source_url),
                        stdout=stream, stderr=subprocess.PIPE, check=True, timeout=180)
        subprocess.run([pg_restore, "--no-owner", "--no-acl", "--single-transaction", "--exit-on-error",
            "--dbname=" + (make_url(target_url).database or "postgres"), str(output)],
            env=_libpq_env(target_url), stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=180)
        with target.connect() as conn:
            after = _manifest(conn, schema)
        if before != after:
            raise RuntimeError("Restored table counts or content checksums differ from the source snapshot")
        return {"restore_verified": True, "schema": schema, "tables": before,
            "archive_sha256": hashlib.sha256(output.read_bytes()).hexdigest()}
    finally:
        source.dispose()
        target.dispose()
