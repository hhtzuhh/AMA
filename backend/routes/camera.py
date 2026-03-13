"""
Camera relay — streams JPEG frames from a phone to any viewer (theater display).

Phone  →  WS /camera/{project_id}/send  →  backend  →  WS /camera/{project_id}/view  →  Display
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
            # Broadcast to all viewers, drop dead connections
            dead: set[WebSocket] = set()
            for viewer in list(viewers):
                try:
                    await viewer.send_bytes(frame)
                except Exception:
                    dead.add(viewer)
            viewers -= dead
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
