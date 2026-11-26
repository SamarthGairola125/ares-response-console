/* Stages 5–7 inputs — weather for the deployment window.
   LIVE: Open-Meteo forecast (wind at 80/120/180 m, gusts, visibility, low cloud, CAPE, lightning potential) + GFS ensemble spread.
   REPLAY: ERA5 reanalysis via the Open-Meteo archive (wind at 100 m, gusts, low cloud, rain, CAPE, temperature/dew point). */
import { cachedFetch, day } from '../http.mjs';

export async function weatherWindow({ lat, lon, start, hours = 24, mode }) {
  const t0 = new Date(start), t1 = new Date(+t0 + hours * 3600e3), past = mode === 'replay' || t1 < Date.now() - 6 * 864e5;
  if (past) {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${day(t0)}&end_date=${day(t1)}&hourly=wind_speed_100m,wind_direction_100m,wind_gusts_10m,wind_direction_10m,temperature_2m,dew_point_2m,cloud_cover_low,precipitation&wind_speed_unit=ms&timezone=UTC`; // (CAPE is not served for recent archive dates)
    let r; try { r = await cachedFetch('openmeteo-era5', url.replace('&wind_speed_unit', ',cloud_base&wind_speed_unit'), { forever: true, timeoutMs: 45e3 }); } catch (e) { r = await cachedFetch('openmeteo-era5', url, { forever: true, timeoutMs: 45e3 }); }
    return pack(r, t0, t1, 'ERA5 reanalysis (Open-Meteo archive)', 'replay', h => ({ wind100: h.wind_speed_100m, dir100: h.wind_direction_100m, gust: h.wind_gusts_10m, dir10: h.wind_direction_10m, t2m: h.temperature_2m, td2m: h.dew_point_2m, cloudLow: h.cloud_cover_low, cloudBaseApi: h.cloud_base ?? null, precip: h.precipitation, cape: null }));
  }
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_80m,wind_speed_120m,wind_speed_180m,wind_direction_120m,wind_gusts_10m,temperature_2m,dew_point_2m,cloud_cover_low,visibility,precipitation,cape,lightning_potential&wind_speed_unit=ms&timezone=UTC&past_days=1&forecast_days=3`;
  let r; try { r = await cachedFetch('openmeteo-forecast', url.replace('&wind_speed_unit', ',cloud_base&wind_speed_unit'), { ttlMs: 30 * 60e3 }); } catch (e) { r = await cachedFetch('openmeteo-forecast', url, { ttlMs: 30 * 60e3 }); }
  const w = pack(r, t0, t1, 'Open-Meteo forecast (best-match models)', 'live', h => ({ wind120: h.wind_speed_120m, wind80: h.wind_speed_80m, wind180: h.wind_speed_180m, wind100: h.wind_speed_80m != null && h.wind_speed_120m != null ? (h.wind_speed_80m + h.wind_speed_120m) / 2 : null, dir100: h.wind_direction_120m, gust: h.wind_gusts_10m, t2m: h.temperature_2m, td2m: h.dew_point_2m, cloudLow: h.cloud_cover_low, cloudBaseApi: h.cloud_base ?? null, vis: h.visibility, precip: h.precipitation, cape: h.cape, lightning: h.lightning_potential }));
  try { // ensemble spread (GFS 0.25°, 31 members) for the robust plan
    const e = await cachedFetch('openmeteo-ensemble', `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${lat}&longitude=${lon}&hourly=wind_speed_120m&models=gfs025&wind_speed_unit=ms&timezone=UTC&forecast_days=3`, { ttlMs: 60 * 60e3, timeoutMs: 45e3 });
    const H = e.data.hourly, keys = Object.keys(H).filter(k => k.startsWith('wind_speed_120m')), idx = H.time.map((t, i) => [new Date(t + 'Z'), i]).filter(([t]) => t >= t0 && t <= t1).map(x => x[1]);
    w.ensemble = { model: 'GFS 0.25° ensemble', members: keys.length, v120: keys.map(k => idx.map(i => H[k][i])), fetchedAt: e.fetchedAt };
  } catch (err) { w.ensembleError = err.message; }
  return w;
}
function pack(r, t0, t1, source, kind, map) {
  const H = r.data.hourly, hours = [];
  for (let i = 0; i < H.time.length; i++) { const t = new Date(H.time[i] + 'Z'); if (t < new Date(+t0 - 1800e3) || t > t1) continue; const row = {}; for (const k in H) row[k] = H[k][i]; hours.push(Object.assign({ time: t.toISOString() }, map(row))); }
  return { source, kind, fetchedAt: r.fetchedAt, via: r.via, grid: { lat: r.data.latitude, lon: r.data.longitude, elevation: r.data.elevation }, hours };
}
