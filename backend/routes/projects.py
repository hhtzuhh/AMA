import pathlib
from datetime import datetime
from typing import Any
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

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


class SetCurrentBody(BaseModel):
    type: str        # "sprite" | "background" | "narration"
    version: int     # 0-based index
    char: str = ""   # for sprite
    state: str = ""  # for sprite
    page: int = 0    # for background/narration


@router.post("/{project_id}/manifest/set-current")
def set_current_version(project_id: str, body: SetCurrentBody):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    storage.set_current_version(project_id, body.type, body.version,
                                char=body.char, state=body.state, page=body.page)
    return {"ok": True}


@router.put("/{project_id}/story")
def update_story(project_id: str, body: dict[str, Any]):
    existing = storage.get_story_data(project_id)
    if not existing:
        raise HTTPException(404, "story_data.json not found")

    # Validate page numbers haven't changed
    existing_pages = {p["page"] for p in existing.get("pages", [])}
    new_pages = {p["page"] for p in body.get("pages", [])}
    if existing_pages != new_pages:
        raise HTTPException(
            400,
            f"Page numbers may not be changed. "
            f"Removed: {existing_pages - new_pages}, Added: {new_pages - existing_pages}"
        )

    storage.update_story_data(project_id, body)
    return {"ok": True}


@router.post("/{project_id}/pages/{page_num}/toggle")
def toggle_page(project_id: str, page_num: int):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    page = storage.toggle_page(project_id, page_num)
    return {"page": page_num, "enabled": page["enabled"]}


class ReorderBody(BaseModel):
    order: list[int]


@router.post("/{project_id}/pages/reorder")
def reorder_pages(project_id: str, body: ReorderBody):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    storage.reorder_pages(project_id, body.order)
    return {"ok": True}


@router.post("/{project_id}/pages")
def add_page(project_id: str):
    """Add a new blank custom page to story_data.json. Returns the new page."""
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    page = storage.add_page(project_id)
    return page


@router.delete("/{project_id}/pages/{page_num}")
def delete_page(project_id: str, page_num: int):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    storage.delete_page(project_id, page_num)
    return {"ok": True}


class UpdatePageBody(BaseModel):
    fields: dict[str, Any]


@router.patch("/{project_id}/pages/{page_num}")
def update_page(project_id: str, page_num: int, body: UpdatePageBody):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    storage.update_page(project_id, page_num, body.fields)
    return {"ok": True}


class SetPageRefBody(BaseModel):
    ref_page: int | None = None
    ref_image: str | None = None


@router.post("/{project_id}/pages/{page_num}/ref")
def set_page_ref(project_id: str, page_num: int, body: SetPageRefBody):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    storage.set_page_ref(project_id, page_num, ref_page=body.ref_page, ref_image=body.ref_image)
    return {"ok": True}


class UpdateCharacterBody(BaseModel):
    fields: dict[str, Any]


@router.patch("/{project_id}/characters/{char_slug}")
def update_character(project_id: str, char_slug: str, body: UpdateCharacterBody):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    storage.update_character(project_id, char_slug, body.fields)
    return {"ok": True}


class EdgesBody(BaseModel):
    edges: list[dict[str, Any]]


@router.get("/{project_id}/edges")
def get_edges(project_id: str):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    return {"edges": storage.get_edges(project_id)}


@router.put("/{project_id}/edges")
def save_edges(project_id: str, body: EdgesBody):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    storage.save_edges(project_id, body.edges)
    return {"ok": True}


@router.post("/{project_id}/pages/{page_num}/ref-image")
async def upload_ref_image(project_id: str, page_num: int, file: UploadFile = File(...)):
    """Upload a custom reference image for background generation."""
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    ext = pathlib.Path(file.filename or "ref.png").suffix or ".png"
    url = f"refs/custom_page_{page_num}{ext}"
    path = storage.get_asset_path(project_id, url)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(await file.read())
    storage.set_page_ref(project_id, page_num, ref_image=url)
    return {"url": url}
