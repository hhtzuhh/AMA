"""
Dream Node — Live voice interaction + on-demand interleaved image generation.

Flow:
1. Gemini Live talks to the child (voice in/out), guided by the node's system_prompt.
2. When Gemini decides the moment is right it calls generate_dream(description).
3. Backend calls Gemini interleaved (TEXT+IMAGE) with character/background refs.
4. Results stream back to the frontend as dream_text / dream_image / dream_done messages.
5. After generation, Gemini may call navigate_to to advance the story.
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

    nav_lines = "\n".join(
        f'  - navigate_to(node_id="{e["to"]}") — {e.get("label") or "continue story"}'
        for e in outgoing
    ) or "  (no outgoing paths — end of story)"

    vision_section = (
        "\n\nYou can also SEE the child via a live camera (JPEG frames). "
        "Use what you observe to enrich conversation and generation prompts."
    ) if vision_enabled else ""

    system_prompt = f"""You are {char_name} — a magical character in an interactive children's story.
{f"Personality: {personality}" if personality else ""}
{f"Speech style: {speech_style}" if speech_style else ""}
Keep responses short (1-2 sentences), warm, and age-appropriate. You ARE {char_name}, not an AI.{vision_section}

Your task: {dream_node.get('system_prompt', 'Invite the child to imagine something magical. When they describe it clearly, call generate_dream.')}

When the child has described what they want to create or imagine, call generate_dream with a vivid description.
After generate_dream returns, tell the child something warm about what appeared, then call navigate_to if appropriate.

Available routes:
{nav_lines}"""

    nav_queue: asyncio.Queue[str] = asyncio.Queue()
    deferred_nav_queue: asyncio.Queue[str] = asyncio.Queue()  # holds nav requests while generating
    dream_queue: asyncio.Queue[str] = asyncio.Queue()
    child_spoke_after_ai = False
    dream_generating = False  # True while interleaved generation is running
    shutdown = asyncio.Event()

    def navigate_to(node_id: str) -> dict:
        """Advance the story to the next scene.

        Call this ONLY when the child has clearly completed the required action.
        Do not call for questions or ambiguous responses.

        Args:
            node_id: ID of the matching route.
        """
        if not child_spoke_after_ai:
            return {"status": "waiting", "reason": "still waiting for child response"}
        log.info("[dream] navigate_to: %s (generating=%s)", node_id, dream_generating)
        try:
            loop = asyncio.get_event_loop()
            # If generation is in progress, defer navigation until after dream_done
            target_queue = deferred_nav_queue if dream_generating else nav_queue
            loop.call_soon_threadsafe(target_queue.put_nowait, node_id)
        except Exception as e:
            log.warning("[dream] navigate_to queue error: %s", e)
        return {"status": "ok", "node_id": node_id}

    def generate_dream(description: str) -> dict:
        """Generate a magical illustrated moment based on the child's imagination.

        Call this when the child has described what they want to create or see.
        The system will generate a picture-book image and narration that appears on screen.

        Args:
            description: A vivid description of what the child wants to imagine or create.
        """
        log.info("[dream] generate_dream triggered: %s", description)
        try:
            loop = asyncio.get_event_loop()
            loop.call_soon_threadsafe(dream_queue.put_nowait, description)
        except Exception as e:
            log.warning("[dream] dream_queue error: %s", e)
        return {"status": "generating", "description": description}

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
        content = types.Content(parts=[types.Part(text="[Session started. Greet the child warmly and invite them to imagine something. Do NOT call any tool yet.]")])
        live_request_queue.send_content(content)

    async def upstream_task():
        nonlocal child_spoke_after_ai
        try:
            while True:
                message = await websocket.receive()
                if "bytes" in message:
                    if not child_spoke_after_ai:
                        child_spoke_after_ai = True
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
        nonlocal child_spoke_after_ai
        try:
            async for event in runner.run_live(
                user_id=user_id,
                session_id=session_id,
                live_request_queue=live_request_queue,
                run_config=run_config,
            ):
                if not nav_queue.empty():
                    nav_node = nav_queue.get_nowait()
                    await websocket.send_json({"type": "navigate", "node_id": nav_node})

                server_content = getattr(event, "server_content", None)
                interrupted = getattr(event, "interrupted", None) or (
                    server_content and getattr(server_content, "interrupted", False)
                )
                if interrupted:
                    await websocket.send_json({"type": "interrupted"})
                    continue

                if not event.content or not event.content.parts:
                    continue
                for part in event.content.parts:
                    inline = getattr(part, "inline_data", None)
                    if inline and inline.data:
                        if child_spoke_after_ai:
                            child_spoke_after_ai = False
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
        """Handles generate_dream tool calls — runs interleaved generation and streams results."""
        from google import genai

        img_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"), vertexai=False)
        adir = assets_dir(project_id)

        # Preload character and background reference images
        char_refs = dream_node.get("character_refs", [])
        bg_refs = dream_node.get("background_refs", [])

        ref_parts: list = []
        ref_lines: list[str] = []
        for slug in char_refs:
            ref_path = adir / "refs" / f"{slug}_ref.png"
            if ref_path.exists():
                ref_parts.append(types.Part.from_bytes(data=ref_path.read_bytes(), mime_type="image/png"))
        if ref_parts:
            ref_lines.append(f"The first {len(ref_parts)} image(s) are CHARACTER REFERENCE images — keep their appearance consistent.")

        bg_count = 0
        for bg_url in bg_refs:
            bg_path = adir / bg_url
            if bg_path.exists():
                mime = "image/png" if bg_path.suffix == ".png" else "image/jpeg"
                ref_parts.append(types.Part.from_bytes(data=bg_path.read_bytes(), mime_type=mime))
                bg_count += 1
        if bg_count:
            ref_lines.append(f"The next {bg_count} image(s) are BACKGROUND/SETTING REFERENCE images — use this environment and color palette.")

        ref_block = "\n".join(ref_lines)

        while not shutdown.is_set():
            try:
                description = await asyncio.wait_for(dream_queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue

            nonlocal dream_generating
            dream_generating = True
            log.info("[dream] generating interleaved image for: %s", description)
            await websocket.send_json({"type": "dream_start", "description": description})

            prompt_text = f"""{ref_block}

