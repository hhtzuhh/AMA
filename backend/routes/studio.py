"""
Studio — AI-powered story ingestion from plain text.

Flow:
  1. POST preview-style  → Gemini interleaved generates ONE scene image + style_guide string
  2. POST generate       → streams:
       a. Plan full story_data (title, summary, characters, image_nodes with shot prompts)
       b. Generate per-character portrait images → save refs/{slug}_ref.png
       c. Save image nodes (story_prompt + shot prompts for TTS)
       d. Auto-create linear edges
"""
import asyncio
import base64
import json
import logging
import os
import re
import time

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import storage
from config import MODEL_IMAGE_STORY, MODEL_STORY, assets_dir, project_dir

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/projects", tags=["studio"])


class PreviewRequest(BaseModel):
    story_text: str
    style_hints: str = ""


class GenerateRequest(BaseModel):
    story_text: str
    style_guide: str       # approved style from preview
    preview_b64: str = ""  # base64 of the preview image (used to seed character portraits)
    preview_mime: str = "image/png"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _char_slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def _strip_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


# ---------------------------------------------------------------------------
# 1. Style preview
# ---------------------------------------------------------------------------

@router.post("/{project_id}/studio/preview-style")
async def preview_style(project_id: str, body: PreviewRequest):
    """Generate a single sample image + extract style_guide."""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"), vertexai=False)

    style_clause = f"{body.style_hints}. " if body.style_hints else "Children's picture-book quality, painterly, warm. "
    prompt = f"""You are a children's storybook art director. I will give you a story excerpt and you will respond with exactly one cycle of:
1. A short style description paragraph (2-3 sentences) describing ONLY the visual art style — color palette, lighting mood, rendering technique, overall aesthetic. Do NOT describe individual characters or their appearance. Start the paragraph with "STYLE:".
2. A full illustrated image — a wide ESTABLISHING SHOT introducing the main characters and world. {style_clause}Cinematic wide angle. All main characters visible. No text, no labels.

Story excerpt:
"{body.story_text[:500]}"

Now output the style description text, then the illustration."""

    response = await asyncio.to_thread(
        client.models.generate_content,
        model=MODEL_IMAGE_STORY,
        contents=prompt,
        config=types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"]),
    )

    result: dict = {"style_guide": "", "image_b64": "", "image_mime": "image/png"}
    all_text_parts: list[str] = []
    for part in response.candidates[0].content.parts:
        is_thought = getattr(part, "thought", False)
        log.info("[studio] part: thought=%s has_text=%s has_image=%s text_preview=%r",
                 is_thought, bool(part.text), bool(getattr(part, "inline_data", None)),
                 (part.text or "")[:60])
        if part.text and not is_thought:
            all_text_parts.append(part.text.strip())
        elif part.inline_data and part.inline_data.data:
            result["image_b64"] = base64.b64encode(part.inline_data.data).decode()
            result["image_mime"] = part.inline_data.mime_type or "image/png"

    full_text = " ".join(all_text_parts)
    if "STYLE:" in full_text:
        result["style_guide"] = full_text.split("STYLE:", 1)[-1].strip()
    else:
        result["style_guide"] = full_text

    log.info("[studio] preview: style_guide=%r, has_image=%s", result["style_guide"][:80], bool(result["image_b64"]))
    return result


# ---------------------------------------------------------------------------
# 2. Full story generation (streaming SSE)
# ---------------------------------------------------------------------------

