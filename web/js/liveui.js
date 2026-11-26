/* ARES v8 — live inputs inside the v7 console (gods-eye-view features shown the v7 way).
   - Inputs tab: each real-world input with its source, date and effect; switch on/off and re-run
   - Live & tracking layers in the Layers tab, drawn in the 3D scene: airspace clearance, road routes, low-level air traffic,
     evidence points, alerts, wind
   - stage panel: what the live inputs changed at stages 1–8 (9–11 are unchanged: they belong to the hardware)
   - Briefing: deployment-order exports and a draft obstruction notice
   Published console: REPLAY inputs come from data/<scenario>/v8/inputs.json (real archived data, frozen).
   Local app (served by ARES Planner): the same console fetches LIVE inputs from the local server and can plan anywhere in India. */
(function (A) {
'use strict';
const C = A.core, Mo = A.model, L = A.live, $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f0 = v => v == null || isNaN(v) ? '—' : Math.round(v).toLocaleString('en-IN'), f1 = v => v == null || isNaN(v) ? '—' : (+v).toFixed(1), pc = v => v == null || isNaN(v) ? '—' : (100 * v).toFixed(1) + '%';
const IST = t => t ? new Date(t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST' : '—';
const LU = A.liveui = { snaps: {}, use: Object.assign({}, L.REC), zones: [], icp: null, local: false, mode: 'replay', liveMeta: null };
const GROUP = { alerts: 'Stage 1 · detect', weather: 'Stages 5–7 · weather', robust: 'Stages 5–7 · weather', radar: 'Stages 5–7 · weather', imaging: 'Stages 2 & 8 · satellites', occupancy: 'Stage 3 · people', facilities: 'Stage 3 · people', popfusion: 'Stage 3 · people', airspace: 'Stage 5 · airspace & traffic', aircraft: 'Stage 5 · airspace & traffic', gnss: 'Stages 5–8 · positioning', heights: 'Stages 6–7 · placement', fairness: 'Stages 6–7 · placement', routing: 'Stage 8 · deployment', constraints: 'Operator' };

/* ---------- inputs: archived snapshot (published) or live (local app) ---------- */
(async () => { try { const r = await fetch('/api/meta', { cache: 'no-store' }); if (r.ok) { LU.liveMeta = await r.json(); LU.local = true; } } catch (e) {} })();
const b64f32 = t => { const b = atob(t.trim()), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new Float32Array(u.buffer); };
LU.prepare = async (sc) => {
  const k = sc.id + '|' + LU.mode; if (LU.snaps[k]) return LU.snaps[k];
  let snap = null, hrsl = null;
  try { snap = LU.local && LU.mode === 'live' ? await (await fetch(`/api/inputs/${encodeURIComponent(sc.id)}?mode=live`)).json() : await (await fetch(A.pack.base + sc.id + '/v8/inputs.json')).json(); } catch (e) { snap = null; }
  try { const r = await fetch(A.pack.base + sc.id + '/population/hrsl_belief.f32.b64.txt'); if (r.ok) hrsl = b64f32(await r.text()); } catch (e) {}
  return (LU.snaps[k] = { snap, hrsl });
};
LU.active = () => Object.values(LU.use).some(Boolean) || LU.zones.length > 0 || !!LU.icp;
LU.key = () => LU.mode + JSON.stringify(LU.use) + JSON.stringify(LU.zones) + JSON.stringify(LU.icp);
LU.ctx = (sc, built) => {
  const s = LU.snaps[sc.id + '|' + LU.mode] || {}, sn = s.snap || {};
  return { use: Object.assign({}, LU.use, { constraints: LU.use.constraints || LU.zones.length > 0 || !!LU.icp }), eventTime: sn.eventTime || (built.M.pack && built.M.pack.aoi.event), alerts: sn.alerts, weather: sn.weather && !sn.weather.error ? sn.weather : null, imaging: sn.imaging, imagery: sn.imaging, airports: sn.airports && sn.airports.items, gnss: sn.gnss, aircraft: sn.aircraft, radar: sn.radar,
    routesXY: !LU.icp && sn.routes ? sn.routes.byXY : null, popAlt: s.hrsl && !sc.live ? { cells: s.hrsl, source: 'Meta/CIESIN HRSL v1.5' } : null, zones: LU.zones, icp: LU.icp, teams: 2 };
};
LU.run = (sc, params, built) => { const out = L.runFull(sc, params, built, LU.ctx(sc, built)), s = LU.snaps[sc.id + '|' + LU.mode] || {}, sn = s.snap || {};
  out.liveSnap = sn; if (sn.evidence) out.evidence = { meta: sn.evidence, points: L.evidenceCheck(out, sn.evidence.points) };
  const all = out.nodes; out.nodes = all.slice(0, out.preNodes); /* the order covers what is raised before sensing; stage-10 replanning modules come later */
  try { out.order = L.deploymentOrder(out, { mode: LU.mode, eventTime: sn.eventTime, inputs: null }); } finally { out.nodes = all; } out.order.obstruction_notice = notice(out.order); return out; };
function notice(o) { return { title: `DRAFT obstruction notice — ARES tethered aerostats, ${o.incident.name}`, text: ['DRAFT — not filed. Tethered balloons with tethers to the ground. Avoid within 500 m laterally.'].concat(o.modules.map(m => `${m.id}  ${m.tether_point.lat.toFixed(5)}N ${m.tether_point.lon.toFixed(5)}E  top ${Math.round(m.tether_point.ground_elev_m + m.height_m + 10)} m AMSL (${m.height_m + 10} m AGL incl. margin), from ${m.raise_at ? IST(m.raise_at) : 'T+' + m.eta_min + ' min'}`), [`Command post ${o.command_post.lat.toFixed(5)}N ${o.command_post.lon.toFixed(5)}E.`]).join('\n') }; }

/* ---------- what each input did in this run (one line each) ---------- */
function status(o, k) {
  const sn = o.liveSnap || {}, st = o.steps, on = o.use && o.use[k];
  if (!on) return { s: 'off', t: 'Off — v7 behaviour' };
  switch (k) {
    case 'alerts': { const a = sn.alerts; if (!a || a.error) return { s: 'na', t: 'No alert data' }; const tr = a.trigger; return { s: 'ok', t: tr ? `Trigger: ${tr.feed} ${tr.type || ''} — ${tr.name || tr.place || ''} · ${IST(tr.time)}` : `No alert within range ±2 days · checked ${(a.checked || []).join(', ')}`, w: (a.unavailable || []).join(' · ') }; }
    case 'weather': { const w = o.wx; if (!w) return { s: 'na', t: 'Weather not available' }; return { s: 'ok', t: `${w.source} · ${w.hours.length} h · wind @100 m median ${f1(w.nominal.v100)} / P90 ${f1(w.adverse.v100)} m/s · cloud base median ${w.nominal.cloudBase == null ? 'not limiting' : f0(w.nominal.cloudBase) + ' m'} · drift ${o.p.drift} m` }; }
    case 'robust': { const op = st.optimise; return op.holdShare ? { s: op.budgetLimited ? 'warn' : 'ok', t: `Target holds in ${pc(op.shareOfTimeMet)} of hours (rule ≥ ${pc(op.holdShare)})${op.budgetLimited ? ' — fleet limit reached' : ''}` } : { s: 'ok', t: 'Single condition' }; }
    case 'radar': return sn.radar ? { s: 'ok', t: `${sn.radar.rainNow ? 'Rain' : 'No rain'} on radar at ${IST(sn.radar.frameTime)}` } : { s: 'na', t: 'Live only — radar frames are kept for 2 hours' };
    case 'imaging': { const im = sn.imaging; if (!im || !im.next) return { s: 'na', t: 'No catalogue data' }; const r = im.next.radar, op = im.next.optical; return { s: 'ok', t: `Next radar pass ${r ? '+' + r.hoursAfterEvent + ' h (' + r.platform + ')' : '—'} · next optical ${op ? '+' + op.hoursAfterEvent + ' h' : '—'}`, w: [r && r.errorH != null ? `radar prediction error ${r.errorH} h` : '', op && op.errorH != null ? `optical prediction error ${op.errorH} h` : ''].filter(Boolean).join(' · ') }; }
    case 'occupancy': { const oc = st.belief.occupancy; return oc ? { s: 'ok', t: `Local hour ${f1(oc.hourLocal)} · ${f0(oc.moved)} people shifted between homes and day-time buildings` } : { s: 'na', t: 'No event time' }; }
    case 'facilities': { const fa = st.belief.facilities; return fa ? { s: 'ok', t: `${fa.count} hospitals / schools / colleges mapped · ${fa.raised} cells raised to top priority` } : { s: 'na', t: '—' }; }
    case 'popfusion': { const pf = st.belief.population; return pf ? { s: 'warn', t: `WorldPop ${f0(pf.worldpop)} vs HRSL ${f0(pf.hrsl)} residents · ${pf.cellsDisagree} cells disagree > 60 % — sensitivity, not a default` } : { s: 'na', t: 'HRSL layer not available' }; }
    case 'airspace': { const z = o.airspace || []; const n = st.sites.rejected.filter(r => /^Airspace/.test(r.why)).length; return { s: 'ok', t: z.length ? `${z.map(a => `${a.name} ${f1(a.distKm)} km`).join(', ')} · ${n} launch sites removed` : 'No airfield or heliport within reach' }; }
    case 'aircraft': { if (!sn.aircraft) return { s: 'na', t: 'Live only — no free archive of past aircraft positions' }; const n = st.sites.rejected.filter(r => /^Low-level air traffic/.test(r.why)).length; return { s: 'ok', t: `${sn.aircraft.items.length} aircraft within 40 km (${sn.aircraft.source}) · ${(o.aircraft || []).length} low-level tracks · ${n} sites removed` }; }
    case 'gnss': { const g = o.inputs.gnss; return g ? { s: g.driftAdded ? 'warn' : 'ok', t: `GPS jamming ${g.jamShare == null ? 'no data' : pc(g.jamShare)} of aircraft · Kp max ${f1(g.kpMax)} · drift +${g.driftAdded} m` } : { s: 'na', t: 'No GNSS data' }; }
    case 'heights': { const hs = [...new Set(o.nodes.filter(n => !n.replan).map(n => n.h))].sort((a, b) => a - b); return { s: 'ok', t: `Heights used: ${hs.join(' / ')} m (of ${st.coverage.heights.join(', ')})` }; }
    case 'fairness': { const fr = st.optimise.fair; return fr ? { s: fr.some(x => x.share < 0.5 && !x.unreachable) ? 'warn' : 'ok', t: `${fr.length} settlements · ${fr.added.length ? 'modules added for ' + fr.added.join(', ') : 'none needed a module of its own'}` } : { s: 'na', t: 'No named settlements' }; }
    case 'routing': { const ns = o.nodes.filter(n => !n.replan); const road = ns.filter(n => /OSRM/.test(n.travelSrc || '')).length, cut = ns.filter(n => /cut by hazard/.test(n.travelSrc || '')).length; return { s: 'ok', t: `${road} by road (OSRM) · ${cut} re-routed around the hazard · last module up at ${f0(Math.max(...ns.map(n => n.etaHeld ?? n.eta)))} min` }; }
    case 'constraints': return { s: LU.zones.length || LU.icp ? 'ok' : 'na', t: LU.zones.length || LU.icp ? `${LU.zones.length} zone(s)${LU.icp ? ' + command post' : ''}` : 'No operator zones drawn' };
  }
  return { s: 'na', t: '' };
}
LU.statusOf = status;

/* ---------- Inputs tab ---------- */
LU.side = app => {
  const o = app.out, sn = o.liveSnap || {}, groups = {};
  Object.keys(L.FACTORS).forEach(k => { (groups[GROUP[k]] = groups[GROUP[k]] || []).push(k); });
  const modeBox = `<div class="sec"><div class="stagehead"><p class="eyebrow">Real-world inputs</p><h3>${LU.mode === 'live' ? 'Live feeds (local app)' : 'Archived inputs for ' + esc(IST(sn.eventTime))}</h3></div>
    <p class="src">${o.v8 ? `Stages 1–8 use these inputs; stages 9–11 are unchanged (hardware). With every input off the run is identical to v7.` : `This run is the v7 model (no inputs on).`} ${LU.mode === 'replay' ? 'Replay uses the real data recorded for the event date (ERA5 weather, Sentinel catalogue, GDACS/USGS, GPS-jamming map, Kp, OurAirports, OSRM routes).' : ''}</p>
    ${LU.local ? `<div class="row"><button class="btn sm ${LU.mode === 'replay' ? 'primary' : ''}" data-v8="mode" data-m="replay">Replay (event date)</button><button class="btn sm ${LU.mode === 'live' ? 'primary' : ''}" data-v8="mode" data-m="live">Live (now)</button></div>` : ''}
    <div class="row"><button class="btn sm" data-v8="preset" data-p="rec">Recommended</button><button class="btn sm" data-v8="preset" data-p="off">All off (= v7)</button><button class="btn primary sm" data-v8="rerun">Re-run with these inputs</button></div></div>`;
  const rows = Object.entries(groups).map(([g, ks]) => `<div class="sec"><h4>${esc(g)}</h4>${ks.map(k => { const s = status(o, k); return `<label class="v8in ${s.s}"><input type="checkbox" data-v8="use" data-k="${k}" ${LU.use[k] ? 'checked' : ''}><span><b>${esc(k)}</b> <small>${esc(L.FACTORS[k])}</small><em>${esc(s.t)}</em>${s.w ? `<em class="w">${esc(s.w)}</em>` : ''}</span></label>`; }).join('')}</div>`).join('');
  const op = o.steps.optimise, tr = op.tradeoff;
  const chart = tr ? `<div class="sec"><h4>Modules vs reliability <small>share of hours the target holds</small></h4><div class="v8bars">${tr.map(t => `<i style="height:${Math.max(3, t.share * 100)}%" class="${t.share >= (op.holdShare || .8) ? 'ok' : ''}" title="${t.modules} modules: ${pc(t.share)} of hours"></i>`).join('')}</div><p class="src">Needed for 50 / 80 / 90 / 100 % of hours: <b>${['50%', '80%', '90%', '100%'].map(k => op.modulesFor[k] ?? '>' + tr.length).join(' / ')}</b> modules.</p></div>` : '';
  const zones = `<div class="sec"><h4>Operator zones <small>gods-eye-view draw tool → planner rules</small></h4><p class="src">Draw on the map, then re-run. No-go removes launch sites; must-cover triples the weight of the area; command post moves the team start.</p>
    <div class="row"><button class="btn sm ${LU.drawing && LU.drawing.kind === 'nogo' ? 'primary' : ''}" data-v8="draw" data-z="nogo">No-go</button><button class="btn sm ${LU.drawing && LU.drawing.kind === 'must' ? 'primary' : ''}" data-v8="draw" data-z="must">Must cover</button><button class="btn sm ${LU.drawing && LU.drawing.kind === 'icp' ? 'primary' : ''}" data-v8="draw" data-z="icp">Command post</button>${LU.drawing ? '<button class="btn primary sm" data-v8="finish">Finish</button>' : ''}<button class="btn ghost sm" data-v8="clearZones">Clear</button></div>
    <p class="src">${LU.drawing ? (LU.drawing.kind === 'icp' ? 'Click the map once to set the command post.' : `Click points on the map (${LU.drawing.pts.length} so far), then Finish.`) : LU.zones.map(z => z.kind).join(', ') + (LU.icp ? ' + command post' : '') || 'None.'}</p></div>`;
  const live = LU.local ? `<div class="sec"><h4>Live incident anywhere in India <small>local app</small></h4><p class="src">Builds terrain, land cover, population and OpenStreetMap for the point, then plans with live feeds.</p>
    <div class="row"><input id="v8lat" placeholder="lat" style="width:30%"><input id="v8lon" placeholder="lon" style="width:30%"><select id="v8hz"><option value="flood">Flood</option><option value="debris">Landslide / flash flood</option><option value="quake">Earthquake</option></select></div>
    <div class="row"><input id="v8name" placeholder="name" style="flex:1"><button class="btn primary sm" data-v8="buildLive">Build & plan</button></div><div id="v8alerts" class="src"><button class="btn sm" data-v8="alerts">Show live alert board (NDMA · GDACS · USGS)</button></div></div>` : '';
  return modeBox + chart + rows + zones + live;
};

/* ---------- stage panel additions ---------- */
LU.stageExtra = (app, n) => {
  const o = app.out; if (!o || !o.v8) return '';
  const st = o.steps, sn = o.liveSnap || {}, box = (items) => items.filter(Boolean).length ? `<div class="v8stage"><p class="eyebrow">Real-world inputs at this stage</p><ul>${items.filter(Boolean).map(t => `<li>${t}</li>`).join('')}</ul><button class="btn ghost sm" data-v8="tab">All inputs →</button></div>` : '';
  const line = k => { const s = status(o, k); return o.use[k] && s.s !== 'off' ? `<b>${esc(k)}</b> — ${esc(s.t)}` : ''; };
  if (n === 1) return box([line('alerts')]);
  if (n === 2) return box([o.wx ? `<b>rain</b> — ${f1(st.evaluate.rain24)} mm in the 24 h window (${esc(o.wx.source)})` : '', line('imaging')]);
  if (n === 3) return box([line('occupancy'), line('facilities'), line('popfusion')]);
  if (n === 5) return box([line('airspace'), line('aircraft'), line('gnss'), o.use.weather ? `<b>wind exposure</b> — ridge speed-up from terrain applied to every launch site` : '', line('constraints')]);
  if (n === 6) return box([line('weather'), line('heights'), st.coverage.blocked && (st.coverage.blocked.wind || st.coverage.blocked.cloud) ? `<b>blocked</b> — site-heights blocked by wind ${st.coverage.blocked.wind}, by cloud ${st.coverage.blocked.cloud} (time-weighted)` : '', line('radar')]);
  if (n === 7) return box([line('robust'), line('fairness'), op(o)]);
  if (n === 8) return box([line('routing'), o.nodes.some(m => m.wait) ? `<b>weather holds</b> — ${o.nodes.filter(m => m.wait).map(m => m.id + ' waits ' + m.wait + ' min').join(', ')}` : '', `<b>logistics</b> — crew ${st.deploy.logistics.crew}, helium ${st.deploy.logistics.heliumM3} m³, ≈ ₹${(st.deploy.logistics.costINR / 1e5).toFixed(1)} lakh / 24 h (assumed rates)`, `<b>airspace notice</b> — draft obstruction notice for ATC / rescue helicopters in the Briefing`]);
  if (n >= 9) return `<div class="v8stage"><p class="eyebrow">Stage ${n}</p><p class="src">Unchanged from v7 — this stage belongs to the hardware and ground station. Modules sense from their own planned heights.</p></div>`;
  return '';
};
function op(o) { const p = o.steps.optimise; return p.modulesFor ? `<b>modules vs reliability</b> — ${['50%', '80%', '90%', '100%'].map(k => k + ': ' + (p.modulesFor[k] ?? '>' + p.tradeoff.length)).join(' · ')}` : ''; }

/* ---------- Live & tracking layers (Layers tab rows + 3D) ---------- */
LU.layerRows = app => { const o = app.out, n = app.step; return [['v8air', 'Airport / heliport clearance', 0, 0, !(o.airspace && o.airspace.length)], ['v8roads', 'Team road routes (OSRM)', 0, 0, n < 8 || !o.v8], ['v8aircraft', 'Low-level air traffic (live)', 0, 0, !(o.aircraft && o.aircraft.length)], ['v8evid', 'Independent evidence points', 0, 0, !o.evidence], ['v8wind', 'Wind & weather at hover height', 0, 0, !o.wx], ['v8zones', 'Operator zones', 0, 0, !(LU.zones.length || LU.icp)]]; };
LU.defaultLayers = () => ({ v8air: { on: true }, v8roads: { on: true }, v8aircraft: { on: true }, v8evid: { on: true }, v8wind: { on: true }, v8zones: { on: true } });
const ring = (x, y, r, S, n = 96) => { const p = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; p.push([C.clamp(x + Math.cos(a) * r, -S / 2, S / 2), C.clamp(y + Math.sin(a) * r, -S / 2, S / 2)]); } return p; };
const clipPts = (pts, S) => pts.filter(([x, y]) => Math.abs(x) <= S / 2 && Math.abs(y) <= S / 2);
LU.buildWorld = (o) => {
  const E = A.scene, W = E.world; if (!W || !o) return; LU.g = {}; ['v8air', 'v8roads', 'v8aircraft', 'v8evid', 'v8wind', 'v8zones'].forEach(k => { E.removeLabels(k); const g = new THREE.Group(); g.name = k; W.root.add(g); LU.g[k] = g; });
  const S = o.T.S, sc = o.sc;
  (o.airspace || []).forEach(z => { const pts = clipPts(ring(z.x, z.y, z.r, S * 4), S); if (pts.length > 2) LU.g.v8air.add(E.drapeLine(ring(z.x, z.y, z.r, S), { color: 0x8a4fd1, width: 2.2, offset: 6, opacity: 0.9, dashed: true, dash: 6, gap: 4 })); const cx = C.clamp(z.x, -S / 2 + 200, S / 2 - 200), cy = C.clamp(z.y, -S / 2 + 200, S / 2 - 200); E.addLabel(`<b>${esc(z.name)}</b>no launch within ${(z.r / 1000).toFixed(0)} km · ${f1(z.distKm)} km away`, cx, cy, 60, 'mark', { group: 'v8air' }); });
  const routes = (o.liveSnap && o.liveSnap.routes && o.liveSnap.routes.byXY) || {};
  if (o.v8 && o.use.routing) o.nodes.filter(n => !n.replan).forEach(n => { const s = o.sites[n.site], r = routes[Math.round(s.x) + ',' + Math.round(s.y)]; if (!r || !r.ok || !r.geometry) return; const pts = clipPts(r.geometry.map(([lo, la]) => L.toXY(sc, la, lo)), S); if (pts.length < 2) return; LU.g.v8roads.add(E.drapeLine(pts, { color: r.crossesHazard ? 0xd8342a : 0xf2b632, width: 2.6, offset: 5, opacity: 0.95, dashed: r.crossesHazard, dash: 5, gap: 4, order: 5 })); });
  (o.aircraft || []).forEach(a => { const pts = clipPts([a.a || [a.x, a.y], [a.x, a.y], a.b || [a.x, a.y]], S); if (pts.length >= 2) LU.g.v8aircraft.add(E.drapeLine(pts, { color: a.heli ? 0xe0561f : 0x2b6cb0, width: 3, offset: Math.max(20, a.agl), opacity: 0.9 })); if (Math.abs(a.x) < S / 2 && Math.abs(a.y) < S / 2) E.addLabel(`<b>${esc(a.id)}</b>${a.heli ? 'helicopter' : 'aircraft'} · ${f0(a.agl)} m AGL`, a.x, a.y, Math.max(40, a.agl), 'mark', { group: 'v8aircraft' }); });
  if (o.evidence) o.evidence.points.forEach(p => { LU.g.v8evid.add(E.marker(p.x, p.y, { ring: p.covered ? '#2f8a55' : '#c4362c', size: 0.022 })); E.addLabel(`<b>Evidence</b>${esc(p.title.slice(0, 60))}<br>${p.inHazard ? 'inside mapped hazard' : p.within150mOfHazard ? '≤150 m from hazard' : 'outside hazard'} · ${p.covered ? 'covered by plan' : 'not covered'}`, p.x, p.y, 40, 'mark', { group: 'v8evid' }); });
  if (o.wx) { const w = o.wx.nominal, dir = w.dir != null ? w.dir : 0, x0 = -S * 0.42, y0 = S * 0.42, L2 = S * 0.06, to = (dir + 180) * Math.PI / 180; LU.g.v8wind.add(E.drapeLine([[x0, y0], [x0 + Math.sin(to) * L2, y0 + Math.cos(to) * L2]], { color: 0x1f6fd1, width: 4, offset: 40 })); LU.g.v8wind.add(E.arrowHead(x0 + Math.sin(to) * L2, y0 + Math.cos(to) * L2, Math.sin(to), Math.cos(to), { color: 0x1f6fd1, z: 40 }));
    E.addLabel(`<b>Wind @100 m</b>${f1(w.v100)} m/s from ${f0(dir)}° · P90 ${f1(o.wx.adverse.v100)} m/s<br>cloud base ${w.cloudBase == null ? 'not limiting' : f0(w.cloudBase) + ' m'} · ${esc(o.wx.source.split(' (')[0])}`, x0, y0, 60, 'mark', { group: 'v8wind' }); }
  LU.zones.forEach(z => { const pts = z.ll.map(([la, lo]) => L.toXY(sc, la, lo)); LU.g.v8zones.add(E.drapeLine(pts.concat([pts[0]]), { color: z.kind === 'nogo' ? 0xc4362c : 0x2f8a55, width: 3, offset: 6 })); });
  if (LU.icp) { const [x, y] = L.toXY(sc, LU.icp.ll[0], LU.icp.ll[1]); LU.g.v8zones.add(E.marker(x, y, { ring: '#1f6fd1' })); }
  if (LU.drawing && LU.drawing.pts.length) { const pts = LU.drawing.pts.map(([la, lo]) => L.toXY(sc, la, lo)); if (pts.length > 1) LU.g.v8zones.add(E.drapeLine(pts, { color: 0xffffff, width: 2, offset: 6, dashed: true })); }
};
LU.display = app => { if (!LU.g) return; const Ly = app.L, n = app.step; const vis = { v8air: n >= 5, v8roads: n >= 8, v8aircraft: n >= 5, v8evid: true, v8wind: n >= 5, v8zones: true };
  for (const k in LU.g) { const on = !!(Ly[k] && Ly[k].on) && vis[k]; LU.g[k].visible = on; (A.scene.world.labels || []).forEach(l => { if (l.group === k) l.visible = on; }); } };

/* ---------- Briefing: deployment order + obstruction notice ---------- */
LU.brief = app => { const o = app.out; if (!o || !o.order) return '';
  const ord = o.order, rows = ord.modules.map(m => `<tr><td>${m.sequence}</td><td><b>${esc(m.id)}</b>${m.role === 'relay' ? ' (relay)' : ''}</td><td>${m.tether_point.lat.toFixed(5)}, ${m.tether_point.lon.toFixed(5)}</td><td>${m.height_m} m${Math.abs(m.effective_height_m - m.height_m) > 1 ? ' (≈' + m.effective_height_m + ' in wind)' : ''}</td><td>${esc(m.team)}</td><td>${m.eta_min} min${m.wait_for_weather_min ? ' +' + m.wait_for_weather_min : ''}</td><td>${m.radio.link_margin_db ?? '—'} dB</td><td>${esc(m.travel.method)}</td></tr>`).join('');
  return `<section class="card v8brief"><h2>Deployment order <small>hand-off to the field teams and ground station · v8</small></h2><p class="src">Planning ends when every module is raised and powered. Sensing, belief update and handover run on the hardware.</p>
    <div class="tblwrap"><table class="tbl"><thead><tr><th>#</th><th>Module</th><th>Tether point</th><th>Height</th><th>Team</th><th>Up at</th><th>Link</th><th>Travel</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="row"><button class="btn primary sm" data-v8="dl" data-f="json">Deployment order .json</button><button class="btn sm" data-v8="dl" data-f="geojson">.geojson</button><button class="btn sm" data-v8="dl" data-f="kml">.kml</button><button class="btn sm" data-v8="dl" data-f="csv">.csv</button><button class="btn ghost sm" data-v8="copyNotice">Copy obstruction notice</button></div>
    <h3>${esc(ord.obstruction_notice.title)}</h3><pre class="v8pre">${esc(ord.obstruction_notice.text)}</pre>
    <h3>Ask the Analyst <small>Claude, answers only from this plan</small></h3><div class="row"><input id="v8q" placeholder="e.g. why does A-03 fly at 150 m?" style="flex:1"><button class="btn sm" data-v8="ask">Ask</button></div><div id="v8ans" class="src"></div></section>`; };

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const b = e.target.closest && e.target.closest('[data-v8]'); if (!b) return; const app = A.app, act = b.dataset.v8, api = A.appApi;
  if (act === 'use') return; // handled on change
  if (act === 'rerun') api.rerun();
  if (act === 'preset') { LU.use = b.dataset.p === 'off' ? Object.assign({}, L.OFF) : Object.assign({}, L.REC); api.renderSide(); }
  if (act === 'tab') { app.sideTab = 'inputs'; api.renderSide(); }
  if (act === 'mode') { LU.mode = b.dataset.m; LU.snaps = {}; await LU.prepare(app.out.sc); api.rerun(); }
  if (act === 'draw') { LU.drawing = { kind: b.dataset.z, pts: [] }; api.renderSide(); }
  if (act === 'finish') { const d = LU.drawing; if (d && d.pts.length >= 3) LU.zones.push({ kind: d.kind, ll: d.pts }); LU.drawing = null; LU.buildWorld(app.out); LU.display(app); api.renderSide(); }
  if (act === 'clearZones') { LU.zones = []; LU.icp = null; LU.drawing = null; LU.buildWorld(app.out); LU.display(app); api.renderSide(); }
  if (act === 'dl') { const o = app.out.order, f = b.dataset.f, data = f === 'json' ? JSON.stringify(o, null, 1) : f === 'geojson' ? JSON.stringify(L.toGeoJSON(o)) : f === 'kml' ? L.toKML(o) : L.toCSV(o), name = `ares-deployment-order-${o.incident.id}.${f}`;
    let ok = false; try { const d = window.claude && await window.claude.use('downloads'); if (d) { await d.save({ filename: name, data }); ok = true; } } catch (err) {}
    if (!ok) { try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'text/plain' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); ok = true; } catch (err) {} }
    if (!ok) api.modal('Deployment order', `<textarea class="copy" readonly>${esc(data)}</textarea>`); }
  if (act === 'copyNotice') api.copy(app.out.order.obstruction_notice.text, 'Obstruction notice');
  if (act === 'ask') { const q = ($('#v8q') || {}).value, el = $('#v8ans'); if (!q) return; el.textContent = 'Thinking…'; try { const ans = await LU.ask(app.out, q); el.textContent = ans; } catch (err) { el.textContent = err.message; } }
  if (act === 'alerts') { const el = $('#v8alerts'); el.textContent = 'Loading…'; const r = await (await fetch('/api/alerts')).json(); el.innerHTML = r.items.slice(0, 40).map((a, i) => `<div class="v8al" data-v8="pickAlert" data-i="${i}"><b>${esc(a.type)}</b> · ${esc(a.feed)} · ${esc(IST(a.time))}<br>${esc((a.title || '').slice(0, 90))}</div>`).join('') || 'No alerts'; LU.alertList = r.items; }
  if (act === 'pickAlert') { const a = LU.alertList[+b.dataset.i]; $('#v8lat').value = a.lat.toFixed(4); $('#v8lon').value = a.lon.toFixed(4); $('#v8name').value = (a.title || '').slice(0, 50); $('#v8hz').value = /quake|eq/i.test(a.type) ? 'quake' : /landslide|cloud|debris/i.test(a.type) ? 'debris' : 'flood'; }
  if (act === 'buildLive') { const lat = +$('#v8lat').value, lon = +$('#v8lon').value; if (!lat || !lon) return api.toast('Enter a point'); api.toast('Building data for the area — this takes up to a minute');
    const r = await (await fetch('/api/pack', { method: 'POST', body: JSON.stringify({ lat, lon, hazard: $('#v8hz').value, name: $('#v8name').value || 'Live incident', time: new Date().toISOString() }) })).json(); if (r.error) return api.toast(r.error);
    LU.mode = 'live'; api.addScenario(r.scenario); }
});
document.addEventListener('change', e => { const t = e.target; if (t.dataset && t.dataset.v8 === 'use') { LU.use[t.dataset.k] = t.checked; if (t.dataset.k === 'robust' && t.checked) LU.use.weather = true; A.appApi.renderStatus(); } });
/* map clicks while drawing (called from the console's click handler with ground x, y) */
LU.mapClick = (x, y) => { if (!LU.drawing) return false; const o = A.app.out, ll = L.toLL(o.sc, x, y); if (LU.drawing.kind === 'icp') { LU.icp = { ll }; LU.drawing = null; } else LU.drawing.pts.push(ll); LU.buildWorld(o); LU.display(A.app); A.appApi.renderSide(); return true; };

