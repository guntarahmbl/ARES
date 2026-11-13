import "./style.css";
import {
  STUDY,
  coordinates,
  DEFAULTS,
  HOME,
  MODEL,
  SOURCES,
  TARGETS,
  makeGrid,
  cellIndex,
  validateConfig,
} from "./data.js";
import {
  makeRoute,
  planMission,
  adaptMission,
  returnField,
  emergencyRoute,
  safetyEnvelope,
  simulationAt,
  traversable,
} from "./planner.js";
import { MapView, drawProfile } from "./map.js";
import { TerrainScene } from "./scene.js";
const $ = (id) => document.getElementById(id);
const grid = makeGrid();
let config = { ...DEFAULTS },
  home = cellIndex(grid, HOME),
  start = home,
  ids = TARGETS.map((t) => t.id),
  closed = new Set(),
  consumed = { energy: 0, minutes: 0 },
  energyLoss = 0,
  completed = [],
  offset = 0;
let candidates,
  route,
  homeField,
  envelope,
  mode = "inspect",
  view = "map",
  scene,
  playTimer = null,
  notice = "",
  before = null,
  calculationMs = 0;
const layers = {
  minerals: false,
  surface: true,
  elevation: false,
  slope: false,
  hazard: true,
  geology: false,
  traverse: false,
  science: true,
  envelope: true,
};
let mineralBand = "olindex3";
$("mineral-band").onchange = (e) => {
  mineralBand = e.target.value;
  renderMap();
};
const map = new MapView($("map"), selectPoint);
let toastTimer;
function toast(text) {
  $("toast").textContent = text;
  $("toast").className = "visible";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").className = ""), 4500);
}
function current() {
  if (!route?.path)
    return {
      index: start,
      offset: 0,
      energy: consumed.energy,
      minutes: consumed.minutes,
      visited: [...completed],
    };
  const local = simulationAt(grid, route, offset);
  return {
    ...local,
    energy: consumed.energy + local.energy,
    minutes: consumed.minutes + local.minutes,
    visited: [...new Set([...completed, ...local.visited])],
  };
}
function stop() {
  clearInterval(playTimer);
  playTimer = null;
  $("play").textContent = "▶ Preview EVA";
}
function commitPosition() {
  const p = current();
  start = p.index;
  consumed = { energy: p.energy, minutes: p.minutes };
  completed = p.visited;
  ids = ids.filter((id) => !completed.includes(id));
  offset = 0;
  stop();
}
function options() {
  return { closed, consumed, energyLoss };
}
function calculate({ adapt = false } = {}) {
  const began = performance.now();
  candidates = planMission(grid, home, start, ids, config, options());
  if (adapt && !candidates.primary.feasible) {
    const result = adaptMission(grid, home, start, ids, config, options());
    if (result.route.feasible) {
      ids = result.ids;
      notice += ` Dropped lower-priority target${result.dropped.length > 1 ? "s" : ""} ${result.dropped.join(", ")} to preserve the reserve.`;
      candidates = planMission(grid, home, start, ids, config, options());
    }
  }
  route = candidates.primary;
  offset = 0;
  homeField = returnField(grid, home, config, closed);
  calculationMs = performance.now() - began;
  render();
}
function readConfig() {
  const next = {
    duration: Number($("duration").value),
    energy: Number($("energy").value),
    maxSlope: Number($("maxSlope").value),
    reserve: Number($("reserve").value),
    objective: $("objective").value,
  };
  const error = validateConfig(next);
  if (error) {
    toast(error);
    return null;
  }
  return next;
}
function updateOutputs() {
  $("slope-value").textContent = `${$("maxSlope").value}°`;
  $("reserve-value").textContent = `${$("reserve").value}%`;
  $("opacity-value").textContent = `${$("opacity").value}%`;
}
$("mission-form").onsubmit = (e) => {
  e.preventDefault();
  const next = readConfig();
  if (!next) return;
  commitPosition();
  config = next;
  notice = "";
  before = null;
  calculate();
  toast("Mission plan updated. All costs include the return to habitat.");
};
for (const id of ["maxSlope", "reserve"])
  $(id).addEventListener("input", updateOutputs);
