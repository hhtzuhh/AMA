"""
Pipeline Step 2: Asset Generation (Character Sprites)
Folder: assets/sprites/{character_slug}/{state}_v{n}.png
"""
import asyncio
import re
import shutil
from datetime import datetime

from config import MOCK_MODE, TEST_ASSETS_DIR, assets_dir, MODEL_SPRITE
from jobs import Job
import storage


def char_slug(name: str) -> str:
    return re.sub(r'\s+', '_', name.strip().lower())


async def run(job: Job, project_id: str) -> None:
    if MOCK_MODE:
        await _mock(job, project_id)
    else:
        await _real(job, project_id)


async def _mock(job: Job, project_id: str) -> None:
    dst = assets_dir(project_id)

    # Parse test flat files: max_idle.png → sprites/max/idle_v1.png
    src_sprites = TEST_ASSETS_DIR / "sprites"
    files = sorted(src_sprites.glob("*.png"))

    for i, src_file in enumerate(files):
        parts = src_file.stem.split("_", 1)
        char = parts[0] if len(parts) == 2 else src_file.stem
        state = parts[1] if len(parts) == 2 else "idle"

        job.current = {"character": char, "state": state}
        job.progress = f"Copying {char}/{state}..."
        await asyncio.sleep(0.3)  # simulate generation time

        out_dir = dst / "sprites" / char
        out_dir.mkdir(parents=True, exist_ok=True)
        existing = list(out_dir.glob(f"{state}_v*.png"))
        version = len(existing) + 1
        url = f"sprites/{char}/{state}_v{version}.png"
        shutil.copy2(src_file, dst / url)

        storage.record_sprite(project_id, char, state, url)
        job.emit({"type": "sprite", "character": char, "state": state, "status": "done", "url": url})

    storage.copy_tree(TEST_ASSETS_DIR / "refs", dst / "refs")
    storage.update_pipeline_status(project_id, "assets", "done")
    job.progress = "Done"
    job.result = {"sprites_generated": len(files)}


async def _real(job: Job, project_id: str) -> None:
    import io, os
    from google import genai
    from google.genai import types
    from PIL import Image
    from rembg import remove, new_session

    story = storage.get_story_data(project_id)
    if not story:
        raise ValueError("Run story understanding first")

    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    rembg_session = new_session()
    dst = assets_dir(project_id)
    count = 0

    for character in story["characters"]:
        slug = char_slug(character["name"])
        visual_desc = character["visual_description"]
        char_dir = dst / "sprites" / slug
        char_dir.mkdir(parents=True, exist_ok=True)

        for state in character["sprite_states"]:
            job.current = {"character": slug, "state": state}
            job.progress = f"Generating {slug}/{state}..."

            # Determine version number
            existing = list(char_dir.glob(f"{state}_v*.png"))
            version = len(existing) + 1
            url = f"sprites/{slug}/{state}_v{version}.png"

            prompt = (
                f"Full-body character illustration of {character['name']}: {visual_desc}. "
                f"Emotion/pose: {state}. White background, no shadows, centered, full figure visible."
            )
            response = client.models.generate_content(
                model=MODEL_SPRITE,
                contents=prompt,
                config=types.GenerateContentConfig(response_modalities=["IMAGE"]),
            )
            for part in response.candidates[0].content.parts:
                if part.inline_data:
                    img = Image.open(io.BytesIO(part.inline_data.data))
                    img_no_bg = remove(img, session=rembg_session)
                    img_no_bg.save(dst / url, "PNG")
                    count += 1

            storage.record_sprite(project_id, slug, state, url)
            job.emit({"type": "sprite", "character": slug, "state": state, "status": "done", "url": url})
            await asyncio.sleep(0.5)

    storage.update_pipeline_status(project_id, "assets", "done")
    job.result = {"sprites_generated": count}
