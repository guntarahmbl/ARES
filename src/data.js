import study from "../data/prepared/study.json" with { type: "json" };
export const MODEL = Object.freeze({
  cellSize: 5,
  size: 81,
  origin: -200,
  speed: 32,
  energyPerMeter: 0.065,
  uphillEnergy: 0.45,
  hardSlope: 30,
  objectives: {
    balanced: { slope: 2, roughness: 0.8, uphill: 2 },
    safest: { slope: 12, roughness: 4, uphill: 5 },
    shortest: { slope: 0, roughness: 0, uphill: 0 },
  },
});
export const DEFAULTS = Object.freeze({
  duration: 100,
  energy: 60,
  maxSlope: 25,
  reserve: 20,
  objective: "balanced",
});
export const HOME = Object.freeze({ x: 0, z: 120 });
export const STUDY = study;
export const SOURCES = study.sources.map((s) => ({
  ...s,
  kind: s.classification,
  url: s.catalog_url,
  target: s.product_id,
  description: s.processing + " " + s.limitations,
}));
export const TARGETS = study.targets;
export function coordinates(p) {
  const degrees = 180 / (Math.PI * 3396190);
  return {
    longitude: study.center.longitude + p.x * degrees,
    latitude: study.center.latitude - p.z * degrees,
  };
}
export function makeGrid() {
  const cells = study.elevation.map((height, i) => ({
    i,
    x: study.origin + (i % study.size) * study.cellSize,
    z: study.origin + Math.floor(i / study.size) * study.cellSize,
    height,
    slope: study.slope[i],
    roughness: study.roughness[i],
    surfaceGray: study.surfaceGray[i],
    geology: study.geologyIndex[i],
    minerals: Object.fromEntries(
      Object.entries(study.crism).map(([k, v]) => [k, v[i]]),
    ),
    nodata: !study.valid[i],
    blocked: false,
  }));
  return {
    size: study.size,
    cellSize: study.cellSize,
    origin: study.origin,
    cells,
    kind: study.kind,
    datum: study.renderDatumMeters,
  };
}
export function cellIndex(grid, p) {
  const x = Math.round((p.x - grid.origin) / grid.cellSize),
    z = Math.round((p.z - grid.origin) / grid.cellSize);
  return x < 0 || z < 0 || x >= grid.size || z >= grid.size
    ? -1
    : z * grid.size + x;
}
export function validateConfig(config) {
  for (const [key, min, max] of [
    ["duration", 1, 480],
    ["energy", 1, 300],
    ["maxSlope", 1, 30],
    ["reserve", 0, 80],
  ]) {
    if (!Number.isFinite(config[key]) || config[key] < min || config[key] > max)
      return `${key} must be between ${min} and ${max}.`;
  }
  if (!MODEL.objectives[config.objective]) return "Unknown route objective.";
  return null;
}
