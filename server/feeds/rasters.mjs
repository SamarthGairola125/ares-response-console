/* Raster sources for any point in India, read straight from cloud-optimised GeoTIFFs (HTTP range requests, no full download):
   Copernicus DEM GLO-30 (terrain), ESA WorldCover 2021 (land cover), Meta/CIESIN HRSL v1.5 (population, ~30 m). All EPSG:4326. */
import { fromUrl } from 'geotiff';
const tiles = new Map(), latest = new Map();
/* HRSL tiles exist in several revisions (v1.5.1 … v1.5.5); the newest is listed from the public S3 bucket and used */
async function resolveUrl(url) {
  const m = url.match(/^(https:\/\/dataforgood-fb-data\.s3\.amazonaws\.com\/)(hrsl-cogs\/hrsl_general\/v1\.5\/cog_globallat_-?\d+_lon_-?\d+_general-v1\.5)\.\d+\.tif$/); if (!m) return url;
  if (!latest.has(m[2])) latest.set(m[2], fetch(`${m[1]}?prefix=${m[2]}&max-keys=50`).then(r => r.text()).then(t => { const ks = [...t.matchAll(/<Key>([^<]+\.tif)<\/Key>/g)].map(x => x[1]).sort((a, b) => +a.match(/v1\.5\.(\d+)/)[1] - +b.match(/v1\.5\.(\d+)/)[1]); return ks.length ? m[1] + ks[ks.length - 1] : url; }).catch(() => url));
  return latest.get(m[2]);
}
async function tile(url0) { const url = await resolveUrl(url0); if (!tiles.has(url)) tiles.set(url, fromUrl(url).then(t => t.getImage()).catch(e => { tiles.delete(url); throw e; })); return tiles.get(url); }
const pad = (n, w) => String(Math.abs(n)).padStart(w, '0');
export const SRC = {
  dem: { name: 'Copernicus DEM GLO-30', url: (la, lo) => { const a = Math.floor(la), o = Math.floor(lo), id = `Copernicus_DSM_COG_10_${a >= 0 ? 'N' : 'S'}${pad(a, 2)}_00_${o >= 0 ? 'E' : 'W'}${pad(o, 3)}_00_DEM`; return `https://copernicus-dem-30m.s3.amazonaws.com/${id}/${id}.tif`; }, key: (la, lo) => `${Math.floor(la)},${Math.floor(lo)}` },
  worldcover: { name: 'ESA WorldCover 2021 v200', url: (la, lo) => { const a = Math.floor(la / 3) * 3, o = Math.floor(lo / 3) * 3; return `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${a >= 0 ? 'N' : 'S'}${pad(a, 2)}${o >= 0 ? 'E' : 'W'}${pad(o, 3)}_Map.tif`; }, key: (la, lo) => `${Math.floor(la / 3)},${Math.floor(lo / 3)}` },
  hrsl: { name: 'Meta/CIESIN HRSL v1.5 (general population)', url: (la, lo) => { const a = Math.floor(la / 10) * 10, o = Math.floor(lo / 10) * 10; return `https://dataforgood-fb-data.s3.amazonaws.com/hrsl-cogs/hrsl_general/v1.5/cog_globallat_${a}_lon_${o}_general-v1.5.1.tif`; }, key: (la, lo) => `${Math.floor(la / 10)},${Math.floor(lo / 10)}` },
};
/* local tangent-plane coordinates, the same convention the packs use (x east, y north, metres from the centre) */
export const ll = (lat0, lon0, x, y) => [lat0 + y / 111320, lon0 + x / (111320 * Math.cos(lat0 * Math.PI / 180))];

