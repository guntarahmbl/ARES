from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.windows import from_bounds


REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = REPO_ROOT / "data"
RASTER_ROOT = DATA_ROOT / "processed" / "rasters"
WEB_ROOT = DATA_ROOT / "processed" / "web"
SCENE_ROOT = DATA_ROOT / "processed" / "3d"
MARS_GEOGRAPHIC = "+proj=longlat +R=3396190 +no_defs"
TILE_SIZE_M = 512


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def normalized_gray(data: np.ma.MaskedArray) -> np.ndarray:
    valid = data.compressed()
    if not valid.size:
        return np.zeros((*data.shape, 3), dtype=np.uint8)
    low, high = np.percentile(valid, (2, 98))
    scaled = np.clip((data.filled(low) - low) / max(high - low, 1e-6), 0, 1)
    gray = (scaled * 255).astype(np.uint8)
    return np.stack([gray, gray, gray], axis=-1)


def mars_tint(rgb: np.ndarray) -> np.ndarray:
    luminance = rgb[..., 0].astype(np.float32) / 255
    output = np.empty_like(rgb)
    output[..., 0] = np.clip(35 + luminance * 205, 0, 255)
    output[..., 1] = np.clip(18 + luminance * 128, 0, 255)
    output[..., 2] = np.clip(14 + luminance * 82, 0, 255)
    return output


def read_preview(path: Path, max_width: int = 2048) -> tuple[np.ma.MaskedArray, rasterio.coords.BoundingBox]:
    with rasterio.open(path) as source:
        scale = max(source.width / max_width, 1)
        width = round(source.width / scale)
        height = round(source.height / scale)
        data = source.read(1, out_shape=(height, width), resampling=Resampling.bilinear, masked=True)
        return data, source.bounds


def build_web_previews() -> dict[str, str]:
    WEB_ROOT.mkdir(parents=True, exist_ok=True)
    outputs: dict[str, str] = {}
    sources = {
        "basemap.webp": "hirise_ortho_1m.tif",
        "slope.webp": "slope_5m.tif",
        "crism.webp": "crism_olindex3_5m.tif",
    }
    for output_name, source_name in sources.items():
        data, _ = read_preview(RASTER_ROOT / source_name)
        rgb = normalized_gray(data)
        if output_name == "basemap.webp":
            rgb = mars_tint(rgb)
        elif output_name == "slope.webp":
            value = rgb[..., 0].astype(np.float32) / 255
            rgb = np.stack([
                np.clip(value * 255, 0, 255),
                np.clip((1 - abs(value - 0.5) * 2) * 190, 0, 255),
                np.clip((1 - value) * 150, 0, 255),
            ], axis=-1).astype(np.uint8)
        else:
            value = rgb[..., 0].astype(np.float32) / 255
            rgb = np.stack([value * 70, value * 230, 120 + value * 135], axis=-1).astype(np.uint8)
        target = WEB_ROOT / output_name
        Image.fromarray(rgb).save(target, "WEBP", quality=84, method=6)
        outputs[output_name] = sha256(target)

    with rasterio.open(RASTER_ROOT / "traversability_mask_5m.tif") as source:
        data = source.read(1, out_shape=(min(source.height, 1200), min(source.width, 1800)), resampling=Resampling.nearest)
    rgba = np.zeros((*data.shape, 4), dtype=np.uint8)
    rgba[data == 0] = (220, 48, 58, 175)
    rgba[data > 0] = (42, 190, 130, 30)
    target = WEB_ROOT / "hazard.webp"
    Image.fromarray(rgba, "RGBA").save(target, "WEBP", quality=88, method=6)
    outputs[target.name] = sha256(target)
    return outputs


def texture_for_bounds(source: rasterio.DatasetReader, bounds: tuple[float, float, float, float], target: Path) -> None:
    window = from_bounds(*bounds, transform=source.transform).round_offsets().round_lengths()
    data = source.read(1, window=window, out_shape=(512, 512), resampling=Resampling.bilinear, masked=True)
    rgb = mars_tint(normalized_gray(data))
    target.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb).save(target, "WEBP", quality=82, method=6)


def downsample_height(data: np.ma.MaskedArray, factor: int) -> np.ndarray:
    values = data.filled(np.nan).astype(np.float32)
    result = values[::factor, ::factor]
    if result.shape[0] < 2 or result.shape[1] < 2:
        return values
    return result


