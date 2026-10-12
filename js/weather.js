// NWS (api.weather.gov) gridpoint forecast loader and psychrometric helpers.
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

    const rl = pp.relativeLocation?.properties;
    return {
      hours,
      meta: {
        elevM,
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

  window.SnowWeather = { fetchForecast, wetBulbC, pressureKPa };
})();
