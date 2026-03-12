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
    # Preserve existing edges if new data doesn't include them
    if path.exists() and "edges" not in data:
        existing = json.loads(path.read_text())
        data["edges"] = existing.get("edges", [])
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    # Initialize page and character tracking in meta
    _init_asset_tracking(project_id, data)


def get_story_data(project_id: str) -> dict | None:
    path = project_dir(project_id) / "story_data.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    # Migrate: backfill bg_url/nar_url from meta.json for pages that predate this field
    _backfill_asset_urls(project_id, data)
    return data


def _backfill_asset_urls(project_id: str, story_data: dict) -> None:
    """One-time migration: set bg_url/nar_url on pages that have versions in meta.json but no url field."""
    meta = _read_meta(project_dir(project_id))
    dirty = False
    for page in story_data.get("pages", []):
        actual = page.get("actual_page", page["page"])
        meta_page = meta.get("pages", {}).get(str(actual), {})
        for field, kind in [("bg_url", "background"), ("nar_url", "narration")]:
            if field not in page:
                versions = meta_page.get(kind, {}).get("versions", [])
                # Use current index if present (legacy), else latest
                current = meta_page.get(kind, {}).get("current", len(versions) - 1)
                if versions and 0 <= current < len(versions):
                    page[field] = versions[current]["url"]
                    dirty = True
                else:
                    page[field] = None
    if dirty:
        path = project_dir(project_id) / "story_data.json"
        path.write_text(json.dumps(story_data, indent=2, ensure_ascii=False))


def get_edges(project_id: str) -> list[dict]:
    data = get_story_data(project_id)
    return data.get("edges", []) if data else []


def save_edges(project_id: str, edges: list[dict]) -> None:
    """Save the full edges list to story_data.json."""
    path = project_dir(project_id) / "story_data.json"
    data = json.loads(path.read_text())
    data["edges"] = edges
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))


def save_pdf(project_id: str, content: bytes, filename: str) -> Path:
    path = project_dir(project_id) / filename
    path.write_bytes(content)
    return path


def get_asset_path(project_id: str, relative: str) -> Path:
    return assets_dir(project_id) / relative


def asset_exists(project_id: str, relative: str) -> bool:
    return get_asset_path(project_id, relative).exists()


def record_sprite(project_id: str, char_slug: str, state: str, url: str, generation_inputs: dict = None) -> None:
    """Record a generated sprite version in meta.json."""
    pdir = project_dir(project_id)
    meta = _read_meta(pdir)
    chars = meta.setdefault("characters", {})
    char = chars.setdefault(char_slug, {"sprites": {}})
    sprites = char.setdefault("sprites", {})
    entry = sprites.setdefault(state, {"versions": []})
    version_entry = {"url": url, "created_at": datetime.utcnow().isoformat()}
    if generation_inputs:
        version_entry["generation_inputs"] = generation_inputs
    entry["versions"].append(version_entry)
    _write_meta(pdir, meta)


def record_background(project_id: str, page_num: int, url: str, generation_inputs: dict = None) -> None:
    """Record a generated background video version in meta.json and set bg_url in story_data.json."""
    pdir = project_dir(project_id)
    # Append version to meta.json (history)
    meta = _read_meta(pdir)
    pages = meta.setdefault("pages", {})
    page = pages.setdefault(str(page_num), {"enabled": True})
    entry = page.setdefault("background", {"versions": []})
    version_entry = {"url": url, "created_at": datetime.utcnow().isoformat()}
    if generation_inputs:
        version_entry["generation_inputs"] = generation_inputs
    entry["versions"].append(version_entry)
    _write_meta(pdir, meta)
    # Set active URL in story_data.json (source of truth)
    _set_page_asset_url(project_id, page_num, "bg_url", url)


def record_narration(project_id: str, page_num: int, url: str, generation_inputs: dict = None) -> None:
    """Record a generated narration audio version in meta.json and set nar_url in story_data.json."""
    pdir = project_dir(project_id)
    # Append version to meta.json (history)
    meta = _read_meta(pdir)
    pages = meta.setdefault("pages", {})
    page = pages.setdefault(str(page_num), {"enabled": True})
    entry = page.setdefault("narration", {"versions": []})
    version_entry = {"url": url, "created_at": datetime.utcnow().isoformat()}
    if generation_inputs:
        version_entry["generation_inputs"] = generation_inputs
    entry["versions"].append(version_entry)
    _write_meta(pdir, meta)
    # Set active URL in story_data.json (source of truth)
    _set_page_asset_url(project_id, page_num, "nar_url", url)


