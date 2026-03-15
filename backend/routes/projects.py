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
async def create_project(pdf: UploadFile = File(None)):
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    if pdf and pdf.filename:
        pdf_name = pdf.filename
        slug = pdf_name.lower().replace(".pdf", "").replace(" ", "-")[:40]
        project_id = f"{timestamp}_{slug}"
        meta = storage.create_project(project_id, pdf_name)
        storage.save_pdf(project_id, await pdf.read(), pdf_name)
    else:
        project_id = f"{timestamp}_untitled"
        meta = storage.create_project(project_id, "")
    return meta


@router.post("/{project_id}/upload-pdf")
async def upload_pdf(project_id: str, pdf: UploadFile = File(...)):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    pdf_name = pdf.filename or "book.pdf"
    storage.save_pdf(project_id, await pdf.read(), pdf_name)
    # Update pdf_name in meta via storage helpers
    storage.update_pdf_name(project_id, pdf_name)
    return {"ok": True, "pdf_name": pdf_name}


@router.get("/{project_id}")
def get_project(project_id: str):
    meta = storage.get_project(project_id)
    if not meta:
        raise HTTPException(404, "Project not found")
    return meta


@router.get("/{project_id}/story")
def get_story_data(project_id: str):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    data = storage.get_story_data(project_id)
    if not data:
        return None  # 200 with null — story not generated yet, not an error
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


class AddCharacterBody(BaseModel):
    name: str
    role: str = ""
    personality: str = ""
    speech_style: str = ""
    visual_description: str = ""
    sprite_states: list[str] = ["idle"]


@router.post("/{project_id}/characters")
def create_character(project_id: str, body: AddCharacterBody):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    try:
        char = storage.add_character(project_id, body.model_dump())
        return char
    except ValueError as e:
        raise HTTPException(400, str(e))


class AddSpriteStateBody(BaseModel):
    state: str


@router.post("/{project_id}/characters/{char_slug}/sprite-states")
def add_sprite_state(project_id: str, char_slug: str, body: AddSpriteStateBody):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    storage.add_sprite_state(project_id, char_slug, body.state)
    return {"ok": True}


class AssignCharRefBody(BaseModel):
    url: str  # relative asset url, e.g. "library/my_ref.jpg"


@router.post("/{project_id}/characters/{char_slug}/ref-image")
async def upload_char_ref_image(project_id: str, char_slug: str, file: UploadFile = File(...)):
    """Upload a ref image directly for a character (replaces refs/{slug}_ref.png)."""
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    dst = storage.get_asset_path(project_id, f"refs/{char_slug}_ref.png")
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(await file.read())
    return {"url": f"refs/{char_slug}_ref.png"}


@router.post("/{project_id}/characters/{char_slug}/ref")
def assign_char_ref(project_id: str, char_slug: str, body: AssignCharRefBody):
    """Assign a library/project asset as the active character ref."""
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    url = storage.set_char_ref(project_id, char_slug, body.url)
    return {"url": url}


class SetPageSpriteVersionBody(BaseModel):
    char: str
    state: str
    sprite_url: str


@router.patch("/{project_id}/pages/{page_num}/sprite-version")
def set_page_sprite_version(project_id: str, page_num: int, body: SetPageSpriteVersionBody):
    """Set which sprite version (by url) is assigned to a character_state on a specific page."""
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    storage.set_page_sprite_version(project_id, page_num, body.char, body.state, body.sprite_url)
    return {"ok": True}


@router.get("/{project_id}/library")
def get_library(project_id: str):
    """List all project assets grouped by category."""
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    return storage.get_all_assets(project_id)


@router.post("/{project_id}/library")
async def upload_library(project_id: str, file: UploadFile = File(...)):
    """Upload a file to the project library."""
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    url = storage.upload_to_library(project_id, file.filename or "upload", await file.read())
    return {"url": url}


class RenameBody(BaseModel):
    url: str
    new_name: str


@router.post("/{project_id}/library/rename")
def rename_asset(project_id: str, body: RenameBody):
    """Rename a library asset."""
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    try:
        new_url = storage.rename_library_asset(project_id, body.url, body.new_name)
        return {"url": new_url}
    except (ValueError, FileNotFoundError, FileExistsError) as e:
        raise HTTPException(400, str(e))


class EdgesBody(BaseModel):
    edges: list[dict[str, Any]]


@router.get("/{project_id}/positions")
def get_positions(project_id: str):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    return storage.get_positions(project_id)


@router.put("/{project_id}/positions")
def save_positions(project_id: str, body: dict[str, Any]):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    storage.save_positions(project_id, body)
    return {"ok": True}


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


class LiveNodeBody(BaseModel):
    id: str
    character: str = ""
    character_sprite: str = ""
    bg_url: str = ""
    system_prompt: str = ""
    label: str = "Live Interaction"
    vision: bool = False


@router.get("/{project_id}/live-nodes")
def get_live_nodes(project_id: str):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    return storage.get_live_nodes(project_id)


@router.put("/{project_id}/live-nodes/{node_id}")
def upsert_live_node(project_id: str, node_id: str, body: LiveNodeBody):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    node = body.model_dump()
    node["id"] = node_id
    return storage.save_live_node(project_id, node)


@router.delete("/{project_id}/live-nodes/{node_id}")
def remove_live_node(project_id: str, node_id: str):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    storage.delete_live_node(project_id, node_id)
    return {"ok": True}


class GenerateBgBody(BaseModel):
    prompt: str


