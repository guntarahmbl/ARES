from __future__ import annotations

import argparse
import csv
import json
import math
import shutil
import statistics
import zipfile
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import fiona
import rasterio
import shapefile
from PIL import Image, ImageDraw
from pyproj import CRS, Transformer
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import from_bounds as window_from_bounds
from shapely.geometry import LineString, box, mapping, shape
from shapely.ops import transform as shapely_transform

from _common import DATA_ROOT, REPO_ROOT, load_aoi, load_manifest, resolve, sha256_file, write_json


MARS_GEOGRAPHIC = "+proj=longlat +R=3396190 +no_defs"
MARS_ANALYSIS = "+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +R=3396190 +units=m +no_defs"
RASTER_DIR = DATA_ROOT / "processed" / "rasters"
SAMPLE_DIR = DATA_ROOT / "samples"


def verify_downloaded_files() -> None:
    checksum_path = DATA_ROOT / "manifests" / "runtime_checksums.sha256"
    if not checksum_path.exists():
        raise FileNotFoundError("Runtime checksums are missing; run fetch.py first")
    for line in checksum_path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        expected, relative_path = line.split(maxsplit=1)
        path = resolve(relative_path.strip())
        if not path.exists() or sha256_file(path) != expected:
            raise ValueError(f"Runtime checksum mismatch: {relative_path.strip()}")


def dataset_by_id(manifest: dict[str, Any], dataset_id: str) -> dict[str, Any]:
    return next(item for item in manifest["datasets"] if item["id"] == dataset_id)


