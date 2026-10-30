/* ARES simulation — app controller (v4): data-pack loading, pipeline stages, viewport tools, analysis panel, analytical band */
(function (A) {
'use strict';
const C = A.core, Mo = A.model, E = A.scene, V = A.vis, CH = A.charts, PN = A.panels, PG = A.pages, DP = A.data, ST = A.pipe.STEPS, PK = A.pack;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const f0 = v => Math.round(v).toLocaleString('en-IN'), f1 = v => (+v).toFixed(1), pc = v => (v * 100).toFixed(1) + '%', pc0 = v => Math.round(v * 100) + '%';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const app = A.app = { page: 'sim', mode: 'natural', scIdx: 0, step: 1, pick: 0, sel: null, sideTab: 'layers', stepTab: 'explain', params: {}, cache: {}, mc: null, hs: null, L: {}, packs: {} };
const DEFAULT_LAYERS = () => ({ imagery: { on: true, a: 1 }, context: { on: true }, terrain: { on: true }, buildings: { on: true }, trees: { on: true }, roads: { on: true }, drainage: { on: true }, labels: { on: true },
  hazGlow: { on: true }, boundary: { on: true }, path: { on: true }, arrows: { on: true }, damage: { on: false, a: 0.45 },
  bars: { on: true }, belief: { on: false, a: 0.6 }, effort: { on: false, a: 0.6 }, unc: { on: false, a: 0.55 }, signal: { on: false, a: 0.55 }, sectors: { on: false, a: 0.32 }, footprint: { on: false, a: 0.3 }, sites: { on: false }, cems: { on: false },
  cones: { on: true }, links: { on: true }, people: { on: true }, truth: { on: false }, routes: { on: true } });
const MODE_NAME = { natural: 'Natural', hazard: 'Hazard intensity', thermal: 'Thermal-style', gray: 'Relief' };
const SHORT = ['Detect', 'Damage', 'Belief', 'Koopman', 'Sites', 'Coverage', 'Placement', 'Deploy', 'Sensing', 'Update', 'Handover'];

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.style.opacity = 1; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.opacity = 0, 2800); }
function copy(text, label) { const done = () => toast(label + ' copied'); const fb = () => { modal('Copy ' + label, `<textarea class="copy" readonly>${text.replace(/</g, '&lt;')}</textarea>`); const ta = $('#mBody textarea'); ta.focus(); ta.select(); }; try { navigator.clipboard.writeText(text).then(done, fb); } catch (e) { fb(); } }
function modal(title, html) { $('#mTitle').textContent = title; $('#mBody').innerHTML = html; $('#modal').hidden = false; }
$('#mClose').onclick = () => $('#modal').hidden = true;
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') $('#modal').hidden = true; });
const fmtDate = s => { if (!s) return '—'; const d = new Date(s); return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };

/* ---------- pages ---------- */
function showPage(p) {
  app.page = p; $$('.page').forEach(s => s.hidden = s.id !== 'pg-' + p); $$('nav.pages [data-page]').forEach(b => { if (b.dataset.page === p) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (p === 'sim') { E.resize(); E.kick(); requestAnimationFrame(drawBand); }
  closeMenu(); renderPage();
}
function renderPage() {
  if (!app.out) return; const p = app.page;
  if (p === 'start') { $('#startBody').innerHTML = PG.start(app); }
  if (p === 'results') { $('#resultsBody').innerHTML = PG.results(app); requestAnimationFrame(drawResults); }
  if (p === 'brief') $('#briefBody').innerHTML = PG.brief(app);
  if (p === 'model') $('#modelBody').innerHTML = PG.model(app);
}
$$('nav.pages [data-page]').forEach(b => b.onclick = () => showPage(b.dataset.page));
$('#startBody').addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (!b) return; const i = +b.dataset.open; showPage('sim'); if (i !== app.scIdx) { sel.value = i; load(i, true); } });

/* ---------- scenario loading: real-data pack first, procedural fallback if the pack cannot be loaded ---------- */
const sel = $('#scnSel'); C.SCENARIOS.forEach((s, i) => sel.add(new Option(s.name, i))); sel.onchange = () => load(+sel.value, true);
async function buildScenario(sc) {
  if (app.cache[sc.id]) return app.cache[sc.id];
  try {
    const P = await PK.load(sc.id); sc.lat = P.aoi.lat; sc.lon = P.aoi.lon; sc.S = P.aoi.S;
    const built = PK.build(sc, P), [post, pre, ctx, postVV, preVV] = await Promise.all([E.loadTex(P.img.post), E.loadTex(P.img.pre), E.loadTex(P.img.ctx), E.loadTex(P.aoi.hazard === 'flood' ? PK.base + sc.id + '/imagery/s1_post_vv.jpg' : null), E.loadTex(P.aoi.hazard === 'flood' ? PK.base + sc.id + '/imagery/s1_pre_vv.jpg' : null)]);
    built.tex = { post, pre, ctx, postVV, preVV }; built.layers = PK.layers; built.real = true; app.cache[sc.id] = built; return built;
  } catch (err) {
    console.warn('Data pack unavailable for', sc.id, '— using the synthetic fallback:', err.message);
    Object.assign(sc, sc.v3); const built = C.buildTerrain(sc); built.tex = {}; built.real = false; built.err = err.message;
    built.layers = { terrain: { name: 'Elevation', tier: 'synthetic', note: 'Procedural terrain shaped to the area (data pack could not be loaded: ' + err.message + ')' }, buildings: { name: 'Buildings', tier: 'synthetic' }, roads: { name: 'Roads', tier: 'synthetic' }, drainage: { name: 'Rivers', tier: 'synthetic' }, hazard: { name: 'Hazard area', tier: 'synthetic' }, people: { name: 'Survivors', tier: 'synthetic' }, population: { name: 'Population', tier: 'assumption', note: 'Houses × assumed occupancy' }, sensors: { name: 'Camera & radio parameters', tier: 'assumption' } };
    app.cache[sc.id] = built; return built;
  }
}
function rebuildWorld() { const sc = C.SCENARIOS[app.scIdx], built = app.cache[sc.id]; E.pickables.length = 0; E.buildWorld(sc, built.T, built.M, built.tex); V.build(app.out); A.hazard.build(app.out); E.setMode(app.mode); }
async function load(i, resetParams) {
  app.scIdx = i; const sc = C.SCENARIOS[i]; $('#loading').hidden = false; $('#loading').innerHTML = `Loading ${esc(sc.name)}<small>real terrain, imagery, buildings and population · then running the 11-stage model</small>`;
  if (resetParams) app.params = { seed: app.params.seed || 7, rule: app.params.rule, k: app.params.k, target: app.params.target };
  app.mc = null; app.hs = null; app.sel = null; app.cross = null; closeFeed(); stopCompare(); stopBA(); closeMenu(); if (E.touring) E.stopTour();
  await new Promise(r => setTimeout(r, 30));
  const built = await buildScenario(sc); app.built = built;
  app.out = A.pipe.run(sc, app.params, built); app.sg = null; rebuildWorld();
  app.dense = app.out.nodes.length > 14; V.minPx = app.dense ? 22 : 30;
  app.L = DEFAULT_LAYERS(); if (app.dense) { app.L.footprint.a = 0.22; } go(app.step, false); $('#loading').hidden = true; themeSync(); renderTop(); renderPage();
  if (!built.real) toast('Real data pack could not be loaded — showing the synthetic fallback');
}
function rerun() {
  const sc = C.SCENARIOS[app.scIdx]; $('#loading').hidden = false; $('#loading').innerHTML = 'Re-running the model…'; closeFeed(); stopCompare();
  setTimeout(() => { app.out = A.pipe.run(sc, app.params, app.cache[sc.id]); app.sg = null; app.mc = null; app.hs = null; rebuildWorld(); go(app.step, false); $('#loading').hidden = true; themeSync(); renderPage(); toast('Model re-run in ' + app.out.ms + ' ms'); }, 30);
}
function renderTop() {
  const o = app.out, sc = o.sc; $('#topPlace').textContent = sc.place; $('#topDate').textContent = sc.start;
  const P = app.built.M.pack, avail = E.imageryAvail();
  let badge;
  if (!app.built.real) badge = `<span class="tier synthetic">synthetic</span><b>Procedural terrain</b> · data pack not loaded`;
  else { const rec = PK.record(sc.id, E.imagery === 'pre' ? (avail.preRadar ? 'imagery_s1_pre_vv' : 'imagery_s2_pre') : (avail.postRadar ? 'imagery_s1_post_vv' : (P.img.post ? 'imagery_s2_post' : 'imagery_s2_pre')));
    const radar = E.imagery === 'pre' ? avail.preRadar : avail.postRadar;
    badge = E.imagery === 'off' ? `<span class="tier verified">real</span><b>Copernicus DEM</b> · land-cover shading (imagery off)` : `<span class="tier verified">real</span><b>${radar ? 'Sentinel-1 radar' : 'Sentinel-2'} · ${fmtDate(rec && rec.observation_start)}</b> · ${E.imagery === 'pre' ? 'pre-event' : sc.id === 'delhi' ? 'recent (no event)' : radar ? 'during flood' : 'post-event'} · Copernicus DEM ×${o.T.vex} vertical`; }
  $('#srcBadge').innerHTML = badge;
}

