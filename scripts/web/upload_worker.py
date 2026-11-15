"""Upload the exported dataset to its private R2 bucket using Wrangler auth.

Credentials stay in the subprocess and process memory; never print/store tokens.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import mimetypes
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER_ROOT = ROOT / "cloudflare"
DATA_ROOT = ROOT / "data" / "processed" / "cloudflare"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--routing-only", action="store_true", help="Only upload routing grid and metadata")
    args = parser.parse_args()
    config = json.loads((WORKER_ROOT / "wrangler.jsonc").read_text())
    bucket = config["r2_buckets"][0]["bucket_name"]
    prefix = config["vars"]["DATA_PREFIX"]
    result = subprocess.run(
        [str(WORKER_ROOT / "node_modules" / ".bin" / "wrangler"), "auth", "token", "--json"],
        cwd=WORKER_ROOT, capture_output=True, text=True, check=True,
    )
    auth = json.loads(result.stdout)
    if not auth.get("token"):
        raise RuntimeError("Wrangler bearer authentication is required. Run wrangler login.")
    base = f"https://api.cloudflare.com/client/v4/accounts/{args.account_id}/r2/buckets/{bucket}/objects/"
    files = [DATA_ROOT / "grid.bin.gz", DATA_ROOT / "metadata.json"]
    if not args.routing_only:
        files.extend(sorted(path for path in (DATA_ROOT / "assets").rglob("*") if path.is_file()))
    if any(not path.is_file() for path in files):
        raise FileNotFoundError("Run scripts/web/export_worker.py first.")

    def upload(path: Path) -> int:
        key = prefix + path.relative_to(DATA_ROOT).as_posix()
        data = path.read_bytes()
        headers = {
            "Authorization": "Bearer " + auth["token"],
            "Content-Type": "application/gzip" if path.name.endswith(".gz") else mimetypes.guess_type(path.name)[0] or "application/octet-stream",
            "Cache-Control": "public, max-age=3600" if key.startswith(prefix + "assets/") else "private, no-store",
        }
        for attempt in range(4):
            request = urllib.request.Request(base + urllib.parse.quote(key, safe="/"), data=data, headers=headers, method="PUT")
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    response.read()
                return len(data)
            except urllib.error.HTTPError as error:
                if error.code not in (429, 500, 502, 503, 504) or attempt == 3:
                    raise RuntimeError(f"R2 upload failed for {key}: HTTP {error.code} {error.read().decode()[:400]}") from None
                time.sleep(2**attempt)
        raise RuntimeError(f"R2 upload failed for {key}")

    total = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for count, size in enumerate(pool.map(upload, files), 1):
            total += size
            if count % 100 == 0 or count == len(files):
                print(f"Uploaded {count}/{len(files)} objects ({total / 1024**2:.1f} MiB)", flush=True)
    print(f"Dataset ready in private bucket {bucket}, prefix {prefix}")


if __name__ == "__main__":
    main()
