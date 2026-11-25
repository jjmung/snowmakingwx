// Climate history storage and fetching, shared by the History page and the background downloader.
// Data comes from the Open-Meteo Historical Weather API and is kept in the browser's IndexedDB,
// one record per location (coordinates rounded to 0.01°, see SnowWXCore.cacheKey).
//
// Open-Meteo's free tier has minute, hour and day limits, and a long request counts as many
// "calls" (roughly one per 14 days of data). Every request made here is recorded in a small
// ledger in localStorage, so background work can stay well under the limits across page loads
// and tabs, and a rate-limit answer pauses background work for that limit's period.
(function () {
  const Core = window.SnowWXCore;
  const DATA_START = '1950-01-01';
  // Daily data older than this (by its newest day) is refreshed. Refreshes fetch only the new days
  // (about 5 calls), and the archive runs about a week behind, so this means every few days,
  // which keeps the season in progress current.
  const MAX_AGE_DAYS = 10;
  const WINTERS_PER_CHUNK = 5; // hourly data is fetched five winters (Nov–Apr) per request

  // ---------- IndexedDB ----------
  const idb = {
    db: null,
    open() {
      if (this.db) return this.db;
      this.db = new Promise((resolve) => {
        try {
          const rq = indexedDB.open('snowwx-history', 1);
          rq.onupgradeneeded = () => rq.result.createObjectStore('climate');
          rq.onsuccess = () => resolve(rq.result);
          rq.onerror = () => resolve(null);
        } catch { resolve(null); }
      });
      return this.db;
    },
    async get(key) {
      const db = await this.open();
      if (!db) return null;
      return new Promise((resolve) => {
        try { const r = db.transaction('climate').objectStore('climate').get(key); r.onsuccess = () => resolve(r.result || null); r.onerror = () => resolve(null); } catch { resolve(null); }
      });
    },
    async put(key, val) {
      const db = await this.open();
      if (!db) return;
      return new Promise((resolve) => {
        try { const tx = db.transaction('climate', 'readwrite'); tx.objectStore('climate').put(val, key); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); } catch { resolve(); }
      });
    },
  };

  async function get(key) {
    const p = await idb.get(key);
    return p && p.v === Core.CACHE_VERSION ? p : null;
  }

  // Save without losing work done elsewhere (another tab, or the page and the background
  // downloader at once): winters already stored are kept, and the newer daily series wins.
  async function save(payload) {
    const old = await get(payload.key);
    let out = payload;
    if (old) {
      const newer = old.through > payload.through ? old : payload;
      out = { ...newer, bins: { ...(old.bins || {}), ...(payload.bins || {}) } };
    }
    await idb.put(out.key, out);
    return out;
  }

  // ---------- request ledger and rate limits ----------
  const LEDGER = 'snowwx.apiLedger';
  const COOLDOWN = 'snowwx.apiCooldown';
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const DAY = 864e5;
  function ledger() { return ls.get(LEDGER, []).filter(([t]) => Date.now() - t < DAY); }
  function record(weight) { ls.set(LEDGER, [...ledger(), [Date.now(), Math.round(weight * 10) / 10]]); }
  // Estimated calls used in the last `ms` milliseconds
  function used(ms) { return ledger().reduce((s, [t, w]) => (Date.now() - t < ms ? s + w : s), 0); }
  // When the oldest entry inside the window ages out (for waiting on a budget)
  function freesAt(ms) { const l = ledger().filter(([t]) => Date.now() - t < ms); return l.length ? l[0][0] + ms : Date.now(); }

  // Open-Meteo's own counting: about one call per 14 days per 10 variables, at least one call.
  function weight(params) {
    const days = (Date.parse(params.end_date) - Date.parse(params.start_date)) / DAY + 1;
    const vars = String(params.daily || params.hourly || '').split(',').length;
    return Math.max(1, days / 14) * Math.max(1, vars / 10);
  }

  function cooldownUntil() { return ls.get(COOLDOWN, 0); }
  function setCooldown(ms, why) { ls.set(COOLDOWN, Date.now() + ms); ls.set(COOLDOWN + '.why', why); }
  function cooldownWhy() { return ls.get(COOLDOWN + '.why', ''); }

  class RateLimitError extends Error {
    constructor(reason) {
      super(reason || 'data service rate limit reached');
      const r = (reason || '').toLowerCase();
      this.scope = r.includes('daily') ? 'day' : r.includes('hourly') ? 'hour' : r.includes('minutely') ? 'minute' : 'hour';
    }
  }

  async function archive(lat, lon, params) {
    const q = { latitude: Core.roundCoord(lat).toFixed(2), longitude: Core.roundCoord(lon).toFixed(2), timezone: 'auto', ...params };
    const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?${new URLSearchParams(q)}`);
    record(weight(params)); // refused requests count toward the limits too
    if (!res.ok) {
      let why = '';
      try { why = (await res.json()).reason || ''; } catch { /* ignore */ }
      // Open-Meteo reports its limits with 429, or with 400 and a reason like
      // "Hourly API request limit exceeded. Please try again in the next hour."
      if (res.status === 429 || /limit exceeded/i.test(why)) {
        const e = new RateLimitError(why);
        // Pause background downloads for the period of the limit that was hit
        setCooldown({ minute: 2 * 60e3, hour: 60 * 60e3, day: 6 * 60 * 60e3 }[e.scope], e.message);
        throw e;
      }
      throw new Error(why || `data service returned ${res.status}`);
    }
    return res.json();
  }

  // ---------- daily history ----------
  const isoDay = (d) => d.toISOString().slice(0, 10);
  const archiveEnd = () => isoDay(new Date(Date.now() - 7 * DAY)); // ERA5 lags a few days
  const ageDays = (p) => (Date.now() - Date.parse(p.through)) / DAY;
  const needsDaily = (p) => !p || ageDays(p) > MAX_AGE_DAYS;

  const DAILY_VARS = 'temperature_2m_max,temperature_2m_min,temperature_2m_mean,snowfall_sum';
  const addDays = (iso, n) => isoDay(new Date(Date.parse(iso) + n * DAY));
  // Days to fetch again at the end of the stored series: the newest reanalysis days can be revised
  const OVERLAP_DAYS = 14;
  // Start date for a daily refresh: everything from 1950 the first time, after that only the
  // newest days (a refresh costs about 2–5 calls instead of about 2,000).
  const dailyFrom = (old) => (old && old.daily && old.through ? addDays(old.through, -OVERLAP_DAYS) : DATA_START);

  async function fetchDaily(place, old = null) {
    const from = dailyFrom(old);
    const j = await archive(place.lat, place.lon, {
      start_date: from, end_date: archiveEnd(), daily: DAILY_VARS,
      temperature_unit: 'fahrenheit', precipitation_unit: 'inch',
    });
    const d = j.daily;
    let last = d.time.length - 1;
    while (last > 0 && d.temperature_2m_min[last] == null) last--;
    const n = last + 1;
    const cut = (a, f) => a.slice(0, n).map(f);
    let daily = { start: d.time[0], min: cut(d.temperature_2m_min, Core.r1), max: cut(d.temperature_2m_max, Core.r1), mean: cut(d.temperature_2m_mean, Core.r1), snow: cut(d.snowfall_sum, Core.r2) };
    let through = d.time[last];
    if (from !== DATA_START) {
      // Append the new days to the stored series, replacing the overlap
      const keep = Math.round((Date.parse(from) - Date.parse(old.daily.start)) / DAY);
      const join = (k) => [...old.daily[k].slice(0, keep), ...daily[k]];
      daily = { start: old.daily.start, min: join('min'), max: join('max'), mean: join('mean'), snow: join('snow') };
      if (through < old.through) through = old.through;
    }
    return {
      v: Core.CACHE_VERSION, key: Core.cacheKey(place.lat, place.lon), name: place.name,
      lat: Core.roundCoord(place.lat), lon: Core.roundCoord(place.lon),
      fetched: new Date().toISOString(), through, elevation: j.elevation ?? (old && old.elevation) ?? null,
      daily,
      bins: (old && old.bins) || {},
    };
  }

  // ---------- hourly (snowmaking hours) ----------
  // Winters (Nov y .. Apr y+1) that lie fully inside the daily data
  function winters(p) {
    const out = [];
    for (let y = +DATA_START.slice(0, 4); `${y + 1}-04-30` <= p.through; y++) out.push(y);
    return out;
  }
  const missingWinters = (p, among = winters(p)) => among.filter((y) => !(p.bins && p.bins[y]));

  // One request: hourly temperature and humidity for winters a..b (each Nov 1 – Apr 30),
  // binned by wet bulb into p.bins. Winters with no data are stored empty so they aren't asked for again.
  async function fetchWinters(p, a, b) {
    const j = await archive(p.lat, p.lon, {
      start_date: `${a}-11-01`, end_date: `${b + 1}-04-30` <= p.through ? `${b + 1}-04-30` : p.through,
      hourly: 'temperature_2m,relative_humidity_2m',
    });
    const want = new Set();
    for (let y = a; y <= b; y++) want.add(y);
    const fresh = {};
    Core.addHourly(fresh, j.hourly, want);
    p.bins = p.bins || {};
    for (const y of want) p.bins[y] = fresh[y] || Core.emptyBins();
    return p;
  }
  // The next block of up to five consecutive missing winters, starting at the earliest one
  function nextChunk(missing) {
    if (!missing.length) return null;
    const a = missing[0];
    let b = a;
    while (b - a + 1 < WINTERS_PER_CHUNK && missing.includes(b + 1)) b++;
    return [a, b];
  }
  const chunkWeight = (a, b) => weight({ start_date: `${a}-11-01`, end_date: `${b + 1}-04-30`, hourly: 'temperature_2m,relative_humidity_2m' });
  const dailyWeight = (old) => weight({ start_date: dailyFrom(old), end_date: archiveEnd(), daily: DAILY_VARS });

  window.SnowClimateStore = {
    DATA_START, MAX_AGE_DAYS, get, save, archive, fetchDaily, needsDaily, ageDays,
    winters, missingWinters, fetchWinters, nextChunk, chunkWeight, dailyWeight, weight,
    used, freesAt, cooldownUntil, cooldownWhy, RateLimitError,
  };
})();