/* ---------- Analyst: Claude on the platform (published) or via the local server ---------- */
LU.ask = async (o, q) => {
  const brief = { scenario: { name: o.sc.name, type: o.sc.type }, inputs: Object.fromEntries(Object.keys(L.FACTORS).map(k => [k, status(o, k).t])), notes: o.notes, coverage: o.steps.optimise.cov, target: o.tEff, modulesFor: o.steps.optimise.modulesFor, modules: o.order.modules.map(m => ({ id: m.id, role: m.role, height: m.height_m, effHeight: m.effective_height_m, team: m.team, eta: m.eta_min, wait: m.wait_for_weather_min, travel: m.travel, link: m.radio.link_margin_db, gain: m.expected_gain, fairFor: m.fairness_for })), rejected: o.steps.sites.why };
  const prompt = `You are the ARES planning analyst. ARES places tethered aerostat modules (stationary, fixed height) to cover people at risk after a disaster in India, minimising the number of modules. Answer the operator briefly and concretely, only from this plan JSON; say so when the plan does not contain the answer. Name modules by id; give units.\n\nPlan:\n${JSON.stringify(brief)}\n\nQuestion: ${q}`;
  if (LU.local) { const r = await (await fetch('/api/analyst-direct', { method: 'POST', body: JSON.stringify({ prompt }) })).json(); if (r.answer) return r.answer; throw new Error(r.error || 'Analyst unavailable'); }
  const s = window.claude && await window.claude.use('sample'); if (!s) throw new Error('The Analyst is not available in this view.');
  const r = await s(prompt, { modelTier: 'default' }); return r.text;
};
})(window.ARES);
