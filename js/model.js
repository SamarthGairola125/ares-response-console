/* ARES simulation — model engine (pure computation, no rendering) */
(function (A) {
'use strict';
const C = A.core, { clamp, mulberry32, gauss, CLS, elevAt, idxAt, surfAt, ENV } = C;

const DEF = { camPx: 2560, tgt: 0.75, N50: 0.75, fleetMax: 29, h: null, fov: 110, commR: 1200, drift: null, Kmax: null, P0: 0.95, pThr: 0.5, canopy: 0.75, ptBeacon: 14, ptNode: 20, gNode: 3, sens: -125, sensBB: -110, fade: 10, sigma: 7, corr: 50, target: 0.9, k: 2, rule: 'joint', env: null, seed: 7 };
const CB = 40; // belief grid cells per side

/* ---------- physics ---------- */
const fspl = D => 20 * Math.log10(Math.max(D, 1)) + 31.2; // 866 MHz
const diffr = o => o <= 0 ? 0 : Math.min(50, 10 + 20 * Math.log10(1 + o / 5));
function losObs(T, x0, y0, z0, x1, y1, z1, steps = 24) {
  let m = -1e9;
  for (let s = 1; s < steps; s++) { const t = s / steps * 0.98, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, z = z0 + (z1 - z0) * t, o = surfAt(T, x, y) - z; if (o > m) m = o; }
  return m;
}
/* camera resolution limit (Johnson criteria, ACQUIRE form): cycles across a person N = tgt / (2·GSD), GSD = slant range × IFOV,
   IFOV = FOV / camPx. P(N) = x/(1+x), x = (N/N50)^E, E = 2.7 + 0.7·N/N50. Assumed: camPx 2560 effective pixels across the FOV (e.g. a 1280-px LWIR core stepping 2×2 tiles on a gimbal, revisit time not modelled), tgt 0.75 m, N50 0.75 cycles (detection). */
function camPd(p, R) { const ifov = (p.fov * Math.PI / 180) / (p.camPx || 2560), gsd = Math.max(1e-3, R * ifov), r = (p.tgt || 0.75) / (2 * gsd) / (p.N50 || 0.75), E = 2.7 + 0.7 * r, x = Math.pow(r, E); return x / (1 + x); }
function attOf(cls, roof, p) { if (roof) return 1; if (cls === CLS.FOREST || cls === CLS.FARM) return p.canopy; if (cls === CLS.RUBBLE) return 0.7; if (cls === CLS.DEBRIS) return 0.85; return 1; }
function uplink(T, p, E, hx, hy, hz, x, y, z, sh) {
  const d = Math.hypot(x - hx, y - hy), dz = hz - z, D = Math.hypot(d, dz), o = losObs(T, hx, hy, hz, x, y, z);
  const th = Math.atan2(dz, d) * 57.2958, pL = o > 0 ? 0 : 1 / (1 + E.a * Math.exp(-E.b * (th - E.a)));
  const pl = fspl(D) + pL * E.eL + (1 - pL) * E.eN + diffr(o);
  return { rx: p.ptBeacon + p.gNode - pl + sh, obs: o, pl, pL, th, D };
}

/* ---------- correlated shadowing field ---------- */
function makeShadow(S, corr, seed) {
  const n = 72, R = mulberry32(seed * 31 + 5), a = new Float32Array(n * n), b = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) a[i] = gauss(R);
  const cell = S / (n - 1), sig = Math.max(0.6, corr / cell), rad = Math.ceil(sig * 3), ker = [];
  let ks = 0; for (let i = -rad; i <= rad; i++) { const v = Math.exp(-(i * i) / (2 * sig * sig)); ker.push(v); ks += v; }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { let s = 0; for (let q = -rad; q <= rad; q++) s += a[j * n + clamp(i + q, 0, n - 1)] * ker[q + rad]; b[j * n + i] = s / ks; }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { let s = 0; for (let q = -rad; q <= rad; q++) s += b[clamp(j + q, 0, n - 1) * n + i] * ker[q + rad]; a[j * n + i] = s / ks; }
  let m = 0, v = 0; for (let i = 0; i < n * n; i++) m += a[i]; m /= n * n; for (let i = 0; i < n * n; i++) v += (a[i] - m) ** 2; const sd = Math.sqrt(v / (n * n)) || 1;
  for (let i = 0; i < n * n; i++) a[i] = (a[i] - m) / sd;
  return (x, y) => { let fx = clamp((x + S / 2) / cell, 0, n - 1.001), fy = clamp((y + S / 2) / cell, 0, n - 1.001); const i = fx | 0, j = fy | 0, u = fx - i, w = fy - j, k = j * n + i; return (a[k] * (1 - u) + a[k + 1] * u) * (1 - w) + (a[k + n] * (1 - u) + a[k + n + 1] * u) * w; };
}

/* ---------- ground-truth people (hidden until detected) ---------- */
function nearDmg(T, x, y, dmg, r) {
  const G = T.G, ci = Math.round((x + T.S / 2) / T.cell), cj = Math.round((y + T.S / 2) / T.cell), rr = Math.ceil(r / T.cell);
  for (let j = Math.max(0, cj - rr); j <= Math.min(G - 1, cj + rr); j += 1) for (let i = Math.max(0, ci - rr); i <= Math.min(G - 1, ci + rr); i += 1) if (dmg.includes(T.cls[j * G + i])) return true;
  return false;
}
function genPeople(T, M, sc, n, devFrac, seed) {
  const R = mulberry32(seed * 7919 + 101), S = T.S, P = { x: [], y: [], z: [], g: [], roofH: [], prio: [], cls: [], dev: [], tag: [], sos: [] };
  const ok = (x, y) => Math.abs(x) < S / 2 - 15 && Math.abs(y) < S / 2 - 15;
  const push = (x, y, o) => {
    const k = idxAt(T, x, y), c = T.cls[k]; const rh = o.roofH || 0;
    if (c === CLS.WATER && !rh) return; if (c === CLS.SNOW) return;
    const g = elevAt(T, x, y); P.x.push(x); P.y.push(y); P.g.push(g); P.roofH.push(rh); P.z.push(g + rh + 1); P.cls.push(c);
    P.prio.push(o.prio || (M.dmg.includes(c) ? 3 : (nearDmg(T, x, y, M.dmg, M.nearR || 130) ? 2 : 1)));
    P.dev.push(R() < devFrac ? 1 : 0); P.tag.push(o.tag || ''); P.sos.push(o.sos ? 1 : 0);
  };
  const shares = M.clusters.reduce((a, c) => a + c.share, 0); let guard = 0;
  while (P.x.length < Math.round(n * 0.85) && guard++ < n * 60) {
    if (M.sample) { const s = M.sample(R); if (s) { if (ok(s.x, s.y)) push(s.x, s.y, s); continue; } if (!M.clusters.length) continue; }
    if (!M.clusters.length) break;
    let u = R() * shares, c = M.clusters[0]; for (const q of M.clusters) { u -= q.share; if (u <= 0) { c = q; break; } }
    let x, y; if (c.line) { const q = C.pointAt(c.line, c.f0 + R() * (c.f1 - c.f0)); x = q.x + gauss(R) * c.sd; y = q.y + gauss(R) * c.sd; } else { x = c.x + gauss(R) * c.sd; y = c.y + gauss(R) * c.sd; }
    if (ok(x, y)) push(x, y, { tag: c.tag });
  }
  while (P.x.length < n && guard++ < n * 120) { const x = (R() - 0.5) * S, y = (R() - 0.5) * S; if (ok(x, y)) push(x, y, {}); }
  P.n = P.x.length; return P;
}

/* ---------- Belief State prior (what planners know before sensing) ---------- */
function buildBelief(T, M, sc) {
  const S = T.S, cs = S / CB, N = CB * CB, occ = new Float32Array(N), dmg = new Float32Array(N), cnt = new Float32Array(N), near = new Float32Array(N), forest = new Float32Array(N);
  const cellOf = (x, y) => clamp(Math.floor((y + S / 2) / cs), 0, CB - 1) * CB + clamp(Math.floor((x + S / 2) / cs), 0, CB - 1);
  const HM = M.hazMask; C.forEachV(T, (i, j, x, y, k) => { const c = cellOf(x, y); cnt[c]++; if (HM ? HM[k] : M.dmg.includes(T.cls[k])) dmg[c]++; if (T.cls[k] === CLS.FOREST || T.cls[k] === CLS.FARM) forest[c]++; });
  for (const b of M.buildings) { const c = cellOf(b.x, b.y); occ[c] += M.real ? b.occ : (b.occ || sc.occ); }
  if (M.popResidual) for (let c = 0; c < N; c++) occ[c] += M.popResidual[c];
  const dfrac = new Float32Array(N); for (let c = 0; c < N; c++) dfrac[c] = cnt[c] ? dmg[c] / cnt[c] : 0;
  for (let j = 0; j < CB; j++) for (let i = 0; i < CB; i++) { let m = 0; for (let q = -2; q <= 2; q++) for (let r = -2; r <= 2; r++) { const ii = i + r, jj = j + q; if (ii >= 0 && jj >= 0 && ii < CB && jj < CB) m = Math.max(m, dfrac[jj * CB + ii]); } near[j * CB + i] = m; }
  const sev = new Float32Array(N), lam = new Float32Array(N), prio = new Uint8Array(N); let tot = 0;
  for (let c = 0; c < N; c++) {
    sev[c] = clamp(0.03 + 0.97 * Math.pow(Math.min(1, dfrac[c] * 2.2 + near[c] * 0.55), 1.3), 0, 1);
    lam[c] = occ[c] * sev[c] + 0.02 * sev[c]; tot += lam[c];
    prio[c] = dfrac[c] > 0.25 ? 3 : (near[c] > 0.2 ? 2 : 1);
  }
  if (C.isFlood(M)) { lam.fill(0); tot = 0; for (const b of M.buildings) { const c = cellOf(b.x, b.y); lam[c] += (M.real ? b.occ : (b.occ || sc.occ)) * (b.flood ? 1 : 0.1); } if (M.popResidual) for (let c = 0; c < N; c++) lam[c] += M.popResidual[c] * (dfrac[c] > 0.2 ? 1 : 0.1); for (let c = 0; c < N; c++) { lam[c] += 0.03; tot += lam[c]; if (lam[c] > 1 && sev[c] > 0.5) prio[c] = 3; } }
  /* background (transient) population: people outside homes — road users, field and forest workers, visitors. Explicit ASSUMPTION used only
     by the post-sensing ESTIMATOR (stage 10): a share BG of the people is spread over land (the simulated ground truth uses the same 15 % share).
     Placement (stages 4–7) keeps planning on the residential/hazard prior — dispersed people are left to phone beacons and ground teams. */
  const BG = M.real ? (sc.bgShare ?? 0.15) : 0, land = new Float32Array(N); let lt = 0;
  if (BG > 0) C.forEachV(T, (i, j, x, y, k) => { const c2 = T.cls[k]; if (c2 !== CLS.WATER && c2 !== CLS.SNOW) { land[cellOf(x, y)]++; lt++; } });
  /* three distinct populations: resident (modelled), exposed (resident in or next to the hazard), requiring assistance (scenario figure, an assumption) */
  let resident = 0, exposed = 0; for (let c = 0; c < N; c++) { resident += occ[c]; if (dfrac[c] > 0 || near[c] > 0.2) exposed += occ[c]; }
  const scale = sc.people / tot; for (let c = 0; c < N; c++) lam[c] *= scale;
  const lamEst = BG > 0 ? Float32Array.from(lam, (v, c) => (1 - BG) * v + BG * sc.people * land[c] / lt) : lam;
  const cx = new Float32Array(N), cy = new Float32Array(N), cz = new Float32Array(N), ccls = new Uint8Array(N);
  for (let j = 0; j < CB; j++) for (let i = 0; i < CB; i++) { const c = j * CB + i, x = -S / 2 + (i + 0.5) * cs, y = -S / 2 + (j + 0.5) * cs; cx[c] = x; cy[c] = y; cz[c] = elevAt(T, x, y) + 1; ccls[c] = T.cls[idxAt(T, x, y)]; }
  return { CB, cs, N, lam, sev, prio, dfrac, occ, cx, cy, cz, ccls, forest, cnt, cellOf, resident, exposed, scale, preScaleTotal: tot, bgShare: BG, lamEst };
}

/* ---------- Koopman optimal search-effort density ---------- */
function koopman(lam, effort) {
  const tot = lam.reduce((a, b) => a + b, 0) || 1, p = Array.from(lam, v => Math.max(v / tot, 1e-9));
  let lo = -40, hi = 0; for (let it = 0; it < 60; it++) { const mu = (lo + hi) / 2; let s = 0; for (const q of p) s += Math.max(0, Math.log(q) - mu); if (s > effort) lo = mu; else hi = mu; }
  const mu = (lo + hi) / 2, phi = new Float32Array(p.length); let mx = 0;
  for (let i = 0; i < p.length; i++) { phi[i] = Math.max(0, Math.log(p[i]) - mu); if (phi[i] > mx) mx = phi[i]; }
  let pd = 0; for (let i = 0; i < p.length; i++) pd += p[i] * (1 - Math.exp(-phi[i]));
  return { phi, max: mx || 1, pDetect: pd, mu };
}

/* ---------- candidate launch sites ---------- */
function buildSites(T, M, sc) {
  let pts = [];
  if (M.sites) pts = M.sites();
  else { const n = 27; for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) pts.push([-T.S / 2 + T.S * (a + 0.5) / n, -T.S / 2 + T.S * (b + 0.5) / n]); (M.roads || []).forEach(r => { for (let f = 0.02; f < 1; f += 0.03) { const q = C.pointAt(r, f); pts.push([q.x, q.y]); } }); M.buildings.forEach((b, i) => { if (i % 5) return; for (let a = 0; a < 4; a++) pts.push([b.x + Math.cos(a * 1.57 + i) * 55, b.y + Math.sin(a * 1.57 + i) * 55]); }); }
  const sites = [], rejected = [];
  for (const [x, y] of pts) {
    if (Math.abs(x) > T.S / 2 - 40 || Math.abs(y) > T.S / 2 - 40) continue;
    const k = idxAt(T, x, y), c = T.cls[k], sl = T.slope[k]; let why = null;
    if (c === CLS.WATER || (M.water != null && T.elev[k] < M.water + 0.5)) why = 'Under water';
    else if (c === CLS.DEBRIS) why = 'Active debris / scour';
    else if (c === CLS.RUBBLE || T.bldg[k] > 0) why = 'Building or rubble';
    else if (c === CLS.SNOW) why = 'Snow / ice';
    else if (c === CLS.FOREST && sl > M.maxSlope * 0.7) why = 'Canopy on slope (tether risk)';
    else if (c !== CLS.ROAD && sl > M.maxSlope) why = 'Too steep (' + Math.round(Math.atan(sl) * 57.3) + '°)';
    else if (c === CLS.ROCK) why = 'Rock face';
    const s = { x, y, z0: elevAt(T, x, y), cls: c, slope: sl, why };
    (why ? rejected : sites).push(s);
  }
  return { sites, rejected };
}