/* ---------- pipeline stages ---------- */
app.visibleNodes = () => { const o = app.out, n = app.step, out = []; o.nodes.forEach((nd, i) => { if (n >= 10) out.push(i); else if (n >= 8 && !nd.replan) out.push(i); else if (n === 7 && nd.role === 'sense' && !nd.replan && i < app.pick) out.push(i); }); return out; };
function stepDefaults(n) {
  const L = app.L; L.damage.on = false; L.boundary.on = n >= 2; L.path.on = n >= 2 && n <= 6; L.arrows.on = n === 2; L.hazGlow.on = n >= 2; L.bars.on = [3, 4, 7, 10].includes(n); L.belief.on = false; L.effort.on = n === 4; L.unc.on = n === 10; L.sectors.on = n === 11; L.sites.on = n === 5 || n === 6; L.cones.on = n >= 6; L.links.on = n === 8; L.people.on = n >= 9; L.routes.on = n >= 11; L.signal.on = false; L.truth.on = false; L.footprint.on = n === 9; L.cems.on = n === 2 || n === 3;
}
function go(n, animate = true) {
  n = C.clamp(n, 1, 11); const prev = app.step; app.step = n; app.pick = n === 7 && animate ? 0 : app.out.steps.optimise.sol.length;
  stepDefaults(n); applyVisuals(animate, prev); renderStage(); renderSide();
  if (animate && n === 7) setTimeout(() => playPicks(), 600);
}
function applyVisuals(animate, prev) {
  const o = app.out, n = app.step, L = app.L, g = V.g;
  g.alert.visible = n === 1; g.damage.visible = n === 2 && L.damage.on; g.cand.visible = n === 6 && L.cones.on; g.pins.visible = L.sites.on; g.sos.visible = n === 10; g.kmeans.visible = false; g.hl.visible = false;
  if (n === 1 && animate && !E.touring) E.flyTo(o.M.incident[0], o.M.incident[1], 0.5);
  if (n === 2) { if (animate) E.tween(1600, k => V.setDamage(E.ease(k))); else V.setDamage(1); }
  g.bars.visible = L.bars.on && [3, 4, 7, 10].includes(n) && app.mode !== 'thermal';
  if (n <= 3) V.setBars(o.B.lam, 'belief');
  if (n === 4) V.setBars(o.steps.koopman.phi, 'effort');
  if (n === 7) barsResidual();
  if (n === 10) V.setBars(o.gp2.est, 'belief', Math.max(...o.B.lam));
  const vis = app.visibleNodes();
  o.nodes.forEach((nd, i) => { const on = vis.includes(i); if (!on) V.nodeState(i, 'hidden'); else if (n === 7) V.nodeState(i, 'planned'); else { const wasUp = V.nodeObjs[i].body.visible; if (!wasUp && animate) V.raise(i, (nd.replan ? 600 : 0) + vis.indexOf(i) * (nd.replan ? 350 : 140)); else V.nodeState(i, 'up'); } const nb = V.nodeObjs[i]; if (nd.role !== 'relay') { nb.cone.visible = L.cones.on && !app.dense; nb.ring.visible = L.cones.on; } nb.lbl.visible = on && (vis.length <= 12 || i === app.sel); });
  g.nodes.visible = true; g.links.visible = L.links.on && n >= 8; if (n >= 8) V.setLinks(vis, animate && (n === 8 || n === 10));
  g.people.visible = L.people.on || L.truth.on;
  if (L.truth.on) V.showPeople('truth', false); else if (L.people.on && n >= 9) { if (n === 9) firstWave(animate); else V.showPeople('detected', animate && n === 10 && prev !== 10); } else V.showPeople('none', false);
  g.routes.visible = L.routes.on && n >= 11; if (n === 11 && animate) V.animateRoutes();
  E.removeLabels('sector'); if (n === 11 && L.sectors.on) (o.sectors || []).filter(r => r.pri === 1).forEach(r => E.addLabel(`<b>${r.id === 'Unobserved' ? 'Unobserved area' : 'Sector ' + r.id}</b>${f0(r.est)} people expected · <span style="color:#c4362c;font-weight:600">search first</span>`, r.cx, r.cy, 70, 'sector', { group: 'sector' }));
  displayLayers(); paintOverlay(); renderLegend(); updateScalar(); drawBand();
  if (n === 11 && animate && !E.touring) E.goHome();
}
function displayLayers() {
  const L = app.L, H = A.hazard, n = app.step, W = E.world, u = E.terrainMat.uniforms;
  if (W.bldg) W.bldg.visible = L.buildings.on; E.treesWanted = L.trees.on; if (W.trees) W.trees.visible = L.trees.on && !E.mode2d && app.mode !== 'thermal';
  u.hasSat.value = L.imagery.on && E.imagery !== 'off' && (E.imageryAvail().post || E.imageryAvail().pre) ? 1 : 0; u.hasCtx.value = L.imagery.on && E.tex && E.tex.ctx ? 1 : 0;
  if (H.root) { H.setVisible('boundary', L.boundary.on); H.setVisible('path', L.path.on); H.setVisible('arrows', L.arrows.on); H.setVisible('drainage', L.drainage.on); H.setVisible('roads', L.roads.on); H.setVisible('rings', L.boundary.on); H.setVisible('glowg', (n <= 2 || L.hazGlow.on) && n >= 1); H.setVisible('cems', L.cems.on);
    W.labels.forEach(l => { if (l.group === 'hazmarks') l.visible = L.path.on || (L.boundary.on && (app.out.sc.id === 'delhi' || app.out.M.flood)); if (l.group === 'cems') l.visible = L.cems.on; if (l.kind === 'town' || l.kind === 'water' || l.kind === 'peak') l.visible = n <= 7 || n === 11; });
    u.hazOn.value = L.hazGlow.on ? 1 : 0; u.ctxOn.value = L.context.on ? 1 : 0; if (W.context) W.context.visible = L.context.on && !E.mode2d; }
  const g = V.g; g.pins.visible = L.sites.on; g.links.visible = L.links.on && n >= 8; g.routes.visible = L.routes.on && n >= 11; g.cand.visible = n === 6 && L.cones.on; g.bars.visible = L.bars.on && [3, 4, 7, 10].includes(n) && app.mode !== 'thermal';
  E.terrainMat.uniforms.ovOn.value = app.mode === 'thermal' ? 0 : 1;
  V.nodeObjs.forEach(nb => { if (nb.n.role !== 'relay') { nb.cone.visible = L.cones.on && !app.dense; nb.ring.visible = L.cones.on; } });
  document.body.classList.toggle('hide-labels', !L.labels.on); E.labelsDirty();
}
function firstWave(animate) { const P = app.out.P, o = app.out, save = P.detBy.slice(); for (let i = 0; i < P.n; i++) if (P.detBy[i] >= 0 && (o.nodes[P.detBy[i]].replan || P.sos[i])) P.detBy[i] = -1; V.showPeople('detected', animate); P.detBy.set(save); }
function barsResidual() { const o = app.out, B = o.B, dim = new Uint8Array(B.N); o.steps.optimise.sol.slice(0, app.pick).forEach(s => { for (let c = 0; c < B.N; c++) if (o.cc.cov[s.site * B.N + c]) dim[c] = 1; }); V.setBars(B.lam, 'belief', 0, dim); }
function playPicks() { if (app.step !== 7) return; const n = app.out.steps.optimise.sol.length; if (app.pick >= n) return; app.pick++; applyVisuals(false); renderStage(); clearTimeout(playPicks.h); playPicks.h = setTimeout(playPicks, Math.max(300, 3000 / n)); }
function footprintLayer(a) { // cells each visible camera aerostat can actually see (line of sight + detection threshold): holes = terrain occlusion
  const o = app.out, B = o.B, vis = app.visibleNodes().filter(i => o.nodes[i].role === 'sense');
  return { alpha: a, draw: (g, W, S) => { const cnt = new Uint8Array(B.N); vis.forEach(i => { const off = o.nodes[i].site * B.N; for (let c = 0; c < B.N; c++) if (o.cc.cov[off + c]) cnt[c]++; }); for (let c = 0; c < B.N; c++) { if (!cnt[c]) continue; g.fillStyle = cnt[c] >= 2 ? '#ff9a5a' : '#ffd08a'; E.cellRect(g, W, S, B.cx[c], B.cy[c], B.cs * 0.96); } } };
}
function paintOverlay() {
  const o = app.out, L = app.L, ov = V.overlay, n = app.step, layers = [];
  if (L.damage.on && n >= 2) layers.push(ov.damage(L.damage.a));
  if (L.belief.on) layers.push(ov.cells(n >= 10 ? o.gp2.est : o.B.lam, 'belief', L.belief.a));
  if (L.effort.on && n >= 4 && !L.bars.on) layers.push(ov.cells(o.steps.koopman.phi, 'effort', L.effort.a));
  if (L.unc.on && n >= 10) layers.push(ov.cells(o.gp2.gp.vari.map((v, c) => o.gp2.observed[c] ? v * 0.3 : v), 'unc', L.unc.a));
  if (L.footprint.on && n >= 7) layers.push(footprintLayer(L.footprint.a));
  if (L.signal.on && n >= 8) { const vis = app.visibleNodes(), key = vis.join(','); if (!app.sg || app.sgKey !== key) { app.sg = A.pipe.signalGrid(o, vis, 71); app.sgKey = key; } layers.push(ov.signal(app.sg, L.signal.a)); }
  if (L.sectors.on && n >= 11) layers.push(ov.sectors(L.sectors.a));
  E.paintOverlay(layers);
}
function updateScalar() {
  const o = app.out, B = o.B; if (app.mode === 'hazard') app.scMax = E.setScalar(B.sev, B.CB, 1);
  else if (app.mode === 'thermal') { const v = app.step >= 10 ? o.gp2.est : B.lam, ha = B.cs * B.cs / 1e4; app.scMax = E.setScalar(Array.from(v, x => x / ha), B.CB); }
}
function setMode(m) { app.mode = m; E.setMode(m); updateScalar(); displayLayers(); renderLegend(); if (app.sideTab === 'layers') renderSide(); }