for (const id of ["duration", "energy", "maxSlope", "reserve", "objective"])
  $(id).addEventListener("change", () => {
    const next = readConfig();
    if (!next) return;
    commitPosition();
    config = next;
    notice = "";
    before = null;
    calculate();
  });
$("layers").onchange = (e) => {
  if (!e.target.dataset.layer) return;
  layers[e.target.dataset.layer] = e.target.checked;
  renderMap();
};
$("opacity").oninput = () => {
  updateOutputs();
  renderMap();
};
function metric(value, unit, label, small = false) {
  return `<div class="metric${small ? " small" : ""}"><strong>${value}<span>${unit}</span></strong>${label}</div>`;
}
function routeCard(candidate, index) {
  const selected =
      route === candidate || (route.emergency && candidate.emergency),
    label = index === 0 ? "Recommended plan" : "Alternative plan",
    name =
      candidate.objective === "shortest"
        ? "Shortest distance"
        : candidate.objective === "safest"
          ? "Lowest terrain cost"
          : candidate.objective === "energy"
            ? "Emergency return"
            : "Balanced exploration";
  if (!candidate.path)
    return `<article class="route-card"><div class="route-head">${label}<small class="infeasible">NO PATH</small></div><p class="no-route">${candidate.reasons.join(" ")}</p></article>`;
  const m = candidate.metrics;
  return `<article class="route-card${selected ? " selected" : ""}"><div class="route-head">${label}<small class="${candidate.feasible ? "" : "infeasible"}">${candidate.feasible ? "✓ FEASIBLE" : "! INFEASIBLE"}</small></div><div class="route-sub">${name} · ${candidate.ids.length} remaining science stops</div><div class="metric-grid">${metric(m.distance.toFixed(0), "m", "Distance · derived")}${metric(m.minutes.toFixed(0), "min", "Duration · assumed")}${metric(m.energy.toFixed(1), "u", "Energy · assumed")}${metric(`+${m.gain.toFixed(0)} / −${m.loss.toFixed(0)}`, "m", "Elevation · derived", true)}${metric(m.maxSlope.toFixed(1), "°", "Max slope · derived", true)}${metric(candidate.reservePercent.toFixed(1), "%", "Final energy reserve", true)}</div><div class="score-row"><span>Terrain score <b>${m.safety}/100</b></span><span>Science <b>${m.science}/100</b></span></div>${candidate.feasible ? "" : `<p class="tiny" style="color:var(--red)">${candidate.reasons.join(" ")}</p>`}${candidate.note ? `<p class="tiny">${candidate.note}</p>` : ""}${index === 1 ? `<button class="card-action" data-use-alternative ${!candidate.feasible ? "disabled" : ""}>Use this route ↗</button>` : ""}</article>`;
}
function renderTargets() {
  const ordered = [
    ...ids.map((id) => {
      const { images, ...t } = TARGETS.find((t) => t.id === id);
      return { ...t, images: images.map(({ dataUri, ...img }) => img) };
    }),
    ...TARGETS.filter((t) => !ids.includes(t.id)),
  ];
  $("target-count").textContent =
    `${ids.length} selected · ${completed.length} visited`;
  $("targets").innerHTML = ordered
    .map((t) => {
      const selected = ids.includes(t.id),
        visited = completed.includes(t.id),
        index = ids.indexOf(t.id);
      return `<article class="target"><div class="target-main"><input class="target-check" type="checkbox" data-select="${t.id}" aria-label="Select ${t.title}" ${selected ? "checked" : ""} ${visited ? "disabled" : ""}><span class="target-letter">${visited ? "✓" : t.id}</span><button class="target-title" data-detail="${t.id}">${t.title}<small>${t.category} · regional context / priority ${t.priority} assumed</small></button></div><div class="target-meta"><span>${visited ? "Visited" : `${t.minutes} min observation`}</span><div class="order-buttons">${selected ? `<button data-order="${t.id}" data-dir="-1" aria-label="Move ${t.title} earlier" ${index === 0 ? "disabled" : ""}>↑</button><button data-order="${t.id}" data-dir="1" aria-label="Move ${t.title} later" ${index === ids.length - 1 ? "disabled" : ""}>↓</button>` : ""}<button data-detail="${t.id}" aria-label="Evidence for ${t.title}">ⓘ</button></div></div></article>`;
    })
    .join("");
}
function render() {
  const p = current(),
    resources = { energy: p.energy, minutes: p.minutes };
  envelope = safetyEnvelope(grid, homeField, p.index, config, {
    closed,
    consumed: resources,
    energyLoss,
  });
  const emergency = emergencyRoute(
    grid,
    homeField,
    p.index,
    home,
    config,
    resources,
    energyLoss,
  );
  const safe = route.feasible && emergency.feasible;
  $("plan-state").textContent = safe ? "FEASIBLE" : "INFEASIBLE";
  $("plan-state").className = `badge${safe ? "" : " red"}`;
  const warnings = [];
  if (notice) warnings.push(notice);
  if (!route.feasible) warnings.push(...route.reasons);
  if (!emergency.feasible)
    warnings.push(
      `Return reserve violated. ${emergency.reasons.join(" ")} Return now if a path remains; restore resources or undo the latest closure.`,
    );
  if (
    emergency.feasible &&
    Math.min(
      emergency.energyMargin / config.energy,
      emergency.timeMargin / config.duration,
    ) < 0.1
  )
    warnings.push(
      "Caution: less than 10% additional margin remains above the configured return reserve. Avoid adding stops.",
    );
  if (before && route.metrics)
    warnings.push(
      `Before → after: ${before.distance.toFixed(0)} → ${route.metrics.distance.toFixed(0)} m remaining, ${before.energy.toFixed(1)} → ${route.metrics.energy.toFixed(1)} energy units, ${before.science} → ${route.metrics.science} science score.`,
    );
  $("warning").innerHTML = warnings.length
    ? `<div class="warning-box${safe ? "" : " critical"}"><strong>${safe ? "Scenario update" : "Action required"}</strong>${warnings.join(" ")}${!route.feasible && !route.emergency ? '<br><button id="adapt-plan">Drop lower-priority stops & replan</button>' : ""}</div>`
    : "";
  $("adapt-plan")?.addEventListener("click", () => {
    commitPosition();
    notice = "Replanned for remaining resources.";
    calculate({ adapt: true });
  });
  $("route-cards").innerHTML = route.emergency
    ? routeCard({ ...route, ids: [] }, 0)
    : routeCard(candidates.primary, 0) + routeCard(candidates.alternative, 1);
  const altButton = document.querySelector("[data-use-alternative]");
  if (altButton)
    altButton.onclick = () => {
      const alt = candidates.alternative;
      commitPosition();
      ids = alt.ids.filter((id) => !completed.includes(id));
      config.objective = alt.objective;
      $("objective").value = config.objective;
      notice = "Alternative route selected.";
      calculate();
    };
  if (route.metrics) {
    const selected = route.ids.map((id) => {
      const { images, ...t } = TARGETS.find((t) => t.id === id);
      return { ...t, images: images.map(({ dataUri, ...img }) => img) };
    });
    let explanation = `Avoids nodata, closed terrain and slopes above ${config.maxSlope}°. `;
    if (candidates.alternative.metrics && route === candidates.primary) {
      const diff =
        candidates.alternative.metrics.maxSlope - route.metrics.maxSlope;
      if (diff > 0.1)
        explanation += `Peak slope is ${diff.toFixed(1)}° lower than the alternative. `;
    }
    explanation += selected.length
      ? `Visits ${selected.map((t) => t.category.toLowerCase()).join(", ")} targets for complementary geological context. `
      : "Returns directly to habitat. ";
    explanation += "Terrain and science scores are scenario heuristics.";
    $("explanation").textContent = explanation;
    $("profile-summary").textContent =
      `↑ ${route.metrics.gain.toFixed(0)} m  ↓ ${route.metrics.loss.toFixed(0)} m`;
  } else {
    $("explanation").textContent =
      "No traversable route exists under the current exclusions and slope limit. Adjust the mission to generate a path.";
    $("profile-summary").textContent = "";
  }
  renderTargets();
  const remaining = Math.max(0, config.energy - p.energy - energyLoss);
  $("elapsed").textContent = `${p.minutes.toFixed(1)} min`;
  $("energy-left").textContent = `${remaining.toFixed(1)} u`;
  $("return-cost").textContent = emergency.metrics
    ? `${emergency.metrics.energy.toFixed(1)} u`
    : "No path";
  $("return-status").innerHTML =
    `<strong class="${emergency.feasible ? "" : "unsafe"}">${emergency.feasible ? "✓ Return reserve preserved" : "! Return reserve not met"}</strong><p class="tiny">${emergency.metrics ? `${emergency.metrics.distance.toFixed(0)} m / ${emergency.metrics.minutes.toFixed(1)} min to habitat · ${emergency.reservePercent.toFixed(1)}% energy on arrival` : "Habitat cannot be reached through traversable cells."}</p>`;
  const progress =
    route.path && route.path.length > 1
      ? Math.round((offset / (route.path.length - 1)) * 100)
      : 0;
  $("progress").value = progress;
  $("progress-label").textContent = `${progress}%`;
  $("progress").disabled = !route.path;
  const finished =
    route.path &&
    offset === route.path.length - 1 &&
    route.path[offset] === home;
  $("sim-status").textContent =
    finished && offset > 0
      ? "Mission complete · back at habitat"
      : p.index === home
        ? "Ready at habitat"
        : `On EVA · ${p.visited.length} targets visited`;
  $("play").disabled = !route.path || !route.feasible || !emergency.feasible;
  $("energy-loss").disabled = remaining <= 0;
  $("calculation-time").textContent =
    `${grid.cells.length.toLocaleString()} CELLS · ROUTING ${calculationMs.toFixed(0)} ms`;
  renderMap(false);
  drawProfile($("profile"), route, offset, grid);
}
function mapState() {
  const p = current();
  return {
    grid,
    mineralBand,
    config,
    home,
    position: p.index,
    route,
    alternative: route.emergency ? null : candidates.alternative,
    closed,
    envelope,
    layers,
    opacity: Number($("opacity").value) / 100,
    ids,
    visited: p.visited,
    offset,
  };
}
function renderMap(recompute = false) {
  if (recompute) {
    const p = current();
    envelope = safetyEnvelope(grid, homeField, p.index, config, {
      closed,
      consumed: p,
      energyLoss,
    });
  }
  const state = mapState();
  map.setState(state);
  if (scene && view === "3d") scene.setState(state);
  renderLegend();
}
function renderLegend() {
  const lines = [];
  if (layers.envelope)
    lines.push(
      '<div class="legend-title">RETURN ENVELOPE · DERIVED</div><div class="legend-line"><i class="legend-dot" style="background:#91b68b"></i>✓ Safe margin</div><div class="legend-line"><i class="legend-dot" style="background:#dbbc7d"></i>! Caution · extra margin &lt;10%</div><div class="legend-line"><i class="legend-dot" style="background:#c18a6e"></i>× Reserve not preserved</div>',
    );
  if (layers.elevation)
    lines.push(
      '<div class="legend-line">Elevation · −2548 to −2516 m source datum</div>',
    );
  if (layers.slope)
    lines.push(
      `<div class="legend-line">Slope · green ≤${Math.min(12, config.maxSlope)}° / amber ≤${config.maxSlope}° / red above limit</div>`,
    );
  if (layers.geology)
    lines.push(
      '<div class="legend-line">Geology · purple NHjf2 / green Njf · ±100–200 m</div>',
    );
  if (layers.minerals)
    lines.push(
      `<div class="legend-line">CRISM ${mineralBand.toUpperCase()} · native 18 m · dimensionless<br>Blue low / red high: ${Math.min(...STUDY.crism[mineralBand]).toFixed(4)} to ${Math.max(...STUDY.crism[mineralBand]).toFixed(4)}<br>Spectral indicator; not confirmed mineral detection</div>`,
    );
  if (layers.hazard)
    lines.push('<div class="legend-line">▧ Hatched · excluded cells</div>');
  if (layers.science)
    lines.push(
      '<div class="legend-line">A–C · proposed visits at observed rover stops</div>',
    );
  if (layers.traverse)
    lines.push(
      '<div class="legend-line">··· PLACES rover localizations · gaps preserved</div>',
    );
  lines.push(
    '<div class="legend-line">━ Blue · selected &nbsp; ┄ Alternate</div>',
  );
  $("map-legend").innerHTML = lines.join("");
}
$("targets").onchange = (e) => {
  const id = e.target.dataset.select;
  if (!id) return;
  commitPosition();
  ids = e.target.checked ? [...ids, id] : ids.filter((v) => v !== id);
  notice = "";
  calculate();
};
$("targets").onclick = (e) => {
  const detail = e.target.closest("[data-detail]");
  if (detail) {
    showTarget(detail.dataset.detail);
    return;
  }
  const button = e.target.closest("[data-order]");
  if (!button) return;
  const id = button.dataset.order;
  commitPosition();
  const i = ids.indexOf(id),
    j = i + Number(button.dataset.dir);
  if (i >= 0 && j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j], ids[i]];
  notice = "";
  calculate();
};
function showTarget(id) {
  stop();
  const t = TARGETS.find((t) => t.id === id);
  $("detail-title").textContent = `${t.id} / ${t.title}`;
  $("detail-body").innerHTML =
    `<h3>Observed rover camera position</h3><p>${t.latitude.toFixed(7)}° N, ${t.longitude.toFixed(7)}° E · sol ${t.sol} · site ${t.site}, drive ${t.drive}. Snapped ${t.localizationErrorMeters} m to the routing grid. Camera position does not define the photographed feature or image footprint.</p><div class="photo-grid">${t.images.map((img) => `<figure><a href="${img.url}" target="_blank" rel="noopener noreferrer"><img src="${img.dataUri}" alt="${img.instrument}, sol ${img.sol}" /></a><figcaption>${img.instrument} · ${img.date} UTC<br>${img.productId}<br>${img.credit}</figcaption></figure>`).join("")}</div><h3>Scientific rationale · interpreted</h3><p>${t.rationale}</p><h3>Suggested activity · assumed</h3><p>${t.activity} Allow ${t.minutes} min; priority ${t.priority}.</p><h3>Evidence & provenance</h3><p>${t.evidence}</p><p>CRISM raw indicators: ${Object.entries(
      t.mineralIndicators,
    )
      .map(([k, v]) => `${k}: ${v}`)
      .join(
        "; ",
      )}. Native 18 m pixels, not confirmed mineral identifications.</p>`;
  $("target-detail").showModal();
}
$("detail-close").onclick = () => $("target-detail").close();
function setMode(next) {
  mode = mode === next ? "inspect" : next;
  $("move-home").classList.toggle("active", mode === "home");
  $("close-area").classList.toggle("active", mode === "close");
  $("map-hint").textContent =
    mode === "home"
      ? "Click an allowed cell to place habitat"
      : mode === "close"
        ? "Click to exclude a 20 m region"
        : "Drag to pan · scroll to zoom · click to inspect";
  if (view === "3d" && mode !== "inspect") setView("map");
}
$("move-home").onclick = () => setMode("home");
$("close-area").onclick = () => setMode("close");
function selectPoint(point) {
  const i = cellIndex(grid, point),
    cell = grid.cells[i];
  if (!cell) return;
  if (mode === "home") {
    if (current().index !== home || consumed.energy > 0 || offset > 0) {
      toast("Reset the simulation before moving the habitat.");
      return;
    }
    if (
      !traversable(grid, i, config, closed) ||
      TARGETS.some((t) => Math.hypot(t.x - cell.x, t.z - cell.z) < 15)
    ) {
      toast(
        "Choose an unblocked cell away from science targets and below the slope limit.",
      );
      return;
    }
    home = start = i;
    notice = "Habitat moved to an allowed grid cell.";
    calculate();
    setMode("home");
    return;
  }
  if (mode === "close") {
    const p = current(),
      affected = grid.cells.filter(
        (c) => Math.hypot(c.x - cell.x, c.z - cell.z) <= 10,
      );
    if (
      affected.some(
        (c) =>
          c.i === home ||
          c.i === p.index ||
          TARGETS.some((t) => cellIndex(grid, t) === c.i),
      )
    ) {
      toast(
        "A closure cannot cover the habitat, astronaut, or a science stop.",
      );
      return;
    }
    commitPosition();
    for (const c of affected) closed.add(c.i);
    $("clear-closures").hidden = false;
    notice = "A local region was excluded. Routes were recalculated.";
    calculate();
    return;
  }
  const nearby = TARGETS.find(
    (t) => Math.hypot(t.x - point.x, t.z - point.z) < 13 / map.zoom,
  );
  if (nearby && layers.science) {
    showTarget(nearby.id);
    return;
  }
  $("point-info").hidden = false;
  $("point-info").innerHTML =
    `<strong>LOCAL GRID INSPECTION</strong><br>x ${cell.x} m · z ${cell.z} m<br>Elevation ${cell.height.toFixed(1)} m · slope ${cell.slope.toFixed(1)}°<br>${cell.nodata ? "Nodata · excluded" : cell.blocked || closed.has(i) ? "Manually excluded terrain" : cell.slope > config.maxSlope ? "Above configured slope limit" : "Traversable under the current model"}<br><small>HiRISE DTM → 5 m elevation/slope. ${coordinates(cell).latitude.toFixed(6)}° N, ${coordinates(cell).longitude.toFixed(6)}° E. Mars sphere R=3396190 m.</small>`;
}
$("clear-closures").onclick = () => {
  commitPosition();
  closed.clear();
  $("clear-closures").hidden = true;
  notice = "Manual closures cleared.";
  calculate();
};
$("progress").oninput = (e) => {
  stop();
  if (!route.path) return;
  offset = Math.round((Number(e.target.value) / 100) * (route.path.length - 1));
  render();
};
$("play").onclick = () => {
  if (playTimer) {
    stop();
    return;
  }
  if (!route?.feasible || !route.path) return;
  if (offset >= route.path.length - 1) {
    toast("Reset the demo to preview a new EVA.");
    return;
  }
  $("play").textContent = "Ⅱ Pause preview";
  playTimer = setInterval(() => {
    offset = Math.min(offset + 2, route.path.length - 1);
    render();
    if (offset === route.path.length - 1) {
      stop();
      toast("EVA complete. The astronaut is back at habitat.");
    }
  }, 180);
};
$("energy-loss").onclick = () => {
  const p = current(),
    lost = Math.max(0, config.energy - p.energy - energyLoss) * 0.2;
  commitPosition();
  const previous = makeRoute(grid, home, start, ids, config, options());
  before = previous.metrics ? { ...previous.metrics } : null;
  energyLoss += lost;
  notice = `Scenario: ${lost.toFixed(1)} energy units lost (20% of remaining energy).`;
  calculate({ adapt: true });
  toast(
    "Energy loss applied; remaining mission and return envelope recalculated.",
  );
};
$("emergency").onclick = () => {
  commitPosition();
  route = emergencyRoute(
    grid,
    homeField,
    start,
    home,
    config,
    consumed,
    energyLoss,
  );
  route.emergency = true;
  notice = route.feasible
    ? "Emergency return selected. Remaining science stops are canceled."
    : "Emergency return cannot preserve the configured reserve. Review the reported constraint.";
  ids = [];
  offset = 0;
  render();
  toast(
    route.feasible
      ? "Direct minimum-energy route to habitat is ready."
      : "Emergency return is infeasible under the current constraints.",
  );
};
function setView(next) {
  view = next;
  $("map").hidden = view !== "map";
  $("scene").hidden = view !== "3d";
  $("view-map").classList.toggle("active", view === "map");
  $("view-3d").classList.toggle("active", view === "3d");
  $("view-map").setAttribute("aria-pressed", view === "map");
  $("view-3d").setAttribute("aria-pressed", view === "3d");
  $("point-info").hidden = true;
  $("map-hint").textContent =
    view === "3d"
      ? "Drag to orbit · scroll to zoom · preview EVA to move astronaut"
      : "Drag to pan · scroll to zoom · click to inspect";
  if (view === "3d") {
    try {
      if (!scene) scene = new TerrainScene($("scene"), grid);
      scene.setState(mapState());
      $("webgl-error").hidden = true;
    } catch (error) {
      $("webgl-error").hidden = false;
      toast("3D is unavailable. Use the 2D map to continue planning.");
      console.warn("WebGL preview unavailable:", error.message);
    }
  } else {
    $("webgl-error").hidden = true;
    map.draw();
  }
}
$("view-map").onclick = () => setView("map");
$("view-3d").onclick = () => setView("3d");
$("zoom-in").onclick = () =>
  view === "map" ? map.changeZoom(1.25) : scene?.zoom(1.25);
