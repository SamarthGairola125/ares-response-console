/* ARES Planner v8 — pre-sensing model (stages 1–8) driven by live / archived real-world inputs.
   Loads after core.js, model.js, datapack.js, pipeline.js (v7, unchanged) and adds A.live.
   Rule: with every factor switched off, planPre() reproduces v7 stages 1–8 exactly (tests/regression.mjs).
   Every factor is a separate switch so its effect can be measured on its own (tests/ablation.mjs).
   Everything after the modules are raised (stages 9–11: sensing, belief update, handover) is left to v7 / the hardware. */
(function (A) {
'use strict';
const C = A.core, Mo = A.model, Pi = A.pipe, { CLS, clamp, idxAt, elevAt, mulberry32 } = C;

/* ---------- factor switches ---------- */
const FACTORS = {
  alerts:     'Live alert feeds open and time the incident (NDMA Sachet, GDACS, USGS, NASA FIRMS)',
  weather:    'Real wind at hover height, tether blow-down, cloud base and visibility (Open-Meteo forecast / ERA5)',
  robust:     'Plan across every hour of the 24 h window, time-weighted (live: forecast ensemble P75 wind per hour)',
  heights:    'Choose each module\'s height (100–400 m) together with its site',
  occupancy:  'Time-of-day occupancy: homes at night, schools/markets/offices by day',
  facilities: 'Hospitals, schools and colleges in or near the hazard get top priority',
  fairness:   'Minimum coverage for every named settlement with people at risk',
  airspace:   'No launch inside airport / heliport clearance zones (OurAirports)',
  routing:    'Team travel times on the real road network (OSRM), hazard-cut routes re-routed',
  imaging:    'Next Sentinel-1/2 passes over the area (re-assessment time)',
  popfusion:  'Population from WorldPop and Meta HRSL combined, disagreement reported',
  constraints:'Operator no-go and must-cover zones and command-post override',
  aircraft:   'Low-flying aircraft and rescue helicopters (ADS-B) → corridor no-launch zones (live only)',
  gnss:       'GPS jamming (gpsjam.org) and space weather (Kp) → hover drift and position advisory',
  radar:      'Weather-radar nowcast (RainViewer) for the first two hours (live only)',
};
const OFF = Object.fromEntries(Object.keys(FACTORS).map(k => [k, false]));
const ALL = Object.fromEntries(Object.keys(FACTORS).map(k => [k, true]));
/* recommended operating set: everything except population fusion, which is reported as a sensitivity (the two population maps disagree and no ground truth says which is right) */
const REC = Object.assign({}, ALL, { popfusion: false });

/* ---------- fleet / operating assumptions (config/fleet.json overrides; all are ASSUMPTIONS to replace with hardware numbers) ---------- */
const FLEET = {
  heights: [100, 150, 200, 300, 400], maxTether: 400,
  vOpMax: 15, vGustMax: 20,             // m/s at hover height: sustained / gust limits for raising and staying up
  blowRefDeg: 30, blowRefV: 15,         // tether blow-down angle reached at blowRefV (m/s)
  shearAlpha: 0.16,                     // wind-shear power-law exponent from 100 m
  tpiGain: 0.5, tpiRing: 600,           // ridge speed-up: v × (1 + gain × TPI/200), TPI from an 8-point ring (m)
  capeHold: 2000, lightningHold: 0.5,   // hold-down: CAPE (J/kg) or Open-Meteo lightning potential above these
  setupMin: 25, slowdown: 1.3,          // minutes to raise one module; disaster slowdown on OSRM free-flow times
  crewPerModule: 3, heliumM3: 35, costPerModuleINR: 18000, costPerHourINR: 1500,
  fairFloor: 0.5, fairMinPeople: 2, fairRadius: 400,
  holdShare: 0.8,                       // chance constraint: plan must reach each hour's target in ≥ 80 % of the window
  airportR: { large_airport: 5000, medium_airport: 5000, small_airport: 3000, heliport: 1000, seaplane_base: 1000, closed: 0, balloonport: 1000 },
};

/* ---------- small helpers ---------- */
const q = (arr, f) => { const a = arr.filter(v => v != null && !isNaN(v)).slice().sort((x, y) => x - y); if (!a.length) return null; const i = (a.length - 1) * f, lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); };
const toXY = (sc, lat, lon) => [(lon - sc.lon) * 111320 * Math.cos(sc.lat * Math.PI / 180), (lat - sc.lat) * 111320];
const toLL = (sc, x, y) => [sc.lat + y / 111320, sc.lon + x / (111320 * Math.cos(sc.lat * Math.PI / 180))];
function inPoly(x, y, P) { let ins = false; for (let a = 0, b = P.length - 1; a < P.length; b = a++) { const [xi, yi] = P[a], [xj, yj] = P[b]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins; } return ins; }
function tzHours(sc) { return (sc.lat > 26.3 && sc.lat < 30.5 && sc.lon > 80.0 && sc.lon < 88.3) ? 5.75 : 5.5; } // Nepal NPT, else IST

/* ---------- weather → planning conditions ---------- */
/* hourly series (from server/feeds/weather.mjs) → per-hour conditions in the ops window, plus nominal / adverse quantile conditions */
function conditions(wx, F) {
  if (!wx || !wx.hours || !wx.hours.length) return null;
  const H = wx.hours.map(h => {
    const v100 = h.wind100 != null ? h.wind100 : (h.wind120 != null ? h.wind120 * Math.pow(100 / 120, F.shearAlpha) : null);
    // cloud base: the model's own cloud-base height when the feed has it; otherwise the lifting condensation level (Espy, 125 m/°C) — used
    // ONLY in dry hours: in rain the air at 2 m is saturated by evaporating rain, so T−Td says nothing about where the cloud base is.
    const lcl = (h.t2m != null && h.td2m != null) ? Math.max(0, 125 * (h.t2m - h.td2m)) : null;
    const lowCC = h.cloudLow != null ? h.cloudLow : null, wet = h.precip != null && h.precip >= 0.2;
    let cloudBase = null, cbSrc = 'none';
    if (h.cloudBaseApi != null) { cloudBase = h.cloudBaseApi; cbSrc = 'model'; }
    else if (lcl != null && !wet) { cloudBase = lowCC != null && lowCC < 50 ? Math.max(lcl, 1500) : lcl; cbSrc = 'LCL (dry hour)'; }
    const vis = h.vis != null ? h.vis : (h.precip != null ? (h.precip < 0.1 ? 20000 : clamp(11700 * Math.pow(h.precip, -0.6), 500, 20000)) : null); // ERA5 has no visibility: rain-rate proxy
    const hold = (h.cape != null && h.cape > F.capeHold) || (h.lightning != null && h.lightning > F.lightningHold);
    return { time: h.time, v100, dir: h.dir100 != null ? h.dir100 : h.dir10, gust: h.gust, cloudBase, cbSrc, vis, visDerived: h.vis == null, precip: h.precip, hold };
  });
  const pick = f => ({ v100: q(H.map(h => h.v100), f), gust: q(H.map(h => h.gust), f), cloudBase: q(H.map(h => h.cloudBase), 1 - f), vis: q(H.map(h => h.vis), 1 - f), dir: q(H.map(h => h.dir), 0.5), precip: q(H.map(h => h.precip), f) });
  const ens = wx.ensemble && wx.ensemble.v120 && wx.ensemble.v120.length ? wx.ensemble : null;
  const adverse = pick(0.9);
  if (ens) { const all = [].concat(...ens.v120.map(m => m.filter(v => v != null))).map(v => v * Math.pow(100 / 120, F.shearAlpha)); const v90 = q(all, 0.9); if (v90 != null) adverse.v100 = Math.max(adverse.v100 || 0, v90); adverse.ensembleMembers = ens.v120.length; }
  // condition bins for time-weighted robust planning: hours with the same (wind, cloud base, visibility) class are merged
  const ensP = ens ? H.map((h, i) => { const vals = ens.v120.map(m => m[i]).filter(v => v != null).map(v => v * Math.pow(100 / 120, F.shearAlpha)); return vals.length ? q(vals, 0.75) : null; }) : null;
  const CBE = [0, 60, 100, 150, 200, 300, 400, 1e9], VE = [0, 1000, 3000, 8000, 1e9], bins = new Map();
  H.forEach((h, i) => { const v = Math.max(h.v100 || 0, ensP && ensP[i] != null ? ensP[i] : 0), vb = Math.ceil(v), cb = h.cloudBase == null ? 7 : CBE.findIndex((e, k) => h.cloudBase >= e && h.cloudBase < CBE[k + 1]), vi = h.vis == null ? 4 : VE.findIndex((e, k) => h.vis >= e && h.vis < VE[k + 1]), key = [vb, cb, vi, h.hold ? 1 : 0].join('|');
    if (!bins.has(key)) bins.set(key, { n: 0, hours: [], cond: { v100: vb, gust: h.gust, dir: h.dir, cloudBase: h.cloudBase == null ? null : CBE[cb], vis: h.vis == null ? null : Math.max(500, VE[vi]), hold: h.hold } }); const bb = bins.get(key); bb.n++; bb.hours.push(i); if (h.gust != null) bb.cond.gust = Math.max(bb.cond.gust || 0, h.gust); });
  const binList = [...bins.values()].map(bb => Object.assign(bb, { w: bb.n / H.length })).sort((x, y) => y.w - x.w);
  return { hours: H, bins: binList, ensembleUsed: !!ens, nominal: pick(0.5), adverse, levels: [0.1, 0.5, 0.75, 0.9, 1.0].map(f => Object.assign({ f }, pick(f))), source: wx.source, kind: wx.kind, holdHours: H.filter(h => h.hold).length };
}

/* per-site wind exposure from terrain (topographic position index, 8-point ring) */
function exposure(T, s, F) { let m = 0; for (let a = 0; a < 8; a++) { const x = clamp(s.x + Math.cos(a * Math.PI / 4) * F.tpiRing, -T.S / 2, T.S / 2), y = clamp(s.y + Math.sin(a * Math.PI / 4) * F.tpiRing, -T.S / 2, T.S / 2); m += elevAt(T, x, y); } const tpi = s.z0 - m / 8; return { tpi, f: 1 + F.tpiGain * clamp(tpi / 200, -0.4, 0.8) }; }
/* tethered aerostat in wind: speed at height, blow-down angle, effective height and downwind offset */
function tether(F, cond, s, h) {
  if (!cond || cond.v100 == null) return { v: null, theta: 0, hEff: h, dx: 0, dy: 0, ok: true };
  const v = cond.v100 * Math.pow(Math.max(h, 10) / 100, F.shearAlpha) * (s.expo || 1), gust = cond.gust != null ? cond.gust * (s.expo || 1) * Math.pow(Math.max(h, 10) / 10, F.shearAlpha * 0.6) : null;
  const th = Math.min(60 * Math.PI / 180, Math.atan(Math.tan(F.blowRefDeg * Math.PI / 180) * (v / F.blowRefV) ** 2));
  const to = ((cond.dir != null ? cond.dir : 0) + 180) * Math.PI / 180; // meteorological "from" → blown toward
  const off = h * Math.sin(th);
  const ok = v <= F.vOpMax && (gust == null || gust <= F.vGustMax * 1.25);
  return { v, gust, theta: th, hEff: h * Math.cos(th), dx: off * Math.sin(to), dy: off * Math.cos(to), ok };
}

/* coverage of one candidate set at one condition. With no weather it is exactly Mo.coverCells (v7). */
function coverCellsW(T, B, sites, p, E, shadow, cond, F, opt = {}) {
  if (!cond) return Mo.coverCells(T, B, sites, p, E, shadow);
  const nS = sites.length, N = B.N, CBn = B.CB, cs = B.cs, x0 = B.cx[0] - cs / 2, y0 = B.cy[0] - cs / 2, sp = new Array(nS), info = new Array(nS);
  const bc = [], bp = [];
  for (let j = 0; j < nS; j++) {
    const s = sites[j], tw = tether(F, cond, s, p.h); info[j] = tw; bc.length = 0; bp.length = 0;
    const blind = cond.cloudBase != null && cond.cloudBase < tw.hEff; // camera inside cloud
    if (!tw.ok || blind) { sp[j] = { c: new Int32Array(0), p: new Float32Array(0), blocked: !tw.ok ? 'wind' : 'cloud' }; continue; }
    const hx = s.x + tw.dx, hy = s.y + tw.dy, hz = s.z0 + tw.hEff, rMax = Mo.footR(p, tw.hEff + 400);
    const i0 = Math.max(0, Math.floor((hx - rMax - x0) / cs) - 1), i1 = Math.min(CBn - 1, Math.ceil((hx + rMax - x0) / cs) + 1), r0 = Math.max(0, Math.floor((hy - rMax - y0) / cs) - 1), r1 = Math.min(CBn - 1, Math.ceil((hy + rMax - y0) / cs) + 1);
    for (let rr = r0; rr <= r1; rr++) for (let ii = i0; ii <= i1; ii++) {
      const c = rr * CBn + ii; if (B.lam[c] < 1e-4) continue;
      const dx = B.cx[c] - hx, dy = B.cy[c] - hy; if (Math.abs(dx) > rMax || Math.abs(dy) > rMax) continue;
      const d = Math.hypot(dx, dy), r = Mo.footR(p, hz - B.cz[c]); if (d > r) continue;
      if (Mo.losObs(T, hx, hy, hz, B.cx[c], B.cy[c], B.cz[c], 16) > 2) continue;
      const R = Math.hypot(d, hz - B.cz[c]), tr = cond.vis != null ? Math.exp(-3 * R / Math.max(200, cond.vis)) : 1; // Koschmieder contrast transmission
      const P = p.P0 * Mo.camPd(p, R) * Mo.attOf(B.ccls[c], 0, p) * tr; if (P < p.pThr) continue;
      if (p.rule === 'joint') { const u = Mo.uplink(T, p, E, hx, hy, hz, B.cx[c], B.cy[c], B.cz[c], shadow(B.cx[c], B.cy[c]) * p.sigma); if (u.rx - p.sens < p.fade) continue; }
      bc.push(c); bp.push(P);
    }
    sp[j] = { c: Int32Array.from(bc), p: Float32Array.from(bp) };
  }
  return { sp, info, dense: false };
}

/* greedy weighted set cover over (site, height) candidates; choosing a site at one height removes its other heights */
function greedyGroups(sps, nS, N, w, kq, W, target, Kmax, preset = [], allow = null) {
  const nH = sps.length, cnt = new Uint8Array(N), usedSite = new Uint8Array(nS), steps = []; let cur = 0;
  const apply = (hi, j) => { const L = sps[hi][j].c; for (let t = 0; t < L.length; t++) { const c = L[t]; if (cnt[c] < kq[c]) cur += w[c] / kq[c]; cnt[c]++; } };
  preset.forEach(([hi, j]) => { usedSite[j] = 1; apply(hi, j); });
  while (cur / W < target && steps.length + preset.length < Kmax) {
    let bh = -1, bj = -1, bg = 0;
    for (let hi = 0; hi < nH; hi++) { const S = sps[hi]; for (let j = 0; j < nS; j++) { if (usedSite[j] || (allow && !allow[j])) continue; let g = 0; const L = S[j].c; for (let t = 0; t < L.length; t++) { const c = L[t]; if (cnt[c] < kq[c]) g += w[c] / kq[c]; } if (g > bg + 1e-12) { bg = g; bh = hi; bj = j; } } }
    if (bj < 0 || bg <= 1e-9) break;
    usedSite[bj] = 1; apply(bh, bj); steps.push({ site: bj, hi: bh, gain: bg / W, cov: cur / W });
  }
  return { steps, cov: cur / W, cnt };
}
/* time-weighted greedy over (site, height) candidates and weather bins: gain = Σ_bins weight × newly covered weighted need */
function greedyMulti(spsAll, wb, nS, N, w, kq, W, target, Kmax) {
  const nB = spsAll.length, nH = spsAll[0].length, cnt = spsAll.map(() => new Uint8Array(N)), usedSite = new Uint8Array(nS), steps = []; let cur = 0;
  const apply = (hi, j) => { for (let b = 0; b < nB; b++) { const L = spsAll[b][hi][j].c, cb = cnt[b]; for (let t = 0; t < L.length; t++) { const c = L[t]; if (cb[c] < kq[c]) cur += wb[b] * w[c] / kq[c]; cb[c]++; } } };
  while (cur / W < target && steps.length < Kmax) {
    let bh = -1, bj = -1, bg = 0;
    for (let hi = 0; hi < nH; hi++) for (let j = 0; j < nS; j++) { if (usedSite[j]) continue; let g = 0; for (let b = 0; b < nB; b++) { if (!wb[b]) continue; const L = spsAll[b][hi][j].c, cb = cnt[b]; let gb = 0; for (let t = 0; t < L.length; t++) { const c = L[t]; if (cb[c] < kq[c]) gb += w[c] / kq[c]; } g += wb[b] * gb; } if (g > bg + 1e-12) { bg = g; bh = hi; bj = j; } }
    if (bj < 0 || bg <= 1e-9) break;
    usedSite[bj] = 1; apply(bh, bj);
    const per = cnt.map(cb => { let v = 0; for (let c = 0; c < N; c++) if (cb[c]) v += w[c] * Math.min(cb[c], kq[c]) / kq[c]; return v / W; });
    steps.push({ site: bj, hi: bh, gain: bg / W, cov: cur / W, per });
  }
  return { steps, cov: cur / W };
}
function covOfPairs(sps, N, pairs, w, kq, W) { const cnt = new Uint8Array(N); let cur = 0; for (const [hi, j] of pairs) { const L = sps[hi][j].c; for (let t = 0; t < L.length; t++) { const c = L[t]; if (cnt[c] < kq[c]) cur += w[c] / kq[c]; cnt[c]++; } } return { cov: cur / W, cnt }; }

/* ---------- belief adjustments (stage 3) ---------- */
const NONRES_DAY = new Set(['school', 'college', 'university', 'hospital', 'commercial', 'retail', 'office', 'industrial', 'government', 'public', 'civic', 'kindergarten', 'train_station', 'transportation', 'hotel', 'temple', 'mosque', 'church', 'religious', 'kiosk', 'warehouse']);
const FACILITY = new Set(['hospital', 'school', 'college', 'university', 'clinic', 'kindergarten']);
function occupancyFactor(type, hourLocal) {
  const nonres = NONRES_DAY.has(type || '');
  if (hourLocal >= 22 || hourLocal < 6) return nonres ? (type === 'hospital' || type === 'hotel' ? 0.8 : 0.08) : 1.0;  // night: at home (hospitals/hotels staffed)
  if (hourLocal >= 9 && hourLocal < 17) return nonres ? 2.5 : 0.55;                                                     // working / school hours
  return nonres ? 0.8 : 0.9;                                                                                            // morning / evening transition
}
/* rescale building occupancy by local hour, conserving the residents of each belief cell group (people move between buildings, they do not vanish) */
function applyOccupancy(M, B0cells, hourLocal) {
  const groups = new Map(); let moved = 0, total = 0;
  for (const b of M.buildings) { const f = occupancyFactor(b.type, hourLocal); b._occ0 = b.occ; b.occ = b.occ * f; total += b._occ0; }
  // conserve the total (the AOI keeps its people; they are redistributed between homes and day-time buildings)
  let after = 0; for (const b of M.buildings) after += b.occ; const k = after > 0 ? total / after : 1; for (const b of M.buildings) { b.occ *= k; moved += Math.abs(b.occ - b._occ0); }
  return { hourLocal, total, moved: moved / 2, factor: k };
}
function restoreOccupancy(M) { for (const b of M.buildings) if (b._occ0 != null) { b.occ = b._occ0; delete b._occ0; } }

/* ---------- airspace ---------- */
function airspaceZones(sc, airports, F) {
  const out = []; for (const a of airports || []) { const r = F.airportR[a.type] || 0; if (!r) continue; const [x, y] = toXY(sc, a.lat, a.lon), d = Math.hypot(x, y); if (d - r < 6000) out.push({ id: a.ident, name: a.name, type: a.type, x, y, r, distKm: d / 1000, lat: a.lat, lon: a.lon }); } return out;
}

/* ---------- fairness: every named settlement with people at risk gets a minimum share of its need covered ---------- */
function settlementsOf(M, B, F) {
  const L = []; for (const pl of (M.places || [])) { const cells = []; let need = 0; for (let c = 0; c < B.N; c++) if (Math.hypot(B.cx[c] - pl.x, B.cy[c] - pl.y) <= F.fairRadius) { cells.push(c); need += B.lam[c]; } if (need >= F.fairMinPeople) L.push({ name: pl.name, kind: pl.kind, x: pl.x, y: pl.y, cells, need }); } return L;
}

/* ================= stages 1–8 ================= */
function planPre(sc, pIn, built, ctx = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const F = Object.assign({}, FLEET, ctx.fleet || {}), use = Object.assign({}, OFF, ctx.use || {}), notes = [], inputs = {};
  const p = Pi.prep(sc, pIn), { T, M } = built, E = C.ENV[p.env], R = mulberry32(p.seed * 977 + 3);
  let wxIn = ctx.weather;
  if (use.radar && ctx.radar && ctx.radar.rainNow && wxIn && wxIn.hours) { wxIn = Object.assign({}, wxIn, { hours: wxIn.hours.map((h, i) => i < 2 ? Object.assign({}, h, { precip: Math.max(h.precip || 0, 2) }) : h) }); notes.push('Radar shows rain at the incident now: the first two hours are planned as raining'); }
  const wxC = use.weather ? conditions(wxIn, F) : null; inputs.weather = wxC ? { source: wxC.source, kind: wxC.kind, hours: wxC.hours.length, holdHours: wxC.holdHours } : null;
  const cond = wxC ? (use.robust ? wxC.adverse : wxC.nominal) : null;
  if (cond && cond.v100 != null) { const vk = cond.v100 * Math.pow(Math.max(p.h, 10) / 100, F.shearAlpha) * 3.6; p.drift = Math.round(4 + vk * 0.35); notes.push(`Pointing drift from real wind at ${p.h} m: ${p.drift} m (v7 used an assumed ${sc.cond.wind} km/h)`); }
  if (use.gnss && ctx.gnss) { const js = ctx.gnss.jam && ctx.gnss.jam.share, kp = ctx.gnss.kp && ctx.gnss.kp.max, add = (js >= 0.1 ? 30 : js >= 0.02 ? 10 : 0) + (kp >= 7 ? 15 : kp >= 5 ? 5 : 0);
    inputs.gnss = { jamShare: js, kpMax: kp, driftAdded: add };
    if (add) { p.drift = Math.round(p.drift + add); notes.push(`GNSS degraded (jamming ${js != null ? (100 * js).toFixed(1) + ' %' : 'n/a'}, Kp ${kp != null ? kp.toFixed(1) : 'n/a'}): hover drift +${add} m; survey tether points, do not rely on GPS hold`); }
    else notes.push(`GNSS normal: jamming ${js != null ? (100 * js).toFixed(1) + ' % of aircraft affected' : 'no data'}, Kp max ${kp != null ? kp.toFixed(1) : 'n/a'}`); }
  const shadow = Mo.makeShadow(T.S, p.corr, p.seed);
  // population fusion must happen before people/belief are generated (it changes building occupancy)
  let popInfo = null;
  if (use.popfusion && ctx.popAlt && M.pack) popInfo = fusePopulation(M, ctx.popAlt);
  let occInfo = null; const evT = ctx.eventTime ? new Date(ctx.eventTime) : null;
  if (use.occupancy && evT) { const hl = ((evT.getUTCHours() + evT.getUTCMinutes() / 60 + tzHours(sc)) % 24 + 24) % 24; occInfo = applyOccupancy(M, null, hl); }
  const P = Mo.genPeople(T, M, sc, sc.people, p.devFrac, p.seed);
  const B = Mo.buildBelief(T, M, sc);
  if (occInfo) restoreOccupancy(M);
  if (popInfo) restorePopulation(M);
  const out = { sc, p, T, M, E, P, B, shadow, steps: {}, S0: T.S, ext: false, use, F, notes, inputs, cond, wx: wxC, P0: Pi.clonePeople(P), _R: R };

  // 1 detect
  const devIdx = []; for (let i = 0; i < P.n; i++) if (P.dev[i]) devIdx.push(i);
  const early = []; for (let t = 0; t < Math.min(12, devIdx.length); t++) early.push(devIdx[Math.floor(R() * devIdx.length)]);
  out.steps.detect = { alerts: (A.pipe.ALERTS || {})[sc.id] || null, incident: M.incident, early };
  if (use.alerts && ctx.alerts) { out.steps.detect.live = ctx.alerts; out.steps.detect.trigger = ctx.alerts.trigger || null; }

  // 2 evaluate
  let dmgCells = 0, water = 0; C.forEachV(T, (i, j, x, y, k) => { if (M.hazMask ? M.hazMask[k] : M.dmg.includes(T.cls[k])) dmgCells++; if (T.cls[k] === CLS.WATER) water++; });
  const cellA = T.cell * T.cell / 1e6, coll = M.buildings.filter(b => b.collapsed).length, flooded = M.buildings.filter(b => b.flood).length, obsKm2 = M.hazMask ? M.hazMask.reduce((a, v) => a + v, 0) * cellA : null;
  const sevHist = [0, 0, 0, 0, 0]; for (let c = 0; c < B.N; c++) sevHist[Math.min(4, Math.floor(B.sev[c] * 5))]++;
  out.steps.evaluate = { dmgKm2: obsKm2 != null ? obsKm2 : dmgCells * cellA, waterKm2: water * cellA, buildings: M.buildings.length, collapsed: coll, flooded, sevHist, observed: obsKm2 != null };
  if (wxC) out.steps.evaluate.rain24 = wxC.hours.reduce((a, h) => a + (h.precip || 0), 0);
  if (ctx.imagery) out.steps.evaluate.imagery = ctx.imagery.summary || null;

  // 3 belief (+ facilities, + must-cover zones)
  let facCells = 0, facList = [];
  if (use.facilities) { for (const b of M.buildings) { if (!FACILITY.has(b.type)) continue; const c = B.cellOf(b.x, b.y), k = idxAt(T, b.x, b.y), nearH = M.hazNear ? M.hazNear[k] : 0, inH = M.hazMask ? M.hazMask[k] : 0; facList.push({ type: b.type, x: b.x, y: b.y, inHazard: !!inH, nearHazard: !!nearH }); if (inH || nearH || B.dfrac[c] > 0 || B.sev[c] > 0.3) { if (B.prio[c] < 3) { B.prio[c] = 3; facCells++; } } } }
  const mustCells = new Uint8Array(B.N);
  if (use.constraints && ctx.zones) for (const z of ctx.zones.filter(z => z.kind === 'must')) { const P2 = z.xy || z.ll.map(([la, lo]) => toXY(sc, la, lo)); for (let c = 0; c < B.N; c++) if (inPoly(B.cx[c], B.cy[c], P2)) mustCells[c] = 1; }
  let lamTot = 0, p3 = 0; for (let c = 0; c < B.N; c++) { lamTot += B.lam[c]; if (B.prio[c] === 3) p3++; }
  out.steps.belief = { lamTot, p3, cellSize: B.cs, resident: B.resident, exposed: B.exposed, scale: B.scale };
  if (occInfo) out.steps.belief.occupancy = occInfo;
  if (use.facilities) out.steps.belief.facilities = { count: facList.length, raised: facCells, list: facList };
  if (popInfo) out.steps.belief.population = popInfo.report;

  // 4 koopman
  const r0 = Mo.footR(p, p.h), cellsPerNode = Math.PI * r0 * r0 / (B.cs * B.cs), effort = Math.max(1, p.Kmax * 0.6 * cellsPerNode * 0.9);
  out.steps.koopman = Object.assign(Mo.koopman(B.lam, effort), { effort, cellsPerNode, r0 });

  // 5 sites (+ airspace, + operator no-go, + low-level air traffic, + wind exposure)
  let out_aircraft = null;
  const SS = Mo.buildSites(T, M, sc);
  const extraRej = [];
  if (use.airspace && ctx.airports) { const Z = airspaceZones(sc, ctx.airports, F); out.airspace = Z; if (Z.length) { const keep = []; for (const s of SS.sites) { const z = Z.find(z => Math.hypot(s.x - z.x, s.y - z.y) < z.r); if (z) extraRej.push(Object.assign(s, { why: `Airspace: within ${(z.r / 1000).toFixed(0)} km of ${z.name}` })); else keep.push(s); } SS.sites = keep; } }
  if (use.constraints && ctx.zones) { const nogo = ctx.zones.filter(z => z.kind === 'nogo').map(z => z.xy || z.ll.map(([la, lo]) => toXY(sc, la, lo))); if (nogo.length) { const keep = []; for (const s of SS.sites) { if (nogo.some(P2 => inPoly(s.x, s.y, P2))) extraRej.push(Object.assign(s, { why: 'Responder no-go zone' })); else keep.push(s); } SS.sites = keep; } }
  if (use.aircraft && ctx.aircraft && ctx.aircraft.items && ctx.aircraft.items.length) {
    const gz = M.pack ? (M.pack.dem ? M.pack.dem.reduce((a, v) => a + v, 0) / M.pack.dem.length : 0) : 0, segs = [];
    for (const a of ctx.aircraft.items) { if (a.altFt == null || a.lat == null) continue; const [x, y] = toXY(sc, a.lat, a.lon), agl = a.altFt * 0.3048 - (Math.abs(x) < T.S / 2 && Math.abs(y) < T.S / 2 ? elevAt(T, x, y) : gz);
      if (Math.hypot(x, y) > T.S / 2 + 8000 || agl > (a.heli ? 1000 : 600)) continue;
      const tr = (a.track != null ? a.track : 0) * Math.PI / 180, L2 = a.track != null ? 3000 : 0; segs.push({ a: [x - Math.sin(tr) * L2, y - Math.cos(tr) * L2], b: [x + Math.sin(tr) * L2, y + Math.cos(tr) * L2], heli: a.heli, agl, id: a.flight || a.reg || a.hex, type: a.type, lat: a.lat, lon: a.lon, x, y, track: a.track }); }
    const dseg = (px, py, s2) => { const [ax, ay] = s2.a, [bx, by] = s2.b, vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy, t = L ? clamp(((px - ax) * vx + (py - ay) * vy) / L, 0, 1) : 0; return Math.hypot(px - ax - t * vx, py - ay - t * vy); };
    if (segs.length) { const keep = []; for (const st of SS.sites) { const z = segs.find(s2 => dseg(st.x, st.y, s2) < (s2.heli ? 600 : 400)); if (z) extraRej.push(Object.assign(st, { why: `Low-level air traffic: ${z.heli ? 'helicopter' : 'aircraft'} ${z.id} at ${Math.round(z.agl)} m AGL` })); else keep.push(st); } SS.sites = keep; }
    out_aircraft = segs; }
  SS.rejected = SS.rejected.concat(extraRej);
  if (use.constraints && ctx.icp) { M.icp = ctx.icp.xy || toXY(sc, ctx.icp.ll[0], ctx.icp.ll[1]); notes.push('Command post set by the operator'); }
  if (wxC) SS.sites.forEach(s => { const e = exposure(T, s, F); s.expo = e.f; s.tpi = e.tpi; });
  out.sites = SS.sites; out.aircraft = out_aircraft;
  const why = {}; SS.rejected.forEach(r => { const k = r.why.replace(/ \(.*/, '').replace(/ within .*/, ''); why[k] = (why[k] || 0) + 1; });
  out.steps.sites = { valid: SS.sites.length, rejected: SS.rejected, why };

  // 6 coverage — one candidate list per (weather condition, height). No weather + one height = v7 exactly.
  const H = use.heights ? F.heights.filter(h => h <= F.maxTether) : [p.h];
  const BINS = (use.robust && wxC) ? wxC.bins.map(b => ({ w: b.w, cond: b.cond, hours: b.hours, hold: b.cond.hold })) : [{ w: 1, cond, hours: wxC ? wxC.hours.map((_, i) => i) : [], hold: false }];
  const spsB = BINS.map(bn => H.map(h => { const ph = Object.assign({}, p, { h }); return (!bn.cond && h === p.h ? Mo.coverCells(T, B, SS.sites, ph, E, shadow) : coverCellsW(T, B, SS.sites, ph, E, shadow, bn.cond, F)); }));
  out.cc = spsB[0][Math.max(0, H.indexOf(p.h))]; if (!out.cc.sp) out.cc = { sp: spsB[0][0].sp };
  const sps = spsB[0].map(x => x.sp), spsAll = spsB.map(r => r.map(x => x.sp)), hiBase = Math.max(0, H.indexOf(p.h));
  const perSite = SS.sites.map((_, j) => sps[use.heights ? sps.length - 1 : 0][j].c.length);
  const blocked = { wind: 0, cloud: 0 }; spsAll.forEach((r, b) => r.forEach(S => S.forEach(l => { if (l.blocked) blocked[l.blocked] += BINS[b].w; })));
  out.steps.coverage = { perSite, r0, heights: H, blocked: { wind: +(blocked.wind / H.length).toFixed(1), cloud: +(blocked.cloud / H.length).toFixed(1) }, bins: BINS.map(b => ({ w: +b.w.toFixed(3), cond: b.cond })) };

  // 7 optimise — fewest modules reaching the target (time-weighted over the window when robust)
  const wk = Mo.weightsOf(B, p); if (use.constraints && mustCells.some(v => v)) { for (let c = 0; c < B.N; c++) if (mustCells[c]) { wk.W += wk.w[c] * 2; wk.w[c] *= 3; } } out.wk = wk;
  const anyC = new Uint8Array(B.N); for (const r of spsAll) for (const S of r) for (let j = 0; j < SS.sites.length; j++) { const L = S[j].c; for (let t = 0; t < L.length; t++) anyC[L[t]] = 1; }
  let reach = 0; for (let c = 0; c < B.N; c++) if (anyC[c]) reach += wk.w[c]; reach /= wk.W;
  const multi = BINS.length > 1 || use.heights;
  const evalPairs = pr => { let cov = 0; const frac = new Float32Array(B.N), per = []; BINS.forEach((bn, b) => { const r = covOfPairs(spsAll[b], B.N, pr, wk.w, wk.kq, wk.W); per.push(bn.hold ? 0 : r.cov); cov += bn.w * (bn.hold ? 0 : r.cov); if (!bn.hold) for (let c = 0; c < B.N; c++) if (r.cnt[c]) frac[c] += bn.w; }); return { cov, frac, per }; };
  // reach under the time weighting (best possible with every site at its best height)
  let reachT = reach; const reachB = BINS.map(() => reach);
  if (BINS.length > 1) { reachT = 0; BINS.forEach((bn, b) => { if (bn.hold) { reachB[b] = 0; return; } const a = new Uint8Array(B.N); for (const S of spsAll[b]) for (let j = 0; j < SS.sites.length; j++) { const L = S[j].c; for (let t = 0; t < L.length; t++) a[L[t]] = 1; } let rr = 0; for (let c = 0; c < B.N; c++) if (a[c]) rr += wk.w[c]; reachB[b] = rr / wk.W; reachT += bn.w * rr / wk.W; }); }
  // chance constraint: each hour is judged against what is reachable in that hour; the plan must hold in ≥ holdShare of the (non-hold) time
  const tB = reachB.map(r => Math.min(p.target, Math.max(0.05, r * 0.97))), holdShare = F.holdShare != null ? F.holdShare : 0.8, wOK = BINS.reduce((a, bn) => a + (bn.hold ? 0 : bn.w), 0) || 1;
  const shareMet = per => BINS.reduce((a, bn, b) => a + (!bn.hold && per[b] >= tB[b] - 1e-9 ? bn.w : 0), 0) / wOK;
  const tEff = Math.min(p.target, Math.max(0.05, reachT * 0.97)); out.tEff = tEff; out.reach = reachT;
  let sol, set, full, fair = null, pairs;
  if (!multi) {
    const sp = sps[0];
    full = Mo.greedy(sp, SS.sites.length, B.N, wk.w, wk.kq, wk.W, 0.999, p.Kmax + 10);
    let nSol = full.steps.findIndex(s => s.cov >= tEff); nSol = nSol < 0 ? Math.min(p.Kmax, full.steps.length) : Math.min(nSol + 1, p.Kmax);
    sol = full.steps.slice(0, nSol).map(s => Object.assign({ hi: 0 }, s)); set = sol.map(s => s.site);
  } else {
    full = greedyMulti(spsAll, BINS.map(b => b.hold ? 0 : b.w), SS.sites.length, B.N, wk.w, wk.kq, wk.W, 0.999, p.Kmax + 10);
    let nSol = full.steps.findIndex(s => shareMet(s.per) >= holdShare - 1e-9); nSol = nSol < 0 ? Math.min(p.Kmax, full.steps.length) : Math.min(nSol + 1, p.Kmax);
    sol = full.steps.slice(0, nSol); set = sol.map(s => s.site);
  }
  pairs = sol.map(s => [s.hi, s.site]);
  if (use.fairness) {
    const ST = settlementsOf(M, B, F), added = [];
    for (let guard = 0; guard < 12 && pairs.length < (p.fleetMax || 29) - 3; guard++) {
      const fr = evalPairs(pairs).frac; let worst = null, ws = 1;
      for (const s of ST) { let got = 0; for (const c of s.cells) got += B.lam[c] * fr[c]; const share = got / s.need; s.share = share; if (share < F.fairFloor && share < ws) { ws = share; worst = s; } }
      if (!worst) break;
      let bh = -1, bj = -1, bg = 0; const inS = new Set(worst.cells), used = new Set(pairs.map(x => x[1]));
      for (let hi = 0; hi < H.length; hi++) for (let j = 0; j < SS.sites.length; j++) { if (used.has(j)) continue; let g = 0; BINS.forEach((bn, b) => { if (bn.hold) return; const L = spsAll[b][hi][j].c; for (let t = 0; t < L.length; t++) if (inS.has(L[t])) g += bn.w * B.lam[L[t]] * (1 - fr[L[t]]); }); if (g > bg) { bg = g; bh = hi; bj = j; } }
      if (bj < 0 || bg < 0.5) { worst.unreachable = true; added.push('(unreachable) ' + worst.name); ST.splice(ST.indexOf(worst), 1); fair = fair || []; fair.push({ name: worst.name, kind: worst.kind, need: worst.need, share: ws, unreachable: true }); continue; }
      pairs.push([bh, bj]); const cv = evalPairs(pairs).cov; sol.push({ site: bj, hi: bh, gain: 0, cov: cv, fair: worst.name }); set.push(bj); added.push(worst.name);
    }
    const fr = evalPairs(pairs).frac; fair = (fair || []).concat(ST.map(s => { let got = 0; for (const c of s.cells) got += B.lam[c] * fr[c]; return { name: s.name, kind: s.kind, need: s.need, share: got / s.need, unreachable: false }; }));
    fair.added = added;
  }
  let best1 = 0; for (const S of sps) for (let j = 0; j < SS.sites.length; j++) { let g = 0; const L = S[j].c; for (let t = 0; t < L.length; t++) g += wk.w[L[t]] / wk.kq[L[t]]; best1 = Math.max(best1, g); }
  const lb = best1 > 0 ? Math.ceil(tEff * wk.W / best1) : null;
  const ccBase = { sp: sps[use.heights ? hiBase : 0], cov: out.cc.cov, pd: out.cc.pd, dense: out.cc.dense };
  const bl = Mo.baselines(B, SS.sites, ccBase, wk, Object.assign({}, p, { target: tEff }), mulberry32(p.seed + 99));
  const ev = multi ? evalPairs(pairs) : null, finalCov = multi ? ev.cov : (sol[sol.length - 1] || { cov: 0 }).cov;
  const shareFinal = multi ? shareMet(ev.per) : null;
  // trade-off: modules vs share of time the target holds (for the operator and the paper)
  const tradeoff = multi && full.steps[0] && full.steps[0].per ? full.steps.slice(0, Math.max(p.Kmax, 1)).map((st, i) => ({ modules: i + 1, share: +shareMet(st.per).toFixed(3), cov: +st.cov.toFixed(4) })) : null;
  const minForShare = f => { if (!tradeoff) return null; const r = tradeoff.find(t => t.share >= f - 1e-9); return r ? r.modules : null; };
  out.steps.optimise = { full, sol, set, lb, base: bl, met: multi ? shareFinal >= holdShare - 1e-9 : finalCov >= tEff - 1e-9, reach: reachT, tEff, cov: finalCov, cands: (full.cands || []).slice(0, sol.length), fair, timeWeighted: BINS.length > 1, holdShare: multi ? holdShare : null, shareOfTimeMet: shareFinal, binTargets: tB, tradeoff, modulesFor: tradeoff ? { '50%': minForShare(0.5), '80%': minForShare(0.8), '90%': minForShare(0.9), '100%': minForShare(1) } : null, budgetLimited: multi && shareFinal < holdShare - 1e-9 };
  out.sps = sps; out.spsAll = spsAll; out.BINS = BINS; out.H = H; out.pairs = pairs; out.evalPairs = evalPairs;

  // weather check of the chosen plan: coverage at P10…P100 adverse conditions and hour by hour
  if (wxC) {
    out.steps.optimise.robustness = wxC.levels.map(Lv => { const spsL = H.map(h => coverCellsW(T, B, SS.sites, Object.assign({}, p, { h }), E, shadow, Lv, F).sp); const c = covOfPairs(spsL, B.N, pairs, wk.w, wk.kq, wk.W).cov; return { f: Lv.f, v100: Lv.v100, cloudBase: Lv.cloudBase, vis: Lv.vis, cov: c, met: c >= tEff - 1e-9 }; });
    const perHour = wxC.hours.map((hr, ix) => { const L2 = Object.assign({}, hr), byH = H.map(h => { const ph = Object.assign({}, p, { h }); const pr = pairs.filter(x => H[x[0]] === h).map(x => x[1]); const cc = coverCellsW(T, B, pr.map(j => SS.sites[j]), ph, E, shadow, L2, F).sp; const full2 = new Array(SS.sites.length); pr.forEach((j, t) => full2[j] = cc[t]); return full2; }); const c = covOfPairs(byH, B.N, pairs, wk.w, wk.kq, wk.W).cov; const bi = BINS.length > 1 ? BINS.findIndex(bn => bn.hours.includes(ix)) : 0, tt = BINS.length > 1 && bi >= 0 ? tB[bi] : tEff; return { time: hr.time, cov: c, target: tt, hold: hr.hold, met: c >= tt - 1e-9 && !hr.hold, v100: hr.v100, cloudBase: hr.cloudBase }; });
    out.steps.optimise.perHour = perHour; out.steps.optimise.hoursMet = perHour.filter(h => h.met).length / Math.max(1, perHour.length);
    out.steps.optimise.meanCovOverHours = perHour.reduce((a, h) => a + (h.hold ? 0 : h.cov), 0) / Math.max(1, perHour.length);
  }

  // 8 deploy + backhaul (heights per module)
  const ph0 = Object.assign({}, p, { h: use.heights ? Math.max(...pairs.map(x => H[x[0]]).concat([p.h])) : p.h });
  const relays = Mo.addRelays(T, ph0, SS.sites, set, M.icp);
  const nodes = sol.map((s, i) => { const h = H[s.hi], site = SS.sites[s.site], tw = tether(F, wxC ? wxC.nominal : null, site, h); return { site: s.site, role: 'sense', id: 'A-' + String(i + 1).padStart(2, '0'), gain: s.gain, h, hEff: tw.hEff, offset: [tw.dx, tw.dy], vHover: tw.v, fair: s.fair || null }; })
    .concat(relays.map((j, i) => ({ site: j, role: 'relay', id: 'R-' + String(i + 1).padStart(2, '0'), gain: 0, h: ph0.h, hEff: ph0.h, offset: [0, 0] })));
  const con = Mo.connectivity(T, ph0, SS.sites, nodes.map(n => n.site), M.icp);
  if (!use.routing || !(ctx.routes || ctx.routesXY)) {
    const team = [0, 0]; nodes.forEach((n, i) => { const s = SS.sites[n.site], km = Math.hypot(s.x - M.icp[0], s.y - M.icp[1]) * 1.4 / 1000, tm = i % 2; const travel = km / sc.teamKmh * 60; team[tm] += travel + 25; n.eta = Math.round(team[tm]); n._etaRaw = team[tm]; n.team = tm ? 'B' : 'A'; n.km = km; n.hop = con.hop[i]; n.par = con.par[i]; n.marg = con.marg[i]; n.travelSrc = 'straight line × 1.4'; });
  } else {
    // real road travel (OSRM duration × slowdown) or hazard-aware terrain route when the road route crosses the hazard; list-scheduled on the team that is free first
    const nTeams = Math.max(1, ctx.teams || 2), free = new Array(nTeams).fill(0);
    nodes.forEach((n, i) => { const s = SS.sites[n.site], r = (ctx.routesXY ? ctx.routesXY[Math.round(s.x) + ',' + Math.round(s.y)] : ctx.routes[n.site]) || null; let min, km, src;
      const straight = Math.hypot(s.x - M.icp[0], s.y - M.icp[1]), offRoad = r && r.ok ? (r.snapEndM || 0) + (r.snapStartM || 0) : 0, roadOK = r && r.ok && !r.crossesHazard && r.distanceM + offRoad >= 0.8 * straight; // a road route shorter than the straight line means both ends snapped to the same road point
      if (roadOK) { const walk = offRoad / 1000 / sc.teamKmh * 60 * 1.5; min = r.durationS / 60 * F.slowdown + walk; km = (r.distanceM + offRoad) / 1000; src = offRoad > 150 ? `OSRM road + ${Math.round(offRoad)} m on foot` : 'OSRM road network'; }
      else { const rt = Mo.route(T, M, M.icp, [s.x, s.y]); km = (rt ? rt.len : Math.hypot(s.x - M.icp[0], s.y - M.icp[1]) * 1.4) / 1000; min = km / sc.teamKmh * 60; src = r && r.crossesHazard ? 'road cut by hazard → terrain route (A*)' : r && r.ok ? 'no usable road (site off the network) → terrain route (A*)' : 'terrain route (A*), no road route'; }
      let tm = 0; for (let t = 1; t < nTeams; t++) if (free[t] < free[tm]) tm = t;
      free[tm] += min + F.setupMin; n.eta = Math.round(free[tm]); n._etaRaw = free[tm]; n.team = String.fromCharCode(65 + tm); n.km = km; n.travelMin = min; n.travelSrc = src; n.hop = con.hop[i]; n.par = con.par[i]; n.marg = con.marg[i]; });
  }
  // raise schedule against hold windows (lightning / wind) — modules wait for the next safe hour
  if (wxC && evT) { const holdAt = t => { const hr = wxC.hours.find(h => Math.abs(new Date(h.time) - t) <= 30 * 60000); return hr ? (hr.hold || (hr.v100 != null && hr.v100 * Math.pow(300 / 100, F.shearAlpha) > F.vOpMax)) : false; };
    nodes.forEach(n => { let t = new Date(evT.getTime() + n.eta * 60000), wait = 0; while (holdAt(t) && wait < 24 * 60) { t = new Date(t.getTime() + 60 * 60000); wait += 60; } n.wait = wait; n.raiseAt = t.toISOString(); n.etaHeld = n.eta + wait; }); }
  // people in view over time (expected, from the plan): cumulative gain at each raise time
  const order = nodes.filter(n => n.role === 'sense').slice().sort((a, b) => (a.etaHeld || a.eta) - (b.etaHeld || b.eta));
  let acc = 0; const curve = order.map(n => { acc += n.gain || 0; return { t: n.etaHeld || n.eta, id: n.id, cov: Math.min(acc, finalCov) }; });
  out.nodes = nodes;
  const fleetN = nodes.length, crew = fleetN * F.crewPerModule, opsH = 24;
  out.steps.deploy = { relays: relays.length, con, linked: con.ok.filter(Boolean).length, curve, logistics: { modules: fleetN, crew, heliumM3: fleetN * F.heliumM3, costINR: fleetN * F.costPerModuleINR + fleetN * F.costPerHourINR * opsH, opsHours: opsH, assumptions: true }, imaging: ctx.imaging || null, airspace: out.airspace || null };
  /* Display only: the Results page and inspectors read the full site x cell table (v7 shape). Weather / per-height runs keep only the sparse lists, so rebuild the table from them. Planning above is unaffected. */
  if (out.cc && !out.cc.cov && out.cc.sp) { const N = B.N, S = out.cc.sp, cov = new Uint8Array(S.length * N), pd = new Float32Array(S.length * N); S.forEach((l, j) => { for (let t = 0; t < l.c.length; t++) { cov[j * N + l.c[t]] = 1; pd[j * N + l.c[t]] = l.p ? l.p[t] : 1; } }); out.cc = Object.assign({}, out.cc, { cov, pd, dense: true }); }
  out.ms = Math.round((typeof performance !== 'undefined' ? performance : Date).now() - t0);
  return out;
}

/* ---------- full run for the console: v8 stages 1–8, then the unchanged v7 stages 9–11 (sensing, belief update and replanning, handover) ----------
   With every input off this is identical to A.pipe.run (tests/regression.mjs). Sensing uses each module's own (effective) height. */
function senseH(out, which) {
  const { T, P, p, E, shadow } = out, sites = out.sites, nodes = out.nodes, n = P.n, nS = sites.length;
  const groups = new Map(); which.forEach(i => { const nd = nodes[i], h = nd.hEff != null ? nd.hEff : (nd.h != null ? nd.h : p.h), dx = nd.offset ? nd.offset[0] : 0, dy = nd.offset ? nd.offset[1] : 0, k = h + '|' + dx.toFixed(1) + '|' + dy.toFixed(1); if (!groups.has(k)) groups.set(k, { h, dx, dy, list: [] }); groups.get(k).list.push(nd.site); });
  let cp;
  if (groups.size === 1 && [...groups.values()][0].h === p.h && ![...groups.values()][0].dx && ![...groups.values()][0].dy) cp = Mo.coverPeople(T, P, sites, p, E, shadow, which.map(i => nodes[i].site));
  else { cp = { det: new Uint8Array(nS * n), pdv: new Float32Array(nS * n), mar: new Float32Array(nS * n).fill(NaN) };
    for (const g of groups.values()) { const shifted = g.dx || g.dy ? sites.map(s => Object.assign({}, s, { x: s.x + g.dx, y: s.y + g.dy })) : sites, c = Mo.coverPeople(T, P, shifted, Object.assign({}, p, { h: g.h }), E, shadow, g.list); for (const j of g.list) { cp.det.set(c.det.subarray(j * n, j * n + n), j * n); cp.pdv.set(c.pdv.subarray(j * n, j * n + n), j * n); cp.mar.set(c.mar.subarray(j * n, j * n + n), j * n); } } }
  out.cp = cp; const R = mulberry32(p.seed * 13 + 1);
  P.detBy = new Int16Array(n).fill(-1); P.via = new Array(n).fill(''); P.bestMar = new Float32Array(n).fill(NaN); P.inView = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const draws = []; for (let q2 = 0; q2 < which.length; q2++) draws.push(R());
    which.forEach((ni, q2) => { const j = nodes[ni].site, pd = cp.pdv[j * n + i], m = cp.mar[j * n + i]; if (pd > 0) P.inView[i] = 1; if (!isNaN(m) && (isNaN(P.bestMar[i]) || m > P.bestMar[i])) P.bestMar[i] = m; if (P.detBy[i] < 0 && cp.det[j * n + i] && draws[q2] < pd) { P.detBy[i] = ni; P.via[i] = 'thermal'; } if (P.detBy[i] < 0 && P.dev[i] && m >= p.fade) { P.detBy[i] = ni; P.via[i] = 'beacon'; } }); }
}
function runFull(sc, pIn, built, ctx = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const out = planPre(sc, pIn, built, ctx), { B, p, T, M } = out, R = out._R, nodes = out.nodes, cc = out.cc, sites = out.sites;
  out.preNodes = nodes.length;
  // 9 sense
  senseH(out, nodes.map((_, i) => i)); out.steps.sense = Pi.summarizeSense(out);
  // 10 update: GP then replan on a new SOS cluster (existing aerostats stay where they are)
  out.steps.update = {}; out.gp1 = Pi.belief(out); out.steps.update.gp1 = out.gp1.stats;
  const sos = Pi.injectSOS(out, R); out.steps.update.sos = sos;
  const wk2 = Mo.weightsOf(B, p, out.gp1.est), set = out.steps.optimise.set, pre = nodes.map(n => n.site);
  const rep = Mo.greedy(cc.sp, sites.length, B.N, wk2.w, wk2.kq, wk2.W, Math.max(p.target, out.gp1.covEst + 0.04), Math.min(nodes.length + 3, Math.max(nodes.length, p.fleetMax || 99)), pre);
  const added = rep.steps.map((s, i) => ({ site: s.site, role: 'sense', id: 'A-' + String(set.length + i + 1).padStart(2, '0'), gain: s.gain, replan: true, h: p.h, hEff: p.h, offset: [0, 0] }));
  added.forEach(a => nodes.push(a));
  const con2 = Mo.connectivity(T, p, sites, nodes.map(n => n.site), M.icp);
  const team = nodes.filter(n => !n.replan).reduce((m, n) => Math.max(m, n.etaHeld != null ? n.etaHeld : (n._etaRaw != null ? n._etaRaw : n.eta)), 0); // = v7's max over both teams (unrounded)
  nodes.forEach((n, i) => { n.hop = con2.hop[i]; n.par = con2.par[i]; n.marg = con2.marg[i]; if (n.replan) { const s = sites[n.site]; n.eta = Math.round(team + Math.hypot(s.x - M.icp[0], s.y - M.icp[1]) * 1.4 / 1000 / sc.teamKmh * 60 + 25); n.team = 'A'; } });
  out.steps.deploy.con = con2;
  senseH(out, nodes.map((_, i) => i));
  out.gp2 = Pi.belief(out); out.steps.update.gp2 = out.gp2.stats; out.steps.update.added = added.length; out.steps.update.sense = Pi.summarizeSense(out);
  // 11 handover
  Pi.sectors(out);
  const wkF = Mo.weightsOf(B, p, out.gp2.est), fset = nodes.map(n => n.site);
  out.shap = Mo.shapley(cc.sp, B.N, fset, wkF.w, wkF.kq, wkF.W, mulberry32(p.seed + 5));
  nodes.forEach((n, i) => { n.shap = out.shap[i]; const without = fset.filter((_, q2) => q2 !== i); n.loo = Mo.covOfSet(cc.sp, B.N, fset, wkF.w, wkF.kq, wkF.W).cov - Mo.covOfSet(cc.sp, B.N, without, wkF.w, wkF.kq, wkF.W).cov; });
  out.v8 = true; out.ms = Math.round((typeof performance !== 'undefined' ? performance : Date).now() - t0);
  return out;
}

/* ---------- population fusion (WorldPop pack layer + Meta HRSL on the same 40 × 40 belief cells) ---------- */
function fusePopulation(M, alt) {
  const P = M.pack, CB = P.aoi.belief, wp = P.popB, h = alt.cells; if (!h || h.length !== wp.length) return null;
  let sw = 0, sh = 0; for (let c = 0; c < wp.length; c++) { sw += wp[c]; sh += h[c]; }
  const fused = new Float32Array(wp.length), dis = new Float32Array(wp.length); let big = 0;
  for (let c = 0; c < wp.length; c++) { fused[c] = 0.5 * wp[c] + 0.5 * h[c]; const m = Math.max(wp[c], h[c]); dis[c] = m > 0 ? Math.abs(wp[c] - h[c]) / m : 0; if (m > 5 && dis[c] > 0.6) big++; }
  // apply: re-split each cell's people over its buildings by the same weights the pack used
  const S = P.aoi.S, hh = S / 2, cs = S / CB, cellOf = (x, y) => clamp(Math.floor((y + hh) / cs), 0, CB - 1) * CB + clamp(Math.floor((x + hh) / cs), 0, CB - 1);
  const wsum = new Float64Array(CB * CB); M.buildings.forEach(b => { wsum[cellOf(b.x, b.y)] += b.ow || 0; });
  M.buildings.forEach(b => { b._occF = b.occ; const c = cellOf(b.x, b.y); b.occ = wsum[c] > 0 ? fused[c] * (b.ow || 0) / wsum[c] : 0; });
  M._resF = M.popResidual; M.popResidual = Float32Array.from(M.popResidual, (v, c) => wsum[c] > 0 ? 0 : fused[c]);
  return { report: { worldpop: sw, hrsl: sh, fused: 0.5 * (sw + sh), cellsDisagree: big, source: alt.source }, dis };
}
function restorePopulation(M) { M.buildings.forEach(b => { if (b._occF != null) { b.occ = b._occF; delete b._occF; } }); if (M._resF) { M.popResidual = M._resF; delete M._resF; } }

/* ---------- deployment order: the hand-off file from planning software to the hardware / ground station ---------- */
function deploymentOrder(out, meta = {}) {
  const sc = out.sc, M = out.M, sites = out.sites, lf = out.p;
  const icpLL = toLL(sc, M.icp[0], M.icp[1]);
  const mods = out.nodes.map((n, i) => { const s = sites[n.site], [la, lo] = toLL(sc, s.x, s.y), [hla, hlo] = toLL(sc, s.x + (n.offset ? n.offset[0] : 0), s.y + (n.offset ? n.offset[1] : 0));
    return { id: n.id, role: n.role, tether_point: { lat: +la.toFixed(6), lon: +lo.toFixed(6), ground_elev_m: +s.z0.toFixed(1) }, height_m: n.h, effective_height_m: +(n.hEff || n.h).toFixed(1), expected_hover: { lat: +hla.toFixed(6), lon: +hlo.toFixed(6) }, wind_at_height_ms: n.vHover != null ? +n.vHover.toFixed(1) : null,
      radio: { band: 'IN 865–867 MHz', freq_mhz: 866, tx_dbm: lf.ptNode, sensitivity_dbm: lf.sens, parent: n.par != null && n.par >= 0 ? out.nodes[n.par] ? out.nodes[n.par].id : 'ICP' : 'ICP', hop: n.hop, link_margin_db: n.marg != null ? +n.marg.toFixed(1) : null },
      sequence: i + 1, team: n.team, eta_min: n.eta, raise_at: n.raiseAt || null, wait_for_weather_min: n.wait || 0, travel: { km: n.km != null ? +n.km.toFixed(2) : null, minutes: n.travelMin != null ? Math.round(n.travelMin) : null, method: n.travelSrc }, expected_gain: n.gain != null ? +n.gain.toFixed(4) : 0, fairness_for: n.fair || null, site_class: C.CLS_NAME ? C.CLS_NAME[s.cls] : s.cls };
  });
  return { schema: 'ares.deployment-order/1', generated_at: new Date().toISOString(), software: 'ARES Planner v8', mode: meta.mode || 'replay', incident: { id: sc.code || sc.id, name: sc.name, type: sc.type || null, event_time: meta.eventTime || null, centre: { lat: sc.lat, lon: sc.lon } },
    command_post: { lat: +icpLL[0].toFixed(6), lon: +icpLL[1].toFixed(6) }, coverage_target: out.tEff, planned_coverage: +out.steps.optimise.cov.toFixed(4), coverage_held_hours: out.steps.optimise.hoursMet, modules: mods,
    weather_window: out.wx ? { source: out.wx.source, hours: out.wx.hours.length, hold_hours: out.wx.holdHours, plan_condition: out.use.robust ? `every hour, time-weighted; target must hold in ≥ ${Math.round(100 * (out.F.holdShare || 0.8))} % of hours` : 'median hour', v100_ms: out.cond ? out.cond.v100 : null, cloud_base_m: out.cond ? out.cond.cloudBase : null, visibility_m: out.cond ? out.cond.vis : null } : null,
    next_imaging: out.steps.deploy.imaging ? out.steps.deploy.imaging.next : null, gnss: out.inputs.gnss || null, low_level_traffic: out.aircraft ? out.aircraft.map(a => ({ id: a.id, type: a.type, helicopter: a.heli, agl_m: Math.round(a.agl), lat: a.lat, lon: a.lon })) : null, logistics: out.steps.deploy.logistics, factors_on: Object.keys(out.use).filter(k => out.use[k]), inputs: meta.inputs || null,
    boundary: 'Planning ends here: modules are raised and powered. Sensing, belief update and handover run on the hardware / ground station.' };
}
function toGeoJSON(order) { return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { kind: 'command_post' }, geometry: { type: 'Point', coordinates: [order.command_post.lon, order.command_post.lat] } }].concat(order.modules.map(m => ({ type: 'Feature', properties: { id: m.id, role: m.role, height_m: m.height_m, team: m.team, eta_min: m.eta_min, sequence: m.sequence }, geometry: { type: 'Point', coordinates: [m.tether_point.lon, m.tether_point.lat] } }))) }; }
function toKML(order) { const pm = order.modules.map(m => `<Placemark><name>${m.id} (${m.height_m} m)</name><description>Team ${m.team}, ETA ${m.eta_min} min, step ${m.sequence}</description><Point><coordinates>${m.tether_point.lon},${m.tether_point.lat},0</coordinates></Point></Placemark>`).join(''); return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>ARES deployment ${order.incident.id}</name><Placemark><name>Command post</name><Point><coordinates>${order.command_post.lon},${order.command_post.lat},0</coordinates></Point></Placemark>${pm}</Document></kml>`; }
function toCSV(order) { const h = 'sequence,id,role,lat,lon,height_m,effective_height_m,team,eta_min,raise_at,link_margin_db,parent,travel_km,travel_method'; return [h].concat(order.modules.map(m => [m.sequence, m.id, m.role, m.tether_point.lat, m.tether_point.lon, m.height_m, m.effective_height_m, m.team, m.eta_min, m.raise_at || '', m.radio.link_margin_db ?? '', m.radio.parent, m.travel.km ?? '', '"' + m.travel.method + '"'].join(','))).join('\n'); }

/* ---------- validation against independent evidence (e.g. GEV / GeoPera Bhote Koshi points) ---------- */
function evidenceCheck(out, points) {
  const { sc, T, M, B, sps, pairs } = out; if (!points || !points.length) return null; const S = T.S / 2;
  const fr = out.evalPairs ? out.evalPairs(pairs).frac : covOfPairs(sps, B.N, pairs, out.wk.w, out.wk.kq, out.wk.W).cnt;
  return points.map(pt => { const [x, y] = toXY(sc, pt.lat, pt.lon); if (Math.abs(x) > S || Math.abs(y) > S) return null; const k = idxAt(T, x, y), c = B.cellOf(x, y); let nearHaz = false; const r = Math.ceil(150 / T.cell);
    for (let dj = -r; dj <= r && !nearHaz; dj++) for (let di = -r; di <= r; di++) { const kk = k + dj * T.G + di; if (kk >= 0 && kk < T.G * T.G && M.hazMask && M.hazMask[kk]) { nearHaz = true; break; } }
    let covered = fr[c] > 0; return { id: pt.id, title: pt.title, x, y, inHazard: !!(M.hazMask && M.hazMask[k]), within150mOfHazard: nearHaz, covered, coveredTimeShare: +(+fr[c]).toFixed(2), beliefPrio: B.prio[c], lam: B.lam[c] }; }).filter(Boolean);
}

A.live = { FACTORS, OFF, ALL, REC, FLEET, runFull, senseH, conditions, tether, exposure, coverCellsW, greedyGroups, covOfPairs, planPre, deploymentOrder, toGeoJSON, toKML, toCSV, evidenceCheck, toXY, toLL, airspaceZones, occupancyFactor };
})(window.ARES);