/* ---------- legend (data-driven; explains colours with units and ranges) ---------- */
function renderLegend() {
  const n = app.step, L = app.L, o = app.out, it = [], li = (c, t, sq) => `<span><i class="${sq ? 'sq' : ''}" style="background:${c}"></i>${t}</span>`, ramp = (g, t, a, b) => `<span class="rampbox"><span style="display:flex;gap:7px;align-items:center"><span class="ramp" style="background:linear-gradient(90deg,${g})"></span>${t}</span><span class="ends"><span>${a}</span><span>${b}</span></span></span>`;
  if (app.mode === 'hazard') it.push(ramp('#fff3b3,#fdb34d,#e34a21,#800026', 'Damage severity (stage-2 model)', '0', '1'));
  if (app.mode === 'thermal') it.push(ramp('#08021a,#330a66,#78107f,#bf2e6b,#f06628,#fdb31f,#fff8c6', (n >= 10 ? 'GP-corrected' : 'Prior') + ' people per hectare (√ scale)', '0', f1(app.scMax || 0) + (E.gridded ? ' · 150 m cells' : ' · smoothed')));
  if (app.mode === 'gray') it.push(li('#888', 'Hillshade + contours (' + E.terrainMat.uniforms.ci.value + ' m)', 1));
  if (n === 1) it.push(li('#c4362c', 'Reported location'), li('#2f86ff', 'First calls for help (simulated)'));
  if (n >= 2 && L.hazGlow.on) it.push(o.M.flood ? li('#3f7f9f', 'Inundation observed by Sentinel-1 (derived)', 1) : o.sc.id === 'delhi' ? li('#e0561f', 'Collapse zone (hypothetical model)', 1) : li('#e0561f', o.M.cems ? 'Scour / debris: CEMS in mapped area, Sentinel-2 elsewhere' : 'Scour / debris observed by Sentinel-2 (derived)', 1));
  if (L.cems.on && o.M.cems) it.push(li('#b3261e', 'Destroyed (CEMS)', 1), li('#f08a24', 'Damaged (CEMS)', 1), li('#f6d23b', 'Possibly damaged (CEMS)', 1), li('#f4f7fb', 'CEMS mapped area (dashed)', 1));
  if (n >= 2 && L.path.on && A.hazard.path) it.push(li('#f6c33b', 'Path of steepest descent (DEM)', 1));
  if (L.bars.on && [3, 7, 10].includes(n)) it.push(ramp('#fff3c4,#f08a3c,#8f1f1a', 'Expected people per cell (bar height)', 'few', 'many'));
  if (L.bars.on && n === 4) it.push(ramp('#d6f0e0,#3fa58a,#16365a', 'Koopman search effort', 'low', 'high'));
  if (L.sites.on) it.push(li('#2f8a55', 'Usable launch site'), li('#c4362c', 'Ruled out'));
  if (n >= 7) it.push(li('#e0561f', 'Camera aerostat (symbol enlarged)') + (o.nodes.some(x => x.role === 'relay') ? li('#2b6cb0', 'Relay aerostat') : '') + (n >= 10 && o.nodes.some(x => x.replan) ? li('#6f4bd1', 'Added at replanning') : ''));
  if (L.footprint.on && n >= 7) it.push(li('#ffd08a', 'Visible cells (1 aerostat)', 1), li('#ff9a5a', 'Visible to ≥2', 1));
  if (n >= 8 && L.links.on) it.push(li('#1f6fd1', `Link ≥ ${o.p.fade + 10} dB margin`, 1), li('#5fa8ff', `Link ${o.p.fade}–${o.p.fade + 10} dB`, 1), li('#7fd0ff', 'Relay hop (dashed)', 1));
  if (n >= 9 && L.people.on) it.push(li('#ff7a2f', 'Found by camera (simulated)'), li('#2f86ff', 'Found by phone (simulated)'));
  if (L.truth.on) it.push(li('#9a9a92', 'Not yet found (simulation only)'));
  if (n === 10 && L.unc.on && app.mode !== 'thermal') it.push(ramp('#e8e4f4,#7f63c4,#2a1060', 'GP uncertainty', 'low', 'high'));
  if (L.signal.on && n >= 8) it.push(ramp('#3b1f4a,#c6493a,#f2d24b,#fbf3b0', 'Uplink margin (866 MHz)', '−10 dB', '+50 dB'));
  if (n >= 11 && L.routes.on) it.push(li('#f6c33b', 'Route on foot (A* on terrain cost)', 1), li('#5fb4ff', 'Route needing a boat', 1));
  const open = app.legendOpen !== false;
  $('#legend').innerHTML = `<div class="lh"><span>Legend · stage ${n}</span><button id="lgT">${open ? 'Hide' : 'Show'}</button></div>` + (open ? it.join('') : '');
  $('#lgT').onclick = () => { app.legendOpen = !open; renderLegend(); };
}

