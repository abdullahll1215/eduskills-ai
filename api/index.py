"""Vercel serverless entry point: exposes the FastAPI app (backend/app) for every /api/* request."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.main import app, init_db  # noqa: E402

# Vercel may not run ASGI lifespan events, so initialise the database when the function loads.
init_db()

__all__ = ["app"]
