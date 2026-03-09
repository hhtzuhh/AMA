import pathlib
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

import storage

router = APIRouter(prefix="/api/projects/{project_id}/assets", tags=["assets"])


@router.get("/{asset_path:path}")
def serve_asset(project_id: str, asset_path: str):
    path = storage.get_asset_path(project_id, asset_path)
    if not path.exists():
        raise HTTPException(404, f"Asset not found: {asset_path}")
    return FileResponse(path)
