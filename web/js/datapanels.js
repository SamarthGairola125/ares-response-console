/* ARES simulation — "Show data" panels: inputs → interpretation → output → evaluation for every step */
(function (A) {
'use strict';
const C = A.core, Mo = A.model, DP = A.data = {};
const f0 = v => Math.round(v).toLocaleString('en-IN'), f1 = v => (+v).toFixed(1), f2 = v => (+v).toFixed(2), pc = v => (v * 100).toFixed(1) + '%';
const ll = (o, x, y) => (o.sc.lat + y / 111320).toFixed(4) + '°N, ' + (o.sc.lon + x / (111320 * Math.cos(o.sc.lat * Math.PI / 180))).toFixed(4) + '°E';
const sim = s => `<span data-sim>${s}</span>`, real = s => `<span data-real>${s}</span>`;
function tbl(head, rows, hov) { return `<div class="tw"><table class="t"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr class="${r.xy ? 'hov' : ''}" ${r.xy ? `data-x="${r.xy[0]}" data-y="${r.xy[1]}" data-r="${r.xy[2] || ''}"` : ''}>${r.c.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
function sec(title, body) { return `<div class="dsec"><h5>${title}</h5>${body}</div>`; }
function chk(rows) { return `<div class="chk">${rows.map(r => `<span class="${r[2] ? 'ok' : 'bad'}">${r[2] ? '✓' : '✕'}</span><span>${r[0]}</span><span class="v">${r[1]}</span>`).join('')}</div>`; }
function flow(a) { return `<div class="flow">${a.map((s, i) => (i ? '<em>→</em>' : '') + `<span>${s}</span>`).join('')}</div>`; }
const srcLinks = o => o.sc.sources.map(k => `<a href="${C.SRC[k].u}" target="_blank" rel="noopener">${C.SRC[k].t}</a>`).join('<br>') || 'Hypothetical scenario — no real source.';
function topCells(o, vals, n) { const a = []; for (let c = 0; c < o.B.N; c++) a.push([vals[c], c]); return a.sort((x, y) => y[0] - x[0]).slice(0, n).map(v => v[1]); }

DP.build = function (step, o, ui) {
  const s = o.steps, B = o.B, P = o.P, T = o.T, M = o.M, p = o.p, sc = o.sc;
  switch (step) {
  case 1: return [
    sec('Data used', `<p class="lead">Real event record and alert feed for <b>${sc.name}</b>.</p>` + tbl(['Reported figure', 'Value', 'Source'], sc.reported.map(r => ({ c: [r[0], real(r[1]), r[2] ? 'Published report' : '—'] }))) + `<p class="src">${srcLinks(o)}</p>`),
    sec('How it is interpreted', `<div class="calc">incident point  = ${ll(o, M.incident[0], M.incident[1])}
area of interest = ${f1(T.S / 1000)} km × ${f1(T.S / 1000)} km around ${sc.lat}°N, ${sc.lon}°E
alerts received  = ${s.detect.alerts.length}
early SOS calls  = ${s.detect.early.length} <b>(simulated phones that reached a tower before networks failed)</b></div>`),
    sec('Output → next step', flow(['Incident record ' + sc.code, 'AOI box', 'Early SOS points']) + tbl(['Alert', ''], s.detect.alerts.map(a => ({ c: [a, ''] })))),
    sec('Evaluation', chk([['Incident inside area of interest', 'yes', true], ['Early SOS calls located', sim(s.detect.early.length), s.detect.early.length > 0], ['Real figures cited', sc.sources.length ? 'yes' : 'hypothetical', true]])),
  ].join('');
  case 2: { const cls = new Array(10).fill(0); for (let k = 0; k < T.G * T.G; k++) cls[T.cls[k]]++; const ca = T.cell * T.cell / 1e6; const c = topCells(o, B.sev, 1)[0];
    return [
    sec('Data used', `<p class="lead">Terrain grid ${T.G}×${T.G} (${f1(T.cell)} m cells), elevation ${f0(T.base)}–${f0(T.top)} m ${T.real ? real('(Copernicus DEM, real)') : sim('(geography-shaped, not a DEM)')}; land cover ${M.real ? '(ESA WorldCover 2021)' : ''}, rivers ${M.real ? '(OpenStreetMap)' : ''}, ${f0(M.buildings.length)} buildings ${M.real ? '(OSM + Google Open Buildings)' : ''}.</p>` + tbl(['Land cover', 'Area km²'], cls.map((n, i) => ({ c: [C.CLS_NAME[i], f2(n * ca)] })).filter(r => r.c[1] !== '0.00'))),
    sec('How it is interpreted', `<div class="calc">severity(cell) = 0.03 + 0.97 · min(1, 2.2·damaged_share + 0.55·nearby_damage)^1.3
example cell #${c} at ${ll(o, B.cx[c], B.cy[c])}
  damaged_share = <b>${f2(B.dfrac[c])}</b>   → severity = <b>${f2(B.sev[c])}</b></div>`),
    sec('Output → next step', flow(['Damage area ' + f2(s.evaluate.dmgKm2) + ' km²', 'Severity per cell', 'Belief State']) + tbl(['Severity band', 'Cells'], s.evaluate.sevHist.map((n, i) => ({ c: [(i * 0.2).toFixed(1) + '–' + ((i + 1) * 0.2).toFixed(1), n] })))),
    sec('Hazard overlays on the map (how they are drawn)', M.real ? `<p class="lead">${M.flood ? 'The glowing area is <b>inundation observed by Sentinel-1 radar</b> (water on the post-event date that was dry in the dry-season baseline and is not routinely wet in the JRC 1984–2021 record).' : sc.id === 'delhi' ? 'The red zone is the <b>hypothetical</b> collapse model; there is no observed damage.' : '<b>Scour and debris observed by Sentinel-2</b>: vegetation loss / fresh bare ground between the pre- and post-event images, constrained to drainage lines.'} The boundary is traced on that mask with marching squares. ${A.hazard.path ? 'The yellow dashed line is the <b>path of steepest descent on the DEM</b> from the top of the observed scour, with the nearest named places; orange arrows point downslope.' : ''} ${M.flood ? 'The yellow dashed circle marks where the breach was reported (Kurua); its exact point is not mapped, so it is shown as a ±1.5 km zone.' : ''} These are derived indicators, not official damage maps, and there is no time-stepped flow simulation.</p>` : `<p class="lead">Synthetic fallback: the hazard area and channel are procedural geometry, not observations.</p>`),
    sec('Evaluation', chk([['Collapsed / buried structures', sim(f0(s.evaluate.collapsed)), true], ['Flooded houses', sim(f0(s.evaluate.flooded)), true], ['Damage footprint mapped', f2(s.evaluate.dmgKm2) + ' km²', s.evaluate.dmgKm2 > 0]])),
  ].join(''); }
  case 3: { const top = topCells(o, B.lam, 8), c = top[0], occ = B.occ[c]; let inTop = 0; const cut = topCells(o, B.lam, Math.round(B.N * 0.2)), cs = new Set(cut); for (let i = 0; i < P.n; i++) if (cs.has(B.cellOf(P.x[i], P.y[i]))) inTop++;
    return [
    sec('Data used', `<p class="lead">${M.real ? `Building footprints × residents from WorldPop 2020 (shared by footprint area within each ${Math.round(B.cs)} m cell; ${f0(s.belief.resident || 0)} residents in the area, ${f0(s.belief.exposed || 0)} in or next to the observed hazard)` : `Building inventory × occupancy (${sc.occ} people per house; floors × 4 × 0.35 in Delhi)`} and the severity map. The total is then scaled to the number the scenario assumes need help (${sim(f0(sc.people))}) — an assumption, not a reported figure.</p>`),
    sec('How it is interpreted', `<div class="calc">λ(cell) = (Σ occupants) · severity + 0.02 · severity, then × scale${B.bgShare ? `
stage-10 estimator prior: (1 − β) · λ + β · people · land share(cell),  β = <b>${pc(B.bgShare)}</b> dispersed people (assumption)` : ''}
cell #${c}: occupants = <b>${f1(occ)}</b>, severity = <b>${f2(B.sev[c])}</b>
         λ = <b>${f2(B.lam[c])}</b> expected people   · priority P${B.prio[c]} (k = ${B.prio[c] === 3 ? p.k : 1})</div>`),
    sec('Output → next step (hover to locate)', tbl(['Cell', 'Location', 'λ expected', 'Priority'], top.map(c => ({ xy: [B.cx[c], B.cy[c], B.cs], c: ['#' + c, ll(o, B.cx[c], B.cy[c]), sim(f1(B.lam[c])), 'P' + B.prio[c]] })))),
    sec('Evaluation (simulation only)', chk([['True people inside top-20% belief cells', sim(pc(inTop / P.n)), inTop / P.n > 0.5], ['Expected total', sim(f0(s.belief.lamTot)), true], ['Priority-3 cells', s.belief.p3, true]])),
  ].join(''); }
  case 4: { const k = s.koopman, top = topCells(o, k.phi, 6); let effCov = 0, effTot = 0; const cov = new Uint8Array(B.N); o.nodes.forEach(n => { for (let c = 0; c < B.N; c++) if (o.cc.cov[n.site * B.N + c]) cov[c] = 1; }); for (let c = 0; c < B.N; c++) { effTot += k.phi[c]; if (cov[c]) effCov += k.phi[c]; }
    return [
    sec('Data used', `<p class="lead">Belief State probabilities p(c) = λ(c)/Σλ and the total sensing effort the fleet can provide: about ${f1(p.Kmax * 0.6)} aerostats × ${f1(k.cellsPerNode)} cells per footprint.</p>`),
    sec('How it is interpreted', `<div class="calc">Koopman (1957) optimal search density, exponential detection:
  φ(c) = max(0, ln p(c) − ln μ),   with μ chosen so Σ φ = Φ
  Φ = <b>${f1(k.effort)}</b>   →   ln μ = <b>${f2(k.mu)}</b>
  P(detect | optimal effort) = Σ p(c)(1 − e^−φ(c)) = <b>${pc(k.pDetect)}</b></div>`),
    sec('Output → next step', tbl(['Cell', 'Location', 'p(c)', 'Effort φ'], top.map(c => ({ xy: [B.cx[c], B.cy[c], B.cs], c: ['#' + c, ll(o, B.cx[c], B.cy[c]), (B.lam[c] / s.belief.lamTot).toFixed(4), f2(k.phi[c])] })))),
    sec('Evaluation', chk([['Effort mass inside the final aerostat footprints', pc(effCov / (effTot || 1)), effCov / (effTot || 1) > 0.6], ['Cells that deserve effort', Array.from(k.phi).filter(v => v > 0).length, true]])),
  ].join(''); }
  case 5: { const rj = s.sites.rejected, ex = rj[0], vs = o.sites[0];
    return [
    sec('Data used', `<p class="lead">${f0(o.sites.length + rj.length)} candidate tether points (grid, roads${M.parks ? ', parks and intersections' : ''}, settlement edges) checked against the terrain grid.</p>` + tbl(['Rule', 'Threshold'], [{ c: ['Water / flood', M.water != null ? 'ground > ' + f1(M.water + 0.5) + ' m' : 'not in channel'] }, { c: ['Debris / scour', 'excluded'] }, { c: ['Slope', '≤ ' + Math.round(Math.atan(M.maxSlope) * 57.3) + '° (roads exempt)'] }, { c: ['Buildings / rubble', 'excluded'] }, { c: ['Canopy', 'excluded on slopes'] }])),
    sec('How it is interpreted', `<div class="calc">${ex ? `rejected @ ${ll(o, ex.x, ex.y)}
  class = ${C.CLS_NAME[ex.cls]}, slope = ${Math.round(Math.atan(ex.slope) * 57.3)}°  → <b>${ex.why}</b>` : ''}
${vs ? `accepted @ ${ll(o, vs.x, vs.y)}
  class = ${C.CLS_NAME[vs.cls]}, slope = ${Math.round(Math.atan(vs.slope) * 57.3)}°, ground = ${f0(vs.z0)} m` : ''}</div>`),
    sec('Output → next step', flow([o.sites.length + ' valid sites', 'Coverage model']) + tbl(['Rejection reason', 'Sites'], Object.entries(s.sites.why).map(([k, v]) => ({ c: [k, v] })))),
    sec('Evaluation', chk([['Valid launch sites', o.sites.length, o.sites.length > 0], ['Demand reachable from valid sites', pc(o.reach), o.reach > 0.8]])),
  ].join(''); }
  case 6: { const j = o.steps.coverage.perSite.indexOf(Math.max(...o.steps.coverage.perSite)), st = o.sites[j], hz = st.z0 + p.h; let c = -1, bd = 1e9; for (let q = 0; q < B.N; q++) if (o.cc.cov[j * B.N + q]) { const d = Math.hypot(B.cx[q] - st.x, B.cy[q] - st.y); if (Math.abs(d - Mo.footR(p, p.h) * 0.6) < bd) { bd = Math.abs(d - Mo.footR(p, p.h) * 0.6); c = q; } }
    let ex = ''; if (c >= 0) { const d = Math.hypot(B.cx[c] - st.x, B.cy[c] - st.y), r = Mo.footR(p, hz - B.cz[c]), ob = Mo.losObs(T, st.x, st.y, hz, B.cx[c], B.cy[c], B.cz[c], 16), R = Math.hypot(d, hz - B.cz[c]), gsd = R * (p.fov * Math.PI / 180) / p.camPx, J = Mo.camPd(p, R), pd = p.P0 * J * Mo.attOf(B.ccls[c], 0, p), u = Mo.uplink(T, p, o.E, st.x, st.y, hz, B.cx[c], B.cy[c], B.cz[c], o.shadow(B.cx[c], B.cy[c]) * p.sigma);
      ex = `site → cell #${c}:  horizontal d = <b>${f0(d)} m</b>, height above cell = ${f0(hz - B.cz[c])} m
footprint r = h·tan(FOV/2) − drift = ${f0(hz - B.cz[c])}·tan(${p.fov / 2}°) − ${p.drift} = <b>${f0(r)} m</b>
line of sight: max obstruction = ${f1(ob)} m → ${ob <= 2 ? 'clear' : 'blocked'}
slant range R = ${f0(R)} m → pixel on the ground = R·FOV/${p.camPx} px = ${f2(gsd)} m → ${f2(p.tgt / (2 * gsd))} cycles across a ${p.tgt} m person
P_d = P₀·J(R)·τ = ${p.P0}·${f2(J)}·τ(${C.CLS_NAME[B.ccls[c]]}) = <b>${f2(pd)}</b>  (threshold ${p.pThr}; J = Johnson detection curve, N50 = ${p.N50})
uplink @866 MHz: θ = ${f1(u.th)}°, P_LoS = ${f2(u.pL)}, path loss = ${f1(u.pl)} dB
  P_rx = ${p.ptBeacon} + ${p.gNode} − ${f1(u.pl)} + X_σ = <b>${f1(u.rx)} dBm</b>, margin = <b>${f1(u.rx - p.sens)} dB</b> (need ≥ ${p.fade})`; }
    return [
    sec('Data used', tbl(['Parameter', 'Value'], [['Hover height', p.h + ' m AGL'], ['Camera FOV', p.fov + '°'], ['Drift radius', p.drift + ' m (from wind ' + sc.cond.wind + ' km/h)'], ['P₀ / threshold', p.P0 + ' / ' + p.pThr], ['Canopy transmission', p.canopy], ['Device Tx', p.ptBeacon + ' dBm'], ['Aerostat Tx', p.ptNode + ' dBm — to be confirmed'], ['Rx sensitivity', p.sens + ' dBm'], ['Shadowing σ / corr.', p.sigma + ' dB / ' + p.corr + ' m'], ['Radio environment', o.E.label + ' (a=' + o.E.a + ', b=' + o.E.b + ')']].map(r => ({ c: r })))),
    sec('How it is interpreted (worked example)', `<div class="calc">${ex}</div>`),
    sec('Output → next step', flow([`${o.sites.length} sites × ${B.N} cells`, 'binary coverage matrix', 'Greedy']) + `<p class="src">${f0(o.cc.cov.reduce((a, b) => a + b, 0))} site–cell pairs pass every test.</p>`),
    sec('Evaluation', chk([['Maximum reachable weighted demand', pc(o.reach), o.reach > 0.8], ['Best single site covers', o.steps.coverage.perSite[j] + ' cells', true]])),
  ].join(''); }
  case 7: { const op = s.optimise, b = op.base;
    return [
    sec('Data used', `<p class="lead">Coverage matrix, cell weights w = λ·(1.6 for P3, 1.2 for P2), k = ${p.k} for priority-3 cells, target ${pc(o.tEff)}${o.tEff < p.target ? ' (capped from ' + pc(p.target) + ': valid sites reach only ' + pc(o.reach) + ')' : ''}, budget ${p.Kmax} aerostats.</p>`),
    sec('How it is interpreted', `<div class="calc">Location Set Covering Problem: minimise |N| s.t. Σ w·min(c,k)/k ≥ target·Σ w
Greedy: repeatedly add the site with the largest weighted marginal gain.
Guarantee: |N_greedy| ≤ (ln n + 1)·|N_opt|  (n = ${B.N} cells)</div>` + tbl(['#', 'Site', 'Gain', 'Cumulative'], op.sol.map((q, i) => ({ xy: [o.sites[q.site].x, o.sites[q.site].y, Mo.footR(p, p.h)], c: ['A-' + String(i + 1).padStart(2, '0'), ll(o, o.sites[q.site].x, o.sites[q.site].y), '+' + pc(q.gain), pc(q.cov)] })))),
    sec('Output → next step', flow([op.sol.length + ' sensing aerostats', 'Deployment'])),
    sec('Evaluation', chk([['Target met', pc(op.cov) + ' ≥ ' + pc(o.tEff), op.met], ['Lower bound (target ÷ best single node)', '≥ ' + op.lb, true], ['k-means needs', b.needKmeans == null ? '> ' + (b.kmeans.length - 1) : b.needKmeans, b.needKmeans == null || b.needKmeans >= op.sol.length], ['Random needs', b.needRandom == null ? '> ' + (b.random.length - 1) : b.needRandom, true], ['Uniform grid', b.grid.n + ' nodes → ' + pc(b.grid.cov), b.grid.n >= op.sol.length]])),
  ].join(''); }
  case 8: { const con = s.deploy.con, i0 = o.nodes.findIndex(n => n.par === -1), nd = o.nodes[Math.max(0, i0)], st = o.sites[nd.site], D = Math.hypot(st.x - M.icp[0], st.y - M.icp[1]);
    return [
    sec('Data used', `<p class="lead">Aerostat list, command post at ${ll(o, M.icp[0], M.icp[1])}, two launch teams moving at ${sc.teamKmh} km/h on this terrain (route factor 1.4) plus 25 min to inflate and raise each aerostat.</p>`),
    sec('How it is interpreted', `<div class="calc">backhaul ICP → ${nd.id}: D = ${f0(D)} m horizontal
  P_rx − S = P_tx + 2G + 3 − FSPL(D) − L_diff − S_bb
         = ${p.ptNode} + ${2 * p.gNode} + 3 − ${f1(Mo.fspl(D))} − L_diff − (${p.sensBB}) = <b>${f1(nd.marg || 0)} dB</b>  (need ≥ ${p.fade})
ETA = route_km / speed + 25 min = <b>${nd.eta} min</b> (team ${nd.team})</div>`),
    sec('Output → next step', tbl(['Node', 'Role', 'Team', 'Route km', 'ETA', 'Hops', 'Link margin'], o.nodes.map(n => ({ xy: [o.sites[n.site].x, o.sites[n.site].y, 60], c: [n.id, n.role + (n.replan ? ' (replan)' : ''), n.team, f1(n.km || 0), sim(n.eta + ' min'), n.hop > 0 ? n.hop : '—', n.marg != null ? f1(n.marg) + ' dB' : '<span class="bad">no link</span>'] })))),
    sec('Evaluation', chk([['Aerostats linked to command post', con.ok.filter(Boolean).length + ' / ' + o.nodes.length, con.ok.every(Boolean)], ['Relays added for terrain blocking', s.deploy.relays, true], ['Max relay hops', Math.max(...con.hop), Math.max(...con.hop) <= 4]])),
  ].join(''); }
  case 9: { const q = s.update.sense; let ex = -1; for (let i = 0; i < P.n; i++) if (P.via[i] === 'thermal') { ex = i; break; }
    return [
    sec('Data used', `<p class="lead">${sim('Simulated')} people (hidden from the planner until detected), ${pc(p.devFrac)} carrying a working phone or beacon, detection model from step 6, aerostat access radius ${p.commR} m.</p>`),
    sec('How it is interpreted', `<div class="calc">${ex >= 0 ? `person #${ex} (${C.CLS_NAME[P.cls[ex]]}, P${P.prio[ex]}) inside ${o.nodes[P.detBy[ex]].id}'s footprint
  thermal detection drawn with probability P_d → <b>detected</b>` : ''}
beacon contact if device present and uplink margin ≥ ${p.fade} dB within ${p.commR} m
edge-AI on the aerostat: person detector on EO/IR frames <b>(simulated as P_d draws)</b></div>`),
    sec('Output → next step', flow([q.det + ' located', q.thermal + ' thermal', q.beacon + ' beacon', 'Belief update'])),
    sec('Evaluation (simulation only)', chk([['Detection rate (all people)', sim(pc(q.rate)), q.rate > 0.6], ['Priority-weighted rate', sim(pc(q.wRate)), q.wRate > 0.6], ['People inside any footprint', sim(q.inView), true], ['Uplink outage (devices in view, no link)', sim(pc(q.outage)), q.outage < 0.15]])),
  ].join(''); }
  case 10: { const u = s.update, g = o.gp2, c = topCells(o, g.est, 1)[0];
    return [
    sec('Data used', `<p class="lead">Observed cells (inside footprints): ${u.gp2.obs} used as GP training points; confirmed counts per cell; prior λ; SOS cluster report at ${u.sos ? ll(o, u.sos.x, u.sos.y) : '—'} (${u.sos ? sim(u.sos.n + ' people') : ''}).</p>`),
    sec('How it is interpreted', `<div class="calc">residual  y(c) = ln((confirmed + 0.3) / (P_d·λ + 0.3))
GP: RBF kernel, ℓ = ${f0(T.S / 14)} m, σ_f² = 0.6, σ_n² = 0.25 → mean m(c), variance v(c)
estimate  N(c) = confirmed + λ·e^m(c)·(1 − P_d)   (unobserved: λ·e^m(c))
cell #${c}: confirmed ${f0(g.obsCnt[c])}, λ ${f2(B.lam[c])}, m ${f2(g.gp.mean[c])} → N = <b>${f1(g.est[c])}</b> ± ${f1(g.sd[c])}
Replan: greedy on N(c) with all ${o.nodes.length - u.added} existing aerostats fixed → <b>+${u.added}</b> aerostats</div>`),
    sec('Output → next step', flow(['Estimate ' + f0(u.gp2.estTotal) + ' ± ' + f0(1.64 * u.gp2.estSd), 'Sectors'])),
    sec('Evaluation (simulation only)', chk([['Estimate vs ground truth (total)', sim(f0(u.gp2.estTotal) + ' vs ' + f0(u.gp2.trueTotal)), Math.abs(u.gp2.estTotal - u.gp2.trueTotal) / u.gp2.trueTotal < 0.35], ['Located after replanning', sim(f0(u.gp2.confirmed)), u.gp2.confirmed >= u.gp1.confirmed], ['Existing aerostats moved', '0 (stationary)', true]])),
  ].join(''); }
  case 11: { const rs = o.sectors;
    return [
    sec('Data used', `<p class="lead">GP estimate per cell, aerostat footprints, terrain cost surface for routes (slope, water${C.isFlood(M) ? ' by boat' : ''}, debris, rubble, OSM roads).</p>`),
    sec('How it is interpreted', `<div class="calc">sector(c) = argmin_j  distance(c, j) / r_j      (weighted Voronoi, relays excluded)
priority score = N_est × (2 for P3, 1.4 for P2)  → ranked
route = A* over terrain grid, cost = 1 + 6·slope² × class factor</div>`),
    sec('Output → rescue teams (hover to locate)', tbl(['Rank', 'Sector', 'Confirmed', 'Estimated (90%)', 'Priority', 'Access'], rs.map(r => ({ xy: [r.cx, r.cy, 120], c: [r.rank, r.id, sim(f0(r.conf)), sim(f0(r.est) + ' ± ' + f0(1.64 * r.sd)), `<span class="pill p${r.pri}">P${r.pri}</span>`, r.route ? f1(r.route.len / 1000) + ' km' + (r.route.boat ? ' (boat)' : '') : '—'] })))),
    sec('Evaluation (simulation only)', chk([['Mean abs. error per sector', sim(f1(s.handover.mae) + ' people'), s.handover.mae < 10], ['Routes found to top sectors', s.handover.routes + ' / 6', s.handover.routes >= 4], ['Most valuable aerostat (Shapley)', o.nodes.slice().sort((a, b) => b.shap - a.shap)[0].id, true]])),
  ].join(''); }
  }
  return '';
};
})(window.ARES);
