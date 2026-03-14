"""
Pipeline: Image Story Node Generation
Generates a multi-shot illustrated sequence using Gemini's interleaved image generation.

Flow:
1. Load character refs from assets/refs/{slug}_ref.png
2. Load background refs from any project asset path
3. Send a single interleaved prompt: AI outputs (narration text + image) × N
4. Save images to assets/image_nodes/{node_id}/shot_N_vV.{ext} (versioned)
5. Run TTS on each shot's narration text → assets/image_nodes/{node_id}/audio/shot_N_vV.wav
6. Persist shots list (with nar_url) to story_data.json
"""
import asyncio
import logging
import os
import wave
from pathlib import Path

log = logging.getLogger("pipeline.image_story")

from config import MODEL_IMAGE_STORY, MODEL_TTS, assets_dir, make_genai_client
from jobs import Job
import storage


async def run(job: Job, project_id: str, node_id: str) -> None:
    image_nodes = storage.get_image_nodes(project_id)
    node = next((n for n in image_nodes if n["id"] == node_id), None)
    if not node:
        raise ValueError(f"Image node {node_id} not found in story_data.json")

    story_prompt = node.get("story_prompt", node.get("story_text", "")).strip()
    char_refs = node.get("character_refs", [])
    bg_refs = node.get("background_refs", [])
    num_shots = max(1, min(3, node.get("num_shots", 3)))
    # Pre-planned narration lines written during studio ingestion — these are the TTS lines.
    # We preserve them and only fill in image_url after generation.
    planned_shots = node.get("shots", [])
    planned_narrations = [s.get("prompt", "").strip() for s in planned_shots]

    # Story-level context for continuity across nodes
    story_data = storage.get_story_data(project_id) or {}
    story_title = story_data.get("title", "")
    story_summary = story_data.get("summary", "")
    all_nodes = storage.get_image_nodes(project_id)
    scene_index = next((i for i, n in enumerate(all_nodes) if n["id"] == node_id), 0)
    total_scenes = len(all_nodes)
    prev_label = all_nodes[scene_index - 1].get("label", "") if scene_index > 0 else ""
    next_label = all_nodes[scene_index + 1].get("label", "") if scene_index < total_scenes - 1 else ""

    adir = assets_dir(project_id)
    out_dir = adir / "image_nodes" / node_id
    audio_dir = out_dir / "audio"
    out_dir.mkdir(parents=True, exist_ok=True)
    audio_dir.mkdir(parents=True, exist_ok=True)

    from google import genai
    from google.genai import types

    # gemini-3-pro-image-preview is Google AI Studio only.
    # vertexai=False overrides the GOOGLE_GENAI_USE_VERTEXAI env var.
    img_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"), vertexai=False)
    tts_client = make_genai_client()  # uses Vertex AI or Studio based on env

    job.progress = "Loading reference images..."

    # --- Load character reference images ---
    import re as _re
    def _normalize_slug(s: str) -> str:
        return _re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")

    char_parts: list = []
    seen_slugs: set = set()
    for slug in char_refs:
        normalized = _normalize_slug(slug)
        if normalized in seen_slugs:
            log.info("Skipping duplicate char ref slug: %s", slug)
            continue
        seen_slugs.add(normalized)
        ref_path = adir / "refs" / f"{normalized}_ref.png"
        if ref_path.exists():
            char_parts.append(types.Part.from_bytes(
                data=ref_path.read_bytes(),
                mime_type="image/png",
            ))
            log.info("Loaded character ref: %s", ref_path.name)
        else:
            log.warning("Character ref not found: %s", ref_path)

    # --- Load background reference images ---
    bg_parts: list = []
    for bg_url in bg_refs:
        bg_path = adir / bg_url
        if bg_path.exists():
            mime = _guess_mime(bg_path)
            bg_parts.append(types.Part.from_bytes(
                data=bg_path.read_bytes(),
                mime_type=mime,
            ))
            log.info("Loaded background ref: %s", bg_path.name)
        else:
            log.warning("Background ref not found: %s", bg_path)

    job.progress = f"Generating {num_shots}-shot sequence..."
    log.info("Generating %d shots for image node %s", num_shots, node_id)

    # --- Build the prompt ---
    ref_lines = []
    if char_parts:
        ref_lines.append(
            f"The first {len(char_parts)} image(s) provided are CHARACTER REFERENCE images. "
            "Preserve the characters' exact appearance (costume, colors, facial features) in every shot."
        )
    if bg_parts:
        ref_lines.append(
            f"The next {len(bg_parts)} image(s) are BACKGROUND/SETTING REFERENCE images. "
            "Use this environment, color palette, and lighting style throughout."
        )

    ref_block = "\n".join(ref_lines)

    # story_prompt = "Art style: ... scene description" — no character text (ref images handle that)
    scene_label = node.get("label", "Scene")

    # Story arc context so the model knows where this scene sits in the full narrative
    arc_parts = [f"This is scene {scene_index+1} of {total_scenes}: \"{scene_label}\"."]
    if prev_label:
        arc_parts.append(f"Previous scene: \"{prev_label}\".")
    if next_label:
        arc_parts.append(f"Next scene: \"{next_label}\".")
    arc_line = " ".join(arc_parts)

    story_header = ""
    if story_title or story_summary:
        story_header = f"Story: \"{story_title}\" — {story_summary}\n"

    # Per-shot blocks — narration line is the primary driver for each image
    shot_lines = []
    for i in range(num_shots):
        narr = planned_narrations[i] if i < len(planned_narrations) and planned_narrations[i] else ""
        shot_lines.append(f"Shot {i+1}: \"{narr}\"" if narr else f"Shot {i+1}: (illustrate the scene)")
    shots_block = "\n".join(shot_lines)

    prompt_text = f"""{ref_block}

{story_header}{arc_line}

You are a cinematic children's picture-book illustrator creating storyboard frames.
{story_prompt}

The character reference images above define exactly how every character looks — trust them, do not override with text descriptions.

Generate exactly {num_shots} illustrated shots. Each shot illustrates ONE narration line.
Choose the camera angle that best serves that line's emotional moment:
- Quiet / intimate line → close-up or medium shot
- Arrival / action → wide establishing shot
- Tense confrontation → Dutch angle, low angle, or over-shoulder
Vary angles across shots so the sequence feels like a movie, not a slideshow.

Respond with exactly {num_shots} cycles of:
1. Copy the narration line exactly (one line).
2. ONE single full-frame illustration for that shot — one image per cycle.

CRITICAL: Each image must be a SINGLE full-bleed illustration of ONE moment.
NEVER combine multiple shots into one image. NEVER create comic panels, grids, or collages.
Every image is a standalone cinematic frame, like a movie still.

{shots_block}

No text overlays. No labels. No borders. No panel dividers."""

    contents = char_parts + bg_parts + [types.Part.from_text(text=prompt_text)]
    config = types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
    )

    try:
        response = await asyncio.to_thread(
            img_client.models.generate_content,
            model=MODEL_IMAGE_STORY,
            contents=contents,
            config=config,
        )
    except Exception as e:
        log.error("Gemini API error during image story generation: %s", e)
        raise

    # --- Parse interleaved response ---
    shots = []
    image_count = 0

    for part in response.candidates[0].content.parts:
        if getattr(part, "thought", False):
            continue
        if part.inline_data:
            image_count += 1
            mime = part.inline_data.mime_type or "image/png"
            ext = mime.split("/")[-1] if "/" in mime else "png"
            if ext == "jpeg":
                ext = "jpg"
            # Versioned filename — never overwrite existing shots
            existing = list(out_dir.glob(f"shot_{image_count}_v*.{ext}"))
            version = len(existing) + 1
            img_path = out_dir / f"shot_{image_count}_v{version}.{ext}"
            img_path.write_bytes(part.inline_data.data)
            rel_url = f"image_nodes/{node_id}/shot_{image_count}_v{version}.{ext}"
            shot_idx = image_count - 1
            narration = planned_narrations[shot_idx] if shot_idx < len(planned_narrations) else ""
            shots.append({"prompt": narration, "image_url": rel_url, "nar_url": None})
            storage.record_image_shot(project_id, node_id, image_count, rel_url, narration)
            # Only update image_url — do not touch prompt (upstream TTS line) or nar_url
            storage.set_image_shot_url(project_id, node_id, image_count, rel_url)
            job.emit({"type": "shot", "status": "image_done", "shot": image_count, "url": rel_url})
            job.progress = f"Shot {image_count} / {num_shots} — image done, generating audio..."
            log.info("Shot %d v%d saved → %s", image_count, version, img_path)

    if not shots:
        raise RuntimeError(
            "No images were returned by the model. "
            "Check that MODEL_IMAGE_STORY supports response_modalities=[IMAGE] and that refs are valid."
        )

    # --- Fill in any missing shots individually (model sometimes stops early with 4+ shots) ---
    missing = [i for i in range(num_shots) if i >= len(shots)]
    if missing:
        log.warning("Model only returned %d/%d images, filling missing shots individually: %s",
                    len(shots), num_shots, missing)
        fill_config = types.GenerateContentConfig(response_modalities=["IMAGE"])
        for shot_idx in missing:
            shot_num = shot_idx + 1
            narration = planned_narrations[shot_idx] if shot_idx < len(planned_narrations) else ""
            fill_prompt = f"""{ref_block}

{story_header}{arc_line}
{story_prompt}

The character reference images above define exactly how every character looks.
Generate ONE single full-bleed cinematic illustration for this story moment:
\"{narration}\"
No text overlays. No borders."""
            try:
                fill_resp = await asyncio.to_thread(
                    img_client.models.generate_content,
                    model=MODEL_IMAGE_STORY,
                    contents=char_parts + bg_parts + [types.Part.from_text(text=fill_prompt)],
                    config=fill_config,
                )
                img_data = next(
                    (p.inline_data.data for p in fill_resp.candidates[0].content.parts if p.inline_data),
                    None,
                )
                if img_data:
                    mime = next(
                        (p.inline_data.mime_type for p in fill_resp.candidates[0].content.parts if p.inline_data),
                        "image/jpeg",
                    )
                    ext = (mime.split("/")[-1] if "/" in mime else "jpg").replace("jpeg", "jpg")
                    existing = list(out_dir.glob(f"shot_{shot_num}_v*.{ext}"))
                    version = len(existing) + 1
                    img_path = out_dir / f"shot_{shot_num}_v{version}.{ext}"
                    img_path.write_bytes(img_data)
                    rel_url = f"image_nodes/{node_id}/shot_{shot_num}_v{version}.{ext}"
                    shots.append({"prompt": narration, "image_url": rel_url, "nar_url": None})
                    storage.record_image_shot(project_id, node_id, shot_num, rel_url, narration)
                    storage.set_image_shot_url(project_id, node_id, shot_num, rel_url)
                    job.emit({"type": "shot", "status": "image_done", "shot": shot_num, "url": rel_url})
                    log.info("Fill shot %d v%d saved → %s", shot_num, version, img_path)
            except Exception as e:
                log.warning("Fill shot %d failed: %s", shot_num, e)
            await asyncio.sleep(0)

    # --- Run TTS for each shot's narration ---
    log.info("Running TTS for %d shots...", len(shots))
    for i, shot in enumerate(shots):
        shot_num = i + 1
        narration_text = shot.get("prompt", "").strip()
        if not narration_text:
            log.warning("Shot %d has no narration text, skipping TTS", shot_num)
            continue

        job.progress = f"Generating audio for shot {shot_num} / {len(shots)}..."
        try:
            tts_response = await asyncio.to_thread(
                tts_client.models.generate_content,
                model=MODEL_TTS,
                contents=_build_shot_narrator_prompt(narration_text),
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Sulafat")
                        )
                    ),
                ),
            )
            if tts_response.candidates:
                audio_data = tts_response.candidates[0].content.parts[0].inline_data.data
                existing_audio = list(audio_dir.glob(f"shot_{shot_num}_v*.wav"))
                audio_version = len(existing_audio) + 1
                audio_path = audio_dir / f"shot_{shot_num}_v{audio_version}.wav"
                _write_wav(audio_path, audio_data)
                rel_audio_url = f"image_nodes/{node_id}/audio/shot_{shot_num}_v{audio_version}.wav"
                shot["nar_url"] = rel_audio_url
                storage.record_image_shot_audio(project_id, node_id, shot_num, rel_audio_url)
                job.emit({"type": "shot", "status": "audio_done", "shot": shot_num, "nar_url": rel_audio_url})
                log.info("Shot %d audio v%d saved → %s", shot_num, audio_version, audio_path)
        except Exception as e:
            log.warning("TTS failed for shot %d: %s", shot_num, e)
            # Non-fatal — continue without audio for this shot

    # Do not bulk-replace shots — image_url and nar_url are updated per-shot above,
    # preserving the upstream prompt (TTS narration line) set during studio ingestion.
    job.result = {"shots": len(shots), "node_id": node_id}
    job.progress = f"Done — {len(shots)} shots generated"
    log.info("Image node %s complete: %d shots", node_id, len(shots))


def _build_shot_narrator_prompt(text: str) -> str:
    return f"""# AUDIO PROFILE: The Narrator
## "Children's Story Time"

### DIRECTOR'S NOTES
Style: Warm, gentle, storytelling grandparent. Inviting and expressive —
bring the scene to life with subtle emotion. Not theatrical, just alive.
Pace: Unhurried. Let the words breathe.
Tone: Soft but clear.

#### TRANSCRIPT
{text}"""


def _write_wav(path: Path, pcm_data: bytes, sample_rate: int = 24000) -> None:
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_data)


def _guess_mime(path: Path) -> str:
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }.get(path.suffix.lower(), "image/png")
