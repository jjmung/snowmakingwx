// Background downloads for every saved location, so pages open from the browser's cache:
// - climate history: daily data since 1950, then the hourly winter data behind "Snowmaking hours"
// - the 16-day forecast (Forecast page only; the History page has no forecast code loaded)
//
// Gentle on the free data services: one request at a time, a pause after each one sized to the
// request, its own hourly and daily allowance (shared with what you load yourself, through the
// request ledger in js/climate-store.js), a pause after any rate-limit answer, and only one open
// tab doing the work. Nothing is downloaded twice: each step checks the cache first.
(function () {
  const CFG = window.SNOWWX_CONFIG;
  const Core = window.SnowWXCore;
  const Store = window.SnowClimateStore;
  const Weather = window.SnowWeather; // present on the Forecast page only

  const START_DELAY = 15e3; // let the page load its own data first
  const MIN_GAP = 20e3; // at least this long between background requests
  const PER_MINUTE = 300; // pace big requests to about half of Open-Meteo's 600 calls / minute
  const BUDGET_HOUR = 2500; // of 5,000 calls / hour
  const BUDGET_DAY = 6000; // of 10,000 calls / day
  const IDLE_RECHECK = 30 * 60e3; // when everything is cached, look again after this long
  const FORECAST_MAX_AGE = 30 * 60e3; // refresh a cached forecast older than this
  const FAIL_BACKOFF = 30 * 60e3; // skip a location this long after an error that isn't a rate limit
  const HOUR = 36e5;
  const DAY = 864e5;

  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failedUntil = new Map(); // `${location id}:${step}` -> time
  const failed = (r, kind) => (failedUntil.get(`${r.id}:${kind}`) || 0) > Date.now();

  // Saved locations, the one open on the page (or last opened) first
  function locations() {
    const hidden = ls.get('snowwx.hiddenResorts', []);
    const list = [...CFG.resorts.filter((r) => !hidden.includes(r.id)), ...ls.get('snowwx.customResorts', [])];
    const cur = ls.get('snowwx.resort', CFG.defaultResortId);
    return list.sort((a, b) => (b.id === cur) - (a.id === cur));
  }
  const forecastKey = (r) => `snowwx.cache.${r.lat.toFixed(4)},${r.lon.toFixed(4)}`;

  // ---------- status shown in the page footer ----------
  const status = { rows: {}, note: '' };
  function render() {
    const el = document.getElementById('bgStatus');
    if (!el) return;
    const rows = locations().map((r) => status.rows[r.id] && `${r.name} ${status.rows[r.id]}`).filter(Boolean);
    el.textContent = rows.length ? `Saved in this browser: ${rows.join(' · ')}${status.note ? ` — ${status.note}` : ''}` : '';
  }
  async function progress(r) {
    const p = await Store.get(Core.cacheKey(r.lat, r.lon));
    if (!p) { status.rows[r.id] = 'history 0%'; return p; }
    const all = Store.winters(p).length;
    const have = all - Store.missingWinters(p).length;
    const pct = Math.floor(((1 + have) / (1 + all)) * 100);
    status.rows[r.id] = pct >= 100 ? 'history ✓' : `history ${pct}%`;
    return p;
  }

  // ---------- picking the next step ----------
  async function nextJob() {
    for (const r of locations()) {
      if (Weather && !failed(r, 'forecast')) {
        const f = ls.get(forecastKey(r), null);
        if (!f || Date.now() - f.meta.fetched > FORECAST_MAX_AGE) return { r, kind: 'forecast', w: 1 };
      }
      if (failed(r, 'history')) continue;
      const p = await progress(r);
      if (Store.needsDaily(p)) return { r, kind: 'daily', p, w: Store.dailyWeight(p) };
      const chunk = Store.nextChunk(Store.missingWinters(p));
      if (chunk) return { r, kind: 'hourly', p, chunk, w: Store.chunkWeight(chunk[0], chunk[1]) };
    }
    return null;
  }

  // How long to wait before spending `w` calls, keeping inside the background allowance
  function waitFor(w) {
    const cool = Store.cooldownUntil() - Date.now();
    if (cool > 0) return { ms: cool, why: `paused: ${Store.cooldownWhy() || 'data service limit reached'}` };
    const hourUsed = Store.used(HOUR);
    const dayUsed = Store.used(DAY);
    // A request bigger than the allowance still goes when nothing else has been used
    if (dayUsed && dayUsed + w > BUDGET_DAY) return { ms: Store.freesAt(DAY) - Date.now(), why: 'daily download allowance used; continuing later' };
    if (hourUsed && hourUsed + w > BUDGET_HOUR) return { ms: Store.freesAt(HOUR) - Date.now(), why: 'hourly download allowance used; continuing later' };
    return { ms: 0 };
  }

  async function run(job) {
    const { r } = job;
    if (job.kind === 'forecast') {
      const data = await Weather.fetchForecast(r.lat, r.lon);
      ls.set(forecastKey(r), data);
    } else if (job.kind === 'daily') {
      await Store.save(await Store.fetchDaily(r, job.p));
    } else {
      // Re-read first: the page may have stored winters since this step was picked
      const p = (await Store.get(job.p.key)) || job.p;
      if (Store.missingWinters(p).includes(job.chunk[0])) await Store.save(await Store.fetchWinters(p, job.chunk[0], job.chunk[1]));
    }
    await progress(r);
    render();
  }

  async function loop() {
    for (;;) {
      let job;
      try { job = await nextJob(); } catch { job = null; }
      if (!job) { status.note = ''; render(); await sleep(IDLE_RECHECK); continue; }
      const wait = waitFor(job.w);
      if (wait.ms > 0) {
        status.note = wait.why;
        render();
        await sleep(Math.min(Math.max(wait.ms, 60e3), IDLE_RECHECK));
        continue;
      }
      status.note = `downloading ${job.r.name} ${job.kind === 'hourly' ? `winters ${job.chunk[0]}–${job.chunk[1] + 1}` : job.kind}`;
      render();
      try {
        await run(job);
        status.note = '';
      } catch (e) {
        if (e instanceof Store.RateLimitError) status.note = `paused: ${e.message}`;
        else { failedUntil.set(`${job.r.id}:${job.kind === 'forecast' ? 'forecast' : 'history'}`, Date.now() + FAIL_BACKOFF); status.note = `${job.r.name}: ${e.message}; retrying later`; }
      }
      render();
      // Pace by size: a 2,000-call request waits several minutes, a small one MIN_GAP
      await sleep(Math.max(MIN_GAP, (job.w / PER_MINUTE) * 60e3));
    }
  }

  // Only one tab downloads; others take over if it closes
  function start() {
    if (!Store || !window.indexedDB) return;
    setTimeout(() => {
      if (ls.get('snowwx.bgOff', false)) return; // off switch: localStorage snowwx.bgOff = true
      if (navigator.locks) navigator.locks.request('snowwx-bg-cache', () => loop());
      else loop();
    }, START_DELAY);
    // Show what is already cached right away, and keep it current in tabs that aren't downloading
    const refresh = () => Promise.all(locations().map(progress)).then(render, () => {});
    refresh();
    setInterval(refresh, 60e3);
  }

  window.SnowBgCache = { start, nextJob, run, waitFor };
  start();
})();
