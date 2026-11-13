# Implementation status against ARES Path PRD

The local measured-data demonstration implements the P0 planning workflow and the scripted end-to-end acceptance scenario. Automated validation covers the data alignment and critical application flow. This is a prototype; no field or NASA operational validation is claimed.

| PRD area | Implemented |
|---|---|
| Map and layers | Measured HiRISE basemap, 5 m elevation and slope, manual exclusions, interpreted USGS geology, three CRISM parameters, segmented PLACES traverse, proposed science visits, dynamic return envelope; independent visibility, opacity, legends, point coordinates |
| Configuration | Hypothetical habitat placement, three selectable/reorderable stops, time/energy/slope/reserve validation, balanced/safest/shortest objectives |
| Routing | Deterministic 8-connected least-cost round trip, no diagonal corner cutting, hard exclusions, separate alternative, metrics and elevation profile, no fabricated fallback path |
| Safety | Directed minimum-energy return field, current-resource continuation envelope, warnings, emergency route, lower-priority stop removal |
| Science | Twelve downloaded surface images at three exact camera site/drive localizations, product IDs/dates/credits, regional geology and raw CRISM values; proposed activity, priority and duration |
| Environment | Seven recomputed historical MEDA sols, mean air-temperature chart and table, units and source, explicit temporal/spatial limitations |
| Simulation | Playback/scrubbing, observation accounting, 20% remaining-energy loss, committed-position replanning, before/after metrics, closures |
| Communication | Measured/derived/interpreted/assumed distinctions, source catalog, limitations, model formulas, JSON briefing with geographic coordinates |
| 3D and offline | Same measured grid/routes as 2D, datum-normalized rendering, orbital texture, habitat/astronaut, orbit/zoom; single offline HTML |

## Data geometry

Center 77.405123636° E, 18.451193185° N, planetocentric latitude and east longitude. Analysis CRS: `+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +R=3396190 +units=m +no_defs`. Local x increases east, z south. Nodes span 400×400 m; raster pixel support is 405×405 m. Source HiRISE MOLA topography/DeltaGeoid elevations are retained for metrics; the median elevation is subtracted only for rendering.

The 1 m DTM is aligned before 5×5 averaging to 5 m. Slope uses elevation gradients. Roughness is a 3×3 elevation standard-deviation proxy normalized by its 95th percentile, not measured rock abundance. Nodata must remain excluded. Current area has complete DTM and selected CRISM coverage. Geology is contextual only; its 100–200 m registration uncertainty remains after reprojection.

## Model

For each directed step:

```text
distance = sqrt(horizontal_distance² + elevation_change²)
energy = distance × 0.065 × (1 + max_endpoint_slope/35 + roughness×0.3)
         + positive_elevation_change × 0.45
minutes = distance / 32 × (1 + max_endpoint_slope/40 + roughness×0.2)
```

Observation time contributes once at each stop; observation energy is not modeled separately. Energy units do not represent oxygen, battery watt-hours or physiological consumption. All weights are centralized in `MODEL` and exposed in the sources dialog.

Reserve applies to original energy capacity and total EVA duration. Lost energy reduces remaining resources without changing the reserve baseline. Feasibility includes already consumed resources, all remaining visits and return home. Emergency return minimizes energy, then checks time and reserve. The envelope adds minimum-energy travel from the current position to each candidate and back home, checking duration along those paths. Faster alternative paths may exist; future observation times are not included in hypothetical envelope visits. Green has ≥10% additional resource margin, amber preserves reserve with less margin, red violates reserve, and unreachable terrain is masked.

Terrain score is `100 − distance-weighted mean(slope/30×0.7 + roughness×0.3)×100`. Science uses assumed target values with diminishing same-unit returns and a diversity bonus. Raw CRISM indicators inform the displayed scientific context; they are not automatically converted into a mineral-confidence score.

## Verified and remaining limits

- Twelve planner and measured-data integration tests cover routes, exclusions, unreachable paths, reserves, adaptation, directional energy, envelope changes, simulation accounting, diversity and validation.
- Four upstream data-contract tests remain passing.
- Local scientific validation checks CRS/transforms, grid shape, coverage, independently recomputed slopes, center alignment, source hashes, image camera associations, MEDA provenance and upstream sample integrity.
- The offline browser test covers the complete scenario, loaded photos, layer selection, 3D, export, mobile layout and absence of runtime network requests.
- Automated checks are not independent scientific peer review or a physical traversability assessment. Accessibility contrast and performance on other hardware have not been comprehensively audited.
- No recommended EVA time window: these seven MEDA sols are earlier and at historical rover positions; no local-time weather model is justified. No radiation, environmental multiplier, physiology, Pareto frontier, automatic waypoint selection or obstacle recognition is implemented.
- Priorities and target values are curated assumptions. Mineral confidence is not quantified. Habitat is hypothetical. The three stops represent rover camera locations, not confirmed sampling sites or image footprints.
