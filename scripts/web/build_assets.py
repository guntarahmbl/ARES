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
FINE_LOD_M = 2
NORMAL_STRENGTH = 2.0  # Slope exaggeration baked into normal maps; lighting is illustrative.


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


def normal_for_bounds(source: rasterio.DatasetReader, bounds: tuple[float, float, float, float], target: Path) -> None:
    """Write an object-space normal map (x east, y up, z south) covering the same window as the tile texture."""
    window = from_bounds(*bounds, transform=source.transform).round_offsets().round_lengths()
    pad = 1
    col_start = max(0, int(window.col_off) - pad)
    row_start = max(0, int(window.row_off) - pad)
    col_stop = min(source.width, int(window.col_off + window.width) + pad)
    row_stop = min(source.height, int(window.row_off + window.height) + pad)
    padded = rasterio.windows.Window(col_start, row_start, col_stop - col_start, row_stop - row_start)
    data = source.read(1, window=padded, masked=True)
    heights = data.filled(float(data.mean()) if data.count() else 0.0).astype(np.float32)
    d_south, d_east = np.gradient(heights, abs(source.transform.e), abs(source.transform.a))
    normal = np.stack([-NORMAL_STRENGTH * d_east, np.ones_like(d_east), -NORMAL_STRENGTH * d_south], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    top = int(window.row_off) - row_start
    left = int(window.col_off) - col_start
    normal = normal[top:top + int(window.height), left:left + int(window.width)]
    rgb = np.clip((normal * 0.5 + 0.5) * 255, 0, 255).round().astype(np.uint8)
    target.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb).resize((512, 512), Image.BILINEAR).save(target, "WEBP", quality=90, method=6)


def downsample_height(data: np.ma.MaskedArray, factor: int) -> np.ndarray:
    values = data.filled(np.nan).astype(np.float32)
    result = values[::factor, ::factor]
    if result.shape[0] < 2 or result.shape[1] < 2:
        return values
    return result


def read_fine_heights(elevation_source: rasterio.DatasetReader, tile_cells: int) -> tuple[np.ndarray, float] | None:
    """Resample the 1 m DTM onto a lattice that subdivides the routing grid.

    Fine samples sit on the same cell-centre lattice as the routing grid, so
    every tile slices one shared array and neighbouring tiles agree on edges.
    """
    path = RASTER_ROOT / "hirise_dtm_1m.tif"
    if not path.exists():
        print(f"Skipping {FINE_LOD_M} m LOD: {path.name} is missing", file=sys.stderr)
        return None
    cell_x = abs(elevation_source.transform.a)
    factor = round(cell_x / FINE_LOD_M * 2) / 2
    spans = (tile_cells, elevation_source.width - 1, elevation_source.height - 1)
    if any(abs(span * factor - round(span * factor)) > 1e-9 for span in spans):
        print(f"Skipping {FINE_LOD_M} m LOD: grid does not subdivide evenly", file=sys.stderr)
        return None
    cols = round((elevation_source.width - 1) * factor) + 1
    rows = round((elevation_source.height - 1) * factor) + 1
    with rasterio.open(path) as source:
        if source.bounds != elevation_source.bounds:
            print(f"Skipping {FINE_LOD_M} m LOD: {path.name} extent differs from routing grid", file=sys.stderr)
            return None
        step_x = cell_x / abs(source.transform.a) / factor
        step_y = abs(elevation_source.transform.e) / abs(source.transform.e) / factor
        window = rasterio.windows.Window(
            (0.5 * factor - 0.5) * step_x, (0.5 * factor - 0.5) * step_y, cols * step_x, rows * step_y,
        )
        data = source.read(1, window=window, out_shape=(rows, cols), resampling=Resampling.average, masked=True)
    return data.filled(np.nan).astype(np.float32), factor


