"""Route advisor: a language model that explains the current plan and proposes changes.

The model never decides whether a route is safe. It reads the planner's figures,
answers questions about them, and may propose a change to the mission. Every
proposal is re-planned by the routing engine before the crew sees it, so the
figures shown next to a proposal come from the planner, not from the model.

Any provider with an OpenAI-compatible chat completions endpoint works. The
presets below all have a free tier; pick one by setting its API key.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field, ValidationError

from .config import ABSOLUTE_MAX_SLOPE_DEG, BASE_WALK_SPEED_M_S, HABITAT_RADIUS_M, REPO_ROOT
from .routing import RoutingEngine
from .schemas import MissionConfig, RouteCandidate, RoutePlanResponse, ScienceRouteStop

try:  # Optional: lets a local .env hold the key without exporting it in every shell.
    from dotenv import load_dotenv

    load_dotenv(REPO_ROOT / ".env")
except ImportError:  # pragma: no cover - python-dotenv ships with uvicorn[standard]
    pass


# --- Provider configuration ---------------------------------------------------

@dataclass(frozen=True)
class Preset:
    label: str
    base_url: str
    model: str
    key_env: str | None


PRESETS: dict[str, Preset] = {
    "gemini": Preset("Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai", "gemini-3.5-flash", "GEMINI_API_KEY"),
    "groq": Preset("Groq", "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile", "GROQ_API_KEY"),
    "openrouter": Preset("OpenRouter", "https://openrouter.ai/api/v1", "meta-llama/llama-3.3-70b-instruct:free", "OPENROUTER_API_KEY"),
    "ollama": Preset("Ollama (local)", "http://127.0.0.1:11434/v1", "llama3.1", None),
}


@dataclass(frozen=True)
class LLMConfig:
    provider: str
    label: str
    base_url: str
    model: str
    api_key: str | None


def get_llm_config() -> LLMConfig | None:
    """Resolve the provider from the environment, or None when nothing is configured.

    ARES_LLM_PROVIDER picks a preset explicitly; otherwise the first preset whose
    API key is set wins. ARES_LLM_MODEL, ARES_LLM_BASE_URL and ARES_LLM_API_KEY
    override individual fields, which also covers providers not listed here.
    """
    provider = os.environ.get("ARES_LLM_PROVIDER", "").strip().lower()
    if not provider:
        provider = next((name for name, preset in PRESETS.items() if preset.key_env and os.environ.get(preset.key_env)), "")
    if not provider and os.environ.get("ARES_LLM_BASE_URL"):
        provider = "custom"
    if not provider:
        return None

    preset = PRESETS.get(provider)
    base_url = os.environ.get("ARES_LLM_BASE_URL") or (preset.base_url if preset else "")
    model = os.environ.get("ARES_LLM_MODEL") or (preset.model if preset else "")
    api_key = os.environ.get("ARES_LLM_API_KEY") or (os.environ.get(preset.key_env) if preset and preset.key_env else None)
    if not base_url or not model:
        return None
    if preset and preset.key_env and not api_key:
        return None
    return LLMConfig(provider, preset.label if preset else "Custom endpoint", base_url.rstrip("/"), model, api_key)


# --- What the model may propose ----------------------------------------------

# Same ranges as the Route settings sliders, so an applied proposal is always reachable by hand.
LIMIT_RANGES: dict[str, tuple[float, float]] = {
    "max_duration_min": (240, 1000),
    "energy_budget": (15000, 70000),
    "preferred_max_slope_deg": (8, 25),
    "return_reserve_pct": (10, 50),
}
MAX_STOPS = 12


class MissionChange(BaseModel):
    summary: str = Field(min_length=1, max_length=280)
    add_science_stops: list[str] = Field(default_factory=list, max_length=MAX_STOPS)
    remove_stops: list[str] = Field(default_factory=list, max_length=MAX_STOPS)
    max_duration_min: float | None = None
    energy_budget: float | None = None
    preferred_max_slope_deg: float | None = None
    return_reserve_pct: float | None = None


PROPOSE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "propose_mission_change",
        "description": (
            "Propose one change to the EVA plan for the crew to review. Nothing is applied until they accept it, "
            "and the planner re-checks the result. Call this at most once per reply, after explaining the reasoning in text. "
            "Leave out any field that should stay as it is."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One sentence, plain language, saying what changes and why."},
                "add_science_stops": {"type": "array", "items": {"type": "string"}, "description": "Science target IDs to append to the route, e.g. WP-02."},
                "remove_stops": {"type": "array", "items": {"type": "string"}, "description": "IDs of stops to drop from the route."},
                "max_duration_min": {"type": "number", "description": "New maximum EVA duration in minutes, 240 to 1000."},
                "energy_budget": {"type": "number", "description": "New energy budget in EU, 15000 to 70000."},
                "preferred_max_slope_deg": {"type": "number", "description": "New preferred maximum slope in degrees, 8 to 25."},
                "return_reserve_pct": {"type": "number", "description": "New return reserve as a percentage of the budget, 10 to 50."},
            },
            "required": ["summary"],
        },
    },
}


def apply_change(mission: MissionConfig, change: MissionChange, science_ids: set[str]) -> MissionConfig:
    """Return the mission with the change applied, or raise ValueError if it cannot be."""
    current = [stop.id for stop in mission.route_stops]
    unknown = [stop_id for stop_id in change.add_science_stops if stop_id not in science_ids]
    if unknown:
        raise ValueError(f"Unknown science target: {', '.join(unknown)}")
    missing = [stop_id for stop_id in change.remove_stops if stop_id not in current]
    if missing:
        raise ValueError(f"Not on the route: {', '.join(missing)}")

    stops = [stop for stop in mission.route_stops if stop.id not in change.remove_stops]
    kept = {stop.id for stop in stops}
    for stop_id in change.add_science_stops:
        if stop_id not in kept:
            stops.append(ScienceRouteStop(type="science", id=stop_id))
            kept.add(stop_id)
    if not stops:
        raise ValueError("A route needs at least one stop")
    if len(stops) > MAX_STOPS:
        raise ValueError(f"A route can hold at most {MAX_STOPS} stops")

    update: dict[str, Any] = {"route_stops": stops}
    for field, (low, high) in LIMIT_RANGES.items():
        value = getattr(change, field)
        if value is None:
            continue
        if not low <= value <= high:
            raise ValueError(f"{field} must be between {low:g} and {high:g}")
        update[field] = float(value)

    changed = MissionConfig.model_validate(mission.model_copy(update=update).model_dump())
    if changed == mission:
        raise ValueError("The proposal does not change the plan")
    return changed


def route_figures(route: RouteCandidate | None) -> dict[str, Any] | None:
    if route is None:
        return None
    metrics = route.metrics
    return {
        "distance_m": round(metrics.distance_m),
        "duration_min": round(metrics.duration_min),
        "energy_units": round(metrics.energy_units),
        "return_reserve_units": round(metrics.return_reserve_units),
        "maximum_slope_deg": metrics.maximum_slope_deg,
        "elevation_gain_m": round(metrics.elevation_gain_m, 1),
        "science_score": metrics.science_score,
    }


def evaluate_proposal(engine: RoutingEngine, mission: MissionConfig, arguments: Any) -> dict[str, Any]:
    """Validate a tool call and have the planner work out what it would lead to."""
    change = MissionChange.model_validate(arguments)
    changed = apply_change(mission, change, set(engine.waypoints))
    plan = engine.plan(changed, include_envelope=False)
    return {
        "summary": change.summary,
        "mission": changed.model_dump(),
        "outcome": {"feasible": plan.feasible, "warnings": plan.warnings, "route": route_figures(plan.primary)},
    }


# --- Prompt ------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are the route advisor inside ARES Path, a planning tool for a crewed surface walk (EVA) at Jezero Crater, Mars. \
The person you are talking to is planning that walk: they pick stops on a map, and a routing engine computes a round trip \
from the habitat through the stops and back, then checks it against a duration limit, an energy budget and a return reserve.

Your job is to help them understand the current plan and improve it. Each message from them arrives with the current \
mission settings and the planner's latest figures. Treat those figures as the only source of truth about this route: \
quote them exactly, and when something is not in them (a rock field, a time of day, crew fatigue), say that the tool \
does not model it rather than guessing.

The planner decides whether a route is safe to return from, not you. If the plan is marked not feasible, explain which \
limit it breaks using the figures and warnings. Do not tell the crew a route is safe on your own judgement.

When a change to the plan would help, or they ask for one, explain your reasoning briefly and then call \
propose_mission_change once. Finish every sentence of your explanation before the call; never end the text mid-sentence \
and leave the rest to the proposal. The proposal is shown to them with the planner's recomputed figures and only takes effect \
if they accept it, so do not describe it as already done. Propose changes only within what the tool allows: adding or \
removing stops and adjusting the four limits. You cannot move the habitat or place new checkpoints; if that is what \
they need, tell them to use "Relocate" or "Add stop on map".

Keep replies short: a few sentences, or a short list when comparing options. Write plain text without Markdown \
formatting, since the panel shows your reply as typed. Answer in the language the person writes in. \
Units: distances in metres or kilometres, energy in EU (an abstract comparison index, not a physiological model).

How the planner works:
- Terrain steeper than {absolute_slope:g} degrees and cells without elevation data are never crossed.
- Slopes above the preferred maximum are allowed but cost more, so the route bends around them where it can.
- Walking speed starts at {walk_speed:g} m/s and drops with slope. Each stop adds a fixed visit time.
- The return reserve is the share of the energy budget that must still be left when the crew is back at the habitat.
- The habitat can only be moved within {habitat_radius:g} m of its default position.
- Science score (0 to 100) rewards visiting targets across different geologic units with stronger mineral signals. \
Custom checkpoints add distance but no science score.

Known limitations of the data:
{limitations}

Science targets available at this site:
{targets}
"""


