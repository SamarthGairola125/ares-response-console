#!/usr/bin/env node
/* ares-mcp — Model Context Protocol server (stdio) so Claude Desktop / other MCP clients can run the ARES planner (idea from gods-eye-view's MCP server).
   Claude Desktop config:  { "mcpServers": { "ares": { "command": "node", "args": ["<path>/server/mcp.mjs"] } } } */
import readline from 'readline';
const log = (...a) => process.stderr.write(a.join(' ') + '\n'); console.log = (...a) => log(...a); // keep stdout for JSON-RPC only
const { plan, getRun, scenarios, A } = await import('./planner.mjs');
const { buildPack } = await import('./packbuilder.mjs');
const { sachet, gdacs, usgs } = await import('./feeds/alerts.mjs');
const FAC = Object.keys(A.live.FACTORS);
const TOOLS = [
  { name: 'ares_list_scenarios', description: 'List the ARES scenarios (five replay events plus any areas already built for live incidents).', inputSchema: { type: 'object', properties: {} } },
  { name: 'ares_india_alerts', description: 'Current disaster alerts for India and Nepal from NDMA Sachet (official CAP alerts), GDACS and USGS (last 7 days).', inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 30 } } } },
  { name: 'ares_plan_scenario', description: 'Plan the aerostat deployment (stages 1–8, up to the moment modules are raised) for a scenario on its event date, with real archived inputs.', inputSchema: { type: 'object', properties: { scenario: { type: 'string' }, factors: { type: 'array', items: { type: 'string', enum: FAC }, description: 'Inputs to use; default = recommended set' } }, required: ['scenario'] } },
  { name: 'ares_plan_location', description: 'Build the data for any point in India and plan a deployment there with live feeds.', inputSchema: { type: 'object', properties: { lat: { type: 'number' }, lon: { type: 'number' }, hazard: { type: 'string', enum: ['flood', 'debris', 'quake'] }, name: { type: 'string' }, time: { type: 'string', description: 'ISO time of the event; default now' }, people: { type: 'number' } }, required: ['lat', 'lon', 'hazard'] } },
  { name: 'ares_deployment_order', description: 'Get the deployment-order file (modules, positions, heights, raise sequence, radio settings) for a run id.', inputSchema: { type: 'object', properties: { run_id: { type: 'string' }, format: { type: 'string', enum: ['json', 'geojson', 'kml', 'csv'], default: 'json' } }, required: ['run_id'] } },
];
const brief = r => ({ run_id: r.id, scenario: r.scenario, mode: r.mode, event_time: r.eventTime, modules: r.modules.map(m => ({ id: m.id, role: m.role, lat: m.ll[0], lon: m.ll[1], height_m: m.h, team: m.team, eta_min: m.etaHeld ?? m.eta })), coverage: r.stages.optimise.cov, target: r.stages.optimise.target, met: r.stages.optimise.met, share_of_hours_met: r.stages.optimise.shareOfTimeMet, modules_for_reliability: r.stages.optimise.modulesFor, trigger: r.stages.detect.trigger, next_imaging: r.stages.deploy.imaging && r.stages.deploy.imaging.next, sources: r.status, notes: r.notes });
async function call(name, a) {
  if (name === 'ares_list_scenarios') return scenarios();
  if (name === 'ares_india_alerts') { const now = new Date(), from = new Date(now - 7 * 864e5), items = [];
    await Promise.allSettled([sachet({ withPolygons: 30 }).then(s => s.items.filter(i => i.lat != null).forEach(i => items.push({ feed: 'NDMA Sachet', type: i.event, severity: i.severity, area: i.area, time: i.effective || i.pubDate, lat: i.lat, lon: i.lon }))), gdacs({ from, to: now }).then(g => g.items.forEach(i => items.push({ feed: 'GDACS', type: i.type, name: i.name, severity: i.alert, time: i.from, lat: i.lat, lon: i.lon }))), usgs({ from, to: now, minMag: 3.5 }).then(q => q.items.forEach(i => items.push({ feed: 'USGS', type: 'EQ', name: `M${i.mag} ${i.place}`, time: i.time, lat: i.lat, lon: i.lon })))]);
    return items.sort((x, y) => new Date(y.time) - new Date(x.time)).slice(0, a.limit || 30); }
  if (name === 'ares_plan_scenario') { const use = a.factors ? Object.fromEntries(FAC.map(f => [f, a.factors.includes(f)])) : A.live.REC; return brief(await plan({ scenario: a.scenario, use })); }
  if (name === 'ares_plan_location') { const sc = await buildPack({ lat: a.lat, lon: a.lon, hazard: a.hazard, name: a.name, eventTime: a.time || new Date().toISOString(), people: a.people ?? null, incident: { lat: a.lat, lon: a.lon }, log }); return brief(await plan({ scenario: sc.id, mode: 'live', time: a.time || new Date().toISOString(), use: A.live.REC })); }
  if (name === 'ares_deployment_order') { const r = getRun(a.run_id); if (!r) throw new Error('Unknown or expired run id'); const L = A.live, f = a.format || 'json'; return f === 'json' ? r.order : f === 'geojson' ? L.toGeoJSON(r.order) : f === 'kml' ? L.toKML(r.order) : L.toCSV(r.order); }
  throw new Error('Unknown tool ' + name);
}
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
readline.createInterface({ input: process.stdin }).on('line', async line => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg; if (id === undefined) return; // notifications
  try {
    if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: (params && params.protocolVersion) || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'ares-planner', version: '8.0.0' } } });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'tools/call') { const out = await call(params.name, params.arguments || {}); return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 1) }] } }); }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  } catch (e) { send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: String(e.message || e) }] } }); }
});
