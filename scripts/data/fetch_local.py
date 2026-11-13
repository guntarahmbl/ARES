"""Fetch the native-resolution pixels needed for the local EVA, not multi-GB mosaics.

DTM/CTX GeoTIFFs use uncompressed strips; the HiRISE image uses compressed tiles. Requests are
validated against Content-Range; their native windows retain the original CRS.
"""

from pathlib import Path
import concurrent.futures, hashlib, json, math, struct, time, urllib.request
import numpy as np
import rasterio
from pyproj import CRS, Transformer
from rasterio.windows import Window, from_bounds

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data/raw/local"
RAW.mkdir(parents=True, exist_ok=True)
CENTER = (77.405123636, 18.451193185)
GEOGRAPHIC = "+proj=longlat +R=3396190 +no_defs"
CACHE = Path("/tmp/ares-source-cache")
CACHE.mkdir(parents=True, exist_ok=True)
BASE = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/"
PRODUCTS = {
    "ctx_dem": BASE
    + "CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif",
    "hirise_dtm": BASE
    + "HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif",
    "ctx_ortho": BASE
    + "CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXortho_mosaic_5m.tif",
    "hirise_ortho": BASE
    + "HiRISE/JEZ_hirise_soc_007_orthoMosaic_25cm_Ortho_blend120.tif",
}


def get_range(url, a, b):
    for attempt in range(4):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "Mozilla/5.0", "Range": f"bytes={a}-{b}"}
            )
            with urllib.request.urlopen(req, timeout=45) as response:
                if response.status != 206 or not response.headers.get(
                    "Content-Range", ""
                ).startswith(f"bytes {a}-{b}/"):
                    raise ValueError(
                        f"Unexpected range response: {response.status}, {response.headers.get('Content-Range')}"
                    )
                data = response.read()
                if len(data) != b - a + 1:
                    raise ValueError("Truncated response")
                return data
        except Exception:
            if attempt == 3:
                raise
            time.sleep(0.5 * (attempt + 1))


def tiff_tags(raw):
    order = "<" if raw[:2] == b"II" else ">"
    offset = struct.unpack(order + "I", raw[4:8])[0]
    count = struct.unpack_from(order + "H", raw, offset)[0]
    tags = {}
    for n in range(count):
        position = offset + 2 + n * 12
        tag, kind, length, value = struct.unpack_from(order + "HHII", raw, position)
        size = {1: 1, 2: 1, 3: 2, 4: 4, 12: 8}.get(kind)
        if size is None:
            continue
        start = position + 8 if length * size <= 4 else value
        formats = {1: "B", 2: "c", 3: "H", 4: "I", 12: "d"}
        tags[tag] = struct.unpack_from(order + formats[kind] * length, raw, start)
    return tags


