"""
Lightweight resource snapshots for diagnosing abrupt process kills.
"""
from datetime import datetime
import os
from pathlib import Path
from typing import Any

from backend.config import settings


def _read_text(path: str) -> str | None:
    try:
        p = Path(path)
        return p.read_text().strip() if p.exists() else None
    except Exception:
        return None


def _bytes_to_gb(value: int | float | None) -> float | None:
    if value is None:
        return None
    return round(float(value) / 1_073_741_824, 2)


def _cgroup_memory() -> dict[str, Any]:
    current_raw = _read_text("/sys/fs/cgroup/memory.current")
    max_raw = _read_text("/sys/fs/cgroup/memory.max")
    events_raw = _read_text("/sys/fs/cgroup/memory.events")
    current = int(current_raw) if current_raw and current_raw.isdigit() else None
    limit = None
    if max_raw and max_raw != "max" and max_raw.isdigit():
        limit = int(max_raw)
    events: dict[str, int] = {}
    if events_raw:
        for line in events_raw.splitlines():
            key, _, value = line.partition(" ")
            if key and value.isdigit():
                events[key] = int(value)
    return {
        "cgroup_current_gb": _bytes_to_gb(current),
        "cgroup_limit_gb": _bytes_to_gb(limit),
        "cgroup_events": events,
    }


def resource_snapshot(label: str, detail: str = "") -> dict[str, Any]:
    snap: dict[str, Any] = {
        "ts": datetime.utcnow().isoformat(),
        "pid": os.getpid(),
        "label": label,
        "detail": detail,
    }
    try:
        import psutil

        process = psutil.Process(os.getpid())
        vm = psutil.virtual_memory()
        snap.update({
            "rss_gb": _bytes_to_gb(process.memory_info().rss),
            "ram_total_gb": _bytes_to_gb(vm.total),
            "ram_available_gb": _bytes_to_gb(vm.available),
            "ram_percent": vm.percent,
        })
    except Exception as exc:
        snap["psutil_error"] = str(exc)

    snap.update(_cgroup_memory())

    try:
        import torch
        if torch.cuda.is_available():
            snap["cuda"] = []
            for idx in range(torch.cuda.device_count()):
                props = torch.cuda.get_device_properties(idx)
                snap["cuda"].append({
                    "index": idx,
                    "name": props.name,
                    "total_gb": _bytes_to_gb(props.total_memory),
                    "allocated_gb": _bytes_to_gb(torch.cuda.memory_allocated(idx)),
                    "reserved_gb": _bytes_to_gb(torch.cuda.memory_reserved(idx)),
                })
    except Exception as exc:
        snap["torch_error"] = str(exc)

    return snap


def log_resource_snapshot(label: str, detail: str = "") -> None:
    try:
        import json
        log_dir = settings.DATA_DIR / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        path = log_dir / "resource_monitor.log"
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(resource_snapshot(label, detail), ensure_ascii=False) + "\n")
    except Exception:
        pass
