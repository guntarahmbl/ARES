import json
from pathlib import Path


VALID_INTENTS = {
    "configure_mission",
    "explain_route",
    "compare_routes",
    "inspect_location",
    "data_provenance",
    "unsupported",
}


def test_analyst_evaluation_set_is_complete_and_valid() -> None:
    cases = json.loads(Path("tests/fixtures/analyst_eval.json").read_text(encoding="utf-8"))
    assert len(cases) >= 30
    assert len({case["id"] for case in cases}) == len(cases)
    assert {case["language"] for case in cases} == {"id", "en"}
    assert {case["expected_intent"] for case in cases} == VALID_INTENTS
    assert all(dataset.startswith("D-") for case in cases for dataset in case["citations"])
    assert all(case["location"] for case in cases if case["expected_intent"] == "inspect_location")
