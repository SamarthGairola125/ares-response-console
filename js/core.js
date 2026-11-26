/* ARES simulation — core: utilities, terrain, scenarios (real event data) */
window.ARES = window.ARES || {};
(function (A) {
'use strict';
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(R) { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R()); }

function makeNoise(seed) {
  const R = mulberry32(seed), P = new Uint8Array(512), p = [];
  for (let i = 0; i < 256; i++) p.push(i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
  const g = new Float32Array(256); for (let i = 0; i < 256; i++) g[i] = R() * 2 - 1;
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const h = (a, b) => g[P[(P[a & 255] + b) & 255]];
  function n2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), u = fade(x - xi), v = fade(y - yi);
    return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
  }
  function fbm(x, y, o = 5) { let a = 0, amp = 0.5, f = 1; for (let i = 0; i < o; i++) { a += amp * n2(x * f, y * f); f *= 2.03; amp *= 0.5; } return a; }
  function ridge(x, y, o = 5) { let a = 0, amp = 0.5, f = 1; for (let i = 0; i < o; i++) { a += amp * (1 - Math.abs(n2(x * f, y * f))); f *= 2.03; amp *= 0.5; } return a; }
  return { n2, fbm, ridge };
}

/* ---------- polylines ---------- */
function distPL(px, py, pts) {
  let best = 1e18, bs = 0, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], ay = pts[i][1], dx = pts[i + 1][0] - ax, dy = pts[i + 1][1] - ay;
    const L2 = dx * dx + dy * dy || 1e-9; let t = ((px - ax) * dx + (py - ay) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx - px, qy = ay + t * dy - py, d = qx * qx + qy * qy, sl = Math.sqrt(L2);
    if (d < best) { best = d; bs = acc + t * sl; } acc += sl;
  }
  return { d: Math.sqrt(best), s: bs, L: acc };
}
function plLen(pts) { let L = 0; for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); return L; }
function pointAt(pts, f) {
  const L = plLen(pts), tg = clamp(f, 0, 1) * L; let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], ay = pts[i][1], bx = pts[i + 1][0], by = pts[i + 1][1], s = Math.hypot(bx - ax, by - ay) || 1e-9;
    if (acc + s >= tg) { const t = (tg - acc) / s; return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, nx: -(by - ay) / s, ny: (bx - ax) / s }; }
    acc += s;
  }
  const l = pts[pts.length - 1]; return { x: l[0], y: l[1], nx: 0, ny: 0 };
}
function offsetPL(pts, off) {
  return pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [p[0] - dy / L * off, p[1] + dx / L * off]; });
}
function extendPL(pts, len, ends = 'both') {
  const o = pts.slice(), n = 8;
  if (ends !== 'end') { const a = pts[0], b = pts[1], dx = a[0] - b[0], dy = a[1] - b[1], L = Math.hypot(dx, dy) || 1; for (let i = 1; i <= n; i++) o.unshift([a[0] + dx / L * len * i / n, a[1] + dy / L * len * i / n]); }
  if (ends !== 'start') { const a = pts[pts.length - 1], b = pts[pts.length - 2], dx = a[0] - b[0], dy = a[1] - b[1], L = Math.hypot(dx, dy) || 1; for (let i = 1; i <= n; i++) o.push([a[0] + dx / L * len * i / n, a[1] + dy / L * len * i / n]); }
  return o;
}
function subPL(pts, f0, f1, n = 30) { const o = []; for (let i = 0; i <= n; i++) { const q = pointAt(pts, f0 + (f1 - f0) * i / n); o.push([q.x, q.y]); } return o; }
function meander(a, b, n, amp, N, seed) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), px = -dy / L, py = dx / L, pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n, o = amp * 2.2 * N.fbm(t * 2.6 + seed * 3.1, seed * 1.3, 4); pts.push([a[0] + dx * t + px * o, a[1] + dy * t + py * o]); }
  return pts;
}

