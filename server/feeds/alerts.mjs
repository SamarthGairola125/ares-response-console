/* Stage 1 inputs — alert and event feeds for India (and Nepal).
   NDMA Sachet (official Indian CAP alerts, live only — no public archive), GDACS (floods, cyclones, earthquakes, with history),
   USGS earthquakes (history), NASA FIRMS active fires (needs a free MAP_KEY). */
import { cachedFetch, iso, day, haversine } from '../http.mjs';

const INDIA_BBOX = [6, 68, 37.5, 97.5]; // S, W, N, E (includes Nepal)

export async function sachet({ limit = 100, withPolygons = 25 } = {}) {
  const r = await cachedFetch('sachet', 'https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml', { as: 'text', ttlMs: 5 * 60e3 });
  const items = [...r.data.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit).map(m => { const g = t => { const x = m[1].match(new RegExp(`<${t}(?: [^>]*)?>([\\s\\S]*?)</${t}>`)); return x ? x[1].trim() : null; }; return { id: g('guid'), title: g('title'), category: g('category'), link: g('link'), author: g('author'), pubDate: g('pubDate') ? new Date(g('pubDate')).toISOString() : null }; });
  // English CAP details + polygon for the most recent alerts (immutable → cached for a day)
  for (const it of items.slice(0, withPolygons)) {
    try { const cap = await cachedFetch('sachet-cap', `https://sachet.ndma.gov.in/cap_public_website/FetchXMLFile?identifier=${it.id}`, { as: 'text', ttlMs: 864e5 });
      const info = (cap.data.match(/<cap:info>([\s\S]*?)<\/cap:info>/g) || []).find(x => /en-IN|<cap:language>en/.test(x)) || (cap.data.match(/<cap:info>([\s\S]*?)<\/cap:info>/) || [''])[0];
      const g = t => { const x = info.match(new RegExp(`<cap:${t}>([\\s\\S]*?)</cap:${t}>`)); return x ? x[1].trim() : null; };
      Object.assign(it, { event: g('event'), severity: g('severity'), urgency: g('urgency'), certainty: g('certainty'), headline: g('headline'), effective: g('effective'), expires: g('expires'), area: g('areaDesc'), sender: (cap.data.match(/<cap:sender>([^<]*)/) || [])[1] });
      const pg = await cachedFetch('sachet-poly', `https://sachet.ndma.gov.in/cap_public_website/FetchPolygonXMLFile?identifier=${it.id}`, { as: 'text', ttlMs: 864e5 });
      const polys = [...pg.data.matchAll(/<polygon>([\s\S]*?)<\/polygon>/g)].map(x => x[1].trim().split(/\s+/).map(s => s.split(',').map(Number)).filter(a => a.length === 2 && !isNaN(a[0])));
      if (polys.length) { it.polygons = polys.map(P => P.length > 60 ? P.filter((_, i) => i % Math.ceil(P.length / 60) === 0) : P); const all = polys.flat(); it.lat = all.reduce((s, p) => s + p[0], 0) / all.length; it.lon = all.reduce((s, p) => s + p[1], 0) / all.length; }
    } catch (e) { it.capError = e.message; }
  }
  return { source: 'NDMA Sachet CAP feed', fetchedAt: r.fetchedAt, via: r.via, items };
}

export async function gdacs({ from, to, countries = ['IND', 'NPL'] } = {}) {
  const out = [];
  for (const c of countries) {
    const url = `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=FL;EQ;TC;DR;VO;WF&country=${c}&fromdate=${day(from)}&todate=${day(to)}`;
    const r = await cachedFetch('gdacs', url, { ttlMs: new Date(to) < Date.now() - 864e5 ? 3e10 : 15 * 60e3 }).catch(e => ({ data: { features: [] }, error: e.message }));
    for (const f of (r.data && r.data.features) || []) { const p = f.properties; out.push({ id: `${p.eventtype}-${p.eventid}-${p.episodeid}`, type: p.eventtype, name: p.name, alert: p.alertlevel, from: p.fromdate, to: p.todate, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], glide: p.glide, url: p.url && p.url.report, country: p.country }); }
  }
  return { source: 'GDACS', items: out };
}

