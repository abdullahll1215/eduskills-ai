import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import seed
from .config import get_settings
from .database import Base, engine
from .routers import admin, advisor, auth, instructor, projects, student

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings = get_settings()

# Production build of the React frontend (frontend/dist), served by the API when present.
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    if settings.seed_demo_data:
        seed.run()
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
