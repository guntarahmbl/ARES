"""Align validated local science products and package the browser's offline dataset."""

import base64, csv, hashlib, json, math
import fiona, numpy as np, rasterio
from PIL import Image
from pyproj import CRS, Transformer
from rasterio.transform import from_origin
from rasterio.warp import reproject, Resampling
from shapely.geometry import shape, box, mapping, Point
from shapely.ops import transform as transform_geometry
from fetch_local import ROOT, CENTER, GEOGRAPHIC
from _common import load_manifest

RAW = ROOT / "data/raw"
OUT = ROOT / "data/prepared"
OUT.mkdir(exist_ok=True)
ANALYSIS = "+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +R=3396190 +units=m +no_defs"
forward = Transformer.from_crs(GEOGRAPHIC, ANALYSIS, always_xy=True)
backward = Transformer.from_crs(ANALYSIS, GEOGRAPHIC, always_xy=True)
cx, cy = forward.transform(*CENTER)
size = 81
step = 5
left = cx - size * step / 2
top = cy + size * step / 2
transform = from_origin(left, top, step, step)
profile = {
    "driver": "GTiff",
    "width": size,
    "height": size,
    "count": 1,
    "dtype": "float32",
    "nodata": -9999,
    "crs": ANALYSIS,
    "transform": transform,
    "compress": "deflate",
}
manifest = load_manifest()
source_by_id = {d["id"]: d for d in manifest["datasets"]}


def warp(path, n=81, resolution=5, resampling=Resampling.bilinear):
    t = from_origin(left, top, resolution, resolution)
    result = np.full((n, n), -9999, dtype=np.float32)
    with rasterio.open(path) as src:
        reproject(
            rasterio.band(src, 1),
            result,
            src_transform=src.transform,
            src_crs=src.crs,
            src_nodata=src.nodata,
            dst_transform=t,
            dst_crs=ANALYSIS,
            dst_nodata=-9999,
            resampling=resampling,
        )
    return result


def write(name, data, nodata=-9999):
    p = profile.copy()
    p.update(
        width=data.shape[1],
        height=data.shape[0],
        transform=from_origin(
            left, top, size * step / data.shape[1], size * step / data.shape[0]
        ),
        nodata=nodata,
    )
    with rasterio.open(OUT / name, "w", **p) as dst:
        dst.write(data.astype(np.float32), 1)


# Preserve one aligned 1 m elevation crop as well as the analysis grid.
fine = warp(RAW / "local/hirise_dtm.tif", 405, 1)
elevation = fine.reshape(81, 5, 81, 5).mean(axis=(1, 3))
valid = (np.isfinite(fine) & (fine != -9999)).reshape(81, 5, 81, 5).all(axis=(1, 3))
if not np.all(valid):
    raise ValueError("Study requires complete DEM coverage before integration")
dy, dx = np.gradient(elevation, step, step)
slope = np.degrees(np.arctan(np.hypot(dx, dy)))
pad = np.pad(elevation, 1, mode="edge")
neighborhood = np.stack(
    [pad[r : r + size, c : c + size] for r in range(3) for c in range(3)]
)
roughness_m = np.std(neighborhood, axis=0)
roughness = np.clip(roughness_m / max(0.1, float(np.percentile(roughness_m, 95))), 0, 1)
write("hirise_dtm_1m.tif", fine)
write("elevation_5m.tif", elevation)
write("slope_5m.tif", slope)
write("roughness_5m.tif", roughness_m)
ctx = warp(RAW / "local/ctx_dem.tif")
write("ctx_dem_context.tif", ctx)
image = warp(RAW / "local/hirise_ortho.tif", 810, 0.5)
image_valid = image != -9999
if np.count_nonzero(image_valid) / image.size < 0.99:
    raise ValueError("Orbital image coverage insufficient")
