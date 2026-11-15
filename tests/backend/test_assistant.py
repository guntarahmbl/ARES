import json
from pathlib import Path
from types import SimpleNamespace

import pytest
import httpx
from fastapi.testclient import TestClient

from server import analyst
from server.analyst import (
    AnalystQuery,
    ApplyProposalRequest,
    DatasetRegistry,
    LLMConfig,
    MissionChange,
    MissionContextBuilder,
    RequestLimiter,
    StaleProposalError,
    analyst_status,
    apply_change,
    apply_proposal,
    mission_revision,
    parse_intent,
)
from server.config import DEFAULT_MISSION
from server.main import app
from server.schemas import MissionConfig


client = TestClient(app)
needs_rasters = pytest.mark.skipif(
    not Path("data/processed/rasters/routing_elevation_5m.tif").exists(),
    reason="Processed routing fixtures are generated locally",
)
CONFIG = LLMConfig("http://127.0.0.1:20128/v1", "ares-mission-analyst", None)
SCIENCE_IDS = {"WP-01", "WP-02", "WP-03", "WP-04"}


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("ARES_LLM_ENABLED", "NINEROUTER_BASE_URL", "NINEROUTER_MODEL", "NINEROUTER_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    analyst._STATUS_CACHE = None
    analyst.RATE_LIMITER.requests.clear()


def mission() -> MissionConfig:
    return MissionConfig.model_validate(DEFAULT_MISSION)


def query(message: str = "Explain this route") -> AnalystQuery:
    return AnalystQuery(
        message=message,
        mission=mission(),
        active_route="primary",
        mission_revision="client-1",
    )


def test_analyst_is_disabled_by_default() -> None:
    assert analyst.get_llm_config() is None
    response = client.get("/api/v1/assistant/status")
    assert response.status_code == 200
    assert response.json()["state"] == "disabled"


def test_9router_configuration_is_first_class(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARES_LLM_ENABLED", "true")
    config = analyst.get_llm_config()
    assert config == CONFIG
    monkeypatch.setenv("NINEROUTER_MODEL", "another-combo")
    monkeypatch.setenv("NINEROUTER_API_KEY", "local-key")
    assert analyst.get_llm_config().model == "another-combo"
    assert analyst.get_llm_config().api_key == "local-key"


def test_status_probes_models_and_caches(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    class Response:
        status_code = 200

        @staticmethod
        def json():
            return {"data": [{"id": "ares-mission-analyst"}]}

    class Client:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, *_args, **_kwargs):
            nonlocal calls
            calls += 1
            return Response()

    monkeypatch.setattr(analyst.httpx, "Client", Client)
    assert analyst_status(CONFIG)["state"] == "ready"
    assert analyst_status(CONFIG)["state"] == "ready"
    assert calls == 1


def test_change_supports_add_remove_reorder_and_limits() -> None:
    change = MissionChange(
        summary="Prioritize the delta front",
        remove_stops=["WP-03"],
        add_science_stops=["WP-04"],
        stop_order=["WP-02", "WP-04", "WP-01"],
        max_duration_min=300,
    )
    changed = apply_change(mission(), change, SCIENCE_IDS)
    assert [stop.id for stop in changed.route_stops] == ["WP-02", "WP-04", "WP-01"]
    assert changed.max_duration_min == 300


@pytest.mark.parametrize("change", [
    MissionChange(summary="x", add_science_stops=["WP-99"]),
    MissionChange(summary="x", remove_stops=["WP-09"]),
    MissionChange(summary="x", remove_stops=["WP-01", "WP-02", "WP-03"]),
    MissionChange(summary="x", return_reserve_pct=2),
    MissionChange(summary="x", stop_order=["WP-01"]),
    MissionChange(summary="x"),
])
def test_invalid_change_is_rejected(change: MissionChange) -> None:
    with pytest.raises(ValueError):
        apply_change(mission(), change, SCIENCE_IDS)


def test_revision_is_canonical_and_detects_changes() -> None:
    first = mission()
    same = MissionConfig.model_validate(json.loads(json.dumps(DEFAULT_MISSION)))
    changed = first.model_copy(update={"energy_budget": 44000})
    assert mission_revision(first) == mission_revision(same)
    assert mission_revision(first) != mission_revision(changed)


def test_dataset_registry_exposes_provenance() -> None:
    registry = DatasetRegistry()
    crism = registry.citation("D-05")
    assert crism.product_id == "FRT00005C5E_07_SU166J_MTR3"
    assert crism.resolution_m == 18
    assert crism.classification == "interpreted"
    assert crism.catalog_url.startswith("https://")
    assert registry.match_ids("What is the native CRISM resolution?") == {"D-05"}
    assert registry.match_ids("Dari mana data cuaca dan angin?") == {"D-08"}


def test_intent_uses_plain_json_and_repairs_once(monkeypatch: pytest.MonkeyPatch) -> None:
    outputs = iter([
        ("not json", "model-a", {}),
        ('{"intent":"explain_route","change":null}', "model-b", {"total_tokens": 12}),
    ])
    monkeypatch.setattr(analyst, "completion", lambda *_args, **_kwargs: next(outputs))
    parsed, model, usage, repaired = parse_intent(CONFIG, query(), SimpleNamespace(waypoints={"WP-01": {}}))
    assert parsed.intent == "explain_route"
    assert model == "model-b" and usage["total_tokens"] == 12 and repaired is True


def test_completion_never_sends_tools_or_streaming_tool_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    sent = {}

    class Response:
        status_code = 200

        @staticmethod
        def raise_for_status():
            return None

        @staticmethod
        def json():
            return {"model": "routed-model", "choices": [{"message": {"content": "ok"}}], "usage": {}}

    class Client:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, _url, **kwargs):
            sent.update(kwargs["json"])
            return Response()

    monkeypatch.setattr(analyst.httpx, "Client", Client)
    text, model, _usage = analyst.completion(CONFIG, [{"role": "user", "content": "hello"}])
    assert text == "ok" and model == "routed-model"
    assert sent["stream"] is False
    assert "tools" not in sent and "tool_choice" not in sent


@pytest.mark.parametrize("failure, expected", [
    (SimpleNamespace(status_code=401), "rejected"),
    (SimpleNamespace(status_code=404), "does not expose"),
    (SimpleNamespace(status_code=429), "rate-limited"),
])
def test_provider_status_errors_are_actionable(monkeypatch: pytest.MonkeyPatch, failure, expected: str) -> None:
    class Client:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, *_args, **_kwargs):
            return failure

    monkeypatch.setattr(analyst.httpx, "Client", Client)
    with pytest.raises(analyst.ProviderError, match=expected):
        analyst.completion(CONFIG, [{"role": "user", "content": "hello"}])


