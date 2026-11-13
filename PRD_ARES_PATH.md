# Product Requirements Document: ARES Path

**Product name:** ARES Path  
**Expansion:** Astronaut Route & Exploration Safety Planner  
**Version:** 1.1
**Date:** 14 November 2026  
**Status:** Draft for implementation  
**Target event:** 2026 NASA Space Apps Challenge  

---

## 1. Executive Summary

ARES Path is an interactive Marswalk planning and 3D exploration application for a simulated human mission in Jezero Crater. It combines topography, orbital imagery, geology or mineralogy, rover observations, and historical environmental measurements to recommend routes that balance astronaut safety, resource limits, and scientific value. A synchronized **MarsWalk 3D** mode then lets the user experience the selected route from the surface while retaining mission, safety, and science context.

Unlike a conventional map that only displays layers, ARES Path converts those layers into operational decisions:

- Which scientific targets should be visited?
- Which route is safest within the available time and energy?
- Why did the system avoid a particular area?
- Can the astronauts still return safely to the habitat?
- What should change if energy, time, or environmental conditions worsen?
- What terrain, hazards, and scientific targets would the astronaut encounter while following the route?

The main differentiators are the **Dynamic Return-to-Safety Envelope**, which continuously shows whether an astronaut can return to the habitat while preserving a configurable safety reserve, and **MarsWalk 3D**, which turns the planned route into an evidence-based surface experience rather than a disconnected decorative visualization.

> ARES Path is a decision-support prototype, not a flight-certified navigation or life-support system.

---

## 2. Background

NASA and partner missions have collected extensive Mars data through orbital instruments and surface missions. These data include elevation models, high-resolution imagery, mineral indicators, geological maps, rover positions, surface photographs, and environmental measurements.

The data are scientifically valuable but distributed across different portals, instruments, spatial resolutions, coordinate systems, and file formats. Existing tools are strong for exploration and visualization, but an astronaut planning a local surface excursion needs a concise answer that connects scientific objectives with terrain safety and mission constraints.

ARES Path addresses this gap by integrating selected datasets into a hyperlocal mission-planning workflow.

---

## 3. Problem Statement

Mars astronauts must reach scientifically valuable locations while dealing with difficult terrain, limited mobility, finite time and energy, and the need to maintain a safe return path.

Current Mars data portals primarily expose individual datasets or map layers. They do not, by themselves, provide an integrated workflow that:

1. Converts terrain into traversal risk.
2. Converts geology and mineralogy into scientific opportunity.
3. Accounts for mission constraints such as time, energy, and maximum acceptable slope.
4. Recommends and explains a safe route.
5. Recalculates the mission when conditions change.

### Core problem

> How might we help astronauts plan a Marswalk that maximizes scientific value while remaining within terrain, time, energy, and safe-return constraints?

---

## 4. Product Vision

Enable an astronaut or mission planner to build, understand, and adapt a Marswalk plan using integrated NASA data rather than manually comparing disconnected maps and archives.

### Product principles

1. **Safety before distance:** the shortest route is not automatically the preferred route.
2. **Science with context:** every waypoint must explain its scientific relevance.
3. **Explainable recommendations:** route decisions must be traceable to data and constraints.
4. **Graceful uncertainty:** estimates and missing data must be visible to the user.
5. **Focused scope:** demonstrate one small area convincingly instead of mapping all of Mars superficially.
6. **One synchronized mission:** the 2D planner and MarsWalk 3D must share the same route, position, constraints, warnings, and waypoint state.

---

## 5. Goals and Success Metrics

### 5.1 Product goals

- Integrate at least three distinct NASA data categories in one local Mars map.
- Generate a safe route between a habitat and selected scientific targets.
- Display the safety and scientific trade-offs of alternative routes.
- Estimate distance, duration, elevation change, energy usage, and return reserve.
- Explain hazards and route-selection decisions in plain language.
- Recalculate the route after a simulated change in mission conditions.
- Provide surface imagery and scientific context at selected waypoints.
- Allow the user to enter MarsWalk 3D and follow the planned route over terrain derived from the same elevation and imagery data used by the planner.

### 5.2 MVP success metrics

| Metric | Target |
|---|---:|
| Integrated data categories | At least 4 |
| Demonstration science waypoints | At least 3 |
| Generated route alternatives | At least 2 |
| Route recalculation time | No more than 3 seconds for the prepared demo area |
| Map interaction response | No more than 500 ms for cached layers |
| MarsWalk transition after assets are cached | No more than 5 seconds |
| MarsWalk frame rate on the prepared demo machine | Median at least 30 FPS |
| 3D terrain, route, and waypoint control-point alignment | 5 of 5 checks pass |
| Waypoints with scientific explanation | 100% |
| Hazards with source or derivation shown | 100% |
| Critical demo flow completion | No fatal errors |

### 5.3 Competition success indicators

- Judges can understand the problem and value proposition within 60 seconds.
- The demonstration visibly uses real NASA or USGS-NASA data.
- The chosen route changes when risk or resource constraints change.
- The application communicates uncertainty and does not present assumptions as measured facts.

---

## 6. Non-Goals

The MVP will not:

- Provide flight-certified navigation.
- Control a spacesuit, rover, or robotic system.
- Model human physiology in detail.
- Produce a scientifically validated Mars weather forecast.
- Estimate local radiation exposure without a defensible Jezero dataset.
- Detect every individual rock or obstacle from raw images.
- Process all available Perseverance images.
- Process the complete raw CRISM hyperspectral archive.
- Support the entire surface of Mars.
- Guarantee that a computed route is physically traversable in the real environment.
- Provide photorealistic, rock-level reconstruction of the entire study area.
- Treat orbital DTM resolution as sufficient collision evidence for every small obstacle, ledge, or overhang.
- Provide unrestricted exploration outside the prepared 3D terrain boundary.