/* ---------- coverage model ---------- */
function footR(p, dz) { return Math.max(0, Math.max(1, dz) * Math.tan(p.fov * Math.PI / 360) - p.drift); }
function coverCells(T, B, sites, p, E, shadow) {
  const nS = sites.length, N = B.N, cov = new Uint8Array(nS * N), pd = new Float32Array(nS * N);
  const rMax = footR(p, p.h + 400);
  for (let j = 0; j < nS; j++) {
    const s = sites[j], hz = s.z0 + p.h;
    for (let c = 0; c < N; c++) {
      if (B.lam[c] < 1e-4) continue;
      const dx = B.cx[c] - s.x, dy = B.cy[c] - s.y; if (Math.abs(dx) > rMax || Math.abs(dy) > rMax) continue;
      const d = Math.hypot(dx, dy), r = footR(p, hz - B.cz[c]); if (d > r) continue;
      if (losObs(T, s.x, s.y, hz, B.cx[c], B.cy[c], B.cz[c], 16) > 2) continue;
      const P = p.P0 * (p.camModel === 'legacy' ? 1 - 0.4 * (d / r) ** 2 : camPd(p, Math.hypot(d, hz - B.cz[c]))) * attOf(B.ccls[c], 0, p); if (P < p.pThr) continue;
      if (p.rule === 'joint') { const u = uplink(T, p, E, s.x, s.y, hz, B.cx[c], B.cy[c], B.cz[c], shadow(B.cx[c], B.cy[c]) * p.sigma); if (u.rx - p.sens < p.fade) continue; }
      cov[j * N + c] = 1; pd[j * N + c] = P;
    }
  }
  return { cov, pd };
}
function coverPeople(T, P, sites, p, E, shadow, list) {
  const nS = sites.length, n = P.n, det = new Uint8Array(nS * n), pdv = new Float32Array(nS * n), mar = new Float32Array(nS * n).fill(NaN);
  const js = list || sites.map((_, i) => i);
  for (const j of js) {
    const s = sites[j], hz = s.z0 + p.h;
    for (let i = 0; i < n; i++) {
      const dx = P.x[i] - s.x, dy = P.y[i] - s.y, d = Math.hypot(dx, dy), dz = hz - P.z[i], r = footR(p, dz);
      if (d <= r) { const o = losObs(T, s.x, s.y, hz, P.x[i], P.y[i], P.z[i]); if (o <= 2 || P.roofH[i] > 0) { const pr = p.P0 * (p.camModel === 'legacy' ? 1 - 0.4 * (d / r) ** 2 : camPd(p, Math.hypot(d, dz))) * attOf(P.cls[i], P.roofH[i] > 0, p); pdv[j * n + i] = pr; if (pr >= p.pThr * 0.6) det[j * n + i] = 1; } }
      if (P.dev[i] && d < p.commR) { const u = uplink(T, p, E, s.x, s.y, hz, P.x[i], P.y[i], P.z[i], shadow(P.x[i], P.y[i]) * p.sigma); mar[j * n + i] = u.rx - p.sens; }
    }
  }
  return { det, pdv, mar };
}

