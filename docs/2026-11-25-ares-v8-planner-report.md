# ARES v8: real-world inputs and tracking inside the v7 console

Date: 25 Nov 2026
Artifact: "ARES Response Console v8" (new). "ARES Response Console v7" is unchanged.
Package: `2026-11-25-ares-planner-v8.zip`

## 1. What changed in this round

**The interface is the v7 console.** The same map, 3D scene, 11-stage timeline, pages and panels are used. The gods-eye-view (GEV) ideas come in as model inputs and as ways of showing them, not as a new interface. The earlier Leaflet console was retired; its code is kept outside the package for reference.

**Additions inside the v7 console:**

| Where | What was added |
|---|---|
| Side panel: new **Inputs** tab | Snapshot / live mode, presets (v7 baseline / recommended / everything), one switch per input grouped by stage with its status line, a modules-vs-reliability bar chart, and operator zone drawing |
| Stage panel (every stage) | A box headed "Real-world inputs at this stage", listing the inputs that acted on that stage and what they did |
| Layers: new group **Live & tracking** | Airport and heliport clearance rings; road routes (red dashed where a route crosses the hazard and was re-routed); low-level aircraft corridors; wind arrow and speed; Nepal evidence points; operator zones |
| 3D scene | Each module at its own height. Hover position displaced downwind by tether lean. Cone and footprint drawn from the real hover point |
| Rescue briefing | Deployment order table (pre-sensing modules only); exports as JSON / GeoJSON / KML / CSV; draft airspace obstruction notice; Analyst panel |

## 2. GEV-style tracking: what is tracked and how it affects ARES

GEV tracks many live things. Only those that can change a pre-sensing decision were brought in. Each one was turned into a model rule:

| Tracked feed | Source | Effect on the plan | Stage |
|---|---|---|---|
| **Aircraft (flights, helicopters)** | ADSB.lol, falling back to ADSB.fi (community ADS-B) | Aircraft below 600 m above ground (1,000 m for helicopters) mark low-level corridors. Launch sites within 400 m of a corridor (600 m for a helicopter) are removed. Rescue helicopters working the area are the main case. Corridors are drawn on the map and listed in the order. | 5 |
| **GNSS interference** | gpsjam.org daily H3 map | Share of aircraft reporting poor GPS near the incident. If 10 % or more report it, 30 m is added to each module's position uncertainty; at 2 % or more, 10 m. Only matters near borders or conflict zones. | 5, 8 |
| **Geomagnetic storms** | NOAA SWPC (live), GFZ Potsdam Kp archive (replay) | Kp 7 or more adds 15 m drift; Kp 5 or more adds 5 m. These are GPS and radio-link degradation flags in the order. | 5, 8 |
| **Weather radar** | RainViewer composite | If there is an echo within about 6 km now, rain is forced into the first 2 h of the weather window. This overrides a forecast that missed the cell. | 5–6 |
| **Airspace notice** | generated | A draft obstruction notice (positions, heights above ground and sea level, times) for the nearest air traffic unit | 8 |

**Snapshot vs live.**
- Aircraft and radar are live-only: open archives do not exist. In snapshot replays they show as "live only".
- GNSS and Kp have archives, so the five scenarios use them at the event date.

**Not used, and why:**
- Ships: no inland effect.
- CCTV and licence-plate cameras: surveillance, and no Indian feeds.
- Satellites as orbits: Sentinel passes are already predicted from the catalogue. CelesTrak was not reachable from the build server.
- Radio scanners, bikeshare, wildlife, space launches: no bearing on deployment.

**Today's live check (25 Nov 2026, 15:26 UTC):**
- Delhi: 1 aircraft within 40 km (A320 at 35,000 ft), none low-level.
- GPS interference near Delhi: 0.5 % of reports (below the 2 % threshold).
- Kp 3.
- No radar echo at the Wayanad check point.

## 3. Results (snapshot, recommended inputs)

Planned through the v7 console code path, at each event date. The pre-sensing order counts only the modules placed before sensing starts.

