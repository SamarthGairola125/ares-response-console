/* ARES — real-data packs (data/<scenario>/...) built by data/tools/build_pack.py.
   Loads the processed layers and turns them into the same {T, M} structures the 11-step model consumes.
   Provenance is tracked per layer (A.pack.layers) so the UI can say exactly what is real, derived, modelled or assumed. */
(function (A) {
'use strict';
const C = A.core, { CLS, clamp, mulberry32, gauss } = C;
const PK = A.pack = { base: 'data/', manifest: null, cache: {} };

async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(u + ' → HTTP ' + r.status); return r.json(); }
// rasters are loaded from base64 text twins (<file>.b64.txt, written by data/tools/encode_b64.py) because the artifact host serves only standard web types
async function getBin(u, kind) { const r = await fetch(u + '.b64.txt'); if (!r.ok) throw new Error(u + ' → HTTP ' + r.status); const t = (await r.text()).trim(), bin = atob(t), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return kind === 'f32' ? new Float32Array(a.buffer) : a; }
async function opt(p) { try { return await p; } catch (e) { return null; } }

PK.loadManifest = async function () { if (!PK.manifest) PK.manifest = await opt(getJSON(PK.base + 'manifest.json')); return PK.manifest; };
PK.records = sid => ((PK.manifest && PK.manifest.datasets) || []).filter(d => d.scenario_id === sid);
PK.record = (sid, layer) => ((PK.manifest && PK.manifest.datasets) || []).find(d => d.dataset_id === sid + '.' + layer) || null;

PK.load = async function (sid) {
  if (PK.cache[sid]) return PK.cache[sid];
  await PK.loadManifest();
  const b = PK.base + sid + '/', aoi = await getJSON(b + 'metadata/aoi.json');
  const [dem, ctxDem, lc, lcCtx, mask, popB, popG, osm, wPre, wPost, jrc] = await Promise.all([
    getBin(b + 'terrain/dem.f32', 'f32'), getBin(b + 'terrain/dem_context.f32', 'f32'), getBin(b + 'landcover/worldcover.u8'), getBin(b + 'landcover/worldcover_context.u8'),
    aoi.hazard !== 'quake' ? opt(getBin(b + 'hazard/observed_mask.u8')) : null, getBin(b + 'population/worldpop_belief.f32', 'f32'), getBin(b + 'population/worldpop_grid.f32', 'f32'), getJSON(b + 'vectors/osm.json'),
    ...(aoi.hazard === 'flood' ? [opt(getBin(b + 'hazard/water_pre.u8')), opt(getBin(b + 'hazard/water_post.u8')), opt(getBin(b + 'hazard/jrc_occurrence.u8'))] : [null, null, null])]);
  if (dem.length !== aoi.G * aoi.G) throw new Error('DEM size mismatch');
  const [cems, cemsVec] = aoi.cems ? await Promise.all([opt(getBin(b + 'hazard/cems_event.u8')), opt(getJSON(b + 'vectors/cems.json'))]) : [null, null];
  const img = { pre: aoi.s2_pre ? b + 'imagery/s2_pre.jpg' : null, post: aoi.s2_post ? b + 'imagery/s2_post.jpg' : null, ctx: b + 'imagery/context.jpg' };
  const P = { sid, aoi, dem, ctxDem, lc, lcCtx, mask, popB, popG, osm, wPre, wPost, jrc, img, cems, cemsVec };
  PK.cache[sid] = P; return P;
};

/* ---------- helpers ---------- */
const WC = { 10: CLS.FOREST, 20: CLS.OPEN, 30: CLS.OPEN, 40: CLS.FARM, 50: CLS.SETTLE, 60: CLS.OPEN, 70: CLS.SNOW, 80: CLS.WATER, 90: CLS.OPEN, 95: CLS.FOREST, 100: CLS.OPEN };
PK.WC_NAME = { 10: 'Tree cover', 20: 'Shrubland', 30: 'Grassland', 40: 'Cropland', 50: 'Built-up', 60: 'Bare / sparse', 70: 'Snow / ice', 80: 'Permanent water', 90: 'Herbaceous wetland', 95: 'Mangroves', 100: 'Moss / lichen' };
function dilate(m, G, it) { let a = m; for (let t = 0; t < it; t++) { const o = new Uint8Array(G * G); for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const k = j * G + i; if (a[k]) { o[k] = 1; continue; } if ((i > 0 && a[k - 1]) || (i < G - 1 && a[k + 1]) || (j > 0 && a[k - G]) || (j < G - 1 && a[k + G])) o[k] = 1; } a = o; } return a; }
PK.dilate = dilate;
function stampLine(T, pts, radius, fn) { // visit grid nodes within `radius` of a polyline (efficient: walks the segments)
  const G = T.G, c = T.cell, h = T.S / 2, rr = Math.ceil(radius / c) + 1, seen = new Uint8Array(G * G);
  for (let s = 0; s < pts.length - 1; s++) {
    const [ax, ay] = pts[s], [bx, by] = pts[s + 1], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / (c * 0.5)));
    for (let t = 0; t <= n; t++) {
      const x = ax + (bx - ax) * t / n, y = ay + (by - ay) * t / n, ci = Math.round((x + h) / c), cj = Math.round((y + h) / c);
      for (let j = cj - rr; j <= cj + rr; j++) for (let i = ci - rr; i <= ci + rr; i++) {
        if (i < 0 || j < 0 || i >= G || j >= G) continue; const k = j * G + i; if (seen[k]) continue;
        const px = -h + i * c, py = -h + j * c; if (C.distPL(px, py, [pts[s], pts[s + 1]]).d <= radius) { seen[k] = 1; fn(k); }
      }
    }
  }
}
function fillPoly(T, P, fn) {
  const G = T.G, c = T.cell, h = T.S / 2; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const [x, y] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  for (let j = Math.max(0, Math.floor((y0 + h) / c)); j <= Math.min(G - 1, Math.ceil((y1 + h) / c)); j++) for (let i = Math.max(0, Math.floor((x0 + h) / c)); i <= Math.min(G - 1, Math.ceil((x1 + h) / c)); i++) {
    const x = -h + i * c, y = -h + j * c; let ins = false; for (let a = 0, b = P.length - 1; a < P.length; b = a++) { const [xi, yi] = P[a], [xj, yj] = P[b]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins; } if (ins) fn(j * G + i);
  }
}
function obox(P) { // oriented box from a footprint polygon: centroid, longest-edge orientation, extents
  const n = P.length - (P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1] ? 1 : 0); let cx = 0, cy = 0, A2 = 0, ang = 0, best = 0;
  for (let i = 0; i < n; i++) { const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % n], cr = x0 * y1 - x1 * y0; A2 += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr; const L = Math.hypot(x1 - x0, y1 - y0); if (L > best) { best = L; ang = Math.atan2(y1 - y0, x1 - x0); } }
  if (Math.abs(A2) < 1e-6) { cx = P[0][0]; cy = P[0][1]; } else { cx /= 3 * A2; cy /= 3 * A2; }
  const ca = Math.cos(ang), sa = Math.sin(ang); let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (let i = 0; i < n; i++) { const dx = P[i][0] - cx, dy = P[i][1] - cy, u = dx * ca + dy * sa, v = -dx * sa + dy * ca; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  return { x: cx + ((u0 + u1) / 2) * ca - ((v0 + v1) / 2) * sa, y: cy + ((u0 + u1) / 2) * sa + ((v0 + v1) / 2) * ca, w: Math.max(3, u1 - u0), d: Math.max(3, v1 - v0), rot: ang, area: Math.abs(A2) / 2 };
}
function hash01(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; }
const NONRES = new Set(['commercial', 'industrial', 'retail', 'office', 'warehouse', 'school', 'hospital', 'college', 'university', 'temple', 'mosque', 'church', 'religious', 'public', 'government', 'garage', 'garages', 'shed', 'roof', 'hotel', 'train_station', 'transportation', 'construction', 'kiosk', 'service', 'civic', 'stadium']);

