import test from "node:test";
import assert from "node:assert/strict";
import {
  STUDY,
  coordinates,
  DEFAULTS,
  HOME,
  MODEL,
  TARGETS,
  makeGrid,
  cellIndex,
  validateConfig,
} from "../src/data.js";
import {
  search,
  pathTo,
  makeRoute,
  planMission,
  adaptMission,
  returnField,
  emergencyRoute,
  safetyEnvelope,
  simulationAt,
  routeMetrics,
  traversable,
} from "../src/planner.js";
const fixture = () => ({
  size: 5,
  cellSize: 5,
  origin: 0,
  cells: Array.from({ length: 25 }, (_, i) => ({
    i,
    x: (i % 5) * 5,
    z: Math.floor(i / 5) * 5,
    height: 0,
    slope: 0,
    roughness: 0,
    nodata: false,
    blocked: false,
  })),
});
const grid = makeGrid(),
  home = cellIndex(grid, HOME),
  config = { ...DEFAULTS };
test("default mission visits three targets, closes the loop and yields distinct alternatives", () => {
  const p = planMission(grid, home, home, ["A", "B", "C"], config);
  assert.equal(p.primary.feasible, true);
  assert.equal(p.primary.path[0], home);
  assert.equal(p.primary.path.at(-1), home);
  for (const t of TARGETS)
    assert.ok(p.primary.path.includes(cellIndex(grid, t)));
  assert.notDeepEqual(p.primary.path, p.alternative.path);
  assert.ok(p.primary.reservePercent >= config.reserve);
  assert.ok(p.primary.metrics.maxSlope <= config.maxSlope);
  for (const i of p.primary.path) assert.ok(traversable(grid, i, config));
});
test("nodata, closures, slope limits, and diagonal corners are hard exclusions", () => {
  const g = fixture();
  g.cells[1].nodata = true;
  g.cells[5].blocked = true;
  assert.equal(pathTo(search(g, 0, config, { goal: 6 }), 0, 6), null);
  g.cells[1].nodata = false;
  g.cells[5].blocked = false;
  for (let i = 10; i < 15; i++) g.cells[i].slope = 31;
  assert.equal(pathTo(search(g, 0, config, { goal: 24 }), 0, 24), null);
  g.cells.forEach((c) => (c.slope = 0));
  assert.equal(
    pathTo(
      search(g, 0, config, { goal: 24, closed: new Set([10, 11, 12, 13, 14]) }),
      0,
      24,
    ),
    null,
  );
});
test("an unreachable mission never invents a direct fallback line", () => {
  const g = fixture();
  g.cells[24].nodata = true;
  const route = makeRoute(g, 24, 0, [], config);
  assert.equal(route.feasible, false);
  assert.equal(route.path, null);
  assert.match(route.reasons[0], /No traversable path/);
});
test("energy and duration enforce reserve independently", () => {
  const p = makeRoute(grid, home, home, ["A", "B", "C"], {
    ...config,
    energy: 20,
  });
  assert.equal(p.feasible, false);
  assert.match(p.reasons.join(), /Energy/);
  const q = makeRoute(grid, home, home, ["A", "B", "C"], {
    ...config,
    duration: 30,
  });
  assert.equal(q.feasible, false);
  assert.match(q.reasons.join(), /Duration/);
  assert.equal(
    makeRoute(grid, home, home, ["A", "B", "C"], {
      ...config,
      energy: 300,
      duration: 480,
    }).feasible,
    true,
  );
});
test("energy loss drops low-priority targets and restores a feasible return", () => {
  const original = makeRoute(grid, home, home, ["A", "B", "C"], config);
  assert.equal(original.feasible, true);
  assert.equal(
    makeRoute(grid, home, home, ["A", "B", "C"], config, {
      energyLoss: config.energy * 0.2,
    }).feasible,
    false,
  );
  const revised = adaptMission(grid, home, home, ["A", "B", "C"], config, {
    energyLoss: config.energy * 0.2,
  });
  assert.equal(revised.route.feasible, true);
  assert.equal(revised.dropped[0], "C");
  assert.ok(revised.ids.includes("A"));
  assert.ok(revised.route.reservePercent >= config.reserve);
});
test("reverse return field preserves directional uphill energy", () => {
  const g = fixture();
  g.cells.forEach((c) => (c.height = c.x * 0.3 + c.z * 0.1));
  const f = returnField(g, 0, config, new Set());
  for (const start of [1, 7, 12, 24]) {
    const direct = makeRoute(g, 0, start, [], config, { objective: "energy" });
    assert.ok(Math.abs(f.energy[start] - direct.metrics.energy) < 1e-9);
    const emergency = emergencyRoute(
      g,
      f,
      start,
      0,
      config,
      { energy: 0, minutes: 0 },
      0,
    );
    assert.equal(emergency.path[0], start);
    assert.equal(emergency.path.at(-1), 0);
    assert.ok(Math.abs(emergency.metrics.energy - f.energy[start]) < 1e-9);
  }
});
test("envelope shrinks after resource loss and masks unreachable cells", () => {
  const f = returnField(grid, home, config, new Set());
  const initial = safetyEnvelope(grid, f, home, config),
    reduced = safetyEnvelope(grid, f, home, config, {
      energyLoss: config.energy * 0.65,
    });
  assert.ok(
    initial.filter((v) => v >= 2).length > reduced.filter((v) => v >= 2).length,
  );
  for (const c of grid.cells)
    if (c.nodata || c.blocked) assert.equal(initial[c.i], 0);
  assert.equal(reduced[home], 3);
  const exhausted = safetyEnvelope(grid, f, home, config, {
    energyLoss: config.energy * 0.9,
  });
  assert.equal(exhausted[home], 1);
});
test("simulation counts observation times exactly once and matches final route costs", () => {
  const r = makeRoute(grid, home, home, ["A", "B", "C"], config),
    end = simulationAt(grid, r, r.path.length - 1);
  assert.equal(end.index, home);
  assert.deepEqual(end.visited, ["A", "B", "C"]);
  assert.ok(Math.abs(end.energy - r.metrics.energy) < 1e-9);
  assert.ok(Math.abs(end.minutes - r.metrics.minutes) < 1e-9);
  const arrival = r.arrivals[0],
    at = simulationAt(grid, r, arrival.offset),
    before = simulationAt(grid, r, arrival.offset - 1);
  assert.ok(at.minutes - before.minutes >= 12);
  assert.deepEqual(at.visited, ["A"]);
  const revised = makeRoute(grid, home, at.index, ["B", "C"], config, {
    consumed: at,
    energyLoss: 0,
  });
  assert.ok(revised.metrics.minutes < r.metrics.minutes);
  assert.ok(revised.metrics.energy < r.metrics.energy);
});
test("science rewards diversity with diminishing value within categories", () => {
  const g = fixture(),
    path = [0, 1],
    same = routeMetrics(g, path, [
      { category: "A", value: 20, minutes: 2 },
      { category: "A", value: 20, minutes: 2 },
    ]),
    diverse = routeMetrics(g, path, [
      { category: "A", value: 20, minutes: 2 },
      { category: "B", value: 20, minutes: 2 },
    ]);
  assert.ok(diverse.science > same.science);
  assert.equal(same.observations, 4);
});
test("invalid constraints and unknown targets fail explicitly", () => {
  for (const value of [NaN, Infinity, -1, 0])
    assert.ok(validateConfig({ ...config, energy: value }));
  assert.equal(makeRoute(grid, home, home, ["unknown"], config).path, null);
  assert.equal(
    makeRoute(grid, home, home, [], { ...config, reserve: 99 }).path,
    null,
  );
});
test("manual closure changes routing without crossing closed cells", () => {
  const r = makeRoute(grid, home, home, ["A"], config),
    closed = new Set([r.path[10]]),
    q = makeRoute(grid, home, home, ["A"], config, { closed });
  assert.ok(q.path);
  assert.notDeepEqual(r.path, q.path);
  assert.ok(!q.path.some((i) => closed.has(i)));
});

test("measured study adapter preserves elevation, spectral pixels and georeferencing", () => {
  assert.equal(grid.kind, "measured");
  assert.equal(grid.cells.length, 6561);
  assert.ok(
    grid.cells.every((c) => c.height < -2500 && !c.nodata && !c.blocked),
  );
  const center = grid.cells[cellIndex(grid, { x: 0, z: 0 })];
  assert.equal(center.height, STUDY.elevation[center.i]);
  assert.equal(center.minerals.d2300, STUDY.crism.d2300[center.i]);
  assert.equal(coordinates(center).longitude, STUDY.center.longitude);
  assert.equal(coordinates(center).latitude, STUDY.center.latitude);
  assert.ok(
    Math.max(...grid.cells.map((c) => Math.abs(c.height - grid.datum))) < 40,
  );
  assert.equal(STUDY.meda.length, 7);
  for (const target of TARGETS) {
    assert.equal(target.images.length, 4);
    assert.ok(
      target.images.every(
        (i) =>
          i.site === target.site &&
          i.drive === target.drive &&
          i.distanceToWaypointMeters <= 5,
      ),
    );
  }
});
