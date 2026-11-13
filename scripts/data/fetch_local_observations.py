"""Curate photos by exact Rover PLACES site/drive, rather than assigning a sol to one location."""

from pathlib import Path
import concurrent.futures, csv, hashlib, json, urllib.request, urllib.parse

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data/raw"
OUT = RAW / "local-images"
OUT.mkdir(exist_ok=True)
rows = list(csv.DictReader((RAW / "best_interp.csv").open()))
by_pose = {(int(r["site"]), int(r["drive"])): r for r in rows if r["frame"] == "ROVER"}


def read(url):
    with urllib.request.urlopen(
        urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=40
    ) as r:
        return r.read()


def get_sol(sol):
    cache = ROOT / f"data/catalog/images-sol{sol}.json"
    if cache.exists():
        payload = json.loads(cache.read_text())
    else:
        payload = json.loads(
            read(
                f"https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&num=100&sol={sol}&order=sol+asc"
            )
        )
    images = payload.get("images", [])
    if not images or any(int(i["sol"]) != sol for i in images):
        raise ValueError("Wrong image sol returned")
    selected = []
    for instrument in ["MCZ_LEFT", "MCZ_RIGHT", "NAVCAM_LEFT", "NAVCAM_RIGHT"]:
        candidates = sorted(
            [
                i
                for i in images
                if i.get("camera", {}).get("instrument") == instrument
                and i.get("sample_type") == "Full"
                and (int(i["site"]), int(i["drive"])) in by_pose
            ],
            key=lambda i: i["imageid"],
        )
        # Prefer the final localized drive of the sol, which defines the waypoint.
        places = [r for r in rows if r["frame"] == "ROVER" and int(r["sol"]) == sol]
        target = places[-1]
        exact = [
            i
            for i in candidates
            if int(i["site"]) == int(target["site"])
            and int(i["drive"]) == int(target["drive"])
        ]
        candidates = exact or candidates
        if candidates:
            selected.append(candidates[0])
    for image in selected:
        pose = by_pose.get((int(image["site"]), int(image["drive"])))
        if pose is None:
            raise ValueError("Photo has no matching PLACES site/drive")
        image["localization"] = {
            "site": int(pose["site"]),
            "drive": int(pose["drive"]),
            "longitude": float(pose["longitude"]),
            "latitude": float(pose["planetocentric_latitude"]),
            "sclk": pose["sclk"],
            "method": "Exact site/drive join to best interpreted Rover PLACES; rover camera location, not image footprint",
        }
        url = image["image_files"]["medium"]
        path = OUT / (image["imageid"] + ".jpg")
        if not path.exists():
            path.write_bytes(read(url))
        image["localPath"] = path.relative_to(ROOT).as_posix()
        image["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    print(
        "Images",
        sol,
        len(images),
        "catalogue entries;",
        len(selected),
        "photos downloaded with site/drive matches",
        flush=True,
    )
    (OUT / f"sol-{sol}-metadata.json").write_text(json.dumps(selected, indent=2) + "\n")
    return selected


with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    images = sum(pool.map(get_sol, [645, 647, 646]), [])
(OUT / "manifest.json").write_text(json.dumps(images, indent=2) + "\n")
