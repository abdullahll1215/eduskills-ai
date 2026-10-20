import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import seed
from .config import get_settings
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from .database import SessionLocal, engine
from .migration_runner import upgrade_database, verify_database_revision
from .services.common import assign_orphan_artifacts, ensure_codes
from .services.locale import current_lang, lang_from_header
from .services.report_state import lock_report_configuration
from .routers import admin, advisor, auth, instructor, projects, student

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings = get_settings()

# Production build of the React frontend (frontend/dist), served by the API when present.
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


def init_db():
    """Fail on database errors. Production migrations run as a separate deployment step."""
    if settings.auto_migrate:
        upgrade_database(engine)
    else:
        verify_database_revision(engine)
    if settings.seed_demo_data:
        seed.run()
    with SessionLocal() as db:
        lock_report_configuration(db, exclusive=True)
        seed.seed_reference(db)
        assign_orphan_artifacts(db)
        ensure_codes(db)


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
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError:
        return JSONResponse(status_code=503, content={"status": "unavailable", "app": settings.app_name})
    return {"status": "ok", "app": settings.app_name}


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        file = FRONTEND_DIST / path
        if path and file.is_file() and FRONTEND_DIST in file.resolve().parents:
            return FileResponse(file)
        return FileResponse(FRONTEND_DIST / "index.html")
