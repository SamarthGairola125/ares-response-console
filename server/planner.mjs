/* ARES Planner orchestration: gathers live / archived inputs for an incident, runs the pre-sensing model (stages 1–8), and returns the plan,
   map layers and the deployment-order file. The same code path serves LIVE (now) and REPLAY (a past event date). */
import fs from 'fs'; import path from 'path'; import zlib from 'zlib'; import crypto from 'crypto'; import { createRequire } from 'module'; import { fileURLToPath } from 'url';
import { nearIncidents } from './feeds/alerts.mjs'; import { weatherWindow } from './feeds/weather.mjs'; import { imageryContext } from './feeds/imagery.mjs';
import { routesFrom } from './feeds/routing.mjs'; import { airports } from './feeds/airports.mjs'; import { aircraft, gnss, radarNow, obstructionNotice } from './feeds/tracking.mjs';
const require = createRequire(import.meta.url), ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { loadARES, useLocalData } = require('../core/load.cjs'); useLocalData(path.join(ROOT, 'data/packs'));
export const A = loadARES(); const C = A.core, PK = A.pack, L = A.live;
const FLEET = fs.existsSync(path.join(ROOT, 'config/fleet.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'config/fleet.json'), 'utf8')) : {};
const RUNS = new Map();

export function scenarios() {
  const list = C.SCENARIOS.map(s => ({ id: s.id, name: s.name, place: s.place, type: s.type, kind: 'replay' }));
  const dir = path.join(ROOT, 'data/packs'); for (const d of fs.readdirSync(dir)) { const f = path.join(dir, d, 'scenario.json'); if (fs.existsSync(f)) { const s = JSON.parse(fs.readFileSync(f, 'utf8')); list.push({ id: s.id, name: s.name, place: s.place, type: s.type, kind: 'live-pack', lat: s.lat, lon: s.lon }); } }
  return list;
}
async function loadScenario(id) {
  let sc = C.SCENARIOS.find(s => s.id === id);
  if (!sc) { const f = path.join(ROOT, 'data/packs', id, 'scenario.json'); if (!fs.existsSync(f)) throw new Error('Unknown scenario ' + id); sc = JSON.parse(fs.readFileSync(f, 'utf8')); }
  const P = await PK.load(sc.id); sc.lat = P.aoi.lat; sc.lon = P.aoi.lon; sc.S = P.aoi.S; return { sc, P };
}
const readB64 = (f, k) => { if (!fs.existsSync(f)) return null; const b = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'base64'); return k === 'f32' ? new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)) : new Uint8Array(b); };