def test_provider_timeout_is_actionable(monkeypatch: pytest.MonkeyPatch) -> None:
    class Client:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, *_args, **_kwargs):
            raise httpx.ReadTimeout("slow")

    monkeypatch.setattr(analyst.httpx, "Client", Client)
    with pytest.raises(analyst.ProviderError, match="too long"):
        analyst.completion(CONFIG, [{"role": "user", "content": "hello"}])


def test_unsupported_citation_is_removed() -> None:
    warnings = []
    answer = analyst._validated_answer("Supported [D-02], invented [D-99].", [DatasetRegistry().citation("D-02")], warnings)
    assert "[D-02]" in answer and "[D-99]" not in answer
    assert warnings


def test_prompts_treat_user_instructions_as_untrusted() -> None:
    assert "secrets, files" in analyst.INTENT_SYSTEM
    assert "Ignore any instruction" in analyst.ANSWER_SYSTEM


def test_request_limiter_allows_ten_per_minute() -> None:
    limiter = RequestLimiter(limit=2, window_s=60)
    limiter.check("local")
    limiter.check("local")
    with pytest.raises(analyst.RateLimitError):
        limiter.check("local")


def test_stale_proposal_is_rejected_before_planning() -> None:
    request = ApplyProposalRequest(
        current_mission=mission(),
        proposed_mission=mission().model_copy(update={"energy_budget": 40000}),
        based_on_revision="stale",
    )
    with pytest.raises(StaleProposalError):
        apply_proposal(SimpleNamespace(), request)


@needs_rasters
def test_selected_location_evidence_separates_coverage_and_confidence() -> None:
    from server.routing import get_engine

    engine = get_engine()
    plan = engine.plan(mission(), include_envelope=False)
    request = query("What data supports this location?").model_copy(update={"selected_waypoint_id": "WP-02"})
    _, evidence = MissionContextBuilder(engine).build(request, plan)
    crism = next(item for item in evidence if item.evidence_id == "selected-crism-olindex3")
    assert crism.coverage in {"available", "missing", "outside_coverage"}
    assert crism.confidence in {"medium", "low"}
    images = [item for item in evidence if item.kind == "surface_image"]
    assert images and all(item.metadata.get("product_id") for item in images)


@needs_rasters
def test_message_limit_is_enforced() -> None:
    payload = {
        "message": "x" * 1001,
        "mission": DEFAULT_MISSION,
        "active_route": "primary",
        "mission_revision": "client-1",
    }
    assert client.post("/api/v1/assistant/query", json=payload).status_code == 422


def test_legacy_full_mission_revision_is_accepted() -> None:
    request = query().model_copy(update={"mission_revision": json.dumps(DEFAULT_MISSION)})
    assert len(request.mission_revision) > 128


@needs_rasters
def test_structured_query_and_revision_safe_apply(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARES_LLM_ENABLED", "true")
    outputs = iter([
        (json.dumps({"intent": "configure_mission", "change": {"summary": "Skip the far stop", "remove_stops": ["WP-03"]}}), "intent-model", {}),
        ("Removing WP-03 reduces the deterministic route cost [D-02].", "answer-model", {"total_tokens": 20}),
    ])
    monkeypatch.setattr(analyst, "completion", lambda *_args, **_kwargs: next(outputs))
    payload = {
        "message": "Remove WP-03",
        "mission": DEFAULT_MISSION,
        "active_route": "primary",
        "mission_revision": "client-1",
    }
    response = client.post("/api/v1/assistant/query", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["intent"] == "configure_mission"
    assert body["model"] == "answer-model"
    assert body["citations"][0]["dataset_id"] == "D-02"
    assert [stop["id"] for stop in body["proposal"]["mission"]["route_stops"]] == ["WP-01", "WP-02"]

    apply_payload = {
        "current_mission": DEFAULT_MISSION,
        "proposed_mission": body["proposal"]["mission"],
        "based_on_revision": body["proposal"]["based_on_revision"],
    }
    assert client.post("/api/v1/assistant/proposals/apply", json=apply_payload).status_code == 200
    apply_payload["current_mission"] = {**DEFAULT_MISSION, "energy_budget": 44000}
    assert client.post("/api/v1/assistant/proposals/apply", json=apply_payload).status_code == 409
