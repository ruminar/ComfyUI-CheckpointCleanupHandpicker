
import base64
import io
import json
import logging
import math
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

import folder_paths
from aiohttp import web
from PIL import Image
from server import PromptServer

logger = logging.getLogger(__name__)

EVENT_NAME = "ruminar.checkpoint_cleanup_review"

JPEG_QUALITY = 80
JPEG_OPTIMIZE = False
GAP = 6
MAX_IMAGES = 64
TILE_SCALE = 0.5
MAX_TILE_LONG_SIDE = 512
ALLOWED_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
ALLOWED_CHECKPOINT_SUFFIX = ".safetensors"
CYCLER_CLASS_TYPE = "CheckpointNameCycler"

NODE_DIR = Path(__file__).resolve().parent
DATA_DIR = NODE_DIR / "data"
FAVORITES_PATH = DATA_DIR / "checkpoint_favorites.json"

DELETE_QUEUE_FILENAME = "checkpoint_delete_queue.jsonl"
DELETE_SCRIPT_FILENAME = "delete_reserved_checkpoints.py"
DELETE_PLAN_FILENAME = "delete_reserved_checkpoints_plan.txt"


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _temp_dir() -> Path:
    path = Path(folder_paths.get_temp_directory()).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def _delete_queue_path() -> Path:
    return _temp_dir() / DELETE_QUEUE_FILENAME


def _delete_script_path() -> Path:
    return _temp_dir() / DELETE_SCRIPT_FILENAME


def _delete_plan_path() -> Path:
    return _temp_dir() / DELETE_PLAN_FILENAME


