/* ARES v7 — Overview (first screen), analytics dashboard (Results) and the auto-generated operational briefing.
   Every number is computed from app.out (the selected scenario's current run) and the data-pack provenance; nothing is hard-coded. */
(function (A) {
'use strict';
const C = A.core, Mo = A.model, PK = A.pack, PG = A.pages, GS = A.search, E = A.scene, app = A.app, ST = A.pipe.STEPS;
const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f0 = v => v == null || isNaN(v) ? '—' : Math.round(v).toLocaleString('en-IN'), f1 = v => (+v).toFixed(1), f2 = v => (+v).toFixed(2), pc = v => v == null ? '—' : (v * 100).toFixed(1) + '%';
const AN = A.analytics = {};
const tier = t => `<span class="tierchip ${t}">${t}</span>`;
const dateOf = s => { if (!s) return '—'; const d = new Date(s); return isNaN(d) ? String(s) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };

/* ---------- shared facts from the run ---------- */
function facts(app) {
  const o = app.out, M = o.M, T = o.T, s = o.steps, P = M.pack, rec = l => PK.record(o.sc.id, l), cellA = T.cell * T.cell / 1e6;
  let haz = 0; if (M.hazMask) for (let k = 0; k < M.hazMask.length; k++) haz += M.hazMask[k]; const hazKm2 = M.hazMask ? haz * cellA : null;
  const imgPre = rec('imagery_s2_pre') || rec('imagery_s1_pre_vv'), imgPost = rec('imagery_s2_post') || rec('imagery_s1_post_vv');
  const coll = M.buildings.filter(b => b.collapsed).length, fl = M.buildings.filter(b => b.flood).length, dmg = M.buildings.filter(b => b.damaged).length;
  return { o, M, T, s, P, areaKm2: (T.S / 1000) ** 2, hazKm2, resident: M.pop ? M.pop.resident : null, exposed: s.belief.exposed, need: o.sc.people, places: (M.places || []).length, buildings: M.buildings.length, coll, fl, dmg,
    sites: s.sites.valid, rejected: s.sites.rejected.length, imgPre: imgPre && (imgPre.observation_start || imgPre.valid_as_of), imgPost: imgPost && (imgPost.observation_start || imgPost.valid_as_of), popYear: '2020', demYears: '2011–2015' };
}
const HAZ_TEXT = {
  debris: 'Intense rain mobilised debris and scoured river channels; roads and bridges along the valleys are cut and settlements on the slopes can be isolated.',
  flood: 'River water spread over the floodplain after the embankment breach; villages, roads and fields are under water and many people wait on rooftops or raised ground.',
  quake: 'A hypothetical strong earthquake collapses part of a dense urban block; rubble blocks narrow streets and power and mobile networks are degraded.' };
const PROBLEM = 'Rescue teams need to know where people are and how to reach them, before ground surveys are possible. ARES evaluates where to raise a small number of tethered aerostats with cameras and radios so they see as many of the people likely to need help as possible, stay linked to the command post, and hand over search sectors and routes.';

/* ---------- OVERVIEW (first screen) ---------- */
AN.overview = function (app) {
  const F = facts(app), o = F.o, sc = o.sc, M = F.M, s = F.s, n = app.step, hz = M.hazard || (M.flood ? 'flood' : 'debris'), real = (sc.sources || []).length > 0;
  const rep = (sc.reported || []).slice(0, 3).map(r => `<li>${esc(r[0])}: <b data-real>${esc(r[1])}</b>${r[3] ? ` <span class="muted small">(${esc(r[3])})</span>` : ''}</li>`).join('');
  const SU = A.searchui, sr = SU && SU.cur && SU.cur.sid === sc.id ? SU.cur : null;
  const flow = [
    ['Select a disaster', `${esc(sc.name)} selected`, 'done'], ['Understand the event', `${esc(sc.type)}`, 'done'],
    ['Inspect imagery & affected area', F.imgPost ? `Satellite ${dateOf(F.imgPre)} → ${dateOf(F.imgPost)}` : 'Recent imagery only (hypothetical)', n >= 2 ? 'done' : 'cur'],
    ['Map the hazard (AI / change detection)', F.hazKm2 != null ? `${f2(F.hazKm2)} km² mapped (derived)` : 'Modelled collapse zone (hypothetical)', n >= 2 ? 'done' : ''],
    ['Expand the geographic search', sr ? `${sr.f}×: ${f0(sr.o.outc.sitesValid)} valid sites, ${sr.o.outc.settlements} settlements` : 'Optional — compare 1.5×, 2.5×, 5×', sr ? 'done' : ''],
    ['Inspect & optimise launch sites', n >= 7 ? `${s.optimise.sol.length} aerostats, ${pc(s.optimise.cov)} covered` : `${F.sites} usable sites`, n >= 7 ? 'done' : n >= 5 ? 'cur' : ''],
    ['Run the simulation (deploy, sense, update)', n >= 10 ? `${f0(s.update.gp1.confirmed)} people located (sim)` : 'Stages 8–10', n >= 10 ? 'done' : n >= 8 ? 'cur' : ''],
    ['Inspect results & coverage gaps', 'Results page', ''], ['Generate the operational briefing', `${s.handover.sectors} sectors ready`, n >= 11 ? 'done' : '']];
  const q = [['What happened?', `${esc(sc.type)}. ${esc(HAZ_TEXT[hz] || '')} ${real ? '' : '<b>This scenario is hypothetical.</b>'}`],
    ['Where?', `${esc(sc.place)} — the model square is ${f1(F.T.S / 1000)} × ${f1(F.T.S / 1000)} km around ${sc.lat.toFixed(3)}°N ${sc.lon.toFixed(3)}°E; real data out to 5× that side are available for the wider search.`],
    ['What does ARES know?', `Real terrain (Copernicus DEM ${F.demYears}), satellite imagery (${F.imgPost ? dateOf(F.imgPost) : 'recent'}), ${f0(F.buildings)} buildings, ${F.places} named places, ${f0(F.resident)} modelled residents (WorldPop ${F.popYear}) and a ${M.hazMask ? 'derived hazard map' : 'hypothetical damage model'}. People needing help (${f0(F.need)}) is a scenario assumption.`],
    ['What is ARES doing?', `Stage ${n} of 11 — ${esc(ST[n - 1].t)}: ${esc(PG.SIMPLE[n - 1].s)}`],
    ['What has ARES found?', n >= 7 ? `${s.optimise.sol.length} aerostats cover ${pc(s.optimise.cov)} of the expected need (target ${pc(o.tEff)}${s.optimise.met ? ', met' : ', not met'}); all ${s.deploy.con.ok.filter(Boolean).length} link to the command post${n >= 10 ? `; ${f0(s.update.gp1.confirmed)} people located and ${f0(s.update.gp2.estTotal)} estimated in total (simulated)` : ''}.` : 'Placement results appear from stage 7. Step through the simulation or press Play.']];
  return `<div class="phead"><div><p class="eyebrow">Overview · ${esc(sc.code)} · ${real ? 'real event' : 'hypothetical'}</p><h1>${esc(sc.name)}</h1>
    <div class="hero"><div class="idl"><span><b>Location</b> ${esc(sc.place)}</span><span><b>Type</b> ${esc(sc.type)}</span><span><b>When</b> <span data-real>${esc(sc.start)}</span></span><span><b>Area analysed</b> ${f0(F.areaKm2)} km² (${f1(F.T.S / 1000)} km square)</span></div></div></div>
    <div class="row"><button class="btn primary" data-ov="sim">${n > 1 ? `Resume simulation (stage ${n})` : 'Start the simulation'} →</button><button class="btn" data-ov="search">Geographic search</button><button class="btn" data-ov="results">Results</button><button class="btn" data-ov="brief">Briefing</button></div></div>
  <div class="ovw"><div class="hero">
    <div class="card"><h3>What happened and why ARES is used</h3><p style="margin:0 0 8px;font-size:14px;line-height:1.55">${esc(HAZ_TEXT[hz] || sc.type)}</p>${rep ? `<ul style="margin:0 0 8px 18px;font-size:13px;line-height:1.6">${rep}</ul>` : ''}<p class="muted" style="margin:0;font-size:13px;line-height:1.5"><b>Operational problem.</b> ${PROBLEM}</p></div>
    <div class="card"><h3>Key data at a glance <small>each value: source tier and date</small></h3><div class="facts">
      <div class="fact"><span class="k">Area mapped</span><span class="v">${f0(F.areaKm2)} km²</span><span class="s">model square · wider search up to ${f0(F.areaKm2 * 25)} km²</span></div>
      <div class="fact"><span class="k">Residents</span><span class="v">${f0(F.resident)}</span><span class="s">${tier('modelled')} WorldPop 2020</span></div>
      <div class="fact"><span class="k">Named settlements</span><span class="v">${F.places}</span><span class="s">${tier('observed')} OpenStreetMap</span></div>
      <div class="fact"><span class="k">Buildings</span><span class="v">${f0(F.buildings)}</span><span class="s">${tier('derived')} OSM + Open Buildings</span></div>
      <div class="fact"><span class="k">${M.flood ? 'Inundation' : M.hazMask ? 'Debris / scour' : 'Damage zone'}</span><span class="v">${F.hazKm2 != null ? f2(F.hazKm2) + ' km²' : 'model'}</span><span class="s">${tier(M.hazMask ? 'derived' : 'synthetic')} ${M.cems ? 'incl. CEMS ' + esc(M.cems.meta.code) : 'satellite change detection'}</span></div>
      <div class="fact"><span class="k">Launch sites</span><span class="v">${F.sites}</span><span class="s">${tier('modelled')} usable of ${F.sites + F.rejected} screened</span></div>
      <div class="fact"><span class="k">Need help</span><span class="v" data-sim>${f0(F.need)}</span><span class="s">${tier('assumed')} scenario figure</span></div>
      <div class="fact"><span class="k">Imagery</span><span class="v" style="font-size:14px">${F.imgPost ? dateOf(F.imgPost) : '—'}</span><span class="s">${tier('observed')} ${F.imgPre ? 'pre ' + dateOf(F.imgPre) : 'Sentinel'}</span></div></div></div>
    <div class="card"><h3>Five questions</h3><div class="qa">${q.map(([a, b]) => `<div><b>${a}</b><span>${b}</span></div>`).join('')}</div></div></div>
    <div class="card"><h3>Simulation workflow <small>run #${app.run.id} · live status</small></h3><ol class="wf">${flow.map(([t, r, st], i) => `<li class="${st}"><i>${st === 'done' ? '✓' : i + 1}</i><span>${t}<small>${r}</small></span><em>${st === 'done' ? 'done' : st === 'cur' ? 'now' : ''}</em></li>`).join('')}</ol>
      <div class="row" style="margin-top:10px"><button class="btn" data-ov="layers">Explore the data layers</button><button class="btn" data-ov="model">Data &amp; model</button></div></div></div>
  <div style="margin-top:22px">${PG.start(app)}</div>`;
};
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-ov]'); if (!b) return; const k = b.dataset.ov; if (k === 'layers') { app.showPage('sim'); app.sideTab = 'layers'; app.setSide(true); app.renderSide(); return; } app.showPage(k); });

/* ---------- small SVG charts ---------- */
function hbar(items, o = {}) {
  const W = 360, rh = 18, lw = o.lw || 112, H = items.length * rh + 6, mx = o.max || Math.max(1e-9, ...items.map(i => i.v)), fmt = o.fmt || f0;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || '')}">${items.map((it, i) => { const y = i * rh + 3, w = Math.max(0.5, (W - lw - 54) * it.v / mx); return `<g ${it.x != null ? `class="bar" data-fly="${it.x},${it.y}"` : ''}><title>${esc(it.label)}: ${fmt(it.v)}${it.sub ? ' — ' + esc(it.sub) : ''}</title><text x="${lw - 6}" y="${y + 12}" text-anchor="end">${esc(String(it.label).slice(0, 18))}</text><rect x="${lw}" y="${y + 2}" width="${w}" height="${rh - 6}" rx="2" fill="${it.c || 'var(--comm)'}"/><text class="vl" x="${lw + w + 4}" y="${y + 12}">${fmt(it.v)}</text></g>`; }).join('')}</svg>`;
}
function vbar(bins, o = {}) {
  const W = 360, H = 130, pb = 22, n = bins.length, bw = (W - 30) / n, mx = Math.max(1e-9, ...bins.map(b => Math.max(b.v, b.v2 || 0))), fmt = o.fmt || f0;
  return `<svg viewBox="0 0 ${W} ${H}" role="img"><line class="gl" x1="26" x2="${W}" y1="${H - pb}" y2="${H - pb}"/>${bins.map((b, i) => { const x = 28 + i * bw, h1 = (H - pb - 10) * b.v / mx, h2 = b.v2 != null ? (H - pb - 10) * b.v2 / mx : 0; return `<g><title>${esc(b.label)}: ${fmt(b.v)}${b.v2 != null ? ' · ' + fmt(b.v2) : ''}</title><rect x="${x}" y="${H - pb - h1}" width="${b.v2 != null ? bw * 0.42 : bw * 0.8}" height="${h1}" fill="${b.c || o.c || 'var(--comm)'}"/>${b.v2 != null ? `<rect x="${x + bw * 0.44}" y="${H - pb - h2}" width="${bw * 0.42}" height="${h2}" fill="${o.c2 || 'var(--accent)'}"/>` : ''}${i % (o.every || 1) === 0 ? `<text x="${x + bw * 0.4}" y="${H - 8}" text-anchor="middle">${esc(b.label)}</text>` : ''}</g>`; }).join('')}${o.line != null ? `<line x1="28" x2="${W}" y1="${H - pb - (H - pb - 10) * o.line / mx}" y2="${H - pb - (H - pb - 10) * o.line / mx}" stroke="var(--crit)" stroke-dasharray="4 3"/>` : ''}<text x="2" y="12">${fmt(mx)}</text></svg>`;
}
const hist = (vals, wts, lo, hi, n) => { const b = new Array(n).fill(0); vals.forEach((v, i) => { if (v == null || isNaN(v)) return; const k = Math.min(n - 1, Math.max(0, Math.floor((v - lo) / (hi - lo) * n))); b[k] += wts ? wts[i] : 1; }); return b; };
const card = (h, sub, q, body, src) => `<div class="dc"><h4>${h}${sub ? `<small>${sub}</small>` : ''}</h4><p class="q">${q}</p>${body}${src ? `<p class="q" style="font-size:11px">${src}</p>` : ''}</div>`;