/* ---------- greedy set cover (LSCP, weighted, k-coverage) ---------- */
function weightsOf(B, p, lamOverride) {
  const lam = lamOverride || B.lam, w = new Float32Array(B.N), kq = new Uint8Array(B.N); let W = 0;
  for (let c = 0; c < B.N; c++) { w[c] = lam[c] * (B.prio[c] === 3 ? 1.6 : B.prio[c] === 2 ? 1.2 : 1); kq[c] = B.prio[c] === 3 ? p.k : 1; W += w[c]; }
  return { w, kq, W };
}
function covOfSet(cov, N, set, w, kq, W) { const cnt = new Uint8Array(N); let cur = 0; for (const j of set) { const off = j * N; for (let c = 0; c < N; c++) if (cov[off + c]) { if (cnt[c] < kq[c]) cur += w[c] / kq[c]; cnt[c]++; } } return { cov: cur / W, cnt }; }
function greedy(cov, nS, N, w, kq, W, target, Kmax, preset = [], exclude = []) {
  const cnt = new Uint8Array(N), used = new Uint8Array(nS), steps = []; let cur = 0;
  const apply = j => { const off = j * N; for (let c = 0; c < N; c++) if (cov[off + c]) { if (cnt[c] < kq[c]) cur += w[c] / kq[c]; cnt[c]++; } };
  preset.forEach(j => { used[j] = 1; apply(j); }); exclude.forEach(j => used[j] = 1);
  const cands = [];
  while (cur / W < target && steps.length + preset.length < Kmax) {
    let best = -1, bg = 0, top = [];
    for (let j = 0; j < nS; j++) { if (used[j]) continue; let g = 0; const off = j * N; for (let c = 0; c < N; c++) if (cov[off + c] && cnt[c] < kq[c]) g += w[c] / kq[c]; if (g > bg) { bg = g; best = j; } if (g > 0) top.push([j, g]); }
    if (best < 0 || bg <= 1e-9) break;
    top.sort((a, b) => b[1] - a[1]); cands.push(top.slice(0, 6).map(t => ({ j: t[0], g: t[1] / W })));
    used[best] = 1; apply(best); steps.push({ site: best, gain: bg / W, cov: cur / W });
  }
  return { steps, cov: cur / W, cnt, cands };
}
function baselines(B, sites, cc, wk, p, R) {
  const N = B.N, nS = sites.length, maxN = Math.min(nS, p.Kmax + 10), { w, kq, W } = wk;
  const curve = set => { const out = [0]; const cnt = new Uint8Array(N); let cur = 0; for (const j of set) { const off = j * N; for (let c = 0; c < N; c++) if (cc.cov[off + c]) { if (cnt[c] < kq[c]) cur += w[c] / kq[c]; cnt[c]++; } out.push(cur / W); } return out; };
  const rnd = new Array(maxN + 1).fill(0), T = 20;
  for (let t = 0; t < T; t++) { const idx = sites.map((_, i) => i); for (let i = idx.length - 1; i > 0; i--) { const q = Math.floor(R() * (i + 1)); [idx[i], idx[q]] = [idx[q], idx[i]]; } const cv = curve(idx.slice(0, maxN)); for (let i = 0; i <= maxN; i++) rnd[i] += (cv[i] ?? cv[cv.length - 1]) / T; }
  const km = [0], kmSets = [[]];
  for (let K = 1; K <= maxN; K++) {
    const cen = []; for (let i = 0; i < K; i++) { let c, g = 0; do { c = Math.floor(R() * N); } while (w[c] < 1e-3 && g++ < 400); cen.push([B.cx[c], B.cy[c]]); }
    for (let it = 0; it < 10; it++) { const sx = new Float64Array(K), sy = new Float64Array(K), sw = new Float64Array(K); for (let c = 0; c < N; c++) { if (w[c] < 1e-4) continue; let bi = 0, bd = 1e18; for (let i = 0; i < K; i++) { const d = (B.cx[c] - cen[i][0]) ** 2 + (B.cy[c] - cen[i][1]) ** 2; if (d < bd) { bd = d; bi = i; } } sx[bi] += B.cx[c] * w[c]; sy[bi] += B.cy[c] * w[c]; sw[bi] += w[c]; } for (let i = 0; i < K; i++) if (sw[i] > 0) cen[i] = [sx[i] / sw[i], sy[i] / sw[i]]; }
    const set = new Set(); for (const [x, y] of cen) { let bi = 0, bd = 1e18; sites.forEach((s, i) => { const d = (s.x - x) ** 2 + (s.y - y) ** 2; if (d < bd && !set.has(i)) { bd = d; bi = i; } }); set.add(bi); }
    const arr = [...set]; km.push(covOfSet(cc.cov, N, arr, w, kq, W).cov); kmSets.push(arr);
  }
  const r0 = footR(p, p.h), sp = Math.max(60, Math.sqrt(3) * r0), gset = new Set();
  for (let y = -B.cs * CB / 2 + sp / 2, row = 0; y < B.cs * CB / 2; y += sp * 0.866, row++) for (let x = -B.cs * CB / 2 + (row % 2 ? sp / 2 : 0); x < B.cs * CB / 2; x += sp) { let bi = -1, bd = (sp * 0.6) ** 2; sites.forEach((s, i) => { const d = (s.x - x) ** 2 + (s.y - y) ** 2; if (d < bd) { bd = d; bi = i; } }); if (bi >= 0) gset.add(bi); }
  const grid = { n: gset.size, cov: covOfSet(cc.cov, N, [...gset], w, kq, W).cov, set: [...gset] };
  const need = arr => { const i = arr.findIndex(v => v >= p.target); return i < 0 ? null : i; };
  return { random: rnd, kmeans: km, kmSets, grid, needRandom: need(rnd), needKmeans: need(km) };
}