/* ---------- terrain grid ---------- */
const CLS = { OPEN: 0, WATER: 1, DEBRIS: 2, SETTLE: 3, FOREST: 4, ROCK: 5, SNOW: 6, ROAD: 7, RUBBLE: 8, FARM: 9 };
const CLS_NAME = ['Open ground', 'Water', 'Debris / scour', 'Settlement', 'Forest', 'Rock', 'Snow / ice', 'Road / embankment', 'Collapsed structure', 'Farmland / tea'];
function makeT(S, G) { return { S, G, cell: S / (G - 1), elev: new Float32Array(G * G), pre: new Float32Array(G * G), cls: new Uint8Array(G * G), preCls: new Uint8Array(G * G), bldg: new Float32Array(G * G), slope: new Float32Array(G * G), base: 0, top: 0 }; }
function forEachV(T, fn) { const G = T.G, h = T.S / 2; for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) fn(i, j, -h + i * T.cell, -h + j * T.cell, j * G + i); }
function finishSlope(T) {
  const G = T.G, e = T.elev, c = T.cell; let mn = 1e9, mx = -1e9;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const k = j * G + i, i0 = Math.max(0, i - 1), i1 = Math.min(G - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(G - 1, j + 1);
    T.slope[k] = Math.hypot((e[j * G + i1] - e[j * G + i0]) / ((i1 - i0) * c), (e[j1 * G + i] - e[j0 * G + i]) / ((j1 - j0) * c));
    if (e[k] < mn) mn = e[k]; if (e[k] > mx) mx = e[k];
  }
  T.base = mn; T.top = mx;
}
function elevAt(T, x, y) {
  const G = T.G; let fx = (x + T.S / 2) / T.cell, fy = (y + T.S / 2) / T.cell;
  fx = clamp(fx, 0, G - 1.0001); fy = clamp(fy, 0, G - 1.0001);
  const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, e = T.elev, k = j * G + i;
  return (e[k] * (1 - u) + e[k + 1] * u) * (1 - v) + (e[k + G] * (1 - u) + e[k + G + 1] * u) * v;
}
function idxAt(T, x, y) { const G = T.G; return clamp(Math.round((y + T.S / 2) / T.cell), 0, G - 1) * G + clamp(Math.round((x + T.S / 2) / T.cell), 0, G - 1); }
function surfAt(T, x, y) { return elevAt(T, x, y) + T.bldg[idxAt(T, x, y)]; }
function markLine(T, pts, w, cls, cond) { const ww = Math.max(w, T.cell * 0.72); forEachV(T, (i, j, x, y, k) => { if (cond(k) && distPL(x, y, pts).d < ww) T.cls[k] = cls; }); }
function vegetate(T, N, o) {
  forEachV(T, (i, j, x, y, k) => {
    if (T.cls[k] !== CLS.OPEN) return; const e = T.elev[k];
    if (o.snow && e > o.snow + 120 * N.n2(x / 400, y / 400)) T.cls[k] = CLS.SNOW;
    else if (T.slope[k] > o.rockSlope) T.cls[k] = CLS.ROCK;
    else if ((!o.treeLine || e < o.treeLine) && N.fbm(x / o.scale + 9, y / o.scale - 2, 4) > o.forestNoise) T.cls[k] = CLS.FOREST;
  });
}
function placeTown(T, R, c, n, rad, M, o = {}) {
  for (let k = 0; k < n; k++) for (let t = 0; t < 14; t++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * rad, x = c[0] + Math.cos(a) * r, y = c[1] + Math.sin(a) * r;
    if (Math.abs(x) > T.S / 2 - 25 || Math.abs(y) > T.S / 2 - 25) continue;
    const ki = idxAt(T, x, y), cl = T.cls[ki];
    if (cl === CLS.WATER && !o.allowWater) continue; if (T.slope[ki] > (o.maxSlope || 0.9)) continue;
    const col = cl === CLS.DEBRIS || (o.collapseP && R() < o.collapseP);
    const w = (o.w ? o.w[0] + R() * (o.w[1] - o.w[0]) : 8 + R() * 6), d = w * (0.75 + R() * 0.4);
    const hh = o.h ? o.h[0] + R() * (o.h[1] - o.h[0]) : 5 + R() * 5;
    M.buildings.push({ x, y, w, d, h: col ? 2.5 : hh, h0: hh, rot: R() * Math.PI, collapsed: col, base: elevAt(T, x, y), town: o.name || '', occ: o.occ || 5 });
    break;
  }
}
function rasterizeBuildings(T, M) {
  for (const b of M.buildings) {
    const half = Math.max(b.w, b.d) / 2, G = T.G;
    const i0 = Math.max(0, Math.floor((b.x - half + T.S / 2) / T.cell)), i1 = Math.min(G - 1, Math.ceil((b.x + half + T.S / 2) / T.cell));
    const j0 = Math.max(0, Math.floor((b.y - half + T.S / 2) / T.cell)), j1 = Math.min(G - 1, Math.ceil((b.y + half + T.S / 2) / T.cell));
    const mark = k => { if (b.h > T.bldg[k]) T.bldg[k] = b.h; if (b.collapsed) { if (T.cls[k] !== CLS.WATER && T.cls[k] !== CLS.DEBRIS) T.cls[k] = CLS.RUBBLE; } else if (T.cls[k] !== CLS.WATER && T.cls[k] !== CLS.DEBRIS) T.cls[k] = CLS.SETTLE; };
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = -T.S / 2 + i * T.cell, y = -T.S / 2 + j * T.cell; if (Math.abs(x - b.x) <= half && Math.abs(y - b.y) <= half) mark(j * G + i); }
    mark(idxAt(T, b.x, b.y));
  }
}
function ensureICP(T, M) {
  const [x0, y0] = M.icp; let best = null, bd = 1e18;
  forEachV(T, (i, j, x, y, k) => {
    const c = T.cls[k]; if (!(c === CLS.OPEN || c === CLS.ROAD || c === CLS.FARM) || T.slope[k] > 0.3 || T.bldg[k] > 0) return;
    if (M.water != null && T.elev[k] < M.water + 0.8) return;
    const d = (x - x0) ** 2 + (y - y0) ** 2; if (d < bd) { bd = d; best = [x, y]; }
  });
  if (best) M.icp = best;
}

/* ---------- radio environment classes (Al-Hourani et al., 2014) ---------- */
const ENV = {
  suburban: { label: 'Suburban / rural', a: 4.88, b: 0.43, eL: 0.1, eN: 21 },
  urban: { label: 'Urban', a: 9.61, b: 0.16, eL: 1.0, eN: 20 },
  dense: { label: 'Dense urban', a: 12.08, b: 0.11, eL: 1.6, eN: 23 },
  highrise: { label: 'High-rise urban', a: 27.23, b: 0.08, eL: 2.3, eN: 34 },
};

/* ---------- palettes per terrain ---------- */
const PAL = {
  dehradun: ['#b2a679', '#6b5a44', '#7a6650', '#c2b49a', '#5b6b3b', '#8b7d6b', '#f2f2ef', '#a39b8e', '#8c5a46', '#a6a96c'],
  wayanad: ['#8fa863', '#7a5a3a', '#9a5a3a', '#c1ae8e', '#3e6936', '#7d6f5c', '#f2f2ef', '#9a9488', '#8a4a36', '#5f9640'],
  assam: ['#9fae66', '#6e6a52', '#7a6a50', '#b5a582', '#4d6b33', '#8b7d6b', '#f2f2ef', '#b3aa96', '#8a5a46', '#b2bb72'],
  delhi: ['#9aa874', '#6a7a80', '#a08a72', '#c9bfae', '#4f6a38', '#9a9080', '#f2f2ef', '#8e8a84', '#9a6450', '#a0a070'],
  nepal: ['#a9a37c', '#8a8478', '#8d8579', '#b6a88f', '#4f613d', '#857c70', '#f4f5f7', '#a19a8e', '#8a5f4a', '#9aa064'],
};

