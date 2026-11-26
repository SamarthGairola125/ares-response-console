/* checks the live raster readers against the v7 packs (same sources, built offline by v4/v7 scripts) */
import fs from 'fs'; import { sampleGrid, sumCells } from '../server/feeds/rasters.mjs';
const rd = (p, k) => { const b = Buffer.from(fs.readFileSync(p, 'utf8').trim(), 'base64'); return k === 'f32' ? new Float32Array(b.buffer, b.byteOffset, b.length / 4) : new Uint8Array(b); };
const res = {};
for (const id of ['dehradun', 'nepal', 'wayanad', 'assam', 'delhi']) {
  const a = JSON.parse(fs.readFileSync(`data/packs/${id}/metadata/aoi.json`)), t0 = Date.now();
  const dem = await sampleGrid('dem', a.lat, a.lon, a.S, a.G, 'bilinear'), lc = await sampleGrid('worldcover', a.lat, a.lon, a.S, a.G, 'nearest');
  const v7d = rd(`data/packs/${id}/terrain/dem.f32.b64.txt`, 'f32'), v7l = rd(`data/packs/${id}/landcover/worldcover.u8.b64.txt`);
  let md = 0, agree = 0; for (let k = 0; k < v7d.length; k++) { md += Math.abs(dem.data[k] - v7d[k]); agree += dem.data[k] === undefined ? 0 : (lc.data[k] === v7l[k]); }
  const hr = await sumCells('hrsl', a.lat, a.lon, a.S, a.belief), wp = rd(`data/packs/${id}/population/worldpop_belief.f32.b64.txt`, 'f32');
  let wsum = 0, dot = 0, nw = 0, nh = 0; for (let c = 0; c < wp.length; c++) { wsum += wp[c]; dot += wp[c] * hr.cells[c]; nw += wp[c] ** 2; nh += hr.cells[c] ** 2; }
  res[id] = { demMeanAbsDiffM: +(md / v7d.length).toFixed(2), worldcoverAgree: +(agree / v7l.length).toFixed(4), worldpop: Math.round(wsum), hrsl: Math.round(hr.total), cosineSimilarity: +(dot / Math.sqrt(nw * nh || 1)).toFixed(3), s: (Date.now() - t0) / 1000 };
  fs.mkdirSync(`data/packs/${id}/population`, { recursive: true }); fs.writeFileSync(`data/packs/${id}/population/hrsl_belief.f32.b64.txt`, Buffer.from(hr.cells.buffer).toString('base64'));
  console.log(id, JSON.stringify(res[id]));
}
fs.mkdirSync('tests/results', { recursive: true }); fs.writeFileSync('tests/results/rasters_check.json', JSON.stringify(res, null, 1));