def crop_raster(source: str | Path, destination: Path, bbox: tuple[float, float, float, float], resolution: float, resampling: Resampling = Resampling.bilinear) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        print(f"EXISTS    {destination.relative_to(REPO_ROOT)}")
        return destination
    source_value = str(source)
    with rasterio.Env(GDAL_HTTP_MULTIRANGE="YES", GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES"):
        with rasterio.open(source_value) as src:
            source_bounds = transform_bounds(MARS_GEOGRAPHIC, src.crs, *bbox, densify_pts=21)
            if source_bounds[2] <= src.bounds.left or source_bounds[0] >= src.bounds.right or source_bounds[3] <= src.bounds.bottom or source_bounds[1] >= src.bounds.top:
                raise ValueError(f"AOI does not intersect {source_value}")
            projected = transform_bounds(MARS_GEOGRAPHIC, MARS_ANALYSIS, *bbox, densify_pts=21)
            width = max(1, math.ceil((projected[2] - projected[0]) / resolution))
            height = max(1, math.ceil((projected[3] - projected[1]) / resolution))
            destination_transform = from_bounds(*projected, width, height)
            nodata = src.nodata
            if nodata is None:
                nodata = 0 if np.issubdtype(np.dtype(src.dtypes[0]), np.integer) else -9999.0
            data = np.full((height, width), nodata, dtype=src.dtypes[0])
            reproject(
                source=rasterio.band(src, 1),
                destination=data,
                src_transform=src.transform,
                src_crs=src.crs,
                src_nodata=src.nodata,
                dst_transform=destination_transform,
                dst_crs=MARS_ANALYSIS,
                dst_nodata=nodata,
                resampling=resampling,
            )
            profile = src.profile.copy()
            profile.update(
                driver="GTiff",
                width=width,
                height=height,
                count=1,
                transform=destination_transform,
                crs=MARS_ANALYSIS,
                nodata=nodata,
                compress="deflate",
                tiled=True,
                blockxsize=256,
                blockysize=256,
                BIGTIFF="IF_SAFER",
            )
            with rasterio.open(destination, "w", **profile) as dst:
                dst.write(data, 1)
    print(f"PROCESSED {destination.relative_to(REPO_ROOT)}")
    return destination


def write_single_band(path: Path, data: np.ndarray, profile: dict[str, Any], nodata: float | int, dtype: str) -> None:
    updated = profile.copy()
    updated.update(
        driver="GTiff",
        count=1,
        dtype=dtype,
        nodata=nodata,
        compress="deflate",
        tiled=True,
        blockxsize=256,
        blockysize=256,
        BIGTIFF="IF_SAFER",
    )
    with rasterio.open(path, "w", **updated) as dst:
        dst.write(data.astype(dtype), 1)


def local_std(values: np.ndarray, valid: np.ndarray) -> np.ndarray:
    padded = np.pad(values, 1, mode="edge")
    padded_valid = np.pad(valid.astype(np.float32), 1, mode="constant")
    total = np.zeros_like(values, dtype=np.float64)
    total_sq = np.zeros_like(values, dtype=np.float64)
    count = np.zeros_like(values, dtype=np.float64)
    for row in range(3):
        for col in range(3):
            block = padded[row : row + values.shape[0], col : col + values.shape[1]]
            mask = padded_valid[row : row + values.shape[0], col : col + values.shape[1]]
            total += block * mask
            total_sq += block * block * mask
            count += mask
    count = np.maximum(count, 1)
    variance = np.maximum(total_sq / count - (total / count) ** 2, 0)
    return np.sqrt(variance).astype(np.float32)


def derive_terrain(dtm_path: Path) -> list[Path]:
    with rasterio.open(dtm_path) as src:
        scale = max(1, round(5 / abs(src.transform.a)))
        height = math.ceil(src.height / scale)
        width = math.ceil(src.width / scale)
        elevation = src.read(1, out_shape=(height, width), resampling=Resampling.average, masked=True)
        left, bottom, right, top = src.bounds
        transform = from_bounds(left, bottom, right, top, width, height)
        profile = src.profile.copy()
        profile.update(width=width, height=height, transform=transform)

    values = elevation.filled(np.nan).astype(np.float32)
    valid = np.isfinite(values)
    filled = np.where(valid, values, np.nanmedian(values[valid]))
    dy, dx = np.gradient(filled, abs(transform.e), abs(transform.a))
    slope = np.degrees(np.arctan(np.hypot(dx, dy))).astype(np.float32)
    roughness = local_std(filled, valid)

    azimuth = math.radians(315)
    altitude = math.radians(45)
    aspect = np.arctan2(-dx, dy)
    slope_rad = np.arctan(np.hypot(dx, dy))
    hillshade = 255 * (
        math.sin(altitude) * np.cos(slope_rad)
        + math.cos(altitude) * np.sin(slope_rad) * np.cos(azimuth - aspect)
    )
    hillshade = np.clip(hillshade, 0, 255).astype(np.uint8)
    traversable = (valid & (slope <= 25)).astype(np.uint8)

    outputs = {
        "routing_elevation_5m.tif": (np.where(valid, filled, -9999), -9999.0, "float32"),
        "slope_5m.tif": (np.where(valid, slope, -9999), -9999.0, "float32"),
        "roughness_5m.tif": (np.where(valid, roughness, -9999), -9999.0, "float32"),
        "hillshade_5m.tif": (np.where(valid, hillshade, 0), 0, "uint8"),
        "traversability_mask_5m.tif": (traversable, 0, "uint8"),
    }
    paths = []
    for name, (array, nodata, dtype) in outputs.items():
        path = RASTER_DIR / name
        write_single_band(path, array, profile, nodata, dtype)
        paths.append(path)
        print(f"DERIVED   {path.relative_to(REPO_ROOT)}")
    return paths


def parse_band_names(header: Path) -> list[str]:
    text = header.read_text(encoding="utf-8", errors="replace")
    marker = "band names"
    start = text.lower().find(marker)
    if start < 0:
        raise ValueError(f"No ENVI band names in {header}")
    opening = text.find("{", start)
    closing = text.find("}", opening)
    return [item.strip() for item in text[opening + 1 : closing].replace("\r", " ").replace("\n", " ").split(",")]


def process_crism(manifest: dict[str, Any], routing_grid: Path) -> list[Path]:
    dataset = dataset_by_id(manifest, "D-05")
    source_dir = resolve(dataset["destination"])
    image = source_dir / "frt00005c5e_07_su166j_mtr3.img"
    header = source_dir / "frt00005c5e_07_su166j_mtr3.hdr"
    if not image.exists() or not header.exists():
        raise FileNotFoundError("CRISM summary cube is missing; run fetch.py first")
    names = parse_band_names(header)
    desired = ["OLINDEX3", "D2300", "MIN2295_2480"]
    with rasterio.open(routing_grid) as grid:
        dst_profile = grid.profile.copy()
        dst_shape = (grid.height, grid.width)
        dst_transform = grid.transform
        dst_crs = grid.crs
    outputs = []
    with rasterio.open(image) as src:
        for band_name in desired:
            if band_name not in names:
                raise ValueError(f"CRISM band {band_name} not found")
            source_band = names.index(band_name) + 1
            destination_data = np.full(dst_shape, -9999.0, dtype=np.float32)
            reproject(
                source=rasterio.band(src, source_band),
                destination=destination_data,
                src_transform=src.transform,
                src_crs=src.crs,
                src_nodata=src.nodata or 65535.0,
                dst_transform=dst_transform,
                dst_crs=dst_crs,
                dst_nodata=-9999.0,
                resampling=Resampling.bilinear,
            )
            path = RASTER_DIR / f"crism_{band_name.lower()}_5m.tif"
            write_single_band(path, destination_data, dst_profile, -9999.0, "float32")
            outputs.append(path)
            print(f"DERIVED   {path.relative_to(REPO_ROOT)}")
    return outputs


def serializable_properties(record: Any) -> dict[str, Any]:
    result = {}
    values = record.as_dict() if hasattr(record, "as_dict") else dict(record)
    for key, value in values.items():
        if isinstance(value, (str, int, float, bool)) or value is None:
            result[key] = value
        else:
            result[key] = str(value)
    return result


def process_geology(manifest: dict[str, Any], aoi_bbox: tuple[float, float, float, float]) -> Path:
    dataset = dataset_by_id(manifest, "D-04")
    archive = resolve(dataset["destination"])
    if not archive.exists():
        raise FileNotFoundError("USGS geology archive is missing; run fetch.py first")
    extracted = DATA_ROOT / "interim" / "geology"
    if not extracted.exists():
        with zipfile.ZipFile(archive) as bundle:
            bundle.extractall(extracted)
    aoi = box(*aoi_bbox)
    geodatabases = list(extracted.rglob("*.gdb"))
    if geodatabases:
        source_path = geodatabases[0]
        layer = "GeoUnits_v1"
        if layer not in fiona.listlayers(source_path):
            raise RuntimeError(f"Geologic-unit layer is missing from {source_path}")
        features = []
        with fiona.open(source_path, layer=layer) as source:
            transformer = Transformer.from_crs(CRS.from_wkt(source.crs_wkt), CRS.from_proj4(MARS_GEOGRAPHIC), always_xy=True)
            for item in source:
                geometry = shapely_transform(transformer.transform, shape(item["geometry"]))
                clipped = geometry.intersection(aoi)
                if not clipped.is_empty:
                    features.append({"type": "Feature", "properties": serializable_properties(item["properties"]), "geometry": mapping(clipped)})
        source_name = f"{source_path.relative_to(extracted).as_posix()}:{layer}"
    else:
        features, source_name = process_geology_shapefiles(extracted, aoi)
    output = SAMPLE_DIR / "geology_units.geojson"
    write_json(output, {"type": "FeatureCollection", "name": "jezero_geology_units", "source": source_name, "features": features})
    print(f"SAMPLED   {output.relative_to(REPO_ROOT)} ({len(features)} features)")
    return output


def process_geology_shapefiles(extracted: Path, aoi: Any) -> tuple[list[dict[str, Any]], str]:
    candidates = []
    for shp in extracted.rglob("*.shp"):
        try:
            reader = shapefile.Reader(str(shp))
            if reader.shapeType in (5, 15, 25):
                candidates.append((len(reader), shp))
        except shapefile.ShapefileException:
            continue
    if not candidates:
        raise RuntimeError("No polygon shapefile found in SIM 3464")
    source_path = max(candidates, key=lambda item: item[0])[1]
    reader = shapefile.Reader(str(source_path))
    first_bbox = reader.shape(0).bbox
    transformer = None
    if not (-180 <= first_bbox[0] <= 360 and -90 <= first_bbox[1] <= 90):
        prj = source_path.with_suffix(".prj")
        if not prj.exists():
            raise RuntimeError(f"Projected geology layer lacks PRJ: {source_path}")
        transformer = Transformer.from_crs(CRS.from_wkt(prj.read_text()), CRS.from_proj4(MARS_GEOGRAPHIC), always_xy=True)

    features = []
    for item in reader.iterShapeRecords():
        geometry = shape(item.shape.__geo_interface__)
        if transformer:
            geometry = shapely_transform(transformer.transform, geometry)
        clipped = geometry.intersection(aoi)
        if clipped.is_empty:
            continue
        features.append({"type": "Feature", "properties": serializable_properties(item.record), "geometry": mapping(clipped)})
    return features, source_path.relative_to(extracted).as_posix()


def process_places(manifest: dict[str, Any], aoi_bbox: tuple[float, float, float, float]) -> Path:
    source = resolve(dataset_by_id(manifest, "D-06")["destination"]) / "best_interp.csv"
    if not source.exists():
        raise FileNotFoundError("Rover PLACES localization is missing; run fetch.py first")
    west, south, east, north = aoi_bbox
    rows = []
    with source.open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            if row["frame"] != "ROVER":
                continue
            lon = float(row["longitude"])
            lat = float(row["planetocentric_latitude"])
            if west <= lon <= east and south <= lat <= north:
                rows.append(row)
    rows.sort(key=lambda row: int(float(row["sclk"])))
    drive_points: dict[tuple[str, str], tuple[float, float, int]] = {}
    for row in rows:
        drive_points[(row["site"], row["drive"])] = (
            float(row["longitude"]),
            float(row["planetocentric_latitude"]),
            int(row["sol"]),
        )
    points = [(lon, lat) for lon, lat, _ in drive_points.values()]
    line = LineString(points).simplify(0.00002, preserve_topology=False)
    feature = {
        "type": "Feature",
        "properties": {
            "source": "Mars 2020 Rover PLACES Release 16",
            "source_points": len(rows),
            "drive_points": len(points),
            "simplified_points": len(line.coords),
            "sol_min": min(value[2] for value in drive_points.values()),
            "sol_max": max(value[2] for value in drive_points.values()),
        },
        "geometry": mapping(line),
    }
    output = SAMPLE_DIR / "rover_traverse_simplified.geojson"
    write_json(output, {"type": "FeatureCollection", "name": "rover_traverse_simplified", "features": [feature]})
    print(f"SAMPLED   {output.relative_to(REPO_ROOT)}")
    return output


def process_images(manifest: dict[str, Any]) -> tuple[Path, list[Path]]:
    raw_dir = resolve(dataset_by_id(manifest, "D-07")["destination"])
    metadata_path = raw_dir / "manifest.json"
    if not metadata_path.exists():
        raise FileNotFoundError("Surface-image manifest is missing; run fetch.py first")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    waypoint_data = json.loads((SAMPLE_DIR / "science_waypoints.geojson").read_text(encoding="utf-8"))
    waypoint_by_sol = {feature["properties"]["sol"]: feature for feature in waypoint_data["features"]}
    thumbnail_dir = SAMPLE_DIR / "thumbnails" / "surface"
    thumbnail_dir.mkdir(parents=True, exist_ok=True)
    fields = ["waypoint_id", "product_id", "sol", "instrument", "site", "drive", "longitude", "latitude", "date_taken_utc", "source_url", "image_url", "credit"]
    rows = []
    thumbnails = []
    for item in sorted(metadata, key=lambda value: (int(value["sol"]), value["imageid"])):
        waypoint = waypoint_by_sol[int(item["sol"])]
        coordinates = waypoint["geometry"]["coordinates"]
        source = raw_dir / f"{item['imageid']}.jpg"
        target = thumbnail_dir / f"{item['imageid']}.jpg"
        with Image.open(source) as image:
            converted = image.convert("RGB")
            converted.thumbnail((1600, 1600))
            converted.save(target, format="JPEG", quality=84, optimize=True)
        thumbnails.append(target)
        rows.append({
            "waypoint_id": waypoint["properties"]["id"],
            "product_id": item["imageid"],
            "sol": item["sol"],
            "instrument": item["camera"]["instrument"],
            "site": item.get("site", ""),
            "drive": item.get("drive", ""),
            "longitude": coordinates[0],
            "latitude": coordinates[1],
            "date_taken_utc": item.get("date_taken_utc", ""),
            "source_url": item.get("link", ""),
            "image_url": item["image_files"].get("medium", ""),
            "credit": item.get("credit", "NASA/JPL-Caltech"),
        })
    output = SAMPLE_DIR / "surface_images.csv"
    with output.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    print(f"SAMPLED   {output.relative_to(REPO_ROOT)} ({len(rows)} images)")
    return output, thumbnails


class Stats:
    def __init__(self, minimum: float, maximum: float) -> None:
        self.values: list[float] = []
        self.minimum = minimum
        self.maximum = maximum

    def add(self, value: str | None) -> None:
        if value in (None, ""):
            return
        try:
            number = float(value)
        except ValueError:
            return
        if math.isfinite(number) and self.minimum <= number <= self.maximum:
            self.values.append(number)

    def summary(self) -> tuple[str, str, str, int]:
        if not self.values:
            return "", "", "", 0
        return (
            f"{min(self.values):.3f}",
            f"{statistics.fmean(self.values):.3f}",
            f"{max(self.values):.3f}",
            len(self.values),
        )


def add_csv_values(path: Path, columns: Iterable[str], stats: dict[str, Stats]) -> None:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            for column in columns:
                stats[column].add(row.get(column))


def find_meda_file(folder: Path, token: str) -> Path:
    matches = [path for path in folder.glob("*.CSV") if token in path.name.upper()]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one {token} CSV in {folder}, found {matches}")
    return matches[0]


def process_meda(manifest: dict[str, Any]) -> Path:
    dataset = dataset_by_id(manifest, "D-08")
    root = resolve(dataset["destination"])
    output_rows = []
    for sol in dataset["sols"]:
        folder = root / f"sol_{sol:04d}"
        stats = {
            "PRESSURE": Stats(0, 2_000),
            "AIR_TEMP": Stats(100, 400),
            "GROUND_TEMP": Stats(100, 400),
            "HORIZONTAL_WIND_SPEED": Stats(0, 100),
        }
        add_csv_values(find_meda_file(folder, "DER_PS"), ["PRESSURE"], stats)
        add_csv_values(find_meda_file(folder, "CAL_TIRS"), ["AIR_TEMP", "GROUND_TEMP"], stats)
        add_csv_values(find_meda_file(folder, "DER_WS"), ["HORIZONTAL_WIND_SPEED"], stats)
        pressure = stats["PRESSURE"].summary()
        air = stats["AIR_TEMP"].summary()
        ground = stats["GROUND_TEMP"].summary()
        wind = stats["HORIZONTAL_WIND_SPEED"].summary()
        output_rows.append({
            "sol": sol,
            "pressure_pa_min": pressure[0], "pressure_pa_mean": pressure[1], "pressure_pa_max": pressure[2],
            "air_temp_k_min": air[0], "air_temp_k_mean": air[1], "air_temp_k_max": air[2],
            "ground_temp_k_min": ground[0], "ground_temp_k_mean": ground[1], "ground_temp_k_max": ground[2],
            "horizontal_wind_m_s_min": wind[0], "horizontal_wind_m_s_mean": wind[1], "horizontal_wind_m_s_max": wind[2],
            "pressure_n": pressure[3], "temperature_n": min(air[3], ground[3]), "wind_n": wind[3],
            "context": "historical observation; not a forecast",
        })
    output = SAMPLE_DIR / "meda_7sol_summary.csv"
    with output.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(output_rows[0]))
        writer.writeheader()
        writer.writerows(output_rows)
    print(f"SAMPLED   {output.relative_to(REPO_ROOT)}")
    return output


