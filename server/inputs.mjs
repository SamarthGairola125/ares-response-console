/* Real-world inputs for one scenario, as the v8 console uses them (REPLAY: archived for the event date; LIVE: now). */
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { A } from './planner.mjs';
import { nearIncidents } from './feeds/alerts.mjs'; import { weatherWindow } from './feeds/weather.mjs'; import { imageryContext } from './feeds/imagery.mjs';
import { airports } from './feeds/airports.mjs'; import { gnss, aircraft, radarNow } from './feeds/tracking.mjs'; import { routesFrom } from './feeds/routing.mjs';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), C = A.core, PK = A.pack, L = A.live;
const hav = (a, b, c, d) => { const R = 6371e3, r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const memo = new Map();
export async function buildInputs(id, { mode = 'replay', log = () => {} } = {}) {
  const k = id + '|' + mode; if (mode === 'replay' && memo.has(k)) return memo.get(k);
  let sc = C.SCENARIOS.find(s => s.id === id); if (!sc) { const f = path.join(ROOT, 'data/packs', id, 'scenario.json'); sc = JSON.parse(fs.readFileSync(f, 'utf8')); }
  const P = await PK.load(id); sc.lat = P.aoi.lat; sc.lon = P.aoi.lon; sc.S = P.aoi.S; const t = mode === 'live' ? new Date().toISOString() : P.aoi.event, t0 = Date.now();
  const snap = { scenario: id, mode, eventTime: t, built: new Date().toISOString() };
  log('alerts'); snap.alerts = await nearIncidents({ lat: sc.lat, lon: sc.lon, time: t }).catch(e => ({ error: e.message }));
  log('weather'); snap.weather = await weatherWindow({ lat: sc.lat, lon: sc.lon, start: t, hours: 24, mode }).catch(e => ({ error: e.message }));
  log('satellite passes'); snap.imaging = await imageryContext({ lat: sc.lat, lon: sc.lon, time: t }).catch(e => ({ error: e.message }));
  const ap = await airports(); snap.airports = { source: ap.source, fetchedAt: ap.fetchedAt, items: ap.items.filter(a => hav(sc.lat, sc.lon, a.lat, a.lon) < 40000) };
  log('GNSS / space weather'); snap.gnss = await gnss({ lat: sc.lat, lon: sc.lon, time: t }).catch(e => ({ error: e.message }));
  if (mode === 'live') { log('aircraft'); snap.aircraft = await aircraft({ lat: sc.lat, lon: sc.lon, radiusKm: 40 }).catch(e => null); log('radar'); snap.radar = await radarNow({ lat: sc.lat, lon: sc.lon }).catch(e => null); }
  const fleet = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/fleet.json'), 'utf8'));
  const ctxBase = { fleet, eventTime: t, alerts: snap.alerts, weather: snap.weather && !snap.weather.error ? snap.weather : null, imaging: snap.imaging, imagery: snap.imaging, airports: snap.airports.items, gnss: snap.gnss, aircraft: snap.aircraft, radar: snap.radar };
  const keys = new Map(), combos = [L.OFF, L.REC, L.ALL].concat(Object.keys(L.FACTORS).map(f => Object.assign({}, L.OFF, { [f]: true }, f === 'robust' ? { weather: true } : {})));
  let icp = null; log('candidate launch sites');
  for (const u of combos) { const o = L.planPre(sc, {}, PK.build(sc, P), Object.assign({}, ctxBase, { use: u })); icp = icp || o.M.icp; o.nodes.forEach(n => { const s = o.sites[n.site]; keys.set(Math.round(s.x) + ',' + Math.round(s.y), s); });
    if (u === L.REC) { const cnt = o.sites.map((s, j) => [Math.max(...o.sps.map(S => S[j].c.length)), s]).sort((a, b) => b[0] - a[0]).slice(0, 120); cnt.forEach(([, s2]) => keys.set(Math.round(s2.x) + ',' + Math.round(s2.y), s2)); } }
  const o0 = L.planPre(sc, {}, PK.build(sc, P), Object.assign({}, ctxBase, { use: L.OFF })), T = o0.T, M = o0.M, icpLL = L.toLL(sc, icp[0], icp[1]);
  const hz = (la, lo) => { const [x, y] = L.toXY(sc, la, lo); if (Math.abs(x) >= T.S / 2 || Math.abs(y) >= T.S / 2) return false; const kk = C.idxAt(T, x, y); return !!(M.hazMask && M.hazMask[kk]) || (M.flood && T.cls[kk] === C.CLS.WATER); };
  const targets = [...keys.entries()].map(([kk, s]) => { const [la, lo] = L.toLL(sc, s.x, s.y); return { key: kk, lat: la, lon: lo }; });
  log('road routes'); const rr = await routesFrom({ lat: icpLL[0], lon: icpLL[1] }, targets, { hazardTest: hz, concurrency: 4 });
  snap.routes = { source: rr.source, from: icp, n: targets.length, ok: Object.values(rr.routes).filter(r => r.ok).length, byXY: Object.fromEntries(Object.entries(rr.routes).map(([kk, r]) => [kk, r.ok ? { ok: true, durationS: r.durationS, distanceM: r.distanceM, snapEndM: r.snapEndM, snapStartM: r.snapStartM, crossesHazard: r.crossesHazard, geometry: r.geometry.filter((_, i, a) => i % Math.max(1, Math.ceil(a.length / 60)) === 0 || i === a.length - 1).map(([lo, la]) => [+lo.toFixed(5), +la.toFixed(5)]) } : { ok: false, reason: r.reason }])) };
  if (id === 'nepal') snap.evidence = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/evidence/bhote-koshi-2026.json'), 'utf8'));
  snap.ms = Date.now() - t0; if (mode === 'replay') memo.set(k, snap); return snap;
}
