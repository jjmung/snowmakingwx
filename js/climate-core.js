// Shared climate helpers. Loaded by history.html in the browser and by scripts/build-cache.mjs in Node,
// so the repo cache files and the live page use exactly the same wet-bulb and binning rules.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnowWXCore = factory();
})(this, function () {
  const BIN_MIN = -40; // wet-bulb histogram bins: index = round(°F) + 40, clamped to 0..130
  const NBINS = 131;
  const CACHE_VERSION = 1;

  // Stull (2011) wet bulb from air temperature (°C) and relative humidity (%); returns °F.
  function wetBulbF(tc, rh) {
    const r = Math.min(Math.max(rh, 5), 99);
    const tw = tc * Math.atan(0.151977 * Math.sqrt(r + 8.313659)) + Math.atan(tc + r) - Math.atan(r - 1.676331)
      + 0.00391838 * Math.pow(r, 1.5) * Math.atan(0.023101 * r) - 4.686035;
    return (Math.min(tw, tc) * 9) / 5 + 32;
  }
  const binIndex = (f) => Math.max(0, Math.min(NBINS - 1, Math.round(f) - BIN_MIN));

  // Winter slot for a 'YYYY-MM-DD...' string: Nov-Apr -> { wy: winter start year, mi: 0..5 }, else null.
  function winterSlot(s) {
    const yr = +s.slice(0, 4), m = +s.slice(5, 7);
    if (m >= 11) return { wy: yr, mi: m - 11 };
    if (m <= 4) return { wy: yr - 1, mi: m + 1 };
    return null;
  }

  const emptyBins = () => Array.from({ length: 6 }, () => new Array(NBINS).fill(0));

  // Adds hourly observations (Open-Meteo hourly block, temperature in °C) into bins[winter][month][bin].
  // `want` is a Set of winter start years to count; others are ignored.
  function addHourly(bins, hourly, want) {
    const { time, temperature_2m: T, relative_humidity_2m: RH } = hourly;
    for (let i = 0; i < time.length; i++) {
      if (T[i] == null || RH[i] == null) continue;
      const slot = winterSlot(time[i]);
      if (!slot || !want.has(slot.wy)) continue;
      (bins[slot.wy] || (bins[slot.wy] = emptyBins()))[slot.mi][binIndex(wetBulbF(T[i], RH[i]))]++;
    }
  }

  const roundCoord = (v) => Math.round(v * 100) / 100;
  // Cache key: coordinates rounded to 0.01° (about 1 km), e.g. "44.93_-89.68".
  const cacheKey = (lat, lon) => `${roundCoord(lat).toFixed(2)}_${roundCoord(lon).toFixed(2)}`;

  function datesFrom(start, n) {
    const out = new Array(n);
    let t = Date.parse(start + 'T00:00:00Z');
    for (let i = 0; i < n; i++, t += 864e5) out[i] = new Date(t).toISOString().slice(0, 10);
    return out;
  }
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

  return { BIN_MIN, NBINS, CACHE_VERSION, wetBulbF, binIndex, winterSlot, emptyBins, addHourly, roundCoord, cacheKey, datesFrom, r1, r2 };
});
