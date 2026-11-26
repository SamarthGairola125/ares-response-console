/* Per-factor effect on the five scenarios (REPLAY at each event's date, real archived inputs).
   Baseline = v7 (all factors off). Then each factor alone, then all on. Writes tests/results/ablation.json and .md */
import fs from 'fs'; import { plan, A } from '../server/planner.mjs';
const L = A.live, F = Object.keys(L.FACTORS).filter(k => k !== 'constraints');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['dehradun', 'wayanad', 'assam', 'delhi', 'nepal'];
const rows = [];
const m = r => { const o = r.stages.optimise, mods = r.modules.filter(x => x.role === 'sense'), eta = r.modules.map(x => x.etaHeld ?? x.eta);
  return { modules: r.modules.length, sense: mods.length, relays: r.stages.deploy.relays, cov: +o.cov.toFixed(4), target: +o.target.toFixed(4), met: o.met, hoursMet: o.hoursMet != null ? +o.hoursMet.toFixed(3) : null, meanCovHours: o.meanCovOverHours != null ? +o.meanCovOverHours.toFixed(3) : null,
    firstEtaMin: eta.length ? Math.min(...eta) : null, lastEtaMin: eta.length ? Math.max(...eta) : null, heights: [...new Set(mods.map(x => x.h))].sort((a, b) => a - b).join('/'), sitesValid: r.stages.sites.valid, rejected: r.stages.sites.rejected, ms: r.ms }; };
for (const id of ids) {
  const base = await plan({ scenario: id, use: {} }); rows.push(Object.assign({ scenario: id, run: 'v7 baseline (all off)' }, m(base)));
  for (const f of F) { const u = { [f]: true }; if (f === 'robust') u.weather = true; const r = await plan({ scenario: id, use: u }); rows.push(Object.assign({ scenario: id, run: f === 'robust' ? 'weather + robust' : f }, m(r), { status: r.status[f === 'popfusion' ? 'popfusion' : f] ? r.status[f === 'popfusion' ? 'popfusion' : f].state : undefined })); }
  const rec = await plan({ scenario: id, use: L.REC }); rows.push(Object.assign({ scenario: id, run: 'RECOMMENDED (all but popfusion)' }, m(rec)));
  const all = await plan({ scenario: id, use: Object.fromEntries(F.map(f => [f, true])) }); rows.push(Object.assign({ scenario: id, run: 'ALL incl. popfusion' }, m(all)));
  console.log(id, 'done');
}
fs.mkdirSync('tests/results', { recursive: true }); fs.writeFileSync('tests/results/ablation.json', JSON.stringify(rows, null, 1));
const cols = ['scenario', 'run', 'modules', 'relays', 'cov', 'target', 'met', 'hoursMet', 'meanCovHours', 'firstEtaMin', 'lastEtaMin', 'heights', 'sitesValid'];
fs.writeFileSync('tests/results/ablation.md', ['| ' + cols.join(' | ') + ' |', '|' + cols.map(() => '---').join('|') + '|'].concat(rows.map(r => '| ' + cols.map(c => r[c] == null ? '—' : r[c] === true ? 'yes' : r[c] === false ? 'no' : r[c]).join(' | ') + ' |')).join('\n'));
console.log(fs.readFileSync('tests/results/ablation.md', 'utf8'));
