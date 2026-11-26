/* ARES v7 — Geographic search engine.
   Builds wider analysis domains (1.25× … 5× the original square, same 26.8 m node spacing, same 150 m belief cells) from the real-data
   "ext" packs, with the original square pasted in unchanged, and runs the UNMODIFIED 11-stage pipeline on them:
     Experiment A — same people to find (original Belief State), wider search for launch sites, relays and access.
     Experiment B — wider area: the Belief State, survivors and settlements of the extra ring are added by the identical model.
   Physical limits (camera, radio, altitude, fleet budget, command post) are identical at every level. */
(function (A) {
'use strict';
const C = A.core, Mo = A.model, PK = A.pack, PI = A.pipe, { CLS, clamp, mulberry32, gauss } = C;
const GS = A.search = { packs: {}, built: {}, runs: new Map() };

GS.LEVELS = [
  { id: 1, f: 1, name: 'Original operational area', short: 'Original', d: 'Exactly the v6 search area — the baseline.' },
  { id: 2, f: 1.5, name: 'Expanded local area', short: 'Expanded', d: 'Surrounding slopes, roads and settlements just beyond the original edge.' },
  { id: 3, f: 2.5, name: 'Wider regional area', short: 'Regional', d: 'Neighbouring valleys, towns and alternative access routes.' },
  { id: 4, f: 5, name: 'Maximum data-supported extent', short: 'Maximum', d: 'The full extent of the real-data packs (same resolution everywhere).' },
];
GS.MAXF = 5;
GS.validF = f => f >= 1 && f <= GS.MAXF && Math.abs(f * 4 - Math.round(f * 4)) < 1e-9; // node and belief grids stay aligned for multiples of 0.25

/* ---------- loading (gzip + base64 twins, inflated natively) ---------- */
async function inflate(txt) {
  const bin = atob(txt.trim()), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress the wider-area data (DecompressionStream missing)');
  return new Uint8Array(await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
GS.loadExt = async function (sid, onp) {
  if (GS.packs[sid]) return GS.packs[sid];
  const b = PK.base + sid + '/ext/', r = await fetch(b + 'ext.json'); if (!r.ok) throw new Error('No wider-area pack for ' + sid + ' (HTTP ' + r.status + ')');
  const meta = await r.json(), L = meta.layers, keys = Object.keys(L).filter(k => L[k].file); let done = 0;
  const get = async k => { const l = L[k]; const q = await fetch(b + l.file); if (!q.ok) throw new Error(l.file + ' → HTTP ' + q.status); const u = await inflate(await q.text()); onp && onp(++done, keys.length, k);
    if (/\.json\./.test(l.file)) return JSON.parse(new TextDecoder().decode(u)); if (l.dtype === 'f32') return new Float32Array(u.buffer, u.byteOffset, u.byteLength / 4); return u; };
  const X = { meta }; await Promise.all(keys.map(async k => { X[k] = await get(k); }));
  X.ring = decodeBuildings(X.buildings_ring, meta.S);
  GS.packs[sid] = X; return X;
};
function decodeBuildings(u8, S) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), n = dv.getUint32(0, true); let o = 4;
  const u16 = () => { const a = new Uint16Array(n); for (let i = 0; i < n; i++) a[i] = dv.getUint16(o + 2 * i, true); o += 2 * n; return a; };
  const u8a = () => { const a = u8.slice(o, o + n); o += n; return a; };
  const X = u16(), Y = u16(), W = u16(), D = u16(), RT = u8a(), AR = u16(), H = u16(), FL = u8a();
  const out = new Array(n); for (let i = 0; i < n; i++) out[i] = { i, x: X[i] / 65535 * S - S / 2, y: Y[i] / 65535 * S - S / 2, w: W[i] / 10, d: D[i] / 10, rot: RT[i] / 255 * Math.PI, area: AR[i], h: H[i] / 10, hc: FL[i] & 3, osm: !!(FL[i] & 4), nonres: !!(FL[i] & 8) };
  return out;
}

/* ---------- build one level ---------- */
function crop(a, G5, Gf) { const o = (G5 - Gf) / 2, out = new a.constructor(Gf * Gf); for (let j = 0; j < Gf; j++) out.set(a.subarray((j + o) * G5 + o, (j + o) * G5 + o + Gf), j * Gf); return out; }
function paste(dst, Gf, src, G0) { const o = (Gf - G0) / 2; for (let j = 0; j < G0; j++) dst.set(src.subarray(j * G0, j * G0 + G0), (j + o) * Gf + o); }
GS.buildLevel = function (sc, base, X, f) {
  if (!GS.validF(f)) throw new Error('Search extent must be 1–' + GS.MAXF + '× in steps of 0.25');
  const key = sc.id + '|' + f; if (GS.built[key]) return GS.built[key];
  const t0 = now(), H = PK.helpers, T0 = base.T, M0 = base.M, G0 = T0.G, m = X.meta, G5 = m.G, Gf = Math.round((G0 - 1) * f) + 1, cell = T0.cell, Sf = cell * (Gf - 1), h = Sf / 2, h0 = T0.S / 2;
  const T = C.makeT(Sf, Gf); T.real = true; T.vex = T0.vex; T.bvex = T0.bvex; T.elevSrc = T0.elevSrc; T.routeCapF = (Gf / G0) ** 2; T.extF = f;
  T.elev.set(crop(X.dem, G5, Gf)); T.dsm = Float32Array.from(T.elev);
  if (sc.id === 'delhi') { const r = 3, e = T.elev, G = Gf, mm = new Float32Array(G * G); for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { let mn = 1e9; for (let q = -r; q <= r; q++) for (let p = -r; p <= r; p++) { const ii = clamp(i + p, 0, G - 1), jj = clamp(j + q, 0, G - 1); mn = Math.min(mn, e[jj * G + ii]); } mm[j * G + i] = mn; } for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { let s = 0, n = 0; for (let q = -2; q <= 2; q++) for (let p = -2; p <= 2; p++) { const ii = clamp(i + p, 0, G - 1), jj = clamp(j + q, 0, G - 1); s += mm[jj * G + ii]; n++; } e[j * G + i] = s / n; } }
  T.pre.set(T.elev); C.finishSlope(T);
  const lc = crop(X.landcover, G5, Gf); for (let k = 0; k < Gf * Gf; k++) { const w = lc[k]; let c = H.WC[w] ?? CLS.OPEN; if (w === 60 && T.slope[k] > 0.6) c = CLS.ROCK; T.preCls[k] = c; T.cls[k] = c; } T.wc = lc;
  const osm = X.osm, M = { buildings: [], labels: [], clusters: [], dmg: [], maxSlope: sc.maxSlope, real: true, hazard: M0.hazard, ext: true, f };
  (osm.water || []).forEach(w => { if (!w.partial && w.pts.length > 3) H.fillPoly(T, w.pts, k => { T.cls[k] = T.preCls[k] = CLS.WATER; }); });
  (osm.waterways || []).filter(w => w.kind === 'river').forEach(w => H.stampLine(T, w.pts, T.cell * 0.5, k => { if (T.cls[k] !== CLS.SETTLE) T.cls[k] = T.preCls[k] = CLS.WATER; }));
  const mask = X.hazard_observed ? crop(X.hazard_observed, G5, Gf) : new Uint8Array(Gf * Gf);
  if (X.hazard_cems) { const cg = crop(X.hazard_cems, G5, Gf); for (let k = 0; k < Gf * Gf; k++) if (cg[k] >= 1) mask[k] = cg[k] === 2 ? 1 : 0; M.cemsGrid = cg; }
  const hz = M0.hazard;
  if (hz === 'debris') { M.dmg = [CLS.DEBRIS, CLS.RUBBLE]; for (let k = 0; k < Gf * Gf; k++) if (mask[k]) T.cls[k] = CLS.DEBRIS; }
  if (hz === 'flood') { M.flood = true; M.dmg = [CLS.WATER]; M.nearR = 220; const wp = crop(X.hazard_water_pre, G5, Gf), wq = crop(X.hazard_water_post, G5, Gf); for (let k = 0; k < Gf * Gf; k++) { if (wp[k]) T.preCls[k] = CLS.WATER; if (wq[k] || mask[k]) T.cls[k] = CLS.WATER; } }
  if (hz === 'quake') { M.dmg = [CLS.RUBBLE]; M.epi = M0.epi; }
  // roads: every OSM road of the wider extract is stamped; inside the original square the v6 grid is pasted back below
  const ids0 = new Set(M0.roadsAll.map(r => r.id)), ringRoads = osm.roads.filter(r => !ids0.has(r.id));
  for (const r of osm.roads) { const rad = r.cls <= 2 ? T.cell * 0.55 : T.cell * 0.45; H.stampLine(T, r.pts, rad, k => { if (r.bridge || (T.cls[k] !== CLS.WATER && T.cls[k] !== CLS.DEBRIS)) T.cls[k] = CLS.ROAD; if (T.preCls[k] !== CLS.WATER || r.bridge) T.preCls[k] = CLS.ROAD; }); }
  M.roadsAll = M0.roadsAll.concat(ringRoads); M.roads = M.roadsAll.filter(r => r.cls <= 3).map(r => r.pts); M.ringRoads = ringRoads;
  M.hazMask = hz === 'quake' ? null : mask; M.hazNear = PK.dilate(mask, Gf, Math.ceil(150 / T.cell));
  // ring buildings (centroid outside the original square; inside it the v6 footprints are used unchanged)
  const ring = [], cb = (X.cems_aoi01 && X.cems_aoi01.buildings) || [];
  for (const q of X.ring) {
    if (Math.abs(q.x) <= h0 && Math.abs(q.y) <= h0) continue; if (Math.abs(q.x) > h - 8 || Math.abs(q.y) > h - 8) continue;
    const r1 = H.hash01('e' + q.i + sc.id); let hh, hsrc;
    if (q.hc === 1) { hh = q.h; hsrc = 'mapped (OSM height)'; } else if (q.hc === 2) { hh = q.h; hsrc = 'mapped (OSM levels × 3.2 m)'; } else { hh = sc.id === 'delhi' ? (3 + Math.floor(Math.pow(r1, 1.5) * 4)) * 3.2 : 3.5 + r1 * 3.2; hsrc = 'assumed'; }
    const k = C.idxAt(T, q.x, q.y), c = Math.cos(q.rot), s = Math.sin(q.rot), hw = q.w / 2, hd = q.d / 2;
    const b = { id: 'e' + q.i, x: q.x, y: q.y, w: q.w, d: q.d, rot: q.rot, h: hh, h0: hh, base: C.elevAt(T, q.x, q.y), src: q.osm ? 'osm' : 'ml', hsrc, type: q.nonres ? 'commercial' : 'yes', area: q.area, ring: true,
      pts: [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [-hw, -hd]].map(([u, v]) => [q.x + u * c - v * s, q.y + u * s + v * c]), occ: 0, collapsed: false, flood: false, town: '' };
    if (hz === 'debris') b.collapsed = !!mask[k];
    if (hz === 'flood') b.flood = !!(M.hazNear[k] && (mask[k] || H.countNear(mask, Gf, k, 2) >= 3));
    if (hz === 'quake') { const rr = Math.hypot(q.x - M0.epi[0], q.y - M0.epi[1]); b.collapsed = H.hash01('c' + b.id) < 0.55 * Math.exp(-((rr / 500) ** 2)) + 0.02; b.dz = rr < 650; }
    if (b.collapsed) b.h = 2.5; ring.push(b);
  }
  if (cb.length) { // CEMS EMSR927 AOI01 grading (verified): nearest ring footprint within 12 m of the graded point
    const grid = new Map(), kk = (x, y) => Math.floor(x / 40) + ',' + Math.floor(y / 40); ring.forEach((b, i) => { const g = kk(b.x, b.y); if (!grid.has(g)) grid.set(g, []); grid.get(g).push(i); }); const used = new Set(); let matched = 0, added = 0;
    for (const q of cb) { if (Math.abs(q.x) <= h0 && Math.abs(q.y) <= h0) continue; if (Math.abs(q.x) > h - 8 || Math.abs(q.y) > h - 8) continue; let best = -1, bd = 12; const gx = Math.floor(q.x / 40), gy = Math.floor(q.y / 40);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of (grid.get((gx + dx) + ',' + (gy + dy)) || [])) { if (used.has(i)) continue; const b = ring[i], dd = Math.max(0, Math.hypot(b.x - q.x, b.y - q.y) - Math.max(b.w, b.d) / 2); if (dd < bd) { bd = dd; best = i; } }
      if (best >= 0) { const b = ring[best]; used.add(best); matched++; b.cems = q.grade; b.collapsed = q.grade === 'Destroyed'; b.damaged = q.grade !== 'Destroyed'; b.h = b.collapsed ? 2.5 : b.h0; }
      else { const hh = 3.5 + H.hash01('cems' + q.x + q.y) * 3.2; ring.push({ id: 'ce' + added, x: q.x, y: q.y, w: 9, d: 9, rot: 0, h: q.grade === 'Destroyed' ? 2.5 : hh, h0: hh, base: C.elevAt(T, q.x, q.y), src: 'cems', hsrc: 'assumed', type: /Non-residential/.test(q.type || '') ? 'commercial' : 'yes', area: 81, ring: true, pts: [[q.x - 4.5, q.y - 4.5], [q.x + 4.5, q.y - 4.5], [q.x + 4.5, q.y + 4.5], [q.x - 4.5, q.y + 4.5], [q.x - 4.5, q.y - 4.5]], occ: 0, collapsed: q.grade === 'Destroyed', damaged: q.grade !== 'Destroyed', flood: false, town: '', cems: q.grade }); added++; } }
    M.cemsRing = { matched, added, meta: X.cems_aoi01.meta, facilities: X.cems_aoi01.facilities, bridges: X.cems_aoi01.bridges, transport: X.cems_aoi01.transport, event: X.cems_aoi01.event, coverage: X.cems_aoi01.coverage, buildings: cb };
  }
  C.rasterizeBuildings(T, { buildings: ring }); M.buildings = M0.buildings.concat(ring); M.ringBuildings = ring;
  // occupancy: WorldPop residents per belief cell shared among the cell's buildings by footprint area (non-residential × 0.25) — the v6 rule, ring cells only
  const B0 = base.B, cs = B0.cs, CBf = Math.round(Sf / cs + 1e-9) , pb = crop2(X.pop_belief, m.CB, CBf), co = (CBf - B0.CB) / 2, cellOf = (x, y) => clamp(Math.floor((y + h) / cs), 0, CBf - 1) * CBf + clamp(Math.floor((x + h) / cs), 0, CBf - 1);
  const inA = new Uint8Array(CBf * CBf); for (let j = 0; j < B0.CB; j++) for (let i = 0; i < B0.CB; i++) inA[(j + co) * CBf + i + co] = 1;
  const wsum = new Float64Array(CBf * CBf); ring.forEach(b => { b.ow = b.area * (H.NONRES.has(b.type) ? 0.25 : 1); wsum[cellOf(b.x, b.y)] += b.ow; }); ring.forEach(b => { const c = cellOf(b.x, b.y); b.occ = wsum[c] > 0 ? pb[c] * b.ow / wsum[c] : 0; });
  M.popResidual = new Float32Array(CBf * CBf); let resident = 0, residentRing = 0;
  for (let c = 0; c < CBf * CBf; c++) { if (inA[c]) { const q = (Math.floor(c / CBf) - co) * B0.CB + (c % CBf) - co; M.popResidual[c] = M0.popResidual[q]; pb[c] = M0.pack.popB[q]; } else { residentRing += pb[c]; if (!(wsum[c] > 0)) M.popResidual[c] = pb[c]; } resident += pb[c]; }
  M.popB = pb; M.inAoiCell = inA; M.pop = { resident, residentRing, residentAoi: M0.pop.resident, source: M0.pop.source, buildings: M.buildings.length, ringBuildings: ring.length };
  // places, parks, rivers (wider extract, outside the original square)
  const pr = { city: 0, town: 1, village: 2, suburb: 3, neighbourhood: 4, quarter: 4, hamlet: 5, locality: 6, isolated_dwelling: 7 }, nm = s => (s || '').replace(/\s/g, '').toLowerCase();
  const ringPlaces = (osm.places || []).filter(p => pr[p.kind] != null && (Math.abs(p.x) > h0 || Math.abs(p.y) > h0) && Math.abs(p.x) < h && Math.abs(p.y) < h).sort((p, q) => pr[p.kind] - pr[q.kind]);
  M.places = M0.places.slice(); M.ringPlaces = []; ringPlaces.forEach(p => { if (!M.places.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 350 || nm(q.name) === nm(p.name))) { const r = Object.assign({}, p, { ring: true }); M.places.push(r); M.ringPlaces.push(r); } });
  M.parks = M0.parks.concat((osm.landuse || []).filter(l => ['park', 'pitch', 'playground', 'meadow', 'grass'].includes(l.kind)).map(l => { const o = H.obox(l.pts); return [o.x, o.y]; }).filter(p => (Math.abs(p[0]) > h0 || Math.abs(p[1]) > h0) && Math.abs(p[0]) < h && Math.abs(p[1]) < h));
  M.rivers = (osm.waterways || []).filter(w => C.plLen(w.pts) > 250).map(w => w.pts); M.riverMeta = (osm.waterways || []).filter(w => C.plLen(w.pts) > 250); M.bridgesExt = osm.bridges || [];
  M.icp = M0.icp.slice(); M.incident = M0.incident; M.pack = M0.pack;
  // candidates: the v6 list unchanged (first, same order), then the same generators applied beyond the original square; 50 m de-duplication; NO 2,200 cap
  const base0 = M0.sites(); M.sites = () => { const pts = [], seen = new Set(), add = (x, y, src) => { const key = Math.round(x / 50) + ',' + Math.round(y / 50); if (seen.has(key)) return; seen.add(key); pts.push([x, y]); M.siteSrc.push(src); };
    M.siteSrc = []; base0.forEach(([x, y]) => add(x, y, 0)); const out = (x, y) => Math.abs(x) > h0 || Math.abs(y) > h0, n = 27, st = T0.S / n;
    for (let i = -Math.ceil((h - h0) / st) - 1; i < n + Math.ceil((h - h0) / st) + 1; i++) for (let j = -Math.ceil((h - h0) / st) - 1; j < n + Math.ceil((h - h0) / st) + 1; j++) { const x = -h0 + T0.S * (i + 0.5) / n, y = -h0 + T0.S * (j + 0.5) / n; if (out(x, y) && Math.abs(x) < h && Math.abs(y) < h) add(x, y, 1); }
    for (const r of ringRoads) { if (r.cls > 3 && sc.id !== 'nepal') continue; const Lr = C.plLen(r.pts); for (let s = 0; s < Lr; s += 150) { const q = C.pointAt(r.pts, s / Lr); if (out(q.x, q.y)) add(q.x, q.y, 2); } }
    M.parks.forEach(p => { if (out(p[0], p[1])) add(p[0], p[1], 3); }); return pts; };
  // the original square: every grid, mask and class copied back unchanged
  for (const k of ['elev', 'pre', 'dsm', 'cls', 'preCls', 'slope', 'bldg']) paste(T[k], Gf, T0[k], G0); paste(T.wc, Gf, T0.wc, G0);
  if (M.hazMask && M0.hazMask) paste(M.hazMask, Gf, M0.hazMask, G0); paste(M.hazNear, Gf, M0.hazNear, G0);
  { let mn = 1e9, mx = -1e9; for (let k = 0; k < Gf * Gf; k++) { if (T.elev[k] < mn) mn = T.elev[k]; if (T.elev[k] > mx) mx = T.elev[k]; } T.base = Math.min(mn, T0.base); T.top = Math.max(mx, T0.top); }
  // synthetic survivors outside the original square (Experiment B only) — same sampler as the v6 pack, restricted to the ring
  const cum = [], items = []; let tot = 0; ring.forEach(b => { const k = C.idxAt(T, b.x, b.y), fct = (b.collapsed || b.flood) ? 4 : b.damaged ? 2.5 : (M.hazNear[k] ? 1.5 : 0.3), w = (b.occ + 0.05) * fct; if (w <= 0) return; tot += w; cum.push(tot); items.push(b); });
  const hazCells = []; for (let k = 0; k < Gf * Gf; k++) if (mask[k]) { const x = -h + (k % Gf) * cell, y = -h + ((k / Gf) | 0) * cell; if (Math.abs(x) > h0 || Math.abs(y) > h0) hazCells.push(k); }
  const nearRoads = ringRoads.filter(r => r.pts.some(p => { const k = C.idxAt(T, p[0], p[1]); return M.hazNear[k] && (Math.abs(p[0]) > h0 || Math.abs(p[1]) > h0); }));
  M.sampleRing = R2 => { const u = R2();
    if (u < 0.58 && items.length) { let lo = 0, hi = cum.length - 1; const t = R2() * tot; while (lo < hi) { const md = (lo + hi) >> 1; if (cum[md] < t) lo = md + 1; else hi = md; } const b = items[lo], c = Math.cos(b.rot), s = Math.sin(b.rot), du = (R2() - 0.5) * b.w * 0.6, dv = (R2() - 0.5) * b.d * 0.6; return { x: b.x + du * c + dv * s, y: b.y - du * s + dv * c, roofH: b.flood ? b.h : 0, prio: (b.collapsed || b.flood) ? 3 : undefined }; }
    if (u < 0.72 && nearRoads.length) { const r = nearRoads[Math.floor(R2() * nearRoads.length)], q = C.pointAt(r.pts, R2()); return { x: q.x + gauss(R2) * 8, y: q.y + gauss(R2) * 8, prio: 2, tag: 'road' }; }
    if (u < 0.84 && hazCells.length && hz !== 'flood') { const k = hazCells[Math.floor(R2() * hazCells.length)]; return { x: -h + (k % Gf) * cell + (R2() - 0.5) * cell, y: -h + ((k / Gf) | 0) * cell + (R2() - 0.5) * cell, prio: 3, tag: 'open' }; }
    return null; };
  const built = { T, M, f, Gf, Sf, real: true, ms: Math.round(now() - t0), ring: { buildings: ring.length, places: M.ringPlaces.length, roads: ringRoads.length, hazardNodes: hazCells.length } };
  GS.built[key] = built; const ks = Object.keys(GS.built); if (ks.length > 2) delete GS.built[ks[0]]; // keep at most two levels in memory
  return built;
};
function crop2(a, n5, nf) { return crop(a, n5, nf); }
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/* ---------- survivors in the ring (Experiment B): count = expected people in the ring under the identical Belief State ---------- */
function addRingPeople(P, B, built, base, sc, p) {
  const { T, M } = built, h0 = base.T.S / 2, h = T.S / 2, R = mulberry32(p.seed * 7919 + 202); let lamRing = 0; for (let c = 0; c < B.N; c++) if (!B.inAoi[c]) lamRing += B.lam[c];
  const n = Math.round(lamRing), ok = (x, y) => (Math.abs(x) > h0 || Math.abs(y) > h0) && Math.abs(x) < h - 15 && Math.abs(y) < h - 15, n0 = P.n;
  const push = (x, y, o) => { const k = C.idxAt(T, x, y), c = T.cls[k], rh = o.roofH || 0; if (c === CLS.WATER && !rh) return; if (c === CLS.SNOW) return; const g = C.elevAt(T, x, y);
    P.x.push(x); P.y.push(y); P.g.push(g); P.roofH.push(rh); P.z.push(g + rh + 1); P.cls.push(c); P.prio.push(o.prio || (M.dmg.includes(c) ? 3 : (M.hazNear[k] ? 2 : 1))); P.dev.push(R() < p.devFrac ? 1 : 0); P.tag.push(o.tag || 'ring'); P.sos.push(0); };
  let guard = 0; while (P.x.length - n0 < Math.round(n * 0.85) && guard++ < n * 60 + 100) { const s = M.sampleRing(R); if (s && ok(s.x, s.y)) push(s.x, s.y, s); }
  while (P.x.length - n0 < n && guard++ < n * 120 + 200) { const x = (R() - 0.5) * T.S, y = (R() - 0.5) * T.S; if (ok(x, y)) push(x, y, {}); }
  P.n = P.x.length; return { n: P.n - n0, lamRing };
}

