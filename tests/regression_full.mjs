/* v8 full console run (A.live.runFull: v8 stages 1–8 + v7 stages 9–11) with every input off must equal v7's A.pipe.run */
import { createRequire } from 'module'; import crypto from 'crypto'; import path from 'path'; import fs from 'fs'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url), root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { loadARES, useLocalData } = require('../core/load.cjs'); useLocalData(path.join(root, 'data/packs')); const A = loadARES(), C = A.core, PK = A.pack;
const H = x => { const h = crypto.createHash('sha256'); if (ArrayBuffer.isView(x)) h.update(Buffer.from(x.buffer, x.byteOffset, x.byteLength)); else h.update(JSON.stringify(x)); return h.digest('hex').slice(0, 16); };
const fp = o => ({ nodes: H(o.nodes.map(n => [n.site, n.role, n.id, n.eta, n.team, n.hop, n.par, n.marg, n.replan || false])), shap: H(o.shap), loo: H(o.nodes.map(n => n.loo)), detBy: H(o.P.detBy), via: H(o.P.via), gp1: H(o.gp1.est), gp2: H(o.gp2.est), sos: H(o.steps.update.sos), sense: H(o.steps.sense), upd: H(o.steps.update.sense), sectors: H(o.sectors.map(r => [r.id, r.est, r.truth, r.rank, r.route ? r.route.len : null])), handover: H(o.steps.handover), opt: H(o.steps.optimise.sol.map(s => [s.site, s.gain, s.cov])), sites: H(o.sites.map(s => [s.x, s.y])) });
let same = 0, tot = 0;
for (const sc of C.SCENARIOS) { const P = await PK.load(sc.id); sc.lat = P.aoi.lat; sc.lon = P.aoi.lon; sc.S = P.aoi.S;
  const a = fp(A.pipe.run(sc, {}, PK.build(sc, P))), b = fp(A.live.runFull(sc, {}, PK.build(sc, P), { use: A.live.OFF }));
  for (const k in a) { tot++; if (a[k] === b[k]) same++; else console.log('  DIFF', sc.id, k); } }
console.log(`v8 runFull (all inputs off) vs v7 pipe.run, stages 1–11: ${same}/${tot} identical`);
fs.writeFileSync(path.join(root, 'tests/results/regression_full.json'), JSON.stringify({ same, tot }));
if (same !== tot) process.exit(1);
