"""Retrieve the complete vector geodatabase without downloading redundant raster basemaps."""

from pathlib import Path
import concurrent.futures, hashlib, json, struct, zipfile, zlib
from remote_zip import Remote

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "data/raw/geology/Nili.gdb"
DEST.mkdir(parents=True, exist_ok=True)
URL = "https://pubs.usgs.gov/sim/3464/sim3464_database.zip"
SIZE = 349336873
archive = zipfile.ZipFile(Remote(URL, SIZE))
items = [
    item
    for item in archive.infolist()
    if ".gdb/" in item.filename.lower()
    and not item.is_dir()
    and not item.filename.endswith(".lock")
]


def one(item):
    target = DEST / Path(item.filename).name
    if not target.exists():
        remote = Remote(URL, SIZE)
        remote.seek(item.header_offset)
        header = remote.read(30)
        fields = struct.unpack("<4s5H3I2H", header)
        name_size, extra_size = fields[-2:]
        remote.seek(item.header_offset + 30 + name_size + extra_size)
        compressed = remote.read(item.compress_size)
        content = (
            zlib.decompress(compressed, -15) if item.compress_type == 8 else compressed
        )
        if len(content) != item.file_size or zlib.crc32(content) != item.CRC:
            raise ValueError("ZIP member checksum mismatch")
        target.write_bytes(content)
    return {
        "member": item.filename,
        "bytes": target.stat().st_size,
        "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
    }


with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    records = list(pool.map(one, items))
(DEST.parent / "source.json").write_text(
    json.dumps(
        {
            "url": URL,
            "sourceArchiveBytes": SIZE,
            "method": "Complete Nili.gdb vector geodatabase extracted via validated HTTP ranges and ZIP CRC32",
            "files": records,
        },
        indent=2,
    )
    + "\n"
)
print(
    "Geology database complete:",
    len(records),
    "members,",
    sum(r["bytes"] for r in records),
    "bytes",
    flush=True,
)