/* ---------- DASHBOARD ---------- */
AN.dashboard = function (app) {
  const F = facts(app), o = F.o, M = F.M, B = o.B, s = F.s, P = o.P, T = o.T, op = s.optimise, wk = o.wk;
  const fin = o.nodes.map(n => n.site), cov = new Uint8Array(B.N), mult = new Uint8Array(B.N); fin.forEach(j => { const L = o.cc.sp[j].c; for (let t = 0; t < L.length; t++) { cov[L[t]] = 1; mult[L[t]]++; } });
  // B · population by settlement (residents of belief cells assigned to the nearest named place within 1.5 km)
  const pl = (M.places || []).map(p => ({ label: p.name, v: 0, lam: 0, x: p.x, y: p.y, cov: 0 })); let unassigned = 0;
  for (let c = 0; c < B.N; c++) { if (!(B.occ[c] > 0)) continue; let bi = -1, bd = 1500 * 1500; pl.forEach((p, i) => { const d = (p.x - B.cx[c]) ** 2 + (p.y - B.cy[c]) ** 2; if (d < bd) { bd = d; bi = i; } }); if (bi < 0) { unassigned += B.occ[c]; continue; } pl[bi].v += B.occ[c]; pl[bi].lam += B.lam[c]; if (cov[c]) pl[bi].cov += B.occ[c]; }
  const plTop = pl.filter(p => p.v > 0.5).sort((a, b) => b.v - a.v).slice(0, 10);
  let rIn = 0, rOut = 0, lIn = 0, lOut = 0; for (let c = 0; c < B.N; c++) { if (cov[c]) { rIn += B.occ[c]; lIn += B.lam[c]; } else { rOut += B.occ[c]; lOut += B.lam[c]; } }
  const sevB = [0, 0, 0, 0, 0]; for (let c = 0; c < B.N; c++) sevB[Math.min(4, Math.floor(B.sev[c] * 5))] += B.occ[c];
  // C · terrain
  const elevC = Array.from(B.cz), eLo = Math.min(...elevC), eHi = Math.max(...elevC) + 1, eb = hist(elevC, null, eLo, eHi, 10), er = hist(elevC, Array.from(B.occ), eLo, eHi, 10);
  const slV = o.sites.map(q => Math.atan(q.slope) * 57.3), slR = s.sites.rejected.map(q => Math.atan(q.slope) * 57.3), sbV = hist(slV, null, 0, 45, 9), sbR = hist(slR, null, 0, 45, 9);
  const why = Object.entries(s.sites.why || {}).sort((a, b) => b[1] - a[1]);
  // D · hazard & infrastructure
  const bsrc = { osm: [0, 0], ml: [0, 0], cems: [0, 0] }; M.buildings.forEach(b => { const k = bsrc[b.src] ? b.src : 'ml'; bsrc[k][0]++; if (b.collapsed || b.flood || b.damaged) bsrc[k][1]++; });
  const cg = M.cems ? (M.cems.buildings || []).reduce((a, q) => { a[q.grade] = (a[q.grade] || 0) + 1; return a; }, {}) : null;
  // E · optimisation
  const gains = op.full.steps.slice(0, Math.max(op.sol.length + 4, 8)).map((q, i) => ({ label: String(i + 1), v: q.gain * 100, c: i < op.sol.length ? 'var(--accent)' : 'var(--faint)' }));
  const b = op.base, meth = [{ label: 'ARES greedy', v: op.sol.length, c: 'var(--accent)' }, { label: 'Lower bound', v: op.lb || 0, c: 'var(--faint)' }, { label: 'k-means + snap', v: b.needKmeans ?? b.kmeans.length - 1, sub: b.needKmeans == null ? 'target not reached' : '' }, { label: 'Random', v: b.needRandom ?? b.random.length - 1, sub: b.needRandom == null ? 'target not reached' : '' }, { label: 'Hex grid', v: b.grid.n, sub: pc(b.grid.cov) + ' coverage' }];
  const mh = [0, 0, 0, 0]; for (let c = 0; c < B.N; c++) if (B.lam[c] >= 1e-4) mh[Math.min(3, mult[c])] += B.lam[c];
  // F · comms & sensing
  const marg = o.nodes.map(n => ({ label: n.id, v: n.marg == null ? 0 : n.marg, c: n.marg != null && n.marg >= o.p.fade ? 'var(--comm)' : 'var(--crit)' }));
  const bm = []; for (let i = 0; i < P.n; i++) if (P.dev[i] && !isNaN(P.bestMar[i])) bm.push(P.bestMar[i]); const mb = hist(bm, null, -40, 40, 8);
  const det = s.update.sense; const u = s.update;
  // G · rescue
  const secs = (o.sectors || []).slice(0, 10);
  const SU = A.searchui, sr = SU && SU.cur && SU.cur.sid === o.sc.id ? SU.cur : null;
  const sec = (t, d) => `<div class="dsec"><h2>${t}</h2><span>${d}</span></div>`;
  return `<div class="phead"><div><p class="eyebrow">Results &amp; analytics · ${esc(o.sc.code)} · run #${app.run.id}</p><h1>Analytics dashboard</h1><p class="lede">Every chart is computed from this run of the selected scenario. Tiers say what is observed, derived, modelled, assumed or simulated. Click a settlement or sector bar to fly the 3D map there.</p></div></div>
  ${sec('A · Disaster overview', 'what was mapped and what it contains')}
  <div class="kgrid">
    <div class="kc"><span class="k">Area analysed</span><span class="v">${f0(F.areaKm2)} km²</span><span class="s">${tier('observed')} terrain + imagery</span></div>
    <div class="kc"><span class="k">${M.flood ? 'Inundated' : 'Hazard'} area</span><span class="v">${F.hazKm2 != null ? f2(F.hazKm2) + ' km²' : '—'}</span><span class="s">${tier(M.hazMask ? 'derived' : 'synthetic')} not an official map</span></div>
    <div class="kc"><span class="k">Buildings in / near hazard</span><span class="v">${f0(F.coll + F.fl + F.dmg)}</span><span class="s">${tier('derived')} of ${f0(F.buildings)}; exposure, not confirmed damage${M.cems ? ' (CEMS-graded where available)' : ''}</span></div>
    <div class="kc"><span class="k">Residents</span><span class="v">${f0(F.resident)}</span><span class="s">${tier('modelled')} WorldPop 2020</span></div>
    <div class="kc"><span class="k">Exposed residents</span><span class="v">${f0(F.exposed)}</span><span class="s">${tier('modelled')} in or next to hazard</span></div>
    <div class="kc"><span class="k">Need help</span><span class="v">${f0(F.need)}</span><span class="s">${tier('assumed')} scenario figure</span></div>
    <div class="kc"><span class="k">Data freshness</span><span class="v" style="font-size:14px">${F.imgPost ? dateOf(F.imgPost) : '—'}</span><span class="s">latest image · population 2020 · DEM 2011–15 · OSM ${esc(String((PK.record(o.sc.id, 'osm') || {}).valid_as_of || '').slice(0, 10))}</span></div></div>
  ${sec('B · Population intelligence', 'modelled residents (WorldPop) vs the model’s expected need')}
  <div class="dash">
    ${card('Residents by settlement', 'top 10', 'Which named places hold the most residents (belief cells assigned to the nearest OSM place within 1.5 km)? Orange: share inside final camera coverage.', hbar(plTop.map(p => ({ label: p.label, v: p.v, x: p.x, y: p.y, sub: `${f0(p.cov)} inside coverage · ${f1(p.lam)} expected to need help`, c: `color-mix(in srgb,var(--accent) ${Math.round(100 * p.cov / Math.max(1, p.v))}%,var(--comm))` })), { title: 'Residents by settlement' }), `${tier('modelled')} WorldPop · ${f0(unassigned)} residents are > 1.5 km from any named place`)}
    ${card('Residents by hazard severity', 'Belief-State severity', 'How many residents live where the hazard term is weak, moderate or severe?', vbar(sevB.map((v, i) => ({ label: ['0–0.2', '0.2–0.4', '0.4–0.6', '0.6–0.8', '0.8–1'][i], v, c: ['#9aa3ad', '#f2b632', '#f08a3c', '#d9531e', '#8f1f1a'][i] }))), tier('modelled'))}
    ${card('Inside vs outside camera coverage', 'final fleet', 'Who is inside the modelled camera coverage of the final fleet?', hbar([{ label: 'Residents in', v: rIn, c: 'var(--ok)' }, { label: 'Residents out', v: rOut, c: 'var(--faint)' }, { label: 'Expected in', v: lIn, c: 'var(--accent)' }, { label: 'Expected out', v: lOut, c: 'var(--crit)' }]), `Residents ${tier('modelled')} · expected need ${tier('modelled')}`)}
  </div>
  ${sec('C · Geography & terrain', 'how terrain shapes where aerostats can stand')}
  <div class="dash">
    ${card('Elevation: area vs residents', 'belief cells', 'Where is the land, and where do people live, by height? Blue: share of area · orange: residents.', vbar(eb.map((v, i) => ({ label: f0(eLo + (eHi - eLo) * (i + 0.5) / 10), v: v / B.N * 100, v2: er[i] / Math.max(1, F.resident) * 100 })), { fmt: v => f1(v) + '%', every: 2 }), `${tier('observed')} Copernicus DEM (surface model)`)}
    ${card('Slope at candidate sites', 'usable vs ruled out', 'Steep ground rules sites out (tether safety). Blue: usable · orange: rejected.', vbar(sbV.map((v, i) => ({ label: (i * 5) + '°', v, v2: sbR[i] })), { every: 2 }), tier('modelled'))}
    ${card('Why candidate sites were ruled out', `${F.rejected} of ${F.sites + F.rejected}`, 'Which rule removed each rejected candidate?', hbar(why.map(([k, v]) => ({ label: k, v, c: 'var(--warn)' })), { lw: 150 }), tier('modelled'))}
  </div>
  ${sec('D · Hazard & infrastructure', 'exposure is not confirmed damage')}
  <div class="dash">
    ${card('Buildings by source and exposure', '', 'How many footprints come from each source, and how many lie in the mapped hazard?', hbar(Object.entries(bsrc).filter(([, v]) => v[0]).flatMap(([k, v]) => [{ label: k.toUpperCase() + ' total', v: v[0], c: 'var(--faint)' }, { label: k.toUpperCase() + ' exposed', v: v[1], c: 'var(--accent)' }])), `${tier('derived')} exposure from the hazard mask${M.cems ? '; CEMS grades are ' + tier('observed') : ''}`)}
    ${card('Hazard severity distribution', 'cells', 'How much of the area is in each severity class (all cells)?', vbar(s.evaluate.sevHist.map((v, i) => ({ label: ['low', '', 'mid', '', 'high'][i] || '', v, c: ['#9aa3ad', '#f2b632', '#f08a3c', '#d9531e', '#8f1f1a'][i] }))), tier('modelled'))}
    ${cg ? card(`CEMS ${esc(M.cems.meta.code)} damage grading`, 'photo-interpreted', 'Independent damage grades for buildings inside the CEMS area.', hbar(Object.entries(cg).map(([k, v]) => ({ label: k, v, c: k === 'Destroyed' ? 'var(--crit)' : 'var(--warn)' }))), tier('observed')) : card('Roads and bridges', 'OpenStreetMap', 'Mapped transport in the model square (condition is not mapped).', hbar([{ label: 'Road ways', v: (M.roadsAll || []).length }, { label: 'Bridges', v: ((M.pack && M.pack.osm.bridges) || []).length }]), `${tier('observed')} OSM — absence of a road is not proof none exists`)}
  </div>
  ${sec('E · Optimisation', 'why these sites and how many')}
  <div class="dash">
    ${card('Marginal benefit of each aerostat', 'greedy order', 'How much expected need does each additional aerostat add? Grey: beyond the chosen set (diminishing returns).', vbar(gains, { fmt: v => f1(v) + '%' }), tier('modelled'))}
    ${card('Method comparison', `aerostats to reach ${pc(o.tEff)}`, 'Same candidates, same coverage model: how many aerostats does each method need?', hbar(meth, { lw: 110 }), tier('modelled'))}
    ${card('Overlapping coverage', 'expected need by number of aerostats seeing it', 'Is need seen by none, one or several aerostats (redundancy)?', vbar(mh.map((v, i) => ({ label: ['none', '1', '2', '3+'][i], v, c: ['var(--crit)', 'var(--ok)', 'var(--comm)', 'var(--violet)'][i] }))), tier('modelled'))}
    ${card('Contribution per aerostat', 'Shapley value', 'Average share of coverage each aerostat adds over all orders.', hbar(o.nodes.map(n => ({ label: n.id, v: (n.shap || 0) * 100, c: n.replan ? 'var(--violet)' : 'var(--accent)' })), { fmt: v => f1(v) + '%' }), tier('modelled'))}
  </div>
  ${sec('F · Communication & sensing', 'link budget and detections (detections are simulated)')}
  <div class="dash">
    ${card('Backhaul link margin', 'dB, per aerostat', `Does each aerostat reach the command post (directly or via relay)? Margin must exceed the ${o.p.fade} dB fade allowance.`, hbar(marg, { fmt: v => f1(v) + ' dB', lw: 60 }), `${tier('modelled')} 866 MHz link budget · ${tier('assumed')} radio parameters`)}
    ${card('Phone / beacon uplink margin', 'survivors with a device', 'How strong is the best uplink from each simulated device to an aerostat? Red line: fade allowance.', vbar(mb.map((v, i) => ({ label: (-40 + i * 10) + '', v })), { line: null }), tier('synthetic'))}
    ${card('How people were found', 'simulated', 'Detections by thermal/EO camera, by phone/beacon, and people not found.', hbar([{ label: 'Camera', v: det.thermal, c: 'var(--accent)' }, { label: 'Phone / beacon', v: det.beacon, c: 'var(--comm)' }, { label: 'Not found', v: det.n - det.det, c: 'var(--faint)' }]), tier('synthetic'))}
    ${card('Belief improvement', 'people', 'Expected people before sensing, after the first update, after replanning, and the simulated truth.', hbar([{ label: 'Prior (stage 3)', v: s.belief.lamTot, c: 'var(--faint)' }, { label: 'After update 1', v: u.gp1.estTotal, c: 'var(--violet)' }, { label: 'After replanning', v: u.gp2.estTotal, c: 'var(--violet)', sub: '± ' + f0(1.64 * u.gp2.estSd) + ' (90%)' }, { label: 'Truth (sim)', v: u.gp2.trueTotal, c: 'var(--ink)' }]), `${tier('modelled')} GP estimate · ${tier('synthetic')} truth`)}
  </div>
  ${sec('G · Rescue & operations', 'what is handed over')}
  <div class="dash">
    ${card('Expected people per rescue sector', 'top 10, with 90 % range', 'Which sectors should teams search first?', hbar(secs.map(r => ({ label: `#${r.rank} ${r.id}`, v: r.est, x: r.cx, y: r.cy, sub: `confirmed ${f0(r.conf)} · ±${f0(1.64 * r.sd)} · priority ${r.pri}`, c: r.pri === 1 ? 'var(--crit)' : r.pri === 2 ? 'var(--warn)' : 'var(--faint)' })), { fmt: f1 }), `${tier('modelled')} estimate · ${tier('synthetic')} confirmed`)}
    ${card('Access routes from the command post', 'top sectors', 'Walking/boat route length (A* over terrain, slope, water and debris costs). Travel time is not estimated.', hbar(secs.filter(r => r.route).slice(0, 6).map(r => ({ label: `#${r.rank} ${r.id}`, v: r.route.len / 1000, sub: r.route.boat ? 'includes water' : '', c: r.route.boat ? 'var(--comm)' : 'var(--ok)' })), { fmt: v => f1(v) + ' km' }), tier('modelled'))}
    ${card('Geographic search', sr ? `${sr.f}× · ${sr.mode}` : 'not run yet', 'Does a wider search change the deployment?', sr ? hbar([{ label: 'Valid sites L1', v: GS.outcomesBase(o).sitesValid, c: 'var(--faint)' }, { label: `Valid sites ${sr.f}×`, v: sr.o.outc.sitesValid, c: 'var(--comm)' }, { label: 'Aerostats L1', v: GS.outcomesBase(o).placed, c: 'var(--faint)' }, { label: `Aerostats ${sr.f}×`, v: sr.o.outc.placed, c: 'var(--violet)' }]) + `<button class="btn sm" data-ov="search">Open the comparison</button>` : '<button class="btn sm" data-ov="search">Run a wider search</button>', tier('modelled'))}
  </div><div style="height:18px"></div>`;
};
document.addEventListener('click', e => { const g = e.target.closest && e.target.closest('[data-fly]'); if (!g) return; const [x, y] = g.dataset.fly.split(',').map(Number); app.showPage('sim'); setTimeout(() => { E.flyTo(x, y, 0.22); A.vis && A.vis.highlight && A.vis.highlight(x, y, 160); }, 80); });

/* ---------- operational briefing (auto-generated from this run) ---------- */
AN.briefData = function (app) {
  const F = facts(app), o = F.o, s = F.s, sc = o.sc, M = F.M, L = app.built.layers || {}, L1 = GS.outcomesBase(o), SU = A.searchui;
  const searches = SU ? Object.values(SU.results).filter(r => r.sid === sc.id) : [];
  const nodes = o.nodes.map(n => { const st = o.sites[n.site]; return { id: n.id, role: n.replan ? 'added at replanning' : n.role, lat: sc.lat + st.y / 111320, lon: sc.lon + st.x / (111320 * Math.cos(sc.lat * Math.PI / 180)), linkDb: n.marg, hop: n.hop, shapley: n.shap, ifLost: n.loo }; });
  return { F, o, s, sc, M, L, L1, searches, nodes };
};
AN.briefMarkdown = function (app) {
  const { F, o, s, sc, M, L, L1, searches, nodes } = AN.briefData(app), b = s.optimise.base, u = s.update, ln = [];
  const P = (t) => ln.push(t), H = (t) => ln.push('', '## ' + t, '');
  P(`# ARES operational briefing — ${sc.name}`); P(`Incident ${sc.code} · run #${app.run.id} (${app.run.at ? app.run.at.toISOString() : ''}) · generated from the selected run; simulated values are marked (sim).`);
  H('1. Disaster overview'); P(`${sc.type}. ${HAZ_TEXT[M.hazard] || ''} Location: ${sc.place}. Event: ${sc.start}.${(sc.sources || []).length ? '' : ' **Hypothetical scenario.**'}`); (sc.reported || []).slice(0, 5).forEach(r => P(`- ${r[0]}: ${r[1]}${r[3] ? ' (' + r[3] + ')' : ''}`));
  H('2. Data sources and timestamps'); Object.values(L).filter(l => l && l.name).forEach(l => P(`- **${l.name}** [${l.tier}]: ${l.rec ? `${l.rec.source_name}; observed ${String(l.rec.observation_start || l.rec.valid_as_of || '—').slice(0, 10)}; ${l.rec.license || ''}` : ''}${l.note ? ' — ' + l.note : ''}`));
  H('3. Affected geographic area'); P(`Model square ${f1(F.T.S / 1000)} × ${f1(F.T.S / 1000)} km (${f0(F.areaKm2)} km²). Mapped ${M.flood ? 'inundation' : 'hazard'}: ${F.hazKm2 != null ? f2(F.hazKm2) + ' km² (derived from satellite change detection — not an official map)' : 'hypothetical damage model'}.${M.cems ? ` Copernicus EMS ${M.cems.meta.code} delineation used inside its AOI.` : ''}`);
  H('4. Population and infrastructure exposure'); P(`Residents (WorldPop 2020, modelled): ${f0(F.resident)}. Exposed residents (in or next to hazard): ${f0(F.exposed)}. People needing help (scenario assumption): ${f0(F.need)}. Buildings: ${f0(F.buildings)}, of which ${f0(F.coll + F.fl + F.dmg)} lie in or next to the mapped hazard (exposure, not confirmed damage).`);
  H('5. AI / remote-sensing mapping findings'); P(`${L.hazard ? L.hazard.name + ' [' + L.hazard.tier + ']' : 'Hazard'}: ${L.hazard && L.hazard.rec ? L.hazard.rec.processing_method : 'see Data & model'}. Not field-validated.`);
  H('6. Optimisation methodology'); P(`Greedy weighted set cover (k-coverage on high-priority cells) over ${F.sites} screened launch sites; camera footprint ${f0(Mo.footR(o.p, o.p.h))} m at ${o.p.h} m, line of sight on the DEM, 866 MHz link budget with correlated shadowing; fleet budget ${o.p.Kmax} + 3 for replanning; target ${pc(o.tEff)}.`);
  H('7. Recommended deployment locations'); P('| Aerostat | Role | Latitude | Longitude | Link margin dB | Hops | Shapley | Coverage lost if unavailable |'); P('|---|---|---|---|---|---|---|---|'); nodes.forEach(n => P(`| ${n.id} | ${n.role} | ${n.lat.toFixed(5)} | ${n.lon.toFixed(5)} | ${n.linkDb != null ? f1(n.linkDb) : '—'} | ${n.hop} | ${pc(n.shapley || 0)} | ${pc(n.ifLost || 0)} |`));
  H('8. Coverage and communication results'); P(`${s.optimise.sol.length} aerostats cover ${pc(s.optimise.cov)} of the weighted expected need (target ${pc(o.tEff)}, ${s.optimise.met ? 'met' : 'not met'}); ${s.deploy.relays} relays; ${s.deploy.con.ok.filter(Boolean).length}/${o.nodes.length} linked to the command post. People located (sim): ${f0(u.gp1.confirmed)}; estimate after replanning ${f0(u.gp2.estTotal)} ± ${f0(1.64 * u.gp2.estSd)} (90 %).`);
  H('9. Underserved areas'); (L1.underserved || []).slice(0, 8).forEach(x => P(`- Near ${x.near || '—'} (${x.nearD != null ? f1(x.nearD / 1000) + ' km' : ''}): ${f1(x.lam)} expected people, ${f0(x.res)} residents — ${x.why}`)); if (!(L1.underserved || []).length) P('None: every cell with expected need is inside camera coverage.');
  H('10. Alternative deployment comparison'); P(`Aerostats to reach the target: ARES greedy ${s.optimise.sol.length}; k-means ${b.needKmeans ?? '> ' + (b.kmeans.length - 1)}; random ${b.needRandom ?? '> ' + (b.random.length - 1)}; hexagonal grid ${b.grid.n} (coverage ${pc(b.grid.cov)}); lower bound ${s.optimise.lb}.`);
  H('11. Geographic search expansion'); if (!searches.length) P('Not run in this session (Geographic search page). Level 1 = the original square.'); searches.forEach(r => { const x = r.o.outc; P(`- ${r.f}× (${f0(x.areaKm2)} km², ${r.mode === 'A' ? 'same people, wider site search' : 'wider area, ' + (r.demand === 'hazard' ? 'hazard-linked demand' : 'identical demand')}): ${f0(x.sitesValid)} valid sites (Level 1 ${f0(L1.sitesValid)}), ${x.settlements} settlements (+${x.ringSettlements.length}), ${x.placed} aerostats placed (${x.placedNew} on new sites), coverage ${pc(x.cov)}; aerostats needed for the target ${x.needForTarget ?? '> 600'}.`); });
  H('12. Limitations and uncertainty'); ['Hazard extents are derived indicators from satellite change detection, not official damage maps, and are not field-validated.', 'Population is the modelled resident population (WorldPop 2020), not event-day occupancy; tourists and workers may be missing.', 'The Copernicus DEM is a surface model from 2011–2015; post-event terrain change is not represented.', 'Camera, radio and detection parameters are assumptions; survivors, detections and SOS calls are simulated.', 'OSM completeness varies: a missing road or building is not proof that none exists.', 'No accuracy claim is made for real-world operations; the model is internally consistent and its baseline is reproducible.'].forEach(t => P('- ' + t));
  return ln.join('\n');
};
AN.briefExtra = function (app) {
  const { s, L1, searches } = AN.briefData(app);
  return `<div class="card" style="margin-top:16px"><h3>Operational briefing <small>12 sections, generated from run #${app.run.id}</small></h3><p class="muted small" style="margin:0 0 8px">Disaster overview, data sources and dates, affected area, exposure, mapping findings, optimisation method, recommended locations, coverage and communication, underserved areas, alternatives, geographic search results${searches.length ? ` (${searches.length} level${searches.length > 1 ? 's' : ''})` : ''} and limitations.</p>
    <div class="row"><button class="btn primary" data-brief="md">Download briefing (.md)</button><button class="btn" data-brief="copy">Copy as Markdown</button><button class="btn" data-brief="view">Preview</button></div>
    <p class="src" style="margin:8px 0 0">${L1.underserved.length} underserved cluster${L1.underserved.length === 1 ? '' : 's'} in the final coverage · ${s.handover.sectors} sectors · all exports refer to run #${app.run.id}.</p></div>`;
};
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-brief]'); if (!b) return; const md = AN.briefMarkdown(app), name = `ARES-briefing-${app.out.sc.code}-run${app.run.id}.md`;
  if (b.dataset.brief === 'copy') { app.copyText(md, 'Briefing'); return; }
  if (b.dataset.brief === 'view') { app.modal('Operational briefing — preview', `<pre style="white-space:pre-wrap;font:12px/1.5 var(--f-mono);max-height:70vh;overflow:auto">${esc(md)}</pre>`); return; }
  try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); app.toast('Briefing downloaded — if nothing appears, use Copy as Markdown'); } catch (err) { app.copyText(md, 'Briefing'); } });
})(window.ARES);
