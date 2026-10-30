/* ARES simulation — right-hand inspector tabs */
(function (A) {
'use strict';
const C = A.core, Mo = A.model, PN = A.panels = {};
const f0 = v => Math.round(v).toLocaleString('en-IN'), f1 = v => (+v).toFixed(1), pc = v => (v * 100).toFixed(1) + '%';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

PN.LAYERS = [
  { g: 'Hazard', k: 'hazGlow', t: 'Hazard area (glow)', sw: 'radial-gradient(#5a3a30 45%,#f05a24 60%,transparent 75%)' },
  { g: 'Hazard', k: 'boundary', t: 'Hazard boundary', sw: 'repeating-linear-gradient(90deg,#fff 0 5px,transparent 5px 8px) center/100% 2px no-repeat,#6b5a4a' },
  { g: 'Hazard', k: 'path', t: 'Mapped runout path & markers', sw: 'repeating-linear-gradient(90deg,#f2b632 0 6px,transparent 6px 9px) center/100% 3px no-repeat' },
  { g: 'Hazard', k: 'arrows', t: 'Flow direction (downslope)', sw: 'linear-gradient(135deg,transparent 42%,#f05a24 42% 58%,transparent 58%)' },
  { g: 'Hazard', k: 'damage', t: 'Damage cells (raster)', sw: '#d9531e', a: true },
  { g: 'Hazard', k: 'drainage', t: 'Drainage / rivers', sw: 'linear-gradient(160deg,transparent 40%,#3f79b5 40% 60%,transparent 60%)' },
  { g: 'Model', k: 'bars', t: 'Belief State (3D bars)', sw: 'linear-gradient(90deg,#fff3c4,#d9531e,#8f1f1a)' },
  { g: 'Model', k: 'belief', t: 'People density (map)', sw: 'linear-gradient(90deg,#fff3c4,#f08a3c,#8f1f1a)', a: true },
  { g: 'Model', k: 'effort', t: 'Search effort (Koopman)', sw: 'linear-gradient(90deg,#d6f0e0,#3fa58a,#16365a)', a: true },
  { g: 'Model', k: 'unc', t: 'Uncertainty (GP σ)', sw: 'linear-gradient(90deg,#e8e4f4,#7f63c4,#2a1060)', a: true },
  { g: 'Model', k: 'signal', t: 'Uplink signal (866 MHz)', sw: 'linear-gradient(90deg,#3b1f4a,#e88a2a,#fbf3b0)', a: true },
  { g: 'Model', k: 'sectors', t: 'Rescue sectors', sw: 'conic-gradient(#d9531e 0 25%,#2b6cb0 0 50%,#2f8a55 0 75%,#b8860b 0)', a: true },
  { g: 'Field assets', k: 'sites', t: 'Launch sites', sw: 'radial-gradient(#2f8a55 40%,transparent 45%)' },
  { g: 'Field assets', k: 'cones', t: 'Coverage cones', sw: 'linear-gradient(180deg,transparent,#d9531e55)' },
  { g: 'Field assets', k: 'links', t: 'Backhaul links', sw: 'linear-gradient(135deg,transparent 45%,#2b6cb0 45% 55%,transparent 55%)' },
  { g: 'Field assets', k: 'people', t: 'People located', sw: 'radial-gradient(#ff7a2f 35%,transparent 40%)' },
  { g: 'Field assets', k: 'truth', t: 'Ground truth (sim only)', sw: 'radial-gradient(#9a9a92 35%,transparent 40%)' },
  { g: 'Field assets', k: 'routes', t: 'Access routes', sw: 'linear-gradient(135deg,transparent 40%,#f2b632 40% 60%,transparent 60%)' },
  { g: 'Display', k: 'terrain', t: 'Terrain (3D)', sw: 'linear-gradient(135deg,#c9b48a,#6b5a44)', fixed: true },
  { g: 'Display', k: 'context', t: 'Context terrain (illustrative)', sw: 'linear-gradient(135deg,#d8cfbd,#9a8f7c)' },
  { g: 'Display', k: 'roads', t: 'Roads', sw: 'linear-gradient(160deg,transparent 40%,#eeeae2 40% 60%,transparent 60%),#6b6a66' },
  { g: 'Display', k: 'buildings', t: 'Structures', sw: '#c9bfae' },
  { g: 'Display', k: 'trees', t: 'Vegetation', sw: '#3d5a2f' },
  { g: 'Display', k: 'labels', t: 'Labels', sw: 'linear-gradient(#222,#222) center/60% 3px no-repeat' },
];
PN.MODES = [['natural', 'Natural terrain', 'Earth tones, sun shadows, hazard area glow'], ['hazard', 'Hazard intensity', 'Damage severity index 0–1 (step 2 model)'], ['thermal', 'Thermal-style', 'Estimated people per hectare — a palette, not temperature'], ['gray', 'Grayscale relief', 'Monochrome hillshade with contours']];

PN.layers = function (app) {
  const o = app.out, sc = o.sc, L = app.L;
  const rep = sc.reported.map(r => `<dt>${esc(r[0])}</dt><dd data-real>${esc(r[1])}</dd>`).join('');
  const row = l => { const st = L[l.k] || { on: true, a: 1 }; return `<div class="layer ${st.on ? '' : 'off'}"><input type="checkbox" data-layer="${l.k}" ${st.on ? 'checked' : ''} ${l.fixed ? 'disabled' : ''} aria-label="${l.t}"><span class="sw" style="background:${l.sw}"></span><span>${l.t}</span>${l.a ? `<input type="range" min="0" max="100" value="${Math.round((st.a ?? 1) * 100)}" data-alpha="${l.k}" aria-label="${l.t} opacity"><span class="pct">${Math.round((st.a ?? 1) * 100)}%</span>` : '<span></span><span></span>'}</div>`; };
  const groups = ['Hazard', 'Model', 'Field assets', 'Display'];
  return `<details class="card" open><summary><h4>Visualization mode</h4></summary><div class="modes-list">${PN.MODES.map(([k, t, d]) => `<label class="moderow"><input type="radio" name="vmode" value="${k}" ${app.mode === k ? 'checked' : ''}><span><b>${t}</b><small>${d}</small></span></label>`).join('')}</div></details>` +
  groups.map((g, gi) => `<details class="card" ${gi < 2 || app.openGroups?.[g] ? 'open' : ''} data-group="${g}"><summary><h4>${g === 'Hazard' ? 'Hazard layers' : g === 'Model' ? 'Model layers' : g}</h4></summary><div>${PN.LAYERS.filter(l => l.g === g).map(row).join('')}</div></details>`).join('') +
  `<details class="card" open><summary><h4>Incident overview <small class="mono">${sc.code}</small></h4></summary><dl class="kv"><dt>Incident</dt><dd>${esc(sc.name)}</dd><dt>Location</dt><dd>${esc(sc.place)}</dd><dt>Centre</dt><dd class="mono">${sc.lat.toFixed(3)}°N, ${sc.lon.toFixed(3)}°E</dd><dt>Start</dt><dd data-real>${esc(sc.start)}</dd><dt>Type</dt><dd>${esc(sc.type)}</dd>${rep}<dt>Status</dt><dd>Step ${app.step} of 11 — ${A.pipe.STEPS[app.step - 1].t}</dd></dl>
  <p class="src">${sc.sources.map(k => `<a href="${C.SRC[k].u}" target="_blank" rel="noopener">${esc(C.SRC[k].t)}</a>`).join('<br>') || 'Hypothetical scenario — not a real event.'}</p></details>
  <details class="card"><summary><h4>Conditions <small>scenario assumptions</small></h4></summary><div class="cond"><div>Wind<b data-sim>${sc.cond.wind} km/h</b></div><div>Temp<b data-sim>${sc.cond.temp} °C</b></div><div>Drift radius<b>${o.p.drift} m</b></div><div>Rain<b style="font-size:12px" data-sim>${esc(sc.cond.rain)}</b></div><div>Water<b style="font-size:12px" data-sim>${esc(sc.cond.water)}</b></div><div>Visibility<b style="font-size:12px" data-sim>${esc(sc.cond.vis)}</b></div></div></details>
  <details class="card"><summary><h4>Terrain & data</h4></summary><p class="src" style="margin:0">${o.T.real ? '<b class="ok">Real elevation loaded</b> from your GeoTIFF.' : 'Shaped from the area’s real geography (rivers, valleys, elevation range, settlements). Live elevation services are unreachable from the build environment.'} Drop a free 30 m DEM (Copernicus GLO-30 / SRTM GeoTIFF from OpenTopography) to rebuild on true terrain.</p><button class="btn" id="btnDEM">Load real elevation (GeoTIFF)</button><p class="src mono" style="margin:0">Suggested box: ${(sc.lat - sc.S / 222640).toFixed(3)}–${(sc.lat + sc.S / 222640).toFixed(3)}°N, ${(sc.lon - sc.S / 222640 / Math.cos(sc.lat * Math.PI / 180)).toFixed(3)}–${(sc.lon + sc.S / 222640 / Math.cos(sc.lat * Math.PI / 180)).toFixed(3)}°E</p><p class="src" style="margin:0">Analysis area ${(o.T.S / 1000).toFixed(1)} × ${(o.T.S / 1000).toFixed(1)} km, ${o.T.G}×${o.T.G} grid (${o.T.cell.toFixed(1)} m), vertical exaggeration ×${o.T.vex}. Terrain beyond the dashed white box is illustrative context only and is not used by the model.</p></details>`;
};

PN.nodes = function (app) {
  const o = app.out, sel = app.sel; const vis = app.visibleNodes();
  const list = o.nodes.map((n, i) => { const s = o.sites[n.site]; const shown = vis.includes(i); return `<div class="nodecard ${sel === i ? 'sel' : ''}" data-node="${i}" style="${shown ? '' : 'opacity:.45'}"><span class="id">${n.id}</span><span><span class="role ${n.replan ? 'replan' : n.role}">${n.replan ? 'replan' : n.role}</span></span><span class="mono" style="font-size:11px">${shown ? (n.hop > 0 ? n.hop + ' hop' : 'no link') : 'planned'}</span><span class="sm">Shapley ${pc(n.shap || 0)} · ETA ${n.eta} min · ${f0(s.z0)} m ground</span></div>`; }).join('');
  let det = '';
  if (sel != null && o.nodes[sel]) {
    const n = o.nodes[sel], s = o.sites[n.site], r = Mo.footR(o.p, o.p.h); let inF = 0, dN = 0; for (let i = 0; i < o.P.n; i++) { if (Math.hypot(o.P.x[i] - s.x, o.P.y[i] - s.y) <= r) inF++; if (o.P.detBy[i] === sel) dN++; }
    det = `<div class="card"><h4>${n.id} <small>${n.role === 'relay' ? 'relay aerostat' : 'sensing aerostat'}</small></h4><dl class="kv"><dt>Position</dt><dd class="mono">${(o.sc.lat + s.y / 111320).toFixed(5)}°N ${(o.sc.lon + s.x / (111320 * Math.cos(o.sc.lat * Math.PI / 180))).toFixed(5)}°E</dd><dt>Altitude</dt><dd>${o.p.h} m AGL · ${f0(s.z0 + o.p.h)} m MSL</dd><dt>Footprint</dt><dd>r = ${f0(r)} m · ${(Math.PI * r * r / 1e6).toFixed(3)} km²</dd><dt>Ground</dt><dd>${C.CLS_NAME[s.cls]}, slope ${Math.round(Math.atan(s.slope) * 57.3)}°</dd><dt>Greedy gain</dt><dd>${n.gain ? '+' + pc(n.gain) : '—'}</dd><dt>Shapley value</dt><dd>${pc(n.shap || 0)} of weighted coverage</dd><dt>If removed</dt><dd>−${pc(n.loo || 0)} coverage</dd><dt>People in footprint</dt><dd data-sim>${inF} (${dN} credited to this node)</dd><dt>Backhaul</dt><dd>${n.hop > 0 ? n.hop + ' hop(s), margin ' + f1(n.marg) + ' dB' : '<span class="bad">not linked</span>'}</dd><dt>Deploy</dt><dd data-sim>Team ${n.team}, ${f1(n.km || 0)} km, ETA ${n.eta} min</dd></dl>
    <div class="row" style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn" data-act="why">Why here?</button><button class="btn" data-act="feed">Camera view</button><button class="btn" data-act="fail">Failure drill</button></div><div id="drillOut"></div></div>`;
  }
  return det + `<div class="card"><h4>Aerostat fleet <small>${o.nodes.length} total · ${o.nodes.filter(n => n.role === 'relay').length} relay · ${o.nodes.filter(n => n.replan).length} replan</small></h4><div style="display:grid;gap:6px">${list}</div></div>`;
};

PN.PARAMS = [
  ['Aerial node (stationary aerostat)', [['h', 'Hover height AGL', 50, 400, 10, 'm'], ['fov', 'Camera field of view', 40, 140, 5, '°'], ['drift', 'Station-keeping drift', 0, 40, 1, 'm'], ['Kmax', 'Aerostats available', 4, 50, 1, '']]],
  ['Sensing', [['P0', 'Peak detection probability P₀', 0.5, 1, 0.01, ''], ['pThr', 'Detection threshold', 0.3, 0.9, 0.05, ''], ['canopy', 'Canopy transmission τ', 0.3, 1, 0.05, ''], ['camPx', 'Thermal camera width (effective)', 640, 3840, 320, 'px']]],
  ['Communication · 866 MHz', [['ptBeacon', 'Survivor device Tx', 0, 20, 1, 'dBm'], ['ptNode', 'Aerostat Tx', 10, 36, 1, 'dBm', 1], ['sens', 'Receiver sensitivity', -140, -100, 1, 'dBm'], ['fade', 'Fade margin', 0, 20, 1, 'dB'], ['sigma', 'Shadowing σ', 0, 12, 0.5, 'dB'], ['corr', 'Shadowing correlation', 10, 200, 10, 'm'], ['commR', 'Access radius', 300, 3000, 100, 'm']]],
  ['Optimisation', [['target', 'Coverage target (weighted)', 0.5, 0.99, 0.01, '%'], ['k', 'k-coverage for priority 3', 1, 3, 1, ''], ['fleetMax', 'Fleet limit incl. replanning', 5, 60, 1, '']]],
  ['Survivors', [['devFrac', 'Carrying a phone / beacon', 0, 1, 0.05, '%']]],
];
PN.model = function (app) {
  const p = app.out.p;
  const fmt = (v, u) => u === '%' ? Math.round(v * 100) + '%' : (Number.isInteger(+v) ? v : (+v).toFixed(2)) + (u ? ' ' + u : '');
  return `<div class="card"><h4>Run <small class="mono">seed ${p.seed} · ${app.out.ms} ms</small></h4><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn primary" id="btnRerun">Re-run model</button><button class="btn" id="btnSeed">New random seed</button><button class="btn" id="btnLatex">Copy LaTeX tables</button><button class="btn" id="btnJSON">Copy results JSON</button></div><p class="src" style="margin:0">Changes apply when you press Re-run, so the 3D view never stutters while you drag.</p></div>` +
  PN.PARAMS.map(([g, arr]) => `<div class="card"><h4>${g}</h4>${arr.map(([id, l, mn, mx, st, u, tbc]) => `<label class="param" for="p_${id}"><span>${l}${tbc ? '<span class="tbc">TO BE CONFIRMED</span>' : ''}</span><output id="o_${id}">${fmt(p[id], u)}</output><input type="range" id="p_${id}" data-param="${id}" data-u="${u}" min="${mn}" max="${mx}" step="${st}" value="${p[id]}"></label>`).join('')}</div>`).join('') +
  `<div class="card"><h4>Rules</h4><label class="param"><span>Coverage rule</span><select id="p_rule" data-param="rule"><option value="joint" ${p.rule === 'joint' ? 'selected' : ''}>Detect + link</option><option value="detect" ${p.rule === 'detect' ? 'selected' : ''}>Detection only</option></select></label><label class="param"><span>Radio environment</span><select id="p_env" data-param="env">${Object.entries(C.ENV).map(([k, v]) => `<option value="${k}" ${p.env === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label></div>
  <div class="card"><h4>Model equations</h4><div class="formula">footprint   r = h·tan(FOV/2) − drift
detection   P_d = P₀·J(R)·τ, needs clear line of sight
            J = x/(1+x), x = (N/N50)^E, E = 2.7 + 0.7·N/N50, N = ${p.tgt} m / (2·R·FOV/${p.camPx} px)   (Johnson criteria)
uplink      P_rx = P_tx + G − [FSPL + P_LoS·η_LoS + (1−P_LoS)·η_NLoS + L_diff] + X_σ
P_LoS(θ)    = 1 / (1 + a·e^(−b(θ − a)))       (Al-Hourani 2014)
X_σ         spatially correlated Gaussian, σ = ${p.sigma} dB, ${p.corr} m
objective   min |N|  s.t.  Σ w·min(c,k)/k ≥ target·Σ w
greedy      add argmax weighted marginal gain; ≤ (ln n + 1)·OPT
Koopman     φ(c) = max(0, ln p(c) − ln μ)
GP          RBF kernel on ln(confirmed / expected) residuals
sectors     weighted Voronoi, d / r_j
Shapley     ${120} sampled permutations of the final fleet</div><p class="src" style="margin:0">Not computed here (listed as future work): decentralised auction placement and multi-fidelity Bayesian optimisation. A plain height sweep is in Analysis.</p></div>`;
};

PN.analysis = function (app) {
  const o = app.out, op = o.steps.optimise, b = op.base, mc = app.mc, hs = app.hs;
  const rows = [['Greedy (ARES)', op.sol.length, pc(op.cov)], ['k-means + snap', b.needKmeans ?? '> ' + (b.kmeans.length - 1), pc(b.kmeans[b.needKmeans ?? b.kmeans.length - 1])], ['Random', b.needRandom ?? '> ' + (b.random.length - 1), pc(b.random[b.needRandom ?? b.random.length - 1])], ['Uniform hex grid', b.grid.n, pc(b.grid.cov)], ['Lower bound', '≥ ' + op.lb, '—']];
  return `<div class="card"><h4>Method comparison <small>nodes to reach ${pc(o.tEff)}</small></h4><table class="t"><thead><tr><th>Method</th><th>Nodes</th><th>Coverage</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r[0]}</td><td class="mono">${r[1]}</td><td class="mono">${r[2]}</td></tr>`).join('')}</tbody></table><button class="btn" id="btnCmp2">Show greedy vs k-means side by side</button></div>
  <div class="card"><h4>Monte Carlo <small>${mc ? mc.length + ' runs' : 'not run'}</small></h4>${mc ? `<canvas id="mcC" style="width:100%;height:110px"></canvas><dl class="kv"><dt>Aerostats</dt><dd class="mono">${f1(avg(mc.map(r => r.nodes)))} ± ${f1(sd(mc.map(r => r.nodes)))}</dd><dt>Detection rate</dt><dd class="mono" data-sim>${pc(avg(mc.map(r => r.det)))} ± ${pc(sd(mc.map(r => r.det)))}</dd><dt>Target met</dt><dd class="mono">${mc.filter(r => r.met).length}/${mc.length}</dd><dt>Sector error</dt><dd class="mono" data-sim>${f1(avg(mc.map(r => r.mae)))} people</dd></dl>` : '<p class="src" style="margin:0">Re-runs the whole pipeline with different survivor layouts and shadowing.</p>'}<button class="btn" id="btnMC">${mc ? 'Run again' : 'Run 30 trials'}</button><span id="mcProg" class="src"></span></div>
  <div class="card"><h4>Hover-height sweep</h4>${hs ? `<canvas id="hsC" style="width:100%;height:110px"></canvas><p class="src" style="margin:0">Aerostats needed for ${pc(o.tEff)} at each height (FOV ${o.p.fov}°).</p>` : ''}<button class="btn" id="btnHS">${hs ? 'Run again' : 'Run sweep'}</button></div>
  <div class="card"><h4>Shapley value per aerostat</h4><canvas id="shC" style="width:100%;height:110px"></canvas></div>`;
};
const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1), sd = a => { const m = avg(a); return Math.sqrt(avg(a.map(v => (v - m) ** 2))); };

PN.brief = function (app) {
  const o = app.out, rs = o.sectors || [], ready = app.step >= 11;
  return `<div class="card"><h4>Rescue briefing <small>${ready ? 'issued at step 11' : 'preview — final at step 11'}</small></h4><dl class="kv"><dt>Aerostats up</dt><dd>${o.nodes.length} (${o.nodes.filter(n => n.role === 'relay').length} relay)</dd><dt>Confirmed people</dt><dd data-sim>${f0(o.steps.update.gp2.confirmed)}</dd><dt>Estimated total</dt><dd data-sim>${f0(o.steps.update.gp2.estTotal)} ± ${f0(1.64 * o.steps.update.gp2.estSd)} (90%)</dd><dt>Command post</dt><dd class="mono">${(o.sc.lat + o.M.icp[1] / 111320).toFixed(4)}°N ${(o.sc.lon + o.M.icp[0] / (111320 * Math.cos(o.sc.lat * Math.PI / 180))).toFixed(4)}°E</dd></dl>
  <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn primary" id="btnCSV">Copy sector CSV</button><button class="btn" id="btnBriefJSON">Copy briefing JSON</button></div></div>
  <div class="card"><h4>Sectors by priority</h4><div class="tw"><table class="t"><thead><tr><th>#</th><th>Sector</th><th>Confirmed</th><th>Est. (90%)</th><th>Pri.</th><th>Route</th></tr></thead><tbody>${rs.map(r => `<tr class="hov" data-x="${r.cx}" data-y="${r.cy}" data-r="120"><td>${r.rank}</td><td class="mono">${r.id}</td><td class="mono" data-sim>${f0(r.conf)}</td><td class="mono" data-sim>${f0(r.est)}±${f0(1.64 * r.sd)}</td><td><span class="pill p${r.pri}">P${r.pri}</span></td><td class="mono">${r.route ? f1(r.route.len / 1000) + ' km' + (r.route.boat ? ' ⛵' : '') : '—'}</td></tr>`).join('')}</tbody></table></div></div>`;
};

PN.latex = function (o) {
  const p = o.p, s = o.steps, op = s.optimise, b = op.base;
  const rows = [['Area of interest', `${(o.T.S / 1000).toFixed(1)}\\,km $\\times$ ${(o.T.S / 1000).toFixed(1)}\\,km`], ['Belief grid', `${o.B.CB}$\\times$${o.B.CB} cells (${Math.round(o.B.cs)}\\,m)`], ['Hover height', `${p.h}\\,m AGL`], ['Camera FOV', `${p.fov}$^\\circ$`], ['Drift radius', `${p.drift}\\,m`], ['$P_0$ / threshold', `${p.P0} / ${p.pThr}`], ['Carrier', '866\\,MHz'], ['Device / aerostat Tx', `${p.ptBeacon} / ${p.ptNode}\\,dBm (TBC)`], ['Sensitivity', `${p.sens}\\,dBm`], ['Fade margin', `${p.fade}\\,dB`], ['Shadowing', `$\\sigma$=${p.sigma}\\,dB, ${p.corr}\\,m`], ['Coverage target', `${Math.round(o.tEff * 100)}\\%`], ['$k$ (priority 3)', p.k]];
  const t1 = `\\begin{table}[t]\\centering\\caption{ARES simulation parameters (${o.sc.name.replace(/&/g, '\\&')})}\\label{tab:params-${o.sc.id}}\n\\begin{tabular}{@{}ll@{}}\\toprule\nParameter & Value\\\\\\midrule\n${rows.map(r => r[0] + ' & ' + r[1] + '\\\\').join('\n')}\n\\bottomrule\\end{tabular}\\end{table}`;
  const t2 = `\\begin{table}[t]\\centering\\caption{Placement results (${o.sc.name.replace(/&/g, '\\&')})}\\label{tab:res-${o.sc.id}}\n\\begin{tabular}{@{}lrr@{}}\\toprule\nMethod & Nodes & Coverage\\\\\\midrule\nGreedy (ARES) & ${op.sol.length} & ${(op.cov * 100).toFixed(1)}\\%\\\\\n$k$-means & ${b.needKmeans ?? '$>$' + (b.kmeans.length - 1)} & --\\\\\nRandom & ${b.needRandom ?? '$>$' + (b.random.length - 1)} & --\\\\\nHex grid & ${b.grid.n} & ${(b.grid.cov * 100).toFixed(1)}\\%\\\\\nLower bound & $\\geq$${op.lb} & --\\\\\\bottomrule\\end{tabular}\\end{table}`;
  return t1 + '\n\n' + t2;
};
PN.crossTable = function (rows) {
  return `<p class="src" style="margin:0">Same model settings applied to all five scenarios (each with its own hover height, node budget, wind-driven drift and radio environment). People counts are simulated.</p><div class="tw"><table class="t"><thead><tr><th>Scenario</th><th>Aerostats</th><th>Relays</th><th>Lower bound</th><th>Coverage</th><th>k-means</th><th>Random</th><th>Detection rate</th><th>Sector error</th><th>Run</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.sc.name)}</td><td class="mono">${r.nodes}</td><td class="mono">${r.relays}</td><td class="mono">≥${r.lb}</td><td class="mono">${pc(r.cov)}</td><td class="mono">${r.km ?? '>' + '…'}</td><td class="mono">${r.rnd ?? '>…'}</td><td class="mono" data-sim>${pc(r.det)}</td><td class="mono" data-sim>${f1(r.mae)}</td><td class="mono">${r.ms} ms</td></tr>`).join('')}</tbody></table></div><button class="btn" id="btnCrossTex">Copy as LaTeX</button>`;
};
PN.crossLatex = rows => `\\begin{table*}[t]\\centering\\caption{ARES results across five disaster scenarios}\\label{tab:cross}\n\\begin{tabular}{@{}lrrrrrr@{}}\\toprule\nScenario & Nodes & Relays & LB & Coverage & $k$-means & Detection\\\\\\midrule\n${rows.map(r => `${r.sc.name.replace(/&/g, '\\&')} & ${r.nodes} & ${r.relays} & ${r.lb} & ${(r.cov * 100).toFixed(1)}\\% & ${r.km ?? '--'} & ${(r.det * 100).toFixed(1)}\\%\\\\`).join('\n')}\n\\bottomrule\\end{tabular}\\end{table*}`;
})(window.ARES);