def build_scene(scene_root: Path = SCENE_ROOT, fine_lod: bool = False, normal_maps: bool = False) -> dict:
    terrain_dir = scene_root / "terrain"
    texture_dir = scene_root / "textures"
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
        fine = read_fine_heights(elevation_source, tile_cells) if fine_lod else None
        dtm_path = RASTER_ROOT / "hirise_dtm_1m.tif"
        if normal_maps and not dtm_path.exists():
            print(f"Skipping normal maps: {dtm_path.name} is missing", file=sys.stderr)
        dtm_source = rasterio.open(dtm_path) if normal_maps and dtm_path.exists() else None

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
                checksums[texture_path.relative_to(scene_root).as_posix()] = sha256(texture_path)
                lods = []
                levels: list[tuple[int, np.ndarray]] = []
                if fine is not None:
                    fine_heights, fine_factor = fine
                    levels.append((FINE_LOD_M, fine_heights[
                        round(row_start * fine_factor):round((row_stop - 1) * fine_factor) + 1,
                        round(col_start * fine_factor):round((col_stop - 1) * fine_factor) + 1,
                    ]))
                levels.extend((resolution, downsample_height(tile_data, factor)) for resolution, factor in ((5, 1), (10, 2), (20, 4)))
                for resolution, height in levels:
                    height = np.where(np.isfinite(height), height, elevation_offset).astype("<f4")
                    height_path = terrain_dir / f"{tile_id}_{resolution}m.bin"
                    height.tofile(height_path)
                    relative = height_path.relative_to(scene_root).as_posix()
                    checksums[relative] = sha256(height_path)
                    lods.append({
                        "resolution_m": resolution,
                        "url": f"/assets/3d/{relative}",
                        "rows": height.shape[0],
                        "cols": height.shape[1],
                    })
                normal_url = None
                if dtm_source is not None:
                    normal_path = scene_root / "normals" / f"{tile_id}.webp"
                    normal_for_bounds(dtm_source, tile_bounds, normal_path)
                    relative = normal_path.relative_to(scene_root).as_posix()
                    checksums[relative] = sha256(normal_path)
                    normal_url = f"/assets/3d/{relative}"
                left, bottom, right, top = tile_bounds
                tiles.append({
                    "id": tile_id,
                    "bounds_projected": [left, bottom, right, top],
                    "bounds_local": [left - origin_x, origin_y - top, right - origin_x, origin_y - bottom],
                    "texture_url": f"/assets/3d/{texture_path.relative_to(scene_root).as_posix()}",
                    "lods": lods,
                    **({"normal_url": normal_url} if normal_url else {}),
                })
        if dtm_source is not None:
            dtm_source.close()

        overview = full.filled(elevation_offset).astype("<f4")[::4, ::4]
        overview_path = terrain_dir / "overview_20m.bin"
        overview.tofile(overview_path)
        checksums[overview_path.relative_to(scene_root).as_posix()] = sha256(overview_path)
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
    scene_root.mkdir(parents=True, exist_ok=True)
    target = scene_root / "scene.json"
    target.write_text(json.dumps(scene, indent=2), encoding="utf-8")
    return scene


def main() -> int:
    parser = argparse.ArgumentParser(description="Build ARES Path browser and MarsWalk assets.")
    parser.add_argument("--web-only", action="store_true")
    parser.add_argument("--scene-only", action="store_true", help="Skip the 2D web previews.")
    parser.add_argument("--fine-lod", action="store_true", help=f"Add a {FINE_LOD_M} m terrain LOD from hirise_dtm_1m.tif.")
    parser.add_argument("--normal-maps", action="store_true", help="Add per-tile normal maps from hirise_dtm_1m.tif.")
    parser.add_argument("--scene-out", type=Path, default=SCENE_ROOT, help="Output folder for MarsWalk assets.")
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
    if not args.scene_only:
        previews = build_web_previews()
        print(f"Built {len(previews)} web previews in {WEB_ROOT.relative_to(REPO_ROOT)}")
    if not args.web_only:
        scene_root = args.scene_out.resolve()
        scene = build_scene(scene_root, args.fine_lod, args.normal_maps)
        print(f"Built {len(scene['tiles'])} MarsWalk terrain tiles in {scene_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