---

## 7. Target Users

### 7.1 Primary persona: EVA mission planner

Plans the excursion before departure, selects scientific goals, defines constraints, compares routes, and prepares contingency plans.

**Needs:** reliable overview, explainable trade-offs, route metrics, alternate routes, and abort planning.

### 7.2 Primary persona: Mars surface astronaut

Uses a simplified tablet or HUD view during the simulated excursion.

**Needs:** current route, next waypoint, remaining resources, nearby hazards, and fastest safe return path.

### 7.3 Secondary persona: planetary scientist

Identifies and prioritizes scientifically valuable targets.

**Needs:** geology, mineral indicators, observation provenance, imagery, and editable science scores.

### 7.4 Secondary persona: competition judge or public viewer

Needs a clear narrative showing how NASA data becomes a useful mission decision.

---

## 8. Primary Use Case

### Jezero Crater science excursion

1. A mission planner places a habitat in a prepared Jezero Crater study area.
2. The planner selects three targets representing different geological or mineralogical interests.
3. The planner defines a maximum EVA duration, energy budget, maximum preferred slope, and required return reserve.
4. ARES Path generates a recommended safe route and at least one alternative.
5. The planner compares route distance, terrain risk, energy estimate, and science value.
6. The user enters MarsWalk 3D at the habitat and follows the selected route in guided or free-walk mode.
7. The MarsWalk HUD shows the next waypoint, remaining resources, route guidance, hazard state, and return reserve.
8. Reaching a waypoint reveals its surface imagery, geology or mineral evidence, rationale, and source.
9. During the simulation, the energy budget is reduced or one route segment is marked unavailable.
10. The application synchronizes the new state with the 2D planner, recalculates the route, and when necessary drops a lower-priority waypoint.
11. The astronaut follows the revised or emergency route and returns to the habitat with the configured safety reserve.

---

## 9. Scope and Priority

Priority definitions:

- **P0:** required for the core competition demonstration.
- **P1:** strongly desired if P0 is stable.
- **P2:** stretch feature.

### 9.1 MVP/P0 scope

- Interactive map of one prepared Jezero study area.
- Layer controls for imagery, terrain, hazard, and science data.
- Habitat placement and science waypoint selection.
- Configurable time, energy, slope, and safety-reserve constraints.
- Safety-cost and science-opportunity layers.
- Recommended route plus one alternative.
- Route metrics and elevation profile.
- Dynamic Return-to-Safety Envelope.
- Emergency return-route calculation.
- Waypoint detail cards with imagery and data provenance.
- One what-if scenario that triggers route recalculation.
- MarsWalk 3D using terrain derived from the HiRISE DTM and orthomosaic.
- Guided route traversal, limited free-walk controls, waypoint interaction, and a compact mission HUD.
- Synchronized astronaut position, mission state, warnings, and route between 2D and 3D modes.

### 9.2 P1 scope

- Historical MEDA environmental profile.
- Recommended EVA time window based on historical conditions.
- Multiple route objectives such as safest, shortest, and science-maximizing.
- Side-by-side route comparison.
- Enhanced MarsWalk visuals, optional first-person view, and broader free exploration inside the prepared AOI.
- Mission briefing summary.

### 9.3 P2 scope

- Two-astronaut coordination.
- Rover or robotic cargo assistant.
- Offline tablet mode.
- Simplified HUD mode.
- Multi-objective Pareto frontier.
- Automatic science waypoint suggestion.
- Computer-vision-assisted hazard hints.

---

## 10. Data Requirements

### 10.1 Data selection principles

Data used by the MVP must:

- Come from NASA, USGS, or another clearly identified authoritative source.
- Include provenance and usage information.
- Cover the selected Jezero study area.
- Be transformable into a common Mars coordinate reference system.
- Be small enough to preprocess before the demonstration.
- Provide an operational purpose, not merely a decorative layer.

### 10.2 Required datasets

