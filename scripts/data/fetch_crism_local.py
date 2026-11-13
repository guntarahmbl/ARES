"""Fetch the three required CRISM summary parameter windows at native resolution."""

import concurrent.futures, json, re
import numpy as np
import rasterio
from pyproj import CRS, Transformer
from rasterio.transform import from_origin
from rasterio.windows import from_bounds
from fetch_local import get_range, CENTER, ROOT, GEOGRAPHIC

folder = ROOT / "data/raw/crism"
header = (folder / "frt00005c5e_07_su166j_mtr3.hdr").read_text()
names = [
    x.strip()
    for x in re.search(r"band names\s*=\s*\{([^}]+)", header, re.I)
    .group(1)
    .replace("\n", " ")
    .split(",")
]
wkt = re.search(r"coordinate system string\s*=\s*\{([^}]+)", header, re.I).group(1)
crs = CRS.from_wkt(wkt)
# The map-info reference pixel is 1-based; coordinates locate that pixel's upper-left corner.
transform = from_origin(4422849.2, 1104156.6, 18, 18)
x, y = Transformer.from_crs(CRS.from_proj4(GEOGRAPHIC), crs, always_xy=True).transform(
    *CENTER
)
w = from_bounds(x - 270, y - 270, x + 270, y + 270, transform)
row = int(w.row_off)
col = int(w.col_off)
width = int(w.width) + 2
height = int(w.height) + 2
url = "https://pds-geosciences.wustl.edu/mro/mro-m-crism-5-rdr-mptargeted-v1/mrocr_4001/mtrdr/2007/2007_139/frt00005c5e/frt00005c5e_07_su166j_mtr3.img"
records = []
for name in ["OLINDEX3", "D2300", "MIN2295_2480"]:
    output = folder / (name.lower() + ".tif")
    if output.exists():
        records.append(
            {
                "band": name,
                "bandIndex": names.index(name) + 1,
                "sourceWindow": {
                    "col": col,
                    "row": row,
                    "width": width,
                    "height": height,
                },
            }
        )
        continue
    band = names.index(name)
    data = np.empty((height, width), dtype="<f4")

    def one(n):
        start = ((band * 891 + row + n) * 890 + col) * 4
        return n, np.frombuffer(
            get_range(url, start, start + width * 4 - 1), dtype="<f4"
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        for n, values in pool.map(one, range(height)):
            data[n] = values
    local_transform = transform * rasterio.Affine.translation(col, row)
    with rasterio.open(
        output,
        "w",
        driver="GTiff",
        width=width,
        height=height,
        count=1,
        dtype="float32",
        crs=crs.to_wkt(),
        transform=local_transform,
        nodata=65535,
        compress="deflate",
    ) as dst:
        dst.write(data, 1)
    valid = data[data != 65535]
    print(
        name,
        "window",
        data.shape,
        "valid",
        len(valid),
        "min/max",
        (float(valid.min()), float(valid.max())) if len(valid) else None,
        flush=True,
    )
    records.append(
        {
            "band": name,
            "bandIndex": band + 1,
            "sourceWindow": {"col": col, "row": row, "width": width, "height": height},
        }
    )
(folder / "local-extraction.json").write_text(
    json.dumps(
        {
            "productId": "FRT00005C5E_07_SU166J_MTR3",
            "url": url,
            "nativeCRS": crs.to_wkt(),
            "nativeResolutionMeters": 18,
            "bands": records,
            "method": "Exact BSQ rows fetched with validated byte ranges; no spectral values fabricated",
        },
        indent=2,
    )
    + "\n"
)
