"""
Dream Node — Live voice interaction + automatic image generation + auto-navigation.

Flow:
1. Gemini chats with the child to discover what object they want to use.
2. When the child gives a clear answer, Gemini calls generate_dream(child_said, description).
   The tool returns immediately. Gemini keeps the child engaged while images generate.
3. Background task generates 3-scene storyboard, streams to frontend.
4. Backend auto-sends navigate message. Frontend autoplays slides then navigates.
5. Gemini has NO navigate_to tool — navigation is entirely backend-driven.
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
    voice_prompt = dream_node.get("voice_prompt") or "Ask the child to pick a magical object to help in the story. When they choose, call generate_dream."

    vision_section = (
        "\n\nYou can SEE the child via live camera. React to what they hold up."
    ) if vision_enabled else ""

    system_prompt = f"""You are {char_name} — a magical character in an interactive children's story.
{f"Personality: {personality}" if personality else ""}
{f"Speech style: {speech_style}" if speech_style else ""}
Keep responses short (1-2 sentences), warm, and age-appropriate. You ARE {char_name}, not an AI.
RESPOND IN ENGLISH. YOU MUST RESPOND UNMISTAKABLY IN ENGLISH regardless of what language the child uses.{vision_section}

RULES:
1. Ask ONE question at a time, then stop and wait for the child's answer.
2. NEVER call generate_dream in the same turn you ask a question.
3. generate_dream requires child_said — quote the child's actual words. Never invent them.
4. After calling generate_dream, the magic takes time to paint (~30 seconds). Keep the child excited and talking — ask them what they imagine, what the hero will do, how the magic feels. Ask ONE question at a time and genuinely react to their answers. Do NOT announce outcomes or say who wins.
5. The story will advance automatically when the images are ready. You do NOT control navigation. Once the storyboard is shown, your task is COMPLETE — do NOT ask about another object.

