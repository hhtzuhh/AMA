"""
Pipeline Step 4: TTS Narration (linear, per page)
"""
import asyncio
import logging

from config import MOCK_MODE, TEST_ASSETS_DIR, assets_dir, MODEL_TTS, make_genai_client
from jobs import Job
import storage

log = logging.getLogger("pipeline.tts")


def _build_narrator_prompt(title: str, text: str, mood: str, setting: str) -> str:
    return f"""# AUDIO PROFILE: The Narrator
## "Children's Story Time"

## THE SCENE
A cozy, quiet reading room. A warm lamp glows softly. Children are gathered,
sitting still, eyes wide, completely absorbed. The story is "{title}".
The mood of this moment is {mood}. The setting is {setting}.

### DIRECTOR'S NOTES
Style: Warm, gentle, storytelling grandparent. Inviting and expressive —
bring the scene to life with subtle emotion. Not theatrical, just alive.
Pace: Unhurried. Let the words breathe. Slight pauses between sentences
to let children absorb the images.
Tone: Soft but clear. Every word lands.

#### TRANSCRIPT
{text}"""


async def run(job: Job, project_id: str) -> None:
    if MOCK_MODE:
        await _mock(job, project_id)
    else:
        await _real(job, project_id)


async def run_page(job: Job, project_id: str, page_num: int) -> None:
    """Regenerate narration for a single page."""
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

    files = sorted((TEST_ASSETS_DIR / "audio").glob("*.wav"))
    count = 0

    for src_file in files:
        parts = src_file.stem.split("_")
        page_num = int(parts[1]) if len(parts) >= 2 else 0

        page_data = pages_by_system_page.get(page_num, {})
        actual_page = page_data.get("actual_page", page_num)

        job.current = {"type": "narration", "page": page_num}
        job.progress = f"Copying page {page_num} narration..."
        await asyncio.sleep(0.3)

        existing = list((dst / "audio").glob(f"page_{actual_page}_narration_v*.wav"))
        version = len(existing) + 1
        url = f"audio/page_{actual_page}_narration_v{version}.wav"

        shutil.copy2(src_file, dst / url)
        storage.record_narration(project_id, actual_page, url, generation_inputs={
            "text": page_data.get("text", ""),
            "mood": page_data.get("mood", ""),
            "setting": page_data.get("setting", ""),
            "voice": "Sulafat",
        })
        job.emit({"type": "narration", "page": page_num, "status": "done", "url": url})
        count += 1

    storage.update_pipeline_status(project_id, "tts", "done")
    job.progress = "Done"
    job.result = {"audio_generated": count}


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
    files = sorted((TEST_ASSETS_DIR / "audio").glob("*.wav"))
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
        raise FileNotFoundError("No test wav fixture found")

    job.current = {"type": "narration", "page": page_num}
    job.progress = f"Copying page {page_num} narration..."
    await asyncio.sleep(0.3)

    (dst / "audio").mkdir(parents=True, exist_ok=True)
    existing = list((dst / "audio").glob(f"page_{actual_page}_narration_v*.wav"))
    version = len(existing) + 1
    url = f"audio/page_{actual_page}_narration_v{version}.wav"
    shutil.copy2(src_file, dst / url)
    storage.record_narration(project_id, actual_page, url, generation_inputs={
        "text": page_data.get("text", ""),
        "mood": page_data.get("mood", ""),
        "setting": page_data.get("setting", ""),
        "voice": "Sulafat",
    })
    job.emit({"type": "narration", "page": page_num, "status": "done", "url": url})
    job.progress = "Done"
    job.result = {"audio_generated": 1}


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

    text = page_data.get("text", "").strip()
    if not text:
        raise ValueError(f"Page {page_num} has no text to narrate")

    actual_page = page_data.get("actual_page", page_num)
    client = make_genai_client()
    dst = assets_dir(project_id)

    job.current = {"type": "narration", "page": page_num}
    job.progress = f"Generating page {page_num} narration..."
    print(f"[tts] Generating narration for page {page_num}...")

    prompt = _build_narrator_prompt(story["title"], text, page_data.get("mood", ""), page_data.get("setting", ""))
    try:
        response = await asyncio.to_thread(
            client.models.generate_content,
            model=MODEL_TTS,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Sulafat")
                    )
                ),
            ),
        )
    except Exception as e:
        print(f"[tts] Gemini API error on page {page_num}: {e}")
        log.error("Gemini error on page %d: %s", page_num, e)
        raise

    if not response.candidates:
        finish = getattr(response, "prompt_feedback", None)
        msg = f"Gemini returned no candidates for page {page_num} (prompt_feedback: {finish})"
        print(f"[tts] {msg}")
        raise RuntimeError(msg)

    candidate = response.candidates[0]
    finish_reason = getattr(candidate, "finish_reason", None)
    if finish_reason and str(finish_reason) not in ("STOP", "FinishReason.STOP", "1"):
        msg = f"Gemini blocked response for page {page_num}: finish_reason={finish_reason}"
        print(f"[tts] {msg}")
        raise RuntimeError(msg)

    try:
        audio_data = candidate.content.parts[0].inline_data.data
    except (IndexError, AttributeError) as e:
        msg = f"Gemini response has no audio data for page {page_num}: {e}"
        print(f"[tts] {msg}")
        raise RuntimeError(msg) from e

    (dst / "audio").mkdir(parents=True, exist_ok=True)
    existing = list((dst / "audio").glob(f"page_{actual_page}_narration_v*.wav"))
    version = len(existing) + 1
    url = f"audio/page_{actual_page}_narration_v{version}.wav"
    _write_wav(dst / url, audio_data)
    storage.record_narration(project_id, actual_page, url, generation_inputs={
        "text": text,
        "mood": page_data.get("mood", ""),
        "setting": page_data.get("setting", ""),
        "voice": "Sulafat",
    })
    job.emit({"type": "narration", "page": page_num, "status": "done", "url": url})
    job.progress = "Done"
    job.result = {"audio_generated": 1}


