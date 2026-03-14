from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any

import jobs as jobs_module
import storage

router = APIRouter(prefix="/api/projects", tags=["image-nodes"])


class ImageNodeBody(BaseModel):
    id: str
    label: str = "Image Story"
    story_prompt: str = ""
    character_refs: list[str] = []
    background_refs: list[str] = []
    ken_burns: bool = False
    num_shots: int = 3
    shots: list[dict] = []


@router.put("/{project_id}/image-nodes/{node_id}")
def upsert_image_node(project_id: str, node_id: str, body: ImageNodeBody):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    node = body.model_dump()
    node["id"] = node_id
    return storage.save_image_node(project_id, node)


@router.delete("/{project_id}/image-nodes/{node_id}")
def remove_image_node(project_id: str, node_id: str):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    storage.delete_image_node(project_id, node_id)
    return {"ok": True}


@router.get("/{project_id}/image-nodes/manifest")
def get_image_nodes_manifest(project_id: str):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    return storage.get_image_nodes_manifest(project_id)


class SetShotVersionBody(BaseModel):
    version: int  # 0-based index


@router.post("/{project_id}/image-nodes/{node_id}/shots/{shot_index}/set-version")
def set_shot_version(project_id: str, node_id: str, shot_index: int, body: SetShotVersionBody):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    storage.set_image_shot_version(project_id, node_id, shot_index, body.version)
    return {"ok": True}


class SetShotUrlBody(BaseModel):
    image_url: str  # any relative asset url


@router.patch("/{project_id}/image-nodes/{node_id}/shots/{shot_index}/url")
def set_shot_url(project_id: str, node_id: str, shot_index: int, body: SetShotUrlBody):
    """Set a shot's active image_url to any asset (picked from library, etc.)."""
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    storage.set_image_shot_url(project_id, node_id, shot_index, body.image_url)
    return {"ok": True}


class SetShotNarUrlBody(BaseModel):
    nar_url: str  # any relative audio asset url


@router.patch("/{project_id}/image-nodes/{node_id}/shots/{shot_index}/nar-url")
def set_shot_nar_url(project_id: str, node_id: str, shot_index: int, body: SetShotNarUrlBody):
    """Set a shot's active nar_url to any audio asset."""
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    storage.set_image_shot_nar_url(project_id, node_id, shot_index - 1, body.nar_url)
    return {"ok": True}


class SetShotTextBody(BaseModel):
    text: str


@router.patch("/{project_id}/image-nodes/{node_id}/shots/{shot_index}/text")
def set_shot_text(project_id: str, node_id: str, shot_index: int, body: SetShotTextBody):
    """Update the narration text for a specific shot."""
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    storage.set_image_shot_text(project_id, node_id, shot_index, body.text)
    return {"ok": True}


class GenerateShotTtsBody(BaseModel):
    text: str | None = None  # if provided, save this text first then generate TTS


@router.post("/{project_id}/image-nodes/{node_id}/shots/{shot_index}/generate-tts")
async def generate_shot_tts(project_id: str, node_id: str, shot_index: int, body: GenerateShotTtsBody = GenerateShotTtsBody()):
    """Regenerate TTS for a single shot (1-based shot_index). Optionally save new text first."""
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    # Save updated text if provided
    if body.text is not None:
        storage.set_image_shot_text(project_id, node_id, shot_index, body.text)

    image_nodes = storage.get_image_nodes(project_id)
    node = next((n for n in image_nodes if n["id"] == node_id), None)
    if not node:
        raise HTTPException(404, "Image node not found")
    shots = node.get("shots", [])
    idx = shot_index - 1
    if idx < 0 or idx >= len(shots):
        raise HTTPException(404, f"Shot {shot_index} not found")
    narration_text = (body.text or shots[idx].get("prompt", "")).strip()
    if not narration_text:
        raise HTTPException(400, "Shot has no narration text to speak")

    job = jobs_module.create_job(project_id, f"shot_tts_{node_id}_{shot_index}")

    from pipeline import image_story

    async def _fn(j):
        from config import MODEL_TTS, assets_dir, make_genai_client
        from google.genai import types
        adir = assets_dir(project_id)
        audio_dir = adir / "image_nodes" / node_id / "audio"
        audio_dir.mkdir(parents=True, exist_ok=True)

        tts_client = make_genai_client()
        j.progress = "Generating audio..."
        tts_response = await __import__("asyncio").to_thread(
            tts_client.models.generate_content,
            model=MODEL_TTS,
            contents=image_story._build_shot_narrator_prompt(narration_text),
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Sulafat")
                    )
                ),
            ),
        )
        if not tts_response.candidates:
            raise RuntimeError("TTS returned no candidates")
        audio_data = tts_response.candidates[0].content.parts[0].inline_data.data
        existing = list(audio_dir.glob(f"shot_{shot_index}_v*.wav"))
        audio_version = len(existing) + 1
        audio_path = audio_dir / f"shot_{shot_index}_v{audio_version}.wav"
        image_story._write_wav(audio_path, audio_data)
        rel_url = f"image_nodes/{node_id}/audio/shot_{shot_index}_v{audio_version}.wav"
        storage.record_image_shot_audio(project_id, node_id, shot_index, rel_url)
        j.result = {"nar_url": rel_url}
        j.progress = "Done"

    await jobs_module.run_job(job, _fn)
    return {"job_id": job.job_id}


