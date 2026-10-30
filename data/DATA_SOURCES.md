# ARES v4 — data sources

Every file the app loads from `data/` is listed in `manifest.json` with its source URL, licence, attribution,
observation dates, resolution, processing method, SHA-256 checksum, provenance tier and validation status.
Every acquisition and processing step is appended to `processing_log.jsonl`. This document is the human-readable summary.
Pipeline: `data/tools/` (see `data/tools/README.md`). Processing version 0.4.0, built 25 Oct 2026.

## Provenance tiers used in the app

| Tier | Meaning | Examples |
|---|---|---|
| **verified** (shown as "real") | Measured or mapped by an authoritative/open source, used as delivered (resampled only) | Copernicus DEM, Sentinel imagery, WorldCover, OSM roads/rivers/places, CEMS EMSR927 grading |
| **derived** | Computed by this pipeline from verified inputs; not independently validated unless stated | Sentinel-2 change-detection debris masks, Sentinel-1 flood mask, Delhi ground proxy, ML building footprints, descent path |
| **modelled** | Output of a published statistical model or of the ARES model | WorldPop residents, Belief State, coverage, GP estimate |
| **assumption** | A value chosen for the simulation | camera/radio/detection parameters, building heights where unmapped, "need help" figure, 15 % dispersed-population share (estimator only) |
| **synthetic** | Simulated individuals and their detections | survivors, phone beacons, detections; Delhi earthquake damage |

## Area of interest (AOI) per scenario

All rasters are resampled onto a local azimuthal-equidistant grid (`+proj=aeqd +lat_0 +lon_0 +datum=WGS84`) centred on the AOI:
225 × 225 nodes (row 0 = south), 6 km × 6 km (Delhi 2 km × 2 km), plus a 161 × 161 context grid over 5× the AOI for display only.

| Scenario | Centre | Size | Why this AOI | Event time |
|---|---|---|---|---|
| Dehradun cloudburst | 30.366 N, 78.133 E | 6 km | Sahastradhara (Nominatim 30.3853 N 78.1298 E), Maldevta, fresh debris channels in S2 27 Sep 2025 | night of 15–16 Sep 2025 (IST) |
| Wayanad landslides | 11.487 N, 76.150 E | 6 km | Debris-flow scar mapped from S2 (5 Feb vs 16 Dec 2024): source zone, Mundakkai, Chooralmala | 30 Jul 2024, 02:17 and ~04:10 IST |
| Assam — Kuruwa breach | 26.258 N, 91.828 E | 6 km | Kurua village (OSM 26.2376 N 91.8206 E, Sipajhar, Darrang); flooded floodplain in S1 30 Jun 2022. Breach point itself not mapped — shown as a ±1.5 km zone | June 2022 (exact breach date not verified) |
| Delhi-NCR earthquake | 28.670 N, 77.278 E | 2 km | Seelampur–Shahdara, East Delhi; unchanged from v3 | **Hypothetical** |
| Nepal (Rasuwa) flood | 28.265 N, 85.372 E | 6 km | Bhotekoshi valley, Rasuwagadhi confluence to Timure; overlaps CEMS EMSR927 AOI02 | 26 Aug 2026, 08:37 NPT (USGS signal time) |

## Datasets integrated

| Layer | Source | Access | Native res. | Dates | Licence / attribution | Tier |
|---|---|---|---|---|---|---|
| Elevation | Copernicus DEM GLO-30 (DSM, EGM2008 heights), ESA/Airbus | AWS Open Data COGs `copernicus-dem-30m` | ~30 m (1 arc-s) | 2011–2015 acquisitions | Copernicus DEM licence, attribution "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA" | verified (Delhi: derived ground proxy) |
| Land cover | ESA WorldCover 10 m 2021 v200 | AWS `esa-worldcover` COGs, mode resampling | 10 m | 2021 | CC BY 4.0, "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021)" | verified |
| Optical imagery | Copernicus Sentinel-2 L2A TCI | Earth Search STAC (Element 84) → AWS `sentinel-cogs`; scene chosen by SCL cloud/valid score over the AOI | 10 m | see table below | Copernicus Sentinel data terms; "Contains modified Copernicus Sentinel data [year]" | verified |
| Radar imagery (Assam) | Copernicus Sentinel-1 RTC γ0 VV | Microsoft Planetary Computer STAC (SAS-signed) | 10 m | 6 Feb 2022, 30 Jun 2022 | Copernicus terms; RTC processing CC BY 4.0 | verified |
| Surface-water history (Assam) | JRC Global Surface Water v1.4 occurrence 1984–2021 | Google Cloud Storage tiles | 30 m | 1984–2021 | Copernicus/JRC open data | verified (used as a filter) |
| Roads, rivers, water, places, landuse, bridges, some buildings | OpenStreetMap | API 0.6 `/map` with recursive tiling (bbox in manifest) | vector | retrieved 25 Oct 2026 | ODbL 1.0, "© OpenStreetMap contributors" | verified |
| Building footprints | Google Open Buildings v3 (confidence ≥ 0.70) + OSM | GCS CSV per S2 cell, stream-filtered to AOI | vector | imagery ~2014–2023 | CC BY 4.0 / ODbL dual | derived |
| Residents | WorldPop 2020 constrained, top-down (IND / NPL, persons per pixel) | WorldPop data hub, SHA256SUMS checked | ~100 m | 2020 | CC BY 4.0, "WorldPop (www.worldpop.org)" | modelled |
| Observed debris / scour (Dehradun, Wayanad, Nepal) | Derived: Sentinel-2 L2A NDVI change + brightness, constrained to D8 drainage (Copernicus DEM) and OSM waterways, components ≥ 8 cells, invalid/cloud pixels dilated out | this pipeline | 10 m → 26.8 m grid | pre/post pairs below | derived from Copernicus data | derived |
| Observed inundation (Assam) | Derived: S1 VV < −18 dB on 30 Jun 2022 and not on 6 Feb 2022, JRC occurrence < 20 %, morphological opening | this pipeline | 10 m → 26.8 m grid | 6 Feb / 30 Jun 2022 | derived | derived |
| Flood/mass-movement delineation and damage grading (Nepal) | Copernicus EMS Rapid Mapping **EMSR927**, AOI02 "Timure", grading product v2 (photo-interpretation of Legion VHR, 27 Aug 2026; delivered 28 Aug 2026) | CEMS dashboard API + product ZIP (SHA-256 `1f57ba33…db8`) | VHR | 27 Aug 2026 | Copernicus EMS, free and open, "© European Union, Copernicus Emergency Management Service (EMSR927)" | verified |
| Sun position | `view:sun_azimuth/elevation` of the Sentinel-2 items | STAC metadata | — | per scene | — | verified (display lighting) |
| Place geocodes | Nominatim (OSM) | single queries, cached in `_raw/geocode/nominatim.json` | — | 25 Oct 2026 | ODbL | verified (AOI selection only) |