/* ---------- runs ---------- */
/* Demand rule outside the original square (Experiment B only; disclosed in the UI):
   'hazard'    (default) — demand only in cells where the v6 hazard term is non-zero (mapped hazard in the cell or within ~300 m);
   'identical' — the v6 Belief State everywhere, including its 3 % background floor for residents far from any mapped hazard.
   Why the default: v6 calibrated the floor inside an incident square; extended to whole towns it creates thousands of expected
   "people needing help" with no hazard evidence (e.g. ≈11,600 in Dehradun city at 5×). Nothing is removed from the search itself. */
GS.DEMAND = { hazard: 'Hazard-linked (default)', identical: 'Identical to v6 incl. 3 % background floor' };
GS.run = function (sc, base, built, mode, pIn, demand = 'hazard') {
  const key = sc.id + '|' + built.f + '|' + mode + '|' + (mode === 'B' ? demand : '') + '|' + JSON.stringify(pIn || {}); if (GS.runs.has(key)) return GS.runs.get(key);
  const t0 = now(), opts = { base, P: PI.clonePeople(base.P0) }; let ringPeople = null, zeroed = 0;
  if (mode === 'A') opts.B = base.B;
  else { const B = opts.B = Mo.buildBelief(built.T, built.M, sc, { cs: base.B.cs, scale: base.B.scale, lock: base.B, bgPerNode: base.B.bgPerNode });
    if (demand === 'hazard') for (let c = 0; c < B.N; c++) if (!B.inAoi[c] && B.sev[c] < 0.0301 && B.lam[c] > 0) { B.lam[c] = 0; if (B.lamEst !== B.lam) B.lamEst[c] = 0; zeroed++; }
    ringPeople = addRingPeople(opts.P, opts.B, built, base, sc, base.p); }
  const o = PI.run(sc, pIn || {}, built, opts); o.mode = mode; o.demand = mode === 'B' ? demand : null; o.zeroedCells = zeroed; o.f = built.f; o.built = built; o.ringPeople = ringPeople; o.base = base; o.totalMs = Math.round(now() - t0);
  o.outc = GS.outcomes(o, base); GS.runs.set(key, o); if (GS.runs.size > 6) GS.runs.delete(GS.runs.keys().next().value); return o;
};
/* Level 1 through the same reporting code (the original run itself) */
GS.outcomesBase = base => { if (!base.outc) base.outc = GS.outcomes(Object.assign(base, { f: 1, mode: 'base' }), base); return base.outc; };

