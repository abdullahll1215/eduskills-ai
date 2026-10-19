import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import seed
from .config import get_settings
from sqlalchemy import inspect, text

from .database import Base, SessionLocal, engine
from .services.common import assign_orphan_artifacts
from .services.locale import current_lang, lang_from_header
from .routers import admin, advisor, auth, instructor, projects, student

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings = get_settings()

# Production build of the React frontend (frontend/dist), served by the API when present.
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


def init_db():
    """Creates tables and seeds demo data. Safe to call from several serverless instances at once."""
    try:
        Base.metadata.create_all(engine)
        if settings.seed_demo_data:
            seed.run()
    except Exception:  # noqa: BLE001 - another instance won the race; the data is already there
        logging.getLogger("eduskills").warning("Database initialisation skipped", exc_info=True)
    try:
        _upgrade_schema()
    except Exception:  # noqa: BLE001
        logging.getLogger("eduskills").warning("Schema upgrade skipped", exc_info=True)


def _upgrade_schema():
    """Adds columns introduced after a database was first created (create_all only adds new tables)."""
    if "work_project_id" not in {c["name"] for c in inspect(engine).get_columns("artifacts")}:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE artifacts ADD COLUMN work_project_id VARCHAR(36) REFERENCES work_projects(id) ON DELETE CASCADE"))
    with SessionLocal() as db:
        assign_orphan_artifacts(db)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="EduSkills AI - Soft Skills Assessment API",
    description="AI-Driven Soft Skills Assessment and Development System for Undergraduate Students (KFU / CCSIT).",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



@app.middleware("http")
async def interface_language(request: Request, call_next):
    """AI report text is returned in the language the visitor is using."""
    current_lang.set(lang_from_header(request.headers.get("x-lang")))
    return await call_next(request)


for r in (auth.router, student.router, student.chat_router, instructor.router, projects.router, advisor.router, admin.router):
    app.include_router(r)


@app.get("/api/health", tags=["auth & common"])
def health():
    return {"status": "ok", "app": settings.app_name}


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        file = FRONTEND_DIST / path
        if path and file.is_file() and FRONTEND_DIST in file.resolve().parents:
            return FileResponse(file)
        return FileResponse(FRONTEND_DIST / "index.html")
