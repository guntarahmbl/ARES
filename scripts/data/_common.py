from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = REPO_ROOT / "data"
MANIFEST_PATH = DATA_ROOT / "manifests" / "datasets.yaml"


def load_manifest() -> dict[str, Any]:
    with MANIFEST_PATH.open(encoding="utf-8") as stream:
        return yaml.safe_load(stream)


def load_aoi(path: str | Path | None = None) -> tuple[dict[str, Any], tuple[float, float, float, float]]:
    target = REPO_ROOT / path if path else DATA_ROOT / "aoi" / "jezero_delta_traverse.geojson"
    with target.open(encoding="utf-8") as stream:
        data = json.load(stream)
    ring = data["features"][0]["geometry"]["coordinates"][0]
    xs = [point[0] for point in ring]
    ys = [point[1] for point in ring]
    return data, (min(xs), min(ys), max(xs), max(ys))


def resolve(path: str | Path) -> Path:
    return REPO_ROOT / Path(path)


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)