def set_current_version(project_id: str, kind: str, version: int,
                        char: str = "", state: str = "", page: int = 0) -> None:
    """Set the active bg_url or nar_url on the page in story_data.json by version index."""
    pdir = project_dir(project_id)
    meta = _read_meta(pdir)
    if kind == "background":
        entry = meta.get("pages", {}).get(str(page), {}).get("background")
        field = "bg_url"
    elif kind == "narration":
        entry = meta.get("pages", {}).get(str(page), {}).get("narration")
        field = "nar_url"
    else:
        return
    if entry and 0 <= version < len(entry["versions"]):
        url = entry["versions"][version]["url"]
        _set_page_asset_url(project_id, page, field, url)


def set_page_sprite_version(project_id: str, page_num: int, char_slug_val: str, state: str, sprite_url: str) -> None:
    """Set the sprite_url for a specific character_state on a page in story_data.json."""
    path = project_dir(project_id) / "story_data.json"
    if not path.exists():
        return
    data = json.loads(path.read_text())
    slug_fn = lambda n: n.strip().lower().replace(" ", "_")
    for p in data.get("pages", []):
        if p["page"] == page_num:
            for cs in p.get("character_states", []):
                if slug_fn(cs["character"]) == char_slug_val and cs["state"] == state:
                    cs["sprite_url"] = sprite_url
                    break
            break
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))


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


def add_page(project_id: str) -> dict:
    """Add a new blank custom page to story_data.json. Returns the new page dict."""
    path = project_dir(project_id) / "story_data.json"
    data = json.loads(path.read_text())
    existing_ids = {p["page"] for p in data.get("pages", [])}
    new_id = max(existing_ids, default=9000) + 1
    while new_id in existing_ids:
        new_id += 1
    page = {
        "page": new_id,
        "actual_page": None,
        "ref_source": "custom",
        "ref_page": None,
        "ref_image": None,
        "text": "",
        "summary": "Custom page",
        "setting": "",
        "mood": "Neutral",
        "scene_motion": "",
        "key_interaction": "None",
        "foreground_characters": [],
        "background_characters": [],
        "character_states": [],
        "bg_url": None,
        "nar_url": None,
    }
    data.setdefault("pages", []).append(page)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    return page


def delete_page(project_id: str, system_page: int) -> None:
    """Remove a page from story_data.json by its system page number."""
    path = project_dir(project_id) / "story_data.json"
    data = json.loads(path.read_text())
    data["pages"] = [p for p in data["pages"] if p["page"] != system_page]
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))


def update_page(project_id: str, system_page: int, fields: dict) -> None:
    """Update editable fields of a page in story_data.json. page/actual_page are protected."""
    protected = {"page", "actual_page"}
    path = project_dir(project_id) / "story_data.json"
    data = json.loads(path.read_text())
    actual_page = system_page
    for p in data["pages"]:
        if p["page"] == system_page:
            actual_page = p.get("actual_page") or system_page
            for k, v in fields.items():
                if k not in protected:
                    p[k] = v
            break
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))

    # Sync assigned bg/nar URLs into meta.json so manifest and node indicators stay in sync
    if "bg_url" in fields and fields["bg_url"]:
        _record_assigned_asset(project_id, actual_page, "background", fields["bg_url"])
    if "nar_url" in fields and fields["nar_url"]:
        _record_assigned_asset(project_id, actual_page, "narration", fields["nar_url"])


def _record_assigned_asset(project_id: str, page_num: int, kind: str, url: str) -> None:
    """Add a manually-assigned asset URL to meta.json versions if not already present."""
    pdir = project_dir(project_id)
    meta = _read_meta(pdir)
    pages = meta.setdefault("pages", {})
    page = pages.setdefault(str(page_num), {"enabled": True})
    entry = page.setdefault(kind, {"versions": []})
    existing_urls = {v["url"] for v in entry.get("versions", [])}
    if url not in existing_urls:
        entry["versions"].append({
            "url": url,
            "created_at": datetime.utcnow().isoformat(),
            "generation_inputs": {"source": "assigned"},
        })
    _write_meta(pdir, meta)


