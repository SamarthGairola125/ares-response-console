/* ARES — map inspector and decision summary.
   Everything shown is read from the loaded data pack (T, M, manifest records) and the current model run (app.out);
   nothing is estimated here that the model does not already compute. Each fact carries its provenance tier. */
(function (A) {
'use strict';
const C = A.core, Mo = A.model, PK = A.pack, IN = A.inspect = {};
const f0 = v => Math.round(v).toLocaleString('en-IN'), f1 = v => (+v).toFixed(1), pc = v => (v * 100).toFixed(1) + '%', pc0 = v => Math.round(v * 100) + '%';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WORD = { verified: 'real', derived: 'derived', modelled: 'model', assumption: 'assumed', synthetic: 'synthetic', reported: 'reported' };
const tier = t => `<span class="tier ${t === 'reported' ? 'derived' : t}">${WORD[t] || t}</span>`;
const row = (k, v, t) => `<dt>${k}</dt><dd>${v}${t ? ' ' + tier(t) : ''}</dd>`;
const sec = (title, body, sub) => `<div class="sec"><h4>${title}${sub ? ` <small>${sub}</small>` : ''}</h4>${body}</div>`;
IN.ll = (sc, x, y) => [sc.lat + y / 111320, sc.lon + x / (111320 * Math.cos(sc.lat * Math.PI / 180))];
const llTxt = (sc, x, y) => { const [a, b] = IN.ll(sc, x, y); return `${a.toFixed(5)}°N ${b.toFixed(5)}°E`; };

/* ---------- spatial indexes (built once per loaded scenario) ---------- */
function index(app) {
  const b = app.built; if (b._ix) return b._ix; const M = b.M, cs = 50, grid = new Map(), key = (x, y) => Math.floor(x / cs) + ',' + Math.floor(y / cs), put = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  M.buildings.forEach((bd, i) => put(grid, key(bd.x, bd.y), i));
  const segs = new Map(); (M.roadsAll || []).forEach((r, ri) => { for (let s = 0; s < r.pts.length - 1; s++) { const [ax, ay] = r.pts[s], [bx, by] = r.pts[s + 1], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / cs)); const seen = new Set(); for (let t = 0; t <= n; t++) { const k = key(ax + (bx - ax) * t / n, ay + (by - ay) * t / n); if (!seen.has(k)) { seen.add(k); put(segs, k, [ri, s]); } } } });
  const ww = (M.pack && M.pack.osm && M.pack.osm.waterways) || [];
  b._ix = { grid, segs, cs, key, ww }; return b._ix;
}
function buildingAt(app, x, y) {
  const ix = index(app), M = app.built.M, gx = Math.floor(x / ix.cs), gy = Math.floor(y / ix.cs); let best = -1, bd = 7;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of (ix.grid.get((gx + dx) + ',' + (gy + dy)) || [])) {
    const b = M.buildings[i], c = Math.cos(b.rot), s = Math.sin(b.rot), u = (x - b.x) * c + (y - b.y) * s, v = -(x - b.x) * s + (y - b.y) * c, du = Math.max(0, Math.abs(u) - b.w / 2), dv = Math.max(0, Math.abs(v) - b.d / 2), d = Math.hypot(du, dv);
    if (d < bd) { bd = d; best = i; } }
  return best;
}
function roadAt(app, x, y, maxD = 25) {
  const ix = index(app), M = app.built.M, gx = Math.floor(x / ix.cs), gy = Math.floor(y / ix.cs); let best = null, bd = maxD;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const [ri, s] of (ix.segs.get((gx + dx) + ',' + (gy + dy)) || [])) { const r = M.roadsAll[ri], d = C.distPL(x, y, [r.pts[s], r.pts[s + 1]]).d; if (d < bd) { bd = d; best = { r, d }; } }
  return best;
}
function nearestOf(list, x, y, maxD, ptsKey = 'pts') { let best = null, bd = maxD; for (const w of list) { const p = w[ptsKey]; if (!p || p.length < 2) continue; let lo = 1e9, hi = -1e9, lo2 = 1e9, hi2 = -1e9; for (const q of p) { lo = Math.min(lo, q[0]); hi = Math.max(hi, q[0]); lo2 = Math.min(lo2, q[1]); hi2 = Math.max(hi2, q[1]); } if (x < lo - maxD || x > hi + maxD || y < lo2 - maxD || y > hi2 + maxD) continue; const d = C.distPL(x, y, p).d; if (d < bd) { bd = d; best = { w, d }; } } return best; }

