from __future__ import annotations

import argparse
import http.client
import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from _common import DATA_ROOT, load_manifest, resolve, sha256_file, write_json


USER_AGENT = "ARES-Path-Data-Acquisition/1.0"


def request(url: str, method: str = "GET", headers: dict[str, str] | None = None):
    merged = {"User-Agent": USER_AGENT}
    if headers:
        merged.update(headers)
    resource = urllib.request.Request(url, method=method, headers=merged)
    for attempt in range(3):
        try:
            return urllib.request.urlopen(resource, timeout=120)
        except (urllib.error.URLError, http.client.RemoteDisconnected, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Unable to request {url}")


def download(url: str, destination: Path, expected_sha256: str | None = None, force: bool = False) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and not force:
        actual = sha256_file(destination)
        if expected_sha256 and actual.lower() != expected_sha256.lower():
            raise ValueError(f"Checksum mismatch for existing file: {destination}")
        print(f"EXISTS   {destination.relative_to(resolve('.'))}")
        return actual

    temporary = destination.with_suffix(destination.suffix + ".part")
    start = temporary.stat().st_size if temporary.exists() else 0
    headers = {"Range": f"bytes={start}-"} if start else {}
    try:
        with request(url, headers=headers) as response:
            append = start > 0 and response.status == 206
            mode = "ab" if append else "wb"
            with temporary.open(mode) as stream:
                while chunk := response.read(1024 * 1024):
                    stream.write(chunk)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Download failed ({exc.code}): {url}") from exc

    actual = sha256_file(temporary)
    if expected_sha256 and actual.lower() != expected_sha256.lower():
        raise ValueError(f"Checksum mismatch after download: {destination}")
    temporary.replace(destination)
    print(f"FETCHED  {destination.relative_to(resolve('.'))}")
    return actual


def verify_remote(dataset: dict[str, Any]) -> None:
    with request(dataset["download_url"], method="HEAD") as response:
        length = response.headers.get("Content-Length")
    expected = dataset.get("expected_size_bytes")
    if expected and length and int(length) != int(expected):
        raise ValueError(f"Unexpected remote size for {dataset['id']}: {length} != {expected}")
    print(f"REMOTE   {dataset['id']} ({length or 'unknown'} bytes)")


def fetch_files(dataset: dict[str, Any], force: bool) -> list[tuple[Path, str]]:
    results: list[tuple[Path, str]] = []
    if dataset.get("download_url"):
        target = resolve(dataset["destination"])
        checksum = download(dataset["download_url"], target, dataset.get("checksum"), force)
        verify_primary_size(dataset, target)
        return [(target, checksum)]

    base_url = dataset["base_url"].rstrip("/") + "/"
    base_destination = resolve(dataset["destination"])
    for index, filename in enumerate(dataset["files"]):
        target = base_destination / filename
        checksum = download(base_url + filename, target, None, force)
        if index == 0:
            verify_primary_size(dataset, target)
        results.append((target, checksum))
    return results


def verify_primary_size(dataset: dict[str, Any], path: Path) -> None:
    expected = dataset.get("expected_size_bytes")
    if expected and path.stat().st_size != int(expected):
        raise ValueError(f"Unexpected size for {dataset['id']}: {path.stat().st_size} != {expected}")


def choose_images(images: list[dict[str, Any]], instruments: list[str], count: int) -> list[dict[str, Any]]:
    candidates = [item for item in images if item.get("camera", {}).get("instrument") in instruments]
    candidates.sort(key=lambda item: item["imageid"])
    selected: list[dict[str, Any]] = []
    for instrument in instruments:
        match = next((item for item in candidates if item["camera"]["instrument"] == instrument), None)
        if match:
            selected.append(match)
        if len(selected) == count:
            return selected
    for item in candidates:
        if item not in selected:
            selected.append(item)
        if len(selected) == count:
            break
    return selected


def fetch_mars_images(dataset: dict[str, Any], force: bool) -> list[tuple[Path, str]]:
    destination = resolve(dataset["destination"])
    destination.mkdir(parents=True, exist_ok=True)
    metadata: list[dict[str, Any]] = []
    checksums: list[tuple[Path, str]] = []
    for sol in dataset["sols"]:
        params = {
            "feed": "raw_images",
            "category": "mars2020,ingenuity",
            "feedtype": "json",
            "ver": "1.2",
            "num": "100",
            "page": "0",
            "order": "sol+asc",
            "condition_2": f"{sol}:sol:gte",
            "condition_3": f"{sol}:sol:lte",
        }
        images: list[dict[str, Any]] = []
        page = 0
        page_count = 1
        while page < page_count:
            params["page"] = str(page)
            url = dataset["api_url"] + "?" + urllib.parse.urlencode(params, safe="+,: ")
            with request(url) as response:
                payload = json.load(response)
            images.extend(payload.get("images", []))
            page_count = math.ceil(int(payload.get("total_results", 0)) / int(params["num"]))
            page += 1
        chosen = choose_images(images, dataset["instruments"], dataset["images_per_sol"])
        if len(chosen) < dataset["images_per_sol"]:
            raise RuntimeError(f"Only {len(chosen)} suitable images found for sol {sol}")
        for item in chosen:
            image_url = item["image_files"].get("medium") or item["image_files"]["large"]
            image_path = destination / f"{item['imageid']}.jpg"
            checksum = download(image_url, image_path, None, force)
            checksums.append((image_path, checksum))
            metadata.append(item)
    write_json(destination / "manifest.json", metadata)
    checksums.append((destination / "manifest.json", sha256_file(destination / "manifest.json")))
    return checksums


def meda_folder(sol: int) -> str:
    ranges = [(0, 89), (90, 179), (180, 299)]
    ranges.extend((start, start + 119) for start in range(300, 1860, 120))
    for start, stop in ranges:
        if start <= sol <= stop:
            return f"sol_{start:04d}_{stop:04d}/sol_{sol:04d}/"
    raise ValueError(f"Unsupported MEDA sol: {sol}")


def directory_files(url: str) -> list[str]:
    with request(url) as response:
        html = response.read().decode("utf-8", errors="replace")
    return [urllib.parse.unquote(name) for name in re.findall(r'href="([^"]+)"', html, flags=re.I)]


def fetch_meda(dataset: dict[str, Any], force: bool) -> list[tuple[Path, str]]:
    destination = resolve(dataset["destination"])
    roots = {
        "calibrated": "https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_calibrated_env/",
        "derived": "https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_derived_env/",
    }
    checksums: list[tuple[Path, str]] = []
    for sol in dataset["sols"]:
        for product in dataset["products"]:
            base = roots[product["collection"]] + meda_folder(sol)
            names = directory_files(base)
            token = product["token"].upper()
            matches = [name for name in names if token in name.upper() and name.upper().endswith((".CSV", ".XML"))]
            if len(matches) != 2:
                raise RuntimeError(f"Expected CSV and XML for {token}, sol {sol}; found {matches}")
            for name in matches:
                target = destination / f"sol_{sol:04d}" / name
                checksum = download(base + name, target, None, force)
                checksums.append((target, checksum))
    return checksums


def write_runtime_checksums(results: list[tuple[Path, str]]) -> None:
    target = DATA_ROOT / "manifests" / "runtime_checksums.sha256"
    checksums: dict[str, str] = {}
    if target.exists():
        for line in target.read_text(encoding="utf-8").splitlines():
            if line and not line.startswith("#"):
                checksum, path = line.split(maxsplit=1)
                checksums[path.strip()] = checksum
    for path, checksum in sorted(results, key=lambda item: str(item[0])):
        checksums[path.relative_to(resolve('.')).as_posix()] = checksum
    lines = [f"{checksum}  {path}" for path, checksum in sorted(checksums.items())]
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Acquire reproducible ARES Path source data.")
    parser.add_argument("--tier", default="core", choices=("core", "reference", "all"))
    parser.add_argument("--dataset", action="append", help="Fetch only the selected dataset ID; repeatable.")
    parser.add_argument("--force", action="store_true", help="Redownload existing files.")
    parser.add_argument("--dry-run", action="store_true", help="List actions without downloading.")
    args = parser.parse_args()

    manifest = load_manifest()
    selected = []
    for dataset in manifest["datasets"]:
        tier_match = args.tier == "all" or dataset["tier"] == args.tier
        id_match = not args.dataset or dataset["id"] in args.dataset
        if tier_match and id_match:
            selected.append(dataset)
    if args.dataset and set(args.dataset) - {item["id"] for item in selected}:
        parser.error("Unknown or tier-mismatched dataset ID")

    if args.dry_run:
        for dataset in selected:
            print(f"{dataset['id']} {dataset['kind']}: {dataset['title']}")
        return 0

    results: list[tuple[Path, str]] = []
    for dataset in selected:
        print(f"\n[{dataset['id']}] {dataset['title']}")
        kind = dataset["kind"]
        if kind == "files":
            results.extend(fetch_files(dataset, args.force))
        elif kind == "remote_raster":
            verify_remote(dataset)
        elif kind == "mars_images":
            results.extend(fetch_mars_images(dataset, args.force))
        elif kind == "meda_window":
            results.extend(fetch_meda(dataset, args.force))
        elif kind == "reference":
            print(f"REFERENCE {dataset['catalog_url']}")
        else:
            raise ValueError(f"Unsupported dataset kind: {kind}")
    write_runtime_checksums(results)
    print("\nAcquisition completed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Interrupted; partial downloads can be resumed.", file=sys.stderr)
        raise SystemExit(130)
