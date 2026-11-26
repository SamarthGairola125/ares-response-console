/* Freezes the real inputs of each REPLAY scenario into data/packs/<id>/v8/inputs.json so the published console (which cannot fetch
   other sites) runs the same v8 model on the same archived data. */
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { A } from '../server/planner.mjs'; import { buildInputs } from '../server/inputs.mjs';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : A.core.SCENARIOS.map(s => s.id);
for (const id of ids) { const snap = await buildInputs(id, { mode: 'replay' }); snap.note = 'Real archived inputs for REPLAY, frozen so the published console can run the v8 model without network access.';
  fs.mkdirSync(path.join(ROOT, 'data/packs', id, 'v8'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'data/packs', id, 'v8/inputs.json'), JSON.stringify(snap));
  console.log(id, 'routes', snap.routes.ok, '/', snap.routes.n, (JSON.stringify(snap).length / 1024).toFixed(0) + ' KB', (snap.ms / 1000).toFixed(0) + ' s'); }