/* ---------- bottom band: timeline, events, charts ---------- */
function renderStage() {
  const n = app.step, s = ST[n - 1], o = app.out;
  const pos = k => `calc(10px + (100% - 20px) * ${(k - 1) / 10})`;
  $('#track').innerHTML = `<div class="rail"></div><div class="fill" style="width:calc((100% - 20px) * ${(n - 1) / 10})"></div>` + ST.map(x => `<button class="tick ${x.n < n ? 'done' : ''} ${x.n === n ? 'cur' : ''}" data-step="${x.n}" style="left:${pos(x.n)}" title="${x.n} · ${esc(x.t)}"><i></i><span>${x.n} ${SHORT[x.n - 1]}</span></button>`).join('') + `<div class="bubble" style="left:${pos(n)}">Stage ${n} · ${esc(s.t)}</div>`;
  $('#prev').disabled = n === 1; $('#next').disabled = n === 11;
  $('#tlMeta').textContent = `${o.sc.code} · ${o.T.real ? 'real terrain' : 'synthetic terrain'} · run ${o.ms} ms`;
  const cap = $('#stageCap'); cap.hidden = false; cap.innerHTML = `<b>${n}/11</b> ${esc(PG.SIMPLE[n - 1].s)}`;
  // pipeline events
  const ev = events(); $('#evN').textContent = ev.filter(e => e.n <= n).length;
  $('#evList').innerHTML = ev.map(e => `<div class="ev ${e.n === n ? 'cur' : ''} ${e.n > n ? 'fut' : ''}" data-step="${e.n}"><i style="background:${e.c}"></i><span>${esc(e.t)}</span><em>${esc(e.v)}</em></div>`).join('');
}
function events() {
  const o = app.out, s = o.steps, u = s.update, ev = [];
  ev.push({ n: 1, c: '#c4362c', t: 'Incident opened', v: o.sc.id === 'delhi' ? 'hypothetical' : (o.sc.start.split(',')[0]) });
  ev.push({ n: 2, c: '#e0561f', t: o.M.flood ? 'Inundation mapped' : o.sc.id === 'delhi' ? 'Collapse zone modelled' : 'Scour mapped', v: f1(s.evaluate.dmgKm2) + ' km²' });
  ev.push({ n: 3, c: '#f08a3c', t: 'People expected', v: f0(s.belief.lamTot) });
  ev.push({ n: 4, c: '#3fa58a', t: 'Detect prob. (ideal)', v: pc0(s.koopman.pDetect) });
  ev.push({ n: 5, c: '#2f8a55', t: 'Usable launch sites', v: String(s.sites.valid) });
  ev.push({ n: 6, c: '#9c8f7c', t: 'Reachable demand', v: pc0(o.reach) });
  ev.push({ n: 7, c: '#d9452b', t: 'Aerostats chosen', v: s.optimise.sol.length + (s.optimise.met ? '' : ' (target missed)') });
  ev.push({ n: 8, c: '#2563c4', t: 'Linked to command post', v: s.deploy.con.ok.filter(Boolean).length + '/' + o.nodes.length });
  ev.push({ n: 9, c: '#ff7a2f', t: 'People located (sim)', v: f0(u.gp1.confirmed) });
  ev.push({ n: 10, c: '#6f4bd1', t: 'Estimate · new SOS', v: f0(u.gp2.estTotal) + ' · +' + u.added });
  ev.push({ n: 11, c: '#f6c33b', t: 'Sectors handed over', v: String(s.handover.sectors) });
  return ev;
}
$('#track').addEventListener('click', e => { const b = e.target.closest('[data-step]'); if (b) go(+b.dataset.step); });
$('#evList').addEventListener('click', e => { const b = e.target.closest('[data-step]'); if (b) go(+b.dataset.step); });
$('#prev').onclick = () => go(app.step - 1); $('#next').onclick = () => go(app.step + 1);
$('#auto').onclick = () => { const b = $('#auto'); if (app.auto) { clearInterval(app.auto); app.auto = null; b.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8Z"/></svg>'; b.setAttribute('aria-label', 'Play all stages'); return; } b.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>'; b.setAttribute('aria-label', 'Pause'); if (app.step === 11) go(1); app.auto = setInterval(() => { if (app.step >= 11) { $('#auto').click(); return; } go(app.step + 1); }, 6000); };
$('#bandToggle').onclick = () => { const s = $('#pg-sim'), min = !s.classList.contains('band-min'); s.classList.toggle('band-min', min); $('#bandToggle').textContent = min ? 'Expand ▴' : 'Collapse ▾'; $('#bandToggle').setAttribute('aria-expanded', !min); setTimeout(() => { E.resize(); drawBand(); }, 30); };
function drawBand() {
  if (!app.out || app.page !== 'sim' || $('#pg-sim').classList.contains('band-min')) return; CH.readTokens(); const o = app.out, n = app.step;
  const r1 = CH.stagePeople($('#ch1'), o, n); $('#ch1s').textContent = n < 3 ? 'expected from stage 3' : n < 9 ? `expected ${f0(r1.expected)}` : n < 10 ? `located ${f0(r1.located)} of ${f0(r1.truth)} (sim)` : `est. ${f0(r1.est)} ± ${f0(r1.sd)} · truth ${f0(r1.truth)}`;
  if (n >= 6) { const r2 = CH.coverageBand($('#ch2'), o, n === 7 ? app.pick : null); $('#ch2s').textContent = `ARES ${o.steps.optimise.sol.length} · k-means ${o.steps.optimise.base.needKmeans ?? '>' + (o.steps.optimise.base.kmeans.length - 1)}`; }
  else { CH.emptyState($('#ch2'), 'Available after the coverage model (stage 6)'); $('#ch2s').textContent = ''; }
  // profile: LOS to selected aerostat when one is up; otherwise along the hazard path; otherwise ICP → incident
  const T = o.T, M = o.M, H = A.hazard;
  if (app.sel != null && n >= 8 && V.nodeObjs[app.sel] && V.nodeObjs[app.sel].body.visible) {
    const nd = o.nodes[app.sel], s = o.sites[nd.site], a = [M.icp[0], M.icp[1]], b = [s.x, s.y], az = C.elevAt(T, a[0], a[1]) + 12, bz = s.z0 + o.p.h; let blocked = false; for (let i = 1; i < 60; i++) { const t = i / 60, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t; if (C.surfAt(T, x, y) > az + (bz - az) * t) { blocked = true; break; } }
    const r = CH.profileLine($('#ch3'), o, [a, b], { los: [az, bz], blocked, extra: [az, bz] }); $('#ch3t').textContent = 'Line of sight · ICP → ' + nd.id; $('#ch3s').textContent = `${r.km.toFixed(2)} km · ${blocked ? 'blocked → relay' : 'clear'}`;
  } else if (H.path) { const r = CH.profileLine($('#ch3'), o, H.path.pts, { flag: (x, y) => M.hazMask && M.hazMask[C.idxAt(T, x, y)] }); $('#ch3t').textContent = 'Elevation profile · descent path'; $('#ch3s').textContent = `${r.km.toFixed(1)} km · ${f0(r.hi)}→${f0(r.lo)} m`; }
  else { const a = M.icp, b = M.incident, r = CH.profileLine($('#ch3'), o, [a, b], { flag: (x, y) => M.hazMask && M.hazMask[C.idxAt(T, x, y)] }); $('#ch3t').textContent = 'Elevation profile · ICP → incident'; $('#ch3s').textContent = r ? `${r.km.toFixed(1)} km · ${f1(r.lo)}–${f1(r.hi)} m` : ''; }
}
new ResizeObserver(() => { clearTimeout(drawBand.h); drawBand.h = setTimeout(drawBand, 80); }).observe($('#band'));

/* ---------- right analysis panel ---------- */
const TABS = [['layers', 'Layers'], ['step', 'Stage'], ['fleet', 'Fleet'], ['sources', 'Sources']];
function renderSide() {
  if (!app.out) { $('#sTabs').innerHTML = ''; $('#sBody').innerHTML = '<div class="sec"><p class="muted">Loading scenario…</p></div>'; return; }
  $('#sTabs').innerHTML = TABS.map(([k, t]) => `<button role="tab" data-st="${k}" aria-selected="${k === app.sideTab}">${t}${k === 'fleet' && app.step >= 7 ? ` <span class="mono" style="color:var(--muted);font-weight:500">${app.visibleNodes().length}</span>` : ''}</button>`).join('');
  const b = $('#sBody'), y = b.scrollTop;
  b.innerHTML = app.sideTab === 'layers' ? sideLayers() : app.sideTab === 'step' ? sideStep() : app.sideTab === 'fleet' ? sideFleet() : sideSources();
  if (app.sideTab === app.lastSideTab) b.scrollTop = y; app.lastSideTab = app.sideTab;
}
$('#sTabs').addEventListener('click', e => { const t = e.target.closest('[data-st]'); if (t) { app.sideTab = t.dataset.st; renderSide(); } });
const TH = { imagery: () => app.built.M.pack ? `url(${app.built.M.pack.img.post || app.built.M.pack.img.pre})` : 'linear-gradient(135deg,#9fae66,#6b5a44)', terrain: () => 'linear-gradient(135deg,#d6c7a6 0%,#8d7b5c 45%,#4c5a37 100%)', context: () => 'linear-gradient(180deg,#c9d3dc,#a69a82)', buildings: () => 'repeating-linear-gradient(90deg,#c8bfae 0 5px,#a59a87 5px 7px)', trees: () => 'radial-gradient(circle at 30% 40%,#3a5a2e 25%,transparent 27%),radial-gradient(circle at 70% 60%,#2c4523 25%,transparent 27%),#6e7a52', roads: () => 'linear-gradient(160deg,transparent 42%,#f3eee4 42% 58%,transparent 58%),#6b6a66', drainage: () => 'linear-gradient(160deg,transparent 40%,#2f6fae 40% 60%,transparent 60%),#cfd6c4', labels: () => 'linear-gradient(#222,#222) center/60% 3px no-repeat,#e4e0d6',
  hazGlow: () => app.out.M.flood ? 'radial-gradient(#3f7f9f 45%,#bfe6ff 60%,#cfd6c4 75%)' : 'radial-gradient(#5a3a30 40%,#f05a24 58%,#e9d9b8 75%)', boundary: () => 'repeating-linear-gradient(90deg,#fff 0 5px,transparent 5px 8px) center/100% 2px no-repeat,#6b5a4a', path: () => 'repeating-linear-gradient(90deg,#f6c33b 0 6px,transparent 6px 9px) center/100% 3px no-repeat,#5c5348', arrows: () => 'linear-gradient(135deg,transparent 42%,#f05a24 42% 58%,transparent 58%),#d8cfbd', damage: () => '#d9531e',
  bars: () => 'linear-gradient(90deg,#fff3c4,#d9531e,#8f1f1a)', belief: () => 'linear-gradient(90deg,#fff3c4,#f08a3c,#8f1f1a)', effort: () => 'linear-gradient(90deg,#d6f0e0,#3fa58a,#16365a)', unc: () => 'linear-gradient(90deg,#e8e4f4,#7f63c4,#2a1060)', signal: () => 'linear-gradient(90deg,#3b1f4a,#e88a2a,#fbf3b0)', sectors: () => 'conic-gradient(#d9531e 0 25%,#2b6cb0 0 50%,#2f8a55 0 75%,#b8860b 0)', footprint: () => 'repeating-linear-gradient(45deg,#ffd08a 0 4px,#ff9a5a 4px 8px)', cems: () => 'radial-gradient(#b3261e 28%,transparent 32%) 2px 2px/9px 9px,radial-gradient(#f08a24 28%,transparent 32%) 6px 6px/9px 9px,#5c6a58', sites: () => 'radial-gradient(#2f8a55 30%,transparent 34%),radial-gradient(#c4362c 30%,transparent 34%) 6px 4px/12px 12px,#e4e0d6',
  cones: () => 'linear-gradient(180deg,transparent,#e0561f88)', links: () => 'linear-gradient(135deg,transparent 45%,#1f6fd1 45% 55%,transparent 55%),#e4e0d6', people: () => 'radial-gradient(#ff7a2f 30%,transparent 34%),radial-gradient(#2f86ff 30%,transparent 34%) 7px 5px/14px 14px,#e4e0d6', truth: () => 'radial-gradient(#9a9a92 35%,transparent 40%),#e4e0d6', routes: () => 'linear-gradient(135deg,transparent 40%,#f6c33b 40% 60%,transparent 60%),#5c5348' };
function provOf(k) { const Lr = app.built.layers || {}; const map = { imagery: 'imagery', terrain: 'terrain', context: 'context', buildings: 'buildings', roads: 'roads', drainage: 'drainage', hazGlow: 'hazard', boundary: 'hazard', damage: 'hazard', trees: 'landcover', people: 'people', truth: 'people', bars: 'population', belief: 'population', cems: 'cems' }; const m = Lr[map[k]]; if (m) return m.tier; return { path: 'derived', arrows: 'derived', labels: 'verified', effort: 'modelled', unc: 'modelled', signal: 'modelled', sectors: 'modelled', footprint: 'modelled', sites: 'modelled', cones: 'assumption', links: 'modelled', routes: 'modelled' }[k] || 'modelled'; }
const TIER_WORD = { verified: 'real', derived: 'derived', modelled: 'model', assumption: 'assumed', synthetic: 'synthetic' };
function sideLayers() {
  const o = app.out, sc = o.sc, L = app.L, M = o.M, av = E.imageryAvail();
  const groups = [['Base data', [['imagery', 'Satellite imagery', 0], ['terrain', 'Terrain (3D)', 0, 1], ['context', 'Surroundings (outside model area)'], ['buildings', 'Buildings'], ['trees', 'Tree cover'], ['roads', 'Roads & tracks'], ['drainage', 'Rivers & streams'], ['labels', 'Place labels']]],
    ['Hazard', [['hazGlow', o.M.flood ? 'Inundation (observed)' : sc.id === 'delhi' ? 'Collapse zone (hypothetical)' : 'Scour & debris (observed)'], ['boundary', 'Hazard boundary'], ['path', 'Descent path & markers', 0, 0, !A.hazard.path], ['arrows', 'Downslope direction', 0, 0, !A.hazard.path], ['damage', 'Damage cells', 1], ...(o.M.cems ? [['cems', `Copernicus EMS ${o.M.cems.meta.code} grading`]] : [])]],
    ['Model outputs', [['bars', 'Belief State (3D bars)'], ['belief', 'People density', 1], ['effort', 'Search effort (Koopman)', 1], ['footprint', 'Camera visible cells', 1, 0, app.step < 7], ['unc', 'Uncertainty (GP)', 1, 0, app.step < 10], ['signal', 'Uplink signal 866 MHz', 1, 0, app.step < 8], ['sectors', 'Rescue sectors', 1, 0, app.step < 11], ['sites', 'Launch sites']]],
    ['Field assets', [['cones', 'Camera coverage cones', 0, 0, app.step < 6], ['links', 'Radio links', 0, 0, app.step < 8], ['people', 'People located (sim)', 0, 0, app.step < 9], ['truth', 'Ground truth (sim only)'], ['routes', 'Rescue routes', 0, 0, app.step < 11]]]];
  const row = ([k, t, alpha, fixed, dis]) => { const st = L[k] || { on: true }, tier = provOf(k); return `<div class="lyr ${st.on ? '' : 'off'} ${dis ? 'dis' : ''}"><input type="checkbox" data-layer="${k}" ${st.on ? 'checked' : ''} ${fixed ? 'disabled' : ''} aria-label="${esc(t)}"><span class="th" style="background:${TH[k] ? TH[k]() : '#ccc'};background-size:cover"></span><span class="nm"><span>${esc(t)}</span><small><span class="tier ${tier}">${TIER_WORD[tier]}</span></small></span>${alpha ? `<input type="range" min="0" max="100" value="${Math.round((st.a ?? 1) * 100)}" data-alpha="${k}" aria-label="${esc(t)} opacity"><span class="pct">${Math.round((st.a ?? 1) * 100)}%</span>` : '<span></span><span></span>'}</div>`; };
  const modes = [['natural', 'Natural', 'linear-gradient(135deg,#c9b48a,#5b6b3b)'], ['hazard', 'Hazard', 'linear-gradient(90deg,#eee,#fdb34d,#e34a21,#800026)'], ['thermal', 'Thermal', 'linear-gradient(90deg,#08021a,#78107f,#f06628,#fff8c6)'], ['gray', 'Relief', 'linear-gradient(135deg,#f2f2f2,#5a5a5a)']];
  const s = o.steps, pop = M.pop;
  return `<div class="sec"><h4>View mode <small>${MODE_NAME[app.mode]}</small></h4><div class="modes4">${modes.map(([k, t, gr]) => `<button data-mode="${k}" aria-pressed="${app.mode === k}"><i style="background:${gr}"></i>${t}</button>`).join('')}</div>
    <div class="imgsel" role="group" aria-label="Imagery date"><button data-img="post" aria-pressed="${E.imagery === 'post'}" ${av.post ? '' : 'disabled'}>${av.postRadar ? 'Radar (flood)' : sc.id === 'delhi' ? 'Recent' : 'Post-event'}</button><button data-img="pre" aria-pressed="${E.imagery === 'pre'}" ${av.pre ? '' : 'disabled'}>Pre-event</button><button data-img="off" aria-pressed="${E.imagery === 'off'}">Land cover</button></div>
    ${app.mode === 'thermal' ? `<label class="switch" style="margin-top:8px"><input type="checkbox" id="gridT" ${E.gridded ? 'checked' : ''}>Show the 40×40 belief grid (no smoothing)</label>` : ''}</div>
  <div class="sec"><h4>Layers <small>${app.built.real ? 'real data loaded' : '<span class="bad">synthetic fallback</span>'}</small></h4>${groups.map(([g, rows]) => `<div class="lgrp">${g}</div>${rows.map(row).join('')}`).join('')}</div>
  <div class="sec"><h4>Incident overview <small class="mono">${esc(sc.code)}</small></h4><dl class="kv"><dt>Incident</dt><dd>${esc(sc.name)}</dd><dt>Location</dt><dd>${esc(sc.place)}</dd><dt>Model area</dt><dd class="mono">${(o.T.S / 1000).toFixed(1)} × ${(o.T.S / 1000).toFixed(1)} km · ${sc.lat.toFixed(3)}°N ${sc.lon.toFixed(3)}°E</dd><dt>Start</dt><dd data-real>${esc(sc.start)}</dd><dt>Type</dt><dd>${esc(sc.type)}</dd>${sc.reported.slice(0, 4).map(r => `<dt>${esc(r[0])}</dt><dd data-real>${esc(r[1])}${r[3] ? ` <span class="muted small">(${esc(r[3])})</span>` : ''}</dd>`).join('')}<dt>Status</dt><dd>Stage ${app.step}/11 · ${esc(ST[app.step - 1].t)}</dd></dl></div>
  <div class="sec"><h4>Population &amp; need <small>three different quantities</small></h4><div class="met"><div><span class="k">Resident</span><span class="v">${pop ? f0(pop.resident) : '—'}</span><span class="s">WorldPop 2020 · modelled</span></div><div><span class="k">Exposed</span><span class="v">${s.belief.exposed != null && pop ? f0(s.belief.exposed) : '—'}</span><span class="s">in/next to hazard</span></div><div><span class="k">Need help</span><span class="v" data-sim>${f0(sc.people)}</span><span class="s">scenario assumption</span></div></div><p class="src" style="margin:8px 0 0">Survivors in the simulation are synthetic representatives (${f0(o.P.n)}), sampled from buildings and hazard geometry and scaled to the "need help" figure — not real people or locations.</p></div>
  <div class="sec"><h4>Conditions <small>scenario assumptions</small></h4><div class="met"><div><span class="k">Wind</span><span class="v" data-sim>${sc.cond.wind}</span><span class="s">km/h → drift ${o.p.drift} m</span></div><div><span class="k">Hover height</span><span class="v">${o.p.h}</span><span class="s">m above ground</span></div><div><span class="k">Camera FOV</span><span class="v">${o.p.fov}°</span><span class="s">assumed</span></div></div><p class="src" style="margin:8px 0 0">${esc(sc.cond.rain)} · ${esc(sc.cond.water)}. ${esc(E.sunInfo || '')}.</p></div>`;
}
function sideStep() {
  const n = app.step, tabs = [['explain', 'What happens'], ['data', 'The data'], ['numbers', 'Numbers']];
  const body = app.stepTab === 'explain' ? PG.explain(n, app) : app.stepTab === 'data' ? DP.build(n, app.out, app) : PG.tiles(PG.numbers(n, app)) + `<p class="src" style="margin:10px 0 0">Numbers marked as simulated come from the simulation, not from real reports.</p>`;
  return `<div class="sec"><h4>Stage ${n} of 11 <small>${esc(ST[n - 1].t)}</small></h4><div class="subtabs" role="tablist">${tabs.map(([k, t]) => `<button data-sub="${k}" aria-selected="${k === app.stepTab}">${t}</button>`).join('')}</div><div id="stepBody">${body}</div></div>`;
}
function sideFleet() {
  const o = app.out, vis = app.visibleNodes(); if (app.step < 7) return `<div class="sec"><h4>Aerostat fleet</h4><p class="muted">Aerostats are chosen at stage 7 (placement optimisation) and raised at stage 8.</p><button class="btn" data-go="7">Go to stage 7</button></div>`;
  const icon = r => r === 'relay' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20V10M8 6a6 6 0 0 1 8 0M5 3a10 10 0 0 1 14 0"/><circle cx="12" cy="9" r="1.5"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="9" rx="8" ry="4.5"/><path d="M12 13.5V21M10 15h4"/></svg>';
  const rows = o.nodes.map((n, i) => { const shown = vis.includes(i), st = n.replan ? 'replan' : n.role; return `<div class="frow ${app.sel === i ? 'sel' : ''}" data-node="${i}" style="${shown ? '' : 'opacity:.4'}"><span class="ic">${icon(n.role)}</span><span class="nm"><b>${n.id}</b><small>${n.role === 'relay' ? 'Comms relay' : 'Camera + radio'} · ${shown ? (n.hop > 0 ? n.hop + '-hop link' : 'no link') : 'planned'}</small></span><span class="st ${st}">${n.replan ? 'Added' : n.role === 'relay' ? 'Relay' : 'Sensing'}<br><span class="mono muted" style="font-weight:500">${o.p.h} m</span></span><span><span class="bar"><i style="width:${Math.min(100, (n.shap || 0) * 400)}%"></i></span><span class="pc">${pc0(n.shap || 0)}</span></span></div>`; }).join('');
  let det = '';
  if (app.sel != null && o.nodes[app.sel]) {
    const n = o.nodes[app.sel], s = o.sites[n.site], r = Mo.footR(o.p, o.p.h); let inF = 0, dN = 0; for (let i = 0; i < o.P.n; i++) { if (Math.hypot(o.P.x[i] - s.x, o.P.y[i] - s.y) <= r) inF++; if (o.P.detBy[i] === app.sel) dN++; }
    const lat = o.sc.lat + s.y / 111320, lon = o.sc.lon + s.x / (111320 * Math.cos(o.sc.lat * Math.PI / 180));
    det = `<div class="sec"><h4>${n.id} <small>${n.role === 'relay' ? 'Relay aerostat' : 'Sensing aerostat'}${n.replan ? ' · added at replanning' : ''}</small></h4>
      <div class="met"><div><span class="k">Altitude</span><span class="v">${o.p.h}</span><span class="s">m AGL · ${f0(s.z0 + o.p.h)} m MSL</span></div><div><span class="k">Footprint</span><span class="v">${f0(r)}</span><span class="s">m radius (geometric)</span></div><div><span class="k">Link</span><span class="v">${n.marg != null ? (n.marg >= 0 ? '+' : '') + f1(n.marg) : '—'}</span><span class="s">dB margin · ${n.hop > 0 ? n.hop + ' hop' : 'none'}</span></div><div><span class="k">People in view</span><span class="v" data-sim>${inF}</span><span class="s">${dN} credited (sim)</span></div><div><span class="k">Shapley</span><span class="v">${pc0(n.shap || 0)}</span><span class="s">of coverage</span></div><div><span class="k">If lost</span><span class="v">−${pc0(n.loo || 0)}</span><span class="s">coverage</span></div></div>
      <dl class="kv" style="margin-top:10px"><dt>Position</dt><dd class="mono">${lat.toFixed(5)}°N ${lon.toFixed(5)}°E</dd><dt>Ground</dt><dd>${C.CLS_NAME[s.cls]}, slope ${Math.round(Math.atan(s.slope) * 57.3)}°</dd><dt>Greedy gain</dt><dd>${n.gain ? '+' + pc(n.gain) : '—'}</dd><dt>Deploy</dt><dd data-sim>Team ${n.team}, ${f1(n.km || 0)} km, ETA ${n.eta} min</dd></dl>
      <div class="row" style="margin-top:10px"><button class="btn primary" data-act="feed">Camera view</button><button class="btn" data-act="why">Why here?</button><button class="btn" data-act="fail">Failure drill</button></div><div id="drillOut" style="margin-top:8px"></div></div>`;
  }
  return det + `<div class="sec"><h4>Aerostat fleet <small>${vis.length} of ${o.nodes.length} visible at stage ${app.step}</small></h4><div class="fleet">${rows}</div><p class="src" style="margin:8px 0 0">Bars: Shapley share of weighted coverage. Aerostats are stationary; symbols are drawn larger than life so they stay visible.</p></div>`;
}
function sideSources() {
  const o = app.out, sc = o.sc, Ls = app.built.layers || {};
  const rows = ['terrain', 'context', 'imagery', 'imageryPre', 'landcover', 'roads', 'drainage', 'buildings', 'population', 'hazard', 'people', 'sensors'].filter(k => Ls[k]).map(k => { const l = Ls[k], r = l.rec; return `<tr><td><b>${esc(l.name)}</b><br><span class="tier ${l.tier}">${TIER_WORD[l.tier]}</span></td><td>${r ? `${esc(r.source_name)}<br><span class="muted">${r.observation_start ? 'obs. ' + esc(String(r.observation_start).slice(0, 10)) + ' · ' : ''}${r.native_resolution_m ? (Array.isArray(r.native_resolution_m) ? r.native_resolution_m.join('×') : r.native_resolution_m) + ' m native · ' : ''}${esc(r.license)}</span>${r.landing_page_url ? `<br><a href="${esc(r.landing_page_url)}" target="_blank" rel="noopener">source ↗</a>` : ''}` : ''}${l.note ? `<br><span class="muted">${esc(l.note)}</span>` : ''}</td></tr>`; }).join('');
  const facts = (sc.facts || []).map(f => `<tr><td>${esc(f.m)}<br><span class="muted">${esc(f.scope)}</span></td><td><b data-real>${esc(f.v)}</b><br><span class="muted">${esc(f.date)}${f.src ? ' · ' + esc(C.SRC[f.src].tier) : ''}</span>${f.note ? `<br><span class="muted">${esc(f.note)}</span>` : ''}</td></tr>`).join('');
  return `<div class="sec"><h4>Data layers <small>${app.built.real ? 'v' + (PK.manifest && PK.manifest.version || '') : 'synthetic fallback'}</small></h4><table class="t"><tbody>${rows}</tbody></table><p class="src" style="margin:8px 0 0">Tiers: <span class="tier verified">real</span> source data · <span class="tier derived">derived</span> computed from source data · <span class="tier modelled">model</span> statistical or simulation estimate · <span class="tier assumption">assumed</span> chosen parameter · <span class="tier synthetic">synthetic</span> generated illustration.</p></div>
  <div class="sec"><h4>Reported figures <small>all records kept</small></h4><table class="t"><tbody>${facts || '<tr><td>Hypothetical scenario — no real figures.</td></tr>'}</tbody></table><p class="src" style="margin:8px 0 0">${sc.sources.map(k => `<a href="${C.SRC[k].u}" target="_blank" rel="noopener">${esc(C.SRC[k].t)}</a>`).join('<br>')}</p><p class="src">Default figures are the latest record of the most authoritative available tier for each metric and scope; earlier and conflicting values stay listed.</p></div>`;
}
$('#sBody').addEventListener('click', e => {
  const t = e.target.closest('button, .frow, tr[data-x]'); if (!t) return;
  if (t.dataset.mode) { setMode(t.dataset.mode); return; }
  if (t.dataset.img) { E.setImagery(t.dataset.img); displayLayers(); renderTop(); renderSide(); return; }
  if (t.dataset.sub) { app.stepTab = t.dataset.sub; renderSide(); return; }
  if (t.dataset.go) { go(+t.dataset.go); return; }
  if (t.dataset.node != null) { selectNode(+t.dataset.node, true); return; }
  if (t.dataset.act === 'why') whyHere(app.sel); if (t.dataset.act === 'feed') openFeed(app.sel); if (t.dataset.act === 'fail') failDrill(app.sel);
});
$('#sBody').addEventListener('change', e => {
  const t = e.target; if (t.id === 'gridT') { E.gridded = t.checked; updateScalar(); renderLegend(); return; }
  if (t.dataset.layer) { app.L[t.dataset.layer].on = t.checked; if (t.dataset.layer === 'truth' || t.dataset.layer === 'people') applyVisuals(false); else { displayLayers(); paintOverlay(); renderLegend(); } renderSide(); }
});
$('#sBody').addEventListener('input', e => { const t = e.target; if (t.dataset.alpha) { app.L[t.dataset.alpha].a = t.value / 100; t.nextElementSibling.textContent = t.value + '%'; clearTimeout(paintOverlay.h); paintOverlay.h = setTimeout(paintOverlay, 50); } });
function hoverRows(root) {
  root.addEventListener('mouseover', e => { const tr = e.target.closest('tr[data-x]'); if (tr) V.highlight(+tr.dataset.x, +tr.dataset.y, +tr.dataset.r || null); });
  root.addEventListener('click', e => { const tr = e.target.closest('tr[data-x]'); if (tr) { E.flyTo(+tr.dataset.x, +tr.dataset.y, 0.22); V.highlight(+tr.dataset.x, +tr.dataset.y, +tr.dataset.r || null); } });
}
hoverRows($('#sBody'));

/* ---------- viewport tools ---------- */
function closeMenu() { $('#vMenu').hidden = true; $('#vViews').setAttribute('aria-expanded', 'false'); }
$('#vViews').onclick = () => { const m = $('#vMenu'); if (!m.hidden) { closeMenu(); return; } const P = A.hazard.presets || {}, hp = !!A.hazard.path;
  m.innerHTML = [['overview', 'Overview'], ['source', hp ? 'Top of observed scour' : 'Reported location'], ['runout', hp ? 'Along the descent path' : 'Affected area'], ['deposition', hp ? 'Lower end' : 'Wider view'], ['icp', 'Command post'], ['top', 'Straight down']].map(([k, t]) => `<button data-view="${k}">${t}</button>`).join('') + `<hr><button data-view="tour">▶ Guided tour of the pipeline</button>`;
  m.hidden = false; $('#vViews').setAttribute('aria-expanded', 'true'); };
$('#vMenu').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (!b) return; const k = b.dataset.view; closeMenu(); if (k === 'tour') { startTour(); return; } const P = A.hazard.presets; if (!P || !P[k]) return; if (E.mode2d && k !== 'top') set2D(false); E.flyPose(P[k].pos, P[k].tgt, 1500); });
function set2D(on) { if (!!E.mode2d === on) return; E.set2D(on); $('#b2d').setAttribute('aria-pressed', on); $('#b3d').setAttribute('aria-pressed', !on); if (!on) displayLayers(); }
$('#b2d').onclick = () => set2D(true); $('#b3d').onclick = () => set2D(false);
$('#zChip').onclick = () => E.goHome();
$('#compass').onclick = () => { const t = E.ctl.target.clone(), d = E.cam.position.clone().sub(t), r = Math.hypot(d.x, d.z); E.flyPose(new THREE.Vector3(t.x, E.cam.position.y, t.z + r), t, 900); };
$('#bFull').onclick = () => { try { if (!document.fullscreenElement) $('#map').requestFullscreen(); else document.exitFullscreen(); } catch (e) {} };
addEventListener('fullscreenchange', () => setTimeout(() => E.resize(), 60));

