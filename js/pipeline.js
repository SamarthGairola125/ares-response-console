/* ARES simulation — 11-step pipeline orchestration + analysis tools */
(function (A) {
'use strict';
const C = A.core, Mo = A.model, { mulberry32, gauss, CLS, elevAt, idxAt, ENV } = C;

const STEPS = [
  { id: 'detect', n: 1, t: 'Disaster detected', d: 'Alerts and first SOS calls arrive. An incident is opened at the reported location.' },
  { id: 'evaluate', n: 2, t: 'Rapid evaluation', d: 'Terrain, river and damage layers are combined to map where the disaster hit and how badly.' },
  { id: 'belief', n: 3, t: 'Belief State', d: 'Expected people per cell = buildings × occupancy × damage severity. This is the shared map every later step reads.' },
  { id: 'koopman', n: 4, t: 'Search effort (Koopman)', d: 'Koopman’s optimal search density says how much sensing effort each cell deserves, given limited aerostats.' },
  { id: 'sites', n: 5, t: 'Launch sites screened', d: 'Every candidate tether point is checked: water, debris, slope, buildings and canopy rule sites out.' },
  { id: 'coverage', n: 6, t: 'Coverage model', d: 'For each valid site: camera footprint, line of sight over terrain and an 866 MHz link budget decide which cells it can serve.' },
  { id: 'optimise', n: 7, t: 'Placement optimisation', d: 'Greedy set cover adds the aerostat with the biggest weighted gain until the coverage target is met — fewest nodes.' },
  { id: 'deploy', n: 8, t: 'Deployment & backhaul', d: 'Aerostats are raised on tethers. Each must link back to the command post; relays are added where terrain blocks.' },
  { id: 'sense', n: 9, t: 'Sensing & detection', d: 'Thermal/EO cameras and survivor phones/beacons produce detections inside each footprint.' },
  { id: 'update', n: 10, t: 'Belief update & replanning', d: 'A Gaussian Process corrects the Belief State from detections. A new SOS cluster triggers replanning — existing aerostats stay fixed.' },
  { id: 'handover', n: 11, t: 'Handover to rescue teams', d: 'Rescue sectors with confirmed and estimated people, priorities and access routes go to the field teams.' },
];

const ALERTS = {
  dehradun: ['IMD: red alert, extremely heavy rain over Dehradun district', 'Cloudburst reported over Sahastradhara catchment', 'Song & Baldi rivers rising rapidly — flash flood', 'SOS calls from Maldevta and Sahastradhara'],
  wayanad: ['IMD: extremely heavy rainfall, Wayanad (204.5 mm / 24 h)', '02:17 IST — landslide near Punnappuzha origin', '04:10 IST — second slide diverts Iruvanjippuzha', 'SOS calls from Mundakkai and Chooralmala'],
  assam: ['CWC: Beki above danger level', 'Embankment breach reported at Kuruwa', 'Villages south of the embankment inundating', 'SOS calls from rooftops and river islands'],
  delhi: ['Seismic alert: strong shaking, East Delhi (hypothetical)', 'Multiple building collapses reported', 'Power and mobile networks degraded', 'SOS calls from collapse zone'],
  nepal: ['Glacier collapse upstream on the Bhotekoshi', 'Debris flow and flash flood heading downstream', 'Rasuwagadhi border point and highway hit', 'SOS calls from tourists and stranded vehicles'],
};

function prep(sc, p) {
  const clean = {}; for (const k in p) if (p[k] !== undefined && p[k] !== null && p[k] !== '') clean[k] = p[k]; const q = Object.assign({}, Mo.DEF, clean);
  if (q.drift == null) q.drift = Math.round(4 + sc.cond.wind * 0.35);
  if (!q.env) q.env = sc.env; if (q.h == null) q.h = sc.h || 200; if (q.Kmax == null) q.Kmax = sc.Kmax || 24; if (q.devFrac == null) q.devFrac = sc.devFrac;
  // per-scenario fleet settings (chosen by tests/fleet_search*.mjs) apply unless the user set them
  for (const k of ['fov', 'k', 'target', 'camPx']) if (clean[k] == null && sc.fleet && sc.fleet[k] != null) q[k] = sc.fleet[k];
  if (clean.h == null && sc.fleet && sc.fleet.h != null) q.h = sc.fleet.h;
  if (q.fleetMax) q.Kmax = Math.max(1, Math.min(q.Kmax, q.fleetMax - 3)); // keep 3 slots for replanning so the whole fleet stays within the limit
  return q;
}

function run(sc, pIn, built, opts = {}) {
  const t0 = performance.now(), p = prep(sc, pIn), { T, M } = built, E = ENV[p.env], R = mulberry32(p.seed * 977 + 3), S = T.S;
  const shadow = Mo.makeShadow(S, p.corr, p.seed);
  const P = Mo.genPeople(T, M, sc, sc.people, p.devFrac, p.seed);
  const B = Mo.buildBelief(T, M, sc);
  const out = { sc, p, T, M, E, P, B, shadow, steps: {} };

  // 1 detect
  const devIdx = []; for (let i = 0; i < P.n; i++) if (P.dev[i]) devIdx.push(i);
  const early = []; for (let t = 0; t < Math.min(12, devIdx.length); t++) early.push(devIdx[Math.floor(R() * devIdx.length)]);
  out.steps.detect = { alerts: ALERTS[sc.id], incident: M.incident, early };

  // 2 evaluate
  let dmgCells = 0, water = 0; C.forEachV(T, (i, j, x, y, k) => { if (M.hazMask ? M.hazMask[k] : M.dmg.includes(T.cls[k])) dmgCells++; if (T.cls[k] === CLS.WATER) water++; });
  const cellA = T.cell * T.cell / 1e6, coll = M.buildings.filter(b => b.collapsed).length, flooded = M.buildings.filter(b => b.flood).length, obsKm2 = M.hazMask ? M.hazMask.reduce((a, v) => a + v, 0) * cellA : null;
  const sevHist = [0, 0, 0, 0, 0]; for (let c = 0; c < B.N; c++) sevHist[Math.min(4, Math.floor(B.sev[c] * 5))]++;
  out.steps.evaluate = { dmgKm2: obsKm2 != null ? obsKm2 : dmgCells * cellA, waterKm2: water * cellA, buildings: M.buildings.length, collapsed: coll, flooded, sevHist, observed: obsKm2 != null };

  // 3 belief
  let lamTot = 0, p3 = 0; for (let c = 0; c < B.N; c++) { lamTot += B.lam[c]; if (B.prio[c] === 3) p3++; }
  out.steps.belief = { lamTot, p3, cellSize: B.cs, resident: B.resident, exposed: B.exposed, scale: B.scale };

  // 4 koopman
  const r0 = Mo.footR(p, p.h), cellsPerNode = Math.PI * r0 * r0 / (B.cs * B.cs), effort = Math.max(1, p.Kmax * 0.6 * cellsPerNode * 0.9);
  out.steps.koopman = Object.assign(Mo.koopman(B.lam, effort), { effort, cellsPerNode, r0 });

  // 5 sites
  const SS = Mo.buildSites(T, M, sc); out.sites = SS.sites;
  const why = {}; SS.rejected.forEach(r => { const k = r.why.replace(/ \(.*/, ''); why[k] = (why[k] || 0) + 1; });
  out.steps.sites = { valid: SS.sites.length, rejected: SS.rejected, why };

  // 6 coverage
  const cc = Mo.coverCells(T, B, SS.sites, p, E, shadow); out.cc = cc;
  const perSite = SS.sites.map((_, j) => { let s = 0; for (let c = 0; c < B.N; c++) s += cc.cov[j * B.N + c]; return s; });
  out.steps.coverage = { perSite, r0 };

  // 7 optimise
  const wk = Mo.weightsOf(B, p); out.wk = wk;
  const anyC = new Uint8Array(B.N); for (let j = 0; j < SS.sites.length; j++) for (let c = 0; c < B.N; c++) if (cc.cov[j * B.N + c]) anyC[c] = 1;
  let reach = 0; for (let c = 0; c < B.N; c++) if (anyC[c]) reach += wk.w[c]; reach /= wk.W;
  const tEff = Math.min(p.target, Math.max(0.05, reach * 0.97)); out.tEff = tEff; out.reach = reach;
  const full = Mo.greedy(cc.cov, SS.sites.length, B.N, wk.w, wk.kq, wk.W, 0.999, p.Kmax + 10);
  let nSol = full.steps.findIndex(s => s.cov >= tEff); nSol = nSol < 0 ? Math.min(p.Kmax, full.steps.length) : Math.min(nSol + 1, p.Kmax);
  const sol = full.steps.slice(0, nSol), set = sol.map(s => s.site);
  let best1 = 0; for (let j = 0; j < SS.sites.length; j++) { let g = 0; for (let c = 0; c < B.N; c++) if (cc.cov[j * B.N + c]) g += wk.w[c] / wk.kq[c]; best1 = Math.max(best1, g); }
  const lb = best1 > 0 ? Math.ceil(tEff * wk.W / best1) : null;
  const base = Mo.baselines(B, SS.sites, cc, wk, Object.assign({}, p, { target: tEff }), mulberry32(p.seed + 99));
  out.steps.optimise = { full, sol, set, lb, base, met: (sol[sol.length - 1] || { cov: 0 }).cov >= tEff - 1e-9, reach, tEff, cov: (sol[sol.length - 1] || { cov: 0 }).cov, cands: full.cands.slice(0, nSol) };

  // 8 deploy + backhaul
  const relays = Mo.addRelays(T, p, SS.sites, set, M.icp);
  const nodes = set.map((j, i) => ({ site: j, role: 'sense', id: 'A-' + String(i + 1).padStart(2, '0'), gain: sol[i].gain })).concat(relays.map((j, i) => ({ site: j, role: 'relay', id: 'R-' + String(i + 1).padStart(2, '0'), gain: 0 })));
  const con = Mo.connectivity(T, p, SS.sites, nodes.map(n => n.site), M.icp);
  const team = [0, 0]; nodes.forEach((n, i) => { const s = SS.sites[n.site], km = Math.hypot(s.x - M.icp[0], s.y - M.icp[1]) * 1.4 / 1000, tm = i % 2; const travel = km / sc.teamKmh * 60; team[tm] += travel + 25; n.eta = Math.round(team[tm]); n.team = tm ? 'B' : 'A'; n.km = km; n.hop = con.hop[i]; n.par = con.par[i]; n.marg = con.marg[i]; });
  out.nodes = nodes; out.steps.deploy = { relays: relays.length, con, linked: con.ok.filter(Boolean).length };

  // 9 sense
  sense(out, nodes.map((_, i) => i));
  out.steps.sense = summarizeSense(out);

  // 10 update: GP then replan on new SOS cluster
  out.steps.update = {};
  out.gp1 = belief(out); out.steps.update.gp1 = out.gp1.stats;
  const sos = injectSOS(out, R); out.steps.update.sos = sos;
  const est1 = out.gp1.est, wk2 = Mo.weightsOf(B, p, est1);
  const pre = nodes.map(n => n.site), rep = Mo.greedy(cc.cov, SS.sites.length, B.N, wk2.w, wk2.kq, wk2.W, Math.max(p.target, out.gp1.covEst + 0.04), Math.min(nodes.length + 3, Math.max(nodes.length, p.fleetMax || 99)), pre);
  const added = rep.steps.map((s, i) => ({ site: s.site, role: 'sense', id: 'A-' + String(set.length + i + 1).padStart(2, '0'), gain: s.gain, replan: true }));
  const addMore = added.filter(a => true); addMore.forEach(a => nodes.push(a));
  const con2 = Mo.connectivity(T, p, SS.sites, nodes.map(n => n.site), M.icp); nodes.forEach((n, i) => { n.hop = con2.hop[i]; n.par = con2.par[i]; n.marg = con2.marg[i]; if (n.replan) { const s = SS.sites[n.site]; n.eta = Math.round(Math.max(...team) + Math.hypot(s.x - M.icp[0], s.y - M.icp[1]) * 1.4 / 1000 / sc.teamKmh * 60 + 25); n.team = 'A'; } });
  out.steps.deploy.con = con2;
  sense(out, nodes.map((_, i) => i));
  out.gp2 = belief(out); out.steps.update.gp2 = out.gp2.stats; out.steps.update.added = added.length; out.steps.update.sense = summarizeSense(out);

  // 11 handover
  sectors(out);
  const wkF = Mo.weightsOf(B, p, out.gp2.est), fset = nodes.map(n => n.site);
  out.shap = Mo.shapley(cc.cov, B.N, fset, wkF.w, wkF.kq, wkF.W, mulberry32(p.seed + 5));
  nodes.forEach((n, i) => { n.shap = out.shap[i]; const without = fset.filter((_, q) => q !== i); n.loo = Mo.covOfSet(cc.cov, B.N, fset, wkF.w, wkF.kq, wkF.W).cov - Mo.covOfSet(cc.cov, B.N, without, wkF.w, wkF.kq, wkF.W).cov; });
  out.ms = Math.round(performance.now() - t0);
  return out;
}

function sense(out, which) {
  const { T, P, p, E, shadow } = out, sites = out.sites, nodes = out.nodes;
  const list = which.map(i => nodes[i].site);
  const cp = Mo.coverPeople(T, P, sites, p, E, shadow, list); out.cp = cp;
  const R = mulberry32(p.seed * 13 + 1), n = P.n;
  P.detBy = new Int16Array(n).fill(-1); P.via = new Array(n).fill(''); P.bestMar = new Float32Array(n).fill(NaN); P.inView = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const draws = []; for (let q = 0; q < which.length; q++) draws.push(R());
    which.forEach((ni, q) => {
      const j = nodes[ni].site, pd = cp.pdv[j * n + i], m = cp.mar[j * n + i];
      if (pd > 0) P.inView[i] = 1;
      if (!isNaN(m) && (isNaN(P.bestMar[i]) || m > P.bestMar[i])) P.bestMar[i] = m;
      if (P.detBy[i] < 0 && cp.det[j * n + i] && draws[q] < pd) { P.detBy[i] = ni; P.via[i] = 'thermal'; }
      if (P.detBy[i] < 0 && P.dev[i] && m >= p.fade) { P.detBy[i] = ni; P.via[i] = 'beacon'; }
    });
  }
}
function summarizeSense(out) {
  const P = out.P; let det = 0, th = 0, bc = 0, inV = 0, devIn = 0, devOut = 0, w = 0, wd = 0;
  for (let i = 0; i < P.n; i++) { const pw = P.prio[i]; w += pw; if (P.detBy[i] >= 0) { det++; wd += pw; if (P.via[i] === 'thermal') th++; else bc++; } if (P.inView[i]) { inV++; if (P.dev[i]) { if (P.bestMar[i] >= out.p.fade) devIn++; else devOut++; } } }
  return { det, thermal: th, beacon: bc, inView: inV, n: P.n, rate: det / P.n, wRate: wd / w, outage: (devIn + devOut) ? devOut / (devIn + devOut) : 0 };
}

function belief(out) {
  const { B, P, cc, nodes, T } = out, N = B.N, obsCnt = new Float32Array(N), pdC = new Float32Array(N), observed = new Uint8Array(N);
  for (const nd of nodes) { const off = nd.site * N; for (let c = 0; c < N; c++) if (cc.cov[off + c]) { observed[c] = 1; pdC[c] = 1 - (1 - pdC[c]) * (1 - cc.pd[off + c]); } }
  for (let i = 0; i < P.n; i++) if (P.detBy[i] >= 0) obsCnt[B.cellOf(P.x[i], P.y[i])]++;
  const pe = new Float32Array(N), cr2 = out.p.commR * out.p.commR;
  for (let c = 0; c < N; c++) { let inC = 0; for (const nd of nodes) { const st = out.sites[nd.site]; if ((st.x - B.cx[c]) ** 2 + (st.y - B.cy[c]) ** 2 < cr2) { inC = 1; break; } } pe[c] = 1 - (1 - pdC[c]) * (1 - out.p.devFrac * 0.85 * inC); if (pe[c] > 0.05) observed[c] = 1; }
  const floor = 0.05, obs = [];
  const LE = B.lamEst || B.lam; // estimation prior (adds the assumed background population where configured)
  for (let c = 0; c < N; c++) if (observed[c] || obsCnt[c] > 0) { const pdv = Math.max(pe[c], 0.3), lam = Math.max(LE[c], floor); obs.push({ c, y: Math.log((obsCnt[c] + 0.3) / (pdv * lam + 0.3)) }); }
  const gp = Mo.gpUpdate(B, obs, T.S / 14);
  const est = new Float32Array(N), sd = new Float32Array(N); let tot = 0, totSd = 0;
  for (let c = 0; c < N; c++) {
    const lam = Math.max(LE[c], floor), mult = Math.exp(gp.mean[c]);
    if (observed[c] || obsCnt[c]) { const pdv = Math.max(pe[c], 0.3); est[c] = obsCnt[c] + LE[c] * mult * (1 - pdv); } else est[c] = LE[c] * mult + (gp.vari[c] < 0.35 ? floor * Math.max(0, mult - 1) : 0);
    sd[c] = est[c] * Math.sqrt(Math.max(0, Math.exp(gp.vari[c]) - 1)); tot += est[c]; totSd += sd[c] * sd[c];
  }
  const wk = Mo.weightsOf(B, out.p, est), covEst = Mo.covOfSet(cc.cov, N, nodes.map(n => n.site), wk.w, wk.kq, wk.W).cov;
  let trueIn = 0; for (let i = 0; i < P.n; i++) trueIn++;
  return { est, sd, gp, observed, obsCnt, pdC, covEst, stats: { obs: gp.n, estTotal: tot, estSd: Math.sqrt(totSd), trueTotal: P.n, confirmed: obsCnt.reduce((a, b) => a + b, 0) } };
}

function injectSOS(out, R) {
  const { B, P, T, M, gp1 } = out; let best = -1, bs = -1;
  for (let c = 0; c < B.N; c++) { if (gp1.observed[c]) continue; const k = idxAt(T, B.cx[c], B.cy[c]); if (T.cls[k] === CLS.WATER || T.cls[k] === CLS.SNOW || T.slope[k] > 1) continue; const d = Math.hypot(B.cx[c] - M.icp[0], B.cy[c] - M.icp[1]); const s = gp1.gp.vari[c] * (B.lam[c] < 1 ? 1.5 : 1) * (0.5 + R()) / (1 + d / T.S); if (s > bs) { bs = s; best = c; } }
  if (best < 0) for (let c = 0; c < B.N; c++) { const k = idxAt(T, B.cx[c], B.cy[c]); if (T.cls[k] === CLS.WATER || T.bldg[k] > 0) continue; const s = gp1.gp.vari[c] * (0.5 + R()) / (1 + B.lam[c]); if (s > bs) { bs = s; best = c; } }
  if (best < 0) return null;
  const cx = B.cx[best], cy = B.cy[best], n0 = P.n, add = 22 + Math.floor(R() * 10);
  for (let t = 0; t < add; t++) { const x = cx + gauss(R) * 70, y = cy + gauss(R) * 70; const k = idxAt(T, x, y); if (T.cls[k] === CLS.WATER) continue; const g = elevAt(T, x, y); P.x.push(x); P.y.push(y); P.g.push(g); P.z.push(g + 1); P.roofH.push(0); P.cls.push(T.cls[k]); P.prio.push(3); P.dev.push(R() < 0.6 ? 1 : 0); P.tag.push('sos'); P.sos.push(1); }
  P.n = P.x.length;
  for (let c = 0; c < B.N; c++) { const d2 = (B.cx[c] - cx) ** 2 + (B.cy[c] - cy) ** 2; gp1.est[c] += (P.n - n0) * Math.exp(-d2 / (2 * 110 * 110)) * (B.cs * B.cs) / (2 * Math.PI * 110 * 110); }
  return { x: cx, y: cy, n: P.n - n0, cell: best };
}

function sectors(out) {
  const { B, nodes, sites, gp2, P, T, M, p } = out, N = B.N, sec = new Int16Array(N).fill(-1);
  const r0 = Mo.footR(p, p.h);
  for (let c = 0; c < N; c++) { if (gp2.est[c] < 0.05) continue; let bi = -1, bd = 1e18; nodes.forEach((n, i) => { if (n.role === 'relay') return; const s = sites[n.site], d = Math.hypot(B.cx[c] - s.x, B.cy[c] - s.y) / r0; if (d < bd) { bd = d; bi = i; } }); sec[c] = bd < 6 ? bi : -2; }
  const rows = nodes.map((n, i) => ({ i, id: n.id, est: 0, v: 0, conf: 0, prio: 1, sx: 0, sy: 0, sw: 0, truth: 0 }));
  const un = { i: -2, id: 'Unobserved', est: 0, v: 0, conf: 0, prio: 1, sx: 0, sy: 0, sw: 0, truth: 0 };
  for (let c = 0; c < N; c++) { if (sec[c] === -1) continue; const r = sec[c] >= 0 ? rows[sec[c]] : un; r.est += gp2.est[c]; r.v += gp2.sd[c] ** 2; r.conf += gp2.obsCnt[c]; r.prio = Math.max(r.prio, B.prio[c]); r.sx += B.cx[c] * gp2.est[c]; r.sy += B.cy[c] * gp2.est[c]; r.sw += gp2.est[c]; }
  for (let i = 0; i < P.n; i++) { const s = sec[B.cellOf(P.x[i], P.y[i])]; if (s >= 0) rows[s].truth++; else if (s === -2) un.truth++; }
  const all = rows.filter(r => r.sw > 0.5).concat(un.sw > 0.5 ? [un] : []);
  all.forEach(r => { r.cx = r.sx / r.sw; r.cy = r.sy / r.sw; r.sd = Math.sqrt(r.v); r.lat = out.sc.lat + r.cy / 111320; r.lon = out.sc.lon + r.cx / (111320 * Math.cos(out.sc.lat * Math.PI / 180)); r.score = r.est * (r.prio === 3 ? 2 : r.prio === 2 ? 1.4 : 1); });
  all.sort((a, b) => b.score - a.score); all.forEach((r, i) => { r.rank = i + 1; r.pri = i < 3 ? 1 : i < 7 ? 2 : 3; });
  all.slice(0, 6).forEach(r => { r.route = Mo.route(T, M, M.icp, [r.cx, r.cy]); });
  let mae = 0, nn = 0; all.forEach(r => { if (r.i !== -2) { mae += Math.abs(r.est - r.truth); nn++; } });
  out.sec = sec; out.sectors = all; out.steps.handover = { sectors: all.length, mae: nn ? mae / nn : 0, routes: all.slice(0, 6).filter(r => r.route).length };
}

/* ---------- interactive analyses ---------- */
function failDrill(out, ni) {
  const { B, cc, nodes, p, sites, gp2 } = out, wk = Mo.weightsOf(B, p, gp2.est), all = nodes.map(n => n.site), rest = all.filter((_, i) => i !== ni);
  const before = Mo.covOfSet(cc.cov, B.N, all, wk.w, wk.kq, wk.W).cov, after = Mo.covOfSet(cc.cov, B.N, rest, wk.w, wk.kq, wk.W).cov;
  const fix = Mo.greedy(cc.cov, sites.length, B.N, wk.w, wk.kq, wk.W, before - 0.002, rest.length + 3, rest, [all[ni]]);
  const con = Mo.connectivity(out.T, p, sites, rest.concat(fix.steps.map(s => s.site)), out.M.icp);
  return { before, after, fix: fix.steps, final: fix.cov, linked: con.ok.filter(Boolean).length, total: rest.length + fix.steps.length };
}
function heightSweep(out) {
  const res = [];
  for (const h of [60, 100, 150, 200, 260, 320]) { const p = Object.assign({}, out.p, { h }), cc = Mo.coverCells(out.T, out.B, out.sites, p, out.E, out.shadow), g = Mo.greedy(cc.cov, out.sites.length, out.B.N, out.wk.w, out.wk.kq, out.wk.W, out.tEff, 60); res.push({ h, n: g.steps.length, cov: g.cov, met: g.cov >= out.tEff - 1e-9, r: Mo.footR(p, h) }); }
  return res;
}
async function monteCarlo(sc, p, built, trials, onp) {
  const res = [];
  for (let t = 0; t < trials; t++) { const o = run(sc, Object.assign({}, p, { seed: 1000 + t * 7 }), built); res.push({ nodes: o.nodes.length, relays: o.steps.deploy.relays, det: o.steps.update.sense.rate, cov: o.steps.optimise.cov, met: o.steps.optimise.met, mae: o.steps.handover.mae }); onp && onp(t + 1, trials); await new Promise(r => setTimeout(r, 0)); }
  return res;
}
async function crossScenario(p, cache, onp) {
  const rows = [];
  for (const sc of C.SCENARIOS) { const built = cache[sc.id] || (cache[sc.id] = C.buildTerrain(sc)); await new Promise(r => setTimeout(r, 0)); const o = run(sc, Object.assign({}, p, { drift: null, env: null, devFrac: null }), built); rows.push({ sc, nodes: o.nodes.length, sense: o.nodes.filter(n => n.role === 'sense').length, relays: o.steps.deploy.relays, lb: o.steps.optimise.lb, cov: o.steps.optimise.cov, km: o.steps.optimise.base.needKmeans, rnd: o.steps.optimise.base.needRandom, det: o.steps.update.sense.rate, outage: o.steps.update.sense.outage, mae: o.steps.handover.mae, ms: o.ms }); onp && onp(rows.length); }
  return rows;
}
function signalGrid(out, nodeIdx, n = 81) {
  const { T, p, E, shadow, sites, nodes } = out, S = T.S, g = new Float32Array(n * n).fill(-99);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = -S / 2 + S * i / (n - 1), y = -S / 2 + S * j / (n - 1), z = elevAt(T, x, y) + 1.5; let best = -99; for (const ni of nodeIdx) { const s = sites[nodes[ni].site]; if (Math.hypot(s.x - x, s.y - y) > 5000) continue; const u = Mo.uplink(T, p, E, s.x, s.y, s.z0 + p.h, x, y, z, shadow(x, y) * p.sigma); best = Math.max(best, u.rx - p.sens); } g[j * n + i] = best; }
  return { g, n };
}

A.pipe = { STEPS, run, failDrill, heightSweep, monteCarlo, crossScenario, signalGrid, prep };
})(window.ARES);