/* ---------- scenarios: real event data + geography-shaped terrain ---------- */
const SRC = {
  etv: { t: 'ETV Bharat — Dehradun cloudburst toll at 24, 16 still missing (18 Sep 2025)', u: 'https://www.etvbharat.com/en/!state/dehradun-cloudburst-toll-at-24-16-still-missing-enn25091805630', tier: 'media' },
  tribuneDdn: { t: 'Tribune — 13 dead, 16 missing in Dehradun cloudbursts (16 Sep 2025)', u: 'https://www.tribuneindia.com/news/india/13-dead-16-missing-in-dehradun-cloudbursts/amp', tier: 'media' },
  dhDdn: { t: 'Deccan Herald — Uttarakhand cloudburst death toll rises to 21 (17 Sep 2025, statewide)', u: 'https://www.deccanherald.com/amp/story/india%2Futtarakhand%2Futtarakhand-cloudburst-death-toll-rises-to-21-landslides-at-several-areas-hinder-rescue-operations-3732163', tier: 'media' },
  wiki: { t: 'Wikipedia — 2024 Wayanad landslides (secondary; figures conflict internally)', u: 'https://en.wikipedia.org/wiki/2024_Wayanad_landslides', tier: 'secondary' },
  gsiWyd: { t: 'Onmanorama — GSI report: Wayanad landslide "extremely rapid", covered ~7 km (10 Aug 2024)', u: 'https://www.onmanorama.com/news/kerala/2024/08/10/wayanad-landslide-velocity-rated-extremely-rapid-covered-seven-km-says-gsi-report.amp.html', tier: 'media (citing GSI)' },
  nrscWyd: { t: 'NRSC/ISRO — International Charter 1029 value-added product, Wayanad (31 Jul 2024)', u: 'https://www.nrsc.gov.in/sites/default/files/pdf/DMSP/Charter_1029_VAP_3_31july2024.pdf', tier: 'official (map product)' },
  outlook: { t: 'Outlook — Assam flood death toll rises to 139, over 24 lakh affected (28 Jun 2022, statewide)', u: 'https://www.outlookindia.com/amp/story/national/assam-flood-death-toll-rises-to-139-over-24-lakh-people-affected-news-205396', tier: 'media' },
  sentinelDrg: { t: 'The Sentinel (Assam) — 1,27,330 people of 199 villages in Darrang affected; Kuruwa Ring Bundh and Rangamati–Kuruwa bund breached (2022, exact date not verified)', u: 'https://www.sentinelassam.com/north-east-india-news/assam-news/127330-people-of-199-villages-in-darrang-district-affected-by-flood', tier: 'media (citing Water Resources Dept.)' },
  newsKur: { t: 'NE India Water Talk — Narrating an embankment breach: the Rongamati–Kuruwa (21 Jan 2024; says July 2022)', u: 'https://www.newatertalk.in/blog/narrating-an-embankment-breach-the-rongamati-kuruwa', tier: 'secondary' },
  nrcs3: { t: 'Nepal Red Cross Society — Rasuwa Situation Update 3 (28 Aug 2026, citing NDRRMA situation report)', u: 'https://website-api.nrcs.org/media/highlights/files/Rasuwa_Situation_Update_3.pdf', tier: 'humanitarian (citing official)' },
  aj: { t: 'Al Jazeera — Nepal–China flood disaster: latest toll (30–31 Aug 2026, citing NDRRMA & Nepali authorities)', u: 'https://www.aljazeera.com/news/2026/8/30/nepal-china-flood-disaster-whats-the-latest-toll-how-many-are-missing', tier: 'media (citing official)' },
  mappr: { t: 'Mappr — Nepal flash flood at the Tibet border, mapped (compilation updated 22 Oct 2026; cites Nepal Police & NDRRMA bulletins)', u: 'https://www.mappr.co/nepal-flash-flood-rasuwagadhi/', tier: 'secondary compilation' },
  earthsky: { t: 'EarthSky — Nepal flash flood: what caused it? (USGS signal time 08:37 NPT, 26 Aug 2026)', u: 'https://earthsky.org/earth/nepal-flash-flood-glacier-collapse-landslide-aug-26-2026/', tier: 'media (citing USGS)' },
  vaj: { t: 'Vajiram & Ravi — Nepal Flood 2026 (early secondary summary; superseded)', u: 'https://vajiramandravi.com/current-affairs/nepal-flood/', tier: 'secondary' },
  undp: { t: 'UNDP — Nepal Floods 2026', u: 'https://www.undp.org/node/601766', tier: 'UN agency' },
  cems927: { t: 'Copernicus EMS Rapid Mapping EMSR927 — Flood in Nepal, AOI02 Timure grading product v2 (delivered 28 Aug 2026; Legion VHR image 27 Aug 2026)', u: 'https://rapidmapping.emergency.copernicus.eu/EMSR927/', tier: 'official (map product)' },
};
/* Event facts: one record per source and metric. Defaults = latest record of the most authoritative tier for that metric+scope;
   older and conflicting values are kept so the history of the reported figures stays visible. */
