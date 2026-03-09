"""
Storage layer — local filesystem now, GCS later.
"""
import json
import shutil
from datetime import datetime
from pathlib import Path

from config import project_dir, assets_dir, OUTPUT_DIR


def list_projects() -> list[dict]:
    projects = []
    for p in sorted(OUTPUT_DIR.iterdir(), reverse=True):
        if not p.is_dir():
            continue
        meta = _read_meta(p)
        projects.append(meta)
    return projects


def create_project(project_id: str, pdf_name: str) -> dict:
    pdir = project_dir(project_id)
    pdir.mkdir(parents=True, exist_ok=True)
    for sub in ["assets/sprites", "assets/scenes", "assets/audio", "assets/refs"]:
        (pdir / sub).mkdir(parents=True, exist_ok=True)

    meta = {
        "project_id": project_id,
        "pdf_name": pdf_name,
        "pipeline": {
            "story": "pending",
            "assets": "pending",
            "background": "pending",
            "tts": "pending",
        },
        "pages": {},        # keyed by str(page_num)
        "characters": {},   # keyed by char_slug
    }
    _write_meta(pdir, meta)
    return meta


def get_project(project_id: str) -> dict | None:
    pdir = project_dir(project_id)
    if not pdir.exists():
        return None
    return _read_meta(pdir)


def update_pipeline_status(project_id: str, step: str, status: str) -> None:
    pdir = project_dir(project_id)
    meta = _read_meta(pdir)
    meta["pipeline"][step] = status
    _write_meta(pdir, meta)


def save_story_data(project_id: str, data: dict) -> None:
    path = project_dir(project_id) / "story_data.json"
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    # Initialize page and character tracking in meta
    _init_asset_tracking(project_id, data)


def get_story_data(project_id: str) -> dict | None:
    path = project_dir(project_id) / "story_data.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


def save_pdf(project_id: str, content: bytes, filename: str) -> Path:
    path = project_dir(project_id) / filename
    path.write_bytes(content)
    return path


def get_asset_path(project_id: str, relative: str) -> Path:
    return assets_dir(project_id) / relative


def asset_exists(project_id: str, relative: str) -> bool:
    return get_asset_path(project_id, relative).exists()


def record_sprite(project_id: str, char_slug: str, state: str, url: str) -> None:
    """Record a generated sprite version in meta.json."""
    pdir = project_dir(project_id)
    meta = _read_meta(pdir)
    chars = meta.setdefault("characters", {})
    char = chars.setdefault(char_slug, {"sprites": {}})
    sprites = char.setdefault("sprites", {})
    entry = sprites.setdefault(state, {"current": 0, "versions": []})
    entry["versions"].append({"url": url, "created_at": datetime.utcnow().isoformat()})
    entry["current"] = len(entry["versions"]) - 1
    _write_meta(pdir, meta)


def record_background(project_id: str, page_num: int, url: str) -> None:
    """Record a generated background video version in meta.json."""
    pdir = project_dir(project_id)
    meta = _read_meta(pdir)
    pages = meta.setdefault("pages", {})
    page = pages.setdefault(str(page_num), {"enabled": True})
    entry = page.setdefault("background", {"current": 0, "versions": []})
    entry["versions"].append({"url": url, "created_at": datetime.utcnow().isoformat()})
    entry["current"] = len(entry["versions"]) - 1
    _write_meta(pdir, meta)


def record_narration(project_id: str, page_num: int, url: str) -> None:
    """Record a generated narration audio version in meta.json."""
    pdir = project_dir(project_id)
    meta = _read_meta(pdir)
    pages = meta.setdefault("pages", {})
    page = pages.setdefault(str(page_num), {"enabled": True})
    entry = page.setdefault("narration", {"current": 0, "versions": []})
    entry["versions"].append({"url": url, "created_at": datetime.utcnow().isoformat()})
    entry["current"] = len(entry["versions"]) - 1
    _write_meta(pdir, meta)


def set_current_version(project_id: str, kind: str, version: int,
                        char: str = "", state: str = "", page: int = 0) -> None:
    """Update the active version index for a sprite, background, or narration."""
    pdir = project_dir(project_id)
    meta = _read_meta(pdir)
    if kind == "sprite":
        entry = meta.get("characters", {}).get(char, {}).get("sprites", {}).get(state)
    elif kind == "background":
        entry = meta.get("pages", {}).get(str(page), {}).get("background")
    elif kind == "narration":
        entry = meta.get("pages", {}).get(str(page), {}).get("narration")
    else:
        return
    if entry and 0 <= version < len(entry["versions"]):
        entry["current"] = version
        _write_meta(pdir, meta)


def get_manifest(project_id: str) -> dict:
    """Return the characters + pages asset manifest from meta.json."""
    meta = _read_meta(project_dir(project_id))
    return {
        "characters": meta.get("characters", {}),
        "pages": meta.get("pages", {}),
    }


def update_story_data(project_id: str, data: dict) -> None:
    """Save updated story_data.json and re-initialize asset tracking."""
    path = project_dir(project_id) / "story_data.json"
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    _init_asset_tracking(project_id, data)


def toggle_page(project_id: str, page_num: int) -> dict:
    """Flip the enabled bool for a page in meta.json. Returns updated page entry."""
    pdir = project_dir(project_id)
    meta = _read_meta(pdir)
    pages = meta.setdefault("pages", {})
    page = pages.setdefault(str(page_num), {"enabled": True, "order": page_num})
    page["enabled"] = not page.get("enabled", True)
    _write_meta(pdir, meta)
    return page


def reorder_pages(project_id: str, order: list[int]) -> None:
    """Save order indices to meta.json. order is a list of page_nums in desired display order."""
    pdir = project_dir(project_id)
    meta = _read_meta(pdir)
    pages = meta.setdefault("pages", {})
    for idx, page_num in enumerate(order):
        page = pages.setdefault(str(page_num), {"enabled": True})
        page["order"] = idx
    _write_meta(pdir, meta)


def copy_tree(src: Path, dst: Path) -> None:
    if not src.exists():
        return
    for f in src.rglob("*"):
        if f.is_file():
            rel = f.relative_to(src)
            target = dst / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, target)


# --- internal ---

def _meta_path(pdir: Path) -> Path:
    return pdir / "meta.json"


def _read_meta(pdir: Path) -> dict:
    mp = _meta_path(pdir)
    if mp.exists():
        return json.loads(mp.read_text())
    return {"project_id": pdir.name, "pdf_name": "", "pipeline": {}, "pages": {}, "characters": {}}


def _write_meta(pdir: Path, meta: dict) -> None:
    _meta_path(pdir).write_text(json.dumps(meta, indent=2))


def _init_asset_tracking(project_id: str, story_data: dict) -> None:
    """Pre-populate meta.json with empty page/character entries from story_data."""
    pdir = project_dir(project_id)
    meta = _read_meta(pdir)

    # Initialize pages
    for page in story_data.get("pages", []):
        pnum = str(page["page"])
        if pnum not in meta.setdefault("pages", {}):
            meta["pages"][pnum] = {"enabled": True, "order": page["page"]}

    # Initialize characters + sprite states
    for char in story_data.get("characters", []):
        slug = char["name"].lower().replace(" ", "_")
        if slug not in meta.setdefault("characters", {}):
            meta["characters"][slug] = {"sprites": {}}
        for state in char.get("sprite_states", []):
            meta["characters"][slug]["sprites"].setdefault(
                state, {"current": -1, "versions": []}
            )

    _write_meta(pdir, meta)
