from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "data"))

from _common import load_aoi, load_manifest  # noqa: E402


class DataContractTest(unittest.TestCase):
    def test_manifest_has_expected_datasets(self) -> None:
        manifest = load_manifest()
        ids = {item["id"] for item in manifest["datasets"]}
        self.assertEqual(ids, {f"D-{value:02d}" for value in range(1, 10)})

    def test_manifest_uses_jezero_crism_product(self) -> None:
        manifest = load_manifest()
        crism = next(item for item in manifest["datasets"] if item["id"] == "D-05")
        self.assertTrue(crism["product_id"].startswith("FRT00005C5E"))

    def test_aoi_is_closed_and_has_expected_bounds(self) -> None:
        data, bounds = load_aoi()
        ring = data["features"][0]["geometry"]["coordinates"][0]
        self.assertEqual(ring[0], ring[-1])
        self.assertEqual(bounds, (77.335, 18.420, 77.455, 18.500))

    def test_waypoints_are_inside_aoi(self) -> None:
        _, west_south_east_north = load_aoi()
        west, south, east, north = west_south_east_north
        path = ROOT / "data" / "samples" / "science_waypoints.geojson"
        features = json.loads(path.read_text(encoding="utf-8"))["features"]
        self.assertEqual(len(features), 3)
        for feature in features:
            lon, lat = feature["geometry"]["coordinates"]
            self.assertTrue(west <= lon <= east and south <= lat <= north)


if __name__ == "__main__":
    unittest.main()