/* ---------- outcome metrics (deterministic unless marked sim) ---------- */
GS.outcomes = function (o, base) {
  const T = o.T, M = o.M, B = o.B, s = o.steps, h0 = base.T.S / 2, cellA = T.cell * T.cell / 1e6, outside = (x, y) => Math.abs(x) > h0 || Math.abs(y) > h0;
  const sol = s.optimise.sol, first = sol.map(q => q.site), fin = o.nodes.map(n => n.site), wk = o.wk;
  const covered = set => { const m = new Uint8Array(B.N); set.forEach(j => { const L = o.cc.sp[j].c; for (let t = 0; t < L.length; t++) m[L[t]] = 1; }); return m; };
  const c1 = covered(first), cF = covered(fin), occ = B.occ; let resCov1 = 0, resCovF = 0, lamCov = 0, lamTot = 0, resTot = 0, lamRing = 0, resRing = 0, expo = 0, expoRing = 0;
  for (let c = 0; c < B.N; c++) { const ring = B.inAoi ? !B.inAoi[c] : false; resTot += occ[c]; lamTot += B.lam[c]; if (ring) { lamRing += B.lam[c]; resRing += occ[c]; } if (c1[c]) resCov1 += occ[c]; if (cF[c]) { resCovF += occ[c]; lamCov += B.lam[c]; } if (B.dfrac[c] > 0 || B.prio[c] >= 2) { expo += occ[c]; if (ring) expoRing += occ[c]; } }
  // residents within modelled camera coverage of the deployed aerostats — counted on the WorldPop grid of this domain (also where demand is the original square)
  const popB = M.popB || (M.pack && M.pack.popB), popCB = M.popB ? Math.round(Math.sqrt(M.popB.length)) : B.CB, pcs = T.S / popCB; let popInView1 = 0, popInViewF = 0, popTot = 0;
  if (popB) { const r0 = Mo.footR(o.p, o.p.h); const near = (set, x, y) => set.some(j => { const st = o.sites[j]; return (st.x - x) ** 2 + (st.y - y) ** 2 <= r0 * r0; });
    for (let c = 0; c < popB.length; c++) { const v = popB[c]; if (!(v > 0)) continue; popTot += v; const x = -T.S / 2 + ((c % popCB) + 0.5) * pcs, y = -T.S / 2 + (Math.floor(c / popCB) + 0.5) * pcs; if (near(first, x, y)) popInView1 += v; if (near(fin, x, y)) popInViewF += v; } }
  let hazN = 0, hazRing = 0; if (M.hazMask) for (let k = 0; k < T.G * T.G; k++) if (M.hazMask[k]) { hazN++; const x = -T.S / 2 + (k % T.G) * T.cell, y = -T.S / 2 + ((k / T.G) | 0) * T.cell; if (outside(x, y)) hazRing++; }
  const sitesNew = o.sites.filter(q => outside(q.x, q.y)).length, placedNew = first.filter(j => outside(o.sites[j].x, o.sites[j].y)).length, finalNew = fin.filter(j => outside(o.sites[j].x, o.sites[j].y)).length;
  const places = M.places || [], ringPl = M.ringPlaces || [], r0 = Mo.footR(o.p, o.p.h);
  const plCovered = pl => fin.some(j => Math.hypot(o.sites[j].x - pl.x, o.sites[j].y - pl.y) <= r0);
  const need = Mo.greedy(o.cc.sp, o.sites.length, B.N, wk.w, wk.kq, wk.W, o.tEff, 600);
  // underserved: 8-connected clusters of demand cells not covered by the final fleet
  const un = new Uint8Array(B.N); for (let c = 0; c < B.N; c++) un[c] = !cF[c] && B.lam[c] >= 0.05 ? 1 : 0; const lab = new Int32Array(B.N).fill(-1), cl = [];
  for (let c0 = 0; c0 < B.N; c0++) { if (!un[c0] || lab[c0] >= 0) continue; const st = [c0], id = cl.length, r = { id, cells: 0, lam: 0, res: 0, sx: 0, sy: 0, ring: 0 }; lab[c0] = id;
    while (st.length) { const c = st.pop(); r.cells++; r.lam += B.lam[c]; r.res += occ[c]; r.sx += B.cx[c] * B.lam[c]; r.sy += B.cy[c] * B.lam[c]; if (B.inAoi && !B.inAoi[c]) r.ring++; const i = c % B.CB, j = (c / B.CB) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= B.CB || jj >= B.CB) continue; const q = jj * B.CB + ii; if (un[q] && lab[q] < 0) { lab[q] = id; st.push(q); } } }
    r.x = r.sx / r.lam; r.y = r.sy / r.lam; let bn = null, bd = 1e18; places.forEach(p => { const d = Math.hypot(p.x - r.x, p.y - r.y); if (d < bd) { bd = d; bn = p; } }); r.near = bn ? bn.name : null; r.nearD = bn ? bd : null; r.why = whyUncovered(o, r); cl.push(r); }
  cl.sort((a, b) => b.lam - a.lam);
  const why = s.sites.why || {};
  return { f: o.f, mode: o.mode, demand: o.demand, zeroedCells: o.zeroedCells || 0, areaKm2: (T.S / 1000) ** 2, aoiKm2: (base.T.S / 1000) ** 2, grid: T.G, cells: B.N,
    candidatesRaw: M.sites ? (M._nSites || (M._nSites = M.sites().length)) : null, sitesValid: o.sites.length, sitesRejected: s.sites.rejected.length, sitesNew, rejectWhy: why,
    reach: o.reach, tEff: o.tEff, placed: sol.length, placedNew, cov: s.optimise.cov, met: s.optimise.met, lb: s.optimise.lb, kmeansNeed: s.optimise.base.needKmeans, gridN: s.optimise.base.grid.n,
    nodes: o.nodes.length, finalNew, relays: s.deploy.relays, linked: s.deploy.con.ok.filter(Boolean).length, needForTarget: need.cov >= o.tEff - 1e-9 ? need.steps.length : null, needCov: need.cov,
    demandTotal: lamTot, demandRing: lamRing, demandCovered: lamCov, residentsModel: resTot, residentsRing: resRing, exposedResidents: expo, exposedRing: expoRing, residentsCoveredFirst: resCov1, residentsCoveredFinal: resCovF,
    popTotal: popTot, popInViewFirst: popInView1, popInViewFinal: popInViewF,
    hazKm2: hazN * cellA, hazRingKm2: hazRing * cellA, buildings: M.buildings.length, ringBuildings: (M.ringBuildings || []).length,
    settlements: places.length, ringSettlements: ringPl.map(p => ({ name: p.name, kind: p.kind, x: p.x, y: p.y, covered: plCovered(p) })), settlementsCovered: places.filter(plCovered).length,
    ringRoadsKm: (M.ringRoads || []).reduce((a, r) => a + C.plLen(r.pts), 0) / 1000, ringBridges: (M.bridgesExt || []).filter(b => b.pts.some(p => outside(p[0], p[1]))).length,
    survivors: o.P.n, ringSurvivors: o.ringPeople ? o.ringPeople.n : 0, sim: { detRate: s.update.sense.rate, detected: s.update.sense.det, inView: s.update.sense.inView, outage: s.update.sense.outage, estTotal: s.update.gp2.estTotal, sectors: s.handover.sectors, mae: s.handover.mae },
    underserved: cl.slice(0, 10), underservedLam: cl.reduce((a, r) => a + r.lam, 0), ms: o.totalMs || o.ms };
};
function whyUncovered(o, r) {
  // which v6 rule leaves this cluster unserved: no valid site can see it, or sites exist but the budget ran out
  const B = o.B; let seenBy = 0; for (let j = 0; j < o.sites.length; j++) { const L = o.cc.sp[j].c; for (let t = 0; t < L.length; t++) { const c = L[t]; if (Math.abs(B.cx[c] - r.x) < B.cs * 2 && Math.abs(B.cy[c] - r.y) < B.cs * 2) { seenBy++; break; } } if (seenBy > 3) break; }
  if (!seenBy) return 'No usable launch site can see it (terrain, water, debris or steep ground around it)';
  return 'Visible from usable sites, but the fleet budget was spent on areas with more expected people';
}

