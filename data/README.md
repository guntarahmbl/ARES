# ARES Path Data

Folder ini menyimpan definisi area studi, manifest sumber, dan sampel kecil yang aman disimpan di GitHub. Raster besar dan arsip mentah dibuat ulang secara lokal.

## Area studi

- Lokasi: delta barat dan traverse Perseverance di Jezero Crater
- Longitude: 77.335 E sampai 77.455 E
- Latitude: 18.420 N sampai 18.500 N
- Latitude menggunakan planetocentric latitude dan longitude positif ke timur.

CRS analisis menggunakan Mars sphere equirectangular:

```text
+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +R=3396190 +units=m +no_defs
```

## Menyiapkan data

```powershell
python -m pip install -r requirements-data.txt
python scripts/data/fetch.py --tier core
python scripts/data/preprocess.py --aoi data/aoi/jezero_delta_traverse.geojson
python scripts/data/validate.py
```

`fetch.py` mengunduh produk berukuran sedang dengan resume. HiRISE DTM dan orthomosaic dibaca sebagai remote raster saat preprocessing agar file penuh 1.8-3.4 GB tidak perlu disimpan.

## Kebijakan Git

Yang masuk GitHub:

- AOI dan metadata CRS
- Manifest sumber
- Traverse yang disederhanakan
- Tiga waypoint awal
- Ringkasan MEDA tujuh sol
- Manifest citra permukaan dan thumbnail
- Statistik dan browse image kecil

Yang tidak masuk GitHub:

- `raw/`
- `interim/`
- `processed/`
- checksum runtime dari file besar

Setiap sumber menyimpan URL katalog, URL unduh, product ID, versi, format, atribusi, dan keterbatasan. Produk CRISM yang digunakan adalah `FRT00005C5E`, bukan `FRT000035D0`; verifikasi ODE menunjukkan produk pertama mencakup AOI Jezero, sedangkan produk kedua berada di lokasi Spirit.

## Batasan

- Layer MEDA adalah konteks historis, bukan prakiraan cuaca.
- Parameter CRISM adalah indikator remote sensing, bukan konfirmasi lapangan.
- DTM stereo dapat mengandung artefak dan tidak membuktikan keberadaan setiap rintangan kecil.
- ARES Path bukan sistem navigasi flight-certified dan tidak mendapat endorsement NASA.
