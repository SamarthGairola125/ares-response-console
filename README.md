# ARES Planner v8 — from alert to raised modules

ARES Planner is the pre-sensing half of the ARES software. It takes a disaster from the first alert up to the moment every aerostat module is raised and powered (stages 1–8), using live online data for any place in India and Nepal.

Stages 9–11 (sensing, belief update, handover) are unchanged from v7. They run on the hardware and ground station; this software stops at the **deployment order**, the file handed to the field teams and the ground station.

**The console is the v7 ARES Response Console** (same map, 3D scene, 11-stage timeline and pages). v8 adds an **Inputs** tab, a "Real-world inputs at this stage" box on every stage, a **Live & tracking** layer group, per-module heights in 3D, and the deployment order in the Rescue briefing.

It reuses the architecture of [gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (MIT):

- a local Node server that proxies and caches public feeds, with keys kept on your machine
- a browser console
- a draw tool
- share and export of results
- an AI analyst
- an MCP server

All of it is rebuilt around the ARES model and Indian data sources.

## View it online (no install)

The console is published with GitHub Pages: **https://samarthgairola125.github.io/ares-response-console/**

It runs entirely in the browser on the saved inputs for each event date. Live mode, aircraft, radar and the Analyst need the local server (below). Every push to `main` republishes the site through `.github/workflows/pages.yml`.

## Run it

Requirements: Node 20 or newer (22 or 24 recommended) and an internet connection.

```
npm ci                 # first time only (node_modules is already included in the zip)
npm start              # → http://localhost:4180
```

- **Replay a scenario:** pick one of the five events. The software runs on that date with archived inputs:
  - weather: ERA5
  - satellite passes: Sentinel-1 and Sentinel-2 catalogue
  - alerts: GDACS and USGS
  - routes: OSRM
  - airspace: OurAirports
- **Live incident (anywhere in India):** click the map or pick an alert from the live board (NDMA Sachet, GDACS, USGS). Choose the hazard type and press **Plan deployment**. ARES builds the area's data on demand:
  - terrain: Copernicus DEM
  - land cover: ESA WorldCover
  - population: Meta HRSL
  - roads and buildings: OpenStreetMap
  
  It then plans with the live forecast and its ensemble.
- **Operator zones:** draw no-go zones, must-cover zones and (live mode) the affected area, and set the command post. The planner obeys all of them.
- **Saved inputs:** `node tools/snapshot.mjs` refreshes `data/packs/<id>/v8/inputs.json`, which the console uses when no server is present (the published artifact).
- **Exports:** the deployment order as JSON (for the ground station), GeoJSON, KML (for field phones) and CSV.

Optional keys go in **Settings** or `.env` (see `.env.example`). All are free:

- `FIRMS_MAP_KEY`: NASA fires.
- `ANTHROPIC_API_KEY`: the Analyst panel.

## What each input does (stages 1–8)

| Switch | Stage | What changes in the model | Source |
|---|---|---|---|
| alerts | 1 | Opens and times the incident from real feeds | NDMA Sachet CAP (live), GDACS, USGS, NASA FIRMS |
| weather | 5–6 | Wind at hover height (shear plus a ridge speed-up from terrain), tether blow-down (lower and displaced camera), cloud base (camera blind inside cloud), visibility (contrast loss) and lightning hold-down | Open-Meteo forecast and ensemble (live), ERA5 (replay) |
| robust | 6–7 | Plans across every hour of the 24 h window. Fewest modules such that each hour's target holds in at least 80 % of the window (`holdShare`). Reports a modules-vs-reliability curve | as above |
| heights | 6–7 | Chooses each module's height (100–400 m) together with its site | — |
| occupancy | 3 | People at home at night; at schools, markets and offices by day (total conserved) | OSM building types, event hour |
| facilities | 3 | Hospitals, schools and colleges near the hazard get top priority | OSM |
| fairness | 7 | Every named settlement with people at risk gets at least 50 % of its need covered | OSM places |
| airspace | 5 | No launch inside airport or heliport clearance radii | OurAirports (radii are assumptions, see config) |
| routing | 8 | Real road travel times, list-scheduled across teams. Routes through mapped debris or water are re-routed over terrain | OSRM |
| imaging | 2, 8 | Next Sentinel-1 (radar) and Sentinel-2 (optical) pass, as the re-assessment time | Earth Search STAC |
| popfusion | 3 | WorldPop and Meta HRSL combined; their disagreement is reported. **Sensitivity setting, off by default** | Meta HRSL (AWS) |
| aircraft | 5 | Low-level aircraft (< 600 m AGL; helicopters < 1,000 m) define corridors; launch sites within 400 m (600 m for helicopters) are removed. **Live only** | ADSB.lol, ADSB.fi |
| gnss | 5 | GPS interference share near the incident (≥ 10 % → +30 m drift, ≥ 2 % → +10 m) and geomagnetic Kp (≥ 7 → +15 m, ≥ 5 → +5 m) | gpsjam.org, NOAA SWPC, GFZ Kp archive |
| radar | 5–6 | Echo within ~6 km now forces rain into the first 2 h of the weather window. **Live only** | RainViewer |
| constraints | 3, 5 | Operator no-go and must-cover zones, command-post override | console |

## Checks

- `node tests/regression.mjs`:
  - The v7 harness on the v8 core gives 100/100 identical fingerprints, so stages 9–11 are untouched.
  - With every switch off, v8 stages 1–8 reproduce v7 (95/95).
- `node tests/regression_full.mjs`: full 11-stage run with every input off equals v7 (70/70).
- `node tests/console_path.mjs`: the console's code path with the recommended inputs on all five scenarios.
- `node tests/ablation.mjs`: effect of each input on the five scenarios (`tests/results/ablation.md`).
- `node tests/rasters_check.mjs`: compares the live raster readers with the v7 packs.
- `node tests/feeds.mjs`: one live request per source.

## MCP (Claude Desktop)

```json
{ "mcpServers": { "ares": { "command": "node", "args": ["<folder>/server/mcp.mjs"] } } }
```

Tools: `ares_list_scenarios`, `ares_india_alerts`, `ares_plan_scenario`, `ares_plan_location`, `ares_deployment_order`.

## Folders

```
core/       ARES model (v7 core.js, model.js, datapack.js, pipeline.js; two small marked v8 patches) + live.js (stages 1–8 with live inputs)
server/     index.mjs (console + API), planner.mjs, packbuilder.mjs, mcp.mjs, http.mjs (cache), feeds/*.mjs
web/        operator console (Leaflet)
config/     fleet.json — operating assumptions (replace with your hardware's numbers)
data/packs  five scenario packs (v7) + HRSL layers + packs built for live incidents
data/evidence  Bhote Koshi 2026 evidence points (from gods-eye-view / GeoPera, CC BY-NC 4.0)
cache/      every feed response with its fetch time (works offline on the last good copy)
tests/      regression, ablation, raster and feed checks + results
```

## Assumptions and limits (read before using the numbers)

- **Operating limits.** `config/fleet.json` holds assumptions, not measured values: 15 m/s operating wind, 30° blow-down at 15 m/s, setup time, crew, helium, cost and clearance radii. Replace them with your hardware's figures.
- **Cloud base.** ARES uses the model's own cloud-base height when the feed provides it. Otherwise it uses the lifting condensation level, in dry hours only; in rain it applies a rain-rate visibility relation. Treat the cloud limits as indicative.
- **Live packs.**
  - If you don't draw the affected area, the hazard is a *modelled* terrain prior (height above drainage), labelled as such.
  - "People needing help" defaults to 10 % of exposed residents. Enter the real figure when it is known.
- **Public servers.** Some feeds use public servers (OSRM demo, Overpass, Open-Meteo free tier) that have rate limits; for real operations, point `OSRM_URL` / `OVERPASS_URLS` at your own instances.
- **Unreachable sources.** IMD, CWC and NCS have no open live API reachable from here, so ARES uses GDACS, USGS and ERA5/Open-Meteo instead.
- **Airspace.** Clearance radii are planning assumptions. Check DGCA / Digital Sky before flying.

## Credits and licences

- **ARES code:** this project. Patterns from gods-eye-view (MIT, © Bilawal Sidhu).
- **Nepal evidence points:** GeoPera reconstruction and public witness records as packaged by gods-eye-view, **CC BY-NC 4.0, non-commercial use only**.
- **Data:**
  - Copernicus DEM GLO-30 (© ESA/Airbus, free licence)
  - ESA WorldCover (CC BY 4.0)
  - Meta/CIESIN HRSL (CC BY 4.0)
  - WorldPop (CC BY 4.0)
  - OpenStreetMap (ODbL)
  - Open-Meteo / ERA5 (CC BY 4.0)
  - GDACS
  - USGS
  - NDMA Sachet
  - NASA FIRMS
  - OurAirports (public domain)
  - OSRM
  - Esri imagery (display only)