def fetch_tiled_crop(name, url):
    output = RAW / (name + ".tif")
    with rasterio.Env(
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
        GDAL_HTTP_USERAGENT="Mozilla/5.0",
        GDAL_HTTP_TIMEOUT="45",
        CPL_VSIL_CURL_USE_HEAD="NO",
    ):
        with rasterio.open(url) as source:
            x, y = Transformer.from_crs(
                CRS.from_proj4(GEOGRAPHIC), source.crs, always_xy=True
            ).transform(*CENTER)
            window = (
                from_bounds(x - 240, y - 240, x + 240, y + 240, source.transform)
                .round_offsets()
                .round_lengths()
            )
            data = source.read(1, window=window)
            profile = source.profile.copy()
            profile.update(
                width=int(window.width),
                height=int(window.height),
                transform=source.window_transform(window),
                compress="deflate",
                tiled=True,
                blockxsize=128,
                blockysize=128,
            )
            with rasterio.open(output, "w", **profile) as dst:
                dst.write(data, 1)
            meta = {
                "id": name,
                "url": url,
                "sourceCRS": source.crs.to_wkt(),
                "sourceBounds": list(source.bounds),
                "nativeResolutionMeters": [
                    abs(source.transform.a),
                    abs(source.transform.e),
                ],
                "window": {
                    "col": window.col_off,
                    "row": window.row_off,
                    "width": window.width,
                    "height": window.height,
                },
                "nodata": source.nodata,
                "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                "method": "GDAL HTTP range read of native compressed tiles; exact pixel window",
                "retrievedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
    (RAW / (name + ".json")).write_text(json.dumps(meta, indent=2) + "\n")
    print("CROPPED", name, data.shape, flush=True)
    return meta


def fetch_crop(name, url):
    output = RAW / (name + ".tif")
    meta_path = RAW / (name + ".json")
    if output.exists() and meta_path.exists():
        print("CACHED", name, flush=True)
        return json.loads(meta_path.read_text())
    header_path = CACHE / (url.rsplit("/", 1)[-1] + ".header")
    if not header_path.exists():
        partial = CACHE / (url.rsplit("/", 1)[-1] + ".partial")
        if partial.exists():
            header = partial.open("rb").read(1048576)
        else:
            header = get_range(url, 0, 1048575)
        header_path.write_bytes(header)
    header = header_path.read_bytes()
    if struct.unpack("<H", header[2:4])[0] == 43:
        return fetch_tiled_crop(name, url)
    tags = tiff_tags(header)
    if tags[259][0] != 1 or tags[277][0] != 1 or tags[278][0] != 1:
        raise ValueError(
            "This window fetcher requires uncompressed single-band, one-row TIFF strips"
        )
    with rasterio.MemoryFile(header) as memory:
        with memory.open() as source:
            transformer = Transformer.from_crs(
                CRS.from_proj4(GEOGRAPHIC), source.crs, always_xy=True
            )
            x, y = transformer.transform(*CENTER)
            # A 480 m collar provides native slope neighborhoods around the 400 m study.
            bounds = (x - 240, y - 240, x + 240, y + 240)
            w = from_bounds(*bounds, source.transform)
            col = max(0, math.floor(w.col_off))
            row = max(0, math.floor(w.row_off))
            width = min(source.width - col, math.ceil(w.width) + 2)
            height = min(source.height - row, math.ceil(w.height) + 2)
            if width <= 0 or height <= 0:
                raise ValueError("Local area is outside source coverage")
            profile = source.profile.copy()
            native_crs = source.crs.to_wkt()
            native_transform = source.transform
            native_bounds = list(source.bounds)
            nodata = source.nodata
            dtype = np.dtype(source.dtypes[0])
            itemsize = dtype.itemsize
    offsets = tags[273]
    data = np.empty((height, width), dtype=dtype)

    def fetch_row(n):
        start = offsets[row + n] + col * itemsize
        raw = get_range(url, start, start + width * itemsize - 1)
        return n, np.frombuffer(raw, dtype=dtype)

    began = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        for count, (n, values) in enumerate(pool.map(fetch_row, range(height)), 1):
            data[n] = values
            if count % 100 == 0:
                print(name, f"{count}/{height} rows", flush=True)
    transform = rasterio.windows.transform(
        Window(col, row, width, height), native_transform
    )
    profile.update(
        width=width,
        height=height,
        transform=transform,
        compress="deflate",
        tiled=True,
        blockxsize=128,
        blockysize=128,
    )
    with rasterio.open(output, "w", **profile) as dst:
        dst.write(data, 1)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    meta = {
        "id": name,
        "url": url,
        "sourceCRS": native_crs,
        "sourceBounds": native_bounds,
        "nativeResolutionMeters": [abs(native_transform.a), abs(native_transform.e)],
        "window": {"col": col, "row": row, "width": width, "height": height},
        "bounds": list(rasterio.transform.array_bounds(height, width, transform)),
        "transform": list(transform),
        "nodata": nodata,
        "downloadedPixelBytes": data.nbytes,
        "localBytes": output.stat().st_size,
        "sha256": digest,
        "retrievedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "method": "Validated byte ranges; exact native pixel window, no value resampling",
    }
    meta_path.write_text(json.dumps(meta, indent=2) + "\n")
    print(
        "CROPPED",
        name,
        data.shape,
        round(time.time() - began, 1),
        "seconds",
        flush=True,
    )
    return meta


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", action="append", choices=list(PRODUCTS))
    args = parser.parse_args()
    for name in args.dataset or PRODUCTS:
        fetch_crop(name, PRODUCTS[name])
