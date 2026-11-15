"""Run the bilingual intent evaluation set against the configured local 9Router."""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from server.analyst import AnalystQuery, get_llm_config, parse_intent
from server.config import DEFAULT_MISSION
from server.routing import get_engine
from server.schemas import Coordinate, MissionConfig


def main() -> int:
    config = get_llm_config()
    if config is None:
        raise SystemExit("Set ARES_LLM_ENABLED=true before running the analyst evaluation.")
    engine = get_engine()
    mission = MissionConfig.model_validate(DEFAULT_MISSION)
    cases = json.loads(Path("tests/fixtures/analyst_eval.json").read_text(encoding="utf-8"))
    correct = 0
    results = []
    for case in cases:
        coordinate = Coordinate(longitude=77.405123636, latitude=18.451193185) if case["location"] else None
        request = AnalystQuery(
            message=case["message"],
            mission=mission,
            selected_coordinate=coordinate,
            mission_revision="evaluation",
        )
        parsed, model, _usage, repaired = parse_intent(config, request, engine)
        passed = parsed.intent == case["expected_intent"]
        correct += int(passed)
        results.append({"id": case["id"], "expected": case["expected_intent"], "actual": parsed.intent, "passed": passed, "repaired": repaired})
        print(f"{case['id']}: {'PASS' if passed else 'FAIL'} {parsed.intent}")
    accuracy = correct / len(cases)
    print(json.dumps({"model": model, "passed": correct, "total": len(cases), "intent_accuracy": round(accuracy, 3)}, indent=2))
    return 0 if accuracy >= 0.9 else 1


if __name__ == "__main__":
    raise SystemExit(main())