/* D8 on a depression-filled DEM, used to trace the downslope path of steepest descent (geometry only) */
function fillD8(T) {
  const G = T.G, n = G * G, z = Float64Array.from(T.elev), done = new Uint8Array(n), heap = [];
  const push = (k, v) => { heap.push([v, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const t = heap[0], l = heap.pop(); if (heap.length) { heap[0] = l; let i = 0; for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return t; };
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) if (!i || !j || i === G - 1 || j === G - 1) { const k = j * G + i; done[k] = 1; push(k, z[k]); }
  while (heap.length) { const [v, k] = pop(), i = k % G, j = (k / G) | 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if ((!di && !dj) || a < 0 || b < 0 || a >= G || b >= G) continue; const q = b * G + a; if (done[q]) continue; done[q] = 1; z[q] = Math.max(z[q], v + 1e-3); push(q, z[q]); } }
  const rcv = new Int32Array(n).fill(-1);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const k = j * G + i; let best = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if ((!di && !dj) || a < 0 || b < 0 || a >= G || b >= G) continue; const q = b * G + a, s = (z[k] - z[q]) / (di && dj ? 1.4142 : 1); if (s > best) { best = s; rcv[k] = q; } } }
  return rcv;
}

/* ---------- build {T, M} from a pack ---------- */
PK.build = function (sc, P) {
  const a = P.aoi, G = a.G, S = a.S, T = C.makeT(S, G), h = S / 2, R = mulberry32(sc.id.charCodeAt(0) * 131 + 7), L = PK.layers = {};
  T.real = true; T.vex = sc.vexReal || 1; T.bvex = 1;
  // --- elevation (Copernicus GLO-30 DSM); Delhi uses a derived ground proxy to avoid double-counting buildings already in the DSM
  T.elev.set(P.dem); T.dsm = Float32Array.from(P.dem);
  if (sc.id === 'delhi') { const r = 3, e = T.elev, m = new Float32Array(G * G); for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { let mn = 1e9; for (let q = -r; q <= r; q++) for (let p = -r; p <= r; p++) { const ii = clamp(i + p, 0, G - 1), jj = clamp(j + q, 0, G - 1); mn = Math.min(mn, e[jj * G + ii]); } m[j * G + i] = mn; } for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { let s = 0, n = 0; for (let q = -2; q <= 2; q++) for (let p = -2; p <= 2; p++) { const ii = clamp(i + p, 0, G - 1), jj = clamp(j + q, 0, G - 1); s += m[jj * G + ii]; n++; } e[j * G + i] = s / n; } T.elevSrc = 'Ground proxy derived from Copernicus DSM (7×7 minimum, 5×5 mean) — removes most building height already in the surface model'; }
  else T.elevSrc = 'Copernicus DEM GLO-30 (surface model)';
  T.pre.set(T.elev); C.finishSlope(T);
  // --- land cover (ESA WorldCover 2021) -> ARES classes
  for (let k = 0; k < G * G; k++) { const w = P.lc[k]; let c = WC[w] ?? CLS.OPEN; if (w === 60 && T.slope[k] > 0.6) c = CLS.ROCK; T.preCls[k] = c; T.cls[k] = c; }
  T.wc = P.lc;
  const M = { buildings: [], labels: [], clusters: [], dmg: [], maxSlope: sc.maxSlope, pack: P, real: true, hazard: a.hazard };
  // --- water: OSM water polygons and river lines (thin), and for floods the radar water on the event date
  (P.osm.water || []).forEach(w => { if (!w.partial && w.pts.length > 3) fillPoly(T, w.pts, k => { T.cls[k] = T.preCls[k] = CLS.WATER; }); });
  (P.osm.waterways || []).filter(w => w.kind === 'river').forEach(w => stampLine(T, w.pts, T.cell * 0.5, k => { if (T.cls[k] !== CLS.SETTLE) T.cls[k] = T.preCls[k] = CLS.WATER; }));
  // --- observed hazard
  const mask = P.mask ? Uint8Array.from(P.mask) : new Uint8Array(G * G);
  // where an independent Copernicus EMS delineation exists it replaces the pipeline-derived mask inside the CEMS area of interest
  if (P.cems && P.cemsVec) { let rep = 0, cov = 0; for (let k = 0; k < G * G; k++) if (P.cems[k] >= 1) { cov++; const v = P.cems[k] === 2 ? 1 : 0; if (mask[k] !== v) rep++; mask[k] = v; } M.cems = { ...P.cemsVec, grid: P.cems, cells: cov, changed: rep }; M.hazDerived = P.mask; }
  if (a.hazard === 'debris') { M.dmg = [CLS.DEBRIS, CLS.RUBBLE]; for (let k = 0; k < G * G; k++) if (mask[k]) T.cls[k] = CLS.DEBRIS; }
  if (a.hazard === 'flood') { M.flood = true; M.dmg = [CLS.WATER]; M.nearR = 220; for (let k = 0; k < G * G; k++) { if (P.wPre && P.wPre[k]) T.preCls[k] = CLS.WATER; if ((P.wPost && P.wPost[k]) || mask[k]) T.cls[k] = CLS.WATER; } }
  if (a.hazard === 'quake') { M.dmg = [CLS.RUBBLE]; }
  M.hazMask = a.hazard === 'quake' ? null : mask; M.hazNear = dilate(mask, G, Math.ceil(150 / T.cell));
  // --- roads (OSM); roads do not overwrite observed debris/water except mapped bridges
  M.roads = []; M.roadsAll = P.osm.roads || [];
  for (const r of M.roadsAll) { if (r.cls <= 3) M.roads.push(r.pts); const rad = r.cls <= 2 ? T.cell * 0.55 : T.cell * 0.45; stampLine(T, r.pts, rad, k => { if (r.bridge || (T.cls[k] !== CLS.WATER && T.cls[k] !== CLS.DEBRIS)) T.cls[k] = CLS.ROAD; if (T.preCls[k] !== CLS.WATER || r.bridge) T.preCls[k] = CLS.ROAD; }); }
  // --- buildings (OSM + ML footprints), heights by source, occupancy from WorldPop
  const epi = sc.id === 'delhi' ? [180, -160] : null; let nAssumed = 0, nMapped = 0, nML = 0;
  for (const f of P.osm.buildings) {
    if (f.pts.length < 4) continue; const o = obox(f.pts); if (Math.abs(o.x) > h - 8 || Math.abs(o.y) > h - 8) continue;
    let hh, hsrc; const r1 = hash01(String(f.id) + sc.id);
    if (f.height) { hh = f.height; hsrc = f.src === 'osm' ? 'mapped (OSM height)' : 'ML estimate'; nMapped++; }
    else if (f.levels) { hh = f.levels * 3.2; hsrc = 'mapped (OSM levels × 3.2 m)'; nMapped++; }
    else { hh = sc.id === 'delhi' ? (3 + Math.floor(Math.pow(r1, 1.5) * 4)) * 3.2 : 3.5 + r1 * 3.2; hsrc = 'assumed'; nAssumed++; }
    if (f.src !== 'osm') nML++;
    const k = C.idxAt(T, o.x, o.y), base = C.elevAt(T, o.x, o.y), type = f.type || 'yes';
    const b = { x: o.x, y: o.y, w: o.w, d: o.d, rot: o.rot, h: hh, h0: hh, base, src: f.src, hsrc, type, area: o.area, pts: f.pts, occ: 0, collapsed: false, flood: false, town: '' };
    if (a.hazard === 'debris') b.collapsed = !!mask[k];
    if (a.hazard === 'flood') { b.flood = !!(M.hazNear[k] && (mask[k] || countNear(mask, G, k, 2) >= 3)); }
    if (a.hazard === 'quake') { const rr = Math.hypot(o.x - epi[0], o.y - epi[1]); b.collapsed = hash01('c' + f.id) < 0.55 * Math.exp(-((rr / 500) ** 2)) + 0.02; b.dz = rr < 650; }
    if (b.collapsed) b.h = 2.5;
    M.buildings.push(b);
  }
  // CEMS damage grading (photo-interpreted VHR points) overrides the mask-based flags for the buildings it grades
  if (M.cems) { const cb = M.cems.buildings || [], fp = M.buildings, grid = new Map(), key = (x, y) => Math.floor(x / 40) + ',' + Math.floor(y / 40);
    fp.forEach((b, i) => { const kk = key(b.x, b.y); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(i); });
    const inside = (b, x, y) => { const P2 = b.pts; let ins = false; for (let a2 = 0, c2 = P2.length - 1; a2 < P2.length; c2 = a2++) { const [xi, yi] = P2[a2], [xj, yj] = P2[c2]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins; } return ins; };
    let matched = 0, added = 0; const used = new Set();
    for (const q of cb) { let best = -1, bd = 12; const gx = Math.floor(q.x / 40), gy = Math.floor(q.y / 40);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of (grid.get((gx + dx) + ',' + (gy + dy)) || [])) { if (used.has(i)) continue; const b = fp[i]; const dd = inside(b, q.x, q.y) ? 0 : Math.hypot(b.x - q.x, b.y - q.y) - Math.max(b.w, b.d) / 2; if (dd < bd) { bd = dd; best = i; } }
      const grade = q.grade || 'Unknown';
      if (best >= 0) { const b = fp[best]; used.add(best); matched++; b.cems = grade; b.collapsed = grade === 'Destroyed'; b.damaged = grade !== 'Destroyed'; b.h = b.collapsed ? 2.5 : b.h0; }
      else if (Math.abs(q.x) < h - 8 && Math.abs(q.y) < h - 8) { const hh = 3.5 + hash01('cems' + q.x + q.y) * 3.2, nonres = /Non-residential/.test(q.type || '');
        fp.push({ x: q.x, y: q.y, w: 9, d: 9, rot: 0, h: grade === 'Destroyed' ? 2.5 : hh, h0: hh, base: C.elevAt(T, q.x, q.y), src: 'cems', hsrc: 'assumed', type: nonres ? 'commercial' : 'yes', area: 81, pts: [[q.x - 4.5, q.y - 4.5], [q.x + 4.5, q.y - 4.5], [q.x + 4.5, q.y + 4.5], [q.x - 4.5, q.y + 4.5], [q.x - 4.5, q.y - 4.5]], occ: 0, collapsed: grade === 'Destroyed', damaged: grade !== 'Destroyed', flood: false, town: '', cems: grade }); added++; nAssumed++; } }
    M.cems.matched = matched; M.cems.added = added; }
  // occupancy: WorldPop residents per belief cell shared among buildings in that cell by footprint area (non-residential types weighted 0.25)
  const CB = a.belief, cs = S / CB, cellOf = (x, y) => clamp(Math.floor((y + h) / cs), 0, CB - 1) * CB + clamp(Math.floor((x + h) / cs), 0, CB - 1);
  const wsum = new Float64Array(CB * CB); M.buildings.forEach(b => { b.ow = b.area * (NONRES.has(b.type) ? 0.25 : 1); wsum[cellOf(b.x, b.y)] += b.ow; });
  M.buildings.forEach(b => { const c = cellOf(b.x, b.y); b.occ = wsum[c] > 0 ? P.popB[c] * b.ow / wsum[c] : 0; });
  M.popResidual = new Float32Array(CB * CB); let resident = 0; for (let c = 0; c < CB * CB; c++) { resident += P.popB[c]; if (!(wsum[c] > 0)) M.popResidual[c] = P.popB[c]; }
  M.pop = { resident, source: 'WorldPop 2020 constrained (modelled residents)', buildings: M.buildings.length, mapped: nMapped, assumed: nAssumed, ml: nML };
  // --- places & labels (OSM)
  const pr = { city: 0, town: 1, village: 2, suburb: 3, neighbourhood: 4, quarter: 4, hamlet: 5, locality: 6, isolated_dwelling: 7 }; const cap = t => t ? t.replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase()) : t; (P.osm.places || []).forEach(p => { p.name = cap(p.name); }); const places = (P.osm.places || []).filter(p => Math.abs(p.x) < h * 0.95 && Math.abs(p.y) < h * 0.95 && pr[p.kind] != null).sort((p, q) => pr[p.kind] - pr[q.kind]);
  const picked = []; for (const p of places) { if (picked.length >= 9) break; if (picked.some(q => Math.hypot(q.x - p.x, q.y - p.y) < S / 9 || q.name.replace(/\s/g, '').toLowerCase() === p.name.replace(/\s/g, '').toLowerCase())) continue; picked.push(p); }
  M.places = []; places.forEach(p => { if (!M.places.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 350 || q.name.replace(/\s/g, '').toLowerCase() === p.name.replace(/\s/g, '').toLowerCase())) M.places.push(p); });
  picked.forEach(p => M.labels.push({ x: p.x, y: p.y, t: p.name, k: 'town' }));
  const rivNames = {}; (P.osm.waterways || []).filter(w => w.name && (w.kind === 'river')).forEach(w => { const L = C.plLen(w.pts); if (!rivNames[w.name] || L > rivNames[w.name].L) rivNames[w.name] = { L, w }; });
  Object.values(rivNames).slice(0, 3).forEach(({ w }) => { const ins = w.pts.filter(p => Math.abs(p[0]) < h * 0.8 && Math.abs(p[1]) < h * 0.8); if (ins.length) { const q = ins[Math.floor(ins.length * 0.3)]; M.labels.push({ x: q[0], y: q[1], t: w.name, k: 'water' }); } });
  M.rivers = (P.osm.waterways || []).filter(w => C.plLen(w.pts) > 250).map(w => w.pts); M.riverMeta = (P.osm.waterways || []).filter(w => C.plLen(w.pts) > 250);
  // --- incident location (where the event was reported / observed)
  const rcv = fillD8(T); M.rcv = rcv;
  const placeXY = n => { const p = (P.osm.places || []).find(q => q.name === n || q.name_local === n); return p ? [p.x, p.y] : null; };
  // source = highest cell of the largest 8-connected component of the observed scour (small fragments are ignored)
  let src = null; if (a.hazard === 'debris' && mask.some(v => v)) { const lab = new Int32Array(G * G).fill(-1); let bestN = 0, bestComp = -1, nc = 0; const sizes = [];
    for (let k0 = 0; k0 < G * G; k0++) { if (!mask[k0] || lab[k0] >= 0) continue; const st = [k0]; lab[k0] = nc; let n = 0; while (st.length) { const k = st.pop(); n++; const i = k % G, j = (k / G) | 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= G || jj >= G) continue; const q = jj * G + ii; if (mask[q] && lab[q] < 0) { lab[q] = nc; st.push(q); } } } sizes.push(n); if (n > bestN) { bestN = n; bestComp = nc; } nc++; }
    let best = -1e9; for (let k = 0; k < G * G; k++) if (lab[k] === bestComp && T.elev[k] > best) { best = T.elev[k]; src = k; } M.hazComp = { label: lab, main: bestComp, sizes }; }
  if (sc.id === 'dehradun') { const pl = (P.osm.places || []).find(q => q.name === 'Sahastradhara'); if (pl) src = C.idxAt(T, pl.x, pl.y); } // reported location: the descent path starts where the event was reported
  M.srcCell = src;
  if (sc.id === 'dehradun') M.incident = placeXY('Sahastradhara') || [0, 0];
  else if (sc.id === 'assam') M.incident = placeXY('Kurua') || [0, -2300];
  else if (sc.id === 'delhi') { M.incident = epi; M.epi = epi; }
  else if (src != null) M.incident = [-h + (src % G) * T.cell, -h + ((src / G) | 0) * T.cell];
  else M.incident = [0, 0];
  // --- open spaces for launch sites (Delhi: parks and pitches)
  M.parks = (P.osm.landuse || []).filter(l => ['park', 'pitch', 'playground', 'meadow', 'grass'].includes(l.kind)).map(l => { const o = obox(l.pts); return [o.x, o.y]; }).filter(p => Math.abs(p[0]) < h && Math.abs(p[1]) < h);
  // --- candidate launch sites: regular grid + points every 150 m along roads + open spaces (deduplicated on 50 m)
  M.sites = () => { const pts = [], seen = new Set(), add = (x, y) => { const key = Math.round(x / 50) + ',' + Math.round(y / 50); if (seen.has(key)) return; seen.add(key); pts.push([x, y]); };
    const n = 27; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) add(-h + S * (i + 0.5) / n, -h + S * (j + 0.5) / n);
    for (const r of M.roadsAll) { if (r.cls > 3 && sc.id !== 'nepal') continue; const Lr = C.plLen(r.pts); for (let s = 0; s < Lr; s += 150) { const q = C.pointAt(r.pts, s / Lr); add(q.x, q.y); } }
    M.parks.forEach(p => add(p[0], p[1])); return pts.slice(0, 2200); };
  // --- ICP: near the scenario hint, open/road ground, low slope, outside the observed hazard and its 150 m margin
  M.icp = a.icp_hint.slice(); { let best = null, bd = 1e18; C.forEachV(T, (i, j, x, y, k) => { const c = T.cls[k]; if (!(c === CLS.OPEN || c === CLS.ROAD || c === CLS.FARM || c === CLS.SETTLE) || T.slope[k] > 0.25 || M.hazNear[k] || T.cls[k] === CLS.WATER) return; const d = (x - M.icp[0]) ** 2 + (y - M.icp[1]) ** 2 + (c === CLS.ROAD ? 0 : 4e4); if (d < bd) { bd = d; best = [x, y]; } }); if (best) M.icp = best; }
  // --- synthetic survivors (hidden ground truth) are sampled from buildings and hazard geometry — SYNTHETIC REPRESENTATIVES, not real people
  const cum = [], items = []; let tot = 0; M.buildings.forEach(b => { const k = C.idxAt(T, b.x, b.y), f = (b.collapsed || b.flood) ? 4 : b.damaged ? 2.5 : (M.hazNear[k] ? 1.5 : 0.3); const w = (b.occ + 0.05) * f; if (w <= 0) return; tot += w; cum.push(tot); items.push(b); });
  const hazCells = []; for (let k = 0; k < G * G; k++) if (mask[k]) hazCells.push(k);
  const nearRoads = M.roadsAll.filter(r => r.pts.some(p => { const k = C.idxAt(T, p[0], p[1]); return M.hazNear[k]; }));
  M.sample = R2 => { const u = R2();
    if (u < 0.58 && items.length) { let lo = 0, hi = cum.length - 1; const t = R2() * tot; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < t) lo = m + 1; else hi = m; } const b = items[lo], c = Math.cos(b.rot), s = Math.sin(b.rot), du = (R2() - 0.5) * b.w * 0.6, dv = (R2() - 0.5) * b.d * 0.6; return { x: b.x + du * c + dv * s, y: b.y - du * s + dv * c, roofH: b.flood ? b.h : 0, prio: (b.collapsed || b.flood) ? 3 : undefined }; }
    if (u < 0.72 && nearRoads.length) { const r = nearRoads[Math.floor(R2() * nearRoads.length)], q = C.pointAt(r.pts, R2()); return { x: q.x + gauss(R2) * 8, y: q.y + gauss(R2) * 8, prio: 2, tag: 'road' }; }
    if (u < 0.84 && hazCells.length && a.hazard !== 'flood') { const k = hazCells[Math.floor(R2() * hazCells.length)]; return { x: -h + (k % G) * T.cell + (R2() - 0.5) * T.cell, y: -h + ((k / G) | 0) * T.cell + (R2() - 0.5) * T.cell, prio: 3, tag: 'open' }; }
    return null; };
  // --- context terrain (real DEM outside the model area, display only)
  M.ctx = { n: a.ctx_n, ext: S * a.ctx_f, h: P.ctxDem, lc: P.lcCtx };
  M.elevFn = (x, y) => { const c = M.ctx, n = c.n, dx = c.ext / (n - 1), fx = clamp((x + c.ext / 2) / dx, 0, n - 1.001), fy = clamp((y + c.ext / 2) / dx, 0, n - 1.001), i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * n + i, e = c.h; return (e[k] * (1 - u) + e[k + 1] * u) * (1 - v) + (e[k + n] * (1 - u) + e[k + n + 1] * u) * v; };
  C.rasterizeBuildings(T, M);
  // --- per-layer provenance for the UI
  const rc = l => PK.record(sc.id, l);
  L.terrain = { name: 'Elevation', tier: sc.id === 'delhi' ? 'derived' : 'verified', rec: rc('dem'), note: T.elevSrc };
  L.context = { name: 'Context terrain (outside model area)', tier: 'verified', rec: rc('dem_context'), note: 'Real elevation, display only — not used by the model' };
  L.imagery = { name: 'Satellite imagery', tier: 'verified', rec: rc(P.img.post ? 'imagery_s2_post' : 'imagery_s2_pre') };
  L.imageryPre = P.img.pre ? { name: 'Pre-event imagery', tier: 'verified', rec: rc('imagery_s2_pre') } : null;
  L.landcover = { name: 'Land cover', tier: 'verified', rec: rc('landcover') };
  L.roads = { name: 'Roads', tier: 'verified', rec: rc('osm'), note: `${M.roadsAll.length} OSM ways; surface/condition not inferred` };
  L.drainage = { name: 'Rivers & streams', tier: 'verified', rec: rc('osm'), note: `${(P.osm.waterways || []).length} OSM waterways` };
  const nC = M.cems ? M.cems.added : 0;
  L.buildings = { name: 'Buildings', tier: 'derived', rec: rc('buildings_ml'), note: `${M.buildings.length} footprints: ${M.buildings.length - nML} OSM + ${nML - nC} ML (Google Open Buildings)${nC ? ` + ${nC} CEMS points (9 × 9 m assumed)` : ''}. Heights: ${nMapped} mapped, ${nAssumed} assumed.` };
  L.population = { name: 'Resident population', tier: 'modelled', rec: rc('population_belief'), note: `${Math.round(resident).toLocaleString('en-IN')} residents (WorldPop 2020) in the analysis area` };
  L.hazard = a.hazard === 'quake' ? { name: 'Damage zone', tier: 'synthetic', rec: null, note: 'Hypothetical collapse-probability model; no observed damage' } : { name: a.hazard === 'flood' ? 'Observed inundation' : 'Observed debris / scour', tier: 'derived', rec: rc('hazard_observed') };
  if (M.cems) { const cm = M.cems.meta, ce = M.cems.buildings || [], n = g => ce.filter(q => q.grade === g).length, km = v => (v * T.cell * T.cell / 1e6).toFixed(2);
    L.hazard.note = `Inside the Copernicus EMS ${cm.code} AOI ${cm.aoi.name} (${km(M.cems.cells)} km²) the CEMS photo-interpreted delineation is used (verified); elsewhere the Sentinel-2 derived mask.`;
    L.cems = { name: `CEMS ${cm.code} damage grading`, tier: 'verified', rec: rc('cems_vectors'), note: `${ce.length} graded buildings (${n('Destroyed')} destroyed, ${n('Damaged')} damaged, ${n('Possibly damaged')} possibly damaged) from ${cm.images.map(i => i.sensor + ' ' + (i.acquired || '').slice(0, 10)).join(', ')}; ${M.cems.matched} matched to footprints within 12 m, ${M.cems.added} added` }; }
  L.people = { name: 'Survivors', tier: 'synthetic', rec: null, note: 'Synthetic representatives sampled from buildings and hazard geometry; scaled to the scenario figure' };
  L.sensors = { name: 'Camera & radio parameters', tier: 'assumption', rec: null, note: 'Assumed values (see Model & sources); aerostat Tx power to be confirmed' };
  return { T, M };
};
function countNear(m, G, k, r) { const i = k % G, j = (k / G) | 0; let n = 0; for (let q = -r; q <= r; q++) for (let p = -r; p <= r; p++) { const a = i + p, b = j + q; if (a >= 0 && b >= 0 && a < G && b < G && m[b * G + a]) n++; } return n; }
})(window.ARES);
