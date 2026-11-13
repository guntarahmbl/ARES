from __future__ import annotations

import csv
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from rasterio.warp import transform, transform_bounds
from shapely.geometry import box, shape

from _common import DATA_ROOT, REPO_ROOT, load_aoi, load_manifest, sha256_file, write_json


MARS_GEOGRAPHIC = "+proj=longlat +R=3396190 +no_defs"
REQUIRED_MANIFEST_FIELDS = {
    "id", "title", "tier", "kind", "product_id", "version", "catalog_url",
    "format", "expected_size_bytes", "checksum", "destination", "crs",
    "resolution_m", "license", "attribution", "processing",
}


class Report:
    def __init__(self) -> None:
        self.checks: list[dict[str, Any]] = []

    def add(self, name: str, passed: bool, detail: str) -> None:
        self.checks.append({"name": name, "passed": passed, "detail": detail})
        print(f"{'PASS' if passed else 'FAIL'} {name}: {detail}")

    @property
    def passed(self) -> bool:
        return all(item["passed"] for item in self.checks)


def validate_manifest(report: Report, manifest: dict[str, Any]) -> None:
    ids = []
    for dataset in manifest["datasets"]:
        ids.append(dataset["id"])
        missing = REQUIRED_MANIFEST_FIELDS - set(dataset)
        report.add(f"manifest.{dataset['id']}", not missing, "complete" if not missing else f"missing {sorted(missing)}")
    report.add("manifest.unique_ids", len(ids) == len(set(ids)), f"{len(ids)} dataset IDs")
    report.add("manifest.crism_location", next(item for item in manifest["datasets"] if item["id"] == "D-05")["product_id"].startswith("FRT00005C5E"), "Jezero product selected")


def validate_aoi(report: Report) -> tuple[float, float, float, float]:
    data, bounds = load_aoi()
    expected = (77.335, 18.420, 77.455, 18.500)
    report.add("aoi.geometry", data["features"][0]["geometry"]["type"] == "Polygon", str(bounds))
    report.add("aoi.bounds", all(abs(a - b) < 1e-9 for a, b in zip(bounds, expected)), str(bounds))
    return bounds


def validate_samples(report: Report, bounds: tuple[float, float, float, float]) -> None:
    aoi = box(*bounds)
    waypoint_path = DATA_ROOT / "samples" / "science_waypoints.geojson"
    waypoints = json.loads(waypoint_path.read_text(encoding="utf-8"))["features"]
    waypoint_ok = len(waypoints) == 3 and all(
        aoi.covers(shape(item["geometry"]))
        and item["properties"].get("source")
        and item["properties"].get("science_rationale")
        for item in waypoints
    )
    report.add("samples.waypoints", waypoint_ok, f"{len(waypoints)} waypoints")

    traverse_path = DATA_ROOT / "samples" / "rover_traverse_simplified.geojson"
    traverse = json.loads(traverse_path.read_text(encoding="utf-8"))["features"]
    traverse_geometry = shape(traverse[0]["geometry"]) if len(traverse) == 1 else None
    traverse_ok = (
        traverse_geometry is not None
        and traverse_geometry.geom_type == "LineString"
        and len(traverse[0]["geometry"]["coordinates"]) >= 10
        and traverse_geometry.is_valid
        and aoi.covers(traverse_geometry)
    )
    report.add("samples.traverse", traverse_ok, f"{len(traverse)} feature(s)")

    with (DATA_ROOT / "samples" / "surface_images.csv").open(encoding="utf-8", newline="") as stream:
        images = list(csv.DictReader(stream))
    image_counts = {item["properties"]["id"]: 0 for item in waypoints}
    for row in images:
        if row["waypoint_id"] in image_counts:
            image_counts[row["waypoint_id"]] += 1
    thumbnails = list((DATA_ROOT / "samples" / "thumbnails" / "surface").glob("*.jpg"))
    report.add("samples.surface_images", len(images) == 12 and all(count >= 2 for count in image_counts.values()), f"{len(images)} rows, {image_counts}")
    report.add("samples.surface_thumbnails", len(thumbnails) == 12, f"{len(thumbnails)} files")

    with (DATA_ROOT / "samples" / "meda_7sol_summary.csv").open(encoding="utf-8", newline="") as stream:
        meda = list(csv.DictReader(stream))
    meda_ok = (
        len(meda) == 7
        and all(row["context"] == "historical observation; not a forecast" for row in meda)
        and all(int(row["pressure_n"]) > 0 and int(row["temperature_n"]) > 0 and int(row["wind_n"]) > 0 for row in meda)
        and all(0 <= float(row["horizontal_wind_m_s_max"]) <= 100 for row in meda)
    )
    report.add("samples.meda", meda_ok, f"{len(meda)} sols")

    geology_path = DATA_ROOT / "samples" / "geology_units.geojson"
    geology_count = 0
    if geology_path.exists():
        geology_count = len(json.loads(geology_path.read_text(encoding="utf-8"))["features"])
    report.add("samples.geology", geology_count > 0, f"{geology_count} clipped features")
    geology_thumbnail = DATA_ROOT / "samples" / "thumbnails" / "geology.png"
    report.add("samples.geology_thumbnail", geology_thumbnail.exists(), geology_thumbnail.name)