/* ---------- hover inspection (aerostats and terrain cells) ---------- */
function onHover(hit, ev) {
  const tip = $('#tip'); if (!hit) { tip.hidden = true; return; } const r = $('#map').getBoundingClientRect(), o = app.out;
  if (hit.node != null) { const n = o.nodes[hit.node]; tip.innerHTML = `<b>${n.id} · ${n.role === 'relay' ? 'relay' : 'camera'} aerostat</b>${o.p.h} m AGL · link ${n.marg != null ? f1(n.marg) + ' dB' : 'none'} · Shapley ${pc0(n.shap || 0)}`; }
  else { tip.hidden = true; return; }
  tip.hidden = false; tip.style.left = Math.min(r.width - 270, ev.clientX - r.left + 14) + 'px'; tip.style.top = (ev.clientY - r.top + 14) + 'px';
}

/* ---------- node selection, why-here, failure drill ---------- */
function selectNode(i, fly) {
  if (i == null || !app.out.nodes[i]) return; app.sel = i; V.selectNode(i); const s = app.out.sites[app.out.nodes[i].site];
  if (app.page !== 'sim') showPage('sim');
  if (fly) E.flyTo(s.x, s.y, 0.26, E.hp(app.out.p.h) * 0.4); app.sideTab = 'fleet'; renderSide(); drawBand(); if (E.feed.on) openFeed(i);
}
function whyHere(i) {
  const o = app.out, n = o.nodes[i], B = o.B, dim = new Uint8Array(B.N); let cells = 0, ppl = 0; for (let c = 0; c < B.N; c++) { if (o.cc.cov[n.site * B.N + c]) { cells++; ppl += o.gp2.est[c]; } else dim[c] = 1; }
  V.g.bars.visible = true; V.setBars(app.step >= 10 ? o.gp2.est : B.lam, 'belief', 0, dim); const s = o.sites[n.site]; E.flyTo(s.x, s.y, 0.3); V.highlight(s.x, s.y, Mo.footR(o.p, o.p.h));
  const box = $('#drillOut'); if (box) box.innerHTML = `<div class="explain"><p class="big">${n.id} watches cells holding about ${f0(ppl)} people (estimate).</p><p>It was picked because, at that moment, it added the most uncovered weighted demand (+${pc(n.gain || 0)}). On average it contributes ${pc(n.shap || 0)} of coverage; removing it would lose ${pc(n.loo || 0)}. ${cells} belief cells are visible from it (line of sight + detection threshold).</p></div><button class="btn sm" id="whyReset">Back to stage view</button>`;
  const rb = $('#whyReset'); if (rb) rb.onclick = () => { V.highlight(null); applyVisuals(false); };
}
let drillGroup = null;
function failDrill(i) {
  const o = app.out, r = A.pipe.failDrill(o, i), nb = V.nodeObjs[i], y0 = nb.body.position.y, y1 = nb.ground.y;
  E.tween(1200, k => { nb.body.position.y = y0 + (y1 - y0) * E.ease(k); nb.body.rotation.z = k * 1.2; nb.cone.material.uniforms.op.value = 0.1 * (1 - k); }, () => { nb.body.visible = false; nb.teth.visible = false; nb.ring.visible = false; });
  if (drillGroup) E.world.root.remove(drillGroup); drillGroup = new THREE.Group(); E.world.root.add(drillGroup);
  r.fix.forEach(f => { const s = o.sites[f.site], rr = Mo.footR(o.p, o.p.h), top = new THREE.Vector3(s.x / 10, E.Y(s.z0 + o.p.h), -s.y / 10), gd = E.wp(s.x, s.y), h = top.y - gd.y; const cone = new THREE.Mesh(new THREE.ConeGeometry(rr / 10, h, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0x2f8a55, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide })); cone.position.set(top.x, gd.y + h / 2, top.z); const ball = new THREE.Mesh(new THREE.SphereGeometry(V.sz * 1.2, 14, 10), new THREE.MeshLambertMaterial({ color: 0x2f8a55 })); ball.position.copy(top); drillGroup.add(cone, ball); });
  const box = $('#drillOut'); if (box) box.innerHTML = `<div class="explain"><p class="big">If ${o.nodes[i].id} is lost (wind or tether), coverage drops from ${pc(r.before)} to ${pc(r.after)}.</p><p>The smallest fix is ${r.fix.length} replacement aerostat${r.fix.length === 1 ? '' : 's'} (green), restoring ${pc(r.final)}. ${r.linked} of ${r.total} stay linked to the command post.</p></div><button class="btn sm" id="drillReset">Restore</button>`;
  const rb = $('#drillReset'); if (rb) rb.onclick = () => { if (drillGroup) { E.world.root.remove(drillGroup); drillGroup = null; } nb.body.rotation.z = 0; nb.body.position.y = nb.top.y; applyVisuals(false); };
}

