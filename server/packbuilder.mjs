/* Builds a real-data pack for ANY point in India (or Nepal) in the same format as the five scenario packs, so the same model runs on it.
   Terrain: Copernicus DEM GLO-30 · Land cover: ESA WorldCover 2021 · People: Meta/CIESIN HRSL v1.5 · Features: OpenStreetMap (Overpass).
   Hazard: operator-drawn affected area(s) if given, otherwise a MODELLED prior from terrain (height above nearest drainage) — clearly labelled. */
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import { fileURLToPath } from 'url';
import { sampleGrid, sumCells } from './feeds/rasters.mjs'; import { osmArea } from './feeds/osm.mjs';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), PACKS = path.join(ROOT, 'data/packs');
const b64 = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');

export async function buildPack({ lat, lon, hazard = 'flood', eventTime, name, zones = [], S = 6000, G = 225, people = null, incident = null, log = () => {} }) {
  const id = 'live-' + crypto.createHash('sha1').update([lat.toFixed(4), lon.toFixed(4), hazard, eventTime || '', JSON.stringify(zones)].join('|')).digest('hex').slice(0, 10);
  const dir = path.join(PACKS, id); if (fs.existsSync(path.join(dir, 'scenario.json'))) return JSON.parse(fs.readFileSync(path.join(dir, 'scenario.json'), 'utf8'));
  const t0 = Date.now(), prov = [];
  log('Terrain (Copernicus DEM)…'); const dem = await sampleGrid('dem', lat, lon, S, G, 'bilinear'); prov.push({ layer: 'dem', source: dem.source });
  const ctx = await sampleGrid('dem', lat, lon, S * 5, 161, 'bilinear');
  log('Land cover (ESA WorldCover)…'); const lc = await sampleGrid('worldcover', lat, lon, S, G, 'nearest'), lcx = await sampleGrid('worldcover', lat, lon, S * 5, 161, 'nearest'); prov.push({ layer: 'landcover', source: lc.source });
  log('Population (Meta HRSL)…'); const CB = 40, pop = await sumCells('hrsl', lat, lon, S, CB); prov.push({ layer: 'population', source: pop.source, total: Math.round(pop.total) });
  log('OpenStreetMap features…'); const osm = await osmArea(lat, lon, S, { date: eventTime && new Date(eventTime) < Date.now() - 864e5 ? eventTime : null }); prov.push({ layer: 'osm', source: osm.source, counts: { roads: osm.roads.length, buildings: osm.buildings.length, places: osm.places.length } });
  for (const k of ['dem']) for (let i = 0; i < dem.data.length; i++) if (!isFinite(dem.data[i])) dem.data[i] = 0;
  // ---- hazard mask
  const mask = new Uint8Array(G * G), h = S / 2, cell = S / (G - 1), kx = 111320 * Math.cos(lat * Math.PI / 180);
  const toXY = ([la, lo]) => [(lo - lon) * kx, (la - lat) * 111320];
  const affected = zones.filter(z => z.kind === 'affected').map(z => z.ll.map(toXY)); let hazSrc;
  if (affected.length) { hazSrc = 'Operator-drawn affected area'; for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const x = -h + i * cell, y = -h + j * cell; if (affected.some(P => inPoly(x, y, P))) mask[j * G + i] = 1; } }
  else { hazSrc = hazard === 'quake' ? 'None (earthquake: damage from distance to epicentre)' : 'MODELLED prior from terrain (height above nearest drainage) — replace with an observed map when available'; if (hazard !== 'quake') handPrior(dem.data, lc.data, G, cell, hazard, mask); }
  for (let k = 0; k < G * G; k++) if (lc.data[k] === 80) mask[k] = hazard === 'flood' ? mask[k] : 0;
  // ---- people per belief cell and per grid node (display)
  const popB = pop.cells, popG = new Float32Array(G * G), cs = S / CB, per = new Float32Array(CB * CB);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const c = Math.min(CB - 1, Math.floor((j * cell) / cs)) * CB + Math.min(CB - 1, Math.floor((i * cell) / cs)); per[c]++; }
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const c = Math.min(CB - 1, Math.floor((j * cell) / cs)) * CB + Math.min(CB - 1, Math.floor((i * cell) / cs)); popG[j * G + i] = popB[c] / per[c]; }
  // exposed residents → people needing assistance (ASSUMPTION: 10 % unless reports say otherwise)
  let exposed = 0; const near = dilate(mask, G, Math.ceil(150 / cell)); for (let c = 0; c < CB * CB; c++) { const ci = c % CB, cj = (c / CB) | 0, k = Math.min(G - 1, Math.round(((cj + 0.5) * cs) / cell)) * G + Math.min(G - 1, Math.round(((ci + 0.5) * cs) / cell)); if (near[k] || hazard === 'quake') exposed += popB[c]; }
  const need = people != null ? people : Math.max(25, Math.min(1500, Math.round(0.1 * (hazard === 'quake' ? exposed * 0.3 : exposed))));
  const built = lc.data.reduce((a, v) => a + (v === 50 ? 1 : 0), 0) / (G * G);
  const env = built > 0.5 ? 'dense' : built > 0.2 ? 'urban' : 'suburban';
  const incXY = incident ? toXY([incident.lat, incident.lon]) : null;
  const aoi = { id, lat, lon, S, G, ctx_n: 161, ctx_f: 5.0, belief: CB, crs: `+proj=aeqd +lat_0=${lat} +lon_0=${lon} +datum=WGS84 +units=m +no_defs`, event: eventTime || new Date().toISOString(), hazard: hazard === 'quake' ? 'quake' : hazard === 'flood' ? 'flood' : 'debris', hazardSource: hazSrc, icp_hint: [0, -S * 0.38], processing_version: 'v8-live-0.1', built: new Date().toISOString(), provenance: prov };
  fs.mkdirSync(dir, { recursive: true }); for (const d of ['metadata', 'terrain', 'landcover', 'hazard', 'population', 'vectors']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata/aoi.json'), JSON.stringify(aoi, null, 1));
  fs.writeFileSync(path.join(dir, 'terrain/dem.f32.b64.txt'), b64(dem.data)); fs.writeFileSync(path.join(dir, 'terrain/dem_context.f32.b64.txt'), b64(ctx.data));
  fs.writeFileSync(path.join(dir, 'landcover/worldcover.u8.b64.txt'), b64(Uint8Array.from(lc.data))); fs.writeFileSync(path.join(dir, 'landcover/worldcover_context.u8.b64.txt'), b64(Uint8Array.from(lcx.data)));
  fs.writeFileSync(path.join(dir, 'hazard/observed_mask.u8.b64.txt'), b64(mask)); if (aoi.hazard === 'flood') { fs.writeFileSync(path.join(dir, 'hazard/water_pre.u8.b64.txt'), b64(Uint8Array.from(lc.data, v => v === 80 ? 1 : 0))); fs.writeFileSync(path.join(dir, 'hazard/water_post.u8.b64.txt'), b64(mask)); fs.writeFileSync(path.join(dir, 'hazard/jrc_occurrence.u8.b64.txt'), b64(new Uint8Array(G * G))); }
  fs.writeFileSync(path.join(dir, 'population/worldpop_belief.f32.b64.txt'), b64(popB)); fs.writeFileSync(path.join(dir, 'population/worldpop_grid.f32.b64.txt'), b64(popG)); fs.writeFileSync(path.join(dir, 'population/hrsl_belief.f32.b64.txt'), b64(popB));
  const { amenities, aeroway, unavailable, errors, source, fetchedAt, ...osmPack } = osm; fs.writeFileSync(path.join(dir, 'vectors/osm.json'), JSON.stringify(osmPack));
  const sc = { id, tab: name || 'Live', name: name || `Live incident ${lat.toFixed(3)}, ${lon.toFixed(3)}`, code: id.toUpperCase(), place: name || '', lat, lon, S, vexReal: 1.2, env, type: hazard, start: eventTime || null,
    sources: [], cond: { rain: 'from feeds', wind: 15, water: '', vis: '', temp: 25 }, fleet: { h: 200, fov: 110, k: 1, target: 0.9 }, people: need, devFrac: 0.6, maxSlope: 0.45, teamKmh: 5, occ: 5, Kmax: 26,
    live: true, epi: hazard === 'quake' ? (incXY || [0, 0]) : undefined, incidentXY: incXY || undefined, peopleBasis: people != null ? 'operator' : `ASSUMPTION: 10 % of ${Math.round(exposed)} exposed residents (HRSL) need assistance`, osmUnavailable: !!unavailable, osmErrors: errors || null, hazardSource: hazSrc, builtMs: Date.now() - t0, airfields: aeroway || [] };
  fs.writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(sc, null, 1));
  log(`Pack ${id} built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return sc;
}
function inPoly(x, y, P) { let ins = false; for (let a = 0, b = P.length - 1; a < P.length; b = a++) { const [xi, yi] = P[a], [xj, yj] = P[b]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins; } return ins; }
function dilate(m, G, it) { let a = m; for (let t = 0; t < it; t++) { const o = new Uint8Array(G * G); for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const k = j * G + i; o[k] = a[k] || (i > 0 && a[k - 1]) || (i < G - 1 && a[k + 1]) || (j > 0 && a[k - G]) || (j < G - 1 && a[k + G]) ? 1 : 0; } a = o; } return a; }
/* priority-flood fill + D8 + flow accumulation → height above nearest drainage (HAND). flood: HAND ≤ 3 m; debris/flash flood: channels ≥ 1 km² and HAND ≤ 6 m */
function handPrior(z0, lc, G, cell, hazard, mask) {
  const n = G * G, z = Float64Array.from(z0), done = new Uint8Array(n), heap = [];
  const push = (k, v) => { heap.push([v, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const t = heap[0], l = heap.pop(); if (heap.length) { heap[0] = l; let i = 0; for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return t; };
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) if (!i || !j || i === G - 1 || j === G - 1) { const k = j * G + i; done[k] = 1; push(k, z[k]); }
  while (heap.length) { const [v, k] = pop(), i = k % G, j = (k / G) | 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if ((!di && !dj) || a < 0 || b < 0 || a >= G || b >= G) continue; const q = b * G + a; if (done[q]) continue; done[q] = 1; z[q] = Math.max(z[q], v + 1e-3); push(q, z[q]); } }
  const rcv = new Int32Array(n).fill(-1); for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const k = j * G + i; let best = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if ((!di && !dj) || a < 0 || b < 0 || a >= G || b >= G) continue; const q = b * G + a, s = (z[k] - z[q]) / (di && dj ? 1.4142 : 1); if (s > best) { best = s; rcv[k] = q; } } }
  const ord = Array.from({ length: n }, (_, k) => k).sort((a, b) => z[b] - z[a]), acc = new Float64Array(n).fill(cell * cell);
  for (const k of ord) if (rcv[k] >= 0) acc[rcv[k]] += acc[k];
  const thr = hazard === 'flood' ? 0.5e6 : 1e6, stream = k => acc[k] >= thr || lc[k] === 80, hand = new Float32Array(n);
  for (let k = 0; k < n; k++) { let q = k, s = 0; while (!stream(q) && rcv[q] >= 0 && s++ < 400) q = rcv[q]; hand[k] = z0[k] - z0[q]; }
  for (let k = 0; k < n; k++) { const lim = hazard === 'flood' ? 3 : 6; if (hand[k] <= lim && (hazard === 'flood' || acc[k] >= thr * 0.2 || hand[k] <= 2)) mask[k] = 1; }
}
