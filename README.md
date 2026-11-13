# ARES

ARES Path is a Marswalk route-planning prototype for the NASA Space Apps Challenge.

## Data pipeline

The repository keeps only compact, reviewable samples. Source rasters and intermediate products are reproduced locally from official NASA and USGS sources.

```powershell
python -m pip install -r requirements-data.txt
python scripts/data/fetch.py --tier core
python scripts/data/preprocess.py --aoi data/aoi/jezero_delta_traverse.geojson
python scripts/data/validate.py
```

See [data/README.md](data/README.md) for sources, storage policy, CRS, and scientific limitations.