/* ---------- facts about one point ---------- */
function hazardFact(app, k) {
  const o = app.out, M = o.M, L = app.built.layers || {}, sc = o.sc;
  if (sc.id === 'delhi') return { txt: 'Hypothetical scenario — damage is modelled, not observed', t: 'synthetic' };
  if (M.cems && M.cems.grid && M.cems.grid[k] >= 1) return { txt: M.cems.grid[k] === 2 ? `Inside the ${M.cems.meta.code} observed event area (photo-interpreted, ${(M.cems.meta.images[0] || {}).acquired ? String(M.cems.meta.images[0].acquired).slice(0, 10) : 'date n/a'})` : `Mapped by ${M.cems.meta.code}: no event observed here`, t: 'verified' };
  if (!M.hazMask) return { txt: 'No observed hazard layer', t: null };
  const r = L.hazard && L.hazard.rec, dates = r && r.observation_start ? ` (${String(r.observation_start).slice(0, 10)} → ${String(r.observation_end || '').slice(0, 10)})` : '';
  return M.hazMask[k] ? { txt: (M.flood ? 'Inside the observed inundation' : 'Inside the observed scour / debris') + dates, t: 'derived' } : { txt: (M.hazNear && M.hazNear[k] ? 'Outside, but within 150 m of' : 'Outside') + ' the observed hazard area', t: 'derived' };
}
function coverFact(app, c) {
  const o = app.out, n = app.step; if (n < 6) return null;
  if (n === 6) { let sites = 0; for (let j = 0; j < o.sites.length; j++) if (o.cc.cov[j * o.B.N + c]) sites++; return { txt: sites ? `${sites} usable launch sites could watch this cell` : 'No usable launch site can watch this cell (terrain or distance)', t: 'modelled', cov: [] }; }
  const vis = app.visibleNodes().filter(i => o.nodes[i].role === 'sense'), cov = vis.filter(i => o.cc.cov[o.nodes[i].site * o.B.N + c]);
  const cx = o.B.cx[c], cy = o.B.cy[c], phone = app.visibleNodes().some(i => { const s = o.sites[o.nodes[i].site]; return Math.hypot(s.x - cx, s.y - cy) < o.p.commR; });
  return { txt: cov.length ? `Seen by ${cov.map(i => `<button class="lnk" data-node="${i}">${o.nodes[i].id}</button>`).join(', ')}` : '<b class="bad">Not seen by any camera aerostat</b>', phone, t: 'modelled', cov };
}
IN.point = function (app, x, y, opts = {}) {
  const o = app.out, T = o.T, M = o.M, sc = o.sc, L = app.built.layers || {}, B = o.B, h = T.S / 2;
  if (Math.abs(x) > h || Math.abs(y) > h) return { title: 'Outside the model area', html: sec('Outside the model area', `<p class="src">The terrain beyond the model area is real elevation shown for context only; the model has no data here.</p>`), x, y };
  const k = C.idxAt(T, x, y), c = B.cellOf(x, y), out = [];
  // --- building
  const bi = opts.building != null ? opts.building : buildingAt(app, x, y);
  if (bi >= 0) {
    const b = M.buildings[bi], srcT = b.src === 'osm' ? 'verified' : b.src === 'cems' ? 'verified' : 'derived';
    const srcTxt = b.src === 'osm' ? `OpenStreetMap${b.id ? ` <a href="https://www.openstreetmap.org/${String(b.id).startsWith('w') ? 'way/' + String(b.id).slice(1) : String(b.id).startsWith('r') ? 'relation/' + String(b.id).slice(1) : 'way/' + b.id}" target="_blank" rel="noopener">${esc(b.id)} ↗</a>` : ''}` : b.src === 'cems' ? `Copernicus EMS point (footprint size assumed)` : 'Google Open Buildings (machine-learning footprint)';
    let dmg, dmgT; if (b.cems) { dmg = `${b.cems} (Copernicus EMS grading)`; dmgT = 'verified'; } else if (sc.id === 'delhi') { dmg = b.collapsed ? 'Collapsed in the hypothetical scenario' : 'Standing in the hypothetical scenario'; dmgT = 'synthetic'; } else if (b.collapsed) { dmg = 'Inside the observed debris — treated as destroyed or buried'; dmgT = 'derived'; } else if (b.flood) { dmg = 'In or next to observed flood water — treated as flooded'; dmgT = 'derived'; } else { dmg = 'No damage indicated by the observed hazard layer'; dmgT = 'derived'; }
    out.push(sec('Building', `<dl class="kv">${row('Footprint', srcTxt, srcT)}${row('Type', esc(b.type === 'yes' ? 'not specified' : b.type))}${row('Height', `${f1(b.h0)} m · ${esc(b.hsrc)}`, /assumed/.test(b.hsrc) ? 'assumption' : /ML/.test(b.hsrc) ? 'derived' : 'verified')}${row('Footprint area', f0(b.area) + ' m²')}${row('Condition', dmg, dmgT)}${row('Residents (share of cell)', b.occ ? f1(b.occ) + ' people' : '—', 'modelled')}</dl>`, ''));
  }
  // --- road
  const rd = roadAt(app, x, y); if (rd) { const r = rd.r; out.push(sec('Road', `<dl class="kv">${row('Name', esc(r.name || 'unnamed'))}${row('Class', `${esc(r.hw || ('class ' + r.cls))}${r.bridge ? ' · <b>bridge</b>' : ''}`, 'verified')}${r.surface ? row('Surface', esc(r.surface)) : ''}${row('Condition', M.hazMask && M.hazMask[k] ? 'This section lies inside the observed hazard area' : 'Not inferred from imagery', M.hazMask && M.hazMask[k] ? 'derived' : null)}${row('Source', `OpenStreetMap <a href="https://www.openstreetmap.org/way/${esc(r.id)}" target="_blank" rel="noopener">way ${esc(r.id)} ↗</a> · ${f0(rd.d)} m from the click`)}</dl>`)); }
  // --- water
  const ww = nearestOf(index(app).ww, x, y, 40); if (ww) out.push(sec('Waterway', `<dl class="kv">${row('Name', esc(ww.w.name || 'unnamed'))}${row('Kind', esc(ww.w.kind), 'verified')}${row('Distance', f0(ww.d) + ' m')}</dl>`));
  // --- place & terrain
  let pl = null, pd = 1e9; (M.places || []).forEach(p => { const d = Math.hypot(p.x - x, p.y - y); if (d < pd) { pd = d; pl = p; } });
  const hz = hazardFact(app, k), wc = T.wc ? PK.WC_NAME[T.wc[k]] : C.CLS_NAME[T.cls[k]];
  out.push(sec('Location', `<dl class="kv">${row('Position', `≈ ${llTxt(sc, x, y)}`)}${pl ? row('Nearest place', `${esc(pl.name)} (${esc(pl.kind)}) · ${pd < 1000 ? f0(pd) + ' m' : f1(pd / 1000) + ' km'}`, 'verified') : ''}${row('Elevation', `${f0(C.elevAt(T, x, y))} m`, (L.terrain && L.terrain.tier) || 'verified')}${row('Slope', `${Math.round(Math.atan(T.slope[k]) * 57.3)}°`, 'derived')}${row('Land cover', esc(wc || '—') + (T.wc ? ' (WorldCover 2021)' : ''), T.wc ? 'verified' : 'synthetic')}${row('Hazard', hz.txt, hz.t)}</dl>`));
  // --- population & need (belief cell)
  const n = app.step, lam = B.lam[c], est = n >= 10 ? o.gp2.est[c] : null, sd = n >= 10 ? o.gp2.sd[c] : null;
  out.push(sec('People in this 150 m cell', `<dl class="kv">${row('Residents', f0(B.occ[c]) + ' (WorldPop 2020)', 'modelled')}${n >= 3 ? row('Expected to need help', f1(lam) + ` · priority P${B.prio[c]}`, 'modelled') : ''}${est != null ? row('Corrected estimate', `${f1(est)} ± ${f1(1.64 * sd)} (90%)`, 'modelled') + row('Confirmed here', `${f0(o.gp2.obsCnt[c])} (simulation)`, 'synthetic') : ''}</dl>${n < 3 ? '<p class="src">Expected need is estimated at stage 3.</p>' : ''}`, `cell #${c}`));
  // --- coverage, sector, launch site
  const cf = coverFact(app, c);
  if (cf) out.push(sec('Coverage', `<dl class="kv">${row('Cameras', cf.txt, cf.t)}${app.step >= 8 ? row('Phones / beacons', cf.phone ? `Within ${f0(o.p.commR)} m of an aerostat (link still depends on terrain)` : `<b class="bad">Out of range</b> of every aerostat`, 'modelled') : ''}</dl>`));
  if (n >= 11 && o.sec) { const s = o.sec[c], r = (o.sectors || []).find(q => s >= 0 ? q.i === s : s === -2 ? q.i === -2 : false); if (r) out.push(sec('Rescue sector', `<dl class="kv">${row('Sector', `${esc(r.id)} · rank ${r.rank}`)}${row('Priority', r.pri === 1 ? 'Search first' : r.pri === 2 ? 'Next' : 'Later', 'modelled')}${row('Expected', `${f0(r.est)} ± ${f0(1.64 * r.sd)} people`, 'modelled')}${row('Route', r.route ? `${f1(r.route.len / 1000)} km ${r.route.boat ? 'by boat' : 'on foot'} from the command post` : 'not computed for lower-ranked sectors', 'modelled')}</dl>`)); }
  if (n >= 5) { let best = null, bd = 90; o.sites.forEach((s, j) => { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = { s, j, ok: true }; } }); o.steps.sites.rejected.forEach((s, j) => { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = { s, j, ok: false }; } });
    if (best) out.push(sec('Launch site', `<dl class="kv">${row('Nearest candidate', `${f0(bd)} m away · ${best.ok ? '<b class="ok">usable</b>' : '<b class="bad">ruled out</b>: ' + esc(best.s.why)}`, 'modelled')}${row('Ground', `${esc(C.CLS_NAME[best.s.cls])}, slope ${Math.round(Math.atan(best.s.slope) * 57.3)}°`)}</dl>`)); }
  const title = bi >= 0 ? 'Building' : rd ? (rd.r.bridge ? 'Bridge' : 'Road') : pl && pd < 300 ? pl.name : 'Point';
  return { title, html: out.join(''), x, y, r: bi >= 0 ? Math.max(12, M.buildings[bi].w) : 40 };
};
IN.person = function (app, i) {
  const o = app.out, P = o.P, x = P.x[i], y = P.y[i], found = P.detBy[i] >= 0;
  const head = `<div class="sec"><h4>Simulated person <small>${tier('synthetic')}</small></h4><dl class="kv">${row('Status', found ? `Found ${P.via[i] === 'thermal' ? 'by camera' : 'by phone signal'} via ${esc(o.nodes[P.detBy[i]].id)}` : 'Not found yet')}${row('Priority', 'P' + P.prio[i])}${row('Carries a phone', P.dev[i] ? 'yes' : 'no')}${P.sos[i] ? row('Origin', 'new SOS cluster (stage 10)') : ''}</dl><p class="src">Survivors are synthetic representatives, not real people or locations.</p></div>`;
  const pt = IN.point(app, x, y); return { title: 'Simulated person', html: head + pt.html, x, y, r: 12 };
};
IN.site = function (app, j, ok) {
  const o = app.out, s = ok ? o.sites[j] : o.steps.sites.rejected[j]; let cells = 0; if (ok) for (let c = 0; c < o.B.N; c++) if (o.cc.cov[j * o.B.N + c]) cells++;
  const head = sec(ok ? 'Usable launch site' : 'Ruled-out launch site', `<dl class="kv">${row('Ground', `${esc(C.CLS_NAME[s.cls])}, slope ${Math.round(Math.atan(s.slope) * 57.3)}°, ${f0(s.z0)} m`, 'derived')}${ok ? row('Cells it could watch', `${cells} of ${o.B.N} (camera + ${o.p.rule === 'joint' ? 'radio link' : 'detection only'})`, 'modelled') + row('Chosen', o.nodes.some(n => n.site === j) ? 'yes — ' + o.nodes.filter(n => n.site === j).map(n => n.id).join(', ') : 'no') : row('Reason', esc(s.why), 'modelled')}</dl>`);
  const pt = IN.point(app, s.x, s.y); return { title: ok ? 'Launch site' : 'Ruled-out site', html: head + pt.html, x: s.x, y: s.y, r: 30 };
};

