const RAD = Math.PI / 180;
const MARS_RADIUS = 3396190;
const round = (value, digits = 1) => Number(value.toFixed(digits));
const emptyCollection = () => ({ type: 'FeatureCollection', features: [] });

export class RoutingError extends Error {}

// Indexed binary heap: one entry per cell, with decrease-key and bounded memory.
class MinHeap {
  constructor(count) {
    this.nodes = new Int32Array(count);
    this.positions = new Int32Array(count);
    this.priorities = new Float64Array(count);
    this.reset();
  }
  reset() {
    this.size = 0;
    this.positions.fill(-1);
  }
  set(node, priority) {
    let index = this.positions[node];
    if (index === -2) return;
    if (index < 0) index = this.size++;
    this.priorities[node] = priority;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const other = this.nodes[parent];
      if (this.priorities[other] <= priority) break;
      this.nodes[index] = other;
      this.positions[other] = index;
      index = parent;
    }
    this.nodes[index] = node;
    this.positions[node] = index;
  }
  pop() {
    const result = this.nodes[0];
    const last = this.nodes[--this.size];
    if (this.size) {
      let index = 0;
      while (index * 2 + 1 < this.size) {
        let child = index * 2 + 1;
        if (child + 1 < this.size && this.priorities[this.nodes[child + 1]] < this.priorities[this.nodes[child]]) child++;
        if (this.priorities[last] <= this.priorities[this.nodes[child]]) break;
        this.nodes[index] = this.nodes[child];
        this.positions[this.nodes[index]] = index;
        index = child;
      }
      this.nodes[index] = last;
      this.positions[last] = index;
    }
    this.positions[result] = -2;
    return result;
  }
}

class Search {
  constructor(count) {
    this.distances = new Float64Array(count);
    this.previous = new Int32Array(count);
    this.heap = new MinHeap(count);
  }
  run(cost, width, height, start, end = null) {
    const distances = this.distances;
    distances.fill(Infinity);
    this.previous.fill(-1);
    this.heap.reset();
    const endRow = end === null ? 0 : Math.floor(end / width);
    const endCol = end === null ? 0 : end % width;
    const heuristic = (row, col) => end === null ? 0 : Math.hypot(row - endRow, col - endCol);
    distances[start] = 0;
    this.heap.set(start, heuristic(Math.floor(start / width), start % width));
    while (this.heap.size) {
      const node = this.heap.pop();
      if (node === end) return;
      const row = Math.floor(node / width), col = node % width;
      for (let dy = -1; dy <= 1; dy++) {
        const nextRow = row + dy;
        if (nextRow < 0 || nextRow >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nextCol = col + dx;
          if ((!dy && !dx) || nextCol < 0 || nextCol >= width) continue;
          const next = nextRow * width + nextCol;
          if (!Number.isFinite(cost[next]) || this.heap.positions[next] === -2) continue;
          // Same geometric edge cost and 8-connectivity as MCP_Geometric.
          const distance = distances[node] + (cost[node] + cost[next]) * 0.5 * (dx && dy ? Math.SQRT2 : 1);
          if (distance < distances[next]) {
            distances[next] = distance;
            this.previous[next] = node;
            this.heap.set(next, distance + heuristic(nextRow, nextCol));
          }
        }
      }
    }
    if (end !== null) throw new RoutingError('No traversable connection exists');
  }
}

function inRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i], [px, py] = ring[j];
    const cross = (point[0] - x) * (py - y) - (point[1] - y) * (px - x);
    if (Math.abs(cross) < 1e-12 && point[0] >= Math.min(x, px) && point[0] <= Math.max(x, px) && point[1] >= Math.min(y, py) && point[1] <= Math.max(y, py)) return true;
    if ((y > point[1]) !== (py > point[1]) && point[0] < (px - x) * (point[1] - y) / (py - y) + x) inside = !inside;
  }
  return inside;
}

