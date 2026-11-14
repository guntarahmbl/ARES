import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import { RoutingEngine, RoutingError } from '../src/routing.js';
import worker from '../src/index.js';
import { validateMission } from '../src/validation.js';

const directory = new URL('../../data/processed/cloudflare/', import.meta.url);
const prepared = existsSync(new URL('references.json', directory));
let engine, references;
if (prepared) {
  const metadata = JSON.parse(readFileSync(new URL('metadata.json', directory)));
  const buffer = readFileSync(new URL('grid.bin', directory));
  engine = new RoutingEngine(metadata, buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  references = JSON.parse(readFileSync(new URL('references.json', directory)));
}

for (const scenario of ['default', 'custom', 'low_energy']) {
  test(`${scenario}: same route metrics, feasibility and stop order as Python`, { skip: !prepared }, () => {
    const { mission, plan: expected } = references[scenario];
    const actual = engine.plan(validateMission(mission));
    assert.equal(actual.feasible, expected.feasible);
    assert.deepEqual(actual.warnings, expected.warnings);
    for (const name of ['primary', 'alternative']) {
      assert.deepEqual(actual[name].metrics, expected[name].metrics);
      assert.deepEqual(actual[name].stop_visits, expected[name].stop_visits);
      assert.equal(actual[name].coordinates.length, expected[name].coordinates.length);
      for (let i = 0; i < actual[name].coordinates.length; i++) {
        for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(actual[name].coordinates[i][axis] - expected[name].coordinates[i][axis]) < 1e-9);
      }
    }
    assert.deepEqual(actual.return_envelope.features.map((f) => f.properties), expected.return_envelope.features.map((f) => f.properties));
    const vertices = (feature) => feature.geometry.coordinates.map((ring) => ring.map((point) => point.map((axis) => axis.toFixed(9)).join(',')).sort());
    assert.deepEqual(actual.return_envelope.features.map(vertices), expected.return_envelope.features.map(vertices));
  });
}

test('waypoint terrain and science values match Python', { skip: !prepared }, () => {
  assert.deepEqual(engine.validateWaypoint(77.439073689, 18.464058093), references.validation);
  assert.equal(engine.validateWaypoint(0, 0).valid, false);
});

test('emergency return matches Python and rejects positions outside the data', { skip: !prepared }, () => {
  const actual = engine.emergencyRoute(references.default.mission, { longitude: 77.439073689, latitude: 18.464058093 });
  assert.deepEqual(actual.metrics, references.return.metrics);
  assert.throws(() => engine.emergencyRoute(references.default.mission, { longitude: 0, latitude: 0 }), RoutingError);
});

test('invalid habitat and unknown science targets fail safely', { skip: !prepared }, () => {
  const mission = references.default.mission;
  assert.equal(engine.plan({ ...mission, habitat: { longitude: 77.36, latitude: 18.48 } }).feasible, false);
  const result = engine.plan({ ...mission, route_stops: [{ type: 'science', id: 'unknown' }] });
  assert.equal(result.primary, null);
  assert.match(result.warnings[0], /Unknown science target/);
});

test('mission input rejects invalid data before loading the engine', () => {
  const base = { habitat: { longitude: 77, latitude: 18 }, route_stops: [{ type: 'science', id: 'WP-01' }], max_duration_min: 720, energy_budget: 45000, preferred_max_slope_deg: 18, return_reserve_pct: 20 };
  assert.deepEqual(validateMission(base), base);
  for (const invalid of [null, {}, { ...base, energy_budget: -1 }, { ...base, preferred_max_slope_deg: 31 }, { ...base, route_stops: Array(13).fill(base.route_stops[0]) }, { ...base, habitat: { longitude: NaN, latitude: 18 } }, { ...base, route_stops: [...base.route_stops, ...base.route_stops] }]) assert.throws(() => validateMission(invalid));
});

test('server routing is disabled and unknown API paths do not access R2', async () => {
  const env = {}, ctx = {};
  for (const [path, body, status] of [
    ['/api/v1/routes/plan', '{}', 409],
    ['/api/v1/waypoints/validate', '{}', 409],
    ['/api/v1/routes/return', '{}', 409],
    ['/api/v1/scenarios/energy-loss', '{}', 409],
    ['/api/v1/unknown', '{}', 404],
  ]) {
    const response = await worker.fetch(new Request(`https://example.test${path}`, { method: 'POST', body }), env, ctx);
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).detail, 'string');
  }
});

test('routing files are mapped to explicit public R2 keys', async () => {
  const prior = globalThis.caches;
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  const env = { DATA_PREFIX: 'test/', DATA: { get: async (key) => {
    assert.equal(key, 'test/grid.bin.gz');
    return { body: new Uint8Array([1, 2]), size: 2, httpEtag: '"grid"', writeHttpMetadata: (headers) => headers.set('Content-Type', 'application/gzip') };
  } } };
  try {
    assert.equal((await worker.fetch(new Request('https://example.test/assets/routing/grid.bin.gz'), env, { waitUntil() {} })).status, 200);
    assert.equal((await worker.fetch(new Request('https://example.test/assets/routing/references.json'), env, {})).status, 404);
  } finally { globalThis.caches = prior; }
});

test('R2 assets return 200 for full files and 206 only for byte ranges', async () => {
  const prior = globalThis.caches;
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  const env = { DATA_PREFIX: 'test/', DATA: { get: async (key, options) => {
    assert.equal(key, 'test/assets/3d/terrain/test.bin');
    return { body: new Uint8Array(options?.range ? [1, 2] : [1, 2, 3, 4]), size: 4, range: options?.range ? { offset: 0, length: 2 } : undefined, httpEtag: '"test"', writeHttpMetadata: (headers) => headers.set('Content-Type', 'application/octet-stream') };
  } } };
  try {
    const full = await worker.fetch(new Request('https://example.test/assets/3d/terrain/test.bin'), env, { waitUntil() {} });
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('Content-Length'), '4');
    const partial = await worker.fetch(new Request('https://example.test/assets/3d/terrain/test.bin', { headers: { Range: 'bytes=0-1' } }), env, {});
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('Content-Range'), 'bytes 0-1/4');
  } finally { globalThis.caches = prior; }
});
