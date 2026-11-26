/* v8 regression: (1) unmodified v7 harness on the v8 core files → 100/100 fingerprints; (2) planPre with every factor OFF reproduces v7 stages 1–8 exactly. */
import { createRequire } from 'module'; import crypto from 'crypto'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url), here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..');
const { loadARES, useLocalData } = require('../core/load.cjs');
useLocalData(path.join(root, 'data/packs')); const A = loadARES(), C = A.core, PK = A.pack;
const H = x => { const h = crypto.createHash('sha256'); if (ArrayBuffer.isView(x)) h.update(Buffer.from(x.buffer, x.byteOffset, x.byteLength)); else h.update(JSON.stringify(x)); return h.digest('hex').slice(0, 16); };
const dense = (o, sp) => { const N = o.B.N, d = new Uint8Array(o.sites.length * N); sp.forEach((l, j) => l.c.forEach(c => d[j * N + c] = 1)); return d; };
const fp = (o, first) => ({ early: H(o.steps.detect.early), alerts: H(o.steps.detect.alerts), evaluate: H(o.steps.evaluate), sites: H(o.sites.map(q => [q.x, q.y, q.z0, q.cls])), rejected: H(o.steps.sites.rejected.map(q => [q.x, q.y, q.why])), belief: H(o.B.lam), sev: H(o.B.sev), prio: H(o.B.prio), koopman: H(o.steps.koopman.phi),
  cov: H(dense(o, o.cc.sp)), perSite: H(o.steps.coverage.perSite), greedy: H(o.steps.optimise.full.steps.map(s => [s.site, s.gain, s.cov])), sol: H(o.steps.optimise.sol.map(s => [s.site, s.gain, s.cov])), lb: o.steps.optimise.lb, baselines: H({ r: o.steps.optimise.base.random, k: o.steps.optimise.base.kmeans, g: o.steps.optimise.base.grid.n }),
  nodes: H(first.map(n => [n.site, n.role, n.id, n.eta, n.team, n.km])), relays: o.steps.deploy.relays, tEff: o.tEff, reach: o.reach });
const v7ref = JSON.parse(fs.readFileSync(path.join(root, 'tests/v7_level1_final.json'), 'utf8'));
let same = 0, tot = 0, same2 = 0, tot2 = 0; const rows = [];
for (const sc of C.SCENARIOS) {
  const P = await PK.load(sc.id); sc.lat = P.aoi.lat; sc.lon = P.aoi.lon; sc.S = P.aoi.S;
  const o7 = A.pipe.run(sc, {}, PK.build(sc, P)); const nFirst = o7.steps.optimise.sol.length + o7.steps.deploy.relays;
  const o8 = A.live.planPre(sc, {}, PK.build(sc, P), { use: A.live.OFF });
  const a = fp(o7, o7.nodes.slice(0, nFirst)), b = fp(o8, o8.nodes);
  for (const k in a) { tot2++; if (JSON.stringify(a[k]) === JSON.stringify(b[k])) same2++; else console.log('  DIFF', sc.id, k); }
  // full v7 pipeline fingerprints vs the published v7 result (stages 1–11 untouched)
  const ref = v7ref[sc.id].fp; const hz = x => H(x); const f7 = { sites: hz(o7.sites.map(q => [q.x, q.y, q.z0, q.cls])), belief: hz(o7.B.lam), gp2: hz(o7.gp2.est), shap: hz(o7.shap) };
  for (const k in f7) { tot++; if (f7[k] === ref[k]) same++; }
  rows.push({ id: sc.id, placed: o8.steps.optimise.sol.length, cov: +o8.steps.optimise.cov.toFixed(4), ms: o8.ms });
}
console.log(JSON.stringify(rows));
console.log(`v7 full-pipeline spot fingerprints vs published v7: ${same}/${tot}`);
console.log(`v8 planPre (all factors off) vs v7 stages 1–8: ${same2}/${tot2} identical`);
fs.mkdirSync(path.join(root, 'tests/results'), { recursive: true });
fs.writeFileSync(path.join(root, 'tests/results/regression.json'), JSON.stringify({ v7spot: [same, tot], stages1to8: [same2, tot2], rows }, null, 1));
if (same !== tot || same2 !== tot2) process.exit(1);
