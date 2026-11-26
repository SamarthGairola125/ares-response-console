/* ARES v7 — Geographic search page, map overlay and progressive exploration UI. Reads A.search (engine) and app.out (the Level 1 run). */
(function (A) {
'use strict';
const C = A.core, Mo = A.model, GS = A.search, E = A.scene, app = A.app;
const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f0 = v => v == null || isNaN(v) ? '—' : Math.round(v).toLocaleString('en-IN'), f1 = v => (+v).toFixed(1), f2 = v => (+v).toFixed(2), pc = v => v == null ? '—' : (v * 100).toFixed(1) + '%';
const SU = A.searchui = { st: { f: 1.5, mode: 'A', demand: 'hazard', busy: null, prog: 0, overlay: false, prog2: null, hover: null }, results: {} };
const MODES = { A: ['Same people, wider launch-site search', 'Demand stays the original Belief State. Candidate launch sites, relays and access are searched over the wider area. Answers: does looking further out give a better deployment for the people we already expect?'],
  B: ['Wider area to cover', 'The Belief State, settlements and simulated survivors of the extra ring are added with the same model. Answers: what does it take to also cover the surrounding settlements with the same fleet and command post?'] };
const COLS = { 1: '#15181d', 2: '#2563c4', 3: '#7a52c4', 4: '#b7791f' };

const sid = () => app.out && app.out.sc.id;
const rkey = (f, mode, demand) => sid() + '|' + f + '|' + mode + '|' + (mode === 'B' ? demand : '');
SU.hasResult = () => !!SU.cur;
SU.last = () => { const r = SU.cur; if (!r || r.sid !== sid()) return null; const o = r.o.outc, L = GS.outcomesBase(app.out); return `${r.f}× (${f0(o.areaKm2)} km², ${r.mode === 'A' ? 'same people' : 'wider area'}): ${f0(o.sitesValid)} valid sites (+${f0(o.sitesValid - L.sitesValid)}), ${o.placed} aerostats placed (Level 1: ${L.placed}), coverage ${pc(o.cov)}.`; };

/* ---------- running ---------- */
async function ensurePack(onp) { const id = sid(); return GS.loadExt(id, onp); }
SU.runLevel = async function (f, mode, demand) {
  if (SU.st.busy) return; const out0 = app.out, sc = out0.sc, id = sc.id, t0 = performance.now();
  SU.st.busy = 'Loading wider-area data…'; SU.st.prog = 0.05; paint();
  try {
    const X = await ensurePack((d, n) => { SU.st.prog = 0.05 + 0.4 * d / n; SU.st.busy = `Loading wider-area data (${d}/${n} layers)…`; paintProg(); });
    if (app.out !== out0) throw new Error('scenario changed');
    SU.st.busy = `Building the ${f}× terrain, buildings and candidates…`; SU.st.prog = 0.5; paintProg(); await tick();
    const built = GS.buildLevel(sc, out0, X, f); if (app.out !== out0) throw new Error('scenario changed');
    SU.st.busy = `Running all 11 stages on ${f0(built.Sf * built.Sf / 1e6)} km²…`; SU.st.prog = 0.7; paintProg(); await tick();
    const o = GS.run(sc, out0, built, mode, app.params, demand); if (app.out !== out0) throw new Error('scenario changed');
    SU.results[rkey(f, mode, demand)] = { f, mode, demand, o, sid: id, ms: Math.round(performance.now() - t0), at: new Date(), run: app.run.id };
    SU.cur = SU.results[rkey(f, mode, demand)]; SU.st.busy = null; SU.st.prog = 1;
    if (SU.st.overlay) buildOverlay(); app.renderStageCard && app.renderStageCard(); $('#vSearch').disabled = false;
  } catch (e) { SU.st.busy = null; SU.st.err = e.message; console.error(e); }
  paint();
};
SU.progressive = async function () {
  if (SU.st.busy) return; const out0 = app.out, sc = out0.sc, st = SU.st; st.busy = 'Progressive exploration…'; st.prog = 0.02; paint();
  try { const X = await ensurePack(); const r = await GS.progressive(sc, out0, X, st.mode, app.params, { step: 0.5, force: true }, (f, mx) => { st.prog = f / mx; st.busy = `Progressive exploration — ${f}× done…`; paintProg(); }, st.demand);
    if (app.out !== out0) throw new Error('scenario changed'); st.prog2 = { sid: sc.id, mode: st.mode, demand: st.demand, r };
    const lastF = r.rows[r.rows.length - 1].f; if (lastF > 1) { const k = rkey(lastF, st.mode, st.demand), o = GS.runs.get(sc.id + '|' + lastF + '|' + st.mode + '|' + (st.mode === 'B' ? st.demand : '') + '|' + JSON.stringify(app.params || {})); if (o) { SU.results[k] = { f: lastF, mode: st.mode, demand: st.demand, o, sid: sc.id, at: new Date(), run: app.run.id }; SU.cur = SU.results[k]; st.f = lastF; } }
  } catch (e) { st.err = e.message; console.error(e); }
  st.busy = null; paint();
};
const tick = () => new Promise(r => setTimeout(r, 30));

/* ---------- page ---------- */
SU.render = function () { if (!app.out) return; paint(); };
function levelCard(L) {
  const S0 = app.out.T.S / 1000, side = S0 * L.f, done = Object.values(SU.results).filter(r => r.sid === sid() && r.f === L.f);
  return `<button class="lvl" data-f="${L.f}" aria-pressed="${SU.st.f === L.f}"><b>${L.id}. ${esc(L.name)}</b><em>${L.f}× · ${f1(side)} × ${f1(side)} km · ${f0(side * side)} km²</em><span>${esc(L.d)}</span>${done.length ? `<span class="done">✓ computed (${done.map(r => r.mode).join(', ')})</span>` : ''}</button>`;
}
function paintProg() { const p = $('#suProg'); if (p) { p.querySelector('i').style.width = Math.round(SU.st.prog * 100) + '%'; } const b = $('#suBusy'); if (b) b.textContent = SU.st.busy || ''; }
function paint() {
  const el = $('#searchBody'); if (!el || app.page !== 'search' || !app.out) return; const o0 = app.out, sc = o0.sc, st = SU.st, L1 = GS.outcomesBase(o0), cur = SU.cur && SU.cur.sid === sc.id ? SU.cur : null;
  const custom = !GS.LEVELS.some(l => l.f === st.f);
  el.innerHTML = `<div class="phead"><div><p class="eyebrow">Geographic search · ${esc(sc.code)}</p><h1>Original vs wider search area</h1><p class="lede">The original simulation searches one fixed square (${f1(o0.T.S / 1000)} × ${f1(o0.T.S / 1000)} km). Here the same model searches wider areas built from real data at the same resolution — the original square is kept unchanged inside them — and the outcomes are compared under identical assumptions, fleet budget (${o0.p.Kmax} aerostats + 3 for replanning) and command post.</p></div><div class="row"><button class="btn" data-su="toSim">← 3D simulation</button>${cur ? '<button class="btn" data-su="show3d">Show on 3D map</button><button class="btn" data-su="export">Export comparison (JSON)</button>' : ''}</div></div>
  <div class="note" style="margin-bottom:12px"><b>Physical limits do not change.</b> Camera footprint ≈ ${f0(Mo.footR(o0.p, o0.p.h))} m radius at ${o0.p.h} m, radio link budget (866 MHz, sensitivity ${o0.p.sens} dBm), tether height and the fleet budget are identical at every level. A wider search area means more places are considered — not that an aerostat sees or talks further.</div>
  <div class="card"><h3>1 · Choose the search extent <small>levels are multiples of the original side</small></h3><div class="lvls">${GS.LEVELS.map(levelCard).join('')}</div>
    <div class="sctl" style="margin-top:12px"><label>Custom extent <input type="range" id="suF" min="1" max="${GS.MAXF}" step="0.25" value="${st.f}"> <b class="mono" id="suFv">${st.f}×</b>${custom ? ' <span class="muted small">(custom)</span>' : ''}</label>
      <span>Compare <span class="seg2">${Object.keys(MODES).map(k => `<button data-mode2="${k}" aria-pressed="${st.mode === k}" title="${esc(MODES[k][1])}">${k} · ${esc(MODES[k][0])}</button>`).join('')}</span></span>
      ${st.mode === 'B' ? `<span>Demand outside the original square <span class="seg2">${Object.keys(GS.DEMAND).map(k => `<button data-dem="${k}" aria-pressed="${st.demand === k}">${esc(GS.DEMAND[k])}</button>`).join('')}</span></span>` : ''}</div>
    <p class="src" style="margin:8px 0 0">${esc(MODES[st.mode][1])}${st.mode === 'B' ? ` <b>Demand rule:</b> ${st.demand === 'hazard' ? 'outside the original square, expected need is counted only in cells where the model’s hazard term is non-zero (mapped hazard in or within ≈300 m of the cell). v6’s 3 % background floor is not extended to towns with no hazard evidence; residents there are still counted and reported.' : 'the v6 Belief State everywhere, including its 3 % background floor for every resident — over whole towns this creates large expected “need” with no hazard evidence.'}` : ''}</p>
    <div class="row" style="margin-top:10px"><button class="btn primary" data-su="run" ${st.busy ? 'disabled' : ''}>Run ${st.f}× (${st.mode})</button><button class="btn" data-su="prog" ${st.busy ? 'disabled' : ''} title="Expand step by step (0.5×) until the coverage target is met, no useful candidates remain, the ring adds no hazard, or the 5× limit is reached">Progressive exploration</button><span class="muted small" id="suBusy">${esc(st.busy || '')}</span></div>
    <div class="progress" id="suProg" style="margin-top:8px;${st.busy ? '' : 'visibility:hidden'}"><i style="width:${Math.round(st.prog * 100)}%"></i></div>${st.err ? `<p class="bad small">Last run failed: ${esc(st.err)}</p>` : ''}</div>
  ${cur ? results(cur, L1) : `<div class="card"><h3>2 · Results</h3><p class="muted">Run a level to compare it with the original search. Level 1 (the baseline) has ${f0(L1.sitesValid)} valid launch sites, ${L1.settlements} named settlements and places ${L1.placed} aerostats (${pc(L1.cov)} of expected need covered).</p></div>`}
  ${allTable(L1)}
  ${st.prog2 && st.prog2.sid === sc.id ? progTable(st.prog2) : ''}
  ${provenance()}`;
  if (cur) requestAnimationFrame(() => drawMap(cur));
}
function kc(k, v, d, s, better) { const cls = d == null ? '' : Math.abs(d.n) < 1e-9 ? 'eq' : (d.n > 0) === (better !== false) ? 'up' : 'dn'; return `<div class="kc"><span class="k">${k}</span><span class="v">${v}</span>${d ? `<span class="d ${cls}">${d.t}</span>` : ''}${s ? `<span class="s">${s}</span>` : ''}</div>`; }
const dlt = (a, b, fmt = f0) => ({ n: b - a, t: (b - a >= 0 ? '+' : '−') + fmt(Math.abs(b - a)) + ' vs Level 1' });
function results(cur, L1) {
  const o = cur.o, x = o.outc, cmp = GS.compare({ outc: L1 }, o), sameNodes = x.placed === L1.placed && Math.abs(x.cov - L1.cov) < 1e-6 && x.placedNew === 0;
  const verdict = cur.mode === 'A' ? (sameNodes ? `<b>No better deployment exists in the wider area for the people already expected.</b> ${f0(x.sitesValid - L1.sitesValid)} additional valid launch sites were evaluated by the full pipeline (feasibility, line of sight, link budget, coverage), but none covers the original Belief State better than the ${L1.placed} sites already chosen. Sites farther than about one camera footprint (${f0(Mo.footR(o.p, o.p.h))} m) outside the original square cannot see into it.` : `<b>The wider search changes the deployment.</b> ${x.placedNew} of ${x.placed} first-wave aerostats now stand on sites outside the original square; coverage ${pc(L1.cov)} → ${pc(x.cov)} with ${L1.placed} → ${x.placed} aerostats${x.met && !L1.met ? ' — the coverage target is now met' : ''}.`)
    : `<b>Covering the wider area with the same fleet:</b> expected need grows from ${f0(L1.demandTotal)} to ${f0(x.demandTotal)} people (ring +${f0(x.demandRing)}, ${cur.demand === 'hazard' ? 'hazard-linked' : 'identical incl. background floor'}). With the ${o.p.Kmax}-aerostat budget, coverage is ${pc(x.cov)}${x.met ? ' (target met)' : ` (target ${pc(x.tEff)} not met)`}; reaching the target would need <b>${x.needForTarget != null ? x.needForTarget : '> 600'}</b> aerostats (Level 1: ${L1.needForTarget}).`;
  const und = x.underserved.slice(0, 6), rs = x.ringSettlements;
  const nodes = o.nodes.map((n, i) => ({ i, e: GS.explain(o, i) })).filter(r => r.e.role === 'sense' && !r.e.replan);
  return `<div class="card"><h3>2 · What the ${cur.f}× search found <small>${esc(MODES[cur.mode][0])}${cur.mode === 'B' ? ' · ' + esc(GS.DEMAND[cur.demand]) : ''} · ${f1((cur.ms || x.ms) / 1000)} s · from run #${cur.run}</small></h3>
    <p style="margin:0 0 10px;font-size:13.5px;line-height:1.5">${verdict}</p>
    <div class="kgrid">${kc('Search area', f0(x.areaKm2) + ' km²', { n: x.areaKm2 - L1.areaKm2, t: '+' + f0(cmp.areaIncreasePct) + ' % vs Level 1' }, `Level 1: ${f0(L1.areaKm2)} km²`)}
      ${kc('Named settlements', f0(x.settlements), dlt(L1.settlements, x.settlements), `OSM places; ${x.settlementsCovered} inside camera coverage`)}
      ${kc('Valid launch sites', f0(x.sitesValid), dlt(L1.sitesValid, x.sitesValid), `${f0(x.candidatesRaw)} raw candidates screened; no cap`)}
      ${kc('Residents in area', f0(x.popTotal), dlt(L1.popTotal, x.popTotal), 'WorldPop 2020 (modelled residents)')}
      ${kc('Buildings', f0(x.buildings), dlt(L1.buildings, x.buildings), 'OSM + Open Buildings footprints')}
      ${kc('Roads beyond the square', f1(x.ringRoadsKm) + ' km', null, `${f0(x.ringBridges)} mapped bridges (OSM)`)}
      ${kc('Mapped hazard', f2(x.hazKm2) + ' km²', dlt(L1.hazKm2, x.hazKm2, f2), `derived from the same satellite scenes`)}
      ${kc('Aerostats placed', x.placed, dlt(L1.placed, x.placed), `${x.placedNew} on sites outside the original square`, false)}
      ${kc('Expected need covered', pc(x.cov), { n: x.cov - L1.cov, t: (x.cov - L1.cov >= 0 ? '+' : '−') + (Math.abs(x.cov - L1.cov) * 100).toFixed(1) + ' pts' }, `target ${pc(x.tEff)} · ${x.met ? 'met' : 'not met'}`)}
      ${kc('Aerostats for the target', x.needForTarget != null ? x.needForTarget : '> 600', x.needForTarget != null && L1.needForTarget != null ? dlt(L1.needForTarget, x.needForTarget) : null, 'without the fleet budget', false)}
      ${kc('Residents within view', f0(x.popInViewFinal), dlt(L1.popInViewFinal, x.popInViewFinal), 'inside final camera footprints (whole area)')}
      ${kc('Relays · linked', `${x.relays} · ${x.linked}/${x.nodes}`, null, 'backhaul to the same command post')}
      ${cur.mode === 'B' ? kc('Simulated survivors', f0(x.survivors), dlt(L1.survivors, x.survivors), `ring +${f0(x.ringSurvivors)} · synthetic`) : ''}
      ${kc('People found (sim)', pc(x.sim.detRate), { n: x.sim.detRate - L1.sim.detRate, t: (x.sim.detRate - L1.sim.detRate >= 0 ? '+' : '−') + (Math.abs(x.sim.detRate - L1.sim.detRate) * 100).toFixed(1) + ' pts' }, 'simulated detection rate')}</div></div>
  <div class="grid2"><div class="card"><h3>3 · Map of the search <small>hover for names</small></h3><canvas class="smap" id="suMap"></canvas><div class="searchkey" style="position:static;margin-top:8px;max-width:none;grid-template-columns:repeat(2,minmax(0,1fr));display:grid"><span class="row2"><i style="border-color:${COLS[1]}"></i>Original square (Level 1)</span><span class="row2"><i style="border-color:${COLS[2]};border-top-style:dashed"></i>Search boundary ${cur.f}×</span><span class="row2"><i class="dot" style="background:#9aa3ad"></i>Valid site, original list</span><span class="row2"><i class="dot" style="background:#2563c4"></i>New valid site</span><span class="row2"><i class="dot" style="background:#e0561f"></i>Level 1 aerostat</span><span class="row2"><i class="dot" style="background:#7a52c4"></i>${cur.f}× aerostat</span><span class="row2"><i class="dot" style="background:#c92a2a;opacity:.6"></i>Mapped hazard (derived)</span><span class="row2"><i class="dot" style="background:#d62878"></i>Underserved cluster</span></div><p class="src" id="suHover" style="min-height:18px;margin:6px 0 0"></p></div>
    <div class="card"><h3>4 · Underserved areas <small>demand not covered by the final fleet</small></h3>${und.length ? `<table class="t"><thead><tr><th>Near</th><th>Expected people</th><th>Residents</th><th>Why uncovered</th></tr></thead><tbody>${und.map(u => `<tr data-x="${u.x}" data-y="${u.y}"><td>${esc(u.near || '—')}<br><span class="muted small">${u.nearD != null ? f1(u.nearD / 1000) + ' km' : ''}${u.ring ? ' · outside original' : ''}</span></td><td class="mono">${f1(u.lam)}</td><td class="mono">${f0(u.res)}</td><td class="small">${esc(u.why)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Every cell with expected need is inside camera coverage.</p>'}
      <h3 style="margin-top:14px">New settlements in the wider area <small>${rs.length} named places (OSM)</small></h3>${rs.length ? `<div class="tw" style="max-height:220px;overflow:auto"><table class="t"><thead><tr><th>Name</th><th>Type</th><th>From incident</th><th>In view</th></tr></thead><tbody>${rs.slice().sort((a, b) => Math.hypot(a.x - o.M.incident[0], a.y - o.M.incident[1]) - Math.hypot(b.x - o.M.incident[0], b.y - o.M.incident[1])).slice(0, 60).map(p => `<tr><td>${esc(p.name)}</td><td class="small">${esc(p.kind)}</td><td class="mono">${f1(Math.hypot(p.x - o.M.incident[0], p.y - o.M.incident[1]) / 1000)} km</td><td>${p.covered ? '✓' : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No additional named places in this extent.</p>'}</div></div>
  <div class="card"><h3>5 · Why each aerostat is where it is <small>${cur.f}× run · first wave</small></h3><div class="tw"><table class="t"><thead><tr><th>Aerostat</th><th>Pick</th><th>Marginal gain</th><th>Serves</th><th>Constraints satisfied</th><th>Alternatives considered</th><th>Overlap</th><th>If unavailable</th></tr></thead><tbody>${nodes.map(({ e }) => `<tr data-x="${e.x}" data-y="${e.y}"><td><b>${e.id}</b>${e.newSite ? ' <span class="tierchip derived">new site</span>' : ''}<br><span class="mono small">${e.lat.toFixed(4)}°N ${e.lon.toFixed(4)}°E</span></td><td class="mono">#${e.step}</td><td class="mono">+${pc(e.gain)}</td><td class="small">${f0(e.cells)} cells · ${f1(e.demand)} expected people · ${f0(e.residents)} residents${e.places.length ? '<br>' + esc(e.places.slice(0, 3).join(', ')) : ''}</td><td class="small">${esc(C.CLS_NAME[e.cls])}, ${Math.round(e.slopeDeg)}° slope; ${e.linked ? `${e.hop}-hop link, ${e.marginDb != null ? (e.marginDb >= 0 ? '+' : '') + f1(e.marginDb) + ' dB' : ''}` : 'no link'}</td><td class="small">${e.alts.length ? e.alts.map(a => `+${pc(a.gain)} at ${f1(a.d / 1000)} km`).join('<br>') : '—'}</td><td class="mono">${pc(e.overlapShare)}</td><td class="mono">−${pc(e.loo || 0)}</td></tr>`).join('')}</tbody></table></div><p class="src" style="margin:8px 0 0">Pick = order chosen by the greedy set cover; gain = share of weighted expected need it added; alternatives = the next-best sites at that step; overlap = share of its cells also seen by another aerostat; “if unavailable” = coverage lost without it (final fleet).</p></div>`;
}
function allTable(L1) {
  const rows = Object.values(SU.results).filter(r => r.sid === sid()).sort((a, b) => a.f - b.f || a.mode.localeCompare(b.mode));
  if (!rows.length) return ''; const R = [{ f: 1, mode: '—', o: { outc: L1 } }].concat(rows);
  return `<div class="card"><h3>6 · All computed levels <small>identical model, fleet budget and command post</small></h3><div class="tw"><table class="t"><thead><tr><th>Extent</th><th>Compare</th><th>Area km²</th><th>Settlements</th><th>Valid sites</th><th>Residents</th><th>Hazard km²</th><th>Placed</th><th>New-site picks</th><th>Coverage</th><th>Need for target</th><th>Relays</th><th>Found (sim)</th><th>Time</th></tr></thead><tbody>${R.map(r => { const x = r.o.outc; return `<tr><td class="mono">${r.f}×</td><td>${r.mode === '—' ? 'baseline' : r.mode + (r.mode === 'B' ? ' · ' + (r.demand === 'hazard' ? 'hazard-linked' : 'identical') : '')}</td><td class="mono">${f0(x.areaKm2)}</td><td class="mono">${x.settlements}</td><td class="mono">${f0(x.sitesValid)}</td><td class="mono">${f0(x.popTotal)}</td><td class="mono">${f2(x.hazKm2)}</td><td class="mono">${x.placed}</td><td class="mono">${x.placedNew || 0}</td><td class="mono">${pc(x.cov)}</td><td class="mono">${x.needForTarget ?? '>600'}</td><td class="mono">${x.relays}</td><td class="mono">${pc(x.sim.detRate)}</td><td class="mono">${r.ms ? f1(r.ms / 1000) + ' s' : '—'}</td></tr>`; }).join('')}</tbody></table></div></div>`;
}
function progTable(p) {
  return `<div class="card"><h3>Progressive exploration <small>${p.mode === 'A' ? 'same people' : 'wider area'} · steps of 0.5×</small></h3><p style="margin:0 0 8px"><b>Stopped:</b> ${esc(p.r.stop)}</p><div class="tw"><table class="t"><thead><tr><th>Extent</th><th>Valid sites</th><th>Placed</th><th>Coverage</th><th>Target met</th><th>Ring hazard km²</th><th>Exposed residents in ring</th></tr></thead><tbody>${p.r.rows.map(r => `<tr><td class="mono">${r.f}×</td><td class="mono">${f0(r.o.sitesValid)}</td><td class="mono">${r.o.placed}</td><td class="mono">${pc(r.o.cov)}</td><td>${r.o.met ? 'yes' : 'no'}</td><td class="mono">${f2(r.o.hazRingKm2 || 0)}</td><td class="mono">${f0(r.o.exposedRing || 0)}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function provenance() {
  const X = GS.packs[sid()]; if (!X) return `<div class="card"><h3>Data for the wider area</h3><p class="muted small" style="margin:0">Loaded when you run a level (≈5–12 MB per scenario, compressed). Every layer is listed here with its source, method and its check against the original data.</p></div>`;
  const L = X.meta.layers, nm = { dem: 'Elevation (Copernicus DEM GLO-30)', landcover: 'Land cover (ESA WorldCover 2021)', pop_belief: 'Residents, belief grid (WorldPop 2020)', pop_grid: 'Residents, node grid (WorldPop 2020)', osm: 'Roads, rivers, places (OpenStreetMap)', buildings_ring: 'Buildings outside the square (OSM + Open Buildings)', hazard_observed: 'Observed hazard (derived)', hazard_water_pre: 'Water before the flood (S1, derived)', hazard_water_post: 'Water after the flood (S1, derived)', hazard_jrc_occurrence: 'JRC surface-water occurrence', hazard_cems: 'CEMS EMSR927 grid (AOI01 + AOI02)', cems_aoi01: 'CEMS EMSR927 AOI01 Syapru Besi grading' };
  const val = v => { if (!v) return '—'; if (v.iou != null) return `IoU ${f2(v.iou)} · precision ${f2(v.precision_vs_v6)} · recall ${f2(v.recall_vs_v6)}`; if (v.mean_abs_diff_m != null) return `mean |Δ| ${f2(v.mean_abs_diff_m)} m (co-registration ${v.coregistration_shift_m.join(', ')} m)`; if (v.agreement_vs_v6_aoi != null) return `${(v.agreement_vs_v6_aoi * 100).toFixed(1)} % of nodes agree`; if (v.aoi_belief_new != null) return `original square ${f0(v.aoi_belief_new)} vs v6 ${f0(v.aoi_belief_v6)}`; if (v.mean_abs_diff_pct != null) return `mean |Δ| ${f2(v.mean_abs_diff_pct)} %`; return '—'; };
  return `<div class="card"><h3>7 · Data for the wider area <small>added on top of the v6 data; inside the original square the v6 values are used unchanged</small></h3><div class="tw"><table class="t"><thead><tr><th>Layer</th><th>Tier</th><th>Method</th><th>Check against v6 (original square)</th><th>Size</th></tr></thead><tbody>${Object.keys(L).map(k => { const l = L[k], tier = l.tier || ({ dem: 'verified', landcover: 'verified', pop_belief: 'modelled', pop_grid: 'modelled', osm: 'verified', buildings_ring: 'derived' }[k] || 'derived'); return `<tr><td><b>${esc(nm[k] || k)}</b>${l.count != null ? `<br><span class="muted small">${f0(l.count)} features</span>` : ''}${l.counts ? `<br><span class="muted small">${Object.entries(l.counts).map(([a, b]) => f0(b) + ' ' + a).join(' · ')}</span>` : ''}</td><td><span class="tierchip ${tier}">${tier}</span></td><td class="small">${esc((l.method || '').slice(0, 260))}${(l.method || '').length > 260 ? '…' : ''}${l.source_urls ? `<br>${l.source_urls.slice(0, 2).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\//, '').slice(0, 60))}</a>`).join('<br>')}` : ''}</td><td class="small">${esc(val(l.validation_vs_v6_aoi))}</td><td class="mono small">${l.bytes_gz ? f1(l.bytes_gz / 1e6) + ' MB' : ''}</td></tr>`; }).join('')}</tbody></table></div><p class="src" style="margin:8px 0 0">Built ${esc(String(X.meta.built_at || '').slice(0, 10))} · extent ${X.meta.factor}× · ${X.meta.G}×${X.meta.G} nodes at ${f1(X.meta.cell)} m · CRS ${esc(X.meta.crs)}. Hazard extents outside the original square are re-derived with the documented v4 rule on the same acquisitions — derived indicators, not official maps.</p></div>`;
}

/* ---------- 2D map ---------- */
function drawMap(cur) {
  const cv = $('#suMap'); if (!cv) return; const o = cur.o, base = app.out, dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight || W; cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const S = o.T.S, sx = x => (x + S / 2) / S * W, sy = y => (1 - (y + S / 2) / S) * H, cs = getComputedStyle(document.documentElement);
  g.fillStyle = cs.getPropertyValue('--panel').trim() || '#f6f7f9'; g.fillRect(0, 0, W, H);
  // residents (WorldPop) as a light density underlay
  const pb = o.M.popB; if (pb) { const n = Math.round(Math.sqrt(pb.length)), c = S / n, mx = Math.max(1, ...Array.from(pb).filter(v => v > 0).sort((a, b) => b - a).slice(0, 30)); for (let k = 0; k < pb.length; k++) { const v = pb[k]; if (!(v > 0.5)) continue; const x = -S / 2 + (k % n) * c, y = -S / 2 + Math.floor(k / n) * c; g.fillStyle = `rgba(37,99,196,${Math.min(0.35, 0.05 + 0.3 * Math.sqrt(v / mx))})`; g.fillRect(sx(x), sy(y + c), Math.ceil(c / S * W) + 0.5, Math.ceil(c / S * H) + 0.5); } }
  // hazard
  const hm = o.M.hazMask, T = o.T; if (hm) { const st = Math.max(1, Math.round(T.G / 380)); g.fillStyle = 'rgba(201,42,42,.55)'; for (let j = 0; j < T.G; j += st) for (let i = 0; i < T.G; i += st) if (hm[j * T.G + i]) g.fillRect(sx(-S / 2 + i * T.cell), sy(-S / 2 + j * T.cell), Math.max(1.2, st * T.cell / S * W), Math.max(1.2, st * T.cell / S * H)); }
  // boundaries of all levels within this extent
  const h0 = base.T.S / 2; GS.LEVELS.forEach(L => { const h = h0 * L.f; if (h > S / 2 + 1) return; g.strokeStyle = COLS[L.id]; g.lineWidth = L.id === 1 ? 2 : 1.4; g.setLineDash(L.id === 1 ? [] : [6, 4]); g.strokeRect(sx(-h), sy(h), sx(h) - sx(-h), sy(-h) - sy(h)); g.setLineDash([]); g.fillStyle = COLS[L.id]; g.font = '600 11px IBM Plex Sans,system-ui'; g.fillText(`${L.f}×`, sx(-h) + 4, sy(h) + 13); });
  // candidates
  const dots = (pts, col, r) => { g.fillStyle = col; for (const [x, y] of pts) { g.beginPath(); g.arc(sx(x), sy(y), r, 0, 6.283); g.fill(); } };
  const out = q => Math.abs(q.x) > h0 || Math.abs(q.y) > h0; dots(o.sites.filter(q => !out(q)).map(q => [q.x, q.y]), 'rgba(120,128,138,.45)', 1.3); dots(o.sites.filter(out).map(q => [q.x, q.y]), 'rgba(37,99,196,.55)', 1.3);
  // settlements
  (o.M.places || []).forEach(p => { g.fillStyle = p.ring ? '#15181d' : '#545d68'; g.fillRect(sx(p.x) - 1.5, sy(p.y) - 1.5, 3, 3); });
  // underserved
  o.outc.underserved.forEach(u => { g.strokeStyle = '#d62878'; g.lineWidth = 1.5; g.beginPath(); g.arc(sx(u.x), sy(u.y), 4 + Math.sqrt(u.lam) * 3, 0, 6.283); g.stroke(); });
  // aerostats with footprints
  const r0 = Mo.footR(o.p, o.p.h), node = (st, col, ring) => { g.strokeStyle = col; g.globalAlpha = 0.7; g.lineWidth = 1; g.beginPath(); g.arc(sx(st.x), sy(st.y), r0 / S * W, 0, 6.283); g.stroke(); g.globalAlpha = 1; g.fillStyle = col; g.beginPath(); g.arc(sx(st.x), sy(st.y), ring ? 4.5 : 3.5, 0, 6.283); g.fill(); };
  base.nodes.forEach(n => node(base.sites[n.site], '#e0561f')); o.nodes.forEach(n => node(o.sites[n.site], '#7a52c4', true));
  // command post
  g.fillStyle = '#15181d'; g.fillRect(sx(o.M.icp[0]) - 4, sy(o.M.icp[1]) - 4, 8, 8);
  cv.onmousemove = e => { const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / W * S - S / 2, y = (1 - (e.clientY - r.top) / H) * S - S / 2; let best = null, bd = (S / W * 10) ** 2;
    (o.M.places || []).forEach(p => { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = `${p.name} (${p.kind}${p.ring ? ', outside the original square' : ''})`; } });
    o.nodes.forEach(n => { const s = o.sites[n.site], d = (s.x - x) ** 2 + (s.y - y) ** 2; if (d < bd) { bd = d; best = `${n.id} — ${cur.f}× aerostat${out(s) ? ' on a new site' : ''}`; } });
    $('#suHover').textContent = best || `${f1(x / 1000)} km E, ${f1(y / 1000)} km N of the centre`; };
}

/* ---------- 3D overlay ---------- */
let OV = null;
function clearOverlay() { if (OV && OV.parent) OV.parent.remove(OV); OV = null; }
function buildOverlay() {
  clearOverlay(); const cur = SU.cur; if (!cur || cur.sid !== sid() || !E.world) return; const o = cur.o, base = app.out, h0 = base.T.S / 2, g = new THREE.Group(); g.name = 'searchOverlay';
  GS.LEVELS.forEach(L => { const h = h0 * L.f; if (L.f > cur.f + 1e-9 && L.id !== 1) return; const pts = [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]]; g.add(E.drapeLine(pts, { color: new THREE.Color(COLS[L.id]).getHex(), width: L.id === 1 ? 3 : 2.2, offset: 14, dashed: L.id !== 1, dash: 14, gap: 8, step: Math.max(40, h / 60) })); });
  if (!GS.LEVELS.some(l => l.f === cur.f)) { const h = h0 * cur.f; g.add(E.drapeLine([[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]], { color: 0x2563c4, width: 2.2, offset: 14, dashed: true, dash: 14, gap: 8, step: Math.max(40, h / 60) })); }
  // mapped hazard outside the original square (derived from the same satellite scenes), drawn as red points
  if (o.M.hazMask) { const T = o.T, hm = o.M.hazMask, st = Math.max(1, Math.round(T.G / 560)), hp = []; for (let j = 0; j < T.G; j += st) for (let i = 0; i < T.G; i += st) { if (!hm[j * T.G + i]) continue; const x = -T.S / 2 + i * T.cell, y = -T.S / 2 + j * T.cell; if (Math.abs(x) <= h0 && Math.abs(y) <= h0) continue; const q = E.wp(x, y, E.hp(3)); hp.push(q.x, q.y, q.z); }
    if (hp.length) { const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3)); const hpts = new THREE.Points(hg, new THREE.PointsMaterial({ color: 0xc92a2a, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.8, depthWrite: false })); hpts.renderOrder = 5; g.add(hpts); } }
  const nw = o.sites.filter(q => Math.abs(q.x) > h0 || Math.abs(q.y) > h0), pos = new Float32Array(nw.length * 3); nw.forEach((q, i) => { const p = E.wp(q.x, q.y, E.hp(6)); pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; });
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); const pm = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x2563c4, size: 4.5, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false })); pm.renderOrder = 6; g.add(pm);
  const pin = (st, col) => { const a = E.wp(st.x, st.y, 0), b = E.wp(st.x, st.y, E.hp(o.p.h)); const lg = new THREE.BufferGeometry().setFromPoints([a, b]); g.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color: col }))); const m = new THREE.Mesh(new THREE.SphereGeometry(E.hp(38), 14, 10), new THREE.MeshBasicMaterial({ color: col })); m.position.copy(b); g.add(m);
    const r0 = Mo.footR(o.p, o.p.h), rp = []; for (let i = 0; i <= 48; i++) { const t = i / 48 * Math.PI * 2; rp.push([st.x + Math.cos(t) * r0, st.y + Math.sin(t) * r0]); } g.add(E.drapeLine(rp, { color: col, width: 1.6, offset: 8, step: r0 / 12 })); };
  let pinned = 0; o.nodes.forEach(n => { const st = o.sites[n.site]; if (Math.abs(st.x) > h0 || Math.abs(st.y) > h0 || cur.mode === 'B') { pin(st, 0x7a52c4); pinned++; } });
  if (o.M.cemsRing && o.M.cemsRing.facilities) o.M.cemsRing.facilities.forEach(f => pin({ x: f.x, y: f.y }, 0xc92a2a));
  E.world.root.add(g); OV = g; E.kick(1500);
  const k = $('#searchKey'); k.hidden = false; k.innerHTML = `<b>Search area · ${cur.f}× ${cur.mode === 'A' ? 'same people' : 'wider area'}</b><span class="row2"><i style="border-color:${COLS[1]}"></i>Original square</span><span class="row2"><i style="border-color:${COLS[2]};border-top-style:dashed"></i>Wider levels</span><span class="row2"><i class="dot" style="background:#2563c4"></i>${f0(nw.length)} new valid launch sites</span><span class="row2"><i class="dot" style="background:#7a52c4"></i>${cur.mode === 'A' ? 'Aerostats on new sites' : 'Wider-area fleet'} (${pinned}${cur.mode === 'A' && !pinned ? ' — the original sites remain best' : ''})</span><span class="row2"><i class="dot" style="background:#c92a2a;opacity:.8"></i>Mapped hazard outside the square (derived)</span>${o.M.cemsRing ? '<span class="row2"><i class="dot" style="background:#c92a2a"></i>Pin: CEMS destroyed facility (verified)</span>' : ''}<button class="btn sm" data-sk="wide">View whole area</button><button class="btn ghost sm" data-sk="off">Hide</button>`;
}
SU.toggleOverlay = function () { const on = !SU.st.overlay; if (on && !SU.cur) { app.toast('Run a wider search level first (Geographic search page)'); app.showPage('search'); return; } SU.st.overlay = on; $('#vSearch').setAttribute('aria-pressed', on); if (on) { buildOverlay(); E.setWide(true); } else { clearOverlay(); $('#searchKey').hidden = true; E.setWide(false); } };
SU.flyWide = function () { const cur = SU.cur; if (!cur) return; if (!SU.st.overlay) SU.toggleOverlay(); const h = app.out.T.S / 2 * cur.f, tgt = E.wp(0, 0, 0), d = h / 10; E.flyPose(new THREE.Vector3(tgt.x + d * 0.1, tgt.y + d * 3.3, tgt.z + d * 1.25), tgt, 1600); };
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-sk]'); if (!b) return; if (b.dataset.sk === 'wide') SU.flyWide(); if (b.dataset.sk === 'off') SU.toggleOverlay(); });

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest && e.target.closest('#searchBody button, #searchBody tr[data-x]'); if (!t) return; const st = SU.st;
  if (t.dataset.f) { st.f = +t.dataset.f; paint(); return; }
  if (t.dataset.mode2) { st.mode = t.dataset.mode2; paint(); return; }
  if (t.dataset.dem) { st.demand = t.dataset.dem; paint(); return; }
  if (t.dataset.su === 'run') { SU.runLevel(st.f, st.mode, st.demand); return; }
  if (t.dataset.su === 'prog') { SU.progressive(); return; }
  if (t.dataset.su === 'toSim') { app.showPage('sim'); return; }
  if (t.dataset.su === 'show3d') { app.showPage('sim'); setTimeout(() => SU.flyWide(), 120); return; }
  if (t.dataset.su === 'export') { const r = SU.cur, L1 = GS.outcomesBase(app.out); app.copyText(JSON.stringify({ scenario: app.out.sc.name, run: app.run.id, settings: app.out.p, level1: strip(L1), level: { factor: r.f, mode: r.mode, demandRule: r.mode === 'B' ? r.demand : null, outcomes: strip(r.o.outc), comparison: GS.compare({ outc: L1 }, r.o) }, data: GS.packs[sid()] ? GS.packs[sid()].meta : null }, null, 1), 'Comparison JSON'); return; }
  if (t.dataset.x) { const m = $('#suHover'); if (m) m.textContent = `Centre at ${f1(+t.dataset.x / 1000)} km E, ${f1(+t.dataset.y / 1000)} km N — open the 3D map and turn on “Search area” to see it in context.`; }
});
document.addEventListener('input', e => { if (e.target.id === 'suF') { SU.st.f = +e.target.value; const v = $('#suFv'); if (v) v.textContent = SU.st.f + '×'; } });
document.addEventListener('change', e => { if (e.target.id === 'suF') paint(); });
const strip = x => JSON.parse(JSON.stringify(x, (k, v) => (k === 'underserved' ? v.map(u => ({ near: u.near, lam: u.lam, res: u.res, x: u.x, y: u.y, why: u.why, ring: u.ring })) : v)));
// a new 3D world (scenario switch or rebuild): the old overlay went with the old scene graph
SU.onWorld = function () { OV = null; const k = $('#searchKey'); if (SU.st.overlay && SU.cur && SU.cur.sid === sid()) { buildOverlay(); E.setWide(true); } else { SU.st.overlay = false; if (k) k.hidden = true; $('#vSearch').setAttribute('aria-pressed', false); } if (app.page === 'search') paint(); };
$('#vSearch').disabled = false;
})(window.ARES);