def build_system_prompt(engine: RoutingEngine) -> str:
    targets = []
    for waypoint_id, waypoint in sorted(engine.waypoints.items()):
        properties = waypoint["properties"]
        evidence = engine.science_evidence.get(waypoint_id, {})
        targets.append(
            f"- {waypoint_id} {properties.get('name', '')} (priority {properties.get('priority', '?')} of 3, "
            f"geologic unit {evidence.get('geology_symbol') or 'unmapped'}, "
            f"mineral interest {evidence.get('mineral_interest', 0):.2f} of 1): {properties.get('science_rationale', '')}"
        )
    return SYSTEM_PROMPT.format(
        absolute_slope=ABSOLUTE_MAX_SLOPE_DEG,
        walk_speed=BASE_WALK_SPEED_M_S,
        habitat_radius=HABITAT_RADIUS_M,
        limitations="\n".join(f"- {item}" for item in engine.assumptions),
        targets="\n".join(targets),
    )


def describe_state(engine: RoutingEngine, mission: MissionConfig, plan: RoutePlanResponse, active_route: str) -> str:
    """The mission and the planner's figures, as the model sees them on every turn."""
    def stop_label(stop: Any) -> dict[str, Any]:
        if stop.type == "science":
            name = engine.waypoints.get(stop.id, {}).get("properties", {}).get("name", stop.id)
            return {"id": stop.id, "kind": "science target", "name": name}
        return {"id": stop.id, "kind": "custom checkpoint", "name": stop.name}

    def candidate(route: RouteCandidate | None) -> dict[str, Any] | None:
        if route is None:
            return None
        return {
            **(route_figures(route) or {}),
            "arrivals": [
                {"stop": visit["id"], "distance_m": round(visit["arrival_distance_m"]), "energy_units": round(visit["arrival_energy_units"])}
                for visit in route.stop_visits
            ],
            "planner_notes": route.explanation,
        }

    state = {
        "mission": {
            "stops_in_visit_order": [stop_label(stop) for stop in mission.route_stops],
            "max_duration_min": mission.max_duration_min,
            "energy_budget": mission.energy_budget,
            "preferred_max_slope_deg": mission.preferred_max_slope_deg,
            "return_reserve_pct": mission.return_reserve_pct,
            "reserve_starts_at_energy_units": round(mission.energy_budget * (1 - mission.return_reserve_pct / 100)),
        },
        "planner": {
            "feasible": plan.feasible,
            "warnings": plan.warnings,
            "route_shown_on_map": active_route,
            "primary_route": candidate(plan.primary),
            "alternative_route": candidate(plan.alternative),
        },
    }
    return json.dumps(state, ensure_ascii=False, indent=1)