lo, hi = np.percentile(image[image_valid], [1, 99])
gray = np.clip((image - lo) / (hi - lo) * 255, 0, 255).astype(np.uint8)
Image.fromarray(gray).save(OUT / "orbital-basemap.jpg", quality=90, optimize=True)
# Coarse source samples are used for 3D tinting; the full-resolution image is retained separately.
image_grid = gray.reshape(81, 10, 81, 10).mean(axis=(1, 3))
crism = {}
for band in ["olindex3", "d2300", "min2295_2480"]:
    values = warp(RAW / f"crism/{band}.tif", resampling=Resampling.nearest)
    write(f"crism_{band}_5m.tif", values)
    crism[band] = [
        round(float(v), 7) if v != -9999 and np.isfinite(v) else None
        for v in values.ravel()
    ]
    if sum(v is not None for v in crism[band]) / len(crism[band]) < 0.95:
        raise ValueError("CRISM footprint does not cover the local study")
# Preserve the geological map's 100–200 m registration uncertainty; use only as context.
features = []
geology_ids = np.full((size, size), -1, dtype=int)
study_box = box(left, top - size * step, left + size * step, top)
with fiona.open(RAW / "geology/Nili.gdb", layer="GeoUnits_v1") as src:
    project = Transformer.from_crs(CRS.from_wkt(src.crs_wkt), ANALYSIS, always_xy=True)
    for item in src:
        geom = transform_geometry(project.transform, shape(item["geometry"]))
        if not geom.intersects(study_box):
            continue
        clipped = geom.intersection(study_box)
        props = dict(item["properties"])
        features.append(
            {
                "type": "Feature",
                "properties": props,
                "geometry": mapping(transform_geometry(backward.transform, clipped)),
            }
        )
        for row in range(size):
            for col in range(size):
                if clipped.covers(
                    Point(cx + (col - 40) * step, cy - (row - 40) * step)
                ):
                    geology_ids[row, col] = len(features) - 1
(OUT / "geology.geojson").write_text(
    json.dumps(
        {
            "type": "FeatureCollection",
            "source": "USGS SIM 3464 GeoUnits_v1",
            "registrationUncertaintyMeters": [100, 200],
            "features": features,
        },
        indent=2,
    )
    + "\n"
)
rows = list(csv.DictReader((RAW / "best_interp.csv").open()))
poses = [r for r in rows if r["frame"] == "ROVER"]
local = []
for r in poses:
    x, y = forward.transform(float(r["longitude"]), float(r["planetocentric_latitude"]))
    lx, lz = x - cx, cy - y
    if abs(lx) <= 200 and abs(lz) <= 200:
        local.append(
            {
                "x": round(lx, 3),
                "z": round(lz, 3),
                "longitude": float(r["longitude"]),
                "latitude": float(r["planetocentric_latitude"]),
                "sol": int(r["sol"]),
                "site": int(r["site"]),
                "drive": int(r["drive"]),
                "sclk": r["sclk"],
            }
        )
local.sort(key=lambda r: int(r["sclk"]))
dedup = []
for p in local:
    if not dedup or math.hypot(p["x"] - dedup[-1]["x"], p["z"] - dedup[-1]["z"]) > 0.5:
        dedup.append(p)
# Disjoint segments retain temporal/spatial gaps rather than drawing invented connecting lines.
segments = []
for p in dedup:
    if (
        not segments
        or math.hypot(p["x"] - segments[-1][-1]["x"], p["z"] - segments[-1][-1]["z"])
        > 30
        or p["sol"] - segments[-1][-1]["sol"] > 10
    ):
        segments.append([])
    segments[-1].append(p)
