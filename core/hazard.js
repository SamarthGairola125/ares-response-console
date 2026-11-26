/* ARES simulation — hazard overlays draped on terrain (v4):
   observed-hazard boundary (marching squares on the observed change mask), the DEM path of steepest descent from the top of
   the observed scour with named markers, downslope direction arrows, OSM drainage and roads (batched), the approximate
   breach zone (Assam), the hypothetical collapse-probability rings (Delhi), and camera presets.
   Everything is geometry derived from data or the model — there is no time-stepped flow simulation. */
(function (A) {
'use strict';
const C = A.core, E = A.scene, { CLS } = C;
const H = A.hazard = {};

function maskGrid(T, M, blurR) {
  const G = T.G, m = new Float32Array(G * G);
  const isHaz = k => M.hazMask ? M.hazMask[k] : (C.isFlood(M) ? (T.cls[k] === CLS.WATER && T.preCls[k] !== CLS.WATER) : M.dmg.includes(T.cls[k]));
  for (let k = 0; k < G * G; k++) m[k] = isHaz(k) ? 1 : 0;
  if (!blurR) return m; const o = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { let s = 0, n = 0; for (let q = -blurR; q <= blurR; q++) for (let r = -blurR; r <= blurR; r++) { const ii = i + r, jj = j + q; if (ii < 0 || jj < 0 || ii >= G || jj >= G) continue; s += m[jj * G + ii]; n++; } o[j * G + i] = s / n; }
  return o;
}
function contours(m, T, thr) {
  const G = T.G, h = T.S / 2, P = (i, j) => [-h + i * T.cell, -h + j * T.cell], segs = [];
  const lerp = (a, b, va, vb) => { const t = (thr - va) / ((vb - va) || 1e-9); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
  for (let j = 0; j < G - 1; j++) for (let i = 0; i < G - 1; i++) {
    const a = m[j * G + i], b = m[j * G + i + 1], c = m[(j + 1) * G + i + 1], d = m[(j + 1) * G + i];
    const idx = (a > thr ? 1 : 0) | (b > thr ? 2 : 0) | (c > thr ? 4 : 0) | (d > thr ? 8 : 0); if (idx === 0 || idx === 15) continue;
    const pa = P(i, j), pb = P(i + 1, j), pc = P(i + 1, j + 1), pd = P(i, j + 1);
    const eB = () => lerp(pa, pb, a, b), eR = () => lerp(pb, pc, b, c), eT = () => lerp(pd, pc, d, c), eL = () => lerp(pa, pd, a, d);
    const tbl = { 1: [[eL, eB]], 2: [[eB, eR]], 3: [[eL, eR]], 4: [[eR, eT]], 5: [[eL, eT], [eB, eR]], 6: [[eB, eT]], 7: [[eL, eT]], 8: [[eT, eL]], 9: [[eT, eB]], 10: [[eT, eR], [eL, eB]], 11: [[eT, eR]], 12: [[eR, eL]], 13: [[eR, eB]], 14: [[eB, eL]] };
    for (const [f, g] of tbl[idx]) segs.push([f(), g()]);
  }
  const key = p => Math.round(p[0] * 2) + ',' + Math.round(p[1] * 2), adj = new Map();
  segs.forEach((s, i) => { for (const e of [0, 1]) { const k = key(s[e]); if (!adj.has(k)) adj.set(k, []); adj.get(k).push([i, e]); } });
  const used = new Uint8Array(segs.length), lines = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue; used[i] = 1; const line = [segs[i][0], segs[i][1]];
    for (const dir of [1, 0]) { let cur = dir ? line[line.length - 1] : line[0]; for (;;) { const nb = (adj.get(key(cur)) || []).find(([si]) => !used[si]); if (!nb) break; used[nb[0]] = 1; const nxt = segs[nb[0]][1 - nb[1]]; if (dir) line.push(nxt); else line.unshift(nxt); cur = nxt; } }
    lines.push(line);
  }
  return lines;
}
H.contours = contours;
function chaikin(p, it = 2) { let a = p; for (let k = 0; k < it; k++) { const o = [a[0]]; for (let i = 0; i < a.length - 1; i++) { const [x0, y0] = a[i], [x1, y1] = a[i + 1]; o.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]); } o.push(a[a.length - 1]); a = o; } return a; }
const plLen = C.plLen;
function inside(T, p, m = 0) { return Math.abs(p[0]) <= T.S / 2 - m && Math.abs(p[1]) <= T.S / 2 - m; }
function clipRuns(T, pts) { const runs = []; let cur = []; for (const p of pts) { if (inside(T, p, 4)) cur.push(p); else { if (cur.length > 1) runs.push(cur); cur = []; } } if (cur.length > 1) runs.push(cur); return runs; }
function downhill(pts) { const a = pts[0], b = pts[pts.length - 1]; return E.H(a[0], a[1]) >= E.H(b[0], b[1]) ? pts : pts.slice().reverse(); }

