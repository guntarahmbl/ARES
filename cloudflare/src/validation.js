export class ValidationError extends Error {}
export const requireValue = (condition, detail) => { if (!condition) throw new ValidationError(detail); };
export const numeric = (value) => typeof value === 'number' && Number.isFinite(value);
export function coordinate(value) {
  requireValue(value && numeric(value.longitude) && numeric(value.latitude), 'A finite longitude and latitude are required.');
  requireValue(Math.abs(value.longitude) <= 180 && Math.abs(value.latitude) <= 90, 'Coordinates are outside longitude/latitude bounds.');
  return { longitude: value.longitude, latitude: value.latitude };
}

export function validateMission(value) {
  requireValue(value && typeof value === 'object', 'A mission is required.');
  const habitat = coordinate(value.habitat);
  requireValue(Array.isArray(value.route_stops) && value.route_stops.length >= 1 && value.route_stops.length <= 12, 'A mission requires between 1 and 12 stops.');
  const seen = new Set();
  const route_stops = value.route_stops.map((stop) => {
    requireValue(stop && typeof stop.id === 'string' && stop.id.length > 0 && stop.id.length <= 200 && !seen.has(stop.id), 'Route stop IDs must be nonempty and unique.');
    seen.add(stop.id);
    if (stop.type === 'science') return { type: stop.type, id: stop.id };
    requireValue(stop.type === 'custom', 'Unknown route stop type.');
    requireValue(typeof stop.name === 'string' && stop.name.length >= 1 && stop.name.length <= 80, 'Checkpoint names must contain 1–80 characters.');
    const visit = stop.visit_duration_min ?? 5;
    requireValue(numeric(visit) && visit >= 0 && visit <= 240, 'Visit duration must be between 0 and 240 minutes.');
    return { type: stop.type, id: stop.id, name: stop.name, ...coordinate(stop), visit_duration_min: visit };
  });
  for (const [field, max, inclusive] of [['max_duration_min', 1440, false], ['energy_budget', 200000, false], ['preferred_max_slope_deg', 30, false], ['return_reserve_pct', 80, true]]) {
    requireValue(numeric(value[field]) && (inclusive ? value[field] >= 0 : value[field] > 0) && value[field] <= max, `Invalid ${field}.`);
  }
  return { habitat, route_stops, max_duration_min: value.max_duration_min, energy_budget: value.energy_budget, preferred_max_slope_deg: value.preferred_max_slope_deg, return_reserve_pct: value.return_reserve_pct };
}