/* ---------- backhaul to ICP + relay insertion ---------- */
function bbMargin(T, p, a, b) {
  const D = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), o = losObs(T, a.x, a.y, a.z, b.x, b.y, b.z, 28);
  return p.ptNode + 2 * p.gNode + (b.icp || a.icp ? 3 : 0) - fspl(D) - diffr(o) - p.sensBB;
}
function connectivity(T, p, sites, set, icp) {
  const pts = set.map(j => ({ x: sites[j].x, y: sites[j].y, z: sites[j].z0 + p.h })), I = { x: icp[0], y: icp[1], z: elevAt(T, icp[0], icp[1]) + 12, icp: 1 };
  const n = pts.length, hop = new Array(n).fill(-1), par = new Array(n).fill(-2), marg = new Array(n).fill(null); const q = [];
  for (let i = 0; i < n; i++) { const m = bbMargin(T, p, pts[i], I); if (m >= p.fade) { hop[i] = 1; par[i] = -1; marg[i] = m; q.push(i); } }
  while (q.length) { const a = q.shift(); for (let b = 0; b < n; b++) if (hop[b] < 0) { const m = bbMargin(T, p, pts[a], pts[b]); if (m >= p.fade) { hop[b] = hop[a] + 1; par[b] = a; marg[b] = m; q.push(b); } } }
  return { hop, par, marg, ok: hop.map(h => h > 0), I };
}
function addRelays(T, p, sites, set, icp) {
  const relays = [];
  for (let it = 0; it < 6; it++) {
    const all = set.concat(relays), con = connectivity(T, p, sites, all, icp);
    const disc = all.filter((_, i) => !con.ok[i]); if (!disc.length) break;
    const conPts = [con.I].concat(all.filter((_, i) => con.ok[i]).map(j => ({ x: sites[j].x, y: sites[j].y, z: sites[j].z0 + p.h })));
    let best = -1, bs = -1e18;
    sites.forEach((s, c) => {
      if (all.includes(c)) return; const P = { x: s.x, y: s.y, z: s.z0 + p.h };
      if (!conPts.some(q => bbMargin(T, p, P, q) >= p.fade)) return;
      let sc = 0, md = 1e18; for (const dj of disc) { const D = { x: sites[dj].x, y: sites[dj].y, z: sites[dj].z0 + p.h }; if (bbMargin(T, p, P, D) >= p.fade) sc++; md = Math.min(md, Math.hypot(P.x - D.x, P.y - D.y)); }
      const score = sc * 1e6 - md; if (score > bs) { bs = score; best = c; }
    });
    if (best < 0) break; relays.push(best);
  }
  return relays;
}

