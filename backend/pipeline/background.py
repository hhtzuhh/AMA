"""
Pipeline Step 3: Background Scene Generation (linear, per page)
"""
import asyncio
import logging

from config import MOCK_MODE, TEST_ASSETS_DIR, assets_dir, MODEL_VIDEO, project_dir
from jobs import Job
import storage

log = logging.getLogger("pipeline.background")


async def run(job: Job, project_id: str) -> None:
    if MOCK_MODE:
        await _mock(job, project_id)
    else:
        await _real(job, project_id)


async def run_page(job: Job, project_id: str, page_num: int) -> None:
    """Regenerate background for a single page (by system page number)."""
    if MOCK_MODE:
        await _mock_page(job, project_id, page_num)
    else:
        await _real_page(job, project_id, page_num)


async def _mock(job: Job, project_id: str) -> None:
    import shutil
    dst = assets_dir(project_id)
    story = storage.get_story_data(project_id)
    pages_by_system_page: dict[int, dict] = {}
    if story:
        for p in story.get("pages", []):
            pages_by_system_page[p["page"]] = p

    files = sorted((TEST_ASSETS_DIR / "scenes").glob("*.mp4"))
    count = 0

    for src_file in files:
        # parse page_21_bg.mp4 → page 21
        parts = src_file.stem.split("_")
        page_num = int(parts[1]) if len(parts) >= 2 else 0

        # Determine actual_page key for storage
        page_data = pages_by_system_page.get(page_num, {})
        actual_page = page_data.get("actual_page", page_num)

        job.current = {"type": "background", "page": page_num}
        job.progress = f"Copying page {page_num} background..."
        await asyncio.sleep(0.5)

        existing = list((dst / "scenes").glob(f"page_{actual_page}_bg_v*.mp4"))
        version = len(existing) + 1
        url = f"scenes/page_{actual_page}_bg_v{version}.mp4"

        shutil.copy2(src_file, dst / url)
        storage.record_background(project_id, actual_page, url)
        job.emit({"type": "background", "page": page_num, "status": "done", "url": url})
        count += 1

    storage.update_pipeline_status(project_id, "background", "done")
    job.progress = "Done"
    job.result = {"videos_generated": count}


async def _mock_page(job: Job, project_id: str, page_num: int) -> None:
    import shutil
    dst = assets_dir(project_id)
    story = storage.get_story_data(project_id)
    pages_by_system_page: dict[int, dict] = {}
    if story:
        for p in story.get("pages", []):
            pages_by_system_page[p["page"]] = p

    page_data = pages_by_system_page.get(page_num, {})
    actual_page = page_data.get("actual_page", page_num)

    # Try to find matching fixture; fall back to first available
    files = sorted((TEST_ASSETS_DIR / "scenes").glob("*.mp4"))
    src_file = None
    for f in files:
        parts = f.stem.split("_")
        fnum = int(parts[1]) if len(parts) >= 2 else 0
        if fnum == page_num:
            src_file = f
            break
    if src_file is None and files:
        src_file = files[0]
    if src_file is None:
        raise FileNotFoundError("No test mp4 fixture found")

    job.current = {"type": "background", "page": page_num}
    job.progress = f"Copying page {page_num} background..."
    await asyncio.sleep(0.5)

    (dst / "scenes").mkdir(parents=True, exist_ok=True)
    existing = list((dst / "scenes").glob(f"page_{actual_page}_bg_v*.mp4"))
    version = len(existing) + 1
    url = f"scenes/page_{actual_page}_bg_v{version}.mp4"
    shutil.copy2(src_file, dst / url)
    storage.record_background(project_id, actual_page, url)
    job.emit({"type": "background", "page": page_num, "status": "done", "url": url})
    job.progress = "Done"
    job.result = {"videos_generated": 1}


