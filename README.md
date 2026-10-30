# ARES Response Console

3D disaster-response simulation for ARES (tethered aerostats with cameras and radios). Covers five scenarios: Dehradun cloudburst, Wayanad landslides, Assam flood, Delhi-NCR earthquake (hypothetical) and Nepal flood. Each runs on real terrain, satellite imagery, buildings and population, through an 11-stage pipeline:

1. Detect
2. Damage
3. Belief State
4. Search effort
5. Launch sites
6. Coverage
7. Placement
8. Deployment
9. Sensing
10. Update and replanning
11. Handover

## Run
Serve the folder over HTTP. The data is loaded with `fetch`, so opening the file directly won't work.

    python3 -m http.server 8000
    # open http://localhost:8000

## Data
`data/` holds the real-data packs for the five scenarios. Sources, licences and validation are in `data/DATA_SOURCES.md` and `data/validation_report.md`.