def raster_thumbnail(source: Path, destination: Path, categorical: bool = False) -> None:
    with rasterio.open(source) as src:
        scale = max(src.width / 1200, src.height / 1200, 1)
        width, height = max(1, round(src.width / scale)), max(1, round(src.height / scale))
        data = src.read(1, out_shape=(height, width), resampling=Resampling.nearest if categorical else Resampling.bilinear, masked=True)
    valid = data.compressed()
    if not valid.size:
        raise ValueError(f"No valid pixels for thumbnail: {source}")
    low, high = np.percentile(valid, (2, 98))
    if high <= low:
        high = low + 1
    image = np.clip((data.filled(low) - low) / (high - low) * 255, 0, 255).astype(np.uint8)
    image[np.ma.getmaskarray(data)] = 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(image, mode="L").save(destination, optimize=True)


def geology_thumbnail(source: Path, destination: Path, bbox: tuple[float, float, float, float]) -> None:
    width, height = 1200, 800
    west, south, east, north = bbox
    canvas = Image.new("RGB", (width, height), "#171717")
    draw = ImageDraw.Draw(canvas)

    def pixel(point: tuple[float, float]) -> tuple[int, int]:
        x = round((point[0] - west) / (east - west) * (width - 1))
        y = round((north - point[1]) / (north - south) * (height - 1))
        return x, y

    features = json.loads(source.read_text(encoding="utf-8"))["features"]
    for index, feature in enumerate(features):
        geometry = shape(feature["geometry"])
        polygons = list(geometry.geoms) if geometry.geom_type == "MultiPolygon" else [geometry]
        color_id = int(feature["properties"].get("Color_ID") or index)
        color = (60 + color_id * 47 % 170, 60 + color_id * 83 % 170, 60 + color_id * 113 % 170)
        for polygon in polygons:
            draw.polygon([pixel(point) for point in polygon.exterior.coords], fill=color, outline="#e5e5e5")
    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(destination, optimize=True)


