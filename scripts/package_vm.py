"""Package a prepared ARES runtime for Dokploy's ZIP deployment."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
RASTERS = (
    "routing_elevation_5m.tif", "slope_5m.tif", "roughness_5m.tif",
    "traversability_mask_5m.tif", "crism_olindex3_5m.tif",
    "crism_d2300_5m.tif", "crism_min2295_2480_5m.tif",
)


def main() -> None:
    required = [ROOT / "app/dist/index.html", ROOT / "data/processed/3d/scene.json"]
    required.extend(ROOT / "data/processed/rasters" / name for name in RASTERS)
    for path in required:
        if not path.is_file():
            raise FileNotFoundError(f"Prepare the frontend and scientific data first: {path}")

    output = ROOT / "dist/ares-vm.zip"
    output.parent.mkdir(exist_ok=True)
    directories = (
        "server", "app/dist", "data/aoi", "data/manifests", "data/samples",
        "data/processed/web", "data/processed/3d",
    )
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
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