$("zoom-out").onclick = () =>
  view === "map" ? map.changeZoom(0.8) : scene?.zoom(0.8);
$("fit").onclick = () => (view === "map" ? map.fit() : scene?.fit());
function openSources() {
  stop();
  $("sources").showModal();
}
$("sources-open").onclick = openSources;
$("layer-sources").onclick = openSources;
$("sources-close").onclick = () => $("sources").close();
$("source-list").innerHTML = SOURCES.map(
  (s) =>
    `<article class="source-item"><h3>${s.title}<span class="tag">${s.kind.toUpperCase()}</span></h3><p>${s.description}</p><a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.target} ↗</a><p class="tiny">${s.status} · version/date ${s.version} · native ${s.resolution_m ?? "vector / observation"} ${s.resolution_m ? "m" : ""}<br>${s.crs}<br>${s.attribution}</p></article>`,
).join("");
$("model-details").innerHTML =
  `<code>Speed: ${MODEL.speed} m/min before slope and roughness penalties.\nEnergy = distance × ${MODEL.energyPerMeter} × (1 + slope/35 + roughness×0.3) + uphill meters × ${MODEL.uphillEnergy}\nTerrain cost = distance × (1 + slope weight × (slope/30)² + roughness weight × roughness) + uphill meters × uphill weight\nObjective weights (slope / roughness / uphill): ${Object.entries(
    MODEL.objectives,
  )
    .map(([k, v]) => `${k}: ${v.slope}/${v.roughness}/${v.uphill}`)
    .join(
      "; ",
    )}\nTerrain score = 100 − distance-weighted mean(slope/30×0.7 + roughness×0.3) × 100.\nScience = target values (diminishing within a category) + 5 per extra category. Scores are heuristic, not measured.</code>`;