/* ---------- comparison A vs baseline, progressive exploration ---------- */
GS.compare = function (oL1, oX) {
  const a = oL1.outc, b = oX.outc, d = k => b[k] - a[k];
  return { areaIncreasePct: (b.areaKm2 / a.areaKm2 - 1) * 100, extraSettlements: b.ringSettlements.length, extraCandidates: b.sitesValid - a.sitesValid, extraResidents: b.popTotal - a.popTotal, extraPopInView: d('popInViewFinal'),
    dCov: d('cov'), dPlaced: d('placed'), dNodes: d('nodes'), dRelays: d('relays'), dReach: d('reach'), dNeed: (a.needForTarget != null && b.needForTarget != null) ? b.needForTarget - a.needForTarget : null,
    dDet: b.sim.detRate - a.sim.detRate, placedNew: b.placedNew, dHazKm2: d('hazKm2'), dUnderserved: d('underservedLam') };
};
GS.progressive = async function (sc, base, X, mode, pIn, opt = {}, onp, demand = 'hazard') {
  const step = opt.step || 0.5, maxF = Math.min(opt.maxF || GS.MAXF, GS.MAXF), rows = [], tgt = base.tEff; let prev = null, reason = null;
  const L1 = GS.outcomesBase(base); rows.push({ f: 1, o: L1 });
  if (mode === 'A' && L1.met && !opt.force) return { rows, stop: 'Level 1 already meets the coverage target with the original sites — expansion is not required (run a level manually to see what it would add)' };
  for (let f = 1 + step; f <= maxF + 1e-9; f += step) {
    const ff = Math.round(f * 4) / 4, built = GS.buildLevel(sc, base, X, ff); await yieldUI(); const o = GS.run(sc, base, built, mode, pIn, demand); rows.push({ f: ff, o: o.outc }); onp && onp(ff, maxF); await yieldUI();
    const last = rows[rows.length - 2].o, cur = o.outc;
    if (mode === 'A') {
      const better = cur.cov > last.cov + 1e-4 || (cur.cov >= last.cov - 1e-9 && cur.placed < last.placed) || cur.relays < last.relays;
      if (!L1.met && cur.met) { reason = `Coverage target met at ${ff}× (${pct(cur.cov)} with ${cur.placed} aerostats; Level 1 reached ${pct(L1.cov)})`; break; }
      if (cur.sitesValid === last.sitesValid) { reason = `No new valid launch sites appear beyond ${rows[rows.length - 2].f}×`; break; }
      if (!better && cur.reach - last.reach < 1e-4) { reason = `${cur.sitesValid - last.sitesValid} new valid sites at ${ff}×, but none improves coverage, fleet size or relays — the extra area cannot see the original demand better (camera footprint ≈ ${Math.round(Mo.footR(base.p, base.p.h))} m)`; break; } }
    else { const newHaz = cur.hazRingKm2 - last.hazRingKm2, newExpo = cur.exposedRing - last.exposedRing; if (newHaz < 0.02 && newExpo < 50) { reason = `The ring added at ${ff}× contains no further mapped hazard (+${newHaz.toFixed(2)} km²) or exposed residents (+${Math.round(newExpo)}) — stopping`; break; } }
  }
  return { rows, stop: reason || `Configured limit reached (${maxF}×)` };
};
const pct = v => (v * 100).toFixed(1) + '%';
const yieldUI = () => new Promise(r => setTimeout(r, 0));