async def _real(job: Job, project_id: str) -> None:
    import os, wave
    from google import genai
    from google.genai import types

    story = storage.get_story_data(project_id)
    if not story:
        raise ValueError("Run story understanding first")

    client = make_genai_client()
    dst = assets_dir(project_id)
    count = 0

    for page in [p for p in story["pages"] if p.get("text", "").strip()]:
        page_num = page["page"]
        actual_page = page.get("actual_page", page_num)
        job.current = {"type": "narration", "page": page_num}
        job.progress = f"Generating page {page_num} narration..."
        log.info("Generating narration for page %d...", page_num)

        prompt = _build_narrator_prompt(story["title"], page["text"].strip(), page.get("mood", ""), page.get("setting", ""))
        try:
            response = await asyncio.to_thread(
                client.models.generate_content,
                model=MODEL_TTS,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Sulafat")
                        )
                    ),
                ),
            )
        except Exception as e:
            print(f"[tts] Gemini API error on page {page_num}: {e}")
            log.error("Gemini error on page %d: %s", page_num, e)
            raise

        if not response.candidates:
            msg = f"Gemini returned no candidates for page {page_num} (prompt_feedback: {getattr(response, 'prompt_feedback', None)})"
            print(f"[tts] {msg}")
            raise RuntimeError(msg)
        candidate = response.candidates[0]
        finish_reason = getattr(candidate, "finish_reason", None)
        if finish_reason and str(finish_reason) not in ("STOP", "FinishReason.STOP", "1"):
            msg = f"Gemini blocked response for page {page_num}: finish_reason={finish_reason}"
            print(f"[tts] {msg}")
            raise RuntimeError(msg)
        try:
            audio_data = candidate.content.parts[0].inline_data.data
        except (IndexError, AttributeError) as e:
            msg = f"Gemini response has no audio data for page {page_num}: {e}"
            print(f"[tts] {msg}")
            raise RuntimeError(msg) from e

        existing = list((dst / "audio").glob(f"page_{actual_page}_narration_v*.wav"))
        version = len(existing) + 1
        url = f"audio/page_{actual_page}_narration_v{version}.wav"

        _write_wav(dst / url, audio_data)
        storage.record_narration(project_id, actual_page, url, generation_inputs={
            "text": page["text"].strip(),
            "mood": page.get("mood", ""),
            "setting": page.get("setting", ""),
            "voice": "Sulafat",
        })
        job.emit({"type": "narration", "page": page_num, "status": "done", "url": url})
        count += 1
        await asyncio.sleep(0.3)

    storage.update_pipeline_status(project_id, "tts", "done")
    job.result = {"audio_generated": count}


def _write_wav(path, pcm_data: bytes, sample_rate: int = 24000) -> None:
    import wave
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_data)