export async function usgs({ from, to, lat, lon, radiusKm, minMag = 3.5 } = {}) {
  const geo = lat != null ? `&latitude=${lat}&longitude=${lon}&maxradiuskm=${radiusKm || 300}` : `&minlatitude=${INDIA_BBOX[0]}&minlongitude=${INDIA_BBOX[1]}&maxlatitude=${INDIA_BBOX[2]}&maxlongitude=${INDIA_BBOX[3]}`;
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${iso(from)}&endtime=${iso(to)}&minmagnitude=${minMag}${geo}&orderby=time`;
  const r = await cachedFetch('usgs', url, { ttlMs: new Date(to) < Date.now() - 864e5 ? 3e10 : 5 * 60e3 });
  return { source: 'USGS', fetchedAt: r.fetchedAt, items: r.data.features.map(f => ({ id: f.id, type: 'EQ', mag: f.properties.mag, place: f.properties.place, time: new Date(f.properties.time).toISOString(), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], depthKm: f.geometry.coordinates[2], url: f.properties.url, alert: f.properties.alert })) };
}

export async function firms({ lat, lon, radiusKm = 50, date, days = 2 } = {}) {
  const key = process.env.FIRMS_MAP_KEY; if (!key) return { source: 'NASA FIRMS', unavailable: 'Set FIRMS_MAP_KEY (free) in .env or Settings', items: [] };
  const d = radiusKm / 111, bbox = [lon - d, lat - d, lon + d, lat + d].map(v => v.toFixed(3)).join(','), live = !date || Date.now() - new Date(date) < 7 * 864e5;
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${live ? 'VIIRS_SNPP_NRT' : 'VIIRS_SNPP_SP'}/${bbox}/${days}${date ? '/' + day(date) : ''}`;
  const r = await cachedFetch('firms', url, { as: 'text', ttlMs: 30 * 60e3 });
  const [h, ...rows] = r.data.trim().split('\n'), cols = h.split(','); return { source: 'NASA FIRMS VIIRS', fetchedAt: r.fetchedAt, items: rows.map(l => { const v = l.split(','), o = {}; cols.forEach((c, i) => o[c] = v[i]); return { lat: +o.latitude, lon: +o.longitude, time: `${o.acq_date}T${(o.acq_time || '0000').padStart(4, '0').replace(/(\d\d)(\d\d)/, '$1:$2')}:00Z`, frp: +o.frp, confidence: o.confidence }; }) };
}

/* incidents near a point, for the planner's stage 1: what fired, when, from which feed */
export async function nearIncidents({ lat, lon, time, radiusKm = 60, hazard }) {
  const t = time ? new Date(time) : new Date(), from = new Date(t - 3 * 864e5), to = new Date(Math.min(Date.now(), +t + 864e5)), out = { checked: [], items: [], unavailable: [] };
  const live = Date.now() - t < 2 * 864e5;
  try { const g = await gdacs({ from, to }); out.checked.push('GDACS'); g.items.forEach(e => { const d = haversine(lat, lon, e.lat, e.lon) / 1000; if (d < Math.max(radiusKm, e.type === 'FL' ? 400 : radiusKm)) out.items.push(Object.assign({ feed: 'GDACS', distKm: d, time: e.from }, e)); }); } catch (e) { out.unavailable.push('GDACS: ' + e.message); }
  try { const u = await usgs({ from, to, lat, lon, radiusKm: 300, minMag: 3 }); out.checked.push('USGS'); u.items.forEach(e => out.items.push(Object.assign({ feed: 'USGS', distKm: haversine(lat, lon, e.lat, e.lon) / 1000 }, e))); } catch (e) { out.unavailable.push('USGS: ' + e.message); }
  if (live) { try { const s = await sachet({ withPolygons: 40 }); out.checked.push('NDMA Sachet'); s.items.filter(i => i.lat != null).forEach(i => { const d = haversine(lat, lon, i.lat, i.lon) / 1000; if (d < radiusKm) out.items.push({ feed: 'NDMA Sachet', type: i.event || i.category, name: i.headline || i.title, time: i.effective || i.pubDate, severity: i.severity, lat: i.lat, lon: i.lon, distKm: d, sender: i.sender || i.author }); }); } catch (e) { out.unavailable.push('NDMA Sachet: ' + e.message); } }
  else out.unavailable.push('NDMA Sachet: live feed only (no public archive) — not available for a past date');
  try { const f = await firms({ lat, lon, radiusKm, date: t, days: 3 }); if (f.unavailable) out.unavailable.push('NASA FIRMS: ' + f.unavailable); else { out.checked.push('NASA FIRMS'); if (f.items.length) out.items.push({ feed: 'NASA FIRMS', type: 'WF', name: `${f.items.length} active-fire detections`, time: f.items[0].time, lat, lon, distKm: 0 }); } } catch (e) { out.unavailable.push('NASA FIRMS: ' + e.message); }
  out.items.sort((a, b) => new Date(a.time) - new Date(b.time));
  const rel = out.items.filter(i => (i.feed !== 'USGS' || i.mag >= 4 || i.distKm < 80));
  out.trigger = rel.find(i => Math.abs(new Date(i.time) - t) < 2 * 864e5) || null;
  return out;
}
