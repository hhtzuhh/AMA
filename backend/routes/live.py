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

    # Navigation options for the system prompt
    nav_lines = "\n".join(
        f'  - navigate_to(node_id="{e["to"]}") — {e.get("label") or "continue story"}'
        for e in outgoing
    ) or "  (no outgoing paths — end of story)"

    system_prompt = f"""**Persona:**
You are {char_name} — a character in an interactive children's storybook.
Personality: {personality}
Speech style: {speech_style}
Speak directly to the child. Keep every response short (1-2 sentences), warm, and age-appropriate.

**Conversational Rules:**
1. Immediately greet the child warmly and begin the interaction described below.
2. {live_node.get('system_prompt', 'Engage the child in a fun interactive moment.')}
3. Listen and watch carefully for the child's response. Give them 5-10 seconds to respond before gently prompting again. If the child asks a question or says something unrelated, answer briefly and re-invite the specific action you are waiting for. Do NOT navigate yet.
4. ONLY after you have unmistakably observed the child completing the specific action — say a warm, complete closing sentence to the child first, THEN call navigate_to exactly once. Never call navigate_to mid-sentence or before you have finished speaking.

**Tool invocation — navigate_to:**
Each path has a specific condition. You may ONLY call navigate_to when the child's response is an unmistakable, direct match to one of the conditions below.
If the child's response does NOT clearly match any condition — keep the conversation going, re-invite the action, and wait for a clearer response. Never guess or pick the closest match.
Available paths:
{nav_lines}
Do NOT call navigate_to for questions, greetings, or anything unrelated to the conditions above.
Do NOT mention the function call to the child.

**Guardrails:**
- Never scare or pressure the child. Stay playful and encouraging at all times.
- If the child seems confused or shy, offer gentle encouragement before deciding which path to take.
- Keep the magic of the story alive — you ARE {char_name}, not an AI."""

    # Queue to signal navigation from tool → downstream task
    nav_queue: asyncio.Queue[str] = asyncio.Queue()
    # Turn-based gate: only allow navigation after AI finishes a turn AND child speaks after it
    ai_turn_complete = False      # AI has finished speaking at least once
    child_spoke_after_ai = False  # Child sent audio AFTER the AI's last turn

    def navigate_to(node_id: str) -> dict:
        """Advance the story to the next node.

        **Invocation condition:** Call this tool ONLY when the child's response
        unmistakably and specifically matches the condition described in one of the
        available path labels. Do NOT call this if the child said something unrelated,
        asked a question, or gave an ambiguous response. If the response does not
        clearly fit any path label, keep the conversation going — do not guess.

        Args:
            node_id: The node_id whose path label best matches what the child just did.
        """
        if not child_spoke_after_ai:
            log.info("[live] navigate_to blocked (child has not responded after AI turn): %s", node_id)
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
                    if ai_turn_complete and not child_spoke_after_ai:
                        child_spoke_after_ai = True
                        log.info("[live] child spoke after AI turn — navigation unlocked")
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
        nonlocal ai_turn_complete, child_spoke_after_ai
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
                        if not ai_turn_complete:
                            ai_turn_complete = True
                            log.info("[live] AI started speaking — child response will unlock navigation")
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

    try:
        await asyncio.gather(send_initial_prompt(), upstream_task(), downstream_task(), return_exceptions=True)
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