/* ---------- Gaussian Process belief update (RBF kernel, log-ratio residuals) ---------- */
function gpUpdate(B, obs, ell, sf2 = 0.6, sn2 = 0.25) {
  const N = B.N, mean = new Float32Array(N), vari = new Float32Array(N).fill(sf2);
  let o = obs; if (o.length > 360) { const st = o.length / 360; o = Array.from({ length: 360 }, (_, i) => obs[Math.floor(i * st)]); }
  const n = o.length; if (!n) return { mean, vari, n: 0 };
  const K = new Float64Array(n * n), y = new Float64Array(n), k2 = 1 / (2 * ell * ell);
  for (let i = 0; i < n; i++) { y[i] = o[i].y; for (let j = 0; j <= i; j++) { const d2 = (B.cx[o[i].c] - B.cx[o[j].c]) ** 2 + (B.cy[o[i].c] - B.cy[o[j].c]) ** 2, v = sf2 * Math.exp(-d2 * k2) + (i === j ? sn2 : 0); K[i * n + j] = v; K[j * n + i] = v; } }
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = K[i * n + j]; for (let q = 0; q < j; q++) s -= L[i * n + q] * L[j * n + q]; L[i * n + j] = i === j ? Math.sqrt(Math.max(s, 1e-9)) : s / L[j * n + j]; }
  const z = new Float64Array(n); for (let i = 0; i < n; i++) { let s = y[i]; for (let q = 0; q < i; q++) s -= L[i * n + q] * z[q]; z[i] = s / L[i * n + i]; }
  const al = new Float64Array(n); for (let i = n - 1; i >= 0; i--) { let s = z[i]; for (let q = i + 1; q < n; q++) s -= L[q * n + i] * al[q]; al[i] = s / L[i * n + i]; }
  const ks = new Float64Array(n), v = new Float64Array(n);
  for (let c = 0; c < N; c++) {
    let m = 0; for (let i = 0; i < n; i++) { const d2 = (B.cx[c] - B.cx[o[i].c]) ** 2 + (B.cy[c] - B.cy[o[i].c]) ** 2; ks[i] = sf2 * Math.exp(-d2 * k2); m += ks[i] * al[i]; }
    for (let i = 0; i < n; i++) { let s = ks[i]; for (let q = 0; q < i; q++) s -= L[i * n + q] * v[q]; v[i] = s / L[i * n + i]; }
    let vv = sf2; for (let i = 0; i < n; i++) vv -= v[i] * v[i]; mean[c] = Math.max(-2.5, Math.min(2.5, m)); vari[c] = Math.max(1e-4, vv);
  }
  return { mean, vari, n };
}