def validate_rasters(report: Report, bounds: tuple[float, float, float, float]) -> None:
    required = [
        "ctx_dem_20m.tif", "hirise_dtm_1m.tif", "hirise_ortho_1m.tif",
        "routing_elevation_5m.tif", "slope_5m.tif", "roughness_5m.tif",
        "hillshade_5m.tif", "traversability_mask_5m.tif",
        "crism_olindex3_5m.tif", "crism_d2300_5m.tif", "crism_min2295_2480_5m.tif",
    ]
    raster_dir = DATA_ROOT / "processed" / "rasters"
    aoi = box(*bounds)
    grids = []
    for name in required:
        path = raster_dir / name
        if not path.exists():
            report.add(f"raster.{name}", False, "missing")
            continue
        with rasterio.open(path) as src:
            geographic = transform_bounds(src.crs, MARS_GEOGRAPHIC, *src.bounds, densify_pts=21)
            coverage = box(*geographic).intersection(aoi).area / aoi.area
            valid = src.crs is not None and src.nodata is not None and coverage >= 0.98
            report.add(f"raster.{name}", valid, f"{src.width}x{src.height}, coverage={coverage:.1%}, nodata={src.nodata}")
            if name.endswith("_5m.tif"):
                grids.append((src.width, src.height, tuple(src.transform), str(src.crs)))
    report.add("raster.grid_alignment", bool(grids) and len(set(grids)) == 1, f"{len(set(grids))} unique routing grids")

    dtm_path = raster_dir / "hirise_dtm_1m.tif"
    ortho_path = raster_dir / "hirise_ortho_1m.tif"
    with rasterio.open(dtm_path) as dtm, rasterio.open(ortho_path) as ortho:
        controls = [(0.1, 0.1), (0.9, 0.1), (0.5, 0.5), (0.1, 0.9), (0.9, 0.9)]
        valid_controls = 0
        for x_fraction, y_fraction in controls:
            row = min(dtm.height - 1, round(y_fraction * (dtm.height - 1)))
            col = min(dtm.width - 1, round(x_fraction * (dtm.width - 1)))
            if not dtm.read(1, window=((row, row + 1), (col, col + 1)), masked=True).mask.all() and not ortho.read(1, window=((row, row + 1), (col, col + 1)), masked=True).mask.all():
                valid_controls += 1
        aligned = dtm.shape == ortho.shape and dtm.transform.almost_equals(ortho.transform) and valid_controls == 5
    report.add("raster.imagery_dem_controls", aligned, f"{valid_controls}/5 valid aligned controls")

    waypoint_data = json.loads((DATA_ROOT / "samples" / "science_waypoints.geojson").read_text(encoding="utf-8"))
    coordinates = [feature["geometry"]["coordinates"] for feature in waypoint_data["features"]]
    with rasterio.open(raster_dir / "crism_olindex3_5m.tif") as crism:
        xs, ys = transform(MARS_GEOGRAPHIC, crism.crs, [point[0] for point in coordinates], [point[1] for point in coordinates])
        samples = list(crism.sample(zip(xs, ys), masked=True))
        crism_hits = sum(not np.ma.getmaskarray(sample).all() for sample in samples)
    report.add("raster.crism_waypoints", crism_hits >= 1, f"{crism_hits}/3 waypoints covered")


def tracked_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "data"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return [REPO_ROOT / line for line in result.stdout.splitlines() if line]


def validate_git_budget(report: Report) -> None:
    tracked = [path for path in tracked_files() if path.exists()]
    oversized = [path for path in tracked if path.stat().st_size > 10 * 1024 * 1024]
    sample_total = sum(path.stat().st_size for path in (DATA_ROOT / "samples").rglob("*") if path.is_file())
    report.add("git.max_file", not oversized, "none" if not oversized else ", ".join(path.name for path in oversized))
    report.add("git.sample_budget", sample_total <= 40 * 1024 * 1024, f"{sample_total / 1024 / 1024:.2f} MiB")


def write_sample_checksums() -> None:
    roots = [DATA_ROOT / "aoi", DATA_ROOT / "samples"]
    files = sorted(path for root in roots for path in root.rglob("*") if path.is_file() and path.name != ".gitkeep")
    target = DATA_ROOT / "manifests" / "checksums.sha256"
    lines = ["# Git-tracked ARES Path sample checksums"]
    lines.extend(f"{sha256_file(path)}  {path.relative_to(REPO_ROOT).as_posix()}" for path in files)
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    report = Report()
    manifest = load_manifest()
    validate_manifest(report, manifest)
    bounds = validate_aoi(report)
    validate_samples(report, bounds)
    validate_rasters(report, bounds)
    validate_git_budget(report)
    write_sample_checksums()
    output = DATA_ROOT / "processed" / "validation_report.json"
    dataset_statuses = [
        {
            "id": dataset["id"],
            "status": "processed" if report.passed and dataset["tier"] == "core" else "validated" if report.passed else "failed",
        }
        for dataset in manifest["datasets"]
    ]
    write_json(output, {"passed": report.passed, "datasets": dataset_statuses, "checks": report.checks})
    print(f"\nValidation {'passed' if report.passed else 'failed'}; report: {output.relative_to(REPO_ROOT)}")
    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