const TIER_RANK = { official: 0, 'official (map product)': 0, 'humanitarian (citing official)': 1, 'media (citing official)': 1, 'UN agency': 1, 'media (citing GSI)': 2, 'media (citing USGS)': 2, 'media (citing Water Resources Dept.)': 2, media: 3, 'secondary compilation': 4, secondary: 5 };
const FACTS = {
  dehradun: [
    { m: 'Deaths', v: '24', scope: 'Dehradun district', date: '2025-09-18', src: 'etv' },
    { m: 'Missing', v: '16', scope: 'Dehradun district', date: '2025-09-18', src: 'etv' },
    { m: 'Deaths', v: '13', scope: 'Dehradun district', date: '2025-09-16', src: 'tribuneDdn', note: 'early count' },
    { m: 'Deaths', v: '21', scope: 'Uttarakhand (statewide)', date: '2025-09-17', src: 'dhDdn' },
    { m: 'Bridges destroyed at Sahastradhara', v: '2', scope: 'Sahastradhara', date: '2025-09-18', src: 'etv', note: 'which OSM bridges is not identified' },
  ],
  wayanad: [
    { m: 'Deaths', v: '231 bodies recovered', scope: 'Meppadi landslides', date: '2024-08-06', src: 'wiki', note: 'first-week count cited by Wikipedia; infobox gives 420, lead 254 — conflicting' },
    { m: 'Missing', v: '118', scope: 'Meppadi landslides', date: '2024-08', src: 'wiki', note: 'Wikipedia infobox gives 47 — conflicting' },
    { m: 'Injured', v: '397', scope: 'Meppadi landslides', date: '2024-08', src: 'wiki' },
    { m: 'Buildings damaged', v: '1,555+', scope: 'Meppadi landslides', date: '2024-08', src: 'wiki' },
    { m: 'Rainfall, two consecutive 24 h', v: '204.5 + 372.6 mm', scope: 'Wayanad', date: '2024-07-30', src: 'wiki', note: 'measuring agency not named in source' },
    { m: 'Debris-flow source elevation', v: '≈1,544 m', scope: 'Punnappuzha headwaters', date: '2024-08-10', src: 'gsiWyd' },
    { m: 'Runout length', v: '≈7 km', scope: 'Punnappuzha valley', date: '2024-08-10', src: 'gsiWyd' },
  ],
  assam: [
    { m: 'People affected', v: '24.92 lakh in 28 districts', scope: 'Assam (statewide)', date: '2022-06-28', src: 'outlook' },
    { m: 'Season death toll', v: '139', scope: 'Assam (statewide)', date: '2022-06-28', src: 'outlook' },
    { m: 'People affected', v: '1,27,330 in 199 villages', scope: 'Darrang district (first wave)', date: '2022 (not verified)', src: 'sentinelDrg' },
    { m: 'In relief camps', v: '8,550', scope: 'Darrang district', date: '2022 (not verified)', src: 'sentinelDrg' },
    { m: 'Embankment breach', v: 'Kuruwa Ring Bundh (60 m) and Rangamati–Kuruwa bund', scope: 'Kuruwa, Sipajhar (Darrang)', date: '2022 (not verified)', src: 'sentinelDrg', note: 'NE Water Talk places the Rongamati–Kuruwa breach at Lenga in July 2022 — month conflicts' },
  ],
  delhi: [ { m: 'Real event?', v: 'No — hypothetical exercise', scope: '', date: '', src: null }, { m: 'Setting', v: 'High seismic hazard, dense older housing (scenario premise)', scope: '', date: '', src: null } ],
  nepal: [
    { m: 'Deaths', v: '1,457 bodies recovered', scope: 'Nepal', date: '2026-10-10', src: 'mappr', note: 'Nepal Police 06:00 bulletin as compiled by Mappr' },
    { m: 'Missing', v: '4,720', scope: 'Nepal', date: '2026-10-10', src: 'mappr', note: 'Nepal Police; NDRRMA ledger lists 5,285 unaccounted (7 Oct) — separate ledgers' },
    { m: 'Deaths', v: '≥1,455', scope: 'Nepal', date: '2026-10-07', src: 'mappr', note: 'NDRRMA via cabinet decision' },
    { m: 'Deaths', v: '903', scope: 'Nepal', date: '2026-08-31', src: 'aj', note: 'NDRRMA' },
    { m: 'Missing', v: '2,498', scope: 'Nepal', date: '2026-08-30', src: 'aj' },
    { m: 'Deaths', v: '579', scope: 'Nepal', date: '2026-08-28', src: 'nrcs3', note: 'NDRRMA situation report' },
    { m: 'Missing', v: '1,924', scope: 'Nepal', date: '2026-08-28', src: 'nrcs3' },
    { m: 'Deaths', v: '165+', scope: 'Nepal & China', date: '2026-08 (early)', src: 'vaj', note: 'early secondary summary, superseded' },
    { m: 'Collapse time', v: '08:37 NPT, 26 Aug 2026', scope: 'Langtang Lirung (north side) → Lhende Khola', date: '2026-08-27', src: 'earthsky' },
    { m: 'Buildings affected', v: '431 of 441 inventoried (372 destroyed, 33 damaged, 26 possibly damaged)', scope: 'Timure (CEMS AOI02, 2.97 km²)', date: '2026-08-28', src: 'cems927' },
    { m: 'Population in mapped area', v: '≈500, of which ≈450 affected (CEMS estimate)', scope: 'Timure (CEMS AOI02, 2.97 km²)', date: '2026-08-28', src: 'cems927' },
    { m: 'Mass-movement / flood trace', v: '129.4 ha', scope: 'Timure (CEMS AOI02, 2.97 km²)', date: '2026-08-28', src: 'cems927' },
    { m: 'Rasuwagadhi Hydropower Dam', v: 'Destroyed', scope: 'Timure (CEMS AOI02, 2.97 km²)', date: '2026-08-28', src: 'cems927' },
    { m: 'Primary road', v: '4.8 of 4.8 km affected', scope: 'Timure (CEMS AOI02, 2.97 km²)', date: '2026-08-28', src: 'cems927' },
    { m: 'Trigger', v: 'Flash flood reportedly triggered by a glacial lake outburst (GLOF)', scope: 'Rasuwa', date: '2026-08-26', src: 'cems927', note: 'EarthSky (citing USGS) describes a glacier collapse / landslide into the Lhende Khola — the mechanism differs between sources' },
  ],
};
function factDefaults(id) {
  const F = FACTS[id] || [], by = {};
  for (const f of F) { const key = f.m + '|' + f.scope, r = f.src ? (TIER_RANK[SRC[f.src].tier] ?? 6) : 0, cur = by[key]; if (!cur || f.date > cur.f.date || (f.date === cur.f.date && r < cur.r)) by[key] = { f, r }; }
  // collapse metric to the record with the finest local scope that is current
  return Object.values(by).map(o => o.f).filter((f, i, arr) => !(f.note || '').includes('superseded'));
}


