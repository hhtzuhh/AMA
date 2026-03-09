from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes import projects, pipeline, assets
from config import MOCK_MODE

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
