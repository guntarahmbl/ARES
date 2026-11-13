"""Reproduce the complete local demonstration data, then validate before browser use."""

import argparse, subprocess, sys, urllib.request, hashlib, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data/raw"
RAW.mkdir(exist_ok=True)


def run(script, *args):
    subprocess.run(
        [sys.executable, str(ROOT / "scripts/data" / script), *args],
        check=True,
        cwd=ROOT,
    )


def small_source(url, path):
    if path.exists():
        return
    with urllib.request.urlopen(
        urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60
    ) as response:
        path.write_bytes(response.read())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--download",
        action="store_true",
        help="Fetch required source pixels, vector data, photos and seven-sol MEDA originals.",
    )
    args = parser.parse_args()
    if args.download:
        places = "https://pds-geosciences.wustl.edu/m2020/urn-nasa-pds-mars2020_rover_places/data_localizations/"
        for name in ["best_interp.csv", "best_interp.csv.xml"]:
            small_source(places + name, RAW / name)
        folder = RAW / "crism"
        folder.mkdir(exist_ok=True)
        crism = "https://pds-geosciences.wustl.edu/mro/mro-m-crism-5-rdr-mptargeted-v1/mrocr_4001/mtrdr/2007/2007_139/frt00005c5e/"
        for suffix in ["hdr", "lbl", "xml"]:
            name = "frt00005c5e_07_su166j_mtr3." + suffix
            small_source(crism + name, folder / name)
        run("fetch_local.py")
        run("fetch_geology.py")
        run("fetch_crism_local.py")
        run("fetch_local_observations.py")
        run("fetch_meda_parallel.py")
    run("prepare_local.py")
    run("validate_local.py")
    files = sorted(p for p in RAW.rglob("*") if p.is_file())
    inventory = {
        "scope": "Originals/native windows retained for the local Jezero EVA",
        "files": [
            {
                "path": p.relative_to(ROOT).as_posix(),
                "bytes": p.stat().st_size,
                "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
            }
            for p in files
        ],
    }
    (ROOT / "data/prepared/download-inventory.json").write_text(
        json.dumps(inventory, indent=2) + "\n"
    )
    print("Ready: data/prepared/study.json, source inventory and validation report.")


if __name__ == "__main__":
    main()