// GDAL emits connected components when their last scanline is completed.
// Match the first emitted polygon used by the Python API, including holes.
function polygonRings(mask, width, height) {
  const seen = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  let selected = [], completionRow = Infinity;
  for (let first = 0; first < mask.length; first++) {
    if (!mask[first] || seen[first]) continue;
    if (Math.floor(first / width) > completionRow) break;
    let head = 0, tail = 1, lastRow = 0;
    queue[0] = first;
    seen[first] = 1;
    while (head < tail) {
      const cell = queue[head++], row = Math.floor(cell / width), col = cell % width;
      lastRow = Math.max(lastRow, row);
      for (const next of [row > 0 ? cell - width : -1, col + 1 < width ? cell + 1 : -1, row + 1 < height ? cell + width : -1, col > 0 ? cell - 1 : -1]) {
        if (next >= 0 && mask[next] && !seen[next]) {
          seen[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (lastRow < completionRow) {
      completionRow = lastRow;
      selected = Array.from(queue.subarray(0, tail));
    }
  }
  if (!selected.length) return [];
  const component = new Uint8Array(mask.length);
  for (const cell of selected) component[cell] = 1;
  const edges = new Map(), vertexWidth = width + 1;
  const add = (from, to) => {
    if (!edges.has(from)) edges.set(from, []);
    edges.get(from).push(to);
  };
  for (const cell of selected) {
    const row = Math.floor(cell / width), col = cell % width, v = row * vertexWidth + col;
    if (row === 0 || !component[cell - width]) add(v, v + 1);
    if (col === width - 1 || !component[cell + 1]) add(v + 1, v + vertexWidth + 1);
    if (row === height - 1 || !component[cell + width]) add(v + vertexWidth + 1, v + vertexWidth);
    if (col === 0 || !component[cell - 1]) add(v + vertexWidth, v);
  }
  const rings = [];
  const direction = (from, to) => to === from + 1 ? 0 : to === from + vertexWidth ? 1 : to === from - 1 ? 2 : 3;
  while (edges.size) {
    const start = edges.keys().next().value;
    let current = start, previousDirection = 0;
    const ring = [];
    do {
      ring.push([current % vertexWidth, Math.floor(current / vertexWidth)]);
      const outgoing = edges.get(current);
      // At a shared corner, take the right turn to keep interior on the right.
      outgoing.sort((a, b) => {
        const rank = (to) => [1, 0, 3, 2][(direction(current, to) - previousDirection + 4) % 4];
        return rank(a) - rank(b);
      });
      const next = outgoing.shift();
      if (!outgoing.length) edges.delete(current);
      previousDirection = direction(current, next);
      current = next;
    } while (current !== start);
    ring.push(ring[0]);
    rings.push(ring);
  }
  return rings;
}

export class RoutingEngine {
  constructor(metadata, buffer) {
    this.metadata = metadata;
    this.bootstrap = metadata.bootstrap;
    this.width = metadata.width;
    this.height = metadata.height;
    this.count = this.width * this.height;
    if (buffer.byteLength !== this.count * 25) throw new Error('Routing grid length does not match metadata');
    [this.elevation, this.slope, this.roughness, this.olindex3, this.d2300, this.min2295_2480] = Array.from({ length: 6 }, (_, index) => new Float32Array(buffer, index * this.count * 4, this.count));
    this.valid = new Uint8Array(buffer, this.count * 24, this.count);
    this.cost = new Float32Array(this.count);
    this.search = new Search(this.count);
    this.waypoints = new Map(this.bootstrap.waypoints.features.map((feature) => [feature.properties.id, feature]));
  }
  projected(longitude, latitude) { return [longitude * RAD * MARS_RADIUS, latitude * RAD * MARS_RADIUS]; }
  geographic(x, y) { return [x / MARS_RADIUS / RAD, y / MARS_RADIUS / RAD]; }
  inside(longitude, latitude) {
    const [x, y] = this.projected(longitude, latitude), [left, bottom, right, top] = this.bootstrap.bounds_projected;
    return x >= left && x <= right && y >= bottom && y <= top;
  }
  cell(longitude, latitude) {
    const [x, y] = this.projected(longitude, latitude), [a, , c, , e, f] = this.metadata.transform;
    const row = Math.max(0, Math.min(this.height - 1, Math.floor((y - f) / e)));
    const col = Math.max(0, Math.min(this.width - 1, Math.floor((x - c) / a)));
    return row * this.width + col;
  }
  xy(cell) {
    const [a, , c, , e, f] = this.metadata.transform;
    return [c + (cell % this.width + 0.5) * a, f + (Math.floor(cell / this.width) + 0.5) * e];
  }
  scienceContext(longitude, latitude) {
    const point = [longitude, latitude];
    const unit = this.bootstrap.geology.features.find(({ geometry }) => {
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
      return polygons.some((rings) => inRing(point, rings[0]) && !rings.slice(1).some((ring) => inRing(point, ring)));
    })?.properties ?? {};
    const index = this.cell(longitude, latitude), crism = {};
    for (const key of ['olindex3', 'd2300', 'min2295_2480']) crism[key] = this.inside(longitude, latitude) && Number.isFinite(this[key][index]) ? round(this[key][index], 6) : null;
    return { geology_unit: unit.name || unit.unit || 'Mapped Jezero unit', geology_symbol: unit.symbol || unit.symbol_noSub || '—', crism, classification: 'interpreted' };
  }
  validateWaypoint(longitude, latitude) {
    const coordinate = { longitude, latitude };
    if (!this.inside(longitude, latitude)) return { valid: false, coordinate, terrain: { traversable: false }, science_context: {}, warnings: ['The checkpoint is outside the prepared Jezero area.'] };
    const index = this.cell(longitude, latitude), valid = Boolean(this.valid[index] && this.slope[index] <= 30), warnings = [];
    if (!this.valid[index]) warnings.push('No valid terrain data is available at this location.');
    else if (this.slope[index] > 30) warnings.push('Slope exceeds the 30° hard limit.');
    const context = { ...this.scienceContext(longitude, latitude), mineral_interest: null };
    if (context.crism.olindex3 === null) warnings.push('CRISM coverage is unavailable at this checkpoint.');
    return { valid, coordinate, terrain: { elevation_m: round(this.elevation[index], 2), slope_deg: round(this.slope[index], 2), roughness: round(this.roughness[index], 3), traversable: valid }, science_context: context, warnings };
  }
  costSurface(preferredSlope) {
    for (let i = 0; i < this.count; i++) {
      const ratio = Math.min(2, Math.max(0, Math.fround(this.slope[i] / Math.max(preferredSlope, 1))));
      this.cost[i] = this.valid[i] && this.slope[i] <= 30
        ? Math.fround(Math.fround(1 + Math.fround(4 * Math.fround(ratio * ratio))) + Math.fround(1.5 * this.roughness[i])) : Infinity;
    }
    return this.cost;
  }
  segment(start, end) {
    if (!Number.isFinite(this.cost[start]) || !Number.isFinite(this.cost[end])) throw new RoutingError('Start or destination lies on excluded terrain');
    this.search.run(this.cost, this.width, this.height, start, end);
    const cells = [];
    for (let cell = end; cell !== -1; cell = this.search.previous[cell]) {
      cells.push(cell);
      if (cell === start) break;
    }
    return cells.reverse();
  }
  resolvedStops(mission) {
    return mission.route_stops.map((stop) => {
      let longitude, latitude;
      if (stop.type === 'science') {
        const waypoint = this.waypoints.get(stop.id);
        if (!waypoint) throw new RoutingError(`Unknown science target: ${stop.id}`);
        [longitude, latitude] = waypoint.geometry.coordinates;
      } else {
        ({ longitude, latitude } = stop);
        const validation = this.validateWaypoint(longitude, latitude);
        if (!validation.valid) throw new RoutingError(`Invalid checkpoint ${stop.name}: ${validation.warnings.join(' ')}`);
      }
      return { id: stop.id, type: stop.type, cell: this.cell(longitude, latitude) };
    });
  }
  routeCells(mission) {
    const habitat = this.cell(mission.habitat.longitude, mission.habitat.latitude);
    const stops = [habitat, ...this.resolvedStops(mission).map((stop) => stop.cell), habitat], cells = [];
    for (let i = 1; i < stops.length; i++) {
      const segment = this.segment(stops[i - 1], stops[i]);
      for (let j = cells.length ? 1 : 0; j < segment.length; j++) cells.push(segment[j]);
    }
    return cells;
  }
  candidate(id, label, cells, mission) {
    const coordinates = [], scene_coordinates = [], cumulative = [0], cumulativeEnergy = [0], slopes = [];
    const origin = this.bootstrap.scene.origin;
    let distance = 0, energy = 0, travelMinutes = 0, gain = 0, loss = 0, roughness = 0;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i], [x, y] = this.xy(cell), elevation = this.elevation[cell];
      coordinates.push([...this.geographic(x, y), elevation]);
      scene_coordinates.push([x - origin.x, elevation - origin.elevation, origin.y - y]);
      slopes.push(this.slope[cell]);
      roughness += this.roughness[cell];
      if (i + 1 < cells.length) {
        const [nx, ny] = this.xy(cells[i + 1]), step = Math.hypot(nx - x, ny - y);
        const ratio = Math.min(2, Math.max(0, Math.fround(this.slope[cell] / Math.max(mission.preferred_max_slope_deg, 1))));
        const weight = Math.fround(Math.fround(1 + Math.fround(4 * Math.fround(ratio * ratio))) + Math.fround(1.5 * this.roughness[cell]));
        const speed = Math.max(0.2, Math.fround(0.8 / Math.fround(1 + Math.fround(2.5 * ratio))));
        const delta = this.elevation[cells[i + 1]] - elevation;
        distance += step;
        energy += step * weight;
        travelMinutes += step / speed / 60;
        gain += Math.max(0, delta);
        loss += Math.max(0, -delta);
        cumulative.push(distance);
        cumulativeEnergy.push(energy);
      }
    }
    slopes.sort((a, b) => a - b);
    const percentileIndex = (slopes.length - 1) * 0.95, lower = Math.floor(percentileIndex);
    const percentile = slopes[lower] + (slopes[Math.ceil(percentileIndex)] - slopes[lower]) * (percentileIndex - lower);
    const safety = Math.max(0, Math.min(100, 100 - percentile / 30 * 70 - roughness / cells.length * 30));
    const scienceStops = mission.route_stops.filter((stop) => stop.type === 'science');
    const evidence = this.bootstrap.science_evidence;
    const priority = scienceStops.reduce((sum, stop) => sum + Number(this.waypoints.get(stop.id).properties.priority ?? 1), 0) / 9;
    const diversity = new Set(scienceStops.map((stop) => evidence[stop.id].geology_symbol)).size / Math.max(1, scienceStops.length);
    const mineral = scienceStops.reduce((sum, stop) => sum + evidence[stop.id].mineral_interest, 0) / Math.max(1, scienceStops.length);
    const science = Math.min(100, (priority * 0.7 + diversity * 0.15 + mineral * 0.15) * 100);
    const visitDuration = mission.route_stops.reduce((sum, stop) => sum + (stop.type === 'custom' ? stop.visit_duration_min : 15), 0);
    const profileAt = (i) => ({ distance_m: cumulative[i], elevation_m: this.elevation[cells[i]], slope_deg: this.slope[cells[i]] });
    const elevation_profile = [], sampleStep = Math.max(1, Math.floor(cells.length / 180));
    for (let i = 0; i < cells.length; i += sampleStep) elevation_profile.push(profileAt(i));
    if (elevation_profile.at(-1).distance_m !== distance) elevation_profile.push(profileAt(cells.length - 1));
    let searchFrom = 0;
    const stop_visits = this.resolvedStops(mission).map((stop) => {
      let index = cells.indexOf(stop.cell, searchFrom);
      if (index < 0) index = searchFrom;
      searchFrom = index;
      return { id: stop.id, type: stop.type, route_vertex_index: index, arrival_distance_m: round(cumulative[index]), arrival_energy_units: round(cumulativeEnergy[index]) };
    });
    return {
      id, label, coordinates, scene_coordinates,
      metrics: { distance_m: round(distance), duration_min: round(travelMinutes + visitDuration), elevation_gain_m: round(gain), elevation_loss_m: round(loss), maximum_slope_deg: round(slopes.at(-1)), energy_units: round(energy), safety_score: round(safety), science_score: round(science), return_reserve_units: round(mission.energy_budget - energy) },
      elevation_profile, stop_visits,
      explanation: ['Route avoids terrain above 30° and nodata cells.', `The 95th-percentile slope is ${percentile.toFixed(1)}°.`, `The mission visits ${mission.route_stops.length} stops with a science score of ${science.toFixed(0)}/100.`],
    };
  }
  returnEnvelope(mission) {
    const stride = 8, width = Math.ceil(this.width / stride), height = Math.ceil(this.height / stride);
    const cost = new Float32Array(width * height);
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) cost[row * width + col] = this.cost[row * stride * this.width + col * stride];
    const habitat = this.cell(mission.habitat.longitude, mission.habitat.latitude);
    const start = Math.floor(Math.floor(habitat / this.width) / stride) * width + Math.floor(habitat % this.width / stride);
    const search = new Search(cost.length);
    if (!Number.isFinite(cost[start])) return emptyCollection();
    search.run(cost, width, height, start);
    const remaining = mission.energy_budget * (1 - mission.return_reserve_pct / 100), features = [];
    const [a, , c, , e, f] = this.metadata.transform;
    for (const [state, fraction] of [['safe', 0.65], ['caution', 1]]) {
      const mask = Uint8Array.from(search.distances, (value) => Number(Number.isFinite(value) && value * this.metadata.resolution_m * stride <= remaining * fraction));
      const rings = polygonRings(mask, width, height);
      if (rings.length) features.push({ type: 'Feature', properties: { state }, geometry: { type: 'Polygon', coordinates: rings.map((ring) => ring.map(([x, y]) => this.geographic(c + x * stride * a, f + y * stride * e))) } });
    }
    return { type: 'FeatureCollection', features };
  }
  plan(mission) {
    const started = performance.now();
    const result = { feasible: false, primary: null, alternative: null, return_envelope: emptyCollection(), warnings: [], assumptions: this.bootstrap.limitations, calculation_ms: 0 };
    const done = () => ({ ...result, calculation_ms: round(performance.now() - started) });
    const [hx, hy] = this.projected(mission.habitat.longitude, mission.habitat.latitude);
    const center = this.bootstrap.habitat_zone.center, [cx, cy] = this.projected(center.longitude, center.latitude);
    const habitat = this.cell(mission.habitat.longitude, mission.habitat.latitude);
    if (Math.hypot(hx - cx, hy - cy) > this.bootstrap.habitat_zone.radius_m || !this.valid[habitat] || this.slope[habitat] > 20) {
      result.warnings.push('Habitat must remain on valid terrain within the approved 250 m zone.');
      return done();
    }
    this.costSurface(mission.preferred_max_slope_deg);
    try {
      const primaryCells = this.routeCells(mission);
      const primary = this.candidate('primary', 'Recommended route', primaryCells, mission);
      const corridor = new Uint8Array(this.count);
      for (const cell of primaryCells) {
        const row = Math.floor(cell / this.width), col = cell % this.width;
        for (let dy = -5; dy <= 5; dy++) {
          if (row + dy < 0 || row + dy >= this.height) continue;
          for (let dx = -(5 - Math.abs(dy)); dx <= 5 - Math.abs(dy); dx++) {
            if (col + dx >= 0 && col + dx < this.width) corridor[(row + dy) * this.width + col + dx] = 1;
          }
        }
      }
      for (let i = 0; i < this.count; i++) if (corridor[i]) this.cost[i] *= 2.5;
      const alternative = this.candidate('alternative', 'Terrain-diverse alternative', this.routeCells(mission), mission);
      result.primary = primary;
      result.alternative = alternative;
    } catch (error) {
      if (!(error instanceof RoutingError)) throw error;
      result.warnings.push(error.message);
      return done();
    }
    const metrics = result.primary.metrics, reserve = mission.energy_budget * mission.return_reserve_pct / 100;
    result.feasible = metrics.return_reserve_units >= reserve && metrics.duration_min <= mission.max_duration_min;
    if (metrics.return_reserve_units < reserve) result.warnings.push('The selected mission would violate the configured energy return reserve.');
    if (metrics.duration_min > mission.max_duration_min) result.warnings.push('The selected mission exceeds the configured EVA duration.');
    this.costSurface(mission.preferred_max_slope_deg);
    result.return_envelope = this.returnEnvelope(mission);
    return done();
  }
  emergencyRoute(mission, position) {
    if (!this.inside(position.longitude, position.latitude)) throw new RoutingError('The astronaut is outside the prepared Jezero area.');
    this.costSurface(mission.preferred_max_slope_deg);
    const cells = this.segment(this.cell(position.longitude, position.latitude), this.cell(mission.habitat.longitude, mission.habitat.latitude));
    return this.candidate('emergency', 'Emergency return', cells, { ...mission, route_stops: [] });
  }
}
