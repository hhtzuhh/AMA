"""
Pipeline Step 4: TTS Narration (linear, per page)
"""
import asyncio

from config import MOCK_MODE, TEST_ASSETS_DIR, assets_dir, MODEL_TTS
from jobs import Job
import storage


async def run(job: Job, project_id: str) -> None:
    if MOCK_MODE:
        await _mock(job, project_id)
    else:
        await _real(job, project_id)


async def _mock(job: Job, project_id: str) -> None:
    dst = assets_dir(project_id)
    files = sorted((TEST_ASSETS_DIR / "audio").glob("*.wav"))
    count = 0

    for src_file in files:
        parts = src_file.stem.split("_")
        page_num = int(parts[1]) if len(parts) >= 2 else 0

        job.current = {"type": "narration", "page": page_num}
        job.progress = f"Copying page {page_num} narration..."
        await asyncio.sleep(0.3)

        existing = list((dst / "audio").glob(f"page_{page_num}_narration_v*.wav"))
        version = len(existing) + 1
        url = f"audio/page_{page_num}_narration_v{version}.wav"

        import shutil
        shutil.copy2(src_file, dst / url)
        storage.record_narration(project_id, page_num, url)
        job.emit({"type": "narration", "page": page_num, "status": "done", "url": url})
        count += 1

    storage.update_pipeline_status(project_id, "tts", "done")
    job.progress = "Done"
    job.result = {"audio_generated": count}


async def _real(job: Job, project_id: str) -> None:
    import os, wave
    from google import genai
    from google.genai import types

    story = storage.get_story_data(project_id)
    if not story:
        raise ValueError("Run story understanding first")

    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    dst = assets_dir(project_id)
    count = 0

    for page in [p for p in story["pages"] if p.get("text", "").strip()]:
        page_num = page["page"]
        job.current = {"type": "narration", "page": page_num}
        job.progress = f"Generating page {page_num} narration..."

        response = client.models.generate_content(
            model=MODEL_TTS,
            contents=page["text"].strip(),
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Sulafat")
                    )
                ),
            ),
        )
        audio_data = response.candidates[0].content.parts[0].inline_data.data

        existing = list((dst / "audio").glob(f"page_{page_num}_narration_v*.wav"))
        version = len(existing) + 1
        url = f"audio/page_{page_num}_narration_v{version}.wav"

        _write_wav(dst / url, audio_data)
        storage.record_narration(project_id, page_num, url)
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
