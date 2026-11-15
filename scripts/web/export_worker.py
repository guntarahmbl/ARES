"""Export the existing 5 m routing model and browser assets for Workers + R2."""
from __future__ import annotations

import hashlib
import gzip
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import rasterio

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from server.config import DATA_ROOT, RASTER_ROOT, SCENE_ROOT, WEB_ROOT
from server.main import bootstrap
from server.routing import RoutingEngine
from server.schemas import MissionConfig

OUTPUT = DATA_ROOT / "processed" / "cloudflare"


def main() -> None:
    engine = RoutingEngine()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    arrays = [engine.elevation, engine.slope, engine.roughness_normalized]
    # Retain the original grid and float32 precision; no terrain downsampling.
    for name in ("olindex3", "d2300", "min2295_2480"):
        path = engine.crism_paths[name]
        if path.exists():
            with rasterio.open(path) as source:
                if source.shape != engine.elevation.shape or source.transform != engine.transform:
                    raise ValueError(f"CRISM grid is not aligned: {path}")
                arrays.append(source.read(1, masked=True).filled(np.nan))
        else:
            arrays.append(np.full(engine.elevation.shape, np.nan, dtype=np.float32))
    with (OUTPUT / "grid.bin").open("wb") as stream:
        for array in arrays:
            stream.write(np.asarray(array, dtype="<f4").tobytes())
        stream.write(engine.base_valid.astype(np.uint8).tobytes())
    with (OUTPUT / "grid.bin").open("rb") as source, gzip.open(OUTPUT / "grid.bin.gz", "wb", compresslevel=6) as target:
        shutil.copyfileobj(source, target)
    metadata = {
        "width": engine.elevation.shape[1],
        "height": engine.elevation.shape[0],
        "transform": list(engine.transform)[:6],
        "resolution_m": engine.resolution,
        "grid_sha256": hashlib.sha256((OUTPUT / "grid.bin").read_bytes()).hexdigest(),
        "bootstrap": bootstrap(engine),
    }
    (OUTPUT / "metadata.json").write_text(json.dumps(metadata, separators=(",", ":"), allow_nan=False))
    for source, target in (
        (WEB_ROOT, OUTPUT / "assets" / "web"),
        (SCENE_ROOT, OUTPUT / "assets" / "3d"),
        (DATA_ROOT / "samples" / "thumbnails", OUTPUT / "assets" / "thumbnails"),
    ):
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(source, target)

    # Reference results are local verification fixtures, never public R2 objects.
    coordinate = {"longitude": 77.439073689, "latitude": 18.464058093}
    default = metadata["bootstrap"]["default_mission"]
    custom = {**default, "route_stops": [{"type": "custom", "id": "USR-test", "name": "Test checkpoint", **coordinate, "visit_duration_min": 5}]}
    scenarios = {"default": default, "custom": custom, "low_energy": {**default, "energy_budget": 12000}}
    references = {}
    for name, mission in scenarios.items():
        references[name] = {"mission": mission, "plan": engine.plan(MissionConfig.model_validate(mission)).model_dump()}
    references["validation"] = engine.validate_waypoint(**coordinate)
    references["return"] = engine.emergency_route(MissionConfig.model_validate(default), **coordinate).model_dump()
    (OUTPUT / "references.json").write_text(json.dumps(references, allow_nan=False))
    size = sum(path.stat().st_size for path in OUTPUT.rglob("*") if path.is_file())
    print(f"Exported {engine.elevation.shape[1]} × {engine.elevation.shape[0]} grid and assets to {OUTPUT} ({size / 1024**2:.1f} MiB)")


if __name__ == "__main__":
    main()
