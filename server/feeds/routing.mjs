/* Stage 8 input — road routing from the command post to each launch site (OSRM, as in gods-eye-view's Directions tool).
   OSRM knows the road network but not today's damage, so every route is checked against the hazard map; a route that runs through
   mapped debris / flood water is marked cut and the planner falls back to its hazard-aware terrain route. */
import { cachedFetch } from '../http.mjs';
const OSRM = process.env.OSRM_URL || 'https://router.project-osrm.org';

export async function routesFrom(from, targets, { hazardTest, concurrency = 3 } = {}) {
  const out = {}, errors = []; let i = 0;
  async function worker() { while (i < targets.length) { const t = targets[i++];
    const url = `${OSRM}/route/v1/driving/${from.lon.toFixed(6)},${from.lat.toFixed(6)};${t.lon.toFixed(6)},${t.lat.toFixed(6)}?overview=full&geometries=geojson&steps=false`;
    try { const r = await cachedFetch('osrm', url, { ttlMs: 7 * 864e5, timeoutMs: 20e3 }); const rt = r.data.routes && r.data.routes[0];
      if (!rt) { out[t.key] = { ok: false, reason: r.data.code }; continue; }
      const coords = rt.geometry.coordinates, snapEnd = r.data.waypoints ? r.data.waypoints[1].distance : 0, snapStart = r.data.waypoints ? r.data.waypoints[0].distance : 0;
      let cut = 0; if (hazardTest) for (let k = 0; k < coords.length; k++) if (hazardTest(coords[k][1], coords[k][0])) cut++;
      out[t.key] = { ok: true, durationS: rt.duration, distanceM: rt.distance, snapEndM: snapEnd, snapStartM: snapStart, crossesHazard: cut >= 2, hazardPoints: cut, geometry: coords.length > 200 ? coords.filter((_, k) => k % Math.ceil(coords.length / 200) === 0) : coords };
    } catch (e) { errors.push(e.message); out[t.key] = { ok: false, reason: e.message }; } } }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { source: 'OSRM (OpenStreetMap road network)', server: OSRM, routes: out, errors: [...new Set(errors)] };
}
