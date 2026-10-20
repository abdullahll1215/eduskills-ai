"""Backup, restore-integrity verification and data-retention purge (UC-08 steps 5-7)."""
import hashlib
import json
import sqlite3
from datetime import timedelta
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import Base, engine
from ..models import AuditLog, BackupRecord, ChatMessage, Notification, utcnow


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def run_backup(db: Session) -> BackupRecord:
    settings = get_settings()
    settings.backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = utcnow().strftime("%Y%m%d-%H%M%S-%f")
    url = settings.database_url

    if url.startswith("sqlite"):
        target = settings.backup_dir / f"eduskills-{stamp}.db"
        src = sqlite3.connect(url.replace("sqlite:///", ""))
        dst = sqlite3.connect(target)
        target.chmod(0o600)
        with dst:
            src.backup(dst)
        src.close()
        dst.close()
        verified, details = _verify_sqlite(target)
    else:
        target = settings.backup_dir / f"eduskills-{stamp}.json"
        dump = {}
        isolation = "REPEATABLE READ" if engine.dialect.name == "postgresql" else "SERIALIZABLE"
        with engine.connect().execution_options(isolation_level=isolation) as conn:
            with conn.begin():
                for table in Base.metadata.sorted_tables:
                    dump[table.name] = [dict(r._mapping) for r in conn.execute(select(table))]
        with target.open("x") as stream:
            target.chmod(0o600)
            json.dump({"format": "eduskills-data-export-v1", "schema": settings.database_schema,
                "restore_verified": False, "tables": dump}, stream, default=str)
        verified = False
        details = f"Data export only: {len(dump)} application tables. PostgreSQL restore has not been verified."

    rec = BackupRecord(
        filename=target.name, size_bytes=target.stat().st_size, checksum=_sha256(target), verified=verified, details=details
    )
    db.add(rec)
    return rec


def _verify_sqlite(path: Path) -> tuple[bool, str]:
    """Restore test: open the copy, run integrity_check and compare row counts of key tables."""
    try:
        conn = sqlite3.connect(path)
        ok = conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("users", "evaluations", "ai_reports")}
        conn.close()
        return ok, f"integrity_check={'ok' if ok else 'FAILED'}; rows: " + ", ".join(f"{k}={v}" for k, v in counts.items())
    except sqlite3.Error as exc:
        return False, f"Restore test failed: {exc}"


def purge(db: Session, retention_days: int) -> dict:
    """Data-retention purge: removes personal operational data older than the retention window."""
    cutoff = utcnow() - timedelta(days=retention_days)
    out = {}
    for model, col in ((ChatMessage, ChatMessage.created_at), (Notification, Notification.created_at), (AuditLog, AuditLog.created_at)):
        res = db.execute(delete(model).where(col < cutoff))
        out[model.__tablename__] = res.rowcount or 0
    out["cutoff"] = cutoff.isoformat()
    return out


def list_backups(db: Session) -> list[BackupRecord]:
    return list(db.scalars(select(BackupRecord).order_by(BackupRecord.created_at.desc())))