/* ---------- picking ---------- */
const onPick = hit => {
  closeMenu(); if (!hit) return; const o = app.out, ud = hit.object && hit.object.userData;
  if (hit.node != null) { selectNode(hit.node, false); return; }
  if (ud && ud.kind === 'node') { selectNode(ud.idx, false); return; }
  if (hit.object === V.bars) { const c = hit.instanceId; toast(`≈${f1(app.step >= 10 ? o.gp2.est[c] : o.B.lam[c])} people expected in this 150 m cell · priority ${o.B.prio[c]}`); return; }
  if (hit.object === V.people) { const i = hit.instanceId, P = o.P; toast(P.detBy[i] >= 0 ? `Simulated person found ${P.via[i] === 'thermal' ? 'by camera' : 'by phone signal'} via ${o.nodes[P.detBy[i]].id}` : 'Simulated person not found yet'); return; }
  if (hit.object === V.pinRej) { const r = o.steps.sites.rejected[hit.instanceId]; toast('Ruled out: ' + r.why); return; }
  if (hit.object === V.pinValid) { const s = o.sites[hit.instanceId]; toast(`Usable site · ${C.CLS_NAME[s.cls]} · slope ${Math.round(Math.atan(s.slope) * 57.3)}°`); return; }
  if (hit.terrain) { const x = hit.point.x * 10, y = -hit.point.z * 10, T = o.T; if (Math.abs(x) > T.S / 2 || Math.abs(y) > T.S / 2) return; const k = C.idxAt(T, x, y), c = o.B.cellOf(x, y), wc = T.wc ? PK.WC_NAME[T.wc[k]] : C.CLS_NAME[T.cls[k]]; toast(`${f0(C.elevAt(T, x, y))} m · ${wc}${o.M.hazMask && o.M.hazMask[k] ? ' · in observed hazard' : ''} · ≈${f1(app.step >= 10 ? o.gp2.est[c] : o.B.lam[c])} people expected in cell`); }
};

