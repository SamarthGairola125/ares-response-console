/* Runs the console's own code path (A.live.runFull with the frozen REPLAY inputs, as js/liveui.js does in the browser) for all scenarios */
import { createRequire } from 'module'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url), root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { loadARES, useLocalData } = require('../core/load.cjs'); useLocalData(path.join(root, 'data/packs')); const A = loadARES(), C = A.core, PK = A.pack, L = A.live;
const rows = [];
for (const sc of C.SCENARIOS) { const P = await PK.load(sc.id); sc.lat = P.aoi.lat; sc.lon = P.aoi.lon; sc.S = P.aoi.S;
  const sn = JSON.parse(fs.readFileSync(path.join(root, 'data/packs', sc.id, 'v8/inputs.json'), 'utf8')); const hb = fs.existsSync(path.join(root, 'data/packs', sc.id, 'population/hrsl_belief.f32.b64.txt'));
  const ctx = { use: L.REC, eventTime: sn.eventTime, alerts: sn.alerts, weather: sn.weather && !sn.weather.error ? sn.weather : null, imaging: sn.imaging, imagery: sn.imaging, airports: sn.airports.items, gnss: sn.gnss, routesXY: sn.routes.byXY, zones: [], teams: 2 };
  const t = Date.now(); try { const o = L.runFull(sc, {}, PK.build(sc, P), ctx); const pre = o.nodes.slice(0, o.preNodes);
    rows.push({ id: sc.id, ok: true, pre: pre.length, all: o.nodes.length, cov: +o.steps.optimise.cov.toFixed(3), shareHours: o.steps.optimise.shareOfTimeMet, lastUp: Math.max(...pre.map(n => n.etaHeld ?? n.eta)), roads: pre.filter(n => /OSRM/.test(n.travelSrc)).length, cut: pre.filter(n => /cut/.test(n.travelSrc)).length, heights: [...new Set(pre.map(n => n.h))].join('/'), gnss: o.inputs.gnss, ms: Date.now() - t, hrsl: hb });
  } catch (e) { rows.push({ id: sc.id, ok: false, err: e.stack.split('\n').slice(0, 4).join(' | ') }); } }
for (const r of rows) console.log(JSON.stringify(r));
fs.writeFileSync(path.join(root, 'tests/results/console_path.json'), JSON.stringify(rows, null, 1));
