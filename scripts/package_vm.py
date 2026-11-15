"""Package a prepared ARES runtime for Dokploy's ZIP deployment."""
import argparse
import re
import subprocess
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
RASTERS = (
    "routing_elevation_5m.tif", "slope_5m.tif", "roughness_5m.tif",
    "traversability_mask_5m.tif", "crism_olindex3_5m.tif",
    "crism_d2300_5m.tif", "crism_min2295_2480_5m.tif",
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-only", action="store_true", help="Package generated runtime data for private R2 storage")
    parser.add_argument("--revision", help="Git commit included in the deployed health endpoint")
    args = parser.parse_args()
    required = [ROOT / "data/processed/3d/scene.json", ROOT / "data/processed/web/basemap.webp"]
    if not args.data_only:
        required.append(ROOT / "app/dist/index.html")
    required.extend(ROOT / "data/processed/rasters" / name for name in RASTERS)
    for path in required:
        if not path.is_file():
            raise FileNotFoundError(f"Prepare the frontend and scientific data first: {path}")

    output = ROOT / ("dist/ares-vm-data.zip" if args.data_only else "dist/ares-vm.zip")
    output.parent.mkdir(exist_ok=True)
    directories = ["data/processed/web", "data/processed/3d"]
    if not args.data_only:
        directories.extend(["server", "app/dist", "data/aoi", "data/manifests", "data/samples"])
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        if not args.data_only:
            revision = args.revision or subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True,
            ).strip()
            if not re.fullmatch(r"[0-9a-f]{40}", revision):
                raise ValueError("Revision must be a full Git commit SHA")
            archive.writestr("release.txt", revision + "\n")
            archive.write(ROOT / "deploy/Dockerfile", "Dockerfile")
            for name in ("requirements-app.txt", "requirements-data.txt"):
                archive.write(ROOT / name, name)
        for directory in directories:
            archive.writestr(directory + "/", "")
            for path in sorted((ROOT / directory).rglob("*")):
                if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc":
                    archive.write(path, path.relative_to(ROOT))
        for name in RASTERS:
            path = ROOT / "data/processed/rasters" / name
            archive.write(path, path.relative_to(ROOT))
    print(f"Created {output} ({output.stat().st_size / 1024**2:.1f} MiB)")


if __name__ == "__main__":
    main()