A child just said: "{description}"

You are a children's picture book illustrator and narrator.
Write 1-2 sentences of warm, magical picture-book narration about this moment.
Then draw one beautiful illustration showing this magical scene.
Art style: rich painterly illustration, warm storybook colors, soft light. No text overlays."""

            contents = ref_parts + [types.Part.from_text(text=prompt_text)]
            config = types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"])

            try:
                response = await asyncio.to_thread(
                    img_client.models.generate_content,
                    model=MODEL_IMAGE_STORY,
                    contents=contents,
                    config=config,
                )
                for part in response.candidates[0].content.parts:
                    if part.text:
                        await websocket.send_json({"type": "dream_text", "text": part.text})
                    elif part.inline_data and part.inline_data.data:
                        img_b64 = base64.b64encode(part.inline_data.data).decode()
                        await websocket.send_json({
                            "type": "dream_image",
                            "data": img_b64,
                            "mime": part.inline_data.mime_type,
                        })
            except Exception as e:
                log.error("[dream] interleaved generation error: %s", e, exc_info=True)
                await websocket.send_json({"type": "dream_error", "message": str(e)})

            dream_generating = False
            await websocket.send_json({"type": "dream_done"})

            # Flush any navigation that was deferred while generating
            while not deferred_nav_queue.empty():
                nav_node = deferred_nav_queue.get_nowait()
                log.info("[dream] flushing deferred navigate: %s", nav_node)
                await websocket.send_json({"type": "navigate", "node_id": nav_node})

    async def camera_vision_task():
        if not vision_enabled:
            return
        cam_q = subscribe_camera(project_id)
        try:
            while not shutdown.is_set():
                try:
                    frame = await asyncio.wait_for(cam_q.get(), timeout=1.0)
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