/* ---------- decision support (all values from the current run) ---------- */
IN.gaps = function (app) {
  const o = app.out, B = o.B, vis = app.visibleNodes().filter(i => o.nodes[i].role === 'sense'), v = app.step >= 10 ? o.gp2.est : B.lam, seen = new Uint8Array(B.N);
  vis.forEach(i => { const off = o.nodes[i].site * B.N; for (let c = 0; c < B.N; c++) if (o.cc.cov[off + c]) seen[c] = 1; });
  let tot = 0, un = 0; const cells = []; for (let c = 0; c < B.N; c++) { tot += v[c]; if (!seen[c]) { un += v[c]; if (v[c] > 0.05) cells.push(c); } }
  cells.sort((a, b) => v[b] - v[a]); return { tot, un, share: tot ? un / tot : 0, cells, v, seen, phase: app.step >= 10 ? 'corrected estimate' : 'prior' };
};
IN.decision = function (app) {
  const o = app.out, s = o.steps, op = s.optimise, b = op.base, M = o.M, sc = o.sc, sense = o.nodes.filter(n => n.role === 'sense' && !n.replan).length, relays = s.deploy.relays, added = s.update.added;
  const fullApp = Object.assign({}, app, { step: 11, visibleNodes: () => o.nodes.map((_, i) => i) }), g = IN.gaps(fullApp);
  const why = Object.entries(s.sites.why || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k.toLowerCase())} ${v}`).join(' · ');
  const capBinding = !op.met && op.sol.length >= o.p.Kmax;
  const fewer = [1, 2, 3].map(d => op.full.steps[op.sol.length - 1 - d]).filter(Boolean);
  const worst = o.nodes.reduce((a, n) => (n.loo || 0) > (a ? a.loo || 0 : -1) ? n : a, null);
  const near = c => { let best = null, bd = 1e9; (M.places || []).forEach(p => { const d = Math.hypot(p.x - B.cx(c), p.y - B.cy(c)); if (d < bd) { bd = d; best = p; } }); return best ? `${esc(best.name)} ${bd < 1000 ? f0(bd) + ' m' : f1(bd / 1000) + ' km'}` : ''; }, B = { cx: c => o.B.cx[c], cy: c => o.B.cy[c] };
  const items = [
    ['Placement', `${sense} camera aerostat${sense === 1 ? '' : 's'}${relays ? ` + ${relays} relay${relays === 1 ? '' : 's'}` : ''}${added ? ` + ${added} added at replanning` : ''} reach <b>${pc(op.cov)}</b> weighted coverage against a target of ${pc(o.tEff)} — ${op.met ? '<b class="ok">target met</b>' : `<b class="bad">target not met</b>${capBinding ? ` (fleet limit of ${o.p.Kmax} reached)` : ''}`}. Each one was added because it covered the most still-uncovered expected need at that moment.`],
    ['Constraints', `${f0(s.sites.valid)} of ${f0(s.sites.valid + s.sites.rejected.length)} candidate sites are usable (ruled out: ${why || 'none'}). From usable sites the cameras can reach ${pc(o.reach)} of the weighted need. Rule: ${o.p.rule === 'joint' ? 'a cell counts only if a camera sees it and a phone there could reach the aerostat' : 'camera detection only'}${o.p.k > 1 ? `; worst-hit cells need ${o.p.k} aerostats` : ''}.`],
    ['Underserved', `≈ <b>${f0(g.un)}</b> of ${f0(g.tot)} expected people (${pc(g.share)}, ${g.phase}) are in cells no camera aerostat sees. ${g.cells.length ? 'Largest gaps:' : ''}<div class="gaplist">${g.cells.slice(0, 5).map(c => `<button class="lnk" data-cell="${c}">≈ ${f1(g.v[c])} people · ${near(c)}</button>`).join('')}</div>`],
    ['Fewer aerostats', fewer.length ? `Coverage with ${fewer.map((st, i) => `${op.sol.length - 1 - i}: ${pc(st.cov)}`).join(' · ')} (first aerostats in the greedy order, before replanning).` : 'No smaller fleet to compare.'],
    ['If one fails', worst ? `Losing <button class="lnk" data-node="${o.nodes.indexOf(worst)}">${worst.id}</button> costs the most: −${pc(worst.loo || 0)} coverage. Run the failure drill on any aerostat in Fleet to see the smallest fix.` : '—'],
    ['Alternatives', `To reach ${pc(o.tEff)}: k-means needs ${b.needKmeans ?? '> ' + (b.kmeans.length - 1)}, random placement ${b.needRandom ?? '> ' + (b.random.length - 1)}, a uniform hex grid uses ${b.grid.n} (${pc(b.grid.cov)}); lower bound ≥ ${op.lb}.`],
    ['Uncertainty', `People found, the corrected estimate (${f0(s.update.gp2.estTotal)} ± ${f0(1.64 * s.update.gp2.estSd)}) and sector counts are simulated. In the mountain scenarios the 90% range is narrower than the actual error (see the validation report).`]];
  return `<dl class="dec">${items.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
};