async def _real_page(job: Job, project_id: str, page_num: int) -> None:
    import os
    from google import genai
    from google.genai import types

    story = storage.get_story_data(project_id)
    if not story:
        raise ValueError("Run story understanding first")

    page_data = next((p for p in story["pages"] if p["page"] == page_num), None)
    if not page_data:
        raise ValueError(f"Page {page_num} not found in story data")

    pdir = project_dir(project_id)
    pdf_files = list(pdir.glob("*.pdf"))
    if not pdf_files:
        raise FileNotFoundError("No PDF found in project directory")
    pdf_path = pdf_files[0]

    def build_prompt(page_d: dict) -> str:
        setting = page_d["setting"]
        scene_motion = page_d["scene_motion"]
        foreground_chars = page_d.get("foreground_characters", [])
        background_chars = page_d.get("background_characters", [])
        exclude_desc = ""
        if foreground_chars:
            exclude_desc = f"Remove and erase completely: {', '.join(foreground_chars)} — they must not appear anywhere in the scene. "
        bg_desc = ""
        if background_chars:
            bg_desc = f"In the far background, completely still and small: {', '.join(background_chars)}. "
        return (
            f"Static fixed camera angle — absolutely no camera movement, no pan, no zoom, no dolly. "
            f"Scene: {setting}. "
            f"{exclude_desc}"
            f"{bg_desc}"
            f"{scene_motion}. "
            f"Only natural environmental elements animate within the frame — leaves, water, light, shadows. "
            f"No text, words, letters, or captions visible anywhere in the frame. "
            f"Ambient environmental sound only. No music. No dialogue."
        )

    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    dst = assets_dir(project_id)
    (dst / "scenes").mkdir(parents=True, exist_ok=True)

    actual_page = page_data.get("actual_page", page_num)
    job.current = {"type": "background", "page": page_num}
    job.progress = f"Submitting page {page_num}..."
    log.info("Submitting background generation for page %d...", page_num)

    prompt = build_prompt(page_data)
    page_ref = _get_reference_image(pdf_path, page_data, dst)

    if page_ref is not None:
        operation = await asyncio.to_thread(
            client.models.generate_videos,
            model=MODEL_VIDEO,
            prompt=prompt,
            config=types.GenerateVideosConfig(
                aspect_ratio="16:9",
                duration_seconds=8,
                reference_images=[
                    types.VideoGenerationReferenceImage(
                        image=page_ref,
                        reference_type="asset",
                    )
                ],
            ),
        )
    else:
        operation = await asyncio.to_thread(
            client.models.generate_videos,
            model=MODEL_VIDEO,
            prompt=prompt,
            config=types.GenerateVideosConfig(
                aspect_ratio="16:9",
                duration_seconds=8,
            ),
        )

    job.progress = f"Submitted page {page_num}: {operation.name}. Polling..."
    log.info("Submitted page %d: %s — polling every 15s...", page_num, operation.name)
    while not operation.done:
        await asyncio.sleep(15)
        operation = await asyncio.to_thread(client.operations.get, operation)

    if operation.response and operation.response.generated_videos:
        existing = list((dst / "scenes").glob(f"page_{actual_page}_bg_v*.mp4"))
        version = len(existing) + 1
        url = f"scenes/page_{actual_page}_bg_v{version}.mp4"
        out_path = dst / url
        video = operation.response.generated_videos[0]
        await asyncio.to_thread(client.files.download, file=video.video)
        video.video.save(str(out_path))
        storage.record_background(project_id, actual_page, url)
        job.emit({"type": "background", "page": page_num, "status": "done", "url": url})
        job.result = {"videos_generated": 1}
    else:
        raise RuntimeError(f"Video generation failed for page {page_num}")

    job.progress = "Done"


def _get_reference_image(pdf_path, page_data: dict, dst):
    """Return a types.Image for the reference page, or None if no reference available."""
    import io
    from google.genai import types
    import fitz  # PyMuPDF
    from PIL import Image
    from pathlib import Path

    DPI = 150

    def render_pdf_page(page_number: int) -> types.Image:
        doc = fitz.open(str(pdf_path))
        mat = fitz.Matrix(DPI / 72, DPI / 72)
        pix = doc[page_number - 1].get_pixmap(matrix=mat)
        doc.close()
        pil = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        buf = io.BytesIO()
        pil.save(buf, format="PNG")
        return types.Image(image_bytes=buf.getvalue(), mime_type="image/png")

    ref_image_path = page_data.get("ref_image")
    if ref_image_path:
        img_path = Path(dst) / ref_image_path
        if img_path.exists():
            pil = Image.open(str(img_path)).convert("RGB")
            buf = io.BytesIO()
            pil.save(buf, format="PNG")
            return types.Image(image_bytes=buf.getvalue(), mime_type="image/png")

    ref_page = page_data.get("ref_page")
    if ref_page:
        return render_pdf_page(int(ref_page))

    actual_page = page_data.get("actual_page")
    if actual_page:
        return render_pdf_page(int(actual_page))

    return None


