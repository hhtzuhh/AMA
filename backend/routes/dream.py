"""
Dream Node — Live voice interaction + blocking image generation.

Flow:
1. Gemini Live talks to the child, guided by voice_prompt.
2. When Gemini calls generate_dream(), the async tool BLOCKS — ADK awaits it.
   Gemini cannot call any other tool until generate_dream returns.
3. Image streams to the frontend overlay. Narration text is returned as the tool result.
4. Gemini receives the narration in the tool response and reads it aloud, then continues.
5. Only after generate_dream returns can Gemini call navigate_to.
"""
import asyncio
import base64
import json
import logging
import os

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.genai import types

import storage
from config import MODEL_IMAGE_STORY, assets_dir
from routes.camera import subscribe_camera, unsubscribe_camera

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/projects", tags=["dream"])

MODEL_LIVE = "gemini-live-2.5-flash-native-audio"


@router.websocket("/{project_id}/dream/{node_id}")
async def dream_session(websocket: WebSocket, project_id: str, node_id: str):
    await websocket.accept()

    story = storage.get_story_data(project_id)
    if not story:
        await websocket.close(code=1008, reason="Project not found")
        return

    dream_node = next((n for n in story.get("dream_nodes", []) if n["id"] == node_id), None)
    if not dream_node:
        await websocket.close(code=1008, reason="Dream node not found")
        return

    all_edges = storage.get_edges(project_id)
    outgoing = [e for e in all_edges if str(e["from"]) == node_id]

    char_name = dream_node.get("character", "the storyteller")
    char_info = next((c for c in story.get("characters", []) if c["name"] == char_name), {})
    personality = char_info.get("personality", "")
    speech_style = char_info.get("speech_style", "")
    vision_enabled = dream_node.get("vision", False)

    image_prompt = dream_node.get("image_prompt") or "A magical illustrated moment. Art style: rich painterly illustration, warm storybook colors, soft light."
    voice_prompt = dream_node.get("voice_prompt") or "Invite the child to imagine something magical. When they describe it, call generate_dream."

    nav_lines = "\n".join(
        f'  - navigate_to(node_id="{e["to"]}") — {e.get("label") or "continue story"}'
        for e in outgoing
    ) or "  (no outgoing paths — end of story)"

    vision_section = (
        "\n\nYou can SEE the child via live camera. Use what you observe to react to what they hold up."
    ) if vision_enabled else ""

    system_prompt = f"""You are {char_name} — a magical character in an interactive children's story.
{f"Personality: {personality}" if personality else ""}
{f"Speech style: {speech_style}" if speech_style else ""}
Keep responses short (1-2 sentences), warm, and age-appropriate. You ARE {char_name}, not an AI.{vision_section}

STRICT RULES:
1. Ask ONE question. Then STOP TALKING and wait for the child to answer.
2. NEVER call generate_dream in the same turn you ask a question. Ask, then wait.
3. generate_dream requires child_said — you MUST quote the child's actual words. Never invent them.
4. generate_dream BLOCKS until the image is ready. When it returns, read the narration aloud. Do NOT call navigate_to before generate_dream returns.
5. Only call navigate_to after generate_dream has returned AND you have read the narration aloud. Use exact node_id from routes.

Your task: {voice_prompt}
Call generate_dream ONLY after the child has spoken their answer. Call navigate_to ONLY after generate_dream returns with the narration and you have read it aloud.

Available routes:
{nav_lines}"""

    loop = asyncio.get_running_loop()
    nav_queue: asyncio.Queue[str] = asyncio.Queue()
    shutdown = asyncio.Event()
    latest_camera_frame: list[bytes | None] = [None]

    # Preload reference images once
    from google import genai as _genai
    img_client = _genai.Client(api_key=os.getenv("GEMINI_API_KEY"), vertexai=False)
    adir = assets_dir(project_id)

    ref_parts: list = []
    ref_lines: list[str] = []
    for slug in dream_node.get("character_refs", []):
        ref_path = adir / "refs" / f"{slug}_ref.png"
        if ref_path.exists():
            ref_parts.append(types.Part.from_bytes(data=ref_path.read_bytes(), mime_type="image/png"))
    if ref_parts:
        ref_lines.append(f"The first {len(ref_parts)} image(s) are CHARACTER REFERENCE images — keep their appearance consistent.")
    bg_count = 0
    for bg_url in dream_node.get("background_refs", []):
        bg_path = adir / bg_url
        if bg_path.exists():
            mime = "image/png" if bg_path.suffix == ".png" else "image/jpeg"
            ref_parts.append(types.Part.from_bytes(data=bg_path.read_bytes(), mime_type=mime))
            bg_count += 1
    if bg_count:
        ref_lines.append(f"The next {bg_count} image(s) are BACKGROUND/SETTING REFERENCE images — use this environment and color palette.")
    ref_block = "\n".join(ref_lines)

    async def _generate_image(description: str) -> str:
        """Generate image, stream parts to frontend, return narration text."""
        cam_frame = latest_camera_frame[0]
        cam_parts: list = []
        cam_note = ""
        if cam_frame:
            cam_parts = [types.Part.from_bytes(data=cam_frame, mime_type="image/jpeg")]
            cam_note = (
                "\n\nThe last image above is a CAMERA SNAPSHOT of the physical object the child is "
                "holding in the real world. Incorporate it faithfully as their chosen item in the scene."
            )

        prompt_text = (
            f"{ref_block}{cam_note}\n\n"
            f"Child's input: \"{description}\"\n\n"
            f"{image_prompt}\n\n"
            f"OUTPUT FORMAT — follow this exactly:\n"
            f"1. First output 1-2 sentences of warm picture-book narration as plain text.\n"
            f"2. Then output one illustration.\n"
            f"ABSOLUTELY NO TEXT in the image — no subtitles, captions, labels, or letters anywhere in the illustration."
        )
        contents = ref_parts + cam_parts + [types.Part.from_text(text=prompt_text)]
        gen_config = types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"])

        await websocket.send_json({"type": "dream_start", "description": description})

        narration_text = ""
        response = await asyncio.to_thread(
            img_client.models.generate_content,
            model=MODEL_IMAGE_STORY,
            contents=contents,
            config=gen_config,
        )
        for part in response.candidates[0].content.parts:
            if part.text:
                narration_text += part.text
                log.info("[dream] sending dream_text: %r", part.text[:80])
                await websocket.send_json({"type": "dream_text", "text": part.text})
            elif part.inline_data and part.inline_data.data:
                log.info("[dream] sending dream_image: %s %db", part.inline_data.mime_type, len(part.inline_data.data))
                img_b64 = base64.b64encode(part.inline_data.data).decode()
                await websocket.send_json({
                    "type": "dream_image",
                    "data": img_b64,
                    "mime": part.inline_data.mime_type,
                })

        await websocket.send_json({"type": "dream_done"})
        return narration_text.strip()

    valid_node_ids = {str(e["to"]) for e in outgoing}

    _UNCERTAINTY = ("don't know", "not sure", "what do", "what should", "i don't", "i'm not", "huh", "um", "uh")

    async def generate_dream(child_said: str, description: str) -> dict:
        """Generate a magical illustrated scene. Blocks until the image and narration are ready.

        **Invocation Condition:** Invoke this tool ONLY AFTER the child has verbally responded
        with a clear, specific choice in their own words. You MUST hear the child's actual answer
        first — never call this in the same turn you asked a question, and never invent child_said.
        Say one warm sentence ("I'll conjure it now!") before calling, then go completely silent.
        This tool will block — do NOT call navigate_to until AFTER this tool returns.

        Args:
            child_said: The child's exact spoken words stating their choice. Must be a clear
                        statement (not a question or uncertainty). Never fabricate this value.
            description: Full scene — child's object, all characters, the action.
        """
        cs = child_said.strip().lower()
        if not cs or len(cs) < 2:
            return {"status": "wait", "message": "child_said is empty. Ask the child what they want to use and wait for their answer."}
        if "?" in child_said:
            return {"status": "wait", "message": "The child asked a question, not a choice. Ask again and wait."}
        if any(u in cs for u in _UNCERTAINTY):
            return {"status": "wait", "message": "The child hasn't chosen yet. Encourage them gently, then wait."}

        log.info("[dream] *** GENERATING (blocking): child_said=%r  desc=%s", child_said, description[:60])
        try:
            narration = await _generate_image(description)
            log.info("[dream] *** DONE narration=%r", (narration or '')[:80])
        except Exception as e:
            log.error("[dream] generation error: %s", e, exc_info=True)
            try:
                await websocket.send_json({"type": "dream_error", "message": str(e)})
            except Exception:
                pass
            return {"status": "error", "message": "Image generation failed. Continue the story without the image."}

        return {
            "status": "done",
            "narration": narration,
            "instruction": f'Read this narration aloud to the child, word for word: "{narration}". Then continue your task.',
        }

    def navigate_to(node_id: str) -> dict:
        """Advance the story to the next scene.

        **Invocation Condition:** Invoke this tool ONLY AFTER generate_dream has returned
        (status: done) AND you have read the narration aloud to the child.
        You MUST use one of the exact node_id values listed in the available routes.

        Args:
            node_id: Exact ID from the available routes list.
        """
        if valid_node_ids and node_id not in valid_node_ids:
            log.warning("[dream] navigate_to rejected invalid node_id=%r (valid: %s)", node_id, valid_node_ids)
            return {"status": "error", "message": f"Invalid node_id '{node_id}'. Valid options: {list(valid_node_ids)}"}
        log.info("[dream] navigate_to: %s", node_id)
        try:
            loop.call_soon_threadsafe(nav_queue.put_nowait, node_id)
        except Exception as e:
            log.warning("[dream] navigate_to queue error: %s", e)
        return {"status": "ok", "node_id": node_id}

    agent = LlmAgent(
        name="dream_agent",
        model=MODEL_LIVE,
        instruction=system_prompt,
        tools=[navigate_to, generate_dream],
    )

    session_service = InMemorySessionService()
    runner = Runner(agent=agent, app_name="ama_dream", session_service=session_service)

    user_id = "child"
    session_id = f"{project_id}_{node_id}"
    await session_service.create_session(app_name="ama_dream", user_id=user_id, session_id=session_id)

    run_config = RunConfig(streaming_mode=StreamingMode.BIDI)
    live_request_queue = LiveRequestQueue()

    async def send_initial_prompt():
        await asyncio.sleep(0.5)
        content = types.Content(parts=[types.Part(text=(
            "[Session started. Greet the child in character and begin your task. "
            "Do NOT call any tool yet — wait for the child to respond first.]"
        ))])
        live_request_queue.send_content(content)

    async def upstream_task():
        try:
            while True:
                message = await websocket.receive()
                if "bytes" in message:
                    blob = types.Blob(mime_type="audio/pcm;rate=16000", data=message["bytes"])
                    live_request_queue.send_realtime(blob)
                elif "text" in message:
                    data = json.loads(message["text"])
                    if data.get("type") == "close":
                        break
        except WebSocketDisconnect:
            pass
        finally:
            shutdown.set()
            live_request_queue.close()

    async def downstream_task():
        try:
            async for event in runner.run_live(
                user_id=user_id,
                session_id=session_id,
                live_request_queue=live_request_queue,
                run_config=run_config,
            ):
                content = getattr(event, "content", None)
                server_content = getattr(event, "server_content", None)
                interrupted = getattr(event, "interrupted", None) or (
                    server_content and getattr(server_content, "interrupted", False)
                )

                # Log only meaningful events (skip pure audio chunks)
                if content and content.parts:
                    for part in content.parts:
                        fc = getattr(part, "function_call", None)
                        fr = getattr(part, "function_response", None)
                        txt = getattr(part, "text", None)
                        inline = getattr(part, "inline_data", None)
                        if fc:
                            log.info("[dream] >> TOOL CALL: %s(%s)", fc.name, fc.args)
                        elif fr:
                            log.info("[dream] >> TOOL RESPONSE: %s = %s", fr.name, str(fr.response)[:120])
                        elif txt:
                            log.info("[dream] >> TEXT: %r", txt[:100])
                        elif inline:
                            log.debug("[dream] >> AUDIO chunk: %s %db", inline.mime_type, len(inline.data or b''))

                # Flush navigation only when not blocked inside generate_dream
                if not nav_queue.empty():
                    nav_node = nav_queue.get_nowait()
                    await websocket.send_json({"type": "navigate", "node_id": nav_node})

                if interrupted:
                    await websocket.send_json({"type": "interrupted"})
                    continue

                if not content or not content.parts:
                    continue
                for part in content.parts:
                    inline = getattr(part, "inline_data", None)
                    if inline and inline.data:
                        await websocket.send_bytes(inline.data)
                    txt = getattr(part, "text", None)
                    if txt:
                        await websocket.send_json({"type": "transcript", "text": txt})
        except WebSocketDisconnect:
            pass
        except Exception as e:
            if not shutdown.is_set():
                log.error("[dream] downstream error: %s", e, exc_info=True)
                try:
                    await websocket.send_json({"type": "error", "message": str(e)})
                except Exception:
                    pass

    async def camera_vision_task():
        if not vision_enabled:
            return
        cam_q = subscribe_camera(project_id)
        try:
            while not shutdown.is_set():
                try:
                    frame = await asyncio.wait_for(cam_q.get(), timeout=1.0)
                    latest_camera_frame[0] = frame
                    blob = types.Blob(mime_type="image/jpeg", data=frame)
                    live_request_queue.send_realtime(blob)
                except asyncio.TimeoutError:
                    pass
        finally:
            unsubscribe_camera(project_id, cam_q)

    try:
        await asyncio.gather(
            send_initial_prompt(),
            upstream_task(),
            downstream_task(),
            camera_vision_task(),
            return_exceptions=True,
        )
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
