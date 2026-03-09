"""
Pipeline Step 1: Story Understanding
Mock mode: copies test/story_data.json
Real mode: sends PDF to Gemini, returns structured story_data
"""
import asyncio
import json
import shutil
from pathlib import Path

from config import MOCK_MODE, TEST_STORY_DATA, MODEL_STORY, project_dir
from jobs import Job
import storage


async def run(job: Job, project_id: str) -> None:
    if MOCK_MODE:
        await _mock(job, project_id)
    else:
        await _real(job, project_id)


async def _mock(job: Job, project_id: str) -> None:
    job.progress = "Loading story data (mock)..."
    await asyncio.sleep(1.5)

    data = json.loads(TEST_STORY_DATA.read_text())
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

    pdf_files = list(project_dir(project_id).glob("*.pdf"))
    if not pdf_files:
        raise FileNotFoundError("No PDF found in project directory")

    pdf_path = pdf_files[0]

    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

    # Upload PDF
    uploaded = client.files.upload(path=str(pdf_path))
    job.progress = "Analyzing story structure..."

    response = client.models.generate_content(
        model=MODEL_STORY,
        contents=[uploaded, STORY_PROMPT],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
        ),
    )

    data = json.loads(response.text)
    storage.save_story_data(project_id, data)
    storage.update_pipeline_status(project_id, "story", "done")

    job.progress = "Done"
    job.result = {"pages": len(data.get("pages", [])), "characters": len(data.get("characters", []))}


STORY_PROMPT = """
Analyze this children's book PDF and extract a structured JSON with:
- title, summary, best_scene_reference_page
- characters: name, role, personality, speech_style, visual_description, emotions, best_reference_page, sprite_states
- pages: page number, text, summary, foreground_characters, background_characters, mood, setting, key_interaction, scene_motion, character_states

For sprite_states, list the distinct emotional/action states each character appears in.
For character_states per page, list each character present and their state on that page.
Return valid JSON only.
"""
