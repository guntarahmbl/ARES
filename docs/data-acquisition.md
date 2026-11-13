# Local Jezero data acquisition report

Upstream `2358f1f` (reproducible Mars acquisition pipeline) was reviewed and incorporated by fast-forward. Its source manifest, sample contracts and MEDA processing underpin the local pipeline; the regional area is retained separately.

All data needed for the selected local demonstration were acquired before application integration. Native raster windows, complete source vector geodatabase, full rover table, selected photographs and original MEDA CSV/XML pairs are retained in `data/raw/`. Large mosaics were range-read; this is complete local coverage, not a download of the entire regional archive.

| Data | Downloaded/retained | Browser use |
|---|---|---|
| CTX DEM | 20 m native crop, 26×26 | Aligned supporting context product |
| HiRISE DTM | 1 m native crop, 482×482 | Elevation, slope, roughness and route/profile grid |
| CTX image | 5 m native crop, 98×98 | Aligned supporting context product |
| HiRISE image | 0.25 m native crop, 1920×1920 | 0.5 m display basemap, 810×810 |
| USGS geology SIM 3464 | Complete Nili.gdb, 113 ZIP members, CRC32/SHA256 | Clipped NHjf2 and Njf units; 100–200 m registration uncertainty |
| CRISM FRT00005C5E | Original HDR/LBL/XML and native 32×32 windows of bands 14/40/44 | OLINDEX3, D2300, MIN2295_2480, native 18 m |
| Rover PLACES | Full best_interp.csv (8,684,070 bytes) and PDS4 XML | Local positions segmented across large spatial/temporal gaps |
| Surface photos | 12 selected browse images, four per stop at sols 645/647/646 | Embedded photos, IDs, UTC, credit and exact camera site/drive |
| MEDA | 28 complete CSV/XML pairs, sols 307–313: ATS, TIRS, pressure, wind | Independently recomputed seven-sol summary, chart/table |

Native CRISM projection uses radius 3394839.8133 m and true-scale latitude 15°; explicit reprojection into the analysis sphere avoids equating incompatible eastings. Negative spectral parameters are preserved. The 5 m display grid does not improve the native 18 m information limit.

MEDA original CSV byte counts match their XML labels. SHA256 checksums for originals/labels are stored in `meda-provenance.json`. The recomputed summary matches upstream within rounding. Filtering uses plausibility ranges, not instrument quality flags. These historical sols are earlier than the selected delta-front camera stops and cannot establish current local conditions.

Source URLs, raster windows, native CRS and hashes: [sources.json](../data/prepared/sources.json). Full retained-file inventory: [download-inventory.json](../data/prepared/download-inventory.json). Processing/validation: [validation.json](../data/prepared/validation.json). Upstream text sample checksums account for verified CRLF-to-LF checkout normalization; original binary samples match exactly.

Reproduce acquisition, processing and validation with:

```sh
.venv-data/bin/python scripts/data/demo.py --download
```

Run without `--download` to rebuild from local originals. Use `validate_local.py` for this dataset. The upstream broad-area `validate.py` requires its own regional processed rasters and is not a substitute for local validation.

Inventory at preparation: 211 files, 171,204,232 bytes. Prepared outputs and the offline demo contain only the compact local products.