def set_page_ref(project_id: str, system_page: int, ref_page: int | None = None, ref_image: str | None = None) -> None:
    """Set the reference source for a page's background generation."""
    path = project_dir(project_id) / "story_data.json"
    data = json.loads(path.read_text())
    for p in data["pages"]:
        if p["page"] == system_page:
            if ref_image is not None:
                p["ref_image"] = ref_image
                p["ref_source"] = "custom"
                p["ref_page"] = None
            elif ref_page is not None:
                p["ref_page"] = ref_page
                p["ref_source"] = "pdf"
                p["ref_image"] = None
            break
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))


def update_character(project_id: str, char_slug: str, fields: dict) -> None:
    """Update editable fields of a character in story_data.json. name is protected."""
    protected = {"name"}
    path = project_dir(project_id) / "story_data.json"
    data = json.loads(path.read_text())
    slug_fn = lambda name: name.lower().replace(" ", "_")
    for c in data["characters"]:
        if slug_fn(c["name"]) == char_slug:
            for k, v in fields.items():
                if k not in protected:
                    c[k] = v
            break
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))


def update_pdf_name(project_id: str, pdf_name: str) -> None:
    pdir = project_dir(project_id)
    meta = _read_meta(pdir)
    meta["pdf_name"] = pdf_name
    _write_meta(pdir, meta)


def get_positions(project_id: str) -> dict:
    """Return saved node positions from positions.json."""
    path = project_dir(project_id) / "positions.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def save_positions(project_id: str, positions: dict) -> None:
    """Persist node positions to positions.json."""
    path = project_dir(project_id) / "positions.json"
    path.write_text(json.dumps(positions, indent=2))


# ── Asset Library ──────────────────────────────────────────────────────────

def upload_to_library(project_id: str, filename: str, content: bytes) -> str:
    """Save an uploaded file to assets/library/. Returns relative url."""
    import re as _re
    lib_dir = assets_dir(project_id) / "library"
    lib_dir.mkdir(parents=True, exist_ok=True)
    safe = _re.sub(r'[^a-zA-Z0-9._-]', '_', filename)
    if '.' in safe:
        stem, ext = safe.rsplit('.', 1)
    else:
        stem, ext = safe, 'bin'
    target = lib_dir / safe
    counter = 1
    while target.exists():
        target = lib_dir / f"{stem}_{counter}.{ext}"
        counter += 1
    target.write_bytes(content)
    return f"library/{target.name}"


def get_all_assets(project_id: str) -> dict:
    """List all project assets grouped by top-level folder."""
    adir = assets_dir(project_id)
    result: dict[str, list] = {}
    if not adir.exists():
        return result
    for f in sorted(adir.rglob("*")):
        if not f.is_file():
            continue
        rel = f.relative_to(adir)
        parts = rel.parts
        category = parts[0] if len(parts) > 1 else "root"
        stat = f.stat()
        result.setdefault(category, []).append({
            "url": str(rel).replace("\\", "/"),
            "filename": f.name,
            "size": stat.st_size,
        })
    return result


def rename_library_asset(project_id: str, url: str, new_name: str) -> str:
    """Rename a file in assets/library/. Returns new relative url."""
    import re as _re
    if not url.startswith("library/"):
        raise ValueError("Only library assets can be renamed")
    safe = _re.sub(r'[^a-zA-Z0-9._-]', '_', new_name)
    src = assets_dir(project_id) / url
    dst = src.parent / safe
    if not src.exists():
        raise FileNotFoundError(f"{url} not found")
    if dst.exists():
        raise FileExistsError(f"{safe} already exists")
    src.rename(dst)
    return f"library/{safe}"


def set_char_ref(project_id: str, char_slug_val: str, src_relative: str) -> str:
    """Copy a project asset (e.g. from library/) as the active char ref.
    Saves to refs/{slug}_ref.png. Returns dest url."""
    src = assets_dir(project_id) / src_relative
    dst = assets_dir(project_id) / "refs" / f"{char_slug_val}_ref.png"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return f"refs/{char_slug_val}_ref.png"


