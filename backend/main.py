import logging
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s  [%(name)s] %(message)s",
)
from fastapi.middleware.cors import CORSMiddleware

from routes import projects, pipeline, assets, live, image_nodes, camera, dream, studio
from config import MOCK_MODE

# Suppress noisy access logs for frequent polling endpoints
class _PollFilter(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        # suppress frequent polling endpoints
        if "GET /api/projects/" in msg and "/pipeline/jobs/" not in msg:
            return False
        if "/pipeline/jobs/" in msg:
            return False
        return True

logging.getLogger("uvicorn.access").addFilter(_PollFilter())
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("google_adk").setLevel(logging.CRITICAL)
logging.getLogger("py.warnings").setLevel(logging.ERROR)
logging.getLogger("routes.dream").setLevel(logging.DEBUG)

import warnings
warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")

app = FastAPI(title="AMA API")

import os
_extra_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
_dev_mode = os.getenv("ENV", "development") != "production"
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _dev_mode else ["http://localhost:5173", "http://localhost:4173", *_extra_origins],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(pipeline.router)
app.include_router(assets.router)
app.include_router(live.router)
app.include_router(image_nodes.router)
app.include_router(camera.router)
app.include_router(dream.router)
app.include_router(studio.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "mock_mode": MOCK_MODE}


# Serve React frontend — must be mounted last (catches all non-API routes)
_frontend = Path(__file__).parent / "frontend_dist"
if _frontend.exists():
    # StaticFiles handles exact asset paths (JS, CSS, images)
    app.mount("/assets", StaticFiles(directory=str(_frontend / "assets")), name="assets")

    # SPA fallback: serve index.html for all non-API routes so browser refresh works
    from fastapi.responses import FileResponse

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        return FileResponse(str(_frontend / "index.html"))