/* ---------- main entry ---------- */
export async function plan({ scenario, mode = 'replay', time, use = {}, zones = [], icp = null, teams = 2, params = {}, log = () => {} }) {
  const t0 = Date.now(), { sc, P } = await loadScenario(scenario), useAll = Object.assign({}, L.OFF, use);
  const eventTime = mode === 'live' ? (time || new Date().toISOString()) : (time || P.aoi.event);
  const ctx = { use: useAll, fleet: FLEET, eventTime, zones, icp, teams, inputs: {} }, status = {};
  const step = async (name, on, fn) => { if (!on) { status[name] = { state: 'off' }; return null; } const s = Date.now(); try { const r = await fn(); status[name] = { state: 'ok', ms: Date.now() - s, via: r && r.via, fetchedAt: r && r.fetchedAt, source: r && r.source }; return r; } catch (e) { status[name] = { state: 'error', error: e.message }; return null; } };
  log('Alerts…'); ctx.alerts = await step('alerts', useAll.alerts, () => nearIncidents({ lat: sc.lat, lon: sc.lon, time: eventTime }));
  log('Weather…'); ctx.weather = await step('weather', useAll.weather || useAll.robust, () => weatherWindow({ lat: sc.lat, lon: sc.lon, start: eventTime, hours: 24, mode }));
  if (useAll.robust && !useAll.weather) useAll.weather = true; // robust planning needs the weather inputs
  log('Imagery passes…'); ctx.imaging = await step('imaging', useAll.imaging, () => imageryContext({ lat: sc.lat, lon: sc.lon, time: eventTime }));
  ctx.imagery = ctx.imaging;
  log('Airspace…'); const ap = await step('airspace', useAll.airspace, () => airports()); if (ap) ctx.airports = ap.items.concat((sc.airfields || []).filter(a => a.lat).map(a => ({ ident: 'OSM-' + a.id, type: a.kind === 'aerodrome' ? 'small_airport' : 'heliport', name: a.name || a.kind, lat: a.lat, lon: a.lon })));
  log('GNSS / space weather…'); ctx.gnss = await step('gnss', useAll.gnss, () => gnss({ lat: sc.lat, lon: sc.lon, time: eventTime }));
  if (mode === 'live') { log('Aircraft…'); ctx.aircraft = await step('aircraft', useAll.aircraft, () => aircraft({ lat: sc.lat, lon: sc.lon, radiusKm: 40 })); log('Radar…'); ctx.radar = await step('radar', useAll.radar, () => radarNow({ lat: sc.lat, lon: sc.lon })); }
  else { if (useAll.aircraft) status.aircraft = { state: 'n/a', note: 'live only — no free archive of past aircraft positions' }; if (useAll.radar) status.radar = { state: 'n/a', note: 'live only — radar frames are kept for 2 hours' }; }
  if (useAll.popfusion) { const alt = readB64(path.join(ROOT, 'data/packs', sc.id, 'population/hrsl_belief.f32.b64.txt'), 'f32'); if (alt && !sc.live) { ctx.popAlt = { cells: alt, source: 'Meta/CIESIN HRSL v1.5' }; status.popfusion = { state: 'ok', source: 'Meta HRSL v1.5 (COG, AWS open data)' }; } else status.popfusion = { state: 'n/a', note: sc.live ? 'live packs already use HRSL' : 'HRSL layer not built for this pack' }; }
  // pass 1 (no routing) chooses the sites; pass 2 adds real travel times for the chosen sites
  log('Planning…'); let out = L.planPre(sc, params, PK.build(sc, P), ctx);
  if (useAll.routing) {
    const { T, M } = out, icpLL = L.toLL(sc, M.icp[0], M.icp[1]);
    const hz = (la, lo) => { const [x, y] = L.toXY(sc, la, lo); if (Math.abs(x) >= T.S / 2 || Math.abs(y) >= T.S / 2) return false; const k = C.idxAt(T, x, y); return !!(M.hazMask && M.hazMask[k]) || (M.flood && T.cls[k] === C.CLS.WATER); };
    const targets = out.nodes.map(n => { const s = out.sites[n.site], [la, lo] = L.toLL(sc, s.x, s.y); return { key: n.site, lat: la, lon: lo }; });
    log('Road routes…'); const rr = await step('routing', true, () => routesFrom({ lat: icpLL[0], lon: icpLL[1] }, targets, { hazardTest: hz }));
    if (rr) { ctx.routes = rr.routes; out = L.planPre(sc, params, PK.build(sc, P), ctx); out.routes = rr; }
  }
  // independent evidence (Nepal: GEV / GeoPera Bhote Koshi points)
  const evF = path.join(ROOT, 'data/evidence/bhote-koshi-2026.json'); if (sc.id === 'nepal' && fs.existsSync(evF)) { const ev = JSON.parse(fs.readFileSync(evF, 'utf8')); out.evidence = { meta: { event: ev.event, license: ev.license, caveat: ev.caveat, sources: ev.sources }, points: L.evidenceCheck(out, ev.points) }; }
  const order = L.deploymentOrder(out, { mode, eventTime, inputs: status }); order.obstruction_notice = obstructionNotice(order);
  const id = crypto.randomBytes(5).toString('hex'), result = summarise(out, { id, mode, eventTime, status, order, ms: Date.now() - t0, ctx });
  RUNS.set(id, { out, order, result }); if (RUNS.size > 20) RUNS.delete(RUNS.keys().next().value);
  return result;
}
export const getRun = id => RUNS.get(id);

