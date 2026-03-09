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
    rembg_session = new_session("isnet-anime")
    dst = assets_dir(project_id)
    refs_dir = dst / "refs"
    count = 0

    config = types.GenerateContentConfig(
        response_modalities=["IMAGE"],
        image_config=types.ImageConfig(
            aspect_ratio="1:1",
            image_size="1K",
        ),
    )

    def remove_background(image_bytes: bytes) -> Image.Image:
        result_bytes = remove(image_bytes, session=rembg_session)
        return Image.open(io.BytesIO(result_bytes)).convert("RGBA")

    def save_image_from_response(response, output_path) -> bool:
        for part in response.parts:
            if hasattr(part, 'thought') and part.thought:
                continue
            img_part = part.as_image() if hasattr(part, 'as_image') else None
            if img_part:
                pil_image = remove_background(img_part.image_bytes)
                pil_image.save(output_path)
                return True
        return False

    for character in story["characters"]:
        slug = char_slug(character["name"])
        sprite_states = character["sprite_states"]
        char_dir = dst / "sprites" / slug
        char_dir.mkdir(parents=True, exist_ok=True)

        ref_path = refs_dir / f"{slug}_ref.png"
        if not ref_path.exists():
            job.progress = f"Warning: no ref image for {slug}, skipping..."
            continue

        ref_image = Image.open(ref_path)

        # Build idle first prompt
        first_prompt = (
            f"I am providing a reference image from a children's picture book. "
            f"This character is {character['name']}: {character['visual_description']}. "
            f"Generate a clean full-body sprite of this character in an idle, neutral standing pose. "
            f"Match the original children's book illustration style exactly. "
            f"Solid bright green background (#00FF00). No shadows. Full body visible."
        )

        job.current = {"character": slug, "state": "idle"}
        job.progress = f"Generating {slug}/idle (anchor)..."

        # Start multi-turn chat for character consistency
        chat = client.chats.create(model=MODEL_SPRITE, config=config)
        response = chat.send_message([first_prompt, ref_image])

        # Determine if idle should be saved (it's in sprite_states)
        if "idle" in sprite_states:
            existing = list(char_dir.glob("idle_v*.png"))
            version = len(existing) + 1
            url = f"sprites/{slug}/idle_v{version}.png"
            out_path = dst / url
            if save_image_from_response(response, out_path):
                count += 1
                storage.record_sprite(project_id, slug, "idle", url)
                job.emit({"type": "sprite", "character": slug, "state": "idle", "status": "done", "url": url})
        else:
            # Still generate idle to anchor the character, but don't save/record it
            # We just need the chat session to have seen the idle response
            pass

        # Generate all other states in the same chat session
        for state in sprite_states:
            if state == "idle":
                continue

            job.current = {"character": slug, "state": state}
            job.progress = f"Generating {slug}/{state}..."

            state_prompt = (
                f"Keep the exact same character ({character['name']}) and illustration style. "
                f"Now show them in a '{state}' pose/expression. "
                f"Solid bright green background (#00FF00). No shadows. Full body visible."
            )
            response = chat.send_message(state_prompt)

            existing = list(char_dir.glob(f"{state}_v*.png"))
            version = len(existing) + 1
            url = f"sprites/{slug}/{state}_v{version}.png"
            out_path = dst / url
            if save_image_from_response(response, out_path):
                count += 1
            storage.record_sprite(project_id, slug, state, url)
            job.emit({"type": "sprite", "character": slug, "state": state, "status": "done", "url": url})
            await asyncio.sleep(0.5)

    storage.update_pipeline_status(project_id, "assets", "done")
    job.result = {"sprites_generated": count}
