/* HTTP fetch with an on-disk cache (pattern taken from gods-eye-view's .gev-cache): every response is stored with when it was fetched,
   so the console can show data age, the planner keeps working offline on the last good copy, and REPLAY requests (fixed past dates) are fetched once. */
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import { fileURLToPath } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE_DIR = process.env.ARES_CACHE || path.join(ROOT, 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });
const UA = 'ARES-Planner/8.0 (disaster-response research; contact via repository)';
const LOG = path.join(CACHE_DIR, 'fetch-log.jsonl');

export async function cachedFetch(source, url, { ttlMs = 15 * 60e3, body = null, headers = {}, as = 'json', timeoutMs = 30e3, forever = false } = {}) {
  const key = crypto.createHash('sha1').update(url + '|' + (body || '')).digest('hex'), dir = path.join(CACHE_DIR, source), file = path.join(dir, key + (as === 'buffer' ? '.bin' : '.json')), meta = path.join(dir, key + '.meta.json');
  fs.mkdirSync(dir, { recursive: true });
  let m = null; try { m = JSON.parse(fs.readFileSync(meta, 'utf8')); } catch {}
  const fresh = m && (forever || Date.now() - m.fetchedAt < ttlMs);
  if (fresh && fs.existsSync(file)) return wrap(read(file, as), m, 'cache');
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(url, { method: body ? 'POST' : 'GET', body, headers: Object.assign({ 'User-Agent': UA }, body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}, headers), signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = as === 'buffer' ? Buffer.from(await r.arrayBuffer()) : as === 'text' ? await r.text() : await r.json();
    const mm = { source, url, fetchedAt: Date.now(), status: r.status };
    fs.writeFileSync(file, as === 'buffer' ? data : as === 'text' ? data : JSON.stringify(data)); fs.writeFileSync(meta, JSON.stringify(mm));
    log({ source, url: url.slice(0, 300), ok: true, status: r.status });
    return wrap(data, mm, 'live');
  } catch (e) {
    log({ source, url: url.slice(0, 300), ok: false, error: String(e.message || e) });
    if (m && fs.existsSync(file)) return wrap(read(file, as), m, 'stale', String(e.message || e)); // offline: last good copy
    const err = new Error(`${source}: ${e.message || e}`); err.source = source; throw err;
  }
}
function read(file, as) { return as === 'buffer' ? fs.readFileSync(file) : as === 'text' ? fs.readFileSync(file, 'utf8') : JSON.parse(fs.readFileSync(file, 'utf8')); }
function wrap(data, m, via, error) { return { data, fetchedAt: new Date(m.fetchedAt).toISOString(), via, error: error || null, url: m.url }; }
function log(o) { try { fs.appendFileSync(LOG, JSON.stringify(Object.assign({ t: new Date().toISOString() }, o)) + '\n'); } catch {} }
export const iso = d => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
export const day = d => new Date(d).toISOString().slice(0, 10);
export function haversine(a, b, c, d) { const R = 6371e3, r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