@router.post("/{project_id}/studio/generate")
async def generate_story(project_id: str, body: GenerateRequest):
    """
    Streams server-sent events:
      {"type": "plan", "title", "summary", "characters", "nodes"}
      {"type": "char_ref", "name", "slug"}        — character portrait saved
      {"type": "node_created", "node_id", "label"} — image node saved
      {"type": "done", "node_ids": [...]}
      {"type": "error", "message": ...}
    """
    if not storage.get_project(project_id):
        return {"error": "Project not found"}

    async def stream():
        from google import genai
        from google.genai import types

        img_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"), vertexai=False)
        text_client = img_client  # same client, different model

        # ── Step 1: Plan the full story_data ──────────────────────────────
        plan_prompt = f"""You are a children's interactive storybook designer.

Story to adapt:
\"\"\"
{body.story_text}
\"\"\"

Art style already approved: {body.style_guide}

Design the complete story structure. Respond with ONLY valid JSON, no markdown:
{{
  "title": "Story title",
  "summary": "1-2 sentence story summary",
  "characters": [
    {{
      "name": "Character name",
      "role": "Protagonist / Antagonist / Supporting",
      "personality": "2-3 adjectives describing personality",
      "speech_style": "How they speak (e.g. warm and gentle, gruff and short)",
      "visual_description": "Detailed visual description for consistent image generation",
      "emotions": ["idle", "happy", "angry"],
      "sprite_states": ["idle", "walking", "surprised"]
    }}
  ],
  "image_nodes": [
    {{
      "label": "Short scene title",
      "story_prompt": "Vivid scene description for the image generator (2-4 sentences). Include setting, character actions, mood.",
      "num_shots": 3,
      "shots": [
        {{"prompt": "Narration or dialogue line for this shot — spoken aloud, 1-2 sentences, picture-book style."}},
        {{"prompt": "Next line..."}},
        {{"prompt": "Next line..."}}
      ]
    }}
  ]
}}

Rules:
- 3–6 image_nodes depending on story length; scenes should feel like chapters of ONE continuous story
- num_shots must equal the number of shot objects in "shots"
- num_shots: 2 for short transitions, 3 for normal scenes, 4 for climax/action
- shot prompt = the exact line the narrator/character SAYS aloud — warm, expressive prose for TTS. This line also tells the image generator what moment to capture.
- story_prompt = scene atmosphere for the image generator: setting, environment, lighting, mood, time of day. 2-3 sentences MAX.
    * DO NOT describe characters — character appearance is handled by reference images
    * DO NOT prescribe camera angles — the image generator picks angles per shot
    * DO connect the scene to the story arc (e.g. "the tension is rising", "a moment of calm before the storm")
- Vary the emotional tone and pacing across nodes: mix action, dialogue, wonder, tension"""

        try:
            plan_resp = await asyncio.to_thread(
                text_client.models.generate_content,
                model=MODEL_STORY,
                contents=plan_prompt,
            )
            plan = json.loads(_strip_fences(plan_resp.text))
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': f'Planning failed: {e}'})}\n\n"
            return

        characters = plan.get("characters", [])
        nodes_plan = plan.get("nodes") or plan.get("image_nodes", [])
        title = plan.get("title", "Untitled Story")
        summary = plan.get("summary", "")

        yield f"data: {json.dumps({'type': 'plan', 'title': title, 'summary': summary, 'characters': characters, 'nodes': nodes_plan})}\n\n"

        # ── Step 2: Ensure story_data.json exists ─────────────────────────
        story_path = project_dir(project_id) / "story_data.json"
        if not story_path.exists():
            story_path.write_text(json.dumps({
                "title": title, "summary": summary,
                "best_scene_reference_page": 1,
                "characters": [], "pages": [], "edges": [], "image_nodes": [],
            }, indent=2))

        # Merge characters into story_data
        story = storage.get_story_data(project_id) or {}
        story["title"] = title
        story["summary"] = summary
        existing_names = {c.get("name") for c in story.get("characters", [])}
        for c in characters:
            if c["name"] not in existing_names:
                story.setdefault("characters", []).append({
                    "name": c["name"],
                    "role": c.get("role", "main"),
                    "personality": c.get("personality", ""),
                    "speech_style": c.get("speech_style", ""),
                    "visual_description": c.get("visual_description", ""),
                    "emotions": c.get("emotions", ["idle"]),
                    "best_reference_page": 1,
                    "sprite_states": c.get("sprite_states", ["idle"]),
                })
        story_path.write_text(json.dumps(story, indent=2, ensure_ascii=False))

        # ── Step 3: Generate character portrait refs ───────────────────────
        adir = assets_dir(project_id)
        refs_dir = adir / "refs"
        refs_dir.mkdir(parents=True, exist_ok=True)

        preview_parts = []
        if body.preview_b64:
            try:
                preview_bytes = base64.b64decode(body.preview_b64)
                preview_parts = [types.Part.from_bytes(data=preview_bytes, mime_type=body.preview_mime)]
            except Exception:
                pass

        for char in characters:
            slug = _char_slug(char["name"])
            ref_path = refs_dir / f"{slug}_ref.png"
            if ref_path.exists():
                continue  # don't overwrite existing refs

            portrait_prompt_parts = preview_parts + [types.Part.from_text(
                text=f"""Art style: {body.style_guide}

Draw a clean full-body CHARACTER PORTRAIT of {char['name']} only:
{char.get('visual_description', char['name'])}

IMPORTANT: Use a SOLID BRIGHT GREEN background (#00FF00). No gradients, no shadows.
Full body visible, centered. No other characters. No text overlays.
Same art style as the reference image."""
            )]

            try:
                char_resp = await asyncio.to_thread(
                    img_client.models.generate_content,
                    model=MODEL_IMAGE_STORY,
                    contents=portrait_prompt_parts,
                    config=types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"]),
                )
                for part in char_resp.candidates[0].content.parts:
                    if part.inline_data and part.inline_data.data:
                        # Remove green background with rembg (isnet-anime model)
                        try:
                            from rembg import remove, new_session
                            import io as _io
                            from PIL import Image as _Image
                            rembg_session = new_session("isnet-anime")
                            rgba = remove(part.inline_data.data, session=rembg_session)
                            img = _Image.open(_io.BytesIO(rgba)).convert("RGBA")
                            buf = _io.BytesIO()
                            img.save(buf, format="PNG")
                            ref_path.write_bytes(buf.getvalue())
                        except Exception as rembg_err:
                            log.warning("[studio] rembg failed, saving raw: %s", rembg_err)
                            ref_path.write_bytes(part.inline_data.data)
                        log.info("[studio] saved char ref: %s", ref_path)
                        yield f"data: {json.dumps({'type': 'char_ref', 'name': char['name'], 'slug': slug})}\n\n"
                        break
            except Exception as e:
                log.warning("[studio] char portrait failed for %s: %s", char["name"], e)
                yield f"data: {json.dumps({'type': 'char_ref_error', 'name': char['name'], 'message': str(e)})}\n\n"
            await asyncio.sleep(0)

        # ── Step 4: Save image nodes ───────────────────────────────────────
        # Character consistency comes from ref images — visual_description stays on characters only.
        # story_prompt = art style + scene description only.
        char_slugs = [_char_slug(c["name"]) for c in characters]

        created_ids: list[str] = []
        for i, node in enumerate(nodes_plan):
            node_id = f"img_{int(time.time() * 1000) + i}"

            full_prompt = f"Art style: {body.style_guide}. {node['story_prompt']}"

            # Build shots from plan (prompt = TTS narration line)
            shots = [
                {"prompt": s.get("prompt", ""), "image_url": "", "nar_url": None}
                for s in node.get("shots", [])
            ]

            image_node = {
                "id": node_id,
                "label": node.get("label", f"Scene {i + 1}"),
                "story_prompt": full_prompt,
                "character_refs": char_slugs,
                "background_refs": [],
                "ken_burns": True,
                "num_shots": len(shots) or node.get("num_shots", 3),
                "shots": shots,
            }
            storage.save_image_node(project_id, image_node)
            created_ids.append(node_id)
            yield f"data: {json.dumps({'type': 'node_created', 'node_id': node_id, 'label': image_node['label']})}\n\n"
            await asyncio.sleep(0)

        # ── Step 5: Auto-create linear edges ──────────────────────────────
        if len(created_ids) > 1:
            new_edges = [
                {"from": created_ids[i], "to": created_ids[i + 1], "label": ""}
                for i in range(len(created_ids) - 1)
            ]
            existing_edges = storage.get_edges(project_id)
            storage.save_edges(project_id, existing_edges + new_edges)

        yield f"data: {json.dumps({'type': 'done', 'node_ids': created_ids})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# 3. Regenerate a single character portrait