const SCENARIOS = [
{
  id: 'dehradun', tab: 'Dehradun', name: 'Dehradun cloudburst', code: 'UK-DDN-2025-0915',
  place: 'Sahastradhara – Maldevta, Dehradun, Uttarakhand', lat: 30.383, lon: 78.135, S: 5000, vex: 1.35, vexReal: 1.4, env: 'suburban',
  start: '15–16 Sep 2025, night (IST)', type: 'Cloudburst → flash flood & debris flow on the Song and Baldi rivers',
  sources: ['etv', 'tribuneDdn', 'dhDdn'], cond: { rain: 'Extreme (cloudburst)', wind: 18, water: 'Flash flood, Song & Baldi', vis: 'Night, heavy rain', temp: 22 },
  fleet: { h: 300, fov: 110, k: 1, target: 0.95 }, people: 230, devFrac: 0.6, maxSlope: 0.42, teamKmh: 12, occ: 5,
  gen(T, N, R) {
    const h = T.S / 2, M = { buildings: [], labels: [], clusters: [], dmg: [CLS.DEBRIS, CLS.RUBBLE], maxSlope: 0.42 };
    const song = meander([-300, h + 80], [380, -h - 80], 70, 260, N, 1.3), jn = pointAt(song, 0.46);
    const baldi = meander([h + 80, 1150], [jn.x, jn.y], 50, 170, N, 4.1);
    const det = (x, y, d) => 30 * (N.ridge(x / 170 + 5, y / 170 + 3, 3) - 0.62) * smooth(40, 200, d) + 9 * N.fbm(x / 60, y / 60, 2);
    const EL = (x, y, d) => 640 + 560 * Math.min(1.7, Math.max(-0.4, (y + h) / T.S)) + 380 * N.ridge(x / 1500 + 3.3, y / 1500 + 1.1, 5) + 55 * N.fbm(x / 280, y / 280, 4) - 230 * Math.exp(-((d / 360) ** 2)) - 10 * Math.exp(-((d / 45) ** 2)) + det(x, y, d);
    const songX = extendPL(song, T.S * 2), baldiX = extendPL(baldi, T.S * 2, 'start');
    M.elevFn = (x, y) => EL(x, y, Math.min(distPL(x, y, songX).d, distPL(x, y, baldiX).d));
    forEachV(T, (i, j, x, y, k) => {
      const d = Math.min(distPL(x, y, song).d, distPL(x, y, baldi).d);
      let e = EL(x, y, d);
      T.elev[k] = e; T.pre[k] = e + 4 * Math.exp(-((d / 60) ** 2));
      const wob = N.n2(x / 95, y / 95) * 28;
      T.cls[k] = d < 15 ? CLS.WATER : (d < 72 + wob ? CLS.DEBRIS : CLS.OPEN); T.preCls[k] = d < 9 ? CLS.WATER : CLS.OPEN;
    });
    finishSlope(T);
    const road = offsetPL(song, -190); M.roads = [road];
    markLine(T, road, 10, CLS.ROAD, k => T.cls[k] === CLS.OPEN);
    vegetate(T, N, { forestNoise: -0.04, rockSlope: 0.95, scale: 420 });
    const towns = [{ n: 'Maldevta', pl: song, f: 0.24, off: 160, c: 70, r: 260 }, { n: 'Sahastradhara', pl: baldi, f: 0.6, off: -150, c: 85, r: 270 }, { n: 'Karligad', pl: song, f: 0.74, off: 170, c: 50, r: 210 }, { n: 'Kesarwala', pl: baldi, f: 0.28, off: 180, c: 35, r: 180 }];
    for (const t of towns) {
      const p = pointAt(t.pl, t.f), c = [p.x + p.nx * t.off, p.y + p.ny * t.off];
      placeTown(T, R, c, t.c, t.r, M, { name: t.n, occ: 5 }); M.labels.push({ x: c[0], y: c[1], t: t.n, k: 'town' });
      M.clusters.push({ x: p.x, y: p.y, sd: 120, share: 0.17 }, { x: c[0], y: c[1], sd: 160, share: 0.07 });
    }
    const sp = pointAt(baldi, 0.52); M.clusters.push({ x: sp.x, y: sp.y, sd: 70, share: 0.06, tag: 'tourists' });
    const sl = pointAt(song, 0.07), bl = pointAt(baldi, 0.18);
    M.labels.push({ x: sl.x + 140, y: sl.y, t: 'Song River', k: 'water' }, { x: bl.x, y: bl.y + 110, t: 'Baldi River', k: 'water' }, { x: sp.x, y: sp.y, t: 'Sahastradhara pools (bridges lost)', k: 'event' });
    M.icp = [-1750, -1900]; M.incident = [sp.x, sp.y]; M.rivers = [song, baldi]; return M;
  }
},
{
  id: 'wayanad', tab: 'Wayanad', name: 'Wayanad landslides', code: 'KL-WYD-2024-0730',
  place: 'Mundakkai – Chooralmala, Meppadi, Wayanad, Kerala', lat: 11.49, lon: 76.15, S: 5000, vex: 1.3, vexReal: 1.4, env: 'suburban',
  start: '30 Jul 2024, 02:17 & 04:10 IST', type: 'Two debris-flow landslides, Punnappuzha valley (Chaliyar basin)',
  sources: ['wiki', 'gsiWyd', 'nrscWyd'], cond: { rain: '372.6 mm / 24 h', wind: 20, water: 'Debris flow, Punnappuzha', vis: 'Night, heavy rain', temp: 20 },
  fleet: { h: 400, fov: 110, k: 1 }, people: 420, devFrac: 0.45, maxSlope: 0.5, teamKmh: 6, occ: 5,
  gen(T, N, R) {
    const h = T.S / 2, M = { buildings: [], labels: [], clusters: [], dmg: [CLS.DEBRIS, CLS.RUBBLE], maxSlope: 0.5 };
    const riv = meander([1900, 2100], [-2250, -2050], 70, 220, N, 2.2);
    const det = (x, y, d) => 32 * (N.ridge(x / 160 + 2, y / 160 + 8, 3) - 0.62) * smooth(30, 220, d) + 8 * N.fbm(x / 55, y / 55, 2);
    const EL = (x, y, d) => { const dg = Math.min(1.5, Math.max(-1.5, (x + y) / T.S)); return 820 + 640 * (dg + 1) + 300 * N.ridge(x / 1250 + 1.7, y / 1250 + 4.2, 5) + 50 * N.fbm(x / 240, y / 240, 4) - 260 * Math.exp(-((d / 460) ** 2)) - 8 * Math.exp(-((d / 40) ** 2)) + det(x, y, d); };
    const rivX = extendPL(riv, T.S * 2, 'end');
    M.elevFn = (x, y) => EL(x, y, distPL(x, y, rivX).d);
    forEachV(T, (i, j, x, y, k) => {
      const r = distPL(x, y, riv), f = r.s / r.L, d = r.d, diag = (x + y) / T.S;
      let e = EL(x, y, d);
      T.elev[k] = e; T.pre[k] = e + 10 * Math.exp(-((d / 120) ** 2)) * smooth(0.04, 0.4, f);
      const w = 50 + 330 * smooth(0.04, 0.72, f), wob = 1 + 0.28 * N.n2(x / 110, y / 110);
      T.cls[k] = d < 13 ? CLS.WATER : ((f > 0.03 && f < 0.9 && d < w * wob) || (f < 0.06 && d < 190) ? CLS.DEBRIS : CLS.OPEN);
      T.preCls[k] = d < 8 ? CLS.WATER : CLS.OPEN;
    });
    finishSlope(T);
    forEachV(T, (i, j, x, y, k) => { if (T.cls[k] === CLS.OPEN && T.elev[k] > 900 && T.elev[k] < 1450 && T.slope[k] < 0.75 && N.fbm(x / 700 + 2, y / 700, 3) > 0.02) T.cls[k] = CLS.FARM; });
    vegetate(T, N, { forestNoise: -0.3, rockSlope: 1.3, scale: 380 });
    const road = offsetPL(subPL(riv, 0.3, 1), -230); M.roads = [road]; markLine(T, road, 9, CLS.ROAD, k => T.cls[k] !== CLS.WATER && T.cls[k] !== CLS.DEBRIS);
    const towns = [{ n: 'Punchirimattom', f: 0.14, off: 160, c: 30, r: 160 }, { n: 'Mundakkai', f: 0.4, off: 190, c: 95, r: 280 }, { n: 'Chooralmala', f: 0.68, off: -170, c: 110, r: 300 }, { n: 'Attamala', f: 0.83, off: 300, c: 40, r: 180 }];
    for (const t of towns) {
      const p = pointAt(riv, t.f), c = [p.x + p.nx * t.off, p.y + p.ny * t.off];
      placeTown(T, R, c, t.c, t.r, M, { name: t.n, occ: 5 }); M.labels.push({ x: c[0], y: c[1], t: t.n, k: 'town' });
      M.clusters.push({ x: p.x, y: p.y, sd: 140, share: 0.17 }, { x: c[0], y: c[1], sd: 170, share: 0.07 });
    }
    const cr = pointAt(riv, 0.03), lb = pointAt(riv, 0.55);
    M.labels.push({ x: cr.x, y: cr.y, t: 'Landslide crown ≈1,544 m', k: 'event' }, { x: lb.x + 200, y: lb.y, t: 'Punnappuzha', k: 'water' });
    M.icp = [-2000, -500]; M.incident = [cr.x, cr.y]; M.rivers = [riv]; return M;
  }
},
{
  id: 'assam', tab: 'Assam', name: 'Assam floods — Kuruwa breach', code: 'AS-DRG-2022-06',
  place: 'Kurua, Sipajhar, Darrang, Assam (Brahmaputra north bank); breach point approximate', lat: 26.45, lon: 91.25, S: 6000, vex: 6, vexReal: 2, env: 'suburban',
  start: 'Jun 2022 (monsoon)', type: 'Riverine flood with embankment breaches at Kuruwa (Brahmaputra)',
  sources: ['sentinelDrg', 'newsKur', 'outlook'], cond: { rain: 'Persistent monsoon rain', wind: 12, water: 'Brahmaputra in flood; inundation mapped by Sentinel-1 (30 Jun 2022)', vis: 'Moderate', temp: 31 },
  fleet: { h: 300, fov: 120, k: 1 }, people: 650, Kmax: 36, h: 320, devFrac: 0.7, maxSlope: 0.3, teamKmh: 5, occ: 6,
  gen(T, N, R) {
    const h = T.S / 2, WL = 55.6, M = { buildings: [], labels: [], clusters: [], dmg: [CLS.WATER], maxSlope: 0.3, water: WL, nearR: 220 };
    const main = meander([-h - 100, 700], [h + 100, 1000], 70, 420, N, 3.3), sub = meander([-h - 100, 1500], [h + 100, 300], 70, 330, N, 6.6);
    const emb = meander([-h - 100, -300], [h + 100, -120], 40, 140, N, 9.1), bp = pointAt(emb, 0.38);
    const V = [[-2200, -900, 3.6], [-1500, -1700, 3.2], [-700, -700, 0.9], [-300, -1300, 1.1], [400, -900, 3.4], [1200, -1600, 3.8], [2000, -800, 1.1], [2400, -2100, 3.5], [-2400, -2300, 3.0], [600, -2300, 3.6], [-1200, 2300, 3.4], [1500, 2200, 1.2]];
    const chars = [[-900, 1150], [1300, 820]];
    const EL = (x, y, dm, ds) => 55.0 + 1.7 * N.fbm(x / 900, y / 900, 4) + 0.8 * N.fbm(x / 220, y / 220, 3) + (y < 0 ? Math.min(2, -y / h) * 1.4 : 0) - 6.5 * Math.exp(-((dm / 430) ** 2)) - 4 * Math.exp(-((ds / 240) ** 2));
    const mainX = extendPL(main, T.S * 2), subX = extendPL(sub, T.S * 2), embX = extendPL(emb, T.S * 2);
    M.elevFn = (x, y) => { let e = EL(x, y, distPL(x, y, mainX).d, distPL(x, y, subX).d); if (distPL(x, y, embX).d < 28) e = Math.max(e, 58.8); return e; };
    forEachV(T, (i, j, x, y, k) => {
      const dm = distPL(x, y, main).d, ds = distPL(x, y, sub).d, de = distPL(x, y, emb).d;
      let e = EL(x, y, dm, ds);
      const pre = e;
      e -= 1.4 * Math.exp(-(((x - bp.x) ** 2 + (y - bp.y + 500) ** 2) / (900 ** 2)));
      for (const v of V) e += v[2] * Math.exp(-((x - v[0]) ** 2 + (y - v[1]) ** 2) / (170 ** 2));
      for (const c of chars) { const r2 = (x - c[0]) ** 2 + (y - c[1]) ** 2; if (r2 < 170 ** 2) e = Math.max(e, 56.3 - r2 / (170 ** 2) * 0.9); }
      const inB = Math.hypot(x - bp.x, y - bp.y) < 260;
      if (de < 28 && !inB) e = Math.max(e, 58.8);
      T.elev[k] = e; T.pre[k] = de < 28 ? Math.max(pre, 58.8) : e;
      T.cls[k] = e < WL ? CLS.WATER : (de < 28 && !inB ? CLS.ROAD : CLS.FARM);
      T.preCls[k] = (dm < 260 || ds < 120) ? CLS.WATER : (de < 28 ? CLS.ROAD : CLS.FARM);
    });
    finishSlope(T);
    forEachV(T, (i, j, x, y, k) => { if (T.cls[k] === CLS.FARM && N.fbm(x / 300 + 4, y / 300, 3) > 0.28) T.cls[k] = CLS.FOREST; });
    V.forEach((v, n) => { const fl = v[2] < 1.5; placeTown(T, R, [v[0], v[1]], 26 + (n % 3) * 4, 160, M, { name: fl ? 'Inundated village' : 'Village', allowWater: true, h: [4.5, 6], w: [7, 11], occ: 6, maxSlope: 2 }); if (fl) M.labels.push({ x: v[0], y: v[1], t: 'Inundated village', k: 'event' }); });
    for (const b of M.buildings) b.flood = b.base < WL;
    M.labels.push({ x: bp.x, y: bp.y - 120, t: 'Embankment breach (Kuruwa)', k: 'event' }, { x: 0, y: 1100, t: 'Beki / Brahmaputra channels', k: 'water' }, { x: chars[0][0], y: chars[0][1] + 160, t: 'Char (river island)', k: 'town' });
    const embP = emb;
    M.sample = (R2) => {
      const u = R2();
      if (u < 0.45) { const hs = M.buildings.filter(b => b.flood); if (!hs.length) return null; const b = hs[Math.floor(R2() * hs.length)]; return { x: b.x + (R2() - 0.5) * b.w * 0.6, y: b.y + (R2() - 0.5) * b.d * 0.6, roofH: b.h, prio: 3 }; }
      if (u < 0.7) { const v = V.filter(q => q[2] > 2)[Math.floor(R2() * 8)]; if (!v) return null; return { x: v[0] + gauss(R2) * 90, y: v[1] + gauss(R2) * 90 }; }
      if (u < 0.8) { const c = chars[Math.floor(R2() * 2)]; return { x: c[0] + gauss(R2) * 70, y: c[1] + gauss(R2) * 70, prio: 3 }; }
      if (u < 0.9) { const q = pointAt(embP, R2()); return { x: q.x + gauss(R2) * 10, y: q.y + gauss(R2) * 10, prio: 2 }; }
      return null;
    };
    M.icp = [pointAt(emb, 0.62).x, pointAt(emb, 0.62).y]; M.incident = [bp.x, bp.y]; M.rivers = [main, sub]; M.roads = [emb]; return M;
  }
},
{
  id: 'delhi', tab: 'Delhi-NCR', name: 'Delhi-NCR earthquake (hypothetical)', code: 'DL-EQ-HYPO',
  place: 'East Delhi (Shahdara – Seelampur area)', lat: 28.67, lon: 77.28, S: 2000, vex: 1, vexReal: 1, env: 'dense',
  start: 'Hypothetical scenario', type: 'Hypothetical M6.5 earthquake — partial collapse of older multi-storey blocks',
  sources: [], cond: { rain: 'None', wind: 8, water: '—', vis: 'Dust after collapse', temp: 30 },
  fleet: { h: 300, fov: 110, k: 1 }, people: 520, Kmax: 36, devFrac: 0.75, maxSlope: 0.2, teamKmh: 4, occ: 4,
  gen(T, N, R) {
    const M = { buildings: [], labels: [], clusters: [], dmg: [CLS.RUBBLE], maxSlope: 0.2, parks: [], trees: [] };
    const B = 150, RW = 18, epi = [180, -160];
    M.elevFn = (x, y) => 210 + 1.0 * N.fbm(x / 600, y / 600, 3); M.epi = epi;
    forEachV(T, (i, j, x, y, k) => { const e = 210 + 1.0 * N.fbm(x / 600, y / 600, 3); T.elev[k] = e; T.pre[k] = e; const mx = ((x + 1000) % B + B) % B, my = ((y + 1000) % B + B) % B; T.cls[k] = (mx < RW || my < RW) ? CLS.ROAD : CLS.OPEN; T.preCls[k] = T.cls[k]; });
    finishSlope(T);
    for (let bx = -1000; bx < 1000; bx += B) for (let by = -1000; by < 1000; by += B) {
      const x0 = bx + RW, y0 = by + RW, x1 = bx + B, y1 = by + B, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      if (R() < 0.08 || Math.hypot(cx + 760, cy - 690) < 100) { M.parks.push([cx, cy]); for (let t = 0; t < 26; t++) { const a = R() * 6.28, rr = 45 + R() * 18; M.trees.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } continue; }
      const L = 5, ls = (x1 - x0) / L;
      for (let a = 0; a < L; a++) for (let b = 0; b < L; b++) {
        if (R() < 0.1) continue;
        const x = x0 + ls * (a + 0.5), y = y0 + ls * (b + 0.5), r = Math.hypot(x - epi[0], y - epi[1]);
        const col = R() < 0.55 * Math.exp(-((r / 500) ** 2)) + 0.02, fl = 3 + Math.floor(R() ** 1.6 * 10);
        M.buildings.push({ x, y, w: ls * (0.72 + R() * 0.18), d: ls * (0.72 + R() * 0.18), h: col ? 3 : fl * 3.2, h0: fl * 3.2, rot: 0, collapsed: col, base: elevAt(T, x, y), dz: r < 650, occ: fl * 4 * 0.35 });
      }
    }
    M.sample = (R2) => {
      const u = R2();
      if (u < 0.62) { const cs = M.buildings.filter(b => b.collapsed); const b = cs[Math.floor(R2() * cs.length)]; return { x: b.x + (R2() - 0.5) * b.w * 0.7, y: b.y + (R2() - 0.5) * b.d * 0.7, prio: 3 }; }
      if (u < 0.82) { const cs = M.buildings.filter(b => !b.collapsed && b.dz); const b = cs[Math.floor(R2() * cs.length)]; return { x: b.x + (R2() - 0.5) * b.w * 0.6, y: b.y + (R2() - 0.5) * b.d * 0.6, prio: 2 }; }
      const a = R2() * 6.28, rr = Math.sqrt(R2()) * 700, x = epi[0] + Math.cos(a) * rr, y = epi[1] + Math.sin(a) * rr; const gx = Math.round((x + 1000 - 9) / B) * B - 1000 + 9; return { x: R2() < 0.5 ? gx : x, y: R2() < 0.5 ? y : Math.round((y + 1000 - 9) / B) * B - 1000 + 9, prio: 1 };
    };
    M.sites = () => { const s = []; for (let gx = -1000 + 9; gx < 1000; gx += B) for (let gy = -1000 + 9; gy < 1000; gy += B) s.push([gx, gy]); M.parks.forEach(p => s.push(p)); return s; };
    M.labels.push({ x: epi[0], y: epi[1], t: 'Heaviest collapse zone', k: 'event' }, { x: -760, y: 690, t: 'Relief ground', k: 'town' });
    M.icp = [-760, 690]; M.incident = epi; M.rivers = []; M.roads = []; return M;
  }
},
{
  id: 'nepal', tab: 'Nepal', name: 'Nepal glacier-collapse flood', code: 'NP-RSW-2026-0826',
  place: 'Bhotekoshi valley, Rasuwa district, Nepal (Rasuwagadhi – Timure)', lat: 28.25, lon: 85.375, S: 5000, vex: 1, vexReal: 1, env: 'suburban',
  start: '26 Aug 2026, 08:37 NPT', type: 'Glacier & rock collapse → ice-rock avalanche, debris flow and flood down the Lhende Khola – Bhotekoshi – Trishuli',
  sources: ['mappr', 'aj', 'nrcs3', 'earthsky', 'undp', 'vaj'], cond: { rain: 'Moderate', wind: 25, water: 'Debris flow, Bhotekoshi', vis: 'Dust / debris haze', temp: 14 },
  fleet: { h: 200, fov: 110, k: 1, target: 0.95 }, people: 380, devFrac: 0.8, maxSlope: 0.7, teamKmh: 4, occ: 6,
  gen(T, N, R) {
    const h = T.S / 2, M = { buildings: [], labels: [], clusters: [], dmg: [CLS.DEBRIS, CLS.RUBBLE], maxSlope: 0.7 };
    const riv = meander([-120, h + 80], [200, -h - 80], 70, 300, N, 5.5);
    const ter = []; const T0 = (f, off, r, hh, n) => { const p = pointAt(riv, f); const t = { x: p.x + p.nx * off, y: p.y + p.ny * off, r, h: hh, n, f }; ter.push(t); return t; };
    const det = (x, y, d) => 55 * (N.ridge(x / 190 + 4, y / 190 + 1, 3) - 0.62) * smooth(60, 300, d) + 12 * N.fbm(x / 60, y / 60, 2);
    const EL = (x, y, d, f) => { const bed = 1980 - 380 * Math.max(-0.8, Math.min(1.8, f)); return bed + 1850 * (1 - Math.exp(-((d / 820) ** 2))) + 650 * N.ridge(x / 1200 + 2, y / 1200 + 7, 5) * (1 - Math.exp(-((d / 500) ** 2))) + 45 * N.fbm(x / 200, y / 200, 4) + det(x, y, d); };
    const rivX = extendPL(riv, T.S * 2), pre0 = T.S * 2, L0 = plLen(riv);
    M.elevFn = (x, y) => { const r = distPL(x, y, rivX); return EL(x, y, r.d, (r.s - pre0) / L0); };
    const rg = T0(0.1, 260, 190, 70, 'Rasuwagadhi (border point)'), ti = T0(0.33, 280, 230, 60, 'Timure'), hw = T0(0.58, -170, 150, 25, 'Hydropower headworks'), ic = T0(0.9, 340, 220, 95, 'Relief helipad');
    forEachV(T, (i, j, x, y, k) => {
      const r = distPL(x, y, riv), f = r.s / r.L, d = r.d, bed = 1980 - 380 * f;
      let e = EL(x, y, d, f);
      for (const t of ter) { const m = Math.exp(-(((x - t.x) ** 2 + (y - t.y) ** 2) / (t.r ** 2))); e = e * (1 - m) + (bed + t.h) * m; }
      T.elev[k] = e; T.pre[k] = e + 8 * Math.exp(-((d / 90) ** 2));
      T.cls[k] = d < 18 ? CLS.WATER : (d < 115 + 35 * N.n2(x / 120, y / 120) ? CLS.DEBRIS : CLS.OPEN); T.preCls[k] = d < 14 ? CLS.WATER : CLS.OPEN;
    });
    finishSlope(T);
    const hwy = offsetPL(riv, 200); M.roads = [hwy]; markLine(T, hwy, 9, CLS.ROAD, k => T.cls[k] === CLS.OPEN);
    vegetate(T, N, { forestNoise: -0.12, rockSlope: 1.25, scale: 380, snow: 3350, treeLine: 3150 });
    for (const t of ter) { if (t === ic) continue; placeTown(T, R, [t.x, t.y], t === hw ? 22 : 42, t.r * 0.9, M, { name: t.n, occ: 6, maxSlope: 1.2, collapseP: t === hw ? 0.6 : 0 }); M.labels.push({ x: t.x, y: t.y, t: t.n, k: 'town' }); }
    const pt = f => pointAt(riv, f);
    M.clusters.push({ x: pt(0.33).x, y: pt(0.33).y, sd: 130, share: 0.18 }, { x: hw.x, y: hw.y, sd: 90, share: 0.17 }, { x: rg.x, y: rg.y, sd: 110, share: 0.2, tag: 'tourists' }, { line: hwy, f0: 0.12, f1: 0.82, sd: 25, share: 0.2, tag: 'vehicles' }, { x: ti.x, y: ti.y, sd: 150, share: 0.07 });
    M.labels.push({ x: pt(0.05).x + 160, y: pt(0.05).y, t: 'Bhotekoshi', k: 'water' }, { x: ic.x, y: ic.y, t: 'Relief helipad', k: 'town' });
    M.icp = [ic.x, ic.y]; M.incident = [pt(0.02).x, pt(0.02).y]; M.rivers = [riv]; return M;
  }
}];

function buildTerrain(sc, G) {
  const T = makeT(sc.S, G || 225), N = makeNoise(sc.id.length * 97 + 11), R = mulberry32(sc.id.charCodeAt(0) * 131 + 7);
  const M = sc.gen(T, N, R);
  rasterizeBuildings(T, M); ensureICP(T, M);
  T.vex = sc.vex; T.bvex = Math.min(sc.vex, 1.6); T.real = false;
  return { T, M };
}

SCENARIOS.forEach(sc => { sc.facts = FACTS[sc.id] || []; sc.reported = factDefaults(sc.id).map(f => [f.m + (f.scope ? ' · ' + f.scope : ''), f.v, f.src, f.date]); sc.v3 = { lat: sc.lat, lon: sc.lon, S: sc.S }; });
const isFlood = M => !!(M.flood || M.water != null);
A.core = { isFlood, FACTS, TIER_RANK, factDefaults, rasterizeBuildings, ensureICP, clamp, smooth, mulberry32, gauss, makeNoise, distPL, plLen, pointAt, offsetPL, subPL, CLS, CLS_NAME, makeT, forEachV, finishSlope, elevAt, idxAt, surfAt, ENV, PAL, SRC, SCENARIOS, buildTerrain };
})(window.ARES);