/* ---------- sampled Shapley values for node contribution ---------- */
function shapley(cov, N, set, w, kq, W, R, perms = 120) {
  const phi = new Float64Array(set.length);
  for (let t = 0; t < perms; t++) {
    const ord = set.map((_, i) => i); for (let i = ord.length - 1; i > 0; i--) { const q = Math.floor(R() * (i + 1)); [ord[i], ord[q]] = [ord[q], ord[i]]; }
    const cnt = new Uint8Array(N); let cur = 0;
    for (const i of ord) { const off = set[i] * N; let g = 0; for (let c = 0; c < N; c++) if (cov[off + c]) { if (cnt[c] < kq[c]) g += w[c] / kq[c]; cnt[c]++; } cur += g; phi[i] += g / W; }
  }
  return Array.from(phi, v => v / perms);
}

/* ---------- walking / boat routes (A* on terrain grid) ---------- */
function route(T, M, from, to) {
  const G = T.G, st = 2, g2 = Math.ceil(G / st), idx = (i, j) => j * g2 + i;
  const toIJ = (x, y) => [clamp(Math.round((x + T.S / 2) / (T.cell * st)), 0, g2 - 1), clamp(Math.round((y + T.S / 2) / (T.cell * st)), 0, g2 - 1)];
  const cost = (i, j) => { const k = Math.min(G - 1, j * st) * G + Math.min(G - 1, i * st), c = T.cls[k]; let f = 1 + 6 * T.slope[k] * T.slope[k]; if (c === CLS.WATER) f *= C.isFlood(M) ? 3 : 40; if (c === CLS.DEBRIS) f *= 4; if (c === CLS.RUBBLE) f *= 3; if (T.bldg[k] > 3) f *= 25; if (c === CLS.ROAD) f *= 0.5; if (c === CLS.SNOW) f *= 8; return f; };
  const [si, sj] = toIJ(...from), [ti, tj] = toIJ(...to), n = g2 * g2, gs = new Float32Array(n).fill(1e30), prev = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
  const heap = []; const push = (k, f) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const t = heap[0], l = heap.pop(); if (heap.length) { heap[0] = l; let i = 0; for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return t; };
  const hd = (i, j) => Math.hypot(i - ti, j - tj) * 0.5; gs[idx(si, sj)] = 0; push(idx(si, sj), hd(si, sj)); let it = 0;
  while (heap.length && it++ < 200000) {
    const [, k] = pop(); if (closed[k]) continue; closed[k] = 1; const i = k % g2, j = (k / g2) | 0; if (i === ti && j === tj) break;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= g2 || nj >= g2) continue; const nk = idx(ni, nj); if (closed[nk]) continue; const g = gs[k] + Math.hypot(di, dj) * cost(ni, nj); if (g < gs[nk]) { gs[nk] = g; prev[nk] = k; push(nk, g + hd(ni, nj)); } }
  }
  const path = []; let k = idx(ti, tj), boat = false, len = 0; if (prev[k] < 0 && k !== idx(si, sj)) return null;
  while (k >= 0) { const i = k % g2, j = (k / g2) | 0, x = -T.S / 2 + i * st * T.cell, y = -T.S / 2 + j * st * T.cell; if (path.length) len += Math.hypot(x - path[path.length - 1][0], y - path[path.length - 1][1]); if (T.cls[idxAt(T, x, y)] === CLS.WATER) boat = true; path.push([x, y]); k = prev[k]; }
  return { path: path.reverse(), len, boat };
}

A.model = { DEF, CB, camPd, fspl, diffr, losObs, uplink, footR, attOf, makeShadow, genPeople, buildBelief, koopman, buildSites, coverCells, coverPeople, weightsOf, covOfSet, greedy, baselines, connectivity, addRelays, bbMargin, gpUpdate, shapley, route };
})(window.ARES);
