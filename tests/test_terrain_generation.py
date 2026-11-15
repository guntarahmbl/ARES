import numpy as np
import pytest
import rasterio
from PIL import Image
from rasterio.transform import from_origin

from scripts.web import build_assets
from scripts.web.build_assets import normal_for_bounds, normalized_gray, texture_for_bounds


def raster(path, data, resolution=1):
    with rasterio.open(path, "w", driver="GTiff", height=data.shape[0], width=data.shape[1],
                       count=1, dtype=data.dtype, transform=from_origin(0, data.shape[0] * resolution, resolution, resolution)) as output:
        output.write(data, 1)


@pytest.mark.parametrize("east,south", [(0, 0), (0.25, -0.5)])
def test_normal_maps_preserve_measured_slope_without_exaggeration(tmp_path, east, south):
    rows, cols = np.mgrid[:12, :12]
    source = tmp_path / "dtm.tif"
    raster(source, (east * cols + south * rows).astype("float32"))
    target = tmp_path / "normal.png"
    with rasterio.open(source) as dataset:
        normal_for_bounds(dataset, (2, 2, 10, 10), target)
    decoded = np.asarray(Image.open(target), dtype=float) / 255 * 2 - 1
    expected = np.array([-east, 1, -south], dtype=float)
    expected /= np.linalg.norm(expected)
    assert np.allclose(decoded, expected, atol=1 / 127)


def test_shared_contrast_preserves_equal_brightness_across_tiles():
    left = np.ma.array([[20, 80, 120]], mask=False)
    right = np.ma.array([[80, 160, 240]], mask=False)
    assert np.array_equal(normalized_gray(left, (0, 255))[0, 1], normalized_gray(right, (0, 255))[0, 0])


def test_texture_uses_available_resolution_without_upsampling(tmp_path):
    source = tmp_path / "imagery.tif"
    raster(source, np.full((120, 160), 100, dtype="uint8"), resolution=0.25)
    target = tmp_path / "tile.webp"
    with rasterio.open(source) as dataset:
        texture_for_bounds(dataset, (0, 0, 40, 30), target, (0, 255))
    assert Image.open(target).size == (160, 120)


def test_fine_grid_keeps_real_world_elevation_and_cell_centres(tmp_path, monkeypatch):
    rows, cols = np.mgrid[:25, :25]
    raster(tmp_path / "hirise_dtm_1m.tif", (0.1 * (cols + 0.5) + 0.2 * (rows + 0.5)).astype("float32"))
    raster(tmp_path / "coarse.tif", np.zeros((5, 5), dtype="float32"), resolution=5)
    monkeypatch.setattr(build_assets, "RASTER_ROOT", tmp_path)
    with rasterio.open(tmp_path / "coarse.tif") as coarse:
        heights, factor = build_assets.read_fine_heights(coarse, tile_cells=2)
    assert factor == 2.5
    row, col = np.mgrid[:11, :11]
    assert np.allclose(heights, 0.1 * (2.5 + col * 2) + 0.2 * (2.5 + row * 2), atol=1e-5)
