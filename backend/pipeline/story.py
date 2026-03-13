"""
Pipeline Step 1: Story Understanding
Mock mode: copies test/story_data.json
Real mode: sends PDF to Gemini, returns structured story_data
"""
import asyncio
import json
import logging
import re
import shutil
from pathlib import Path

log = logging.getLogger("pipeline.story")

from config import MOCK_MODE, TEST_STORY_DATA, MODEL_STORY, project_dir, assets_dir, make_genai_client
from jobs import Job
import storage


async def run(job: Job, project_id: str) -> None:
    meta = storage.get_project(project_id)
    if not meta or not meta.get("pdf_name"):
        raise ValueError("No PDF uploaded — upload a PDF before running Story Understanding")
    if MOCK_MODE:
        await _mock(job, project_id)
    else:
        await _real(job, project_id)


async def _mock(job: Job, project_id: str) -> None:
    job.progress = "Loading story data (mock)..."
    await asyncio.sleep(1.5)

    data = json.loads(TEST_STORY_DATA.read_text())
    for page in data["pages"]:
        if "actual_page" not in page:
            page["actual_page"] = page["page"]
            page["ref_page"] = page["page"]
            page["ref_source"] = "pdf"
            page["ref_image"] = None
    storage.save_story_data(project_id, data)
    storage.update_pipeline_status(project_id, "story", "done")

    job.progress = "Done"
    job.result = {"pages": len(data["pages"]), "characters": len(data["characters"])}


async def _real(job: Job, project_id: str) -> None:
    from google import genai
    from google.genai import types
    from pydantic import BaseModel
    import os

    job.progress = "Reading PDF with Gemini..."
    log.info("Uploading PDF to Gemini...")

    pdf_files = list(project_dir(project_id).glob("*.pdf"))
    if not pdf_files:
        raise FileNotFoundError("No PDF found in project directory")

    pdf_path = pdf_files[0]

    client = make_genai_client()

    # Upload PDF with explicit mime type (matching test script)
    uploaded = await asyncio.to_thread(
        client.files.upload,
        file=str(pdf_path),
        config={"mime_type": "application/pdf"},
    )
    log.info("PDF uploaded: %s — calling model %s...", uploaded.name, MODEL_STORY)
    job.progress = "Analyzing story structure..."

    # Pydantic schema for guaranteed valid JSON (matching test script)
    class CharacterState(BaseModel):
        character: str
        state: str

    class Character(BaseModel):
        name: str
        role: str
        personality: str
        speech_style: str
        visual_description: str
        emotions: list[str]
        best_reference_page: int
        sprite_states: list[str]

    class Page(BaseModel):
        page: int
        text: str
        summary: str
        foreground_characters: list[str]
        background_characters: list[str]
        mood: str
        setting: str
        key_interaction: str
        scene_motion: str
        character_states: list[CharacterState]

    class StoryData(BaseModel):
        title: str
        summary: str
        best_scene_reference_page: int
        characters: list[Character]
        pages: list[Page]

    try:
        response = await asyncio.to_thread(
            client.models.generate_content,
            model=MODEL_STORY,
            contents=[uploaded, STORY_PROMPT],
            config=types.GenerateContentConfig(
                temperature=0.2,
                response_mime_type="application/json",
                response_schema=StoryData,
            ),
        )
    except Exception as e:
        log.error("Gemini API error: %s", e)
        raise

    log.info("Response received (%d chars) — parsing JSON...", len(response.text))
    try:
        data = json.loads(response.text)
    except Exception as e:
        log.error("JSON parse error: %s\nResponse: %s", e, response.text[:500])
        raise
    for page in data["pages"]:
        if "actual_page" not in page:
            page["actual_page"] = page["page"]
            page["ref_page"] = page["page"]
            page["ref_source"] = "pdf"
            page["ref_image"] = None
    storage.save_story_data(project_id, data)

    job.progress = "Extracting character reference images..."
    _extract_refs(project_id, data)

    storage.update_pipeline_status(project_id, "story", "done")

    job.progress = "Done"
    job.result = {"pages": len(data.get("pages", [])), "characters": len(data.get("characters", []))}
    log.info("Done — %d pages, %d characters", job.result["pages"], job.result["characters"])


def _extract_refs(project_id: str, story_data: dict) -> None:
    """Extract character and scene reference images from the project's PDF using PyMuPDF."""
    import fitz  # PyMuPDF
    import io
    from PIL import Image

    pdir = project_dir(project_id)
    pdf_files = list(pdir.glob("*.pdf"))
    if not pdf_files:
        return

    pdf_path = pdf_files[0]
    refs_dir = assets_dir(project_id) / "refs"
    refs_dir.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(str(pdf_path))
    mat = fitz.Matrix(150 / 72, 150 / 72)  # 150 DPI base, then resize to 1024×766
    TARGET_SIZE = (1024, 766)

    def render_page_to_png(page_number: int, out_path: Path) -> None:
        """Render a 1-based page number to a PNG, resized to fit within 1024×766."""
        if page_number < 1 or page_number > len(doc):
            return
        pix = doc[page_number - 1].get_pixmap(matrix=mat)
        pil = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        pil.thumbnail(TARGET_SIZE, Image.LANCZOS)
        buf = io.BytesIO()
        pil.save(buf, format="PNG")
        out_path.write_bytes(buf.getvalue())

    # Extract per-character reference images
    for character in story_data.get("characters", []):
        slug = re.sub(r'\s+', '_', character["name"].strip().lower())
        ref_path = refs_dir / f"{slug}_ref.png"
        if ref_path.exists():
            continue
        page_num = character.get("best_reference_page")
        if page_num is not None:
            render_page_to_png(int(page_num), ref_path)

    # Extract global scene reference image
    scene_ref_path = refs_dir / "scene_ref.png"
    if not scene_ref_path.exists():
        scene_page_num = story_data.get("best_scene_reference_page")
        if scene_page_num is not None:
            render_page_to_png(int(scene_page_num), scene_ref_path)

    doc.close()


STORY_PROMPT = """You are analyzing a children's picture book.

Study ALL pages carefully — both the illustrations and the text — then extract the full story data.

For the book:
- best_scene_reference_page: the single page number where the ENVIRONMENT/SETTING dominates the illustration most — characters are absent, tiny, or minimal. This will be used as a visual style reference for background video generation.

For each character:
- visual_description: detailed physical appearance for image generation
- best_reference_page: page number where the character is most clearly visible, full-body, best for sprite generation
- sprite_states: distinct emotional/physical states needed as sprites across the story, each a single lowercase word, always include "idle"

For each page:
- text: EXACT verbatim words printed on the page, empty string if wordless
- foreground_characters: characters who are the main visual subject of the page (large, central, focal point) — these become sprites overlaid on the scene
- background_characters: characters who are present but secondary/ambient (small, distant, part of the scenery) — these remain in the background scene
- scene_motion: ONLY environmental motion (wind, water, light, leaves, shadows, clouds) — no character movement. Used as a Veo3 video prompt with fixed camera.
- character_states: map each visually present character to one of their sprite_states"""
