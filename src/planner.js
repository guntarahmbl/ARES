import { MODEL, TARGETS, cellIndex, validateConfig } from "./data.js";

class MinHeap {
  items = [];
  push(item) {
    let i = this.items.length;
    this.items.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p].cost <= item.cost) break;
      this.items[i] = this.items[p];
      i = p;
    }
    this.items[i] = item;
  }
  pop() {
    const first = this.items[0],
      last = this.items.pop();
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let c = i * 2 + 1;
        if (
          c + 1 < this.items.length &&
          this.items[c + 1].cost < this.items[c].cost
        )
          c++;
        if (this.items[c].cost >= last.cost) break;
        this.items[i] = this.items[c];
        i = c;
      }
      this.items[i] = last;
    }
    return first;
  }
}
export function traversable(grid, i, config, closed = new Set()) {
  const c = grid.cells[i];
  return (
    !!c &&
    !c.nodata &&
    !c.blocked &&
    !closed.has(i) &&
    c.slope <= Math.min(config.maxSlope, MODEL.hardSlope)
  );
}
export function neighbors(grid, i, config, closed) {
  const result = [],
    x = i % grid.size,
    z = Math.floor(i / grid.size);
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      if (
        (!dx && !dz) ||
        x + dx < 0 ||
        z + dz < 0 ||
        x + dx >= grid.size ||
        z + dz >= grid.size
      )
        continue;
      const j = i + dz * grid.size + dx;
      if (!traversable(grid, j, config, closed)) continue;
      // Diagonals cannot cut across an excluded cell's corner.
      if (
        dx &&
        dz &&
        (!traversable(grid, i + dx, config, closed) ||
          !traversable(grid, i + dz * grid.size, config, closed))
      )
        continue;
      result.push(j);
    }
  return result;
}
export function edge(grid, a, b) {
  const from = grid.cells[a],
    to = grid.cells[b];
  return stepCost(from, to);
}
export function stepCost(from, to) {
  const horizontal = Math.hypot(from.x - to.x, from.z - to.z),
    dh = to.height - from.height;
  const distance = Math.hypot(horizontal, dh),
    slope = Math.max(from.slope, to.slope),
    roughness = (from.roughness + to.roughness) / 2;
  return {
    distance,
    dh,
    slope,
    roughness,
    energy:
      distance * MODEL.energyPerMeter * (1 + slope / 35 + roughness * 0.3) +
      Math.max(0, dh) * MODEL.uphillEnergy,
    minutes: (distance / MODEL.speed) * (1 + slope / 40 + roughness * 0.2),
  };
}
function edgeCost(e, objective) {
  if (objective === "energy") return e.energy;
  const w = MODEL.objectives[objective];
  return (
    e.distance *
      (1 + w.slope * (e.slope / 30) ** 2 + w.roughness * e.roughness) +
    Math.max(0, e.dh) * w.uphill
  );
}
export function search(
  grid,
  start,
  config,
  {
    goal = -1,
    closed = new Set(),
    objective = config.objective,
    reverse = false,
  } = {},
) {
  const n = grid.cells.length,
    cost = new Float64Array(n).fill(Infinity),
    energy = new Float64Array(n).fill(Infinity),
    minutes = new Float64Array(n).fill(Infinity),
    previous = new Int32Array(n).fill(-1);
  if (!traversable(grid, start, config, closed))
    return { cost, energy, minutes, previous };
  const heap = new MinHeap();
  cost[start] = energy[start] = minutes[start] = 0;
  heap.push({ i: start, cost: 0 });
  while (heap.items.length) {
    const current = heap.pop(),
      i = current.i;
    if (current.cost !== cost[i]) continue;
    if (i === goal) break;
    for (const j of neighbors(grid, i, config, closed)) {
      const e = reverse ? edge(grid, j, i) : edge(grid, i, j),
        next = cost[i] + edgeCost(e, objective);
      if (next >= cost[j]) continue;
      cost[j] = next;
      previous[j] = i;
      energy[j] = energy[i] + e.energy;
      minutes[j] = minutes[i] + e.minutes;
      heap.push({ i: j, cost: next });
    }
  }
  return { cost, energy, minutes, previous };
}
export function pathTo(field, start, end) {
  if (!Number.isFinite(field.cost[end])) return null;
  const path = [end];
  let i = end;
  while (i !== start) {
    i = field.previous[i];
    if (i < 0 || path.length > field.previous.length) return null;
    path.push(i);
  }
  return path.reverse();
}
export function routeMetrics(grid, path, targets = []) {
  let distance = 0,
    energy = 0,
    minutes = 0,
    gain = 0,
    loss = 0,
    maxSlope = 0,
    risk = 0;
  const profile = [
    {
      distance: 0,
      height: grid.cells[path[0]].height,
      index: path[0],
      energy: 0,
      minutes: 0,
    },
  ];
  for (let i = 1; i < path.length; i++) {
    const e = edge(grid, path[i - 1], path[i]);
    distance += e.distance;
    energy += e.energy;
    minutes += e.minutes;
    gain += Math.max(0, e.dh);
    loss += Math.max(0, -e.dh);
    maxSlope = Math.max(maxSlope, e.slope);
    risk += e.distance * ((e.slope / 30) * 0.7 + e.roughness * 0.3);
    profile.push({
      distance,
      height: grid.cells[path[i]].height,
      index: path[i],
      energy,
      minutes,
    });
  }
  const observations = targets.reduce((sum, t) => sum + t.minutes, 0),
    categories = new Map();
  let science = 0;
  for (const t of targets) {
    const count = categories.get(t.category) || 0;
    science += t.value / (1 + count);
    categories.set(t.category, count + 1);
  }
  science = Math.min(100, science + Math.max(0, categories.size - 1) * 5);
  return {
    distance,
    energy,
    minutes: minutes + observations,
    travelMinutes: minutes,
    observations,
    gain,
    loss,
    maxSlope,
    safety: Math.max(0, Math.round(100 - (100 * risk) / (distance || 1))),
    science: Math.round(science),
    profile,
  };
}
export function feasibility(
  metrics,
  config,
  consumed = { energy: 0, minutes: 0 },
  energyLoss = 0,
) {
  const availableEnergy =
    config.energy * (1 - config.reserve / 100) - consumed.energy - energyLoss;
  const availableMinutes =
    config.duration * (1 - config.reserve / 100) - consumed.minutes;
  const reasons = [];
  if (metrics.energy > availableEnergy + 1e-8)
    reasons.push(
      `Energy exceeds the usable budget by ${(metrics.energy - availableEnergy).toFixed(1)} units. Reduce targets or increase energy.`,
    );
  if (metrics.minutes > availableMinutes + 1e-8)
    reasons.push(
      `Duration exceeds the usable window by ${(metrics.minutes - availableMinutes).toFixed(1)} min. Reduce targets or extend the EVA.`,
    );
  return {
    feasible: reasons.length === 0,
    reasons,
    energyMargin: availableEnergy - metrics.energy,
    timeMargin: availableMinutes - metrics.minutes,
    reservePercent:
      (100 * (config.energy - consumed.energy - energyLoss - metrics.energy)) /
      config.energy,
  };
}
export function makeRoute(
  grid,
  home,
  start,
  ids,
  config,
  {
    closed = new Set(),
    consumed = { energy: 0, minutes: 0 },
    energyLoss = 0,
    objective = config.objective,
  } = {},
) {
  const error = validateConfig(config);
  if (error)
    return { feasible: false, reasons: [error], path: null, ids, objective };
  const targets = ids.map((id) => TARGETS.find((t) => t.id === id));
  if (targets.some((t) => !t))
    return {
      feasible: false,
      reasons: ["Unknown science target."],
      path: null,
      ids,
      objective,
    };
  const stops = [...targets.map((t) => cellIndex(grid, t)), home],
    path = [start],
    arrivals = [];
  let current = start;
  for (let s = 0; s < stops.length; s++) {
    const field = search(grid, current, config, {
        goal: stops[s],
        closed,
        objective,
      }),
      leg = pathTo(field, current, stops[s]);
    if (!leg)
      return {
        feasible: false,
        reasons: [
          `No traversable path to ${s < targets.length ? `target ${targets[s].id}` : "habitat"}. Check slope, exclusions, or habitat placement.`,
        ],
        path: null,
        ids,
        objective,
      };
    path.push(...leg.slice(1));
    if (s < targets.length)
      arrivals.push({
        id: targets[s].id,
        offset: path.length - 1,
        minutes: targets[s].minutes,
      });
    current = stops[s];
  }
  const metrics = routeMetrics(grid, path, targets),
    status = feasibility(metrics, config, consumed, energyLoss);
  return { ...status, metrics, path, arrivals, ids: [...ids], objective };
}
export function planMission(grid, home, start, ids, config, options = {}) {
  const primary = makeRoute(grid, home, start, ids, config, options);
  const other = config.objective === "shortest" ? "safest" : "shortest";
  let alternative = makeRoute(grid, home, start, ids, config, {
    ...options,
    objective: other,
  });
  if (
    primary.path &&
    alternative.path &&
    primary.path.join(",") === alternative.path.join(",") &&
    ids.length
  ) {
    const lowest = [...ids].sort(
      (a, b) =>
        TARGETS.find((t) => t.id === a).priority -
        TARGETS.find((t) => t.id === b).priority,
    )[0];
    alternative = makeRoute(
      grid,
      home,
      start,
      ids.filter((id) => id !== lowest),
      config,
      { ...options, objective: other },
    );
    alternative.note = `Omits lower-priority target ${lowest} to offer a different science/resource trade-off.`;
  }
  return { primary, alternative };
}
export function adaptMission(grid, home, start, ids, config, options = {}) {
  let kept = [...ids],
    dropped = [];
  while (true) {
    const result = makeRoute(grid, home, start, kept, config, options);
    if (result.feasible || !kept.length)
      return { route: result, dropped, ids: kept };
    const lowest = [...kept].sort(
      (a, b) =>
        TARGETS.find((t) => t.id === a).priority -
        TARGETS.find((t) => t.id === b).priority,
    )[0];
    kept = kept.filter((id) => id !== lowest);
    dropped.push(lowest);
  }
}
export function returnField(grid, home, config, closed) {
  // Reverse directed edges preserve uphill energy on the journey home.
  return search(grid, home, config, {
    closed,
    objective: "energy",
    reverse: true,
  });
}
export function emergencyRoute(
  grid,
  field,
  start,
  home,
  config,
  consumed,
  energyLoss,
) {
  const path = pathTo(field, home, start)?.reverse();
  if (!path)
    return {
      feasible: false,
      path: null,
      reasons: [
        "No emergency path to habitat. Undo the closure or change the slope constraint.",
      ],
    };
  const metrics = routeMetrics(grid, path);
  return {
    ...feasibility(metrics, config, consumed, energyLoss),
    metrics,
    path,
    arrivals: [],
    ids: [],
    objective: "energy",
  };
}
export function safetyEnvelope(
  grid,
  homeField,
  start,
  config,
  {
    closed = new Set(),
    consumed = { energy: 0, minutes: 0 },
    energyLoss = 0,
  } = {},
) {
  const outward = search(grid, start, config, { closed, objective: "energy" }),
    states = new Uint8Array(grid.cells.length);
  const energyBudget = config.energy - consumed.energy - energyLoss,
    timeBudget = config.duration - consumed.minutes;
  for (let i = 0; i < states.length; i++) {
    const energy = outward.energy[i] + homeField.energy[i],
      minutes = outward.minutes[i] + homeField.minutes[i];
    if (!Number.isFinite(energy)) {
      states[i] = 0;
      continue;
    }
    const energyMargin = (energyBudget - energy) / config.energy,
      timeMargin = (timeBudget - minutes) / config.duration,
      margin = Math.min(energyMargin, timeMargin);
    states[i] =
      margin < config.reserve / 100
        ? 1
        : margin < config.reserve / 100 + 0.1
          ? 2
          : 3;
  }
  return states;
}
export function simulationAt(grid, route, offset) {
  const index = Math.max(
      0,
      Math.min(Math.floor(offset), route.path.length - 1),
    ),
    profile = route.metrics.profile[index];
  const visited = route.arrivals.filter((a) => a.offset <= index),
    observationMinutes = visited.reduce((sum, a) => sum + a.minutes, 0);
  return {
    index: route.path[index],
    offset: index,
    energy: profile.energy,
    minutes: profile.minutes + observationMinutes,
    visited: visited.map((a) => a.id),
    distance: profile.distance,
  };
}
