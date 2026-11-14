import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
import rasterio


SCENE_ROOT = Path("data/processed/3d")
SCENE_PATH = SCENE_ROOT / "scene.json"
pytestmark = pytest.mark.skipif(not SCENE_PATH.exists(), reason="MarsWalk assets are generated locally")


def test_scene_contract_and_checksums() -> None:
    scene = json.loads(SCENE_PATH.read_text(encoding="utf-8"))
    assert scene["schema_version"] == "1.0"
    assert scene["coordinate_system"] == {"handedness": "right", "x": "east", "y": "up", "z": "south", "units": "meters"}
    assert scene["vertical_exaggeration"] == 1.0
    assert len(scene["tiles"]) == 140
    for relative, expected in scene["checksums"].items():
        path = SCENE_ROOT / relative
        assert path.exists()
        assert hashlib.sha256(path.read_bytes()).hexdigest() == expected


def test_five_3d_height_controls_match_routing_grid() -> None:
    scene = json.loads(SCENE_PATH.read_text(encoding="utf-8"))
    overview = np.fromfile(SCENE_ROOT / "terrain" / "overview_20m.bin", dtype="<f4").reshape(scene["overview"]["rows"], scene["overview"]["cols"])
    with rasterio.open("data/processed/rasters/routing_elevation_5m.tif") as source:
        terrain = source.read(1)
    controls = [(0.1, 0.1), (0.9, 0.1), (0.5, 0.5), (0.1, 0.9), (0.9, 0.9)]
    for x_fraction, y_fraction in controls:
        row = round(y_fraction * (overview.shape[0] - 1))
        col = round(x_fraction * (overview.shape[1] - 1))
        assert overview[row, col] == pytest.approx(float(terrain[row * 4, col * 4]), abs=1e-4)


def test_adjacent_high_detail_tiles_share_height_edges() -> None:
    scene = json.loads(SCENE_PATH.read_text(encoding="utf-8"))
    tiles = {tile["id"]: tile for tile in scene["tiles"]}
    left = tiles["r05_c05"]
    right = tiles["r05_c06"]

    def load(tile: dict) -> np.ndarray:
        lod = next(item for item in tile["lods"] if item["resolution_m"] == 5)
        return np.fromfile(SCENE_ROOT / lod["url"].removeprefix("/assets/3d/"), dtype="<f4").reshape(lod["rows"], lod["cols"])

    assert np.allclose(load(left)[:, -1], load(right)[:, 0], atol=1e-4)