/* sample a G×G grid of points spanning S metres around (lat0, lon0); mode 'bilinear' (DEM) or 'nearest' (classes) */
export async function sampleGrid(kind, lat0, lon0, S, G, mode = 'nearest') {
  const src = SRC[kind], out = new Float32Array(G * G), groups = new Map(), h = S / 2, step = S / (G - 1);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const [la, lo] = ll(lat0, lon0, -h + i * step, -h + j * step), k = src.key(la, lo); if (!groups.has(k)) groups.set(k, { la, lo, pts: [] }); groups.get(k).pts.push([j * G + i, la, lo]); }
  for (const g of groups.values()) {
    const im = await tile(src.url(g.la, g.lo)), [x0, , , y1] = im.getBoundingBox(), [rx, ry] = im.getResolution(), W = im.getWidth(), Ht = im.getHeight();
    let c0 = 1e9, c1 = -1, r0 = 1e9, r1 = -1; for (const [, la, lo] of g.pts) { const c = (lo - x0) / rx, r = (la - y1) / ry; c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); }
    const win = [Math.max(0, Math.floor(c0) - 1), Math.max(0, Math.floor(r0) - 1), Math.min(W, Math.ceil(c1) + 2), Math.min(Ht, Math.ceil(r1) + 2)];
    const ww = win[2] - win[0], data = (await im.readRasters({ window: win, samples: [0], interleave: true }));
    for (const [k, la, lo] of g.pts) { const sh = mode === 'bilinear' ? 0 : 0.5, c = (lo - x0) / rx - win[0] - sh, r = (la - y1) / ry - win[1] - sh;
      if (mode === 'bilinear') { const i0 = Math.max(0, Math.floor(c)), j0 = Math.max(0, Math.floor(r)), u = Math.min(1, Math.max(0, c - i0)), v = Math.min(1, Math.max(0, r - j0)), i1 = Math.min(ww - 1, i0 + 1), j1 = Math.min(win[3] - win[1] - 1, j0 + 1), a = data[j0 * ww + i0], b = data[j0 * ww + i1], cc = data[j1 * ww + i0], d = data[j1 * ww + i1]; out[k] = (a * (1 - u) + b * u) * (1 - v) + (cc * (1 - u) + d * u) * v; }
      else out[k] = data[Math.min(win[3] - win[1] - 1, Math.max(0, Math.round(r))) * ww + Math.min(ww - 1, Math.max(0, Math.round(c)))]; }
  }
  return { data: out, source: src.name };
}

/* sum a population raster into CB×CB cells covering S metres (people per cell) */
export async function sumCells(kind, lat0, lon0, S, CB) {
  const src = SRC[kind], h = S / 2, cs = S / CB, out = new Float32Array(CB * CB);
  const [laS, loW] = ll(lat0, lon0, -h, -h), [laN, loE] = ll(lat0, lon0, h, h), keys = new Map();
  for (const la of [laS, laN]) for (const lo of [loW, loE]) keys.set(src.key(la, lo), [la, lo]);
  let total = 0;
  for (const [la, lo] of keys.values()) {
    const im = await tile(src.url(la, lo)), [x0, , , y1] = im.getBoundingBox(), [rx, ry] = im.getResolution(), W = im.getWidth(), Ht = im.getHeight();
    const win = [Math.max(0, Math.floor((loW - x0) / rx)), Math.max(0, Math.floor((laN - y1) / ry)), Math.min(W, Math.ceil((loE - x0) / rx) + 1), Math.min(Ht, Math.ceil((laS - y1) / ry) + 1)];
    if (win[2] <= win[0] || win[3] <= win[1]) continue;
    const data = await im.readRasters({ window: win, samples: [0], interleave: true }), ww = win[2] - win[0];
    for (let r = win[1]; r < win[3]; r++) for (let c = win[0]; c < win[2]; c++) { const v = data[(r - win[1]) * ww + (c - win[0])]; if (!(v > 0)) continue; const plo = x0 + (c + 0.5) * rx, pla = y1 + (r + 0.5) * ry;
      if (src.key(pla, plo) !== src.key(la, lo)) continue; // each pixel counted from its own tile
      const x = (plo - lon0) * 111320 * Math.cos(lat0 * Math.PI / 180), y = (pla - lat0) * 111320; if (Math.abs(x) >= h || Math.abs(y) >= h) continue;
      const ci = Math.floor((x + h) / cs), cj = Math.floor((y + h) / cs); out[cj * CB + ci] += v; total += v; }
  }
  return { cells: out, total, source: src.name };
}
