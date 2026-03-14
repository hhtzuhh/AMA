import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.genai import types

import storage
from routes.camera import subscribe_camera, unsubscribe_camera

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/projects", tags=["live"])

# Vertex AI native audio Live model
MODEL_LIVE = "gemini-live-2.5-flash-native-audio"


@router.websocket("/{project_id}/live/{node_id}")
async def live_session(websocket: WebSocket, project_id: str, node_id: str):
    await websocket.accept()

    story = storage.get_story_data(project_id)
    if not story:
        await websocket.close(code=1008, reason="Project not found")
        return

    live_node = next((n for n in story.get("live_nodes", []) if n["id"] == node_id), None)
    if not live_node:
        await websocket.close(code=1008, reason="Live node not found")
        return

    # Edges from this live node → available navigation targets
    all_edges = storage.get_edges(project_id)
    outgoing = [e for e in all_edges if str(e["from"]) == node_id]

    # Character persona
    char_name = live_node.get("character", "the storyteller")
    char_info = next((c for c in story.get("characters", []) if c["name"] == char_name), {})
    personality = char_info.get("personality", "")
    speech_style = char_info.get("speech_style", "")

    vision_enabled = live_node.get("vision", False)

    # Navigation options for the system prompt
    nav_lines = "\n".join(
        f'  - navigate_to(node_id="{e["to"]}") — {e.get("label") or "continue story"}'
        for e in outgoing
    ) or "  (no outgoing paths — end of story)"

    vision_section = (
        "\n\nYou can also SEE the child via a live camera (JPEG frames). "
        "Use what you observe to enrich conversation, but vision alone is never enough to trigger navigation."
    ) if vision_enabled else ""

    system_prompt = f"""You are {char_name} — a character in an interactive children's story.
{f"Personality: {personality}" if personality else ""}
{f"Speech style: {speech_style}" if speech_style else ""}
Keep responses short (1-2 sentences), warm, and age-appropriate. You ARE {char_name}, not an AI.{vision_section}

Your task: {live_node.get('system_prompt', 'Engage the child in a fun interactive moment.')}

If the child asks an off-topic question, answer briefly then gently re-invite the specific action.
After the child clearly completes the action, say one warm closing sentence — then call navigate_to.

Available routes:
{nav_lines}"""

    # Queue to signal navigation from tool → downstream task
    nav_queue: asyncio.Queue[str] = asyncio.Queue()
    # Gate: child must speak AFTER the most recent AI turn before navigate_to is allowed.
    # Resets every time the AI starts speaking, so each AI reply requires a fresh child response.
    child_spoke_after_ai = False

    def navigate_to(node_id: str) -> dict:
        """Advance the story to the next scene.

        Call this ONLY when the child has directly and clearly performed the specific
        action described in the matching route label — not for questions, greetings,
        or anything ambiguous. If unsure, keep talking and wait for a clearer response.

        Args:
            node_id: ID of the route whose condition the child just met.
        """
        if not child_spoke_after_ai:
            log.info("[live] navigate_to blocked — child hasn't responded yet: %s", node_id)
            return {"status": "waiting", "reason": "still waiting for child response"}
        log.info("[live] navigate_to called: %s", node_id)
        try:
            loop = asyncio.get_event_loop()
            loop.call_soon_threadsafe(nav_queue.put_nowait, node_id)
        except Exception as e:
            log.warning("[live] navigate_to queue error: %s", e)
        return {"status": "ok", "node_id": node_id}

    agent = LlmAgent(
        name="story_agent",
        model=MODEL_LIVE,
        instruction=system_prompt,
        tools=[navigate_to],
    )

    session_service = InMemorySessionService()
    runner = Runner(
        agent=agent,
        app_name="ama_live",
        session_service=session_service,
    )

    user_id = "child"
    session_id = f"{project_id}_{node_id}"
    await session_service.create_session(
        app_name="ama_live",
        user_id=user_id,
        session_id=session_id,
    )

    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
    )

    live_request_queue = LiveRequestQueue()

    # Kick the AI to speak first — Live API waits for input otherwise
    async def send_initial_prompt():
        await asyncio.sleep(0.5)  # small delay for session to settle
        content = types.Content(parts=[types.Part(text="[Session started. Greet the child and ask your question. Wait for the child to respond with audio. Do NOT call navigate_to yet.]")])
        live_request_queue.send_content(content)

    shutdown = asyncio.Event()

    async def upstream_task():
        nonlocal child_spoke_after_ai
        try:
            while True:
                message = await websocket.receive()
                if "bytes" in message:
                    if not child_spoke_after_ai:
                        child_spoke_after_ai = True
                        log.info("[live] child spoke — navigation unlocked for this turn")
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
                # Check if navigate_to was called
                if not nav_queue.empty():
                    nav_node = nav_queue.get_nowait()
                    log.info("[live] sending navigate to client: %s", nav_node)
                    await websocket.send_json({"type": "navigate", "node_id": nav_node})

                # Handle interruption — tell client to clear its audio buffer
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
                        # AI started a new audio turn — reset gate so child must speak again
                        if child_spoke_after_ai:
                            child_spoke_after_ai = False
                            log.info("[live] AI speaking — gate reset, waiting for child")
                        await websocket.send_bytes(inline.data)
                    txt = getattr(part, "text", None)
                    if txt:
                        await websocket.send_json({"type": "transcript", "text": txt})
        except WebSocketDisconnect:
            pass
        except Exception as e:
            if not shutdown.is_set():
                log.error("[live] downstream error: %s", e, exc_info=True)
                try:
                    await websocket.send_json({"type": "error", "message": str(e)})
                except Exception:
                    pass

    async def camera_vision_task():
        """Forward camera frames to Gemini Live as image/jpeg when vision is enabled."""
        if not vision_enabled:
            return
        cam_q = subscribe_camera(project_id)
        log.info("[live] vision enabled — subscribed to camera for project %s", project_id)
        try:
            while not shutdown.is_set():
                try:
                    frame = await asyncio.wait_for(cam_q.get(), timeout=1.0)
                    blob = types.Blob(mime_type="image/jpeg", data=frame)
                    live_request_queue.send_realtime(blob)
                except asyncio.TimeoutError:
                    pass  # no frame yet, keep waiting
        finally:
            unsubscribe_camera(project_id, cam_q)
            log.info("[live] vision task ended for project %s", project_id)

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
