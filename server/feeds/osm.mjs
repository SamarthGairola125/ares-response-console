/* OpenStreetMap features for a new area via Overpass (as gods-eye-view's OSM Places layer does), converted to the pack's osm.json format.
   Several public mirrors are tried in turn; set OVERPASS_URLS to use your own. */
import { cachedFetch } from '../http.mjs';
const MIRRORS = (process.env.OVERPASS_URLS || 'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass.private.coffee/api/interpreter').split(',');
const RCLS = { motorway: 1, trunk: 1, primary: 1, motorway_link: 1, trunk_link: 1, primary_link: 1, secondary: 2, tertiary: 2, secondary_link: 2, tertiary_link: 2, unclassified: 3, residential: 3, living_street: 3, road: 3, service: 4, track: 4 };

export async function osmArea(lat0, lon0, S, { date } = {}) {
  const h = S / 2, dla = h / 111320, dlo = h / (111320 * Math.cos(lat0 * Math.PI / 180)), bb = `${(lat0 - dla).toFixed(5)},${(lon0 - dlo).toFixed(5)},${(lat0 + dla).toFixed(5)},${(lon0 + dlo).toFixed(5)}`;
  const q = `[out:json][timeout:90]${date ? `[date:"${new Date(date).toISOString().slice(0, 19)}Z"]` : ''};(way["highway"](${bb});way["waterway"](${bb});way["natural"="water"](${bb});way["water"](${bb});way["building"](${bb});node["place"](${bb});way["landuse"](${bb});way["leisure"~"park|pitch|playground"](${bb});node["aeroway"~"aerodrome|helipad|heliport"](${bb});way["aeroway"~"aerodrome|helipad|heliport"](${bb});node["amenity"~"hospital|clinic|school|college|university|kindergarten"](${bb}););out geom;`;
  const errors = [];
  for (const url of MIRRORS) {
    try { const r = await cachedFetch('overpass', url, { body: 'data=' + encodeURIComponent(q), ttlMs: 7 * 864e5, timeoutMs: +process.env.OVERPASS_TIMEOUT_MS || 45e3 }); return Object.assign(convert(r.data, lat0, lon0), { source: 'OpenStreetMap via Overpass (' + new URL(url).host + ')', fetchedAt: r.fetchedAt }); }
    catch (e) { errors.push(new URL(url).host + ': ' + e.message); }
  }
  return { roads: [], waterways: [], water: [], buildings: [], places: [], landuse: [], bridges: [], aeroway: [], amenities: [], unavailable: true, errors, source: 'OpenStreetMap (unreachable: ' + errors.join('; ') + ')' };
}
function convert(d, lat0, lon0) {
  const k = 111320 * Math.cos(lat0 * Math.PI / 180), xy = g => g.map(p => [+((p.lon - lon0) * k).toFixed(1), +((p.lat - lat0) * 111320).toFixed(1)]);
  const o = { roads: [], waterways: [], water: [], buildings: [], places: [], landuse: [], bridges: [], aeroway: [], amenities: [] };
  for (const e of d.elements || []) { const t = e.tags || {};
    if (e.type === 'node') { const [x, y] = [+((e.lon - lon0) * k).toFixed(1), +((e.lat - lat0) * 111320).toFixed(1)];
      if (t.place) o.places.push({ id: String(e.id), name: t['name:en'] || t.name || '', name_local: t.name || '', kind: t.place, x, y });
      if (t.aeroway) o.aeroway.push({ id: String(e.id), kind: t.aeroway, name: t.name || '', x, y, lat: e.lat, lon: e.lon });
      if (t.amenity) o.amenities.push({ id: String(e.id), kind: t.amenity, name: t.name || '', x, y });
      continue; }
    if (!e.geometry) continue; const pts = xy(e.geometry);
    if (t.highway && RCLS[t.highway] != null || (t.highway && /path|footway|steps|bridleway|cycleway|pedestrian/.test(t.highway))) o.roads.push({ id: String(e.id), cls: RCLS[t.highway] ?? 5, hw: t.highway, name: t.name || '', bridge: t.bridge === 'yes', surface: t.surface || '', pts });
    else if (t.waterway) o.waterways.push({ id: String(e.id), kind: t.waterway, name: t['name:en'] || t.name || '', name_local: t.name || '', pts });
    else if (t.natural === 'water' || t.water) o.water.push({ id: String(e.id), kind: t.water || 'water', name: t.name || '', pts, partial: pts.length < 4 || pts[0][0] !== pts[pts.length - 1][0] });
    else if (t.building) o.buildings.push({ id: 'w' + e.id, src: 'osm', type: t.amenity && /hospital|clinic|school|college|university|kindergarten/.test(t.amenity) ? t.amenity : t.building, levels: t['building:levels'] ? +t['building:levels'] || null : null, height: t.height ? parseFloat(t.height) || null : null, pts });
    else if (t.landuse || t.leisure) o.landuse.push({ id: String(e.id), kind: t.leisure || t.landuse, pts });
    else if (t.aeroway) { const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]); o.aeroway.push({ id: String(e.id), kind: t.aeroway, name: t.name || '', x: c[0], y: c[1] }); }
  }
  // amenity nodes inside a building footprint tag that building (facility priority in stage 3)
  for (const a of o.amenities) for (const b of o.buildings) { if (b.type !== 'yes') continue; let ins = false; const P = b.pts; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if (((yi > a.y) !== (yj > a.y)) && (a.x < (xj - xi) * (a.y - yi) / (yj - yi) + xi)) ins = !ins; } if (ins) { b.type = a.kind; break; } }
  return o;
}
