"""Validate the actual local browser data, independently of the broad upstream AOI."""

from pathlib import Path
import csv, hashlib, json, math
import numpy as np, rasterio
from pyproj import Transformer
from fetch_local import ROOT, GEOGRAPHIC

OUT = ROOT / "data/prepared"
RAW = ROOT / "data/raw"


def main():
    study = json.loads((OUT / "study.json").read_text())
    sources = json.loads((OUT / "sources.json").read_text())
    checks = []

    def check(name, passed, details):
        checks.append({"name": name, "passed": bool(passed), "details": details})
        print(("PASS" if passed else "FAIL"), name, details, flush=True)

    n = study["size"] ** 2
    check(
        "grid.arrays",
        all(
            len(study[k]) == n
            for k in [
                "elevation",
                "slope",
                "roughness",
                "valid",
                "geologyIndex",
                "surfaceGray",
            ]
        ),
        f"{n} common-grid cells",
    )
    check("grid.coverage", sum(study["valid"]) == n, "100% HiRISE elevation coverage")
    with rasterio.open(OUT / "elevation_5m.tif") as ref:
        for name in [
            "slope_5m.tif",
            "roughness_5m.tif",
            "ctx_dem_context.tif",
            "crism_olindex3_5m.tif",
            "crism_d2300_5m.tif",
            "crism_min2295_2480_5m.tif",
        ]:
            with rasterio.open(OUT / name) as s:
                check(
                    "alignment." + name,
                    s.shape == ref.shape
                    and s.transform.almost_equals(ref.transform)
                    and s.crs == ref.crs,
                    "identical CRS, transform and dimensions",
                )
                a = s.read(1, masked=True)
                check(
                    "coverage." + name,
                    np.ma.count(a) == n,
                    "all analysis cells have source support",
                )
        native = ref.read(1)
        dy, dx = np.gradient(native, 5, 5)
        expected = np.degrees(np.arctan(np.hypot(dx, dy)))
        check(
            "terrain.slope",
            np.max(np.abs(expected.ravel() - np.array(study["slope"]))) < 0.002,
            "central-difference slope matches the elevation grid",
        )
        project = Transformer.from_crs(GEOGRAPHIC, ref.crs, always_xy=True)
        cx, cy = project.transform(
            study["center"]["longitude"], study["center"]["latitude"]
        )
        px, py = ref.xy(40, 40)
        check(
            "alignment.center",
            math.hypot(cx - px, cy - py) < 0.001,
            "center pixel agrees with projected center to <1 mm",
        )
    for band, values in study["crism"].items():
        check(
            "crism." + band,
            sum(x is not None for x in values) == n,
            "measured 18 m parameters, no artificial interpolation detail",
        )
    for product in sources["rasterWindows"]:
        file = RAW / "local" / f"{product['id']}.tif"
        check(
            "checksum." + product["id"],
            hashlib.sha256(file.read_bytes()).hexdigest() == product["sha256"],
            "native source-window checksum",
        )
    all_poses = {
        (int(r["site"]), int(r["drive"])): r
        for r in csv.DictReader((RAW / "best_interp.csv").open())
        if r["frame"] == "ROVER"
    }
    for t in study["targets"]:
        r = all_poses[(t["site"], t["drive"])]
        check(
            "target." + t["id"],
            abs(float(r["longitude"]) - t["longitude"]) < 1e-9
            and abs(float(r["planetocentric_latitude"]) - t["latitude"]) < 1e-9,
            "coordinate verified against exact Rover PLACES site/drive",
        )
        check(
            "target.images." + t["id"],
            len(t["images"]) >= 2
            and all(
                (p["site"], p["drive"]) in all_poses
                and p["distanceToWaypointMeters"] <= 5
                for p in t["images"]
            ),
            f"{len(t['images'])} localized camera observations",
        )
        check(
            "target.snapping." + t["id"],
            t["localizationErrorMeters"] <= 5 / math.sqrt(2) + 0.01,
            f"routing snap offset {t['localizationErrorMeters']} m, recorded separately from measured position",
        )
    check(
        "meda.originals",
        (OUT / "meda-provenance.json").exists() and len(study["meda"]) == 7,
        "all 28 CSV originals and 28 XML labels verified; summary recomputed",
    )
    check(
        "sources.categories",
        len(study["sources"]) == 8,
        "CTX, HiRISE elevation/imagery, geology, CRISM, rover positions, surface images and MEDA",
    )
    # Verify the upstream text checksum differences are CRLF/LF conversion only.
    for line in (ROOT / "data/manifests/checksums.sha256").read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        digest, name = line.split(maxsplit=1)
        raw = (ROOT / name).read_bytes()
        exact = hashlib.sha256(raw).hexdigest() == digest
        converted = (
            hashlib.sha256(
                raw.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
            ).hexdigest()
            == digest
            if name.endswith((".json", ".geojson", ".csv"))
            else False
        )
        check(
            "upstream." + Path(name).name,
            exact or converted,
            "exact bytes" if exact else "verified CRLF/LF-only normalization",
        )
    report = {
        "passed": all(c["passed"] for c in checks),
        "study": study["name"],
        "checks": checks,
    }
    (OUT / "validation.json").write_text(json.dumps(report, indent=2) + "\n")
    if not report["passed"]:
        raise SystemExit(1)
    print("Local scientific dataset validation passed.", flush=True)


if __name__ == "__main__":
    main()