$("reset").onclick = () => {
  stop();
  config = { ...DEFAULTS };
  home = start = cellIndex(grid, HOME);
  ids = TARGETS.map((t) => t.id);
  closed.clear();
  consumed = { energy: 0, minutes: 0 };
  energyLoss = 0;
  completed = [];
  offset = 0;
  notice = "";
  before = null;
  for (const [key, value] of Object.entries(config)) $(key).value = value;
  $("opacity").value = 40;
  Object.assign(layers, {
    minerals: false,
    surface: true,
    elevation: false,
    slope: false,
    hazard: true,
    geology: false,
    traverse: false,
    science: true,
    envelope: true,
  });
  for (const input of document.querySelectorAll("[data-layer]"))
    input.checked = layers[input.dataset.layer];
  $("point-info").hidden = true;
  $("clear-closures").hidden = true;
  mode = "inspect";
  $("move-home").classList.remove("active");
  $("close-area").classList.remove("active");
  map.fit();
  scene?.fit();
  setView("map");
  updateOutputs();
  calculate();
  toast("Demo reset to the initial mission.");
};
$("briefing").onclick = () => {
  const p = current(),
    payload = {
      product: "ARES Path",
      dataStatus:
        "Measured Jezero terrain/imagery and historical observations; derived routing and assumed EVA resources",
      coordinateSystem: STUDY.crs,
      center: STUDY.center,
      processing: STUDY.processing,
      config,
      model: MODEL,
      habitat: grid.cells[home],
      astronaut: grid.cells[p.index],
      consumed: { energy: p.energy, minutes: p.minutes },
      energyLoss,
      completed: p.visited,
      remainingTargets: ids.map((id) => {
        const { images, ...t } = TARGETS.find((t) => t.id === id);
        return { ...t, images: images.map(({ dataUri, ...img }) => img) };
      }),
      route: {
        objective: route.objective,
        feasible: route.feasible,
        reasons: route.reasons,
        metrics: route.metrics
          ? { ...route.metrics, profile: undefined }
          : null,
        coordinates: route.path?.map((i) => ({
          x: grid.cells[i].x,
          z: grid.cells[i].z,
          height: grid.cells[i].height,
          ...coordinates(grid.cells[i]),
        })),
      },
      sources: SOURCES,
      limitations:
        "Measured terrain; unresolved hazards and heuristic energy/safety/science models. Not operational navigation or NASA validated.",
    };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "ares-mission-briefing.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const medaTemps = STUDY.meda.map((r) => +r.air_temp_k_mean),
  tmin = Math.floor(Math.min(...medaTemps)) - 1,
  tmax = Math.ceil(Math.max(...medaTemps)) + 1;
const medaChart = `<svg viewBox="0 0 280 110" role="img" aria-label="MEDA mean air temperature by sol, Kelvin"><path d="M32 12V82H265" fill="none" stroke="#81957b"/><text x="0" y="17" fill="#aabb9a" font-size="9">${tmax} K</text><text x="0" y="82" fill="#aabb9a" font-size="9">${tmin} K</text><polyline points="${medaTemps.map((v, i) => `${35 + i * 37},${78 - ((v - tmin) / (tmax - tmin)) * 62}`).join(" ")}" stroke="#b8d8a2" stroke-width="2" fill="none"/>${STUDY.meda.map((r, i) => `<text x="${35 + i * 37}" y="100" text-anchor="middle" font-size="9" fill="#aabb9a">${r.sol}</text>`).join("")}</svg>`;
$("meda-summary").innerHTML =
  `<p class="tiny">MEDA sols 307–313, earlier than these rover stops. Historical rover observations, not local forecasts. Plausibility filtering; instrument quality flags are not applied.</p>${medaChart}<p class="tiny">Mean air temperature (K) / Mars sol · source NASA PDS MEDA TIRS</p><table><thead><tr><th>Sol</th><th>Air K</th><th>Ground K</th><th>Pa</th><th>Wind m/s</th></tr></thead><tbody>${STUDY.meda.map((r) => `<tr><td>${r.sol}</td><td>${(+r.air_temp_k_mean).toFixed(1)}</td><td>${(+r.ground_temp_k_mean).toFixed(1)}</td><td>${(+r.pressure_pa_mean).toFixed(1)}</td><td>${(+r.horizontal_wind_m_s_mean).toFixed(1)}</td></tr>`).join("")}</tbody></table>`;
new ResizeObserver(() =>
  drawProfile($("profile"), route, offset, grid),
).observe($("profile"));
window.addEventListener("blur", stop);
for (const dialog of [$("sources"), $("target-detail")])
  dialog.addEventListener("close", () => stop());
updateOutputs();
calculate();