# ---------------------------------------------------------------------------

class RegenCharRequest(BaseModel):
    style_guide: str
    visual_description: str = ""
    preview_b64: str = ""
    preview_mime: str = "image/png"


@router.post("/{project_id}/studio/characters/{char_slug}/regenerate")
async def regenerate_char(project_id: str, char_slug: str, body: RegenCharRequest):
    """Re-generate the portrait ref image for one character."""
    from google import genai
    from google.genai import types

    if not storage.get_project(project_id):
        return {"error": "Project not found"}

    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"), vertexai=False)
    adir = assets_dir(project_id)
    refs_dir = adir / "refs"
    refs_dir.mkdir(parents=True, exist_ok=True)
    ref_path = refs_dir / f"{char_slug}_ref.png"

    preview_parts = []
    if body.preview_b64:
        try:
            preview_parts = [types.Part.from_bytes(
                data=base64.b64decode(body.preview_b64), mime_type=body.preview_mime
            )]
        except Exception:
            pass

    portrait_parts = preview_parts + [types.Part.from_text(
        text=f"""Art style: {body.style_guide}

Draw a clean full-body CHARACTER PORTRAIT of this character only:
{body.visual_description or char_slug}

IMPORTANT: Use a SOLID BRIGHT GREEN background (#00FF00). No gradients, no shadows.
Full body visible, centered. No other characters. No text overlays.
Same art style as the reference image."""
    )]

    try:
        resp = await asyncio.to_thread(
            client.models.generate_content,
            model=MODEL_IMAGE_STORY,
            contents=portrait_parts,
            config=types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"]),
        )
        for part in resp.candidates[0].content.parts:
            if part.inline_data and part.inline_data.data:
                try:
                    from rembg import remove, new_session
                    import io as _io
                    from PIL import Image as _Image
                    rembg_session = new_session("isnet-anime")
                    rgba = remove(part.inline_data.data, session=rembg_session)
                    img = _Image.open(_io.BytesIO(rgba)).convert("RGBA")
                    buf = _io.BytesIO()
                    img.save(buf, format="PNG")
                    ref_path.write_bytes(buf.getvalue())
                except Exception as rembg_err:
                    log.warning("[studio] rembg failed: %s", rembg_err)
                    ref_path.write_bytes(part.inline_data.data)
                log.info("[studio] regenerated char ref: %s", ref_path)
                return {"slug": char_slug, "url": f"refs/{char_slug}_ref.png"}
        return {"error": "No image returned"}
    except Exception as e:
        log.error("[studio] char regen failed: %s", e)
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# 4. Create a brand-new character (plan + portrait)
# ---------------------------------------------------------------------------