class PlanShotsBody(BaseModel):
    story_text: str          # what you want to happen in this scene
    num_shots: int = 3       # how many shots to plan (capped at 3)
    append: bool = False     # True = append to existing shots; False = replace


@router.post("/{project_id}/image-nodes/{node_id}/plan-shots")
async def plan_shots(project_id: str, node_id: str, body: PlanShotsBody):
    """Use AI to plan narration lines for shots in this scene. Does not generate images."""
    import asyncio, os, json
    from config import MODEL_STORY

    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")

    image_nodes = storage.get_image_nodes(project_id)
    node = next((n for n in image_nodes if n["id"] == node_id), None)
    if not node:
        raise HTTPException(404, "Image node not found")

    num_shots = max(1, min(3, body.num_shots))
    story_data = storage.get_story_data(project_id) or {}
    story_title = story_data.get("title", "")
    story_summary = story_data.get("summary", "")
    scene_label = node.get("label", "Scene")
    story_prompt = node.get("story_prompt", "")

    # Build character context from story_data so AI writes consistent narration
    characters = story_data.get("characters", [])
    char_block = ""
    if characters:
        char_lines = []
        for c in characters:
            role = c.get("role", "")
            speech = c.get("speech_style", "")
            personality = c.get("personality", "")
            char_lines.append(f"- {c['name']} ({role}): {personality}. Speaks: {speech}.")
        char_block = "Characters in this story:\n" + "\n".join(char_lines) + "\n"

    # Note which characters are already in this node
    node_char_refs = node.get("character_refs", [])
    scene_chars = [c["name"] for c in characters if any(
        r in node_char_refs for r in [c["name"].lower().replace(" ", "_"), c["name"].lower()]
    )]
    scene_char_note = f"Characters appearing in this scene: {', '.join(scene_chars)}." if scene_chars else ""

    prompt = f"""You are a children's storybook writer planning narration lines for an illustrated scene.

Story: "{story_title}" — {story_summary}
{char_block}
Scene: "{scene_label}"
{scene_char_note}
Scene context: {story_prompt}

The user wants to add this story content to the scene:
\"\"\"{body.story_text}\"\"\"

Write exactly {num_shots} short narration/dialogue lines for this scene.
Each line will be spoken aloud by a narrator (TTS) and used as the caption for one illustrated shot.
Rules:
- Use the characters' names and stay true to their personality and speech style
- Each line: 1-2 warm, expressive sentences in picture-book style
- Lines should flow naturally as a sequence
- No camera directions, no stage directions — just the spoken prose

Respond with ONLY a JSON array of strings, one per shot:
["line 1", "line 2", "line 3"]"""

    try:
        import os
        from google import genai as _genai
        client = _genai.Client(api_key=os.getenv("GEMINI_API_KEY"), vertexai=False)
        resp = await asyncio.to_thread(
            client.models.generate_content,
            model=MODEL_STORY,
            contents=prompt,
        )
        raw = resp.text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        lines: list[str] = json.loads(raw.strip())
        lines = [l.strip() for l in lines if l.strip()][:num_shots]
    except Exception as e:
        raise HTTPException(500, f"AI planning failed: {e}")

    new_shots = [{"prompt": line, "image_url": "", "nar_url": None} for line in lines]

    # Update story_data.json
    path = __import__("config").project_dir(project_id) / "story_data.json"
    data = json.loads(path.read_text())
    for n in data.get("image_nodes", []):
        if n["id"] == node_id:
            existing = n.get("shots", []) if body.append else []
            n["shots"] = existing + new_shots
            n["num_shots"] = len(n["shots"])
            break
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))

    return {"shots": new_shots, "appended": body.append}


@router.post("/{project_id}/image-nodes/{node_id}/generate")
async def generate_image_node(project_id: str, node_id: str):
    if not storage.get_project(project_id):
        raise HTTPException(404, "Project not found")
    if not storage.get_story_data(project_id):
        raise HTTPException(404, "story_data.json not found")

    job = jobs_module.create_job(project_id, f"image_story_{node_id}")

    from pipeline import image_story

    async def _fn(j):
        await image_story.run(j, project_id, node_id)

    await jobs_module.run_job(job, _fn)
    return {"job_id": job.job_id}
