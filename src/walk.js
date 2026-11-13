import { TARGETS, cellIndex } from "./data.js";
import { stepCost, traversable, feasibility } from "./planner.js";

export const WALK_SPEED = 8; // Presentation speed; modeled time uses MODEL.speed and terrain penalties.
export const OBSERVE_RADIUS = 8;

// Match the two triangles used by TerrainScene for each measured grid square.
export function sampleTerrain(grid, p) {
  const gx = (p.x - grid.origin) / grid.cellSize,
    gz = (p.z - grid.origin) / grid.cellSize;
  if (gx < 0 || gz < 0 || gx > grid.size - 1 || gz > grid.size - 1) return null;
  const x = Math.min(Math.floor(gx), grid.size - 2),
    z = Math.min(Math.floor(gz), grid.size - 2),
    u = gx - x,
    v = gz - z;
  const i = z * grid.size + x,
    nodes = [i, i + 1, i + grid.size, i + grid.size + 1];
  const [a, b, c, d] = nodes.map((k) => grid.cells[k]);
  const height =
    u + v <= 1
      ? a.height + (b.height - a.height) * u + (c.height - a.height) * v
      : d.height +
        (c.height - d.height) * (1 - u) +
        (b.height - d.height) * (1 - v);
  return {
    ...p,
    height,
    slope: Math.max(a.slope, b.slope, c.slope, d.slope),
    roughness: (a.roughness + b.roughness + c.roughness + d.roughness) / 4,
    nodes,
  };
}
export function allowedPoint(grid, p, config, closed) {
  const sample = sampleTerrain(grid, p);
  return sample &&
    sample.nodes.every((i) => traversable(grid, i, config, closed))
    ? sample
    : null;
}
export function connectionCost(grid, from, to) {
  let previous = sampleTerrain(grid, from),
    energy = 0,
    minutes = 0,
    distance = 0,
    gain = 0,
    loss = 0;
  const n = Math.max(
    1,
    Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.25),
  );
  if (!previous)
    return {
      energy: Infinity,
      minutes: Infinity,
      distance: Infinity,
      gain: 0,
      loss: 0,
    };
  for (let i = 1; i <= n; i++) {
    const next = sampleTerrain(grid, {
      x: from.x + ((to.x - from.x) * i) / n,
      z: from.z + ((to.z - from.z) * i) / n,
    });
    if (!next)
      return {
        energy: Infinity,
        minutes: Infinity,
        distance: Infinity,
        gain: 0,
        loss: 0,
      };
    const e = stepCost(previous, next);
    energy += e.energy;
    minutes += e.minutes;
    distance += e.distance;
    gain += Math.max(0, e.dh);
    loss += Math.max(0, -e.dh);
    previous = next;
  }
  return { energy, minutes, distance, gain, loss };
}
export class WalkSession {
  constructor(grid, p, resources, visited = []) {
    this.grid = grid;
    this.pose = { x: p.x, z: p.z };
    this.energy = resources.energy;
    this.minutes = resources.minutes;
    this.visited = [...visited];
    this.distance = 0;
    this.departed = false;
    this.message = "";
  }
  snapshot() {
    return {
      index: cellIndex(this.grid, this.pose),
      pose: { ...this.pose },
      energy: this.energy,
      minutes: this.minutes,
      visited: [...this.visited],
      offset: 0,
    };
  }
  connector() {
    return connectionCost(
      this.grid,
      this.pose,
      this.grid.cells[this.snapshot().index],
    );
  }
  returnStatus(
    config,
    field,
    energyLoss = 0,
    pose = this.pose,
    extra = { energy: 0, minutes: 0 },
  ) {
    const anchor = cellIndex(this.grid, pose),
      connector = connectionCost(
        this.grid,
        pose,
        this.grid.cells[anchor] ?? pose,
      );
    const metrics = {
      energy: connector.energy + (field.energy[anchor] ?? Infinity),
      minutes: connector.minutes + (field.minutes[anchor] ?? Infinity),
    };
    return {
      ...feasibility(
        metrics,
        config,
        {
          energy: this.energy + extra.energy,
          minutes: this.minutes + extra.minutes,
        },
        energyLoss,
      ),
      metrics,
    };
  }
  move(dx, dz, dt, { config, closed, field, energyLoss }) {
    const length = Math.hypot(dx, dz);
    if (!length || dt <= 0) return 0;
    this.message = "";
    const distance = WALK_SPEED * Math.min(dt, 0.1),
      count = Math.ceil(distance / 0.25);
    let moved = 0;
    for (let n = 0; n < count; n++) {
      const next = {
        x: this.pose.x + ((dx / length) * distance) / count,
        z: this.pose.z + ((dz / length) * distance) / count,
      };
      const from = sampleTerrain(this.grid, this.pose),
        to = allowedPoint(this.grid, next, config, closed);
      if (!to) {
        this.message =
          "Terrain blocked: boundary, nodata, exclusion or slope limit.";
        break;
      }
      const e = stepCost(from, to),
        status = this.returnStatus(config, field, energyLoss, next, e);
      if (!status.feasible) {
        this.message =
          "Movement stopped: minimum return reserve would be violated. Replan or adjust resources.";
        break;
      }
      this.pose = next;
      this.energy += e.energy;
      this.minutes += e.minutes;
      this.distance += e.distance;
      moved += e.distance;
      this.departed = true;
    }
    return moved;
  }
  nearby(ids) {
    return TARGETS.find(
      (t) =>
        ids.includes(t.id) &&
        !this.visited.includes(t.id) &&
        Math.hypot(t.x - this.pose.x, t.z - this.pose.z) <= OBSERVE_RADIUS,
    );
  }
  observe(ids, { config, field, energyLoss }) {
    const t = this.nearby(ids);
    if (!t)
      return {
        ok: false,
        message: "Approach a selected unvisited stop within 8 m.",
      };
    if (
      !this.returnStatus(config, field, energyLoss, this.pose, {
        energy: 0,
        minutes: t.minutes,
      }).feasible
    )
      return {
        ok: false,
        message: "Observation would violate the return time or energy reserve.",
      };
    this.minutes += t.minutes;
    this.visited.push(t.id);
    return { ok: true, target: t };
  }
}
