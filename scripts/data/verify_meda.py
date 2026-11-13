"""Check complete CSV/XML pairs and recompute the curated MEDA historical summary."""

import csv, hashlib, json, xml.etree.ElementTree as ET
import preprocess
from _common import REPO_ROOT, load_manifest

NS = {"p": "http://pds.nasa.gov/pds4/pds/v1"}


def verify_and_aggregate():
    root = REPO_ROOT / "data/raw/meda"
    sources = []
    for sol in range(307, 314):
        folder = root / f"sol_{sol:04d}"
        for token in ["CAL_ATS", "CAL_TIRS", "DER_PS", "DER_WS"]:
            files = [p for p in folder.glob("*.CSV") if token in p.name]
            if len(files) != 1:
                raise ValueError(f"MEDA original incomplete: sol {sol} {token}")
            path = files[0]
            label = path.with_suffix(".xml")
            if not label.exists():
                label = path.with_suffix(".XML")
            if not label.exists():
                raise ValueError(f"XML label missing for {path}")
            xml = ET.parse(label)
            expected = int(xml.findtext(".//p:File/p:file_size", namespaces=NS))
            actual = path.stat().st_size
            if expected != actual:
                raise ValueError(
                    f"MEDA file size mismatch {path}: {actual} != {expected}"
                )
            sources.append(
                {
                    "sol": sol,
                    "token": token,
                    "csv": path.relative_to(REPO_ROOT).as_posix(),
                    "label": label.relative_to(REPO_ROOT).as_posix(),
                    "productId": xml.findtext(".//p:logical_identifier", namespaces=NS),
                    "start": xml.findtext(".//p:start_date_time", namespaces=NS),
                    "stop": xml.findtext(".//p:stop_date_time", namespaces=NS),
                    "bytes": actual,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "labelSha256": hashlib.sha256(label.read_bytes()).hexdigest(),
                }
            )
    preprocess.SAMPLE_DIR = REPO_ROOT / "data/prepared"
    preprocess.SAMPLE_DIR.mkdir(exist_ok=True)
    result = preprocess.process_meda(load_manifest())
    rows = list(csv.DictReader(result.open()))
    upstream = list(
        csv.DictReader((REPO_ROOT / "data/samples/meda_7sol_summary.csv").open())
    )
    if (
        len(rows) != 7
        or len(upstream) != 7
        or [r["sol"] for r in rows] != [str(s) for s in range(307, 314)]
    ):
        raise ValueError("MEDA summary must contain exactly sols 307–313")
    for new, old in zip(rows, upstream):
        for key in old:
            if key == "context":
                continue
            if abs(float(new[key]) - float(old[key])) > 0.0011:
                raise ValueError(
                    f"MEDA recomputation differs from upstream summary: sol {new['sol']}, {key}"
                )
    provenance = {
        "source": "NASA PDS MEDA calibrated/derived CSV + PDS4 labels",
        "products": sources,
        "verification": "All CSV sizes match their PDS4 XML file_size; SHA256 stored; seven-sol summary independently recomputed and matches upstream within rounding.",
        "summaryMethod": "Plausibility-range filtering (100–400 K, 0–2000 Pa, 0–100 m/s), no additional instrument quality-flag interpretation. TIRS supplies air/ground temperatures, DER_PS pressure and DER_WS wind. ATS originals are retained.",
        "spatialContext": "Measurements at historical rover positions in sols 307–313, before the delta-front stops used by this planner. No prediction, operational weather recommendation or current-local-weather claim.",
    }
    return rows, provenance


if __name__ == "__main__":
    rows, meta = verify_and_aggregate()
    out = REPO_ROOT / "data/prepared/meda-provenance.json"
    out.write_text(json.dumps(meta, indent=2) + "\n")
    print(
        "MEDA verified:",
        len(meta["products"]),
        "CSV/XML pairs,",
        len(rows),
        "recomputed sols",
    )
