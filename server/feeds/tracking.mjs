/* Things gods-eye-view tracks that can affect ARES before sensing:
   - aircraft (ADSB.lol, adsb.fi): low-flying traffic and rescue helicopters near tethers → corridor no-launch zones (live only: no free archive)
   - GPS jamming (gpsjam.org daily H3 map, with history) and space weather (Kp: NOAA SWPC live, GFZ Potsdam archive) → GNSS degraded → hover drift and position advisory
   - weather radar (RainViewer, last 2 h) → rain nowcast for the first hours (live only) */
import zlib from 'zlib'; import { latLngToCell, gridDisk } from 'h3-js'; import { PNG } from 'pngjs';
import { cachedFetch, day, haversine } from '../http.mjs';
const HELI = /^(H|EC|AS3|AS5|AW1|A109|A139|A169|A189|B06|B407|B412|B429|BK17|S76|S92|MI8|MI17|MI26|ALH|DHRU|R44|R22|UH1|EH10|H60|NH90)/i;

export async function aircraft({ lat, lon, radiusKm = 40 }) {
  const nm = Math.min(250, Math.round(radiusKm / 1.852)), urls = [`https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}`, `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${nm}`], errors = [];
  for (const u of urls) {
    try { const r = await cachedFetch('aircraft', u, { ttlMs: 20e3, timeoutMs: 15e3 }); const list = r.data.ac || r.data.aircraft || [];
      return { source: u.includes('adsb.lol') ? 'ADSB.lol (community ADS-B)' : 'adsb.fi (community ADS-B)', fetchedAt: r.fetchedAt, via: r.via, items: list.filter(a => a.lat != null).map(a => ({ hex: a.hex, flight: (a.flight || '').trim(), reg: a.r, type: a.t, cat: a.category, lat: a.lat, lon: a.lon, altFt: typeof a.alt_geom === 'number' ? a.alt_geom : (typeof a.alt_baro === 'number' ? a.alt_baro : (a.alt_baro === 'ground' ? 0 : null)), gs: a.gs, track: a.track, heli: a.category === 'A7' || HELI.test(a.t || ''), military: !!(a.dbFlags & 1), distKm: haversine(lat, lon, a.lat, a.lon) / 1000 })) }; }
    catch (e) { errors.push(e.message); }
  }
  return { source: 'ADS-B', items: [], unavailable: errors.join('; ') };
}

export async function gnss({ lat, lon, time }) {
  const t = new Date(time || Date.now()), out = { source: 'gpsjam.org (daily H3 map from ADS-B navigation integrity) + Kp index', jam: null, kp: null, errors: [] };
  // GPS jamming: the day of the event, or the latest published day
  for (let back = 0; back < 4 && !out.jam; back++) { const d = day(new Date(+t - back * 864e5)); if (new Date(d) > Date.now()) continue;
    try { const r = await cachedFetch('gpsjam', `https://gpsjam.org/data/${d}-h3_4.csv`, { as: 'buffer', ttlMs: 3e10, timeoutMs: 30e3 }); let txt; try { txt = zlib.gunzipSync(r.data).toString(); } catch { txt = r.data.toString(); }
      const cells = new Set(gridDisk(latLngToCell(lat, lon, 4), 1)); let good = 0, bad = 0, n = 0;
      for (const line of txt.split('\n')) { const [h, g, b] = line.split(','); if (cells.has(h)) { good += +g; bad += +b; n++; } }
      out.jam = { date: d, hexes: n, good, bad, share: good + bad ? bad / (good + bad) : null, note: n ? null : 'no aircraft over this area that day' }; } catch (e) { out.errors.push('gpsjam ' + d + ': ' + e.message); } }
  // space weather: Kp over the 24 h window
  try { const live = Date.now() - t < 6 * 864e5;
    if (live) { const r = await cachedFetch('kp-noaa', 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json', { ttlMs: 30 * 60e3 }); const rows = Array.isArray(r.data[0]) ? r.data.slice(1).map(x => ({ t: x[0], kp: +x[1] })) : r.data.map(x => ({ t: x.time_tag, kp: +x.Kp })); const win = rows.filter(x => Math.abs(new Date(x.t + (x.t.endsWith('Z') ? '' : 'Z')) - t) < 864e5); out.kp = { source: 'NOAA SWPC', max: Math.max(...win.map(x => x.kp)), values: win }; }
    else { const s = new Date(+t - 3 * 3600e3).toISOString().slice(0, 19) + 'Z', e = new Date(+t + 24 * 3600e3).toISOString().slice(0, 19) + 'Z'; const r = await cachedFetch('kp-gfz', `https://kp.gfz.de/app/json/?start=${s}&end=${e}&index=Kp`, { ttlMs: 3e10 }); out.kp = { source: 'GFZ Potsdam Kp archive', max: Math.max(...r.data.Kp), values: r.data.datetime.map((d, i) => ({ t: d, kp: r.data.Kp[i] })) }; }
  } catch (e) { out.errors.push('Kp: ' + e.message); }
  return out;
}

export async function radarNow({ lat, lon }) {
  const m = await cachedFetch('rainviewer', 'https://api.rainviewer.com/public/weather-maps.json', { ttlMs: 5 * 60e3 }), frames = m.data.radar.past, last = frames[frames.length - 1];
  const z = 7, n = 2 ** z, xt = (lon + 180) / 360 * n, yt = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n, tx = Math.floor(xt), ty = Math.floor(yt), px = Math.floor((xt - tx) * 256), py = Math.floor((yt - ty) * 256);
  const tile = await cachedFetch('rainviewer-tile', `${m.data.host}${last.path}/256/${z}/${tx}/${ty}/2/0_0.png`, { as: 'buffer', ttlMs: 5 * 60e3 });
  const img = PNG.sync.read(tile.data); let echo = 0, tot = 0, maxA = 0; for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) { const x = Math.min(255, Math.max(0, px + dx)), y = Math.min(255, Math.max(0, py + dy)), a = img.data[(y * 256 + x) * 4 + 3]; tot++; if (a > 0) { echo++; maxA = Math.max(maxA, a); } }
  return { source: 'RainViewer radar composite', frameTime: new Date(last.time * 1000).toISOString(), fetchedAt: m.fetchedAt, echoShare: echo / tot, rainNow: echo / tot > 0.15, note: 'Radar echo within ~6 km of the incident in the latest frame (precipitation present / absent; not a rain-rate measurement)' };
}

/* airspace notice (draft): what air traffic control and IAF / state rescue helicopters need to know about the tethers */
export function obstructionNotice(order) {
  const lines = order.modules.map(m => `${m.id}  ${m.tether_point.lat.toFixed(5)}N ${m.tether_point.lon.toFixed(5)}E  tethered aerostat, top ${Math.round(m.tether_point.ground_elev_m + m.height_m + 10)} m AMSL (${m.height_m + 10} m AGL incl. margin), from ${m.raise_at || 'T+' + m.eta_min + ' min'}`);
  return { title: `DRAFT obstruction notice — ARES tethered aerostats, ${order.incident.name}`, text: [`DRAFT — not filed. Tethered balloons with steel/kevlar tethers. Avoid within 500 m laterally.`, ...lines, `Contact: incident command post ${order.command_post.lat.toFixed(5)}N ${order.command_post.lon.toFixed(5)}E.`].join('\n') };
}
