/* Stage 2 / 8 inputs — Sentinel-1 and Sentinel-2 acquisitions over the area (Earth Search STAC, AWS open data).
   Used for: what imagery exists before/after the event, and when the next radar / optical pass will come (re-assessment time).
   Next-pass prediction uses each satellite's own past acquisitions over this area and its repeat cycle (S-2: 10 days, S-1: 12 days),
   so it needs no orbital elements. When CelesTrak is reachable the TLE-based check is used as a cross-check (see passes.mjs). */
import { cachedFetch, iso } from '../http.mjs';
const STAC = 'https://earth-search.aws.element84.com/v1/search';
const CYCLE = { 'sentinel-2a': 10, 'sentinel-2b': 10, 'sentinel-2c': 10, 'sentinel-1a': 12, 'sentinel-1b': 12, 'sentinel-1c': 12 };

async function search(collection, bbox, from, to, limit = 100) {
  const url = `${STAC}?collections=${collection}&bbox=${bbox.join(',')}&datetime=${iso(from)}/${iso(to)}&limit=${limit}&fields=id,properties.datetime,properties.platform,properties.eo:cloud_cover,properties.sat:relative_orbit,properties.s2:mgrs_tile,properties.sar:instrument_mode,properties.sat:orbit_state`;
  const r = await cachedFetch('stac', url, { ttlMs: to < Date.now() - 864e5 ? 3e10 : 60 * 60e3 });
  return r.data.features.map(f => ({ id: f.id, time: f.properties.datetime, platform: (f.properties.platform || '').toLowerCase(), cloud: f.properties['eo:cloud_cover'], orbit: f.properties['sat:relative_orbit'], state: f.properties['sat:orbit_state'], mode: f.properties['sar:instrument_mode'], collection }));
}
export async function imageryContext({ lat, lon, time, halfKm = 3 }) {
  const t = new Date(time || Date.now()), d = halfKm / 111, bbox = [lon - d / Math.cos(lat * Math.PI / 180), lat - d, lon + d / Math.cos(lat * Math.PI / 180), lat + d].map(v => +v.toFixed(4));
  const before = new Date(+t - 60 * 864e5), afterEnd = new Date(Math.min(Date.now(), +t + 10 * 864e5));
  const out = { source: 'Earth Search STAC (Sentinel-1 GRD, Sentinel-2 L2A)', bbox, errors: [] };
  const all = [];
  for (const col of ['sentinel-2-l2a', 'sentinel-1-grd']) { try { all.push(...await search(col, bbox, before, afterEnd)); } catch (e) { out.errors.push(col + ': ' + e.message); } }
  const pre = all.filter(a => new Date(a.time) < t), post = all.filter(a => new Date(a.time) >= t).sort((a, b) => new Date(a.time) - new Date(b.time));
  // predict passes after t from acquisitions before t (per platform + relative orbit), then compare with what actually came (replay)
  // one group per satellite and track: the relative orbit when the catalogue has it, else the overpass time of day (different tracks pass at different times)
  const tod = t => { const d = new Date(t); return Math.round((d.getUTCHours() * 60 + d.getUTCMinutes()) / 6); };
  const groups = {}; for (const a of pre) { const k = a.platform + '|' + (a.orbit ?? ('t' + tod(a.time))); (groups[k] = groups[k] || []).push(a); }
  const pred = [];
  for (const k in groups) { const [plat] = k.split('|'), cyc = CYCLE[plat]; if (!cyc) continue; const last = groups[k].reduce((m, a) => new Date(a.time) > new Date(m.time) ? a : m); let nt = new Date(last.time); while (nt < t) nt = new Date(+nt + cyc * 864e5); pred.push({ platform: plat, orbit: last.orbit, predicted: nt.toISOString(), sensor: plat.startsWith('sentinel-1') ? 'radar (sees through cloud)' : 'optical', basis: `last seen ${last.time.slice(0, 10)}, ${cyc}-day repeat` }); }
  pred.sort((a, b) => new Date(a.predicted) - new Date(b.predicted));
  const firstRadar = pred.find(p => p.sensor.startsWith('radar')), firstOpt = pred.find(p => p.sensor === 'optical');
  const actualFirst = (s) => post.find(a => (s === 'radar') === a.platform.startsWith('sentinel-1'));
  const cmp = (p, s) => { const a = actualFirst(s); return p ? Object.assign({}, p, { hoursAfterEvent: +((new Date(p.predicted) - t) / 36e5).toFixed(1), actual: a ? a.time : null, errorH: a ? +((new Date(a.time) - new Date(p.predicted)) / 36e5).toFixed(1) : null }) : null; };
  out.next = { radar: cmp(firstRadar, 'radar'), optical: cmp(firstOpt, 'optical'), all: pred.slice(0, 6) };
  out.lastClearOpticalBefore = pre.filter(a => a.collection === 'sentinel-2-l2a' && a.cloud != null && a.cloud < 20).sort((a, b) => new Date(b.time) - new Date(a.time))[0] || null;
  out.firstPostOptical = post.find(a => a.collection === 'sentinel-2-l2a') || null; out.firstPostClearOptical = post.find(a => a.collection === 'sentinel-2-l2a' && a.cloud != null && a.cloud < 30) || null; out.firstPostRadar = post.find(a => a.collection === 'sentinel-1-grd') || null;
  out.summary = { scenesBefore: pre.length, scenesAfter: post.length, nextRadarH: out.next.radar ? out.next.radar.hoursAfterEvent : null, nextOpticalH: out.next.optical ? out.next.optical.hoursAfterEvent : null };
  return out;
}