Your task: {voice_prompt}"""

    loop = asyncio.get_running_loop()
    nav_node_id = str(outgoing[0]["to"]) if outgoing else None
    shutdown = asyncio.Event()
    latest_camera_frame: list[bytes | None] = [None]

    # Preload reference images once
    from google import genai as _genai
    img_client = _genai.Client(api_key=os.getenv("GEMINI_API_KEY"), vertexai=False)
    adir = assets_dir(project_id)

    # Keep char and bg refs separate — interleaved generation is reliable only with 1 ref image per call
    char_ref_parts: list = []
    for slug in dream_node.get("character_refs", []):
        ref_path = adir / "refs" / f"{slug}_ref.png"
        if ref_path.exists():
            char_ref_parts.append(types.Part.from_bytes(data=ref_path.read_bytes(), mime_type="image/png"))
    bg_ref_parts: list = []
    for bg_url in dream_node.get("background_refs", []):
        bg_path = adir / bg_url
        if bg_path.exists():
            mime = "image/png" if bg_path.suffix == ".png" else "image/jpeg"
            bg_ref_parts.append(types.Part.from_bytes(data=bg_path.read_bytes(), mime_type=mime))

    async def _ws_send(msg: dict) -> None:
        if not shutdown.is_set():
            try:
                await websocket.send_json(msg)
            except Exception:
                pass

    async def _generate_image(description: str) -> str:
        """Single interleaved call — 1 ref image, 1 narration sentence + 1 illustration."""
        cam_frame = latest_camera_frame[0]
        cam_parts: list = []
        cam_note = ""
        if cam_frame:
            cam_parts = [types.Part.from_bytes(data=cam_frame, mime_type="image/jpeg")]
            cam_note = (
                "The last image is a CAMERA SNAPSHOT of the physical object the child holds — "
                "incorporate it faithfully as their chosen item.\n\n"
            )

        # Single ref image only — experiment confirmed >1 ref silently drops text
        scene_ref = [char_ref_parts[0]] if char_ref_parts else []
        ref_note = "The reference image shows the primary character — maintain their appearance.\n\n" if scene_ref else ""

        prompt_text = (
            f"{ref_note}{cam_note}"
            f"Child's input: \"{description}\"\n\n"
            f"{image_prompt}\n\n"
            f"Write ONE narration sentence describing this magical moment. "
            f"Then generate ONE illustration of the scene.\n\n"
            f"OUTPUT ORDER: write the sentence first, then generate the illustration.\n"
            f"ABSOLUTELY NO TEXT, letters, captions, or labels inside the illustration."
        )
        contents = scene_ref + cam_parts + [types.Part.from_text(text=prompt_text)]
        gen_config = types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"])

        if shutdown.is_set():
            return ""

        await _ws_send({"type": "dream_start", "description": description})

        log.info("[dream] generating scene (ref=%d, cam=%d)", len(scene_ref), len(cam_parts))
        response = await asyncio.to_thread(
            img_client.models.generate_content,
            model=MODEL_IMAGE_STORY,
            contents=contents,
            config=gen_config,
        )

        if shutdown.is_set():
            return ""

        # Guard against empty/blocked response
        candidates = response.candidates or []
        parts = []
        if candidates:
            content = getattr(candidates[0], "content", None)
            parts = getattr(content, "parts", None) or []
        if not parts:
            log.warning("[dream] empty response from image model: %s", response)
            await _ws_send({"type": "dream_error", "message": "The magic couldn't paint the story this time. Please try again."})
            return ""

        # Send text first (creates panel), then image — dedup in case model repeats text
        narration_text = ""
        seen_texts: set[str] = set()
        has_text = False
        for part in parts:
            if part.text:
                t = part.text.strip()
                if t and t not in seen_texts:
                    seen_texts.add(t)
                    narration_text += t + " "
                    log.info("[dream] text: %r", t[:80])
                    await _ws_send({"type": "dream_text", "text": t})
                    has_text = True
            elif part.inline_data and part.inline_data.data:
                if not has_text:
                    log.warning("[dream] image arrived before text — inserting fallback panel")
                    await _ws_send({"type": "dream_text", "text": "…"})
                log.info("[dream] image: %s %db", part.inline_data.mime_type, len(part.inline_data.data))
                img_b64 = base64.b64encode(part.inline_data.data).decode()
                await _ws_send({"type": "dream_image", "data": img_b64, "mime": part.inline_data.mime_type})

        narration_text = narration_text.strip()

        # Inject narration immediately so Gemini reads it while the image is on screen
        if narration_text:
            live_request_queue.send_content(types.Content(parts=[types.Part(text=(
                f"[Read this narration aloud right now in character, with feeling: \"{narration_text}\"]"
            ))]))

        await _ws_send({"type": "dream_done"})
        if nav_node_id:
            await _ws_send({"type": "navigate", "node_id": nav_node_id, "auto": True})
        return narration_text

    is_generating = [False]
    dream_queue: asyncio.Queue[str] = asyncio.Queue()

    _UNCERTAINTY = ("don't know", "not sure", "what do", "what should", "i don't", "i'm not", "huh", "um", "uh")

    def generate_dream(child_said: str, description: str) -> dict:
        """Start generating a magical 3-scene storyboard. Returns immediately.

        **Invocation Condition:** Invoke this tool ONLY AFTER the child has clearly stated
        what object they want to use, in their own words. Never invent child_said.
        Do NOT call this in the same turn you asked a question — ask, then wait for their answer.

        After calling this tool, keep the child engaged with warm, excited conversation
        ("I can feel the magic swirling!", "What do you think will happen?").
        Do NOT announce the outcome. Do NOT say who wins. The images tell the story.

        Args:
            child_said: The child's exact spoken words. Must be a clear choice, not a question.
            description: Full scene — child's object, all characters, the action.
        """
        cs = child_said.strip().lower()
        if not cs or len(cs) < 2:
            return {"status": "wait", "message": "child_said is empty. Ask the child what they want to use and wait for their answer."}
        if cs.startswith("[") or cs.endswith("]"):
            return {"status": "wait", "message": "No clear audio from child. Ask them to speak and wait for their answer."}
        if "?" in child_said:
            return {"status": "wait", "message": "The child asked a question, not a choice. Ask again and wait for their answer."}
        if any(u in cs for u in _UNCERTAINTY):
            return {"status": "wait", "message": "The child hasn't chosen yet. Encourage them warmly and wait for a clear answer."}
        if is_generating[0]:
            return {"status": "busy", "message": "The adventure is already underway! Keep the child engaged while the story plays — do not call this again."}

        log.info("[dream] generate_dream queued child_said=%r  desc=%s", child_said, description[:60])
        is_generating[0] = True
        loop.call_soon_threadsafe(dream_queue.put_nowait, description)
        return {
            "status": "generating",
            "message": "The magical storyboard is being painted! Keep the child engaged — ask what they imagine, how they feel. Do NOT announce the outcome. The story advances automatically when the images are ready.",
        }

    def navigate_to(node_id: str) -> dict:  # noqa: ARG001
        """Navigation is handled automatically — do not call this.

        The story advances on its own after the images are shown.
        You do NOT need to call this function. Ever.

        Args:
            node_id: Ignored — navigation is automatic.
        """
        log.warning("[dream] Gemini called navigate_to (hallucination) — absorbed")
        return {"status": "automatic", "message": "Navigation is automatic. You do not need to call this. Keep chatting with the child."}

    agent = LlmAgent(
        name="dream_agent",
        model=MODEL_LIVE,
        instruction=system_prompt,
        tools=[generate_dream, navigate_to],
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

                if content and content.parts:
                    for part in content.parts:
                        fc = getattr(part, "function_call", None)
                        fr = getattr(part, "function_response", None)
                        txt = getattr(part, "text", None)
                        if fc:
                            log.info("[dream] >> TOOL CALL: %s(%s)", fc.name, fc.args)
                        elif fr:
                            log.info("[dream] >> TOOL RESPONSE: %s = %s", fr.name, str(fr.response)[:120])
                        elif txt:
                            log.info("[dream] >> TEXT: %r", txt[:100])

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

    async def dream_generation_task():
        while not shutdown.is_set():
            try:
                description = await asyncio.wait_for(dream_queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            if shutdown.is_set():
                is_generating[0] = False
                continue
            log.info("[dream] *** GENERATING: %s", description[:80])

            _engage_prompts = [
                "[Ask the child one short excited question — like 'What do you think the magic looks like?' or 'Can you feel the adventure coming?']",
                "[Say something encouraging — like 'The magic is almost ready!' or 'Your hero is SO powerful!' Keep it to one sentence.]",
                "[React to what the child said, then ask 'Are you ready to see your hero in action?' Keep it short and warm.]",
                "[Say 'Almost there!' and ask the child what they think will happen. One sentence only.]",
            ]

            async def _engagement_loop():
                """Inject engagement prompts every ~8s while image is generating."""
                idx = 0
                await asyncio.sleep(7)  # first nudge after 7s (Gemini already spoke from tool response)
                while not shutdown.is_set():
                    live_request_queue.send_content(types.Content(parts=[types.Part(text=_engage_prompts[idx % len(_engage_prompts)])]))
                    idx += 1
                    await asyncio.sleep(8)

            try:
                gen_task = asyncio.create_task(_generate_image(description))
                eng_task = asyncio.create_task(_engagement_loop())
                try:
                    narration = await gen_task
                finally:
                    eng_task.cancel()
                    try:
                        await eng_task
                    except asyncio.CancelledError:
                        pass

                if not narration:
                    is_generating[0] = False
                    continue
                log.info("[dream] *** DONE narration=%r", narration[:80])
                # is_generating stays True — prevents re-triggering
                # Narration was already injected inside _generate_image — no second injection needed
            except Exception as e:
                log.error("[dream] generation error: %s", e, exc_info=True)
                is_generating[0] = False
                try:
                    await websocket.send_json({"type": "dream_error", "message": str(e)})
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
            dream_generation_task(),
            camera_vision_task(),
            return_exceptions=True,
        )
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