/* path of steepest descent on the depression-filled DEM, from the top of the main observed scour (real-data packs) */
function descentPath(o) {
  const T = o.T, M = o.M, G = T.G, h = T.S / 2; if (M.srcCell == null || !M.rcv) return null;
  const cells = []; let k = M.srcCell, guard = 0; while (k >= 0 && guard++ < G * 4) { cells.push(k); k = M.rcv[k]; }
  let last = 0; cells.forEach((c, i) => { if (M.hazNear[c]) last = i; }); const keep = cells.slice(0, Math.min(cells.length, last + 3));
  if (keep.length < 4) return null;
  const pts = keep.map(c => [-h + (c % G) * T.cell, -h + ((c / G) | 0) * T.cell]); return chaikin(pts, 3);
}
function hazardPath(o) {
  const M = o.M, sc = o.sc, sub = C.subPL;
  if (M.real) {
    if (M.hazard !== 'debris') return null;
    const pts = descentPath(o); if (!pts) return null; const L = plLen(pts);
    const top = Math.round(C.elevAt(o.T, pts[0][0], pts[0][1])), marks = [[0, sc.id === 'dehradun' ? `Reported location · Sahastradhara ≈${top.toLocaleString('en-IN')} m` : `Top of observed scour · ≈${top.toLocaleString('en-IN')} m`]];
    const used = new Set(['Sahastradhara']); (M.places || []).forEach(p => { if (marks.length >= 4 || used.has(p.name)) return; const d = C.distPL(p.x, p.y, pts); if (d.d < 450 && d.s / d.L > 0.12 && d.s / d.L < 0.92) { marks.push([d.s / d.L, `Downstream · ${p.name}`]); used.add(p.name); } });
    marks.push([1, 'Lower end of observed scour']); marks.sort((a, b) => a[0] - b[0]);
    return { pts, marks, derived: true, len: L };
  }
  // procedural fallback (v3 geometry)
  if (sc.id === 'dehradun') { const [song, baldi] = M.rivers; const a = downhill(sub(baldi, 0.3, 1, 40)), b = sub(song, 0.47, 0.97, 50); const pts = a.concat(b.slice(1)); const fa = plLen(a) / plLen(pts); return { pts, marks: [[0, 'Source · Sahastradhara catchment'], [fa * 0.55, 'Flash-flood channel · Baldi'], [fa, 'Confluence · Song River'], [1, 'Deposition · below Karligad']] }; }
  if (sc.id === 'wayanad') { const pts = sub(M.rivers[0], 0.03, 0.9, 80); return { pts, marks: [[0, 'Source · crown ≈1,544 m'], [0.42, 'Runout · Mundakkai'], [0.75, 'Runout · Chooralmala'], [1, 'Deposition']] }; }
  if (sc.id === 'nepal') { const pts = sub(M.rivers[0], 0.005, 0.97, 90); return { pts, marks: [[0, 'Debris-flow front entering area'], [0.33, 'Timure'], [0.6, 'Hydropower headworks'], [1, 'Downstream (Syabrubesi →)']] }; }
  return null;
}