async def _real(job: Job, project_id: str) -> None:
    import os
    from google import genai
    from google.genai import types

    story = storage.get_story_data(project_id)
    if not story:
        raise ValueError("Run story understanding first")

    # Find PDF in project directory
    pdir = project_dir(project_id)
    pdf_files = list(pdir.glob("*.pdf"))
    if not pdf_files:
        raise FileNotFoundError("No PDF found in project directory")
    pdf_path = pdf_files[0]

    def build_prompt(page_data: dict) -> str:
        setting = page_data["setting"]
        scene_motion = page_data["scene_motion"]
        foreground_chars = page_data.get("foreground_characters", [])
        background_chars = page_data.get("background_characters", [])

        exclude_desc = ""
        if foreground_chars:
            exclude_desc = f"Remove and erase completely: {', '.join(foreground_chars)} — they must not appear anywhere in the scene. "

        bg_desc = ""
        if background_chars:
            bg_desc = f"In the far background, completely still and small: {', '.join(background_chars)}. "

        return (
            f"Static fixed camera angle — absolutely no camera movement, no pan, no zoom, no dolly. "
            f"Scene: {setting}. "
            f"{exclude_desc}"
            f"{bg_desc}"
            f"{scene_motion}. "
            f"Only natural environmental elements animate within the frame — leaves, water, light, shadows. "
            f"No text, words, letters, or captions visible anywhere in the frame. "
            f"Ambient environmental sound only. No music. No dialogue."
        )

    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    dst = assets_dir(project_id)
    (dst / "scenes").mkdir(parents=True, exist_ok=True)
    count = 0

    # Filter pages with scene_motion
    pages = [
        p for p in story["pages"]
        if p.get("scene_motion") and p["scene_motion"].lower() not in ("none.", "none")
    ]

    # Submit all jobs in parallel
    operations = {}
    for page in pages:
        page_num = page["page"]
        actual_page = page.get("actual_page", page_num)
        job.current = {"type": "background", "page": page_num}
        job.progress = f"Submitting page {page_num}..."

        prompt = build_prompt(page)
        page_ref = _get_reference_image(pdf_path, page, dst)

        if page_ref is not None:
            operation = await asyncio.to_thread(
                client.models.generate_videos,
                model=MODEL_VIDEO,
                prompt=prompt,
                config=types.GenerateVideosConfig(
                    aspect_ratio="16:9",
                    duration_seconds=8,
                    reference_images=[
                        types.VideoGenerationReferenceImage(
                            image=page_ref,
                            reference_type="asset",
                        )
                    ],
                ),
            )
        else:
            operation = await asyncio.to_thread(
                client.models.generate_videos,
                model=MODEL_VIDEO,
                prompt=prompt,
                config=types.GenerateVideosConfig(
                    aspect_ratio="16:9",
                    duration_seconds=8,
                ),
            )
        operations[page_num] = (operation, actual_page)
        job.progress = f"Submitted page {page_num}: {operation.name}"

    if not operations:
        storage.update_pipeline_status(project_id, "background", "done")
        job.result = {"videos_generated": 0}
        return

    # Poll all until done
    job.progress = f"Polling {len(operations)} operations..."
    log.info("Polling %d background operations every 15s...", len(operations))
    pending = dict(operations)
    while pending:
        await asyncio.sleep(15)
        done_pages = []
        for page_num, (op, actual_page) in list(pending.items()):
            op = await asyncio.to_thread(client.operations.get, op)
            pending[page_num] = (op, actual_page)
            if op.done:
                done_pages.append(page_num)
                if op.response and op.response.generated_videos:
                    existing = list((dst / "scenes").glob(f"page_{actual_page}_bg_v*.mp4"))
                    version = len(existing) + 1
                    url = f"scenes/page_{actual_page}_bg_v{version}.mp4"
                    out_path = dst / url
                    video = op.response.generated_videos[0]
                    await asyncio.to_thread(client.files.download, file=video.video)
                    video.video.save(str(out_path))
                    storage.record_background(project_id, actual_page, url)
                    job.emit({"type": "background", "page": page_num, "status": "done", "url": url})
                    count += 1

        for p in done_pages:
            del pending[p]

        if pending:
            job.progress = f"Still waiting: pages {list(pending.keys())}"
            log.info("Still waiting on pages: %s", list(pending.keys()))

    storage.update_pipeline_status(project_id, "background", "done")
    job.result = {"videos_generated": count}
