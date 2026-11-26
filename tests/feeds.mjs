/* Live feed smoke test: one real request per source (results depend on network and the sources being up). */
import { nearIncidents, sachet } from '../server/feeds/alerts.mjs';
import { weatherWindow } from '../server/feeds/weather.mjs';
import { imageryContext } from '../server/feeds/imagery.mjs';
import { routesFrom } from '../server/feeds/routing.mjs';
import { airports } from '../server/feeds/airports.mjs';
const t = async (n, f) => { const s = Date.now(); try { const r = await f(); console.log('OK ', n, (Date.now() - s) + 'ms', JSON.stringify(r).slice(0, 380)); } catch (e) { console.log('ERR', n, e.message); } };
await t('incidents', () => nearIncidents({ lat: 30.366, lon: 78.133, time: '2025-09-15T18:30:00Z' }).then(r => ({ checked: r.checked, n: r.items.length, trigger: r.trigger, unavailable: r.unavailable })));
await t('weather-era5', () => weatherWindow({ lat: 30.366, lon: 78.133, start: '2025-09-15T18:30:00Z', mode: 'replay' }).then(r => ({ src: r.source, n: r.hours.length, h0: r.hours[0] })));
await t('imagery', () => imageryContext({ lat: 30.366, lon: 78.133, time: '2025-09-15T18:30:00Z' }).then(r => ({ s: r.summary, next: r.next.radar, opt: r.next.optical, err: r.errors })));
await t('osrm', () => routesFrom({ lat: 30.35, lon: 78.11 }, [{ key: 1, lat: 30.38, lon: 78.13 }]).then(r => r.routes));
await t('airports', () => airports().then(r => ({ n: r.items.length, ex: r.items.find(a => a.ident === 'VIDN') })));
await t('sachet', () => sachet({ withPolygons: 3 }).then(r => ({ n: r.items.length, i0: r.items[0] && { ev: r.items[0].event, sev: r.items[0].severity, lat: r.items[0].lat } })));
await t('weather-live', () => weatherWindow({ lat: 30.366, lon: 78.133, start: new Date(), mode: 'live' }).then(r => ({ src: r.source, n: r.hours.length, ens: r.ensemble && r.ensemble.members, ee: r.ensembleError, h0: r.hours[0] })));