@router.post("/{project_id}/live-nodes/{node_id}/generate-background")
async def generate_live_node_background(project_id: str, node_id: str, body: GenerateBgBody):
    """Generate a looping background video for a live node using Veo."""
    import asyncio, os, logging
    from google import genai
    from google.genai import types
    from config import MODEL_VIDEO, assets_dir, make_genai_client
    import jobs as jobs_module

    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")

    job = jobs_module.create_job(project_id, f"live_bg_{node_id}")

    async def _fn(j):
        log = logging.getLogger("pipeline.live_bg")
        client = make_genai_client()
        dst = assets_dir(project_id)
        (dst / "scenes").mkdir(parents=True, exist_ok=True)

        veo_prompt = (
            f"Static fixed camera angle — absolutely no camera movement, no pan, no zoom, no dolly. "
            f"{body.prompt}. "
            f"Only natural environmental elements animate — leaves, water, light, shadows. "
            f"No text, words, letters, or captions. Ambient environmental sound only."
        )

        j.progress = "Submitting to Veo..."
        operation = await asyncio.to_thread(
            client.models.generate_videos,
            model=MODEL_VIDEO,
            prompt=veo_prompt,
            config=types.GenerateVideosConfig(aspect_ratio="16:9", duration_seconds=8),
        )

        j.progress = "Waiting for Veo..."
        while not operation.done:
            await asyncio.sleep(15)
            operation = await asyncio.to_thread(client.operations.get, operation)

        if not (operation.response and operation.response.generated_videos):
            raise RuntimeError("Veo returned no videos")
        video = operation.response.generated_videos[0]
        existing = list((dst / "scenes").glob(f"live_{node_id}_bg_v*.mp4"))
        version = len(existing) + 1
        rel_url = f"scenes/live_{node_id}_bg_v{version}.mp4"
        out_path = dst / rel_url
        video.video.save(str(out_path))

        # Auto-save bg_url on the live node
        live_nodes = storage.get_live_nodes(project_id)
        node = next((n for n in live_nodes if n["id"] == node_id), None)
        if node:
            node["bg_url"] = rel_url
            storage.save_live_node(project_id, node)

        j.result = {"bg_url": rel_url}
        j.progress = "Done"
        log.info("Live node %s background generated: %s", node_id, rel_url)

    await jobs_module.run_job(job, _fn)
    return {"job_id": job.job_id}


class DreamNodeBody(BaseModel):
    id: str
    label: str = "Dream Moment"
    character: str = ""
    character_sprite: str = ""
    bg_url: str = ""
    voice_prompt: str = ""
    image_prompt: str = ""
    num_shots: int = 1
    vision: bool = False
    character_refs: list[str] = []
    background_refs: list[str] = []


@router.get("/{project_id}/dream-nodes")
def get_dream_nodes(project_id: str):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    return storage.get_dream_nodes(project_id)


@router.put("/{project_id}/dream-nodes/{node_id}")
def upsert_dream_node(project_id: str, node_id: str, body: DreamNodeBody):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    node = body.model_dump()
    node["id"] = node_id
    return storage.save_dream_node(project_id, node)


@router.delete("/{project_id}/dream-nodes/{node_id}")
def remove_dream_node(project_id: str, node_id: str):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    storage.delete_dream_node(project_id, node_id)
    return {"ok": True}


@router.post("/{project_id}/dream-nodes/{node_id}/generate-background")
async def generate_dream_node_background(project_id: str, node_id: str, body: GenerateBgBody):
    """Generate a looping background video for a dream node using Veo."""
    import asyncio, logging
    from google.genai import types
    from config import MODEL_VIDEO, assets_dir, make_genai_client
    import jobs as jobs_module

    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")

    job = jobs_module.create_job(project_id, f"dream_bg_{node_id}")

    async def _fn(j):
        log = logging.getLogger("pipeline.dream_bg")
        client = make_genai_client()
        dst = assets_dir(project_id)
        (dst / "scenes").mkdir(parents=True, exist_ok=True)

        veo_prompt = (
            f"Static fixed camera angle — absolutely no camera movement, no pan, no zoom, no dolly. "
            f"{body.prompt}. "
            f"Only natural environmental elements animate — leaves, water, light, shadows. "
            f"No text, words, letters, or captions. Ambient environmental sound only."
        )

        j.progress = "Submitting to Veo..."
        operation = await asyncio.to_thread(
            client.models.generate_videos,
            model=MODEL_VIDEO,
            prompt=veo_prompt,
            config=types.GenerateVideosConfig(aspect_ratio="16:9", duration_seconds=8),
        )

        j.progress = "Waiting for Veo..."
        while not operation.done:
            await asyncio.sleep(15)
            operation = await asyncio.to_thread(client.operations.get, operation)

        if not (operation.response and operation.response.generated_videos):
            raise RuntimeError("Veo returned no videos")
        video = operation.response.generated_videos[0]
        existing = list((dst / "scenes").glob(f"dream_{node_id}_bg_v*.mp4"))
        version = len(existing) + 1
        rel_url = f"scenes/dream_{node_id}_bg_v{version}.mp4"
        out_path = dst / rel_url
        video.video.save(str(out_path))

        # Auto-save bg_url on the dream node
        dream_nodes = storage.get_dream_nodes(project_id)
        node = next((n for n in dream_nodes if n["id"] == node_id), None)
        if node:
            node["bg_url"] = rel_url
            storage.save_dream_node(project_id, node)

        j.result = {"bg_url": rel_url}
        j.progress = "Done"
        log.info("Dream node %s background generated: %s", node_id, rel_url)

    await jobs_module.run_job(job, _fn)
    return {"job_id": job.job_id}


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