### Imagery dates and their gap to the event

| Scenario | Pre-event | Post-event | Gap after event | Note |
|---|---|---|---|---|
| Dehradun | S2B 25 Oct 2024 | S2A 27 Sep 2025 | +12 days | pre scene ~11 months earlier (cloud-free) |
| Wayanad | S2B 5 Feb 2024 | S2A 16 Dec 2024 | +139 days | monsoon cloud: first clear post scene; vegetation regrowth possible |
| Assam | S2A 7 Mar 2022 (optical) / S1A 6 Feb 2022 (radar) | S1A 30 Jun 2022 (radar) | ~2 weeks after mid-June | no cloud-free optical post scene; flood shown with radar |
| Delhi | — | S2B 17 Feb 2026 ("recent") | n/a | hypothetical scenario |
| Nepal | S2B 21 Oct 2025 | S2C 1 Oct 2026 | +36 days | 1.6 % cloud/shadow in AOI (dilated out of the mask) |

## Reported facts (event figures)

Event figures are stored as one record per source, metric and date in `js/core.js` (`FACTS`), never merged.
The app shows, per metric and scope, the latest record from the most authoritative tier
(official map product > official / humanitarian citing official > media citing an agency > media > secondary),
and keeps the older and conflicting values visible (Sources tab, Model & sources page, exports). Conflicts preserved include:
Wayanad deaths (231 first-week vs 254 / 420 in different parts of Wikipedia), Wayanad missing (118 vs 47),
the month of the Rongamati–Kuruwa breach (June vs July 2022), Nepal deaths/missing across NDRRMA and Nepal Police ledgers
(579 → 903 → ≥1,455 → 1,457), and the Nepal trigger (CEMS: GLOF "reportedly"; EarthSky citing USGS: glacier collapse / landslide).

## Sources investigated but not used

| Source | Result (checked from the build environment) | Fallback |
|---|---|---|
| Overpass API (`overpass-api.de`) | No connection (curl status 000, 25 Oct 2026) | OSM API 0.6 `/map` with recursive bbox tiling |
| Geofabrik extracts | No connection (status 000) | OSM API |
| Census of India (`censusindia.gov.in`) | No connection (status 000) | WorldPop 2020 constrained (modelled residents) |
| India Meteorological Department (`mausam.imd.gov.in`) | No connection (status 000) | rainfall only as a reported fact (Wayanad, source as cited) |
| Copernicus EMS Rapid Mapping | Reachable. Public activation list (268 activations, 2023–2026) has **no activation in India**; EMSR927 (Nepal) used. Assam 2022 predates the list | pipeline-derived masks for India |
| International Charter / NRSC value-added products | PDF map (Charter 1029, Wayanad) cited as a fact source; not georeferenced vector data | S2-derived scar mask |
| Microsoft Global ML Building Footprints | Reachable; tiles tested in an earlier build were mis-located (Assam) or sparse (Delhi) | Google Open Buildings v3 |
| USGS event pages | Reachable; signal time used only via the cited EarthSky article | — |

## What is not real

- Individual survivors, their positions, phones and every detection are **synthetic**.
- The number of people "needing help" per scenario is an **assumption** used to scale the Belief State.
- The Delhi earthquake, its damage zone and collapsed buildings are **hypothetical**.
- Camera, radio, link-budget and detection parameters are **assumptions** (aerostat transmit power to be confirmed).
- The thermal camera is **assumed** to resolve 2,560 effective pixels across its field of view (for example a 1,280-pixel sensor stepping a 2 × 2 pattern on a gimbal; the time to revisit each tile is not modelled). Detection falls with distance by the Johnson criteria with a 0.75 m person and 0.75 cycles for 50 % detection. Per-scenario hover height, lens and coverage rule were tuned in simulation to keep each fleet under 30.
- Building heights are mapped only where OSM or the ML product provides them; otherwise **assumed** (3.5–6.7 m; Delhi 3–6 floors).
- Trees and aerostat models are symbolic 3D representations, not mapped individual objects.