def build_scene() -> dict:
    terrain_dir = SCENE_ROOT / "terrain"
    texture_dir = SCENE_ROOT / "textures"
    terrain_dir.mkdir(parents=True, exist_ok=True)
    texture_dir.mkdir(parents=True, exist_ok=True)

    with rasterio.open(RASTER_ROOT / "routing_elevation_5m.tif") as elevation_source, rasterio.open(RASTER_ROOT / "hirise_ortho_1m.tif") as imagery_source:
        bounds = elevation_source.bounds
        origin_x = (bounds.left + bounds.right) / 2
        origin_y = (bounds.bottom + bounds.top) / 2
        full = elevation_source.read(1, masked=True)
        valid = full.compressed()
        elevation_offset = float(np.median(valid))
        cell_size = abs(elevation_source.transform.a)
        tile_cells = max(16, round(TILE_SIZE_M / cell_size))
        tile_rows = math.ceil(elevation_source.height / tile_cells)
        tile_cols = math.ceil(elevation_source.width / tile_cells)
        tiles = []
        checksums: dict[str, str] = {}

        for tile_row in range(tile_rows):
            row_start = tile_row * tile_cells
            row_stop = min((tile_row + 1) * tile_cells + 1, elevation_source.height)
            for tile_col in range(tile_cols):
                col_start = tile_col * tile_cells
                col_stop = min((tile_col + 1) * tile_cells + 1, elevation_source.width)
                window = rasterio.windows.Window(col_start, row_start, col_stop - col_start, row_stop - row_start)
                tile_data = elevation_source.read(1, window=window, masked=True)
                tile_bounds = rasterio.windows.bounds(window, elevation_source.transform)
                if not tile_data.compressed().size:
                    continue
                tile_id = f"r{tile_row:02d}_c{tile_col:02d}"
                texture_path = texture_dir / f"{tile_id}.webp"
                texture_for_bounds(imagery_source, tile_bounds, texture_path)
                checksums[texture_path.relative_to(SCENE_ROOT).as_posix()] = sha256(texture_path)
                lods = []
                for resolution, factor in ((5, 1), (10, 2), (20, 4)):
                    height = downsample_height(tile_data, factor)
                    height = np.where(np.isfinite(height), height, elevation_offset).astype("<f4")
                    height_path = terrain_dir / f"{tile_id}_{resolution}m.bin"
                    height.tofile(height_path)
                    relative = height_path.relative_to(SCENE_ROOT).as_posix()
                    checksums[relative] = sha256(height_path)
                    lods.append({
                        "resolution_m": resolution,
                        "url": f"/assets/3d/{relative}",
                        "rows": height.shape[0],
                        "cols": height.shape[1],
                    })
                left, bottom, right, top = tile_bounds
                tiles.append({
                    "id": tile_id,
                    "bounds_projected": [left, bottom, right, top],
                    "bounds_local": [left - origin_x, origin_y - top, right - origin_x, origin_y - bottom],
                    "texture_url": f"/assets/3d/{texture_path.relative_to(SCENE_ROOT).as_posix()}",
                    "lods": lods,
                })

        overview = full.filled(elevation_offset).astype("<f4")[::4, ::4]
        overview_path = terrain_dir / "overview_20m.bin"
        overview.tofile(overview_path)
        checksums[overview_path.relative_to(SCENE_ROOT).as_posix()] = sha256(overview_path)
        transformer = Transformer.from_crs(elevation_source.crs, MARS_GEOGRAPHIC, always_xy=True)
        origin_lon, origin_lat = transformer.transform(origin_x, origin_y)
        scene = {
            "schema_version": "1.0",
            "coordinate_system": {"handedness": "right", "x": "east", "y": "up", "z": "south", "units": "meters"},
            "crs": elevation_source.crs.to_wkt(),
            "origin": {"x": origin_x, "y": origin_y, "longitude": origin_lon, "latitude": origin_lat, "elevation": elevation_offset},
            "bounds_projected": [bounds.left, bounds.bottom, bounds.right, bounds.top],
            "bounds_local": [bounds.left - origin_x, origin_y - bounds.top, bounds.right - origin_x, origin_y - bounds.bottom],
            "vertical_exaggeration": 1.0,
            "tile_size_m": TILE_SIZE_M,
            "tiles": tiles,
            "overview": {
                "url": "/assets/3d/terrain/overview_20m.bin",
                "rows": overview.shape[0],
                "cols": overview.shape[1],
                "resolution_m": cell_size * 4,
            },
            "checksums": checksums,
            "limitations": [
                "Orbital DTM does not resolve every small rock, ledge, or overhang.",
                "Lighting and astronaut motion are illustrative simulations.",
            ],
        }
    SCENE_ROOT.mkdir(parents=True, exist_ok=True)
    target = SCENE_ROOT / "scene.json"
    target.write_text(json.dumps(scene, indent=2), encoding="utf-8")
    return scene


def main() -> int:
    parser = argparse.ArgumentParser(description="Build ARES Path browser and MarsWalk assets.")
    parser.add_argument("--web-only", action="store_true")
    args = parser.parse_args()
    required = [
        RASTER_ROOT / "routing_elevation_5m.tif",
        RASTER_ROOT / "hirise_ortho_1m.tif",
        RASTER_ROOT / "slope_5m.tif",
    ]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        print(f"Missing processed rasters: {missing}", file=sys.stderr)
        return 1
    previews = build_web_previews()
    print(f"Built {len(previews)} web previews in {WEB_ROOT.relative_to(REPO_ROOT)}")
    if not args.web_only:
        scene = build_scene()
        print(f"Built {len(scene['tiles'])} MarsWalk terrain tiles in {SCENE_ROOT.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

