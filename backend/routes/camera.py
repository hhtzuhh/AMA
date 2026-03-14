"""
Camera relay — streams JPEG frames from a phone to any viewer (theater display).

Phone  →  WS /camera/{project_id}/send  →  backend  →  WS /camera/{project_id}/view  →  Display

Internal subscribers (e.g. live.py) can register asyncio.Queues via subscribe_camera().
"""
import asyncio
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

log = logging.getLogger("routes.camera")

router = APIRouter(prefix="/api/projects", tags=["camera"])

# project_id → active sender WebSocket (one phone per project)
_senders: dict[str, WebSocket] = {}
# project_id → set of viewer WebSockets
_viewers: dict[str, set[WebSocket]] = {}
# project_id → set of internal asyncio.Queues (for live sessions)
_internal_queues: dict[str, set[asyncio.Queue]] = {}


def subscribe_camera(project_id: str) -> "asyncio.Queue[bytes]":
    """Register an internal queue to receive JPEG frames for this project."""
    q: asyncio.Queue[bytes] = asyncio.Queue(maxsize=3)
    _internal_queues.setdefault(project_id, set()).add(q)
    return q


def unsubscribe_camera(project_id: str, q: "asyncio.Queue[bytes]") -> None:
    """Remove a previously registered internal queue."""
    _internal_queues.get(project_id, set()).discard(q)


@router.websocket("/{project_id}/camera/send")
async def camera_send(ws: WebSocket, project_id: str):
    """Phone connects here and sends raw JPEG bytes."""
    await ws.accept()
    _senders[project_id] = ws
    viewers = _viewers.setdefault(project_id, set())
    log.info("Camera sender connected: %s", project_id)
    try:
        while True:
            frame = await ws.receive_bytes()
            # Broadcast to WebSocket viewers, drop dead connections
            dead: set[WebSocket] = set()
            for viewer in list(viewers):
                try:
                    await viewer.send_bytes(frame)
                except Exception:
                    dead.add(viewer)
            viewers -= dead

            # Dispatch to internal subscribers (live sessions), drop old frames if full
            for q in list(_internal_queues.get(project_id, set())):
                try:
                    q.put_nowait(frame)
                except asyncio.QueueFull:
                    pass  # drop frame rather than block
    except WebSocketDisconnect:
        pass
    finally:
        _senders.pop(project_id, None)
        log.info("Camera sender disconnected: %s", project_id)


@router.websocket("/{project_id}/camera/view")
async def camera_view(ws: WebSocket, project_id: str):
    """Display connects here and receives JPEG frames."""
    await ws.accept()
    viewers = _viewers.setdefault(project_id, set())
    viewers.add(ws)
    log.info("Camera viewer connected: %s (total: %d)", project_id, len(viewers))
    try:
        # Just keep the connection alive; frames come from the sender task
        while True:
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        pass
    finally:
        viewers.discard(ws)
        log.info("Camera viewer disconnected: %s", project_id)


@router.get("/{project_id}/camera/status")
def camera_status(project_id: str):
    return {"connected": project_id in _senders}
