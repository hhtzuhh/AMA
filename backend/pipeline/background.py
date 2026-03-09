"""
Pipeline Step 3: Background Scene Generation (linear, per page)
"""
import asyncio

from config import MOCK_MODE, TEST_ASSETS_DIR, assets_dir, MODEL_VIDEO
from jobs import Job
import storage


async def run(job: Job, project_id: str) -> None:
    if MOCK_MODE:
        await _mock(job, project_id)
    else:
        await _real(job, project_id)


async def _mock(job: Job, project_id: str) -> None:
    dst = assets_dir(project_id)
    files = sorted((TEST_ASSETS_DIR / "scenes").glob("*.mp4"))
    count = 0

    for src_file in files:
        # parse page_21_bg.mp4 → page 21
        parts = src_file.stem.split("_")
        page_num = int(parts[1]) if len(parts) >= 2 else 0

        job.current = {"type": "background", "page": page_num}
        job.progress = f"Copying page {page_num} background..."
        await asyncio.sleep(0.5)

        existing = list((dst / "scenes").glob(f"page_{page_num}_bg_v*.mp4"))
        version = len(existing) + 1
        url = f"scenes/page_{page_num}_bg_v{version}.mp4"

        import shutil
        shutil.copy2(src_file, dst / url)
        storage.record_background(project_id, page_num, url)
        job.emit({"type": "background", "page": page_num, "status": "done", "url": url})
        count += 1

    storage.update_pipeline_status(project_id, "background", "done")
    job.progress = "Done"
    job.result = {"videos_generated": count}


async def _real(job: Job, project_id: str) -> None:
    import os
    from google import genai
    from google.genai import types

    story = storage.get_story_data(project_id)
    if not story:
        raise ValueError("Run story understanding first")

    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    dst = assets_dir(project_id)
    count = 0

    pages = [p for p in story["pages"] if p.get("foreground_characters")]

    for page in pages:
        page_num = page["page"]
        job.current = {"type": "background", "page": page_num}
        job.progress = f"Submitting page {page_num}..."

        prompt = (
            f"Cinematic background scene: {page['setting']}. "
            f"Mood: {page['mood']}. Motion: {page['scene_motion']}. "
            f"No characters, no text. Looping ambient scene."
        )
        operation = client.models.generate_videos(
            model=MODEL_VIDEO,
            prompt=prompt,
            config=types.GenerateVideoConfig(duration_seconds=8, aspect_ratio="16:9"),
        )

        job.progress = f"Polling page {page_num}..."
        while not operation.done:
            await asyncio.sleep(15)
            operation = client.operations.get(operation)

        if operation.response and operation.response.generated_videos:
            existing = list((dst / "scenes").glob(f"page_{page_num}_bg_v*.mp4"))
            version = len(existing) + 1
            url = f"scenes/page_{page_num}_bg_v{version}.mp4"
            (dst / url).write_bytes(operation.response.generated_videos[0].video.video_bytes)
            storage.record_background(project_id, page_num, url)
            job.emit({"type": "background", "page": page_num, "status": "done", "url": url})
            count += 1

    storage.update_pipeline_status(project_id, "background", "done")
    job.result = {"videos_generated": count}