/* ---------- feed (simulated nadir view from the selected aerostat) ---------- */
function openFeed(i) {
  if (i == null || !V.nodeObjs[i] || !V.nodeObjs[i].body.visible) { toast('Aerostats go up at stage 8'); return; }
  app.sel = i; V.selectNode(i); E.feed.on = true; E.feed.node = V.nodeObjs[i].body; E.feed.fov = app.out.p.fov * 0.85; $('#feed').hidden = false; $('#feedTitle').textContent = app.out.nodes[i].id; hud();
}
function closeFeed() { E.feed.on = false; $('#feed').hidden = true; }
$('#feedClose').onclick = closeFeed;
$$('[data-fm]').forEach(b => b.onclick = () => { E.feed.mode = b.dataset.fm; $$('[data-fm]').forEach(x => x.setAttribute('aria-pressed', x === b)); $('#feedMode').textContent = b.dataset.fm === 'IR' ? 'ironbow · simulated thermal' : 'nadir · simulated view'; hud(); });
function hud() {
  if (!E.feed.on) return; const o = app.out, i = app.sel, n = o.nodes[i], s = o.sites[n.site], r = Mo.footR(o.p, o.p.h); let inV = 0, det = 0; for (let q = 0; q < o.P.n; q++) if (Math.hypot(o.P.x[q] - s.x, o.P.y[q] - s.y) <= r) { inV++; if (o.P.detBy[q] >= 0) det++; }
  const tt = new Date(), lat = o.sc.lat + s.y / 111320, lon = o.sc.lon + s.x / (111320 * Math.cos(o.sc.lat * Math.PI / 180));
  $('#hudTL').innerHTML = `REC ${String(tt.getMinutes()).padStart(2, '0')}:${String(tt.getSeconds()).padStart(2, '0')}<br>${n.id} ${n.role === 'relay' ? 'RELAY' : 'SENSE'}<br>${E.feed.mode} · ${E.feed.mode === 'IR' ? 'IRONBOW' : 'NADIR'}`;
  $('#hudTR').innerHTML = `STAGE ${app.step}/11<br>${esc(o.sc.code)}`; $('#hudBL').innerHTML = `ALT ${o.p.h} M AGL<br>${f0(s.z0 + o.p.h)} M MSL<br>FOV ${o.p.fov}° · R ${f0(r)} M`;
  $('#hudBC').innerHTML = `SPI ${lat.toFixed(5)}N ${lon.toFixed(5)}E`; $('#hudBR').innerHTML = `IN VIEW ${inV} · FOUND ${det} (SIM)<br>LNK ${n.marg != null ? '+' + f1(n.marg) + ' DB' : 'NONE'}`; clearTimeout(hud.h); hud.h = setTimeout(hud, 1000);
}

/* ---------- before/after (real pre- vs post-event imagery), compare, tour, present ---------- */
function stopBA() { $('#splitbar').hidden = true; E.setSplit(-1); $('#tBA').setAttribute('aria-pressed', 'false'); }
$('#tBA').onclick = () => {
  if (!$('#splitbar').hidden) { stopBA(); return; } const av = E.imageryAvail(); if (!av.pre || !av.post) { toast(app.out.sc.id === 'delhi' ? 'Hypothetical scenario — there is no before/after' : 'Only one image date is available here'); return; }
  stopCompare(); E.setImagery('post'); displayLayers(); renderTop(); const P = app.built.M.pack, rp = PK.record(app.out.sc.id, av.preRadar ? 'imagery_s1_pre_vv' : 'imagery_s2_pre'), rq = PK.record(app.out.sc.id, av.postRadar ? 'imagery_s1_post_vv' : 'imagery_s2_post');
  $('#baL').textContent = `Before · ${av.preRadar ? 'S1 radar' : 'Sentinel-2'} ${fmtDate(rp && rp.observation_start)}`; $('#baR').textContent = `After · ${av.postRadar ? 'S1 radar' : 'Sentinel-2'} ${fmtDate(rq && rq.observation_start)}`;
  $('#splitbar').hidden = false; $('#tBA').setAttribute('aria-pressed', 'true'); setSplit(0.5); };
function setSplit(f) { const m = $('#map'); $('#splitbar').style.left = (f * m.clientWidth) + 'px'; E.setSplit(f); }
(function () { let drag = false; const sb = $('#splitbar'); sb.addEventListener('pointerdown', e => { drag = true; sb.setPointerCapture(e.pointerId); }); sb.addEventListener('pointermove', e => { if (!drag) return; const r = $('#map').getBoundingClientRect(); setSplit(C.clamp((e.clientX - r.left) / r.width, 0.05, 0.95)); }); sb.addEventListener('pointerup', () => drag = false); })();
function startCompare() {
  if (app.page !== 'sim') showPage('sim'); if (app.step < 7) go(7, false); stopBA(); app.pick = app.out.steps.optimise.sol.length; applyVisuals(false);
  const o = app.out; E.compare = { left: [V.g.nodes], right: [V.g.kmeans] }; V.g.kmeans.visible = false; $('#cmpTags').hidden = false; document.body.classList.add('hide-labels');
  $('#cmpL').textContent = `ARES greedy: ${o.steps.optimise.sol.length} aerostats`; $('#cmpR').textContent = `k-means: ${V.kmN} aerostats → ${pc0(V.kmCov || 0)}`; $('#tCmp').setAttribute('aria-pressed', 'true');
}
function stopCompare() { if (!E.compare) return; E.compare = null; V.g.nodes.visible = true; V.g.kmeans.visible = false; $('#cmpTags').hidden = true; document.body.classList.toggle('hide-labels', !app.L.labels.on); $('#tCmp').setAttribute('aria-pressed', 'false'); E.resize(); }
$('#tCmp').onclick = () => E.compare ? stopCompare() : startCompare();
function startTour() {
  if (app.page !== 'sim') showPage('sim'); if (E.touring) { E.stopTour(); return; } stopCompare(); stopBA(); closeFeed(); if (app.auto) $('#auto').click();
  $('#btnTour').classList.add('on'); $('#btnTour').textContent = 'Stop tour'; toast('Guided tour — click or drag the map any time to take over');
  E.tour(A.hazard.tourPoses(app.out), null, p => { if (p.step && p.step !== app.step) go(p.step, true); const cap = $('#stageCap'); if (p.cap) cap.innerHTML = `<b>${app.step}/11</b> ${esc(p.cap)}`; });
}
E.onTourEnd = () => { $('#btnTour').classList.remove('on'); $('#btnTour').textContent = 'Tour'; renderStage(); };
$('#btnTour').onclick = startTour;
function setPresent(on) { document.body.classList.toggle('presenter', on); $('#exitPresent').hidden = !on; try { if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (e) {} if (on) showPage('sim'); setTimeout(() => { E.resize(); drawBand(); }, 80); }
$('#btnPresent').onclick = () => setPresent(true); $('#exitPresent').onclick = () => setPresent(false);
addEventListener('keydown', e => { if (e.target.closest('input,select,textarea')) return; if (app.page === 'sim' && e.key === 'ArrowRight') go(app.step + 1); else if (app.page === 'sim' && e.key === 'ArrowLeft') go(app.step - 1); else if (e.key === 'Escape') { if (E.touring) E.stopTour(); closeMenu(); $('#modal').hidden = true; if (document.body.classList.contains('presenter')) setPresent(false); } });

/* ---------- results page ---------- */
function drawResults() {
  if (app.page !== 'results') return; const o = app.out; CH.readTokens(); const tk = CH.tok();
  CH.people($('#c1'), o, 11); CH.coverage($('#c2'), o, null);
  $('#c2s').innerHTML = `<span style="color:var(--accent)">ARES ${o.steps.optimise.sol.length}</span> · <span style="color:var(--violet)">k-means ${o.steps.optimise.base.needKmeans ?? '>' + (o.steps.optimise.base.kmeans.length - 1)}</span> · random ${o.steps.optimise.base.needRandom ?? '>' + (o.steps.optimise.base.random.length - 1)}`;
  const ni = +($('#losSel') ? $('#losSel').value : 0), r = CH.profile($('#c3'), o, ni); if (r) $('#c3s').textContent = `${o.nodes[ni].id} is ${r.km.toFixed(1)} km from the command post. ${r.blocked ? 'The direct line is blocked by terrain, so its data hops through other aerostats.' : 'The direct line is clear.'}`;
  CH.bars($('#shC'), o.nodes.map(n => n.id.replace('A-', '').replace('R-', 'R')), o.nodes.map(n => (n.shap || 0) * 100), { yf: v => v.toFixed(0) + '%', vf: v => v.toFixed(1) });
  if (app.mc && $('#mcC')) CH.hist($('#mcC'), app.mc.map(r => r.nodes), { color: tk['--accent'] });
  if (app.hs && $('#hsC')) CH.bars($('#hsC'), app.hs.map(r => r.h + ' m'), app.hs.map(r => r.n), { colors: app.hs.map(r => r.met ? tk['--accent'] : tk['--faint']) });
  if (app.cross) showCross(app.cross);
}
function showCross(rows) { const el = $('#crossOut'); if (!el) return; el.innerHTML = PN.crossTable(rows); const b = $('#btnCrossTex'); if (b) b.onclick = () => copy(PN.crossLatex(rows), 'Cross-scenario LaTeX'); }
$('#resultsBody').addEventListener('change', e => { if (e.target.id === 'losSel') drawResults(); });
$('#resultsBody').addEventListener('click', async e => {
  const t = e.target.closest('button, .nodecard'); if (!t) return; const o = app.out;
  if (t.dataset.node != null) { selectNode(+t.dataset.node, true); return; }
  if (t.dataset.act === 'compare') { startCompare(); return; }
  if (t.id === 'btnMC') { t.disabled = true; app.mc = await A.pipe.monteCarlo(o.sc, app.params, app.cache[o.sc.id], 30, (k, n) => { const el = $('#mcProg'); if (el) el.textContent = `${k}/${n}`; }); renderPage(); }
  if (t.id === 'btnHS') { t.disabled = true; t.textContent = 'Running…'; await new Promise(r => setTimeout(r, 30)); app.hs = A.pipe.heightSweep(o); renderPage(); }
  if (t.id === 'btnCross') { t.disabled = true; $('#crossOut').innerHTML = '<p class="small muted" id="crossProg">Running all five scenarios… 0/5</p>'; for (const sc of C.SCENARIOS) await buildScenario(sc); C.SCENARIOS[app.scIdx]; app.cross = await A.pipe.crossScenario(app.params, app.cache, k => { const el = $('#crossProg'); if (el) el.textContent = `Running all five scenarios… ${k}/5`; }); showCross(app.cross); t.disabled = false; }
});
new ResizeObserver(() => { if (app.out && app.page === 'results') { clearTimeout(drawResults.h); drawResults.h = setTimeout(drawResults, 120); } }).observe($('#pg-results'));

/* ---------- briefing page ---------- */
$('#briefBody').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-sector-x]'); if (tr) { const x = +tr.dataset.sectorX, y = +tr.dataset.sectorY; showPage('sim'); if (app.step < 11) go(11, false); setTimeout(() => { E.flyTo(x, y, 0.25); V.highlight(x, y, 150); }, 60); return; }
  const t = e.target.closest('button'); if (!t) return;
  if (t.id === 'btnCSV') copy(sectorCSV(), 'Sector CSV'); if (t.id === 'btnBriefJSON') copy(JSON.stringify(briefJSON(), null, 1), 'Briefing JSON');
  if (t.dataset.act === 'sectormap') { showPage('sim'); go(11); }
});