def raster_stats(paths: list[Path]) -> Path:
    results = []
    for path in sorted(set(paths)):
        with rasterio.open(path) as src:
            minimum = None
            maximum = None
            for _, window in src.block_windows(1):
                valid = src.read(1, window=window, masked=True).compressed()
                if valid.size:
                    block_min = float(valid.min())
                    block_max = float(valid.max())
                    minimum = block_min if minimum is None else min(minimum, block_min)
                    maximum = block_max if maximum is None else max(maximum, block_max)
            results.append({
                "file": path.name,
                "width": src.width,
                "height": src.height,
                "count": src.count,
                "dtype": src.dtypes[0],
                "crs": str(src.crs),
                "bounds": list(src.bounds),
                "resolution": list(src.res),
                "nodata": src.nodata,
                "min": minimum,
                "max": maximum,
                "sha256": sha256_file(path),
            })
    output = SAMPLE_DIR / "raster_stats.json"
    write_json(output, {"rasters": results})
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare ARES Path analysis and sample data.")
    parser.add_argument("--aoi", default="data/aoi/jezero_delta_traverse.geojson")
    args = parser.parse_args()

    manifest = load_manifest()
    verify_downloaded_files()
    _, bbox = load_aoi(args.aoi)
    RASTER_DIR.mkdir(parents=True, exist_ok=True)

    d01 = dataset_by_id(manifest, "D-01")
    ctx_source = resolve(d01["destination"])
    if not ctx_source.exists():
        raise FileNotFoundError("CTX DEM is missing; run fetch.py first")
    ctx = crop_raster(ctx_source, RASTER_DIR / "ctx_dem_20m.tif", bbox, resolution=20)

    d02 = dataset_by_id(manifest, "D-02")
    dtm = crop_raster(d02["download_url"], resolve(d02["destination"]), bbox, resolution=1, resampling=Resampling.bilinear)
    d03 = dataset_by_id(manifest, "D-03")
    ortho = crop_raster(d03["download_url"], resolve(d03["destination"]), bbox, resolution=1, resampling=Resampling.bilinear)

    terrain = derive_terrain(dtm)
    crism = process_crism(manifest, RASTER_DIR / "routing_elevation_5m.tif")
    geology = process_geology(manifest, bbox)
    process_places(manifest, bbox)
    process_images(manifest)
    process_meda(manifest)

    browse_sources = {
        "ctx_dem.png": ctx,
        "hirise_dtm.png": dtm,
        "hirise_ortho.png": ortho,
        "slope.png": RASTER_DIR / "slope_5m.tif",
        "roughness.png": RASTER_DIR / "roughness_5m.tif",
        "crism_olindex3.png": RASTER_DIR / "crism_olindex3_5m.tif",
        "crism_d2300.png": RASTER_DIR / "crism_d2300_5m.tif",
        "crism_min2295_2480.png": RASTER_DIR / "crism_min2295_2480_5m.tif",
    }
    for name, source in browse_sources.items():
        raster_thumbnail(source, SAMPLE_DIR / "thumbnails" / name)
    geology_thumbnail(geology, SAMPLE_DIR / "thumbnails" / "geology.png", bbox)
    raster_stats([ctx, dtm, ortho, *terrain, *crism])
    print("\nPreprocessing completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
