"""Read credentials from environment, never command arguments or terminal prompts."""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.recovery import backup_and_verify  # noqa: E402

parser = argparse.ArgumentParser(description="Restore a schema backup into an empty disposable PostgreSQL database")
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--schema", default="eduskills")
parser.add_argument("--pg-dump", default="pg_dump")
parser.add_argument("--pg-restore", default="pg_restore")
args = parser.parse_args()
try:
    result = backup_and_verify(
        os.environ["BACKUP_SOURCE_URL"],
        os.environ["BACKUP_RESTORE_TEST_URL"],
        args.schema,
        args.output,
        args.pg_dump,
        args.pg_restore,
    )
except (KeyError, ValueError, RuntimeError, subprocess.SubprocessError, OSError) as exc:
    # Provider errors may embed credentials, so report only the error category.
    print(f"Backup verification failed ({type(exc).__name__}); no success was recorded.", file=sys.stderr)
    raise SystemExit(1) from None
print(json.dumps(result, indent=2))
