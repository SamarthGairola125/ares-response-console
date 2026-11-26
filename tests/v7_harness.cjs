/* ARES headless harness: loads the model modules (no rendering) in Node and runs scenarios.
   usage: node tests/harness.cjs <jsDir> <dataDir> <outJson> [scenario ids...]
   Writes per-scenario summaries and SHA-256 fingerprints of every major output array, so two code versions can be compared bit for bit. */
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const [jsDir, dataDir, outFile, ...only] = process.argv.slice(2);
global.window = global; global.ARES = {}; window.ARES = global.ARES;
global.fetch = async u => { const p = path.join(dataDir, u.replace(/^data\//, '')); if (!fs.existsSync(p)) return { ok: false, status: 404 }; return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')), text: async () => fs.readFileSync(p, 'utf8'), arrayBuffer: async () => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } }; };
for (const f of ['core.js', 'model.js', 'datapack.js', 'pipeline.js', ...(fs.existsSync(path.join(jsDir, 'search.js')) ? ['search.js'] : [])]) vm.runInThisContext(fs.readFileSync(path.join(jsDir, f), 'utf8'), { filename: f });
const A = global.ARES, C = A.core, PK = A.pack;
const H = x => { const h = crypto.createHash('sha256'); if (ArrayBuffer.isView(x)) h.update(Buffer.from(x.buffer, x.byteOffset, x.byteLength)); else h.update(JSON.stringify(x)); return h.digest('hex').slice(0, 16); };
const denseCov = o => { if (o.cc.cov) return o.cc.cov; const N = o.B.N, d = new Uint8Array(o.sites.length * N); o.cc.sp.forEach((l, j) => l.c.forEach(c => d[j * N + c] = 1)); return d; };
function fingerprint(o) {
  const s = o.steps;
  return {
    sites: H(o.sites.map(q => [q.x, q.y, q.z0, q.cls])), rejected: H(s.sites.rejected.map(q => [q.x, q.y, q.why])),
    belief: H(o.B.lam), sev: H(o.B.sev), koopman: H(s.koopman.phi), cov: H(denseCov(o)), perSite: H(s.coverage.perSite),
    greedy: H(s.optimise.full.steps), sol: H(s.optimise.sol), baselines: H({ r: s.optimise.base.random, k: s.optimise.base.kmeans, g: s.optimise.base.grid.n }),
    nodes: H(o.nodes.map(n => [n.site, n.role, n.id, n.hop, n.par, n.eta])), relays: s.deploy.relays,
    detect: H({ d: Array.from(o.P.detBy), v: o.P.via }), gp1: H(o.gp1.est), gp2: H(o.gp2.est), sd2: H(o.gp2.sd), sos: H(s.update.sos),
    sectors: H(o.sectors.map(r => [r.id, r.est, r.rank, r.truth, r.route ? r.route.len : null])), shap: H(o.shap), loo: H(o.nodes.map(n => n.loo)),
  };
}
function summary(o) {
  const s = o.steps, sense = o.nodes.filter(n => n.role === 'sense').length;
  return { area_km2: (o.T.S / 1000) ** 2, grid: o.T.G, beliefCells: o.B.N, candidatesRaw: o.M.sites ? o.M.sites().length : null, sitesValid: s.sites.valid, sitesRejected: s.sites.rejected.length, reach: +o.reach.toFixed(5), tEff: +o.tEff.toFixed(5),
    placed: s.optimise.sol.length, cov: +s.optimise.cov.toFixed(5), met: s.optimise.met, lb: s.optimise.lb, kmeansNeed: s.optimise.base.needKmeans, randomNeed: s.optimise.base.needRandom, gridN: s.optimise.base.grid.n,
    nodes: o.nodes.length, sense, relays: s.deploy.relays, linked: s.deploy.con.ok.filter(Boolean).length, replanAdded: s.update.added, detRate: +s.update.sense.rate.toFixed(5), estTotal: +s.update.gp2.estTotal.toFixed(3), sectors: s.handover.sectors, mae: +s.handover.mae.toFixed(4), ms: o.ms };
}
(async () => {
  const res = {};
  for (const sc of C.SCENARIOS) {
    if (only.length && !only.includes(sc.id)) continue;
    const P = await PK.load(sc.id); sc.lat = P.aoi.lat; sc.lon = P.aoi.lon; sc.S = P.aoi.S;
    const t0 = Date.now(), built = PK.build(sc, P), tb = Date.now() - t0;
    const o = A.pipe.run(sc, {}, built);
    res[sc.id] = { summary: Object.assign(summary(o), { buildMs: tb }), fp: fingerprint(o) };
    console.log(sc.id, JSON.stringify(res[sc.id].summary));
  }
  fs.writeFileSync(outFile, JSON.stringify(res, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