def add_character(project_id: str, data: dict) -> dict:
    """Add a new character to story_data.json. Creates story_data.json if missing."""
    path = project_dir(project_id) / "story_data.json"
    if path.exists():
        story = json.loads(path.read_text())
    else:
        story = {"title": "", "summary": "", "characters": [], "pages": []}
    slug_fn = lambda n: n.strip().lower().replace(" ", "_")
    existing = {slug_fn(c["name"]) for c in story.get("characters", [])}
    if slug_fn(data["name"]) in existing:
        raise ValueError(f"Character '{data['name']}' already exists")
    char = {
        "name": data["name"],
        "role": data.get("role", ""),
        "personality": data.get("personality", ""),
        "speech_style": data.get("speech_style", ""),
        "visual_description": data.get("visual_description", ""),
        "emotions": data.get("emotions", []),
        "sprite_states": data.get("sprite_states", ["idle"]),
        "best_reference_page": data.get("best_reference_page", None),
    }
    story.setdefault("characters", []).append(char)
    path.write_text(json.dumps(story, indent=2, ensure_ascii=False))
    _init_asset_tracking(project_id, story)
    return char


def add_sprite_state(project_id: str, char_slug: str, state: str) -> None:
    """Append a new sprite state to a character in story_data.json (no-op if exists)."""
    path = project_dir(project_id) / "story_data.json"
    if not path.exists():
        return
    data = json.loads(path.read_text())
    slug_fn = lambda n: n.strip().lower().replace(" ", "_")
    for c in data.get("characters", []):
        if slug_fn(c["name"]) == char_slug:
            states = c.setdefault("sprite_states", [])
            if state not in states:
                states.append(state)
            break
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    _init_asset_tracking(project_id, data)


def copy_tree(src: Path, dst: Path) -> None:
    if not src.exists():
        return
    for f in src.rglob("*"):
        if f.is_file():
            rel = f.relative_to(src)
            target = dst / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, target)


def _set_page_asset_url(project_id: str, page_num: int, field: str, url: str) -> None:
    """Set bg_url or nar_url on the matching page entry in story_data.json."""
    path = project_dir(project_id) / "story_data.json"
    if not path.exists():
        return
    data = json.loads(path.read_text())
    for p in data.get("pages", []):
        if p.get("actual_page", p["page"]) == page_num:
            p[field] = url
            break
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))


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


def get_live_nodes(project_id: str) -> list:
    data = get_story_data(project_id)
    if not data:
        return []
    return data.get("live_nodes", [])


def save_live_node(project_id: str, node: dict) -> dict:
    path = project_dir(project_id) / "story_data.json"
    data = json.loads(path.read_text())
    live_nodes = data.setdefault("live_nodes", [])
    existing = next((i for i, n in enumerate(live_nodes) if n["id"] == node["id"]), None)
    if existing is not None:
        live_nodes[existing] = node
    else:
        live_nodes.append(node)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    return node


def delete_live_node(project_id: str, node_id: str) -> None:
    path = project_dir(project_id) / "story_data.json"
    data = json.loads(path.read_text())
    data["live_nodes"] = [n for n in data.get("live_nodes", []) if n["id"] != node_id]
    # Also remove edges referencing this node
    data["edges"] = [
        e for e in data.get("edges", [])
        if str(e.get("from")) != node_id and str(e.get("to")) != node_id
    ]
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))


def _init_asset_tracking(project_id: str, story_data: dict) -> None:
    """Pre-populate meta.json with empty page/character entries from story_data."""
    pdir = project_dir(project_id)
    meta = _read_meta(pdir)

    # Initialize pages
    for page in story_data.get("pages", []):
        pnum = str(page.get("actual_page", page["page"]))
        if pnum not in meta.setdefault("pages", {}):
            meta["pages"][pnum] = {"enabled": True, "order": page.get("actual_page", page["page"])}

    # Initialize characters + sprite states
    for char in story_data.get("characters", []):
        slug = char["name"].lower().replace(" ", "_")
        if slug not in meta.setdefault("characters", {}):
            meta["characters"][slug] = {"sprites": {}}
        for state in char.get("sprite_states", []):
            meta["characters"][slug]["sprites"].setdefault(
                state, {"versions": []}
            )

    _write_meta(pdir, meta)
