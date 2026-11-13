"""Fetch MEDA's curated seven-sol window concurrently using the upstream contract."""

from concurrent.futures import ThreadPoolExecutor
from fetch import (
    load_manifest,
    directory_files,
    meda_folder,
    download,
    write_runtime_checksums,
    resolve,
)

DATA = next(x for x in load_manifest()["datasets"] if x["id"] == "D-08")
ROOT = "https://pds-atmospheres.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/"


def discover(sol):
    result = []
    for collection in ["calibrated", "derived"]:
        base = ROOT + "data_" + collection + "_env/" + meda_folder(sol)
        names = directory_files(base)
        for p in DATA["products"]:
            if p["collection"] != collection:
                continue
            matches = [
                n
                for n in names
                if p["token"] in n.upper() and n.upper().endswith((".CSV", ".XML"))
            ]
            if len(matches) != 2:
                raise ValueError(f"MEDA CSV/label pair missing: {sol}, {p}")
            result.extend(
                (
                    base + n,
                    resolve(DATA["destination"])
                    / f"sol_{sol:04d}"
                    / (n[:-4] + ".xml" if n.upper().endswith(".XML") else n),
                )
                for n in matches
            )
    return result


with ThreadPoolExecutor(max_workers=7) as pool:
    files = sum(pool.map(discover, DATA["sols"]), [])
print("MEDA download inventory:", len(files), "CSV/label files", flush=True)


def fetch(item):
    url, path = item
    # Reuse a complete product downloaded from the archive's atmos.nmsu.edu alias.
    alias = path.with_suffix(".xml")
    if path.suffix == ".XML" and alias.exists():
        path.write_bytes(alias.read_bytes())
    return path, download(url, path)


with ThreadPoolExecutor(max_workers=8) as pool:
    results = list(pool.map(fetch, files))
write_runtime_checksums(results)
print("MEDA window downloaded and checksummed.", flush=True)