/* ---------- explain one selected aerostat (works on any run) ---------- */
GS.explain = function (o, ni) {
  const n = o.nodes[ni], st = o.sites[n.site], B = o.B, L = o.cc.sp[n.site], sol = o.steps.optimise.sol, k = sol.findIndex(q => q.site === n.site), h0 = (o.base || o).T.S / 2;
  let lam = 0, res = 0, overlap = 0; const others = o.nodes.filter((_, i) => i !== ni).map(q => q.site), oc = new Uint8Array(B.N); others.forEach(j => { const l = o.cc.sp[j].c; for (let t = 0; t < l.length; t++) oc[l[t]] = 1; });
  for (let t = 0; t < L.c.length; t++) { const c = L.c[t]; lam += B.lam[c]; res += B.occ[c]; if (oc[c]) overlap++; }
  const r0 = Mo.footR(o.p, o.p.h), pl = (o.M.places || []).filter(p => Math.hypot(p.x - st.x, p.y - st.y) <= r0 * 1.2).map(p => p.name);
  const alts = k >= 0 && o.steps.optimise.cands[k] ? o.steps.optimise.cands[k].filter(c => c.j !== n.site).slice(0, 4).map(c => ({ gain: c.g, d: Math.hypot(o.sites[c.j].x - st.x, o.sites[c.j].y - st.y), x: o.sites[c.j].x, y: o.sites[c.j].y })) : [];
  return { id: n.id, role: n.role, replan: !!n.replan, step: k >= 0 ? k + 1 : null, gain: n.gain, x: st.x, y: st.y, lat: o.sc.lat + st.y / 111320, lon: o.sc.lon + st.x / (111320 * Math.cos(o.sc.lat * Math.PI / 180)), groundM: st.z0, cls: st.cls, slopeDeg: Math.atan(st.slope) * 57.3,
    cells: L.c.length, demand: lam, residents: res, overlapShare: L.c.length ? overlap / L.c.length : 0, places: pl, alts, hop: n.hop, marginDb: n.marg, linked: n.hop > 0, loo: n.loo, shap: n.shap, newSite: Math.abs(st.x) > h0 || Math.abs(st.y) > h0, eta: n.eta, team: n.team };
};
})(window.ARES);
