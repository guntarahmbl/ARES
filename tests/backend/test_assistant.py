import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server import assistant
from server.assistant import LLMConfig, MissionChange, ProviderError, apply_change, get_llm_config
from server.config import DEFAULT_MISSION
from server.main import app
from server.schemas import MissionConfig


client = TestClient(app)
needs_rasters = pytest.mark.skipif(
    not Path("data/processed/rasters/routing_elevation_5m.tif").exists(),
    reason="Processed routing fixtures are generated locally",
)
SCIENCE_IDS = {"WP-01", "WP-02", "WP-03", "WP-04"}
FAKE = LLMConfig("gemini", "Google Gemini", "https://example.invalid/v1", "test-model", "key")
PROVIDER_VARS = ["ARES_LLM_PROVIDER", "ARES_LLM_MODEL", "ARES_LLM_BASE_URL", "ARES_LLM_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY"]


@pytest.fixture(autouse=True)
def no_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in PROVIDER_VARS:
        monkeypatch.delenv(name, raising=False)


def mission() -> MissionConfig:
    return MissionConfig.model_validate(DEFAULT_MISSION)


def events(body: str) -> list[dict]:
    return [json.loads(line[5:]) for line in body.splitlines() if line.startswith("data:")]


def text_chunk(text: str) -> dict:
    return {"choices": [{"delta": {"content": text}}]}


def tool_chunks(arguments: dict) -> list[dict]:
    raw = json.dumps(arguments)
    half = len(raw) // 2
    return [
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_1", "function": {"name": "propose_mission_change", "arguments": raw[:half]}}]}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": raw[half:]}}]}}]},
    ]


def ask(question: str = "Can this be shorter?") -> dict:
    return {"mission": DEFAULT_MISSION, "messages": [{"role": "user", "content": question}]}


def test_no_key_means_no_advisor() -> None:
    assert get_llm_config() is None
    assert client.get("/api/v1/assistant/status").json() == {"available": False, "provider": None, "model": None}
    assert client.post("/api/v1/assistant/chat", json=ask()).status_code == 503


def test_a_key_selects_its_provider_and_overrides_apply(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
    config = get_llm_config()
    assert config and config.provider == "groq" and config.api_key == "gsk-test"
    assert config.base_url == "https://api.groq.com/openai/v1"
    monkeypatch.setenv("ARES_LLM_MODEL", "another-model")
    assert get_llm_config().model == "another-model"


def test_local_provider_needs_no_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARES_LLM_PROVIDER", "ollama")
    config = get_llm_config()
    assert config and config.api_key is None and config.base_url.startswith("http://127.0.0.1")


def test_change_removes_and_adds_stops_and_sets_limits() -> None:
    change = MissionChange(summary="Drop the far stop", remove_stops=["WP-03"], add_science_stops=["WP-04"], max_duration_min=300)
    changed = apply_change(mission(), change, SCIENCE_IDS)
    assert [stop.id for stop in changed.route_stops] == ["WP-01", "WP-02", "WP-04"]
    assert changed.max_duration_min == 300
    assert changed.energy_budget == DEFAULT_MISSION["energy_budget"]


@pytest.mark.parametrize("change", [
    MissionChange(summary="x", add_science_stops=["WP-99"]),
    MissionChange(summary="x", remove_stops=["WP-09"]),
    MissionChange(summary="x", remove_stops=["WP-01", "WP-02", "WP-03"]),
    MissionChange(summary="x", return_reserve_pct=2),
    MissionChange(summary="x", energy_budget=500000),
    MissionChange(summary="x"),
    MissionChange(summary="x", add_science_stops=["WP-01"]),
])
def test_changes_the_planner_cannot_use_are_rejected(change: MissionChange) -> None:
    with pytest.raises(ValueError):
        apply_change(mission(), change, SCIENCE_IDS)


@needs_rasters
def test_reply_streams_text_with_the_plan_in_the_prompt(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: dict = {}

    def fake(config, payload):
        sent.update(payload)
        yield text_chunk("The route is ")
        yield text_chunk("13.5 km.")

    monkeypatch.setattr(assistant, "get_llm_config", lambda: FAKE)
    monkeypatch.setattr("server.main.get_llm_config", lambda: FAKE)
    monkeypatch.setattr(assistant, "stream_completion", fake)
    response = client.post("/api/v1/assistant/chat", json=ask("How long is it?"))
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    received = events(response.text)
    assert [item["type"] for item in received] == ["text", "text", "done"]
    assert "".join(item["text"] for item in received if item["type"] == "text") == "The route is 13.5 km."
    assert sent["model"] == "test-model" and sent["stream"] is True
    assert "WP-02 Delta Front" in sent["messages"][0]["content"]
    last = sent["messages"][-1]["content"]
    assert "How long is it?" in last and '"feasible": true' in last and '"energy_budget": 45000.0' in last


@needs_rasters
def test_proposal_is_replanned_before_it_is_shown(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake(config, payload):
        yield text_chunk("Dropping the far stop saves the most.")
        yield from tool_chunks({"summary": "Skip Upper Delta Traverse", "remove_stops": ["WP-03"]})

    monkeypatch.setattr("server.main.get_llm_config", lambda: FAKE)
    monkeypatch.setattr(assistant, "stream_completion", fake)
    received = events(client.post("/api/v1/assistant/chat", json=ask()).text)
    proposal = next(item for item in received if item["type"] == "proposal")
    assert [stop["id"] for stop in proposal["mission"]["route_stops"]] == ["WP-01", "WP-02"]
    assert proposal["outcome"]["feasible"] is True
    baseline = client.post("/api/v1/routes/plan", json=DEFAULT_MISSION).json()["primary"]["metrics"]["distance_m"]
    assert 0 < proposal["outcome"]["route"]["distance_m"] < baseline
    assert received[-1]["type"] == "done"


@needs_rasters
def test_unusable_proposal_becomes_a_notice(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake(config, payload):
        yield text_chunk("Try this.")
        yield from tool_chunks({"summary": "Add a target", "add_science_stops": ["WP-404"]})

    monkeypatch.setattr("server.main.get_llm_config", lambda: FAKE)
    monkeypatch.setattr(assistant, "stream_completion", fake)
    received = events(client.post("/api/v1/assistant/chat", json=ask()).text)
    assert [item["type"] for item in received] == ["text", "notice", "done"]
    assert "WP-404" in received[1]["message"]


@needs_rasters
def test_provider_failure_is_reported_in_the_stream(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake(config, payload):
        raise ProviderError("The Google Gemini free-tier limit is used up for now. Wait a minute and ask again.")
        yield  # pragma: no cover

    monkeypatch.setattr("server.main.get_llm_config", lambda: FAKE)
    monkeypatch.setattr(assistant, "stream_completion", fake)
    received = events(client.post("/api/v1/assistant/chat", json=ask()).text)
    assert received == [{"type": "error", "message": "The Google Gemini free-tier limit is used up for now. Wait a minute and ask again."}]


def test_conversation_must_fit_the_limits() -> None:
    too_long = {"mission": DEFAULT_MISSION, "messages": [{"role": "user", "content": "x" * 4001}]}
    assert client.post("/api/v1/assistant/chat", json=too_long).status_code == 422