| ID | Dataset | Purpose | Expected format | Priority | Source |
|---|---|---|---|---|---|
| D-01 | Jezero CTX DEM, 20 m/pixel | Elevation, initial slope, route prototype | GeoTIFF, approximately 87 MB | P0 | [USGS Mars 2020 CTX DEM Mosaic](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic) |
| D-02 | Jezero HiRISE DTM, 1 m/pixel | Detailed local slope, roughness proxy, elevation profile | GeoTIFF, full mosaic approximately 1.8 GB | P0 | [USGS Mars 2020 HiRISE DTM Mosaic](https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_hirise_dtm_mosaic) |
| D-03 | HiRISE or CTX orthorectified imagery | Visual basemap and terrain inspection | GeoTIFF or JPEG2000; web tiles derived locally | P0 | [USGS Jezero Landing Site Products](https://astrogeology.usgs.gov/search/map/mars-2020-jezero-crater-landing-site-products) |
| D-04 | Mars geologic map or Jezero-relevant geologic units | Scientific context and geology diversity score | Vector layer, raster, or ArcGIS service | P0 | [USGS Interactive Maps: Mars](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars) |
| D-05 | CRISM map-projected or summary product | Mineral indicators and science-opportunity layer | IMG + HDR + LBL; selected browse PNG or converted GeoTIFF | P0 | [PDS CRISM Archive](https://pds-geosciences.wustl.edu/missions/mro/crism.htm) |
| D-06 | Mars 2020 Rover PLACES | Perseverance position, traverse, and location linkage | PDS4 tables with XML metadata | P0 | [Mars 2020 Rover PLACES](https://pds-geosciences.wustl.edu/missions/mars2020/places.htm) |
| D-07 | Perseverance surface images | Waypoint preview and visual surface context | Browse JPEG/PNG; scientific products may use VICAR/IMG + XML | P0 | [Perseverance Raw Images](https://mars.nasa.gov/mars2020/multimedia/raw-images/) |
| D-08 | MEDA calibrated or derived data | Historical environmental profile | CSV with PDS4 XML label | P1 | [PDS Mars 2020 MEDA](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html) |
| D-09 | Mars Trek layers | Dataset discovery, visual reference, optional basemap tiles | WMTS image tiles | P1 | [JPL Mars Trek](https://trek.nasa.gov/mars/) |

### 10.3 Dataset usage decisions

#### D-01: CTX DEM

- Use for initial development and full study-area coverage.
- Derive slope, hillshade, and coarse traversal cost.
- Retain as fallback if the HiRISE product is too heavy.

#### D-02: HiRISE DTM

- Download once, then crop to the demonstration bounding box.
- Do not serve the entire 1.8 GB source file to the browser.
- Convert the crop to a compressed or cloud-optimized GeoTIFF when useful.
- Derive high-resolution slope and local relief.
- Use the cropped 1 m DTM as the authoritative height source for MarsWalk terrain and camera elevation.
- Generate web-ready heightmap or mesh tiles with a documented local origin, scale, vertical datum, and level-of-detail scheme.
- Avoid claiming that every small feature in the DTM is a real obstacle; stereo DTM resolution and artifact limitations must be acknowledged.

#### D-03: Orbital imagery

- Use as the primary visual basemap.
- Generate web-friendly tiles or a compressed crop.
- Generate texture tiles aligned exactly to the MarsWalk terrain tiles, including lower-resolution mip levels.
- Preserve attribution and acquisition metadata.

#### D-04: Geology

- Use geological units to assign contextual science value.
- Do not use regional geology polygons as a fine-scale obstacle map.

#### D-05: CRISM

- Use a small number of selected summary products rather than the full hyperspectral cube.
- Convert selected products to aligned single-band GeoTIFFs.
- Record the source product ID and interpretation for every displayed mineral indicator.
- Label mineral results as remote-sensing indicators rather than confirmed field identification.

#### D-06: Rover PLACES

- Use the rover traverse as context and validation evidence.
- Connect selected surface observations to approximate acquisition locations.
- Do not automatically treat a rover-traversable segment as astronaut-safe.

#### D-07: Surface images

- Curate approximately 10-20 images relevant to the demonstration area or mission narrative.
- Store the sol, camera, product ID, source URL, and associated waypoint when available.
- Use these images as waypoint evidence or contextual panels, not as continuous terrain textures or panoramic reconstruction unless the required camera geometry is available.
- Do not attempt to load or classify the complete gallery for the MVP.

#### D-08: MEDA

- Use calibrated or derived measurements rather than raw telemetry.
- Aggregate historical observations by local time or sol for demonstration.
- Clearly label output as historical context, not a live forecast.

#### D-09: Mars Trek

- Use for discovery and optional visualization.
- Do not calculate slope or energy directly from image tiles.
- Prefer analytical raster files for numerical processing.

### 10.4 Derived datasets

The preprocessing pipeline must produce:

| Derived layer | Inputs | Output |
|---|---|---|
| Elevation | DEM | Single-band raster in meters |
| Slope | DEM | Degrees or percent grade |
| Hillshade | DEM | Visualization raster |
| Local relief/roughness proxy | DEM | Normalized raster |
| Traversability mask | Slope, data quality, manual exclusions | Binary raster |
| Terrain safety cost | Slope, roughness, elevation change | Normalized cost raster |
| Science opportunity | Geology, CRISM, selected POIs | Normalized score raster or vector |
| Combined route cost | Safety, energy, science, constraints | Weighted cost raster |
| Return-to-safety cost | Combined cost and habitat position | Cost-to-home raster |
| Web map layers | Analytical rasters and imagery | Tiled or compressed browser-ready assets |
| MarsWalk terrain | Cropped HiRISE DTM | Tiled heightmap, quantized mesh, or glTF terrain chunks with LOD |
| MarsWalk texture | Orthorectified imagery | Terrain-aligned texture tiles with mip levels |
| Terrain normals | MarsWalk terrain | Normal map or runtime-computed vertex normals for lighting |
| 3D route | Selected route and DTM | Route polyline with sampled elevation and local 3D coordinates |
| 3D scene manifest | CRS, AOI, terrain, texture, routes, POIs | Versioned JSON containing local origin, scale, bounds, asset URLs, and provenance |

### 10.5 Common data model

All spatial layers must be transformed into one documented Mars CRS and common grid for analysis.

Minimum metadata for each dataset:

- Dataset name
- Source organization
- Source URL
- Product ID, where available
- Acquisition or publication date
- Instrument
- Native resolution
- Native CRS and projection
- Processing steps
- Final resolution
- Known limitations
- Attribution or citation requirement
- Local 3D origin and coordinate-axis convention, when used by MarsWalk
- Horizontal and vertical scale, terrain LOD, and any vertical exaggeration

### 10.6 Data-use and attribution requirements

- Record the source and attribution for every external dataset.
- Respect usage terms for any non-U.S. Government source.
- Prefer NASA and USGS sources for the MVP.
- Display a data-source panel in the application.
- Do not imply NASA endorsement of ARES Path.

### 10.7 MarsWalk asset contract

The preprocessing implementation may choose heightmaps, quantized terrain, or mesh chunks, but it must expose the following logical package:

```text
data/processed/3d/
├── scene.json
├── terrain/
│   ├── tileset.json
│   └── <terrain chunks>
├── textures/
│   ├── tileset.json
│   └── <texture tiles and mip levels>
├── routes/
│   ├── primary_route_3d.json
│   ├── alternate_route_3d.json
│   └── emergency_route_3d.json
└── overlays/
    ├── waypoints_3d.json
    └── hazards_3d.json
```

`scene.json` must contain:

- Schema and asset-package version.
- Source dataset product IDs and processing version.
- Mars analysis CRS in full projection text.
- Geographic and projected AOI bounds.
- Local scene origin in Mars projected and geographic coordinates.
- Coordinate convention: right-handed, `x` east, `y` up, `z` south, all in meters.
- Elevation offset used to keep local scene values numerically stable.
- Horizontal scale, vertical scale, and vertical-exaggeration default.
- Terrain tile bounds, geometric error or LOD range, texture relationship, nodata state, and asset URL.
- Route and overlay asset URLs.
- SHA-256 checksum for every generated asset.
- Attribution and reconstruction limitations shown by the client.

Every 3D route vertex must retain route distance, source Mars coordinates, local `x/y/z`, elevation, slope, and route-segment identifier. Analytical calculations remain in the common Mars CRS; local scene coordinates are a rendering representation only.

---

## 11. Data Processing Pipeline

### 11.1 Pipeline stages

1. **Acquire:** download selected source products and their metadata.
2. **Validate:** verify file integrity, coverage, resolution, nodata values, and projection.
3. **Crop:** restrict large rasters to the selected study area.
4. **Reproject:** convert all spatial data to the common Mars CRS.
5. **Resample:** align analysis layers to a common grid appropriate for routing.
6. **Derive:** calculate slope, roughness proxy, hazard cost, and science score.
7. **Normalize:** transform input factors to documented comparable scales.
8. **Build 3D assets:** convert the cropped DTM and orthomosaic into aligned terrain, texture, normal, route, and scene-manifest assets.
9. **Package:** produce browser-ready map and MarsWalk assets plus a routing grid without shipping full source rasters to the browser.
10. **Verify:** visually compare derived layers with the original imagery and validate 2D-to-3D alignment at control points.

### 11.2 Data quality checks

- No unexplained CRS mismatch.
- No vertical unit mismatch.
- Nodata regions are excluded from routing.
- Layer bounds overlap the study area.
- Derived slope is visually consistent with hillshade.
- Route does not cross nodata or manually excluded cells.
- Every science waypoint has provenance.
- MarsWalk terrain, imagery, route, and waypoint coordinates agree at no fewer than five distributed control points.
- Terrain seams, missing tiles, inverted axes, and unexpected vertical exaggeration are absent in the prepared walkthrough corridor.
- The camera cannot enter nodata terrain or leave the prepared MarsWalk boundary.
- Data transformations are reproducible from scripts or documented commands.

---

## 12. Functional Requirements

### 12.1 Map and layers

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-MAP-01 | The system shall display the prepared Jezero study area on an interactive map. | P0 | Users can pan and zoom without losing the study area. |
| FR-MAP-02 | The system shall display orbital imagery as a basemap. | P0 | Imagery loads with correct alignment to elevation data. |
| FR-MAP-03 | The system shall provide visibility controls for elevation, slope, hazard, geology/mineralogy, rover traverse, and science POIs. | P0 | Each layer can be independently enabled or disabled. |
| FR-MAP-04 | The system shall provide a legend for every analytical layer. | P0 | Units and score ranges are visible when the layer is active. |
| FR-MAP-05 | The system shall allow layer-opacity adjustment. | P1 | Users can compare imagery with an overlay without hiding either layer completely. |
| FR-MAP-06 | The system shall show coordinates and source information for a selected point. | P1 | Clicking the map opens the location and relevant layer metadata. |

### 12.2 Mission configuration

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-MSN-01 | The user shall be able to select or move the habitat/start position inside an allowed zone. | P0 | A valid start point appears on the map and is used by routing. |
| FR-MSN-02 | The user shall be able to select at least three science waypoints. | P0 | Selected waypoints appear in an ordered mission list. |
| FR-MSN-03 | The user shall be able to reorder or remove waypoints. | P0 | The route updates after the mission order changes. |
| FR-MSN-04 | The user shall be able to set maximum duration, energy budget, preferred maximum slope, and return reserve. | P0 | Values are validated and affect route results. |
| FR-MSN-05 | The user shall be able to choose a routing objective: safest, shortest, or balanced. | P1 | Different objectives produce measurably different route rankings when applicable. |
| FR-MSN-06 | The system shall reject configurations with no feasible safe-return route. | P0 | The application explains which constraint prevents feasibility. |

### 12.3 Route generation

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-RTE-01 | The system shall generate a route from the habitat through selected waypoints and back to the habitat. | P0 | A complete route is drawn and route metrics are calculated. |
| FR-RTE-02 | The route shall avoid nodata, excluded, and non-traversable cells. | P0 | No route segment intersects an excluded cell. |
| FR-RTE-03 | The route cost shall account for slope and terrain-cost inputs. | P0 | Increasing the slope penalty changes the route where alternatives exist. |
| FR-RTE-04 | The system shall generate at least one alternative route. | P0 | The alternative differs spatially or by waypoint selection and has separate metrics. |
| FR-RTE-05 | The system shall calculate distance, estimated duration, elevation gain/loss, maximum slope, energy estimate, safety score, and science score. | P0 | All metrics are displayed for each candidate route. |
| FR-RTE-06 | The system shall explain major factors behind the recommended route. | P0 | The explanation names at least the primary avoided hazard and gained scientific value. |
| FR-RTE-07 | The system shall display an elevation profile along the selected route. | P0 | Profile position corresponds to the route position. |
| FR-RTE-08 | The system shall allow a route segment or area to be manually closed. | P1 | Recalculation avoids the closed region. |

### 12.4 Return-to-safety

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-SAFE-01 | The system shall calculate the minimum estimated return cost from the astronaut's simulated position to the habitat. | P0 | A return cost is available at every valid route position. |
| FR-SAFE-02 | The system shall display a Dynamic Return-to-Safety Envelope. | P0 | The map distinguishes safe, caution, and unsafe continuation regions. |
| FR-SAFE-03 | The system shall warn when continuing would violate the configured return reserve. | P0 | Warning appears before the simulated mission enters the unsafe region. |
| FR-SAFE-04 | The system shall generate an emergency return route. | P0 | The route goes directly to safety under the current simulated constraints. |
| FR-SAFE-05 | The system shall identify lower-priority waypoints that can be dropped to restore feasibility. | P1 | The revised plan satisfies the configured reserve. |

### 12.5 Science waypoints

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-SCI-01 | Every waypoint shall have a title, scientific rationale, data source, and priority. | P0 | No waypoint card is missing a required field. |
| FR-SCI-02 | A waypoint may include surface imagery, geology, and mineral indicators. | P0 | Available evidence appears in the waypoint detail view. |
| FR-SCI-03 | The system shall display the estimated visit duration and suggested activity for each waypoint. | P0 | Visit time contributes to total mission duration. |
| FR-SCI-04 | The science score shall reward target value and diversity rather than waypoint count alone. | P1 | Repeated targets from the same category provide diminishing additional score. |

### 12.6 Environmental context

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-ENV-01 | The system shall display selected historical MEDA measurements by sol or local time. | P1 | Chart shows units, time reference, and source. |
| FR-ENV-02 | The system shall label MEDA output as historical context, not a live forecast. | P1 | Disclaimer is visible near the environmental panel. |
| FR-ENV-03 | The system may adjust a demonstration environmental-risk multiplier based on a selected scenario. | P2 | The multiplier and its assumption are visible to the user. |

### 12.7 Scenario simulation

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-SIM-01 | The system shall support reducing the remaining energy budget during a simulation. | P0 | Route and return envelope recalculate after the change. |
| FR-SIM-02 | The system shall support blocking one area or route segment. | P1 | New routes avoid the blocked area. |
| FR-SIM-03 | The system shall compare before-and-after mission metrics. | P1 | Users can see which targets, costs, and safety margins changed. |

### 12.8 Provenance and communication

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-PRV-01 | The system shall show the data source behind each displayed layer. | P0 | Source is accessible from the layer panel. |
| FR-PRV-02 | The system shall distinguish measured, derived, and assumed values. | P0 | Each metric has a visible classification or tooltip. |
| FR-PRV-03 | The system shall show known limitations of the prototype. | P0 | A limitations panel is accessible from the main interface. |
| FR-PRV-04 | The system shall provide a mission summary suitable for the competition demonstration. | P1 | Summary includes objectives, route, metrics, selected targets, and data sources. |

### 12.9 MarsWalk 3D

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-3D-01 | The user shall be able to enter MarsWalk from the selected route in the 2D planner. | P0 | MarsWalk opens at the habitat or current simulated position and displays the same active route. |
| FR-3D-02 | MarsWalk terrain shall be generated from the cropped HiRISE DTM and textured with aligned orthorectified imagery. | P0 | Five distributed terrain control points match the source DTM and imagery within one rendered terrain cell. |
| FR-3D-03 | The system shall convert Mars coordinates into a documented local 3D coordinate system with meter-based scale. | P0 | A known one-kilometer source distance measures one kilometer in scene coordinates within preprocessing tolerance. |
| FR-3D-04 | The system shall support a guided mode that advances along the selected route and a limited free-walk mode inside the prepared boundary. | P0 | Users can switch modes; guided movement remains on the route and free-walk cannot leave valid terrain. |
| FR-3D-05 | The camera or avatar shall follow terrain elevation and remain above the collision surface. | P0 | The camera does not pass below terrain during the acceptance route and maintains the configured eye-height offset. |
| FR-3D-06 | The active route, habitat, science waypoints, hazard state, and emergency-return direction shall be visible in 3D. | P0 | Every required mission object appears at the correct terrain position and remains legible from the route. |
| FR-3D-07 | MarsWalk shall synchronize astronaut position and mission progress with the 2D map, elevation profile, resource estimates, and return reserve. | P0 | Moving in either guided or free-walk mode updates the shared mission state without resetting the plan. |
| FR-3D-08 | Reaching a waypoint shall expose its title, rationale, priority, available surface images, geology or mineral indicators, and provenance. | P0 | All three demonstration waypoints open complete evidence panels within an explicit interaction radius. |
| FR-3D-09 | MarsWalk shall show a compact HUD containing next waypoint, distance, route status, remaining energy or time, and return-reserve state. | P0 | Required values remain visible and match the planner state throughout the acceptance route. |
| FR-3D-10 | Warnings and route changes triggered in either view shall appear in both 2D and 3D modes. | P0 | The energy-loss scenario updates the route and warning state without reloading the application. |
| FR-3D-11 | The user shall be able to return to the 2D planner without losing camera position, route progress, selected waypoints, or scenario state. | P0 | A round trip between views preserves all shared mission state. |
| FR-3D-12 | The system shall communicate the resolution and reconstruction limitations of the 3D terrain. | P0 | A visible information panel states that small rocks, overhangs, and sub-meter obstacles may be absent. |
| FR-3D-13 | Vertical exaggeration shall default to 1× and any non-1× mode shall be visibly labeled. | P0 | The default scene uses true scale; changing scale produces a persistent label and does not alter routing calculations. |
| FR-3D-14 | Terrain and texture shall load progressively using chunks or levels of detail. | P0 | Entering MarsWalk does not load either full source GeoTIFF into browser memory. |

---

## 13. Route and Scoring Model

### 13.1 Terrain cost

The initial cost model may use a weighted normalized sum:

```text
terrain_cost =
    slope_weight * slope_cost
  + roughness_weight * roughness_cost
  + elevation_weight * elevation_change_cost
  + exclusion_penalty
```

The exact weights must be configurable and documented. A value derived from heuristic assumptions must not be presented as a NASA operational standard.

### 13.2 Science score

```text
science_score =
    target_priority
  + mineral_interest
  + geology_diversity
  + observation_confidence
  - redundancy_penalty
```

### 13.3 Combined route objective

```text
route_score =
    safety_weight * normalized_safety_cost
  + energy_weight * normalized_energy_cost
  + time_weight * normalized_time_cost
  - science_weight * normalized_science_value
```

### 13.4 Routing approach

- Use A*, Dijkstra, or another deterministic least-cost path algorithm for the MVP.
- Use the prepared raster grid as the routing graph.
- Treat hard exclusions separately from soft costs.
- Include the return trip in feasibility checks.
- Cache cost-to-habitat results when possible for responsive safe-return calculations.

---

## 14. User Experience Requirements

### 14.1 Main planning layout

- **Left panel:** mission configuration and layer controls.
- **Center:** interactive Mars map and route.
- **Right panel:** route comparison, science waypoints, and safety warnings.
- **Bottom panel:** elevation profile, environmental chart, or mission timeline.

### 14.2 Visual language

- Green: acceptable safety margin.
- Yellow: reduced margin or caution.
- Red: infeasible or unsafe under current assumptions.
- Blue: primary recommended route.
- Dashed line: alternate or emergency-return route.
- Distinct symbols for habitat, astronaut, science target, and hazard.

Color must not be the only means of communicating state; labels, patterns, or icons are also required.

### 14.3 Critical warnings

Safety warnings must:

- State the cause.
- State the affected resource or constraint.
- Suggest the next safe action.
- Avoid ambiguous language.

Example:

> Continuing to Waypoint C would reduce the estimated return reserve below 20%. Return now or remove Waypoint C.

### 14.4 MarsWalk interaction model

- Default and only P0 view: third-person camera following a stylized astronaut grounded on the rendered collision surface.
- Guided controls: play or pause, speed selection, jump to next waypoint, and return to current route position.
- Free-walk controls: keyboard and mouse on desktop, constrained to valid terrain and a configurable distance from the approved route corridor.
- Navigation aids: route ribbon, next-waypoint marker, habitat bearing, emergency-return bearing, and optional minimap.
- Mission continuity: 2D and 3D are two views over one mission state, not independent simulations.
- Waypoint interaction: approaching the configured radius pauses guided motion and exposes the science evidence panel.
- Safety: nodata, AOI boundaries, and hard exclusions block movement; soft hazards warn but do not silently rewrite the route.
- Visual scale: true horizontal and vertical scale is the default; atmospheric effects and lighting are illustrative and labeled when assumed.
- Accessibility: essential movement and waypoint actions must be keyboard-operable, and guided mode must allow the full narrative without precision free-walk control.

---

## 15. Non-Functional Requirements

### 15.1 Performance

| ID | Requirement |
|---|---|
| NFR-PERF-01 | Initial application load should complete within 8 seconds on the prepared demonstration machine. |
| NFR-PERF-02 | Cached map interactions should respond within 500 ms. |
| NFR-PERF-03 | Route calculation and recalculation shall complete within 3 seconds for the prepared study area. |
| NFR-PERF-04 | Large source rasters shall be cropped, tiled, or streamed rather than loaded entirely into browser memory. |
| NFR-PERF-05 | MarsWalk shall become interactive within 5 seconds after cached core assets are available on the prepared demonstration machine. |
| NFR-PERF-06 | MarsWalk shall sustain a median of at least 30 FPS and a 1st-percentile frame rate of at least 20 FPS during the prepared route. |
| NFR-PERF-07 | Terrain and texture memory budgets shall be measured and documented for the prepared demonstration machine. |
| NFR-PERF-08 | LOD changes shall not create visible terrain gaps or move mission markers away from the surface. |

### 15.2 Reliability

| ID | Requirement |
|---|---|
| NFR-REL-01 | The competition demo shall work without dependence on live third-party map services after assets are prepared. |
| NFR-REL-02 | Missing optional layers shall not prevent route generation from core terrain data. |
| NFR-REL-03 | The system shall fail safely when no valid route exists and shall not draw a misleading fallback route. |
| NFR-REL-04 | Preprocessed demo assets shall be versioned and reproducible. |
| NFR-REL-05 | If an optional 3D overlay fails, core terrain, active route, mission HUD, and return-to-planner controls shall remain usable. |
| NFR-REL-06 | MarsWalk core assets shall work without live third-party map or terrain services after preprocessing. |

### 15.3 Accuracy and scientific integrity

| ID | Requirement |
|---|---|
| NFR-SCI-01 | Units, coordinate reference system, resolution, and nodata handling shall be documented. |
| NFR-SCI-02 | Measured, derived, and assumed quantities shall be visually distinguishable. |
| NFR-SCI-03 | The application shall not claim operational validation or NASA endorsement. |
| NFR-SCI-04 | Environmental measurements shall not be described as live data or forecast unless a real forecasting model is implemented and validated. |
| NFR-SCI-05 | Mineral indicators shall be described as remote-sensing interpretations, not definitive ground truth. |
| NFR-SCI-06 | MarsWalk shall identify the terrain as an orbital-data reconstruction and shall not imply rock-level or sub-meter completeness. |
| NFR-SCI-07 | Rendering effects, avatar motion, lighting, atmospheric appearance, and collision assumptions shall be identified as simulated or illustrative. |
| NFR-SCI-08 | Visual vertical exaggeration shall never change analytical elevation, slope, distance, energy, or routing results. |

### 15.4 Usability

| ID | Requirement |
|---|---|
| NFR-USE-01 | A first-time user shall be able to complete the prepared planning flow without documentation in under 5 minutes. |
| NFR-USE-02 | Every major score and warning shall include an explanation or tooltip. |
| NFR-USE-03 | The user shall be able to reset the demonstration to a known initial state with one action. |
| NFR-USE-04 | The interface shall use concise language suitable for time-critical decisions. |
| NFR-USE-05 | A first-time user shall be able to enter MarsWalk, follow the guided route, inspect a waypoint, and return to the planner without documentation. |
| NFR-USE-06 | MarsWalk shall provide an option to reduce camera motion and disable nonessential head-bob or transition effects. |

### 15.5 Accessibility

| ID | Requirement |
|---|---|
| NFR-ACC-01 | Text and essential controls shall meet WCAG AA contrast targets where practical. |
| NFR-ACC-02 | All interactive controls shall be reachable by keyboard. |
| NFR-ACC-03 | Layer and warning states shall not rely on color alone. |
| NFR-ACC-04 | Charts and icons shall include accessible labels. |
| NFR-ACC-05 | Guided MarsWalk and all essential waypoint interactions shall be operable without free-look mouse control. |

### 15.6 Security and privacy

| ID | Requirement |
|---|---|
| NFR-SEC-01 | The MVP shall not require personal user data. |
| NFR-SEC-02 | External URLs and dataset metadata shall be treated as untrusted input. |
| NFR-SEC-03 | Uploaded or imported configuration files shall be validated before use. |
| NFR-SEC-04 | Secrets or private API keys shall not be embedded in the client application. |

### 15.7 Maintainability and reproducibility

| ID | Requirement |
|---|---|
| NFR-MNT-01 | Data acquisition and preprocessing steps shall be scripted or documented. |
| NFR-MNT-02 | Routing and scoring weights shall be configuration values rather than hardcoded throughout the codebase. |
| NFR-MNT-03 | Core calculations shall have automated tests using small deterministic fixtures. |
| NFR-MNT-04 | Code comments shall be used only where logic or assumptions are not self-explanatory. |
| NFR-MNT-05 | 3D asset generation, coordinate conversion, route draping, and scene-manifest creation shall be scripted and deterministic. |
| NFR-MNT-06 | The local 3D coordinate convention, axis orientation, scale, origin, terrain format, and LOD policy shall be documented. |

---

## 16. Analytics and Evaluation

The MVP should record or display the following for development and demonstration:

- Route-calculation duration
- Route distance and traversal cost
- Science score
- Safety score
- Estimated remaining reserve
- Number of selected and completed waypoints
- Reason for infeasibility
- Route changes after scenario updates
- Time to enter MarsWalk
- MarsWalk median and 1st-percentile FPS during the prepared route
- Peak terrain and texture memory usage
- 2D-to-3D alignment check result
- Waypoint interactions completed in MarsWalk
- Whether the user completed the guided route or exited early

No personally identifiable information is required.

---

## 17. End-to-End Acceptance Scenario

The MVP is accepted when the following scenario succeeds:

1. The application opens to the prepared Jezero study area.
2. Orbital imagery, elevation-derived hazards, and science layers are correctly aligned.
3. A habitat and three science targets are visible.
4. The user enters an EVA duration, energy budget, slope preference, and 20% return reserve.
5. The system generates a recommended route and one alternative.
6. Each route displays distance, duration, elevation, energy estimate, safety score, and science score.
7. The recommendation explains at least one avoided hazard and one scientific benefit.
8. The Dynamic Return-to-Safety Envelope is visible.
9. The user enters MarsWalk at the habitat within 5 seconds after core assets are cached.
10. The 3D terrain uses true-scale HiRISE-derived elevation and aligned orbital imagery; all five alignment controls pass.
11. The user follows the guided route while the HUD, 2D map, elevation profile, and resource state remain synchronized.
12. The user switches briefly to free-walk mode, remains inside valid terrain, and returns to guided mode.
13. At a science waypoint, the user opens surface imagery, scientific rationale, geology or mineral context, and provenance.
14. The user reduces the remaining energy by 20% while in MarsWalk.
15. The system recalculates the route or removes a lower-priority target and updates both 2D and 3D views without a page reload.
16. The system generates and displays a valid emergency return route.
17. The user returns to the 2D planner without losing route progress or mission state.
18. All displayed layers and waypoint evidence expose their sources and distinguish measured, derived, and simulated content.
19. MarsWalk meets the prepared-device targets of median 30 FPS, 1st-percentile 20 FPS, and no fatal errors during the route.

---

## 18. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Large HiRISE files | Slow processing and browser failure | Crop offline; create tiled or compressed products |
| Mars CRS mismatch | Misaligned layers and invalid routes | Document one common CRS; validate control points and bounds |
| CRISM complexity | Delayed preprocessing | Use selected summary products or browse products first |
| DTM artifacts interpreted as hazards | Misleading safety claims | Add resolution disclaimer; visually compare with imagery |
| Surface images lack simple map linkage | Weak waypoint context | Use Rover PLACES and Analyst's Notebook metadata; curate manually if needed |
| No local radiation dataset | Unsupported safety score | Exclude radiation from MVP instead of fabricating it |
| Historical MEDA data mistaken for forecast | Scientific misrepresentation | Explicit historical label and limitations panel |
| Too many features | Unfinished competition demo | Complete P0 flow before P1/P2 features |
| Dependence on internet access | Demo failure | Prepare local demo assets and cache required metadata |
| Route weights appear arbitrary | Low credibility | Expose weights, assumptions, and sensitivity comparison |
| Terrain mesh or texture is too heavy | Slow load, low FPS, or browser crash | Tile assets, use LOD and mipmaps, compress textures, and define a measured memory budget |
| 2D and 3D coordinate mismatch | Route, waypoint, or hazard floats away from terrain | Use one documented local origin and meter scale; validate five distributed control points |
| Floating-point precision at Mars coordinates | Camera jitter and unstable markers | Render relative to a local origin rather than full planetary coordinates |
| DTM resolution implies false obstacle confidence | Misleading walking experience | Label reconstruction limits; use DTM collision only at its defensible scale; do not invent rock-level safety |
| Terrain seams or nodata holes | Camera fall-through or broken walkthrough | Build skirts or seamless tile borders; block nodata; test the entire prepared corridor |
| Third-person camera motion causes discomfort | Users cannot complete the demo | Provide guided mode, reduced-motion settings, camera damping, and speed control |
| 3D work delays routing and safety features | Incomplete core value proposition | Implement one fixed, optimized walkthrough corridor over the proven route before broader exploration |

---

## 19. Delivery Milestones

### Milestone 1: Data feasibility

- Select the Jezero bounding box.
- Download DEM and imagery.
- Confirm projection, coverage, and resolution.
- Produce aligned slope and hillshade layers.

### Milestone 2: Routing proof of concept

- Create traversal grid.
- Implement least-cost path.
- Generate route metrics.
- Validate that exclusions and slope penalties affect routing.

### Milestone 3: MarsWalk terrain proof of concept

- Generate deterministic heightmap or mesh and texture assets from the cropped DTM and orthomosaic.
- Define the local origin, axes, meter scale, boundary, and LOD policy.
- Render the selected route and five alignment control points on the terrain.
- Implement stylized astronaut grounding, third-person follow camera, guided movement, and nodata or boundary blocking.
- Measure initial load time, FPS, and memory on the prepared demonstration machine.

### Milestone 4: Science integration

- Add geology or CRISM layer.
- Define three science waypoints.
- Add waypoint evidence and source metadata.
- Implement science scoring.

### Milestone 5: Safety experience

- Implement return-cost calculation.
- Implement Dynamic Return-to-Safety Envelope.
- Add warnings and emergency return route.
- Synchronize mission position, warnings, route changes, and return reserve between 2D and MarsWalk.

### Milestone 6: Competition-ready product

- Add alternative route and what-if scenario.
- Optimize performance.
- Prepare cached/offline demo assets.
- Complete the guided MarsWalk route, waypoint interactions, reduced-motion option, and limitations panel.
- Validate five 2D-to-3D control points and rehearse the energy-loss scenario from inside MarsWalk.
- Validate scientific language and attribution.
- Rehearse the end-to-end demonstration.

---

## 20. Open Questions

The following decisions should be resolved during data feasibility work:

1. What exact Jezero bounding box provides the best combination of HiRISE, CRISM, rover, and surface-image coverage?
2. Which three scientific targets create the clearest mission narrative?
3. Which CRISM summary parameters are understandable and defensible for the demonstration?
4. What routing-grid resolution balances terrain detail and calculation speed?
5. How should energy be estimated without overstating physiological accuracy?
6. Which route weights create meaningful alternatives without appearing arbitrary?
7. Should the habitat be fixed for a controlled demo or user-placeable within an approved zone?
8. Can relevant Perseverance images be reliably connected to the selected waypoints?
9. Which browser rendering stack will be used for MarsWalk, and what asset formats does it require?
10. What route-corridor width provides useful free-walk exploration without forcing the complete AOI to load at full detail?
11. What terrain chunk size and LOD policy meet the 30 FPS target on the prepared demonstration machine?
12. Which P1 first-person camera settings can be added without compromising the stable third-person P0 experience?
13. Which hazard overlays remain understandable in 3D without obscuring the orbital texture?

---

## 21. Recommended MVP Decision

Proceed with a fixed, carefully prepared Jezero demonstration area and the following initial stack:

1. CTX DEM for broad coverage.
2. Cropped HiRISE DTM for detailed routing.
3. HiRISE or CTX imagery for the basemap.
4. One geology layer and one CRISM-derived science layer.
5. Rover PLACES for traverse and location context.
6. A curated set of Perseverance images.
7. MEDA as a P1 historical environmental feature.
8. Deterministic MarsWalk heightmap or mesh tiles, aligned orthomosaic textures, a 3D route, and a versioned scene manifest.

The first implementation should prove one complete story: **select valuable science targets, generate a safe route, enter MarsWalk, encounter the scientific evidence on the surface, simulate a resource loss, replan, and return safely to the habitat.**