/* ---------- time: event, acquisitions, processing, model run, simulated clock ---------- */
IN.timeline = function (app) {
  const o = app.out, sc = o.sc, P = app.built.M && app.built.M.pack, aoi = P && P.aoi, recs = PK.records(sc.id), rec = l => PK.record(sc.id, l);
  const ev = aoi && aoi.event ? new Date(aoi.event) : null, dd = s => { if (!ev || !s) return ''; const d = Math.round((new Date(s) - ev) / 864e5); return d === 0 ? ' (same day as the event)' : ` (${Math.abs(d)} days ${d > 0 ? 'after' : 'before'} the event)`; };
  const day = s => s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
  const rows = [];
  rows.push(row('Event', `${esc(sc.start)}${aoi && aoi.event_note ? ` <span class="muted small">${esc(aoi.event_note)}</span>` : ''}`, sc.id === 'delhi' ? 'synthetic' : 'reported'));
  const im = [['imagery_s2_pre', 'Optical, before'], ['imagery_s1_pre_vv', 'Radar, before'], ['imagery_s2_post', 'Optical, after'], ['imagery_s1_post_vv', 'Radar, after'], ['hazard_cems', 'CEMS mapping image']];
  im.forEach(([l, t]) => { const r = rec(l); if (r && r.observation_start) rows.push(row(t, `${day(r.observation_start)}${dd(r.observation_start)} · ${esc(r.native_resolution_m ? r.native_resolution_m + ' m' : 'VHR')}`, 'verified')); });
  const hr = rec('hazard_observed'); if (hr) rows.push(row('Hazard map', `derived from images of ${day(hr.observation_start)} and ${day(hr.observation_end)} — not the moment of the event`, 'derived'));
  const ret = recs.map(r => r.retrieved_at).filter(Boolean).sort(); if (ret.length) rows.push(row('Data retrieved', `${day(ret[0])}${ret.length > 1 && day(ret[ret.length - 1]) !== day(ret[0]) ? ' – ' + day(ret[ret.length - 1]) : ''} · pipeline v${esc((PK.manifest && PK.manifest.version) || recs[0].processing_version || '')}`));
  if (app.run && app.run.at) rows.push(row('Model run', `#${app.run.id} at ${app.run.at.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })} · ${o.ms} ms${app.run.cached ? ' (reused, same settings)' : ''}`));
  const up = o.nodes.filter(n => !n.replan).map(n => n.eta).filter(v => v != null); if (up.length) rows.push(row('Simulated clock', `T0 = alert. Last aerostat up at T+${Math.max(...up)} min; replanned aerostats after that`, 'synthetic'));
  return `<dl class="kv">${rows.join('')}</dl><p class="src">Satellite images were taken on the dates shown, not at the time of the event. Before/after comparison is offered only where both dates exist.</p>`;
};
})(window.ARES);