/* ---------- compact result for the console (lat/lon everywhere) ---------- */
function summarise(out, meta) {
  const { sc, T, M, B, steps } = out, ll = (x, y) => L.toLL(sc, x, y).map(v => +v.toFixed(6)), h = T.S / 2;
  const sites = out.sites, nodes = out.nodes;
  const rejectedSample = steps.sites.rejected.filter((_, i) => i % Math.max(1, Math.ceil(steps.sites.rejected.length / 600)) === 0).map(s => ({ ll: ll(s.x, s.y), why: s.why }));
  const validSample = sites.filter((_, i) => i % Math.max(1, Math.ceil(sites.length / 800)) === 0).map(s => ll(s.x, s.y));
  const cnt = out.evalPairs(out.pairs).frac;
  const r = { id: meta.id, mode: meta.mode, eventTime: meta.eventTime, ms: meta.ms, scenario: { id: sc.id, name: sc.name, place: sc.place, type: sc.type, lat: sc.lat, lon: sc.lon, S: T.S, live: !!sc.live, peopleBasis: sc.peopleBasis || 'scenario figure (v7)', hazardSource: sc.hazardSource || 'observed (v7 pack)' },
    bounds: [ll(-h, -h), ll(h, h)], status: meta.status, factors: out.use, notes: out.notes,
    stages: {
      detect: { trigger: steps.detect.trigger || null, live: steps.detect.live ? { checked: steps.detect.live.checked, unavailable: steps.detect.live.unavailable, items: steps.detect.live.items.slice(0, 25) } : null, scripted: steps.detect.alerts },
      evaluate: steps.evaluate, belief: Object.assign({}, steps.belief, { facilities: steps.belief.facilities ? { count: steps.belief.facilities.count, raised: steps.belief.facilities.raised } : undefined }),
      koopman: { effort: steps.koopman.effort, r0: steps.koopman.r0 }, sites: { valid: steps.sites.valid, rejected: steps.sites.rejected.length, why: steps.sites.why },
      coverage: { heights: steps.coverage.heights, blocked: steps.coverage.blocked, r0: steps.coverage.r0 },
      optimise: { placed: steps.optimise.sol.length, cov: steps.optimise.cov, target: steps.optimise.tEff, met: steps.optimise.met, lb: steps.optimise.lb, kmeans: steps.optimise.base.needKmeans, random: steps.optimise.base.needRandom, robustness: steps.optimise.robustness || null, hoursMet: steps.optimise.hoursMet, meanCovOverHours: steps.optimise.meanCovOverHours, holdShare: steps.optimise.holdShare, tradeoff: steps.optimise.tradeoff, modulesFor: steps.optimise.modulesFor, budgetLimited: steps.optimise.budgetLimited, shareOfTimeMet: steps.optimise.shareOfTimeMet, timeWeighted: steps.optimise.timeWeighted, bins: steps.coverage.bins, perHour: steps.optimise.perHour || null, fairness: steps.optimise.fair ? { settlements: steps.optimise.fair, added: steps.optimise.fair.added } : null },
      deploy: { relays: steps.deploy.relays, linked: steps.deploy.linked, total: nodes.length, curve: steps.deploy.curve, logistics: steps.deploy.logistics, imaging: steps.deploy.imaging ? { next: steps.deploy.imaging.next, summary: steps.deploy.imaging.summary, lastClear: steps.deploy.imaging.lastClearOpticalBefore, firstPostClear: steps.deploy.imaging.firstPostClearOptical } : null },
    },
    weather: out.wx ? { source: out.wx.source, kind: out.wx.kind, nominal: out.wx.nominal, adverse: out.wx.adverse, holdHours: out.wx.holdHours, hours: out.wx.hours.map(x => ({ t: x.time, v: x.v100, g: x.gust, cb: x.cloudBase, vis: x.vis, p: x.precip, hold: x.hold })) } : null,
    command_post: ll(M.icp[0], M.icp[1]),
    modules: nodes.map((n, i) => { const s = sites[n.site]; return { id: n.id, role: n.role, ll: ll(s.x, s.y), hover: ll(s.x + (n.offset ? n.offset[0] : 0), s.y + (n.offset ? n.offset[1] : 0)), h: n.h, hEff: n.hEff, r: A.model.footR(Object.assign({}, out.p, { h: n.hEff || n.h }), n.hEff || n.h), team: n.team, eta: n.eta, etaHeld: n.etaHeld, raiseAt: n.raiseAt, wait: n.wait, gain: n.gain, km: n.km, travel: n.travelSrc, marg: n.marg, hop: n.hop, fair: n.fair, v: n.vHover }; }),
    routes: out.routes ? Object.entries(out.routes.routes).filter(([, v]) => v.ok).map(([k, v]) => ({ site: +k, cut: v.crossesHazard, min: Math.round(v.durationS / 60), km: +(v.distanceM / 1000).toFixed(1), line: v.geometry.map(([lo, la]) => [la, lo]) })) : null,
    airspace: out.airspace ? out.airspace.map(z => ({ name: z.name, type: z.type, ll: [z.lat, z.lon], r: z.r, distKm: +z.distKm.toFixed(1) })) : null,
    evidence: out.evidence || null, sitesValid: validSample, sitesRejected: rejectedSample,
    overlays: { hazard: png(T.G, T.G, k => (M.hazMask && M.hazMask[k]) ? [220, 60, 40, 150] : null, true), belief: png(B.CB, B.CB, c => { const v = B.lam[c]; if (v < 0.02) return null; const a = Math.min(1, Math.log10(1 + v * 10) / 1.6); return [255, 170 - 120 * a, 20, 40 + 150 * a]; }, true), covered: png(B.CB, B.CB, c => cnt[c] > 0 ? [40, 150, 255, Math.round(30 + 90 * cnt[c])] : null, true) },
    order: meta.order };
  return r;
}
/* tiny RGBA PNG encoder (no dependencies); rows flipped so north is up */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc(b) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); }
function png(w, h, fn, flip) { const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) { const sy = flip ? h - 1 - y : y; raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) { const v = fn(sy * w + x), o = y * (w * 4 + 1) + 1 + x * 4; if (v) { raw[o] = v[0]; raw[o + 1] = v[1]; raw[o + 2] = v[2]; raw[o + 3] = v[3]; } } }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6; return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64'); }