H.build = function (o) {
  const W = E.world, T = o.T, M = o.M, S = T.S, d = S / 10, root = new THREE.Group(); root.name = 'hazard'; W.root.add(root);
  H.grp = {}; const g = name => { const x = new THREE.Group(); x.name = name; root.add(x); H.grp[name] = x; return x; };
  const gb = g('boundary'), gp = g('path'), ga = g('arrows'), gd = g('drainage'), gr = g('roads'), gg = g('glowg'), gk = g('rings');
  H.root = root;
  /* drainage (OSM waterways, batched: rivers wider than streams) */
  const riv = [], str = [];
  if (M.real) (M.riverMeta || []).forEach(w => clipRuns(T, w.pts).forEach(run => (w.kind === 'river' ? riv : str).push(run)));
  else (M.rivers || []).forEach(rv => clipRuns(T, C.subPL(rv, 0, 1, 160)).forEach(run => riv.push(run)));
  if (riv.length) gd.add(E.drapeSegments(riv, { color: 0x2f6fae, width: 2.2, offset: 1.5, opacity: 0.85 }));
  if (str.length) gd.add(E.drapeSegments(str, { color: 0x3f7fbf, width: 1.2, offset: 1.5, opacity: 0.7 }));
  /* roads (OSM, batched by class: casing + fill) */
  if (M.real) {
    const major = [], minor = [], track = [];
    (M.roadsAll || []).forEach(r => clipRuns(T, r.pts).forEach(run => (r.cls <= 2 ? major : r.cls === 3 ? minor : track).push(run)));
    if (major.length) { gr.add(E.drapeSegments(major, { color: 0x4f4b45, width: 4.2, offset: 2, opacity: 0.55, order: 2 })); gr.add(E.drapeSegments(major, { color: 0xf3eee4, width: 2.0, offset: 2.2, opacity: 0.9, order: 3 })); }
    if (minor.length) gr.add(E.drapeSegments(minor, { color: 0xe9e3d7, width: 1.0, offset: 2.1, opacity: 0.5, order: 3 }));
    if (track.length) gr.add(E.drapeSegments(track, { color: 0xd8cdb8, width: 0.8, offset: 2.1, opacity: 0.35, order: 3 }));
  } else {
    let roads = (M.roads || []).slice(); if (o.sc.id === 'delhi') { roads = []; for (let v = -1000 + 9; v < 1000; v += 150) { roads.push([[v, -1000], [v, 1000]], [[-1000, v], [1000, v]]); } }
    const rr = []; roads.forEach(rd => clipRuns(T, rd.length > 4 ? C.subPL(rd, 0, 1, 120) : rd).forEach(run => rr.push(run)));
    if (rr.length) { gr.add(E.drapeSegments(rr, { color: 0x5b5a56, width: 3.6, offset: 2, opacity: 0.55, order: 2 })); gr.add(E.drapeSegments(rr, { color: 0xeeeae2, width: 1.8, offset: 2.2, opacity: 0.95, order: 3 })); }
  }
  /* hazard boundary: thin bright stroke over a dark halo, traced on the observed mask */
  const delhi = o.sc.id === 'delhi', mask = maskGrid(T, M, delhi ? 3 : 1), lines = contours(mask, T, delhi ? 0.2 : 0.5).filter(l => plLen(l) > (delhi ? 300 : 160)).map(l => chaikin(l, 2));
  if (lines.length) { gb.add(E.drapeSegments(lines, { color: 0x2a1408, width: 3.6, offset: 3, opacity: 0.35, order: 5 })); gb.add(E.drapeSegments(lines, { color: M.flood ? 0xdff4ff : 0xffe7cf, width: 1.5, offset: 3.2, opacity: 0.95, order: 6 })); }
  H.boundaryCount = lines.length;
  /* Copernicus EMS reference (where available): AOI outline, graded building points, affected transport */
  if (M.cems) { const gc = g('cems'), cm = M.cems, sq = (x, y, r) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r], [x - r, y - r]];
    gc.add(E.drapeSegments(cm.coverage, { color: 0x1c2a3a, width: 3.2, offset: 3.5, opacity: 0.35, order: 5 })); gc.add(E.drapeSegments(cm.coverage, { color: 0xf4f7fb, width: 1.4, dashed: true, dash: d / 160, gap: d / 220, offset: 3.7, opacity: 0.95, order: 6 }));
    const tr = (cm.transport || []).filter(t => t.grade === 'Destroyed').map(t => t.pts); if (tr.length) gc.add(E.drapeSegments(tr, { color: 0x8f1f1a, width: 2.6, offset: 3.4, opacity: 0.9, order: 6 }));
    [['Destroyed', 0xb3261e, 7], ['Damaged', 0xf08a24, 6], ['Possibly damaged', 0xf6d23b, 5]].forEach(([gname, col, r]) => { const pl = (cm.buildings || []).filter(q => q.grade === gname).map(q => sq(q.x, q.y, r)); if (pl.length) { gc.add(E.drapeSegments(pl, { color: 0x1a1210, width: 3.4, offset: 4, opacity: 0.55, order: 7 })); gc.add(E.drapeSegments(pl, { color: col, width: 2.0, offset: 4.2, opacity: 1, order: 8 })); } });
    let top = cm.coverage[0].reduce((a, p) => p[1] > a[1] ? p : a, cm.coverage[0][0]); E.addLabel(`<b>CEMS ${cm.meta.code} · ${cm.meta.aoi.name}</b><span>damage grading ${(cm.meta.images[0] || {}).acquired ? cm.meta.images[0].acquired.slice(0, 10) : ''}</span>`, top[0], top[1], 30, 'mark', { group: 'cems', pri: 3 });
    (cm.facilities || []).forEach(f => { gc.add(E.marker(f.x, f.y, { ring: '#b3261e', z: 8 })); E.addLabel(`<b>${f.name}</b><span>${(f.grade || '').toLowerCase()} (CEMS)</span>`, f.x, f.y, 24, 'mark', { group: 'cems', pri: 2 }); }); }
  /* path + markers + arrows */
  const hp = hazardPath(o); H.path = hp; H.marks = [];
  if (hp) {
    gp.add(E.drapeLine(hp.pts, { color: 0x1d1b18, width: 4.4, offset: 5, opacity: 0.38, order: 6 }));
    gp.add(E.drapeLine(hp.pts, { color: 0xf6c33b, width: 2.4, dashed: true, dash: d / 90, gap: d / 150, offset: 5.5, opacity: 1, order: 7 }));
    hp.marks.forEach(([f, label]) => { const q = C.pointAt(hp.pts, f); gp.add(E.marker(q.x, q.y, { z: 8 })); H.marks.push({ x: q.x, y: q.y, label, f }); const [t, s] = label.split(' · '); E.addLabel(`<b>${t}</b>${s ? `<span>${s}</span>` : ''}`, q.x, q.y, 26, 'mark', { group: 'hazmarks' }); });
    const fr = [0.14, 0.32, 0.5, 0.68, 0.86];
    fr.forEach((f, i) => { const side = (i % 2 ? 1 : -1) * Math.min(130, S * 0.02), f1 = Math.min(1, f + 0.06), seg = []; for (let k = 0; k <= 10; k++) { const q = C.pointAt(hp.pts, f + (f1 - f) * k / 10); seg.push([q.x + q.nx * side, q.y + q.ny * side]); }
      ga.add(E.drapeLine(seg, { color: 0xf05a24, width: 2.8, offset: 5, order: 7 })); const e = seg[seg.length - 1], p = seg[seg.length - 2]; ga.add(E.arrowHead(e[0], e[1], e[0] - p[0], e[1] - p[1], { z: 5 })); });
  }
  if (M.real && M.flood) { // reported breach area: location only known approximately -> draw an uncertainty zone, not a point
    const ip = M.incident, R = 1500, pts = []; for (let a = 0; a <= 96; a++) pts.push([C.clamp(ip[0] + Math.cos(a / 96 * 6.283) * R, -S / 2, S / 2), C.clamp(ip[1] + Math.sin(a / 96 * 6.283) * R, -S / 2, S / 2)]);
    gk.add(E.drapeLine(pts, { color: 0xf6c33b, width: 1.8, dashed: true, dash: d / 110, gap: d / 160, offset: 6, order: 7, opacity: 0.95 }));
    gp.add(E.marker(ip[0], ip[1], { z: 10 })); H.marks.push({ x: ip[0], y: ip[1], label: 'Reported breach area', f: 0 });
    E.addLabel('<b>Reported breach area</b><span>Kurua · location ±1.5 km</span>', ip[0], ip[1], 30, 'mark', { group: 'hazmarks' });
  }
  /* drop event labels that duplicate a path marker */
  E.world.labels = E.world.labels.filter(L => { if (L.kind !== 'event' || !hp) return true; const near = H.marks.some(m => { const p = E.wp(m.x, m.y); return p.distanceTo(L.pos) < d * 0.09; }); if (near) L.el.remove(); return !near; });
  /* source glow (selected hazard origin) */
  const src = hp ? hp.pts[0] : M.incident; const fl = E.glow(src[0], src[1], { size: d * 0.05, z: 10 }); gg.add(fl); H.flare = fl;
  E.onFrame(t => { if (!gg.visible || E.reduce) return; const s = d * (0.045 + 0.008 * Math.sin(t / 520)); fl.scale.setScalar(s); return true; });
  /* Delhi: collapse-probability rings from the scenario's own (hypothetical) fragility function p(r) = 0.55·e^-(r/500)² + 0.02 */
  if (delhi) { const ep = M.epi || M.incident; [0.4, 0.2, 0.1].forEach((p, i) => { const r = 500 * Math.sqrt(-Math.log((p - 0.02) / 0.55)), pts = []; for (let a = 0; a <= 96; a++) pts.push([ep[0] + Math.cos(a / 96 * 6.283) * r, ep[1] + Math.sin(a / 96 * 6.283) * r]); gk.add(E.drapeLine(pts.map(q => [C.clamp(q[0], -S / 2, S / 2), C.clamp(q[1], -S / 2, S / 2)]), { color: [0xc4362c, 0xe0601f, 0xf2b632][i], width: 2.2, dashed: i > 0, dash: d / 120, gap: d / 200, offset: 6, order: 7, surf: true })); const ang = 0.35 + i * 0.75; E.addLabel(`<b>Collapse probability ${Math.round(p * 100)}%</b><span>hypothetical model</span>`, ep[0] + r * Math.cos(ang), ep[1] + r * Math.sin(ang), 40, 'mark', { group: 'hazmarks' }); }); gp.add(E.marker(ep[0], ep[1], { ring: '#c4362c', z: 10 })); H.marks.push({ x: ep[0], y: ep[1], label: 'Epicentral zone (hypothetical)', f: 0 }); }
  /* camera presets */
  const P = {}, home = { pos: E.home.pos.clone(), tgt: E.home.tgt.clone() }; P.overview = home;
  const first = H.marks[0] || { x: M.incident[0], y: M.incident[1] }, last = H.marks[H.marks.length - 1] || first;
  const azAlong = hp ? (() => { const a = hp.pts[0], b = hp.pts[hp.pts.length - 1]; return Math.atan2(-(b[0] - a[0]), (b[1] - a[1])) * 57.3 + 180; })() : (E.focus ? -E.focus.bearing * 57.3 : 200);
  P.source = E.poseLooking(first.x, first.y, 0.2, 34, azAlong + 25);
  if (hp) { const mid = C.pointAt(hp.pts, 0.5); P.runout = E.poseLooking(mid.x, mid.y, 0.36, 36, azAlong + 65); } else P.runout = E.poseLooking(E.focus ? E.focus.cx : first.x, E.focus ? E.focus.cy : first.y, 0.42, 46, azAlong + 30);
  P.deposition = E.poseLooking(last.x, last.y, 0.22, 33, azAlong - 20);
  P.icp = E.poseLooking(M.icp[0], M.icp[1], 0.18, 30, 200);
  P.top = { pos: new THREE.Vector3(E.home.tgt.x, d * 1.3, E.home.tgt.z + 0.001), tgt: E.home.tgt.clone() };
  H.presets = P;
  H.tourPoses = (o2) => { const t = [{ ...{ pos: home.pos.clone().multiplyScalar(1.0).add(new THREE.Vector3(0, d * 0.25, 0)), tgt: home.tgt.clone() }, dur: 1800, hold: 500, step: 2, cap: 'The disaster area' }, { ...P.source, dur: 3200, hold: 1300, step: 2, cap: hp ? 'Where the observed scour begins' : 'Reported location' }];
    if (hp) { [0.4, 0.7].forEach(f => { const q = C.pointAt(hp.pts, f); t.push({ ...E.poseLooking(q.x, q.y, 0.26, 34, azAlong + 40), dur: 3000, hold: 400, step: 2, cap: 'Along the affected channel' }); }); }
    t.push({ ...home, dur: 2600, hold: 1500, step: 5, cap: 'Usable launch sites' }, { ...home, dur: 600, hold: 2200, step: 7, cap: 'Fewest balloons that cover most people' }, { ...E.poseLooking(home.tgt.x * 10, -home.tgt.z * 10, 0.55, 40, azAlong + 10), dur: 2400, hold: 2200, step: 8, cap: 'Balloons up, links to the command post' }, { ...home, dur: 2200, hold: 2200, step: 10, cap: 'Detections correct the estimate' }, { ...home, dur: 800, hold: 2600, step: 11, cap: 'Sectors and routes for rescue teams' });
    return t; };
  return root;
};
H.setVisible = function (k, on) { if (H.grp && H.grp[k]) { H.grp[k].visible = on; E.kick(); } };
})(window.ARES);