/* ---------- model page ---------- */
$('#modelBody').addEventListener('change', e => {
  const t = e.target; if (t.id === 'honesty') { document.body.classList.toggle('honesty', t.checked); return; }
  if (t.dataset.param) { app.params[t.dataset.param] = t.tagName === 'SELECT' ? t.value : +t.value; toast('Press Re-run model to apply'); }
});
$('#modelBody').addEventListener('input', e => { const t = e.target; if (t.dataset.param && t.type === 'range') { const u = t.dataset.u, v = +t.value; $('#o_' + t.dataset.param).textContent = u === '%' ? Math.round(v * 100) + '%' : v + (u ? ' ' + u : ''); app.params[t.dataset.param] = v; } });
$('#modelBody').addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return; const o = app.out;
  if (t.id === 'btnDEM') $('#demFile').click(); if (t.id === 'btnRerun') rerun(); if (t.id === 'btnSeed') { app.params.seed = Math.floor(Math.random() * 9000) + 10; rerun(); }
  if (t.id === 'btnLatex') copy(PN.latex(o), 'LaTeX tables'); if (t.id === 'btnJSON') copy(JSON.stringify(resultsJSON(), null, 1), 'Results JSON');
  if (t.id === 'btnManifest') copy(JSON.stringify(PK.records(o.sc.id), null, 1), 'Data manifest (this scenario)');
});

/* ---------- scale bar, compass, zoom chip, theme ---------- */
E.onCamera = () => { const mpp = E.metresPerPx(), target = mpp * 110, p = Math.pow(10, Math.floor(Math.log10(target))), nice = [1, 2, 2.5, 5, 10].map(f => f * p).filter(v => v <= target * 1.25).pop() || p; $('#scaleBar').style.width = (nice / mpp).toFixed(0) + 'px'; const fm = v => v >= 1000 ? (v / 1000) + ' km' : Math.round(v) + ' m'; $('#scaleTxt').textContent = fm(nice); $('#scaleMid').textContent = fm(nice / 2).replace(' km', '').replace(' m', ''); $('#compassSvg').style.transform = `rotate(${(-E.azimuth() * 57.3).toFixed(1)}deg)`; $('#zChip').textContent = E.zoomFactor().toFixed(1) + '×'; };
function themeSync() { CH.readTokens(); const cs = getComputedStyle(document.documentElement), hor = cs.getPropertyValue('--sky').trim() || '#d9d4c9', top = cs.getPropertyValue('--sky-top').trim() || '#9fb3c4'; E.setSky(top, hor); drawBand(); if (app.page === 'results') drawResults(); }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeSync);
new MutationObserver(themeSync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
E.onFrame(t => { if (app.out && app.step >= 8 && app.out.p.drift > 0 && app.page === 'sim' && !E.reduce) { V.drift(t); return true; } return false; }, true);

/* ---------- exports (now with data provenance) ---------- */
function provenance() { const o = app.out, Ls = app.built.layers || {}; return { dataPackVersion: PK.manifest && PK.manifest.version, real: app.built.real, aoi: { lat: o.sc.lat, lon: o.sc.lon, sizeM: o.T.S, crs: app.built.M.pack ? app.built.M.pack.aoi.crs : 'local tangent plane (synthetic)' }, layers: Object.fromEntries(Object.entries(Ls).filter(([, v]) => v).map(([k, v]) => [k, { tier: v.tier, source: v.rec ? v.rec.source_name : null, datasetId: v.rec ? v.rec.dataset_id : null, observed: v.rec ? v.rec.observation_start : null, checksum: v.rec ? v.rec.checksum : null, note: v.note || null }])), reportedFacts: o.sc.facts, population: { resident: o.steps.belief.resident, exposed: o.steps.belief.exposed, requiringAssistance: o.sc.people, requiringAssistanceIs: 'scenario assumption used to scale the Belief State' } }; }
function resultsJSON() { const o = app.out, s = o.steps; return { scenario: o.sc.name, code: o.sc.code, params: o.p, targetEffective: o.tEff, reach: o.reach, nodes: o.nodes.map(n => ({ id: n.id, role: n.role, replan: !!n.replan, lat: +(o.sc.lat + o.sites[n.site].y / 111320).toFixed(6), lon: +(o.sc.lon + o.sites[n.site].x / (111320 * Math.cos(o.sc.lat * Math.PI / 180))).toFixed(6), gain: n.gain, shapley: n.shap, hops: n.hop, marginDb: n.marg })), optimise: { nodes: s.optimise.sol.length, coverage: s.optimise.cov, lowerBound: s.optimise.lb, kmeans: s.optimise.base.needKmeans, random: s.optimise.base.needRandom, grid: s.optimise.base.grid }, sensing: s.update.sense, belief: s.update.gp2, handover: s.handover, simulated: 'people, detections and estimates are simulated', provenance: provenance() }; }
function briefJSON() { const o = app.out; return { incident: o.sc.code, issued: 'stage 11', commandPost: o.M.icp, sectors: (o.sectors || []).map(r => ({ rank: r.rank, sector: r.id, priority: r.pri, confirmed: r.conf, estimated: +r.est.toFixed(1), ci90: +(1.64 * r.sd).toFixed(1), lat: +r.lat.toFixed(6), lon: +r.lon.toFixed(6), routeKm: r.route ? +(r.route.len / 1000).toFixed(2) : null, boat: r.route ? r.route.boat : null })), note: 'Confirmed and estimated counts are simulated; terrain, roads and buildings from the data pack listed in provenance.', provenance: provenance() }; }
function sectorCSV() { return 'rank,sector,priority,confirmed,estimated,ci90,lat,lon,route_km,boat\n' + briefJSON().sectors.map(r => [r.rank, r.sector, r.priority, r.confirmed, r.estimated, r.ci90, r.lat, r.lon, r.routeKm ?? '', r.boat ?? ''].join(',')).join('\n'); }

/* ---------- user GeoTIFF elevation (replaces the elevation of the current scenario; other layers unchanged) ---------- */
$('#demFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  if (!window.GeoTIFF) { toast('GeoTIFF reader did not load'); return; }
  try {
    showPage('sim'); $('#loading').hidden = false; $('#loading').textContent = 'Reading elevation file…';
    const tiff = await GeoTIFF.fromArrayBuffer(await file.arrayBuffer()), img = await tiff.getImage(), bb = img.getBoundingBox(), W = img.getWidth(), Hh = img.getHeight(), ras = (await img.readRasters({ samples: [0] }))[0];
    const sc = C.SCENARIOS[app.scIdx], built = app.cache[sc.id], T = built.T, cosl = Math.cos(sc.lat * Math.PI / 180);
    const lat0 = sc.lat - T.S / 2 / 111320, lat1 = sc.lat + T.S / 2 / 111320, lon0 = sc.lon - T.S / 2 / (111320 * cosl), lon1 = sc.lon + T.S / 2 / (111320 * cosl);
    if (!(bb[0] <= lon0 && bb[2] >= lon1 && bb[1] <= lat0 && bb[3] >= lat1)) { $('#loading').hidden = true; toast('That file does not cover this area — use a WGS84 GeoTIFF covering the model area'); return; }
    C.forEachV(T, (i, j, x, y, k) => { const lat = sc.lat + y / 111320, lon = sc.lon + x / (111320 * cosl), px = (lon - bb[0]) / (bb[2] - bb[0]) * (W - 1), py = (bb[3] - lat) / (bb[3] - bb[1]) * (Hh - 1), x0 = Math.floor(px), y0 = Math.floor(py), u = px - x0, v = py - y0, g = (a, b) => ras[C.clamp(b, 0, Hh - 1) * W + C.clamp(a, 0, W - 1)]; const e2 = (g(x0, y0) * (1 - u) + g(x0 + 1, y0) * u) * (1 - v) + (g(x0, y0 + 1) * (1 - u) + g(x0 + 1, y0 + 1) * u) * v; T.elev[k] = e2 > -500 ? e2 : T.elev[k]; T.pre[k] = T.elev[k]; });
    C.finishSlope(T); built.M.buildings.forEach(b => b.base = C.elevAt(T, b.x, b.y)); T.real = true; if (built.M.water != null && !built.M.real) built.M.water = T.base + (built.M.water - 44);
    if (built.layers) built.layers.terrain = { name: 'Elevation', tier: 'verified', rec: null, note: 'User-supplied GeoTIFF: ' + file.name + ' (bilinear, equirectangular approximation over the model area)' };
    $('#loading').textContent = 'Running the model on the new elevation…'; rerun(); toast('Elevation replaced from your file; all dependent stages recomputed');
  } catch (err) { $('#loading').hidden = true; toast('Could not read file: ' + err.message); }
};

app.setMode = setMode; app.go = go; app.showPage = showPage; app.load = load; app.selectNode = selectNode; app.openFeed = openFeed; app.drawBand = drawBand; app.renderSide = renderSide; app.buildScenario = buildScenario; app.set2D = set2D; app.startBA = () => $('#tBA').click(); app.startCompare = startCompare; app.stopCompare = stopCompare; app.stopBA = stopBA;
/* ---------- boot ---------- */
E.init($('#map'), $('#feedC'));
E.enablePick(onPick, onHover);
renderSide();
load(0, true);
})(window.ARES);
