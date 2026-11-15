"""Restore the checksum-pinned VM dataset from private R2 storage."""
import hashlib
import io
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    manifest = json.loads((ROOT / "deploy/dataset.json").read_text())
    account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    token = os.environ["CLOUDFLARE_API_TOKEN"]
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/{manifest['bucket']}/objects/{manifest['key']}"
    request = Request(url, headers={"Authorization": f"Bearer {token}"})
    with urlopen(request, timeout=120) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != manifest["sha256"]:
        raise ValueError("Runtime dataset checksum mismatch; refusing to deploy")
    with ZipFile(io.BytesIO(data)) as archive:
        for name in archive.namelist():
            if not name.startswith(("data/processed/rasters/", "data/processed/web/", "data/processed/3d/")) or ".." in Path(name).parts:
                raise ValueError(f"Unexpected dataset path: {name}")
        archive.extractall(ROOT)
    print(f"Restored verified VM dataset: {manifest['key']}")


if __name__ == "__main__":
    main()