class CreateCharRequest(BaseModel):
    name: str
    description: str          # free-text: who they are, what they look like, personality
    style_guide: str = ""     # art style to match existing scenes
    preview_b64: str = ""
    preview_mime: str = "image/png"


@router.post("/{project_id}/studio/characters/create")
async def create_character(project_id: str, body: CreateCharRequest):
    """Plan full character data via AI then generate portrait ref image."""
    from google import genai
    from google.genai import types

    if not storage.get_project(project_id):
        return {"error": "Project not found"}

    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"), vertexai=False)

    # Step 1: Use text model to flesh out character fields
    from config import MODEL_STORY
    text_client = client  # reuse the same vertexai=False client

    plan_prompt = f"""You are a children's storybook character designer.
Create a complete character profile for: "{body.name}"
Description: {body.description}

Respond with ONLY valid JSON:
{{
  "name": "{body.name}",
  "role": "Protagonist / Antagonist / Supporting",
  "personality": "2-3 adjectives",
  "speech_style": "How they speak",
  "visual_description": "Detailed visual description for consistent image generation — appearance, clothing, distinctive features",
  "emotions": ["idle", "happy", "surprised"],
  "sprite_states": ["idle", "walking", "talking"]
}}"""

    try:
        plan_resp = await asyncio.to_thread(
            text_client.models.generate_content,
            model=MODEL_STORY,
            contents=plan_prompt,
        )
        char_data = json.loads(_strip_fences(plan_resp.text))
    except Exception as e:
        return {"error": f"Character planning failed: {e}"}

    final_name = char_data.get("name", body.name)
    slug = _char_slug(final_name)

    # Save character to story_data.json
    story_path = project_dir(project_id) / "story_data.json"
    if story_path.exists():
        story = json.loads(story_path.read_text())
    else:
        story = {"characters": []}

    existing_names = {c.get("name") for c in story.get("characters", [])}
    if final_name not in existing_names:
        story.setdefault("characters", []).append({
            "name": final_name,
            "role": char_data.get("role", "Supporting"),
            "personality": char_data.get("personality", ""),
            "speech_style": char_data.get("speech_style", ""),
            "visual_description": char_data.get("visual_description", body.description),
            "emotions": char_data.get("emotions", ["idle"]),
            "best_reference_page": 1,
            "sprite_states": char_data.get("sprite_states", ["idle"]),
        })
        story_path.write_text(json.dumps(story, indent=2, ensure_ascii=False))

    # Step 2: Generate portrait ref image
    adir = assets_dir(project_id)
    refs_dir = adir / "refs"
    refs_dir.mkdir(parents=True, exist_ok=True)
    ref_path = refs_dir / f"{slug}_ref.png"

    preview_parts = []
    if body.preview_b64:
        try:
            preview_parts = [types.Part.from_bytes(
                data=base64.b64decode(body.preview_b64), mime_type=body.preview_mime
            )]
        except Exception:
            pass

    style_clause = f"Art style: {body.style_guide}\n\n" if body.style_guide else ""
    portrait_parts = preview_parts + [types.Part.from_text(
        text=f"""{style_clause}Draw a clean full-body CHARACTER PORTRAIT of {body.name} only:
{char_data.get('visual_description', body.description)}

IMPORTANT: Use a SOLID BRIGHT GREEN background (#00FF00). No gradients, no shadows.
Full body visible, centered. No other characters. No text overlays."""
    )]

    try:
        resp = await asyncio.to_thread(
            client.models.generate_content,
            model=MODEL_IMAGE_STORY,
            contents=portrait_parts,
            config=types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"]),
        )
        for part in resp.candidates[0].content.parts:
            if part.inline_data and part.inline_data.data:
                try:
                    from rembg import remove, new_session
                    import io as _io
                    from PIL import Image as _Image
                    rembg_session = new_session("isnet-anime")
                    rgba = remove(part.inline_data.data, session=rembg_session)
                    img = _Image.open(_io.BytesIO(rgba)).convert("RGBA")
                    buf = _io.BytesIO()
                    img.save(buf, format="PNG")
                    ref_path.write_bytes(buf.getvalue())
                except Exception as rembg_err:
                    log.warning("[studio] rembg failed: %s", rembg_err)
                    ref_path.write_bytes(part.inline_data.data)
                log.info("[studio] created char ref: %s", ref_path)
                return {
                    "slug": slug,
                    "name": final_name,
                    "character": char_data,
                    "ref_url": f"refs/{slug}_ref.png",
                }
        return {"error": "No portrait image returned"}
    except Exception as e:
        log.error("[studio] char create portrait failed: %s", e)
        return {"error": str(e)}