photo_manifest = json.loads((RAW / "local-images/manifest.json").read_text())
targets = []
for index, (sol, title, priority) in enumerate(
    [
        (645, "Sol 645 · delta approach", 3),
        (647, "Sol 647 · delta-front stop", 2),
        (646, "Sol 646 · intermediate exposure", 1),
    ]
):
    r = [r for r in poses if int(r["sol"]) == sol][-1]
    lon, lat = float(r["longitude"]), float(r["planetocentric_latitude"])
    x, y = forward.transform(lon, lat)
    lx, lz = x - cx, cy - y
    col, row = round(lx / step) + 40, round(lz / step) + 40
    if not (0 <= col < size and 0 <= row < size):
        raise ValueError("Target outside prepared study")
    images = []
    for photo in photo_manifest:
        if photo["sol"] != sol:
            continue
        path = ROOT / photo["localPath"]
        p = photo["localization"]
        px, py = forward.transform(p["longitude"], p["latitude"])
        distance = math.hypot(px - x, py - y)
        images.append(
            {
                "productId": photo["imageid"],
                "sol": sol,
                "instrument": photo["camera"]["instrument"],
                "site": int(photo["site"]),
                "drive": int(photo["drive"]),
                "date": photo["date_taken_utc"],
                "credit": photo["credit"],
                "url": photo["link"],
                "imageUrl": photo["image_files"]["medium"],
                "cameraLongitude": p["longitude"],
                "cameraLatitude": p["latitude"],
                "distanceToWaypointMeters": round(distance, 1),
                "association": "Exact camera site/drive localization; photograph subject/footprint is not georeferenced",
                "dataUri": "data:image/jpeg;base64,"
                + base64.b64encode(path.read_bytes()).decode(),
            }
        )
    if not images:
        raise ValueError("Target has no surface evidence")
    g = geology_ids[row, col]
    unit = (
        features[g]["properties"]
        if g >= 0
        else {"symbol": "Unmapped", "name": "No regional unit"}
    )
    targets.append(
        {
            "id": chr(65 + index),
            "title": title,
            "x": col * step - 200,
            "z": row * step - 200,
            "actualX": round(lx, 3),
            "actualZ": round(lz, 3),
            "longitude": lon,
            "latitude": lat,
            "localizationErrorMeters": round(
                math.hypot(lx - (col * step - 200), lz - (row * step - 200)), 2
            ),
            "site": int(r["site"]),
            "drive": int(r["drive"]),
            "sol": sol,
            "category": unit["symbol"],
            "priority": priority,
            "minutes": [12, 10, 8][index],
            "value": [30, 24, 18][index],
            "rationale": f"Observe the terrain documented at the sol {sol} rover stop and compare its {unit['name']} regional context with nearby CRISM summary parameters. The geological boundary has 100–200 m registration uncertainty.",
            "activity": "Record surface texture and stratigraphic context; proposed EVA observation, not a historical rover activity.",
            "evidence": f"Rover PLACES site {r['site']}, drive {r['drive']}; {len(images)} locally stored surface photographs with exact site/drive camera positions.",
            "source": "geology",
            "geologicUnit": unit["name"],
            "images": images,
            "mineralIndicators": {
                band: crism[band][row * size + col] for band in crism
            },
        }
    )
from verify_meda import verify_and_aggregate

meda, meda_provenance = verify_and_aggregate()
(OUT / "meda-provenance.json").write_text(json.dumps(meda_provenance, indent=2) + "\n")
assets = {
    "basemap": "data:image/jpeg;base64,"
    + base64.b64encode((OUT / "orbital-basemap.jpg").read_bytes()).decode()
}
sources = []
for id, kind in [
    ("D-01", "Measured"),
    ("D-02", "Measured → derived"),
    ("D-03", "Measured"),
    ("D-04", "Interpreted"),
    ("D-05", "Remote-sensing indicators"),
    ("D-06", "Measured localization"),
    ("D-07", "Measured imagery"),
    ("D-08", "Historical measured → aggregated"),
]:
    d = source_by_id[id]
    sources.append(
        {
            **d,
            "classification": kind,
            "status": "Locally available",
            "limitations": {
                "D-01": "20 m contextual DEM; not the local routing surface.",
                "D-02": "1 m stereo DTM resampled to a 5 m analysis grid; unresolved rocks and stereo artifacts remain.",
                "D-03": "0.25 m grayscale orthomosaic resampled to 0.5 m for the browser.",
                "D-04": "Regional 1:75,000 interpretation, with documented 100–200 m offset from controlled mosaics. Excluded from traversal cost.",
                "D-05": "18 m native pixels shown using nearest-neighbor sampling; 5 m display does not increase mineral resolution. Indicators are not mineral ground truth.",
                "D-06": "Planetocentric geographic coordinates transformed to the common Mars sphere. A rover track does not certify astronaut safety.",
                "D-07": "Images joined to exact rover site/drive; camera position is not the photographed footprint.",
                "D-08": "Sols 307–313 precede this local traverse. Historical context at the rover then; not a forecast or local-time recommendation.",
            }[id],
        }
    )