# --- Talking to the provider -------------------------------------------------

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class AssistantRequest(BaseModel):
    mission: MissionConfig
    messages: list[ChatMessage] = Field(min_length=1, max_length=24)
    active_route: Literal["primary", "alternative"] = "primary"


class ProviderError(Exception):
    """A failure the crew can act on; the message is shown in the panel as written."""


def stream_completion(config: LLMConfig, payload: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Yield the provider's streamed chunks as dictionaries."""
    headers = {"Content-Type": "application/json"}
    if config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"
    try:
        with httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            with client.stream("POST", f"{config.base_url}/chat/completions", headers=headers, json=payload) as response:
                if response.status_code >= 400:
                    response.read()
                    raise ProviderError(_explain_status(config, response.status_code))
                for line in response.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        return
                    try:
                        yield json.loads(data)
                    except json.JSONDecodeError:
                        continue
    except httpx.TimeoutException as exc:
        raise ProviderError(f"{config.label} took too long to answer. Try again.") from exc
    except httpx.HTTPError as exc:
        raise ProviderError(f"Could not reach {config.label}. Check the network connection and the base URL.") from exc


def _explain_status(config: LLMConfig, status: int) -> str:
    if status in (401, 403):
        return f"{config.label} rejected the API key. Check the key in .env and restart the server."
    if status == 404:
        return f"{config.label} does not know the model \"{config.model}\". Set ARES_LLM_MODEL to a model your account can use."
    if status == 429:
        return f"The {config.label} free-tier limit is used up for now. Wait a minute and ask again."
    if status >= 500:
        return f"{config.label} is having trouble (HTTP {status}). Try again shortly."
    return f"{config.label} refused the request (HTTP {status})."


def event(kind: str, **fields: Any) -> str:
    return f"data: {json.dumps({'type': kind, **fields}, ensure_ascii=False)}\n\n"


def advise(engine: RoutingEngine, config: LLMConfig, request: AssistantRequest) -> Iterator[str]:
    """Answer the last message as a stream of server-sent events."""
    try:
        plan = engine.plan(request.mission, include_envelope=False)
        *history, question = request.messages
        messages: list[dict[str, Any]] = [{"role": "system", "content": build_system_prompt(engine)}]
        messages += [{"role": item.role, "content": item.content} for item in history]
        messages.append({
            "role": "user",
            "content": (
                "Current plan, from the planner:\n"
                f"{describe_state(engine, request.mission, plan, request.active_route)}\n\n"
                f"Message from the crew planner:\n{question.content}"
            ),
        })
        payload = {
            "model": config.model,
            "messages": messages,
            "tools": [PROPOSE_TOOL],
            "tool_choice": "auto",
            "temperature": 0.3,
            "max_tokens": 1200,
            "stream": True,
        }

        name = ""
        arguments = ""
        wrote_text = False
        for chunk in stream_completion(config, payload):
            choice = (chunk.get("choices") or [{}])[0]
            delta = choice.get("delta") or {}
            if delta.get("content"):
                wrote_text = True
                yield event("text", text=delta["content"])
            # Only the first tool call counts: the prompt allows one proposal per reply.
            for call in delta.get("tool_calls") or []:
                if call.get("index", 0) != 0:
                    continue
                function = call.get("function") or {}
                name = function.get("name") or name
                arguments += function.get("arguments") or ""

        if name == PROPOSE_TOOL["function"]["name"]:
            try:
                yield event("proposal", **evaluate_proposal(engine, request.mission, json.loads(arguments or "{}")))
            except (json.JSONDecodeError, ValidationError, ValueError) as exc:
                reason = str(exc) if isinstance(exc, ValueError) and not isinstance(exc, (ValidationError, json.JSONDecodeError)) else "it was not a valid change"
                yield event("notice", message=f"The advisor suggested a change the planner could not use: {reason}.")
        elif not wrote_text:
            yield event("notice", message="The advisor returned an empty reply. Ask again, or rephrase the question.")
        yield event("done")
    except ProviderError as exc:
        yield event("error", message=str(exc))
    except Exception:  # noqa: BLE001 - the stream has already started, so report in-band
        yield event("error", message="The advisor stopped unexpectedly. Ask again.")
