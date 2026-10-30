/* ARES simulation — canvas charts (theme-aware) */
(function (A) {
'use strict';
const C = A.core, CH = A.charts = {};
let tok = {};
CH.readTokens = () => { const s = getComputedStyle(document.documentElement); ['--ink', '--muted', '--faint', '--line', '--accent', '--comm', '--ok', '--warn', '--crit', '--violet', '--panel', '--panel-2', '--surface', '--chart-grid', '--amber'].forEach(k => tok[k] = s.getPropertyValue(k).trim()); };
CH.tok = () => tok;
function ctx(cv) {
  const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1), w = Math.max(10, r.width), h = Math.max(10, r.height);
  if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
  const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h); g.font = '10px Inter, sans-serif'; return { g, w, h };
}
function axes(c, pad, xmax, ymax, xt, yt, xf, yf) {
  const { g, w, h } = c; g.strokeStyle = tok['--line']; g.fillStyle = tok['--muted']; g.lineWidth = 1;
  const X = v => pad.l + (w - pad.l - pad.r) * v / xmax, Y = v => pad.t + (h - pad.t - pad.b) * (1 - v / ymax);
  yt.forEach(v => { const y = Math.round(Y(v)) + 0.5; g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke(); g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(yf(v), pad.l - 4, y); });
  g.textAlign = 'center'; g.textBaseline = 'top'; xt.forEach(v => g.fillText(xf(v), X(v), h - pad.b + 3));
  return { X, Y };
}
function line(g, pts, color, width = 1.6, dash) { if (pts.length < 2) return; g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash || []); g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); g.setLineDash([]); }
function area(g, pts, baseY, color, alpha) { if (pts.length < 2) return; g.globalAlpha = alpha; g.fillStyle = color; g.beginPath(); g.moveTo(pts[0][0], baseY); pts.forEach(p => g.lineTo(p[0], p[1])); g.lineTo(pts[pts.length - 1][0], baseY); g.closePath(); g.fill(); g.globalAlpha = 1; }
function dot(g, x, y, r, fill, stroke) { g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); } }
function nice(v) { const p = Math.pow(10, Math.floor(Math.log10(v || 1))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

/* chart 1: people expected vs located */
CH.people = function (cv, o, step) {
  const c = ctx(cv), { g, w, h } = c, s = o.steps, u = s.update;
  const rows = [
    { k: 'Prior expected', v: s.belief.lamTot, from: 3, col: tok['--warn'] },
    { k: 'Located (1st wave)', v: u.gp1.confirmed, from: 9, col: tok['--accent'] },
    { k: 'GP estimate', v: u.gp2.estTotal, sd: u.gp2.estSd, from: 10, col: tok['--violet'] },
    { k: 'Located (final)', v: u.gp2.confirmed, from: 10, col: tok['--accent'] },
    { k: 'Ground truth (sim)', v: u.gp2.trueTotal, from: 1, col: tok['--faint'] },
  ];
  const mx = nice(Math.max(...rows.map(r => r.v + (r.sd || 0))) * 1.05), pad = { l: 104, r: 34, t: 4, b: 14 }, bh = (h - pad.t - pad.b) / rows.length;
  const X = v => pad.l + (w - pad.l - pad.r) * v / mx;
  g.strokeStyle = tok['--line']; [0, 0.5, 1].forEach(f => { const x = Math.round(X(mx * f)) + 0.5; g.beginPath(); g.moveTo(x, pad.t); g.lineTo(x, h - pad.b); g.stroke(); g.fillStyle = tok['--muted']; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(Math.round(mx * f), x, h - pad.b + 2); });
  rows.forEach((r, i) => { const y = pad.t + i * bh + bh * 0.18, hh = bh * 0.64, on = step >= r.from; g.fillStyle = tok['--ink']; g.globalAlpha = on ? 1 : 0.35; g.textAlign = 'right'; g.textBaseline = 'middle'; g.font = '11px Barlow, sans-serif'; g.fillText(r.k, pad.l - 6, y + hh / 2);
    g.fillStyle = r.col; g.globalAlpha = on ? 0.9 : 0.12; g.fillRect(pad.l, y, Math.max(1, X(r.v) - pad.l), hh); g.globalAlpha = 1;
    if (on && r.sd) { g.strokeStyle = tok['--ink']; g.lineWidth = 1.2; g.beginPath(); g.moveTo(X(r.v - 1.64 * r.sd), y + hh / 2); g.lineTo(X(r.v + 1.64 * r.sd), y + hh / 2); g.stroke(); }
    g.font = '10px "JetBrains Mono", monospace'; g.fillStyle = tok['--ink']; g.textAlign = 'left'; g.globalAlpha = on ? 1 : 0.35; g.fillText(on ? Math.round(r.v) + (r.sd ? '±' + Math.round(1.64 * r.sd) : '') : '—', X(r.v) + 4, y + hh / 2); g.globalAlpha = 1; });
};

/* chart 2: coverage vs nodes, methods */
CH.coverage = function (cv, o, pick) {
  const c = ctx(cv), { g, w, h } = c, op = o.steps.optimise, b = op.base, full = [0].concat(op.full.steps.map(s => s.cov));
  const N = Math.max(10, Math.min(Math.max(full.length, b.kmeans.length, b.random.length) - 1, op.sol.length * 2 + 6));
  const pad = { l: 30, r: 8, t: 6, b: 16 }, { X, Y } = axes(c, pad, N, 1, [0, Math.round(N / 4), Math.round(N / 2), Math.round(3 * N / 4), N], [0, 0.5, 1], v => v, v => Math.round(v * 100) + '%');
  const P = arr => arr.slice(0, N + 1).map((v, i) => [X(i), Y(v)]);
  g.setLineDash([3, 3]); g.strokeStyle = tok['--crit']; g.beginPath(); g.moveTo(pad.l, Y(o.tEff)); g.lineTo(w - pad.r, Y(o.tEff)); g.stroke(); g.setLineDash([]);
  g.fillStyle = tok['--crit']; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText('target ' + Math.round(o.tEff * 100) + '%' + (o.tEff < o.p.target - 1e-6 ? ' (capped: reach ' + Math.round(o.reach * 100) + '%)' : ''), w - pad.r, Y(o.tEff) - 1);
  line(g, P(b.random), tok['--faint'], 1.3, [4, 3]); line(g, P(b.kmeans), tok['--violet'], 1.5);
  const gp = P(full); area(g, gp, Y(0), tok['--accent'], 0.1); line(g, gp, tok['--accent'], 2);
  if (b.grid.n <= N) dot(g, X(b.grid.n), Y(b.grid.cov), 3.5, tok['--comm']);
  const k = pick == null ? op.sol.length : pick; if (k > 0 && full[k] != null) { g.strokeStyle = tok['--ink']; g.beginPath(); g.moveTo(X(k), pad.t); g.lineTo(X(k), h - pad.b); g.stroke(); dot(g, X(k), Y(full[k]), 4, tok['--accent'], tok['--panel']); }
};

/* chart 3: line-of-sight profile ICP -> node */
CH.profile = function (cv, o, ni) {
  const c = ctx(cv), { g, w, h } = c, T = o.T, nd = o.nodes[ni == null ? 0 : ni]; if (!nd) return;
  const s = o.sites[nd.site], a = { x: o.M.icp[0], y: o.M.icp[1], z: C.elevAt(T, o.M.icp[0], o.M.icp[1]) + 12 }, b = { x: s.x, y: s.y, z: s.z0 + o.p.h };
  const n = 120, D = Math.hypot(b.x - a.x, b.y - a.y), prof = []; let mn = 1e9, mx = -1e9;
  for (let i = 0; i <= n; i++) { const t = i / n, z = C.surfAt(T, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); prof.push(z); mn = Math.min(mn, z, a.z, b.z); mx = Math.max(mx, z, a.z, b.z); }
  const rng = mx - mn || 1, lo = mn - rng * 0.1, hi = mx + rng * 0.15, pad = { l: 40, r: 8, t: 6, b: 16 };
  const km = D / 1000, { X, Y } = axes(c, pad, km, hi - lo, [0, km / 2, km], [0, (hi - lo) / 2, hi - lo], v => v.toFixed(1) + ' km', v => Math.round(lo + v));
  const pts = prof.map((z, i) => [X(km * i / n), Y(z - lo)]); area(g, pts, Y(0), tok['--ok'], 0.22); line(g, pts, tok['--ok'], 1.3);
  let blocked = false; for (let i = 0; i <= n; i++) { const lz = a.z + (b.z - a.z) * i / n; if (prof[i] > lz) { blocked = true; break; } }
  line(g, [[X(0), Y(a.z - lo)], [X(km), Y(b.z - lo)]], blocked ? tok['--crit'] : tok['--comm'], 1.8, blocked ? [4, 3] : null);
  dot(g, X(0), Y(a.z - lo), 3.5, tok['--ink']); dot(g, X(km), Y(b.z - lo), 4, tok['--accent']);
  g.fillStyle = tok['--ink']; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText('ICP', X(0) + 4, Y(a.z - lo) + 2); g.textAlign = 'right'; g.fillText(nd.id + (nd.hop > 1 ? ' (via relay chain)' : ''), X(km) - 6, Y(b.z - lo) + 2);
  const m = A.model.bbMargin(T, o.p, Object.assign({ icp: 1 }, a), b) ; return { blocked, margin: m, km };
};

/* mini charts for panels */
CH.hist = function (cv, vals, opts = {}) {
  const c = ctx(cv), { g, w, h } = c; if (!vals.length) return; const mn = opts.min ?? Math.min(...vals), mx = opts.max ?? Math.max(...vals), nb = opts.bins || Math.max(4, Math.min(16, mx - mn + 1));
  const bins = new Array(nb).fill(0), bw = (mx - mn + 1e-9) / nb; vals.forEach(v => bins[Math.min(nb - 1, Math.floor((v - mn) / bw))]++);
  const ymx = Math.max(...bins), pad = { l: 26, r: 6, t: 6, b: 16 }, { X, Y } = axes(c, pad, nb, ymx, [0, nb], [0, ymx], i => opts.fmt ? opts.fmt(mn + i * bw) : (mn + i * bw).toFixed(0), v => v);
  bins.forEach((b, i) => { g.fillStyle = opts.color || tok['--accent']; g.fillRect(X(i) + 1, Y(b), X(1) - X(0) - 2, Y(0) - Y(b)); });
};
CH.bars = function (cv, labels, vals, opts = {}) {
  const c = ctx(cv), { g, w, h } = c, mx = (opts.max || Math.max(...vals)) * 1.1, pad = { l: 30, r: 6, t: 8, b: 16 }, n = vals.length;
  const { X, Y } = axes(c, pad, n, mx, [], [0, mx / 2, mx], v => v, opts.yf || (v => Math.round(v)));
  vals.forEach((v, i) => { const x = X(i) + 3, bw = X(1) - X(0) - 6; g.fillStyle = (opts.colors && opts.colors[i]) || tok['--accent']; g.fillRect(x, Y(v), bw, Y(0) - Y(v)); g.fillStyle = tok['--muted']; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(labels[i], x + bw / 2, h - pad.b + 3); g.fillStyle = tok['--ink']; g.textBaseline = 'bottom'; g.fillText(opts.vf ? opts.vf(v, i) : v, x + bw / 2, Y(v) - 1); });
};

/* ---------- bottom-band charts (reference-style: subtle grid, filled areas, current-stage cursor) ---------- */
function frame(c, pad, xs, ys, X, Y, xf, yf) {
  const { g, w, h } = c; g.lineWidth = 1; g.font = '10px Inter, sans-serif';
  ys.forEach(v => { const y = Math.round(Y(v)) + 0.5; g.strokeStyle = tok['--chart-grid'] || tok['--line']; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke(); g.setLineDash([]); g.fillStyle = tok['--muted']; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(yf(v), pad.l - 5, y); });
  g.strokeStyle = tok['--faint']; g.beginPath(); g.moveTo(pad.l, Math.round(Y(ys[0])) + 0.5); g.lineTo(w - pad.r, Math.round(Y(ys[0])) + 0.5); g.stroke();
  g.fillStyle = tok['--muted']; g.textAlign = 'center'; g.textBaseline = 'top'; xs.forEach(v => g.fillText(xf(v), X(v), h - pad.b + 4));
}
function cursor(c, x, top, bot, val) { const { g } = c; g.strokeStyle = tok['--ink']; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x) + 0.5, top); g.lineTo(Math.round(x) + 0.5, bot); g.stroke(); dot(g, x, top, 3.2, tok['--surface'] || '#fff', tok['--ink']); if (val != null) dot(g, x, val, 3.6, tok['--crit'], tok['--surface'] || '#fff'); }
CH.emptyState = function (cv, msg) { const c = ctx(cv), { g, w, h } = c; g.fillStyle = tok['--faint']; g.font = '11.5px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(msg, w / 2, h / 2); };
/* 1. people per pipeline stage: expected (prior), located (detections), GP estimate with 90% band, simulated truth */
CH.stagePeople = function (cv, o, step) {
  const c = ctx(cv), { g, w, h } = c, s = o.steps, u = s.update, pad = { l: 38, r: 10, t: 8, b: 18 };
  const est = u.gp2.estTotal, sd = 1.64 * u.gp2.estSd, truth = u.gp2.trueTotal;
  const mx = nice(Math.max(s.belief.lamTot, est + sd, truth) * 1.1), X = v => pad.l + (w - pad.l - pad.r) * (v - 1) / 10, Y = v => pad.t + (h - pad.t - pad.b) * (1 - v / mx);
  frame(c, pad, [1, 3, 5, 7, 9, 11], [0, mx / 2, mx], X, Y, v => 'S' + v, v => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v));
  const expected = [], located = [], estimate = [];
  for (let k = 1; k <= 11; k++) { if (k >= 3) expected.push([X(k), Y(k >= 10 ? est : s.belief.lamTot)]); located.push([X(k), Y(k < 9 ? 0 : k === 9 ? u.gp1.confirmed : u.gp2.confirmed)]); }
  const cut = arr => arr.filter(p => p[0] <= X(step) + 0.5);
  // future part (faint) then past part
  g.globalAlpha = 0.25; line(g, expected, tok['--warn'], 1.4, [3, 3]); line(g, located, tok['--accent'], 1.4, [3, 3]); g.globalAlpha = 1;
  if (step >= 10) { g.globalAlpha = 0.16; g.fillStyle = tok['--violet']; g.fillRect(X(10), Y(est + sd), X(11) - X(10), Y(est - sd) - Y(est + sd)); g.globalAlpha = 1; }
  const E2 = cut(expected), L2 = cut(located); area(g, L2, Y(0), tok['--accent'], 0.16); line(g, E2, tok['--warn'], 1.8); line(g, L2, tok['--accent'], 2);
  g.setLineDash([5, 4]); g.strokeStyle = tok['--faint']; g.lineWidth = 1.2; g.beginPath(); g.moveTo(pad.l, Y(truth)); g.lineTo(w - pad.r, Y(truth)); g.stroke(); g.setLineDash([]);
  g.fillStyle = tok['--muted']; g.font = '10px Inter, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText('simulated truth ' + truth, pad.l + 4, Y(truth) - 1);
  const yv = step >= 9 ? Y(step === 9 ? u.gp1.confirmed : u.gp2.confirmed) : null; cursor(c, X(step), pad.t, h - pad.b, yv);
  return { expected: Math.round(s.belief.lamTot), located: step >= 9 ? (step === 9 ? u.gp1.confirmed : u.gp2.confirmed) : 0, est: Math.round(est), sd: Math.round(sd), truth };
};
/* 2. coverage vs number of balloons: greedy (ARES), k-means, random, target */
CH.coverageBand = function (cv, o, pick) {
  const c = ctx(cv), { g, w, h } = c, op = o.steps.optimise, b = op.base, full = [0].concat(op.full.steps.map(s => s.cov)), pad = { l: 34, r: 10, t: 8, b: 18 };
  const N = Math.max(8, Math.min(Math.max(full.length, b.kmeans.length, b.random.length) - 1, op.sol.length * 2 + 4));
  const X = v => pad.l + (w - pad.l - pad.r) * v / N, Y = v => pad.t + (h - pad.t - pad.b) * (1 - v);
  frame(c, pad, [0, Math.round(N / 4), Math.round(N / 2), Math.round(3 * N / 4), N], [0, 0.5, 1], X, Y, v => v, v => Math.round(v * 100) + '%');
  g.setLineDash([3, 3]); g.strokeStyle = tok['--crit']; g.lineWidth = 1; g.beginPath(); g.moveTo(pad.l, Y(o.tEff)); g.lineTo(w - pad.r, Y(o.tEff)); g.stroke(); g.setLineDash([]);
  g.fillStyle = tok['--crit']; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.font = '10px Inter, sans-serif'; g.fillText('target ' + Math.round(o.tEff * 100) + '%', w - pad.r, Y(o.tEff) - 1);
  const P = arr => arr.slice(0, N + 1).map((v, i) => [X(i), Y(v)]);
  line(g, P(b.random), tok['--faint'], 1.2, [4, 3]); line(g, P(b.kmeans), tok['--violet'], 1.5);
  const gp = P(full); area(g, gp, Y(0), tok['--accent'], 0.14); line(g, gp, tok['--accent'], 2);
  const k = pick == null ? op.sol.length : pick; if (k > 0 && full[k] != null) cursor(c, X(k), pad.t, h - pad.b, Y(full[k]));
  return { k, cov: full[k] || 0 };
};
/* 3. elevation profile along a polyline (real DEM), with shaded segments (e.g. observed scour) */
CH.profileLine = function (cv, o, pts, opts = {}) {
  const c = ctx(cv), { g, w, h } = c, T = o.T, pad = { l: 40, r: 10, t: 8, b: 18 }; if (!pts || pts.length < 2) return null;
  const L = C.plLen(pts), n = 160, z = [], sh = []; let mn = 1e9, mx = -1e9;
  for (let i = 0; i <= n; i++) { const q = C.pointAt(pts, i / n), e = C.elevAt(T, q.x, q.y); z.push(e); mn = Math.min(mn, e); mx = Math.max(mx, e); sh.push(opts.flag ? opts.flag(q.x, q.y) : 0); }
  if (opts.extra) opts.extra.forEach(v => { mn = Math.min(mn, v); mx = Math.max(mx, v); });
  const rg = Math.max(5, mx - mn), lo = Math.floor((mn - rg * 0.08) / 10) * 10, hi = Math.ceil((mx + rg * 0.12) / 10) * 10, km = L / 1000;
  const X = v => pad.l + (w - pad.l - pad.r) * v / km, Y = v => pad.t + (h - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
  frame(c, pad, [0, km / 2, km], [lo, (lo + hi) / 2, hi], X, Y, v => v.toFixed(km < 3 ? 1 : 0) + ' km', v => Math.round(v).toLocaleString('en-IN'));
  const P = z.map((e, i) => [X(km * i / n), Y(e)]);
  area(g, P, Y(lo), tok['--ok'], 0.2); line(g, P, tok['--ok'], 1.4);
  if (opts.flag) { g.fillStyle = tok['--accent']; g.globalAlpha = 0.85; for (let i = 0; i < n; i++) if (sh[i]) g.fillRect(X(km * i / n), h - pad.b - 3, X(km / n) - X(0) + 0.5, 3); g.globalAlpha = 1; }
  if (opts.los) { const [a, b] = opts.los; line(g, [[X(0), Y(a)], [X(km), Y(b)]], opts.blocked ? tok['--crit'] : tok['--comm'], 1.6, opts.blocked ? [4, 3] : null); dot(g, X(km), Y(b), 3.5, tok['--accent']); dot(g, X(0), Y(a), 3, tok['--ink']); }
  return { km, lo: mn, hi: mx };
};
})(window.ARES);
