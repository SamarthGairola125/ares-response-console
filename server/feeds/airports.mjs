/* Stage 5 input — airports, airstrips and heliports (OurAirports, public domain, via GitHub). Used for launch-site airspace clearance.
   Radii are planning assumptions in config/fleet.json (airportR), not DGCA rules: check the current DGCA / Digital Sky airspace map before flying. */
import { cachedFetch } from '../http.mjs';
const URL = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv';
let memo = null;
export async function airports({ countries = ['IN', 'NP'] } = {}) {
  if (memo) return memo;
  const r = await cachedFetch('ourairports', URL, { as: 'text', ttlMs: 30 * 864e5, timeoutMs: 60e3 });
  const lines = r.data.split('\n'), head = parse(lines[0]), ix = n => head.indexOf(n), out = [];
  for (let i = 1; i < lines.length; i++) { if (!lines[i]) continue; const v = parse(lines[i]); if (!countries.includes(v[ix('iso_country')])) continue; out.push({ ident: v[ix('ident')], type: v[ix('type')], name: v[ix('name')], lat: +v[ix('latitude_deg')], lon: +v[ix('longitude_deg')], country: v[ix('iso_country')], region: v[ix('iso_region')] }); }
  memo = { source: 'OurAirports (public domain)', fetchedAt: r.fetchedAt, items: out }; return memo;
}
function parse(l) { const o = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(cur); cur = ''; } else cur += ch; } o.push(cur); return o; }
