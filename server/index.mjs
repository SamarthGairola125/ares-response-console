/* ARES Planner — local server. Serves the operator console and the planning API on http://localhost:4180 (localhost only, like gods-eye-view).
   Start: npm start   ·   Keys (optional): .env or the console's Settings panel. */
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(ROOT, '.env'));
const { plan, getRun, scenarios, A } = await import('./planner.mjs');
const { buildPack } = await import('./packbuilder.mjs');
const { buildInputs } = await import('./inputs.mjs');
const { sachet, gdacs, usgs } = await import('./feeds/alerts.mjs');
const PORT = +process.env.PORT || 4180, HOST = process.env.ARES_HOST || '127.0.0.1', WEB = path.join(ROOT, 'web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.txt': 'text/plain' };
const jobs = new Map();

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
  try {
    if (u.pathname === '/api/meta') return send(200, { factors: A.live.FACTORS, recommended: A.live.REC, scenarios: scenarios(), keys: { FIRMS_MAP_KEY: !!process.env.FIRMS_MAP_KEY, ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY }, version: '8.0.0' });
    if (u.pathname.startsWith('/api/inputs/')) { const id = decodeURIComponent(u.pathname.split('/').pop()); return send(200, await buildInputs(id, { mode: u.searchParams.get('mode') || 'replay' })); }
    if (u.pathname === '/api/pack' && req.method === 'POST') { const b = await body(req); const sc = await buildPack({ lat: +b.lat, lon: +b.lon, hazard: b.hazard || 'flood', eventTime: b.time || new Date().toISOString(), name: b.name || '', zones: b.zones || [], people: b.people ? +b.people : null, incident: { lat: +b.lat, lon: +b.lon } }); return send(200, { scenario: sc }); }
    if (u.pathname === '/api/analyst-direct' && req.method === 'POST') { const b = await body(req); return send(200, await analystDirect(b.prompt)); }
    if (u.pathname.startsWith('/data/')) { const f = path.normalize(path.join(ROOT, 'data/packs', decodeURIComponent(u.pathname.slice(6)))); if (!f.startsWith(path.join(ROOT, 'data/packs')) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return send(404, { error: 'not found' }); res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || (f.endsWith('.txt') ? 'text/plain' : f.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream') }); return fs.createReadStream(f).pipe(res); }
    if (u.pathname === '/api/alerts') { const now = new Date(), from = new Date(now - 7 * 864e5), out = { feeds: {}, items: [] };
      await Promise.all([
        sachet({ withPolygons: 40 }).then(s => { out.feeds.sachet = { ok: true, fetchedAt: s.fetchedAt, n: s.items.length }; s.items.filter(i => i.lat != null).forEach(i => out.items.push({ feed: 'NDMA Sachet', type: i.event || i.category, title: i.headline || i.title, severity: i.severity, time: i.effective || i.pubDate, lat: i.lat, lon: i.lon, area: i.area, sender: i.sender || i.author, polygons: i.polygons })); }).catch(e => out.feeds.sachet = { ok: false, error: e.message }),
        gdacs({ from, to: now }).then(g => { out.feeds.gdacs = { ok: true, n: g.items.length }; g.items.forEach(i => out.items.push({ feed: 'GDACS', type: i.type, title: i.name, severity: i.alert, time: i.from, lat: i.lat, lon: i.lon, url: i.url })); }).catch(e => out.feeds.gdacs = { ok: false, error: e.message }),
        usgs({ from, to: now, minMag: 3.5 }).then(q => { out.feeds.usgs = { ok: true, n: q.items.length }; q.items.forEach(i => out.items.push({ feed: 'USGS', type: 'Earthquake', title: `M${i.mag} ${i.place}`, severity: i.alert || (i.mag >= 5 ? 'High' : 'Low'), time: i.time, lat: i.lat, lon: i.lon, url: i.url })); }).catch(e => out.feeds.usgs = { ok: false, error: e.message }) ]);
      out.items.sort((a, b) => new Date(b.time) - new Date(a.time)); return send(200, out); }
    if (u.pathname === '/api/plan' && req.method === 'POST') { const b = await body(req); const id = Math.random().toString(36).slice(2, 10), job = { state: 'running', log: [] }; jobs.set(id, job);
      (async () => { try { let scenario = b.scenario, mode = b.mode || 'replay';
          if (b.live) { job.log.push('Building data for the incident area…'); const sc = await buildPack({ lat: +b.live.lat, lon: +b.live.lon, hazard: b.live.hazard || 'flood', eventTime: b.live.time || null, name: b.live.name || '', zones: b.zones || [], people: b.live.people ? +b.live.people : null, incident: b.live.incident || null, log: m => job.log.push(m) }); scenario = sc.id; mode = b.live.time && new Date(b.live.time) < Date.now() - 6 * 864e5 ? 'replay' : 'live'; }
          job.result = await plan({ scenario, mode, time: b.time || (b.live && b.live.time) || null, use: b.use || A.live.REC, zones: b.zones || [], icp: b.icp || null, teams: b.teams || 2, params: b.params || {}, log: m => job.log.push(m) }); job.state = 'done'; }
        catch (e) { job.state = 'error'; job.error = e.message; console.error(e); } })();
      return send(202, { job: id }); }
    if (u.pathname.startsWith('/api/job/')) { const j = jobs.get(u.pathname.split('/').pop()); if (!j) return send(404, { error: 'no such job' }); return send(200, { state: j.state, log: j.log, error: j.error, result: j.state === 'done' ? j.result : undefined }); }
    const om = u.pathname.match(/^\/api\/order\/(\w+)\.(json|geojson|kml|csv)$/);
    if (om) { const r = getRun(om[1]); if (!r) return send(404, { error: 'run expired' }); const L = A.live, o = r.order; res.setHeader('Content-Disposition', `attachment; filename="ares-deployment-order-${o.incident.id}.${om[2]}"`);
      if (om[2] === 'json') return send(200, JSON.stringify(o, null, 1), 'application/json; charset=utf-8'); if (om[2] === 'geojson') return send(200, JSON.stringify(L.toGeoJSON(o)), 'application/geo+json'); if (om[2] === 'kml') return send(200, L.toKML(o), 'application/vnd.google-earth.kml+xml'); return send(200, L.toCSV(o), 'text/csv'); }
    if (u.pathname === '/api/analyst' && req.method === 'POST') { const b = await body(req), r = getRun(b.run); if (!r) return send(404, { error: 'run expired' }); return send(200, await analyst(r, b.question)); }
    if (u.pathname === '/api/settings/keys' && req.method === 'POST') { const b = await body(req); const env = path.join(ROOT, '.env'); let t = fs.existsSync(env) ? fs.readFileSync(env, 'utf8') : '';
      for (const k of ['FIRMS_MAP_KEY', 'ANTHROPIC_API_KEY']) if (b[k] != null) { process.env[k] = String(b[k]).trim(); const re = new RegExp(`^${k}=.*$`, 'm'); t = re.test(t) ? t.replace(re, `${k}=${process.env[k]}`) : t + `\n${k}=${process.env[k]}`; }
      fs.writeFileSync(env, t.trim() + '\n'); return send(200, { ok: true }); }
    // static console
    let f = path.normalize(path.join(WEB, u.pathname === '/' ? 'index.html' : u.pathname)); if (!f.startsWith(WEB)) return send(403, { error: 'forbidden' });
    if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); return fs.createReadStream(f).pipe(res); }
    send(404, { error: 'not found' });
  } catch (e) { console.error(e); send(500, { error: e.message }); }
});
server.listen(PORT, HOST, () => console.log(`ARES Planner v8 on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));

function body(req) { return new Promise((ok, no) => { let d = ''; req.on('data', c => { d += c; if (d.length > 5e6) no(new Error('body too large')); }); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { no(e); } }); }); }
function loadEnv(f) { if (!fs.existsSync(f)) return; for (const l of fs.readFileSync(f, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\s]*)/); if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2]; } }

async function analystDirect(prompt) { const key = process.env.ANTHROPIC_API_KEY; if (!key) return { error: 'Add ANTHROPIC_API_KEY in .env to use the Analyst in the local app.' };
  const rr = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: process.env.ARES_ANALYST_MODEL || 'claude-sonnet-5-5', max_tokens: 900, messages: [{ role: 'user', content: prompt }] }) });
  const j = await rr.json(); return rr.ok ? { answer: (j.content || []).map(c => c.text || '').join('\n') } : { error: (j.error && j.error.message) || 'HTTP ' + rr.status }; }
/* Analyst: answers questions about the current plan from the plan itself (Claude via the Anthropic API; needs ANTHROPIC_API_KEY) */
async function analyst(r, question) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return { answer: null, error: 'Add ANTHROPIC_API_KEY in Settings to use the Analyst.' };
  const R = r.result, brief = { scenario: R.scenario, mode: R.mode, eventTime: R.eventTime, factors: R.factors, notes: R.notes, status: R.status, stages: Object.assign({}, R.stages, { optimise: Object.assign({}, R.stages.optimise, { perHour: undefined }) }), weather: R.weather && { source: R.weather.source, nominal: R.weather.nominal, adverse: R.weather.adverse, holdHours: R.weather.holdHours }, modules: R.modules, airspace: R.airspace, evidence: R.evidence && R.evidence.points };
  const sys = 'You are the ARES planning analyst. ARES places tethered aerostat modules (stationary, fixed height) to cover people at risk after a disaster in India, minimising the number of modules. Answer the operator only from the plan JSON provided; say plainly when the plan does not contain the answer. Be brief and concrete; name modules by id; give numbers with units. Never invent data.';
  const rr = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: process.env.ARES_ANALYST_MODEL || 'claude-sonnet-5-5', max_tokens: 900, system: sys, messages: [{ role: 'user', content: `Plan:\n${JSON.stringify(brief).slice(0, 150000)}\n\nQuestion: ${question}` }] }) });
  const j = await rr.json(); if (!rr.ok) return { answer: null, error: (j.error && j.error.message) || ('HTTP ' + rr.status) };
  return { answer: (j.content || []).map(c => c.text || '').join('\n') };
}
