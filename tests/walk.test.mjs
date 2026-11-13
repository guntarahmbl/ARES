import test from "node:test";
import assert from "node:assert/strict";
import { WalkSession, sampleTerrain, connectionCost } from "../src/walk.js";
import { makeGrid, DEFAULTS, TARGETS, cellIndex } from "../src/data.js";
import { returnField } from "../src/planner.js";
const grid = makeGrid(),
  home = cellIndex(grid, { x: 0, z: 120 }),
  field = returnField(grid, home, DEFAULTS, new Set());
const options = { config: DEFAULTS, closed: new Set(), field, energyLoss: 0 };
test("continuous walking accounts actual distance/resources and preserves subcell position", () => {
  const w = new WalkSession(grid, grid.cells[home], { energy: 0, minutes: 0 });
  for (let i = 0; i < 20; i++) w.move(0, -1, 0.05, options);
  assert.ok(Math.abs(w.pose.z - 112) < 1e-8);
  assert.ok(w.energy > 0 && w.minutes > 0);
  assert.ok(w.distance >= 8);
  const before = w.snapshot();
  w.move(0, 0, 0.1, options);
  assert.deepEqual(w.snapshot(), before);
  const c = w.connector();
  assert.ok(c.distance > 0 && c.energy > 0);
});
test("surface interpolation matches mesh triangles and rejects outside coverage", () => {
  const g = {
    size: 2,
    origin: 0,
    cellSize: 5,
    cells: [0, 10, 20, 50].map((height) => ({
      height,
      slope: 0,
      roughness: 0,
    })),
  };
  assert.equal(sampleTerrain(g, { x: 1, z: 1 }).height, 6);
  assert.equal(sampleTerrain(g, { x: 4, z: 4 }).height, 36);
  assert.equal(sampleTerrain(g, { x: -0.01, z: 1 }), null);
});
test("swept motion cannot tunnel across exclusions, nodata, slopes or study bounds", () => {
  const fixture = () => ({
    size: 5,
    origin: 0,
    cellSize: 5,
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
  for (const kind of ["closed", "nodata", "slope", "blocked"]) {
    const g = fixture(),
      closed = new Set();
    if (kind === "closed") closed.add(12);
    else g.cells[12][kind] = kind === "slope" ? 40 : true;
    const f = { energy: new Float64Array(25), minutes: new Float64Array(25) },
      w = new WalkSession(g, { x: 2, z: 10 }, { energy: 0, minutes: 0 });
    for (let i = 0; i < 60; i++)
      w.move(1, 0, 1, { ...options, closed, field: f });
    assert.ok(w.pose.x < 5, kind);
    assert.match(w.message, /Terrain blocked/);
  }
  const w = new WalkSession(
    grid,
    { x: 199.9, z: 0 },
    { energy: 0, minutes: 0 },
  );
  w.move(1, 0, 0.1, options);
  assert.ok(w.pose.x <= 200);
});
test("reserve enforcement stops unsafe travel without consuming rejected steps", () => {
  const w = new WalkSession(grid, grid.cells[home], { energy: 0, minutes: 0 }),
    before = w.snapshot();
  w.move(0, -1, 0.1, { ...options, energyLoss: 59 });
  assert.deepEqual(w.snapshot(), before);
  assert.match(w.message, /reserve/);
});
test("observation is explicit, selected, in range, reserve checked and counted once", () => {
  const t = TARGETS[1],
    w = new WalkSession(grid, t, { energy: 0, minutes: 0 });
  assert.equal(w.observe([], options).ok, false);
  const first = w.observe([t.id], options);
  assert.equal(first.ok, true);
  assert.equal(w.minutes, t.minutes);
  assert.equal(w.observe([t.id], options).ok, false);
  assert.equal(w.minutes, t.minutes);
  const far = new WalkSession(grid, grid.cells[home], {
    energy: 0,
    minutes: 0,
  });
  assert.equal(far.observe([t.id], options).ok, false);
  const late = new WalkSession(grid, t, { energy: 0, minutes: 79 });
  assert.equal(late.observe([t.id], options).ok, false);
});
test("off-grid route connection retains uphill direction and costs", () => {
  const a = { x: 1, z: 118 },
    b = grid.cells[home];
  const forward = connectionCost(grid, a, b),
    back = connectionCost(grid, b, a);
  assert.ok(forward.distance > 0 && back.distance > 0);
  assert.notEqual(forward.energy, back.energy);
});
