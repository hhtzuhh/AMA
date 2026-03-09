from datetime import datetime
from fastapi import APIRouter, HTTPException, UploadFile, File

import storage

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("")
def list_projects():
    return storage.list_projects()


@router.post("")
async def create_project(pdf: UploadFile = File(...)):
    pdf_name = pdf.filename or "book.pdf"
    slug = pdf_name.lower().replace(".pdf", "").replace(" ", "-")[:40]
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    project_id = f"{timestamp}_{slug}"
    meta = storage.create_project(project_id, pdf_name)
    content = await pdf.read()
    storage.save_pdf(project_id, content, pdf_name)
    return meta


@router.get("/{project_id}")
def get_project(project_id: str):
    meta = storage.get_project(project_id)
    if not meta:
        raise HTTPException(404, "Project not found")
    return meta


@router.get("/{project_id}/story")
def get_story_data(project_id: str):
    data = storage.get_story_data(project_id)
    if not data:
        raise HTTPException(404, "story_data.json not found")
    return data


@router.get("/{project_id}/manifest")
def get_manifest(project_id: str):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    return storage.get_manifest(project_id)
