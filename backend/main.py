import logging
from fastapi import FastAPI

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s  [%(name)s] %(message)s",
)
from fastapi.middleware.cors import CORSMiddleware

from routes import projects, pipeline, assets
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

app = FastAPI(title="AMA API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(pipeline.router)
app.include_router(assets.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "mock_mode": MOCK_MODE}