dataset = {
    "version": 1,
    "name": "Jezero delta-front EVA",
    "kind": "measured",
    "center": {
        "longitude": CENTER[0],
        "latitude": CENTER[1],
        "easting": cx,
        "northing": cy,
    },
    "crs": ANALYSIS,
    "geographicCRS": GEOGRAPHIC,
    "size": size,
    "cellSize": step,
    "origin": -200,
    "bounds": {
        "left": left,
        "bottom": top - size * step,
        "right": left + size * step,
        "top": top,
    },
    "transform": list(transform),
    "elevationDatum": "Source HiRISE DTM MOLA topography / DeltaGeoid, meters; retain published vertical datum",
    "renderDatumMeters": round(float(np.median(elevation)), 3),
    "elevation": [round(float(v), 3) for v in elevation.ravel()],
    "slope": [round(float(v), 3) for v in slope.ravel()],
    "roughness": [round(float(v), 4) for v in roughness.ravel()],
    "roughnessMeters": [round(float(v), 3) for v in roughness_m.ravel()],
    "surfaceGray": [round(float(v)) for v in image_grid.ravel()],
    "valid": valid.astype(int).ravel().tolist(),
    "crism": crism,
    "geologyIndex": geology_ids.ravel().tolist(),
    "geologyUnits": [f["properties"] for f in features],
    "traverse": segments,
    "targets": targets,
    "meda": meda,
    "sources": sources,
    "assets": assets,
    "assumptions": {
        "habitat": "Hypothetical location on measured terrain",
        "energy": "Abstract heuristic model units; not measured astronaut energy",
        "science": "Proposed observation priorities and visit durations are assumptions",
        "geologyRegistrationUncertaintyMeters": [100, 200],
    },
    "processing": {
        "script": "scripts/data/prepare_local.py",
        "rasterAlignment": "All analysis arrays share the exact same 81×81, 5 m transform",
        "crismResampling": "nearest, preserving native 18 m footprint limitations",
        "imageryResampling": "bilinear to 0.5 m",
        "elevationResampling": "bilinear to 1 m, 5×5 mean to 5 m",
        "nodata": "No unmeasured pixels are allowed as traversable",
        "roughness": "3×3 standard deviation of 5 m elevation, normalized by 95th percentile",
        "geology": "Full source geodatabase reprojected/clipped, not used for navigation",
    },
}
(OUT / "study.json").write_text(
    json.dumps(dataset, separators=(",", ":"), allow_nan=False) + "\n"
)
(OUT / "sources.json").write_text(
    json.dumps(
        {
            "sources": sources,
            "rasterWindows": [
                json.loads(p.read_text())
                for p in sorted((RAW / "local").glob("*.json"))
            ],
            "crismExtraction": json.loads(
                (RAW / "crism/local-extraction.json").read_text()
            ),
            "geologyArchive": json.loads((RAW / "geology/source.json").read_text()),
            "roverPlaces": {
                "url": source_by_id["D-06"]["base_url"] + "best_interp.csv",
                "sha256": hashlib.sha256(
                    (RAW / "best_interp.csv").read_bytes()
                ).hexdigest(),
                "rows": len(rows),
            },
            "processing": dataset["processing"],
        },
        indent=2,
    )
    + "\n"
)
print(
    "PREPARED",
    len(sources),
    "source products;",
    len(targets),
    "targets;",
    len(photo_manifest),
    "photos;",
    len(local),
    "rover poses; geology",
    [(f["properties"]["symbol"], f["properties"]["name"]) for f in features],
    flush=True,
)
print(
    "GRID elevation",
    elevation.min(),
    elevation.max(),
    "slope",
    slope.min(),
    slope.max(),
    "basemap",
    gray.shape,
    "dataset MB",
    (OUT / "study.json").stat().st_size / 1e6,
    flush=True,
)
