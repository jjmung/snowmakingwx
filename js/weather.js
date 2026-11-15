// NWS (api.weather.gov) gridpoint forecast loader, latest station observations and psychrometric helpers.
(function () {
  const BASE = 'https://api.weather.gov';
  const HOUR = 3600e3;

  async function getJSON(url, tries = 3) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/geo+json' } });
        if (res.ok) return await res.json();
        lastErr = new Error(`NWS returned ${res.status} for ${url}`);
        if (res.status === 404) break; // outside NWS coverage; retrying won't help
      } catch (e) {
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
    throw lastErr;
  }

  // ISO-8601 duration like PT1H, PT6H, P1D, P1DT6H -> whole hours
  function durationHours(iso) {
    const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(iso || '');
    if (!m) return 1;
    return Math.max(1, (+m[1] || 0) * 24 + (+m[2] || 0) + Math.round((+m[3] || 0) / 60));
  }

  // Normalize NWS layer values to °C, km/h, %, degrees, mm.
  function canonical(uom, v) {
    if (v == null) return null;
    switch (uom) {
      case 'wmoUnit:degF': return (v - 32) * 5 / 9;
      case 'wmoUnit:m_s-1': return v * 3.6;
      case 'wmoUnit:m': return v * 1000;
      default: return v;
    }
  }

  // Expand a gridpoint layer (values with validTime ranges) into an hourly array.
  function expand(layer, startMs, count, spread = false) {
    const out = new Array(count).fill(null);
    if (!layer || !layer.values) return out;
    for (const { validTime, value } of layer.values) {
      const [startIso, dur] = validTime.split('/');
      const t0 = Date.parse(startIso);
      const n = durationHours(dur);
      const v = canonical(layer.uom, value);
      for (let k = 0; k < n; k++) {
        const idx = Math.round((t0 + k * HOUR - startMs) / HOUR);
        if (idx >= 0 && idx < count) out[idx] = v == null ? null : spread ? v / n : v;
      }
    }
    return out;
  }

  const cToF = (c) => c * 9 / 5 + 32;
  const kmhToMph = (k) => k / 1.609344;

  // Saturation vapor pressure over water, kPa (Magnus/Alduchov-Eskridge)
  const satVP = (tC) => 0.61094 * Math.exp(17.625 * tC / (tC + 243.04));

  // Standard-atmosphere station pressure from elevation, kPa
  const pressureKPa = (elevM) => 101.325 * Math.pow(1 - 2.25577e-5 * elevM, 5.25588);

  // Psychrometric wet bulb (°C) solved by bisection, accounting for station pressure.
  function wetBulbC(tC, rh, pKPa) {
    const e = (Math.min(Math.max(rh, 1), 100) / 100) * satVP(tC);
    let lo = tC - 40, hi = tC;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      const f = satVP(mid) - 6.6e-4 * (1 + 1.15e-3 * mid) * pKPa * (tC - mid) - e;
      if (f > 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }

  function dewPointC(tC, rh) {
    const g = Math.log(Math.max(rh, 1) / 100) + (17.625 * tC) / (243.04 + tC);
    return (243.04 * g) / (17.625 - g);
  }

  // Extended range (to 16 days) from Open-Meteo's global models, used for hours past the end
  // of the NWS forecast. Temperatures are adjusted to the same elevation as the NWS grid.
  async function fetchExtended(lat, lon, elevM, afterMs) {
    const q = new URLSearchParams({
      latitude: lat.toFixed(4), longitude: lon.toFixed(4), elevation: Math.round(elevM),
      hourly: 'temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation_probability,cloud_cover,snowfall',
      forecast_days: 16, timeformat: 'unixtime', timezone: 'GMT',
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
    if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
    const h = (await res.json()).hourly;
    const pKPa = pressureKPa(elevM);
    const out = [];
    h.time.forEach((sec, i) => {
      const t = sec * 1000;
      const tC = h.temperature_2m[i], rh = h.relative_humidity_2m[i];
      if (t <= afterMs || tC == null || rh == null) return;
      const windMph = h.wind_speed_10m[i] == null ? null : kmhToMph(h.wind_speed_10m[i]);
      const gust = h.wind_gusts_10m[i];
      out.push({
        t,
        tempF: cToF(tC),
        dewF: cToF(h.dew_point_2m[i] ?? dewPointC(tC, rh)),
        rh,
        wbF: cToF(wetBulbC(tC, rh, pKPa)),
        windMph,
        gustMph: gust == null ? windMph : Math.max(kmhToMph(gust), windMph ?? 0),
        windDir: h.wind_direction_10m[i],
        pop: h.precipitation_probability[i],
        sky: h.cloud_cover[i],
        snowIn: h.snowfall[i] == null ? null : h.snowfall[i] / 2.54, // cm -> in
        ext: true,
      });
    });
    return out;
  }

  async function fetchForecast(lat, lon) {
    const point = await getJSON(`${BASE}/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
    const pp = point.properties;
    const grid = await getJSON(pp.forecastGridData);
    const gp = grid.properties;

    const elevM = gp.elevation?.value ?? 0;
    const pKPa = pressureKPa(elevM);
    const startMs = Math.floor(Date.now() / HOUR) * HOUR;

    let endMs = startMs;
    for (const v of gp.temperature.values) {
      const [s, d] = v.validTime.split('/');
      endMs = Math.max(endMs, Date.parse(s) + durationHours(d) * HOUR);
    }
    const count = Math.min(168, Math.round((endMs - startMs) / HOUR));

    const T = expand(gp.temperature, startMs, count);
    const RH = expand(gp.relativeHumidity, startMs, count);
    const TD = expand(gp.dewpoint, startMs, count);
    const WS = expand(gp.windSpeed, startMs, count);
    const WG = expand(gp.windGust, startMs, count);
    const WD = expand(gp.windDirection, startMs, count);
    const POP = expand(gp.probabilityOfPrecipitation, startMs, count);
    const SKY = expand(gp.skyCover, startMs, count);
    const SNOW = expand(gp.snowfallAmount, startMs, count, true);

    const hours = [];
    for (let i = 0; i < count; i++) {
      if (T[i] == null || RH[i] == null) continue;
      const tC = T[i], rh = RH[i];
      const dC = TD[i] ?? dewPointC(tC, rh);
      const windMph = WS[i] == null ? null : kmhToMph(WS[i]);
      const gustMph = WG[i] == null ? windMph : Math.max(kmhToMph(WG[i]), windMph ?? 0);
      hours.push({
        t: startMs + i * HOUR,
        tempF: cToF(tC),
        dewF: cToF(dC),
        rh,
        wbF: cToF(wetBulbC(tC, rh, pKPa)),
        windMph,
        gustMph,
        windDir: WD[i],
        pop: POP[i],
        sky: SKY[i],
        snowIn: SNOW[i] == null ? null : SNOW[i] / 25.4,
      });
    }

    // Hours past the NWS range. The NWS forecast still stands on its own if this fails.
    let extended = false;
    if (hours.length) {
      try {
        const more = await fetchExtended(lat, lon, elevM, hours[hours.length - 1].t);
        hours.push(...more);
        extended = more.length > 0;
      } catch (e) {
        console.error(e);
      }
    }

    const rl = pp.relativeLocation?.properties;
    return {
      hours,
      meta: {
        elevM,
        extended,
        timeZone: pp.timeZone,
        place: rl ? `${rl.city}, ${rl.state}` : '',
        office: pp.gridId,
        gridX: pp.gridX,
        gridY: pp.gridY,
        updated: gp.updateTime,
        fetched: Date.now(),
      },
    };
  }

  // Latest real observation from the nearest NWS station that is reporting.
  // Returns null when no nearby station has a usable report from the last 90 minutes.
  async function fetchCurrent(lat, lon) {
    const point = await getJSON(`${BASE}/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
    const list = await getJSON(`${point.properties.observationStations}?limit=4`);
    const rad = Math.PI / 180;
    for (const st of list.features || []) {
      const sp = st.properties;
      let obs;
      try {
        obs = await getJSON(`${BASE}/stations/${sp.stationIdentifier}/observations?limit=6`, 1);
      } catch {
        continue; // station offline; try the next nearest
      }
      for (const f of obs.features || []) {
        const o = f.properties;
        const t = Date.parse(o.timestamp);
        if (!(Date.now() - t < 90 * 60e3)) break; // newest first: the rest are older still
        const tC = canonical(o.temperature?.unitCode, o.temperature?.value);
        const dObs = canonical(o.dewpoint?.unitCode, o.dewpoint?.value);
        let rh = o.relativeHumidity?.value;
        if (rh == null && tC != null && dObs != null) rh = 100 * satVP(dObs) / satVP(tC);
        if (tC == null || rh == null) continue;
        rh = Math.min(100, rh);
        const elevM = sp.elevation?.value ?? 0; // metres
        const ws = canonical(o.windSpeed?.unitCode, o.windSpeed?.value);
        const wg = canonical(o.windGust?.unitCode, o.windGust?.value);
        // Distance and compass bearing from the resort to the station
        const [sLon, sLat] = st.geometry.coordinates;
        const dLat = (sLat - lat) * rad, dLon = (sLon - lon) * rad;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * rad) * Math.cos(sLat * rad) * Math.sin(dLon / 2) ** 2;
        const y = Math.sin(dLon) * Math.cos(sLat * rad);
        const x = Math.cos(lat * rad) * Math.sin(sLat * rad) - Math.sin(lat * rad) * Math.cos(sLat * rad) * Math.cos(dLon);
        return {
          t,
          tempF: cToF(tC),
          dewF: cToF(dObs ?? dewPointC(tC, rh)),
          rh,
          wbF: cToF(wetBulbC(tC, rh, pressureKPa(elevM))),
          windMph: ws == null ? null : kmhToMph(ws),
          gustMph: wg == null ? null : kmhToMph(wg),
          windDir: o.windDirection?.value ?? null,
          station: { id: sp.stationIdentifier, name: sp.name, elevM, distMi: 3958.8 * 2 * Math.asin(Math.sqrt(a)), bearing: (Math.atan2(y, x) / rad + 360) % 360 },
        };
      }
    }
    return null;
  }

  window.SnowWeather = { fetchForecast, fetchCurrent, wetBulbC, pressureKPa };
})();