| Scenario | Modules (pre-sensing) | Coverage | Hours target met | Last module up | Heights used | Roads / re-routed | GNSS / Kp at event |
|---|---|---|---|---|---|---|---|
| Dehradun | 24 (fleet-limited) | 84.9 % | 72 % | 455 min | 300 / 200 / 100 m | 12 / 12 | 0 % / 4.3, no drift |
| Wayanad | 2 | 95.1 % | 100 % | 33 min | 300 / 200 m | 2 / 0 | 0.7 % / 5.3, **+5 m** |
| Assam | 26 (fleet-limited) | 50.8 % | 0 % | 672 min | 200 / 300 / 150 m | 11 / 15 | 0 % / 3.7 |
| Delhi (hypothetical) | 9 | 91.3 % | 100 % | 152 min | 300 m | 9 / 0 | 0.6 % / 3.0 |
| Nepal | 3 | 97.0 % | 100 % | 133 min | 150 / 200 m | 3 / 0 | 0 % / 0.7 |

**Correction to the earlier report.** The Kp 6.67 storm near the Dehradun event fell about 18 h before the planning window. The maximum Kp inside the window was 4.3, so no drift was added.

**Nepal timing.** The last-module-up time is now 133 min, not 69 min. Routes whose snapped road length was shorter than the straight line (snapping error) are now rejected, and the off-road walk to the site is added.

## 4. Integrity checks (all re-run on the final code)

| Check | Result |
|---|---|
| v7 harness on the v8 console code (11 stages, 5 scenarios) | **100 / 100** identical fingerprints |
| v8 stages 1–8 with every input off vs v7 | **95 / 95** identical |
| v8 full run (1–11) with every input off vs v7 pipeline | **70 / 70** identical |
| v7 spot fingerprints vs published v7 | 20 / 20 |
| Console code path, recommended inputs, 5 scenarios | all run (table above) |
| Published file set served on its own | loads, Inputs tab active, Dehradun 24 pre-sensing modules; only external requests are the same libraries and fonts v7 uses |

## 5. Independent checks (unchanged from the first v8 round)

- **Nepal evidence** (Bhote Koshi 2026, from GEV / GeoPera, CC BY-NC): 3 geolocated evidence points fall in the area (Gyirong border gate, Timure cluster, Rasuwagadhi witness).
  - 2 lie inside the mapped hazard; the third is within 150 m of it.
  - **All 3 are covered by the plan.**
  - These are places where the flood was seen or did damage, not survivor locations.
- **Incident trigger:** for Nepal, USGS registered a seismic signal at 02:52 UTC on 26 Aug 2026. The planner picks it up automatically as the trigger.
- **Next-pass prediction vs actual scenes:**
  - Wayanad (radar and optical), Assam (radar and optical) and Nepal (optical): exact (0 h error).
  - Dehradun: the first radar scene came 36 h after the predicted pass and the first optical scene 72 h after, because the acquisition plan skipped passes.
  - Delhi: no post-event scene to compare.
- **Effect of each input:** full table in `2026-11-25-ares-v8-ablation.md`, re-run on the final code including aircraft, GNSS and radar. Popfusion (WorldPop + Meta HRSL) still changes the fleet 2–5×, so it stays a sensitivity setting.

## 6. Live test at a new location (first v8 round)

Joshimath, Uttarakhand (30.555 N, 79.564 E), debris/landslide, 25 Nov 2026:
- The area was built on demand: Copernicus DEM, WorldCover, HRSL (10,358 residents).
- Live NDMA, GDACS and USGS were checked; no alerts nearby.
- The live forecast and the 31-member GFS ensemble were used.
- A deployment order was produced.
- Overpass was unreachable from the build server, so the test had no roads or buildings.

## 7. Limits

- **Live data in the artifact.** The published console runs on saved input snapshots, because artifact pages cannot call outside feeds. Live mode, aircraft and radar need the local server (`npm start`).
- **Blocked sources.** OpenStreetMap Overpass and CelesTrak were blocked from the build server. Mirrors and fallbacks are in place.
- **Cloud base.** The cloud-base variable was not tested end to end; the LCL fallback was used.
- **Operating figures.** All values in `config/fleet.json` are assumptions to replace with real hardware figures. This includes the wind limit, blow-down, corridor buffers and drift additions.
- **Imagery.** Areas built live have no satellite imagery; land cover is used as shading.
- **Wider-area files.** The local package does not include v7's wider-area search files. They were copied into the v8 artifact on the server.
- **Fleet-limited scenarios.** Dehradun and Assam hit the fleet limit. The reliability curve shows the trade-off.
- **Live areas without drawn zones.** Without an operator-drawn affected area, the hazard is a modelled terrain prior. People needing help default to 10 % of exposed residents.
- **Unreachable sources.** IMD, CWC and NCS have no open live API reachable here; GDACS, USGS and ERA5/Open-Meteo stand in. Sachet has no archive, so replays can't use it.