def _safe_json_write(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _load_favorites() -> dict:
    _ensure_data_dir()
    if not FAVORITES_PATH.exists():
        return {"version": 1, "favorites": {}}
    try:
        data = json.loads(FAVORITES_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("favorites root must be an object")
        data.setdefault("version", 1)
        data.setdefault("favorites", {})
        if not isinstance(data["favorites"], dict):
            data["favorites"] = {}
        return data
    except Exception:
        logger.exception("Failed to read checkpoint_favorites.json. Starting with an empty database.")
        return {"version": 1, "favorites": {}}


def _save_favorites(data: dict):
    _safe_json_write(FAVORITES_PATH, data)


def _normalize_relpath(value: str) -> str:
    return str(PurePosixPath(str(value).replace("\\", "/")))


def _is_valid_checkpoint_relpath(value: str) -> bool:
    if not value or not isinstance(value, str):
        return False
    value = value.replace("\\", "/")
    path = PurePosixPath(value)
    if path.is_absolute():
        return False
    if any(part in ("", ".", "..") for part in path.parts):
        return False
    if not value.lower().endswith(ALLOWED_CHECKPOINT_SUFFIX):
        return False
    return True


def _checkpoint_roots():
    try:
        roots = folder_paths.get_folder_paths("checkpoints")
    except Exception:
        roots = []
    return [Path(p).resolve() for p in roots]


def _is_under_root(path: Path, root: Path) -> bool:
    path = path.resolve()
    root = root.resolve()
    return path == root or root in path.parents


def _resolve_checkpoint_candidates(ckpt_name_str: str):
    if not _is_valid_checkpoint_relpath(ckpt_name_str):
        return []
    relpath = _normalize_relpath(ckpt_name_str)
    candidates = []
    for root in _checkpoint_roots():
        candidate = (root / relpath).resolve()
        if not _is_under_root(candidate, root):
            continue
        if candidate.suffix.lower() != ALLOWED_CHECKPOINT_SUFFIX:
            continue
        if candidate.exists() and candidate.is_file():
            stat = candidate.stat()
            candidates.append({
                "root": str(root),
                "path": str(candidate),
                "file_size": stat.st_size,
                "mtime": stat.st_mtime,
            })
    return candidates


def _resolve_checkpoint_unique(ckpt_name_str: str):
    candidates = _resolve_checkpoint_candidates(ckpt_name_str)
    if len(candidates) == 1:
        return candidates[0]
    return None


def _default_search_root() -> Path:
    return Path(folder_paths.get_output_directory()).resolve()


def _resolve_search_root(search_directory: str | None):
    if search_directory is None:
        return _default_search_root(), "default_output"
    value = str(search_directory).strip()
    if not value:
        return _default_search_root(), "default_output"
    try:
        candidate = Path(value).expanduser().resolve()
        if candidate.exists() and candidate.is_dir():
            return candidate, "custom"
        return _default_search_root(), "invalid_fallback_output"
    except Exception:
        return _default_search_root(), "invalid_fallback_output"


def _iter_dirs_newest_first(root: Path):
    root = root.resolve()
    queue = [root]
    while queue:
        current = queue.pop(0)
        yield current
        try:
            children = [p for p in current.iterdir() if p.is_dir()]
            children.sort(key=lambda p: p.stat().st_mtime, reverse=True)
            queue[0:0] = children
        except Exception:
            continue


def _find_preview_images(ckpt_name_safe: str, search_directory: str | None = None, progress_callback=None):
    if not ckpt_name_safe or not isinstance(ckpt_name_safe, str):
        return [], None, "empty_safe_name"
    search_root, mode = _resolve_search_root(search_directory)
    if not search_root.exists() or not search_root.is_dir():
        return [], str(search_root), "missing_search_root"
    results = []
    for directory in _iter_dirs_newest_first(search_root):
        try:
            files = [
                p for p in directory.iterdir()
                if p.is_file()
                and p.suffix.lower() in ALLOWED_IMAGE_SUFFIXES
                and ckpt_name_safe in p.name
            ]
            files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
            for file in files:
                resolved = file.resolve()
                if not _is_under_root(resolved, search_root):
                    continue
                results.append(resolved)
                if progress_callback:
                    progress_callback(len(results), MAX_IMAGES, f"Found preview images {len(results)}/{MAX_IMAGES}")
                if len(results) >= MAX_IMAGES:
                    return results, str(search_root), mode
        except Exception:
            continue
    return results, str(search_root), mode


def _load_pil_images(paths, progress_callback=None):
    images = []
    total = min(len(paths), MAX_IMAGES)
    for idx, path in enumerate(paths[:MAX_IMAGES], start=1):
        try:
            if progress_callback:
                progress_callback(idx - 1, total, f"Loading preview images {idx}/{total}")
            with Image.open(path) as img:
                images.append(img.convert("RGB"))
            if progress_callback:
                progress_callback(idx, total, f"Loading preview images {idx}/{total}")
        except Exception:
            logger.exception("Failed to load preview image: %s", path)
    return images


def _thumbnail_preview_size(pil_image: Image.Image):
    target_width = max(1, int(pil_image.width * TILE_SCALE))
    target_height = max(1, int(pil_image.height * TILE_SCALE))
    long_side = max(target_width, target_height)
    if long_side > MAX_TILE_LONG_SIDE:
        scale = MAX_TILE_LONG_SIDE / long_side
        target_width = max(1, int(target_width * scale))
        target_height = max(1, int(target_height * scale))
    thumb = pil_image.copy()
    resampling = getattr(Image, "Resampling", Image).LANCZOS
    thumb.thumbnail((target_width, target_height), resampling)
    return thumb


def _compute_grid(count, tile_width, tile_height):
    cols = max(1, math.ceil(math.sqrt(count * (tile_height / tile_width))))
    rows = math.ceil(count / cols)
    return cols, rows


def _build_contact_sheet(images, progress_callback=None):
    if not images:
        raise ValueError("No images to preview")
    thumbs = []
    total = len(images)
    for idx, img in enumerate(images, start=1):
        if progress_callback:
            progress_callback(idx - 1, total, f"Building preview sheet {idx}/{total}")
        thumbs.append(_thumbnail_preview_size(img))
        if progress_callback:
            progress_callback(idx, total, f"Building preview sheet {idx}/{total}")
    max_tile_width = max(img.width for img in thumbs)
    max_tile_height = max(img.height for img in thumbs)
    cols, rows = _compute_grid(len(thumbs), max_tile_width, max_tile_height)
    sheet_width = cols * max_tile_width + (cols + 1) * GAP
    sheet_height = rows * max_tile_height + (rows + 1) * GAP
    sheet = Image.new("RGB", (sheet_width, sheet_height), (24, 24, 24))
    for idx, img in enumerate(thumbs):
        row = idx // cols
        col = idx % cols
        x0 = GAP + col * (max_tile_width + GAP)
        y0 = GAP + row * (max_tile_height + GAP)
        paste_x = x0 + (max_tile_width - img.width) // 2
        paste_y = y0 + (max_tile_height - img.height) // 2
        sheet.paste(img, (paste_x, paste_y))
    return sheet, {
        "count": len(thumbs),
        "columns": cols,
        "rows": rows,
        "tile_width": max_tile_width,
        "tile_height": max_tile_height,
        "gap": GAP,
    }


def _encode_jpeg(pil_image: Image.Image) -> str:
    if pil_image.mode != "RGB":
        pil_image = pil_image.convert("RGB")
    buffer = io.BytesIO()
    pil_image.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=JPEG_OPTIMIZE)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _queue_records():
    path = _delete_queue_path()
    if not path.exists():
        return []
    records = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
            if isinstance(record, dict):
                records.append(record)
        except Exception:
            logger.warning("Skipping invalid delete queue record: %s", line)
    return records


def _active_delete_reservations() -> dict:
    active = {}
    for rec in _queue_records():
        rec_type = rec.get("type")
        relpath = rec.get("ckpt_name_str") or rec.get("ckpt_name_relpath")
        if not relpath:
            continue
        relpath = _normalize_relpath(relpath)
        if rec_type == "reserve":
            active[relpath] = rec
        elif rec_type == "cancel":
            active.pop(relpath, None)
    return active


def _append_delete_queue(record: dict):
    path = _delete_queue_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")


def _build_delete_targets():
    active = _active_delete_reservations()
    targets = []
    roots = [str(p) for p in _checkpoint_roots()]
    for relpath, rec in sorted(active.items(), key=lambda x: x[0].lower()):
        resolved = _resolve_checkpoint_unique(relpath)
        if not resolved:
            logger.warning("Skipping unresolved delete target: %s", relpath)
            continue
        safetensors_path = Path(resolved["path"]).resolve()
        json_path = safetensors_path.with_suffix(".json")
        targets.append({
            "ckpt_name_str": relpath,
            "ckpt_name_safe": rec.get("ckpt_name_safe", ""),
            "safetensors_path": str(safetensors_path),
            "json_path": str(json_path),
            "reserved_at": rec.get("reserved_at", ""),
        })
    return roots, targets


def _write_delete_script():
    roots, targets = _build_delete_targets()
    script_path = _delete_script_path()
    plan_path = _delete_plan_path()
    script = f'''# Generated by ComfyUI-CheckpointCleanupHandpicker.
# This script reads {DELETE_QUEUE_FILENAME} from the same directory at execution time.
# Review each prompt carefully. Default answer is No.

import json
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
QUEUE_PATH = SCRIPT_DIR / "{DELETE_QUEUE_FILENAME}"

ALLOWED_ROOTS = {json.dumps(roots, ensure_ascii=False, indent=2)}
ALLOWED_SUFFIXES = {{".safetensors", ".json"}}


def is_under_root(path, root):
    path = path.resolve()
    root = root.resolve()
    return path == root or root in path.parents


def is_safe_target(path):
    path = Path(path).resolve()
    if path.suffix.lower() not in ALLOWED_SUFFIXES:
        return False
    for root in ALLOWED_ROOTS:
        if is_under_root(path, Path(root)):
            return True
    return False


def read_records():
    if not QUEUE_PATH.exists():
        return []
    records = []
    for line in QUEUE_PATH.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
            if isinstance(record, dict):
                records.append(record)
        except Exception as exc:
            print("Skipping invalid queue record:", exc)
    return records


def active_targets():
    active = {{}}
    for rec in read_records():
        rec_type = rec.get("type")
        relpath = rec.get("ckpt_name_str") or rec.get("ckpt_name_relpath")
        if not relpath:
            continue
        if rec_type == "reserve":
            active[relpath] = rec
        elif rec_type == "cancel":
            active.pop(relpath, None)
    targets = []
    for relpath, rec in sorted(active.items(), key=lambda x: x[0].lower()):
        safetensors_path = Path(rec.get("resolved_path", "")).resolve()
        json_path = safetensors_path.with_suffix(".json")
        targets.append({{
            "ckpt_name_str": relpath,
            "safetensors_path": str(safetensors_path),
            "json_path": str(json_path),
            "reserved_at": rec.get("reserved_at", ""),
        }})
    return targets


def main():
    targets = active_targets()
    print("Checkpoint delete script")
    print("Queue file:", QUEUE_PATH)
    print("Targets:", len(targets))
    for index, item in enumerate(targets, start=1):
        print()
        print(f"[{{index}}/{{len(targets)}}] Delete checkpoint?")
        print("  relpath:", item["ckpt_name_str"])
        print("  safetensors:", item["safetensors_path"])
        print("  json:", item["json_path"])
        answer = input("Delete this checkpoint? (y/N): ").strip().lower()
        if answer != "y":
            print("Skipped.")
            continue
        for key in ("safetensors_path", "json_path"):
            path = Path(item[key]).resolve()
            if not is_safe_target(path):
                print("Unsafe target, skipped:", path)
                continue
            if not path.exists():
                print("Not found:", path)
                continue
            if not path.is_file():
                print("Not a file, skipped:", path)
                continue
            path.unlink()
            print("Deleted:", path)
    print()
    print("Done.")


if __name__ == "__main__":
    main()
'''
    script_path.write_text(script, encoding="utf-8", newline="\n")
    lines = [
        "Checkpoint delete plan",
        f"Generated at: {_now_iso()}",
        f"Queue file: {_delete_queue_path()}",
        f"Active targets: {len(targets)}",
        "",
    ]
    for idx, item in enumerate(targets, start=1):
        lines.extend([
            f"[{idx}] {item['ckpt_name_str']}",
            f"    safetensors: {item['safetensors_path']}",
            f"    json:        {item['json_path']}",
            f"    reserved_at: {item.get('reserved_at', '')}",
            "",
        ])
    plan_path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    return script_path, plan_path, len(targets)


def _status_for(ckpt_name_str: str, ckpt_name_safe: str, search_directory: str | None = None):
    relpath = _normalize_relpath(ckpt_name_str) if isinstance(ckpt_name_str, str) else ""
    favorite_db = _load_favorites()
    is_favorite = relpath in favorite_db.get("favorites", {})
    active_delete = _active_delete_reservations()
    is_reserved = relpath in active_delete
    resolved = _resolve_checkpoint_unique(relpath)
    candidates = _resolve_checkpoint_candidates(relpath)
    preview_images, search_root, search_mode = _find_preview_images(ckpt_name_safe, search_directory)
    preview_found = len(preview_images) > 0
    if not _is_valid_checkpoint_relpath(relpath):
        status = "invalid"
        title = f"⚠ invalid: {relpath or '(empty)'}"
    elif resolved is None and len(candidates) == 0:
        status = "unresolved"
        title = f"❓ unresolved: {relpath}"
    elif resolved is None and len(candidates) > 1:
        status = "ambiguous"
        title = f"⚠ ambiguous: {relpath}"
    elif is_favorite:
        status = "favorite"
        title = f"💛 {relpath}"
    elif is_reserved:
        status = "reserved"
        title = f"🗑 {relpath}"
    elif not preview_found:
        status = "no_preview"
        title = f"⚠ no preview: {relpath}"
    else:
        status = "ready"
        title = relpath
    can_favorite = resolved is not None and not is_reserved
    can_unfavorite = is_favorite
    can_reserve_delete = resolved is not None and preview_found and not is_favorite and not is_reserved
    can_cancel_delete = is_reserved
    return {
        "ckpt_name_str": relpath,
        "ckpt_name_safe": ckpt_name_safe,
        "search_directory": search_root,
        "search_mode": search_mode,
        "resolved": resolved,
        "candidate_count": len(candidates),
        "preview_found": preview_found,
        "preview_count": len(preview_images),
        "is_favorite": is_favorite,
        "is_reserved": is_reserved,
        "status": status,
        "title": title,
        "can_favorite": can_favorite,
        "can_unfavorite": can_unfavorite,
        "can_reserve_delete": can_reserve_delete,
        "can_cancel_delete": can_cancel_delete,
        "active_delete": active_delete.get(relpath),
        "delete_queue_path": str(_delete_queue_path()),
        "delete_script_path": str(_delete_script_path()),
    }


def _send_review_payload(payload: dict):
    server = PromptServer.instance
    client_id = getattr(server, "client_id", None)
    if client_id:
        server.send_sync(EVENT_NAME, payload, client_id)
    else:
        server.send_sync(EVENT_NAME, payload)


def _send_progress(unique_id, ckpt_name_str, ckpt_name_safe, message, value=0, total=0):
    payload = {
        "node": int(unique_id) if unique_id is not None else None,
        "ckpt_name_str": ckpt_name_str,
        "ckpt_name_safe": ckpt_name_safe,
        "status": "loading",
        "title": f"Loading: {ckpt_name_str}",
        "progress_message": message,
        "progress_value": value,
        "progress_total": total,
        "image": None,
        "format": "jpeg",
        "width": 0,
        "height": 0,
    }
    _send_review_payload(payload)


def _validate_cycler_connections(prompt, unique_id: str):
    if prompt is None or unique_id is None:
        raise ValueError("This node requires PROMPT and UNIQUE_ID hidden inputs for safety validation.")
    me = prompt.get(str(unique_id))
    if not me:
        raise ValueError("Could not find this node in prompt for safety validation.")
    inputs = me.get("inputs", {})
    expected_inputs = ("ckpt_name_str", "ckpt_name_safe")
    links = []
    for name in expected_inputs:
        value = inputs.get(name)
        if not isinstance(value, list) or len(value) < 2:
            raise ValueError(f"{name} must be connected from {CYCLER_CLASS_TYPE}.")
        links.append(value)
    source_node_ids = {str(link[0]) for link in links}
    if len(source_node_ids) != 1:
        raise ValueError("ckpt_name_str and ckpt_name_safe must come from the same CheckpointNameCycler node.")
    source_node_id = next(iter(source_node_ids))
    source_node = prompt.get(source_node_id)
    if not source_node:
        raise ValueError("Source CheckpointNameCycler node was not found in prompt.")
    source_class = source_node.get("class_type")
    if source_class != CYCLER_CLASS_TYPE:
        raise ValueError(f"This node only works when connected to {CYCLER_CLASS_TYPE}.")
    return source_node_id


def _create_review_payload(ckpt_name_str: str, ckpt_name_safe: str, search_directory: str | None, unique_id=None):
    def progress(value, total, message):
        _send_progress(unique_id, ckpt_name_str, ckpt_name_safe, message, value, total)
    progress(0, MAX_IMAGES, "Searching preview images...")
    status = _status_for(ckpt_name_str, ckpt_name_safe, search_directory)
    payload = {
        "node": int(unique_id) if unique_id is not None else None,
        "format": "jpeg",
        "image": None,
        "width": 0,
        "height": 0,
        **status,
    }
    image_paths, search_root, search_mode = _find_preview_images(ckpt_name_safe, search_directory, progress_callback=progress)
    payload["search_directory"] = search_root
    payload["search_mode"] = search_mode
    payload["preview_count"] = len(image_paths)
    payload["preview_found"] = len(image_paths) > 0
    if image_paths:
        pil_images = _load_pil_images(image_paths, progress_callback=progress)
        if pil_images:
            sheet, meta = _build_contact_sheet(pil_images, progress_callback=progress)
            progress(MAX_IMAGES, MAX_IMAGES, "Encoding preview image...")
            encoded = _encode_jpeg(sheet)
            payload.update({
                "image": encoded,
                "width": sheet.width,
                "height": sheet.height,
                **meta,
                "quality": JPEG_QUALITY,
                "max_images": MAX_IMAGES,
                "max_tile_long_side": MAX_TILE_LONG_SIDE,
            })
    progress(MAX_IMAGES, MAX_IMAGES, "Preview ready.")
    return payload


class CheckpointCleanupReview:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "ckpt_name_str": ("STRING", {"forceInput": True}),
                "ckpt_name_safe": ("STRING", {"forceInput": True}),
            },
            "optional": {
                "search_directory": ("STRING", {"forceInput": True}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "prompt": "PROMPT",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "review"
    CATEGORY = "checkpoint/cleanup"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, ckpt_name_str, ckpt_name_safe, search_directory=None, unique_id=None, prompt=None):
        return float("nan")

    def review(self, ckpt_name_str, ckpt_name_safe, search_directory=None, unique_id=None, prompt=None):
        _validate_cycler_connections(prompt, unique_id)
        if not _is_valid_checkpoint_relpath(ckpt_name_str):
            raise ValueError("ckpt_name_str must be a relative .safetensors path from CheckpointNameCycler.")
        _write_delete_script()
        payload = _create_review_payload(ckpt_name_str, ckpt_name_safe, search_directory, unique_id=unique_id)
        _send_review_payload(payload)
        return ()


async def _read_json_request(request):
    try:
        return await request.json()
    except Exception:
        return {}


def _json_ok(**kwargs):
    return web.json_response({"ok": True, **kwargs})


def _json_error(message: str, status=400, **kwargs):
    return web.json_response({"ok": False, "error": message, **kwargs}, status=status)


@PromptServer.instance.routes.post("/checkpoint_cleanup_handpicker/favorite")
async def favorite_checkpoint(request):
    data = await _read_json_request(request)
    ckpt_name_str = _normalize_relpath(data.get("ckpt_name_str", ""))
    ckpt_name_safe = data.get("ckpt_name_safe", "")
    search_directory = data.get("search_directory")
    resolved = _resolve_checkpoint_unique(ckpt_name_str)
    if not resolved:
        return _json_error("Checkpoint could not be resolved uniquely.")
    active = _active_delete_reservations()
    if ckpt_name_str in active:
        return _json_error("Checkpoint is already delete-reserved. Cancel the reservation first.")
    db = _load_favorites()
    db["favorites"][ckpt_name_str] = {
        "ckpt_name_str": ckpt_name_str,
        "ckpt_name_safe": ckpt_name_safe,
        "resolved_path": resolved["path"],
        "root": resolved["root"],
        "file_size": resolved["file_size"],
        "mtime": resolved["mtime"],
        "favorited_at": _now_iso(),
        "last_seen_at": _now_iso(),
    }
    _save_favorites(db)
    status = _status_for(ckpt_name_str, ckpt_name_safe, search_directory)
    return _json_ok(**status)


@PromptServer.instance.routes.post("/checkpoint_cleanup_handpicker/unfavorite")
async def unfavorite_checkpoint(request):
    data = await _read_json_request(request)
    ckpt_name_str = _normalize_relpath(data.get("ckpt_name_str", ""))
    ckpt_name_safe = data.get("ckpt_name_safe", "")
    search_directory = data.get("search_directory")
    db = _load_favorites()
    db.get("favorites", {}).pop(ckpt_name_str, None)
    _save_favorites(db)
    status = _status_for(ckpt_name_str, ckpt_name_safe, search_directory)
    return _json_ok(**status)


@PromptServer.instance.routes.post("/checkpoint_cleanup_handpicker/reserve_delete")
async def reserve_delete_checkpoint(request):
    data = await _read_json_request(request)
    ckpt_name_str = _normalize_relpath(data.get("ckpt_name_str", ""))
    ckpt_name_safe = data.get("ckpt_name_safe", "")
    search_directory = data.get("search_directory")
    status = _status_for(ckpt_name_str, ckpt_name_safe, search_directory)
    if status["is_favorite"]:
        return _json_error("Favorite checkpoints cannot be delete-reserved.", **status)
    if status["is_reserved"]:
        return _json_error("Checkpoint is already delete-reserved.", **status)
    if not status["resolved"]:
        return _json_error("Checkpoint could not be resolved uniquely.", **status)
    if not status["preview_found"]:
        return _json_error("No preview images were found. Delete reservation is disabled.", **status)
    resolved = status["resolved"]
    record = {
        "version": 1,
        "type": "reserve",
        "id": f"{int(time.time())}_{uuid.uuid4().hex[:12]}",
        "ckpt_name_str": ckpt_name_str,
        "ckpt_name_safe": ckpt_name_safe,
        "resolved_path": resolved["path"],
        "root": resolved["root"],
        "file_size": resolved["file_size"],
        "mtime": resolved["mtime"],
        "reserved_at": _now_iso(),
    }
    _append_delete_queue(record)
    _write_delete_script()
    status = _status_for(ckpt_name_str, ckpt_name_safe, search_directory)
    return _json_ok(**status)


@PromptServer.instance.routes.post("/checkpoint_cleanup_handpicker/cancel_delete")
async def cancel_delete_checkpoint(request):
    data = await _read_json_request(request)
    ckpt_name_str = _normalize_relpath(data.get("ckpt_name_str", ""))
    ckpt_name_safe = data.get("ckpt_name_safe", "")
    search_directory = data.get("search_directory")
    active = _active_delete_reservations()
    if ckpt_name_str not in active:
        status = _status_for(ckpt_name_str, ckpt_name_safe, search_directory)
        return _json_error("Checkpoint is not delete-reserved.", **status)
    record = {
        "version": 1,
        "type": "cancel",
        "id": active[ckpt_name_str].get("id"),
        "ckpt_name_str": ckpt_name_str,
        "cancelled_at": _now_iso(),
    }
    _append_delete_queue(record)
    _write_delete_script()
    status = _status_for(ckpt_name_str, ckpt_name_safe, search_directory)
    return _json_ok(**status)
