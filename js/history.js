// SnowmakingWX history page: climate stats for any location, from Open-Meteo's ERA5 archive.
(function () {
  const CFG = window.SNOWWX_CONFIG;
  const Core = window.SnowWXCore;
  const ENSO = {}; // winter start year -> { phase, strength, peak } for El Niño / La Niña winters
  for (const y of Object.keys(window.SNOWWX_ENSO.oni)) { const c = window.SNOWWX_ENSO.classify(+y); if (c) ENSO[y] = c; }
  const $ = (s) => document.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  const MON = [11, 12, 1, 2, 3, 4]; // winter months in order
  const MN = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'];
  const MEASURE = { min: 'daily low', mean: 'daily mean', max: 'daily high' };
  const PHASE_COLOR = {
    'El Niño': { weak: '#a5d8ff', moderate: '#74c0fc', strong: '#339af0', 'very strong': '#1c7ed6' },
    'La Niña': { weak: '#ffd8a8', moderate: '#ffa94d', strong: '#fd7e14', 'very strong': '#d9480f' },
  };
  const enColor = (e) => (e ? PHASE_COLOR[e.phase][e.strength] : OTHER_COLOR);
  const OTHER_COLOR = '#4a5d72';
  const DATA_START = '1950-01-01';

  const state = {
    place: null,
    resorts: [],
    daily: null, // { dates, min, max, mean, snow }
    lastDate: null,
    wm: {}, // wm[y][mi] = { min, mean, max, lows[], n }
    winters: [], // complete winter start years, ascending
    seasons: {}, // snowfall total by season start year
    thr: store.get('snowwx.hist.thr', 28),
    measure: store.get('snowwx.hist.measure', 'min'),
    span: store.get('snowwx.hist.span', 50),
    month: 'all',
    base: 'record',
    phase: 'both',
    bins: null, // bins[y][mi] = Int32Array of wet-bulb °F histogram
    loadToken: 0,
  };
  const charts = {};

  // ---------- helpers ----------
  const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const f0 = (v) => (v == null ? '–' : Math.round(v).toString());
  const f1 = (v) => (v == null ? '–' : v.toFixed(1));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const yl = (y) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  function regress(xs, ys) {
    const n = xs.length;
    if (n < 3) return null;
    const mx = avg(xs), my = avg(ys);
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    const slope = sxy / sxx;
    return { slope, at: (x) => my + slope * (x - mx) };
  }
  function setStatus(msg, kind = 'info') {
    const el = $('#status');
    el.hidden = !msg;
    el.className = `status ${kind}`;
    el.textContent = msg || '';
  }
  function chart(id, cfg) {
    if (charts[id]) charts[id].destroy();
    const ctx = document.getElementById(id);
    charts[id] = new Chart(ctx, cfg);
    return charts[id];
  }
  const GRID = 'rgba(141,162,192,0.14)';
  const TXT = '#8da2c0';
  function baseOpts(yTitle, extra = {}) {
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: TXT, boxWidth: 14 } }, ...(extra.plugins || {}) },
      scales: {
        x: { ticks: { color: TXT, maxRotation: 0, autoSkip: true }, grid: { color: GRID }, ...(extra.x || {}) },
        y: { ticks: { color: TXT }, grid: { color: GRID }, title: { display: !!yTitle, text: yTitle, color: TXT }, ...(extra.y || {}) },
      },
    };
  }

  // ---------- location ----------
  function loadResorts() {
    state.resorts = [...CFG.resorts, ...store.get('snowwx.customResorts', [])];
    const sel = $('#resortSelect');
    sel.innerHTML = '';
    sel.add(new Option('Saved locations…', ''));
    for (const r of state.resorts) sel.add(new Option(r.region ? `${r.name} — ${r.region}` : r.name, r.id));
  }

  function setPlace(p, { fetchData = true } = {}) {
    state.place = p;
    $('#placeLabel').textContent = `${p.name}${p.region ? ' · ' + p.region : ''} · ${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`;
    document.title = `${p.name} history · SnowmakingWX`;
    const q = new URLSearchParams({ lat: p.lat.toFixed(4), lon: p.lon.toFixed(4), name: p.name }).toString();
    try { history.replaceState(null, '', `?${q}`); } catch { /* ignore */ }
    $('#fcLink').href = `index.html?${q}`;
    const match = state.resorts.find((r) => Math.abs(r.lat - p.lat) < 1e-4 && Math.abs(r.lon - p.lon) < 1e-4);
    $('#resortSelect').value = match ? match.id : '';
    if (fetchData) loadDaily();
  }

  const COORDS_RE = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/;
  async function geocode(q) {
    const gk = 'snowwx.geo.' + q.toLowerCase();
    const hit = store.get(gk, null);
    if (hit && Date.now() - hit.t < 30 * 864e5) return hit.r;
    const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q, format: 'jsonv2', limit: '6', addressdetails: '1' })}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`search service returned ${res.status}`);
    const out = (await res.json()).map((p) => {
      const a = p.address || {};
      const town = a.city || a.town || a.village || a.hamlet || a.county || '';
      const region = [town, a.state || a.country].filter(Boolean).join(', ');
      return { name: p.name || p.display_name.split(',')[0], region, label: p.display_name, lat: +p.lat, lon: +p.lon };
    });
    if (out.length) store.set(gk, { t: Date.now(), r: out });
    return out;
  }
  function closeResults() { $('#searchResults').hidden = true; $('#searchResults').innerHTML = ''; }
  function choose(p) {
    closeResults();
    $('#searchInput').value = '';
    $('#searchInput').blur();
    setPlace({ name: p.name || `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`, region: p.region || '', lat: p.lat, lon: p.lon });
  }
  $('#searchForm').onsubmit = async (e) => {
    e.preventDefault();
    const q = $('#searchInput').value.trim();
    if (!q) return;
    const m = COORDS_RE.exec(q);
    if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) return choose({ name: '', region: '', lat: +m[1], lon: +m[2] });
    const box = $('#searchResults');
    box.hidden = false;
    box.innerHTML = '<div class="search-msg">Searching…</div>';
    try {
      const results = await geocode(q);
      if (!results.length) { box.innerHTML = `<div class="search-msg">No places found for “${esc(q)}”. Try adding a town or state.</div>`; return; }
      box.innerHTML = '';
      for (const p of results) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'search-hit';
        b.innerHTML = '<b></b><small></small>';
        b.querySelector('b').textContent = p.name;
        b.querySelector('small').textContent = p.label;
        b.onclick = () => choose(p);
        box.appendChild(b);
      }
      box.querySelector('button').focus();
    } catch (err) {
      box.innerHTML = `<div class="search-msg">Search failed (${esc(err.message)}). Check your connection and try again.</div>`;
    }
  };
  document.addEventListener('click', (e) => { if (!e.target.closest('#searchForm')) closeResults(); });
  $('#searchForm').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeResults();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const hits = [...document.querySelectorAll('.search-hit')];
      if (!hits.length) return;
      e.preventDefault();
      const i = hits.indexOf(document.activeElement);
      hits[(i + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length].focus();
    }
  });
  $('#resortSelect').onchange = (e) => {
    const r = state.resorts.find((x) => x.id === e.target.value);
    if (r) setPlace({ name: r.name, region: r.region || '', lat: r.lat, lon: r.lon });
  };

// ---------- cache (browser IndexedDB + repo data/cache files) ----------
  const CACHE_MAX_AGE_DAYS = 60; // older than this (by the newest day of data), try live and keep the cache as a fallback
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
    async set(key, val) {
      const db = await this.open();
      if (!db) return;
      return new Promise((resolve) => {
        try { const tx = db.transaction('climate', 'readwrite'); tx.objectStore('climate').put(val, key); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); } catch { resolve(); }
      });
    },
  };
  let repoIndex = null;
  async function repoCacheFor(key) {
    try {
      if (!repoIndex) repoIndex = fetch('data/index.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { locations: [] })).catch(() => ({ locations: [] }));
      const idx = await repoIndex;
      if (!idx.locations.some((l) => l.key === key)) return null;
      const r = await fetch(`data/cache/${key}.json`);
      if (!r.ok) return null;
      const p = await r.json();
      return p && p.v === Core.CACHE_VERSION ? p : null;
    } catch { return null; }
  }
  const ageDays = (p) => (Date.now() - Date.parse(p.through)) / 864e5;
  function saveBrowserCache() { if (state.payload) idb.set(state.payload.key, state.payload); }

  function payloadToDaily(p) {
    const n = p.daily.min.length;
    return { dates: Core.datesFrom(p.daily.start, n), min: p.daily.min, max: p.daily.max, mean: p.daily.mean, snow: p.daily.snow };
  }
  function setSource(label) {
    state.source = label;
    updateNote();
  }

  // ---------- data ----------
  function isoDay(d) { return d.toISOString().slice(0, 10); }
  function archiveEnd() { return isoDay(new Date(Date.now() - 7 * 864e5)); } // ERA5 lags a few days

  async function archive(params) {
    const url = `https://archive-api.open-meteo.com/v1/archive?${new URLSearchParams({ latitude: Core.roundCoord(state.place.lat).toFixed(2), longitude: Core.roundCoord(state.place.lon).toFixed(2), timezone: 'auto', ...params })}`;
    const res = await fetch(url);
    if (!res.ok) {
      let why = '';
      try { why = (await res.json()).reason || ''; } catch { /* ignore */ }
      throw new Error(why || `data service returned ${res.status}`);
    }
    return res.json();
  }

  async function loadDaily() {
    const token = ++state.loadToken;
    state.bins = null;
    state.payload = null;
    $('#hoursBody').hidden = true;
    $('#hoursProgress').textContent = '';
    $('#hoursBtn').disabled = false;
    const key = Core.cacheKey(state.place.lat, state.place.lon);
    setStatus(`Loading ${state.place.name} climate history…`);

    const [local, repo] = await Promise.all([idb.get(key), repoCacheFor(key)]);
    if (token !== state.loadToken) return;
    const cached = [local && local.v === Core.CACHE_VERSION ? { p: local, src: 'browser cache' } : null, repo ? { p: repo, src: 'repository cache' } : null]
      .filter(Boolean).sort((x, y) => (y.p.through > x.p.through ? 1 : -1));
    const best = cached[0];

    if (best && ageDays(best.p) <= CACHE_MAX_AGE_DAYS) return useCache(best.p, best.src);
    try {
      const j = await archive({
        start_date: DATA_START, end_date: archiveEnd(),
        daily: 'temperature_2m_max,temperature_2m_min,temperature_2m_mean,snowfall_sum',
        temperature_unit: 'fahrenheit', precipitation_unit: 'inch',
      });
      if (token !== state.loadToken) return;
      const d = j.daily;
      let last = d.time.length - 1;
      while (last > 0 && d.temperature_2m_min[last] == null) last--;
      const n = last + 1;
      const cut = (a, f) => a.slice(0, n).map(f);
      const payload = {
        v: Core.CACHE_VERSION, key, name: state.place.name, lat: Core.roundCoord(state.place.lat), lon: Core.roundCoord(state.place.lon),
        fetched: new Date().toISOString(), through: d.time[last], elevation: j.elevation ?? null,
        daily: { start: d.time[0], min: cut(d.temperature_2m_min, Core.r1), max: cut(d.temperature_2m_max, Core.r1), mean: cut(d.temperature_2m_mean, Core.r1), snow: cut(d.snowfall_sum, Core.r2) },
        // keep any hourly results we already had for this place
        bins: (best && best.p.bins) || {},
      };
      useCache(payload, 'live data');
      idb.set(key, payload);
    } catch (err) {
      if (token !== state.loadToken) return;
      if (best) { useCache(best.p, `${best.src}, older (live refresh failed)`); return; }
      setStatus(`Could not load history for this location (${err.message}). Check your connection and try again.`, 'error');
    }
  }

  function useCache(p, src) {
    state.payload = p;
    state.daily = payloadToDaily(p);
    state.lastDate = p.through;
    state.elevM = p.elevation;
    aggregate();
    setStatus('');
    setSource(src);
    renderAll();
  }

  function aggregate() {
    const D = state.daily;
    const acc = {}; // acc[y][mi] = {min:[],mean:[],max:[]}
    const snow = {}; // snow[y] = {sum, n}
    for (let i = 0; i < D.dates.length; i++) {
      const s = D.dates[i];
      const yr = +s.slice(0, 4), m = +s.slice(5, 7);
      if (D.snow[i] != null) {
        const sy = m >= 7 ? yr : yr - 1;
        const o = snow[sy] || (snow[sy] = { sum: 0, n: 0 });
        o.sum += D.snow[i]; o.n++;
      }
      let wy, mi;
      if (m >= 11) { wy = yr; mi = m - 11; } else if (m <= 4) { wy = yr - 1; mi = m + 1; } else continue;
      if (D.min[i] == null || D.max[i] == null || D.mean[i] == null) continue;
      const a = acc[wy] || (acc[wy] = Array.from({ length: 6 }, () => ({ min: [], mean: [], max: [] })));
      a[mi].min.push(D.min[i]); a[mi].mean.push(D.mean[i]); a[mi].max.push(D.max[i]);
    }
    state.wm = {};
    state.winters = [];
    for (const y of Object.keys(acc).map(Number).sort((a, b) => a - b)) {
      let ok = true;
      const row = acc[y].map((o, mi) => {
        const yr = mi < 2 ? y : y + 1;
        const dim = new Date(yr, MON[mi], 0).getDate();
        if (o.min.length < dim - 3) { ok = false; return null; }
        return { min: avg(o.min), mean: avg(o.mean), max: avg(o.max), lows: o.min, n: o.min.length };
      });
      if (ok) { state.wm[y] = row; state.winters.push(y); }
    }
    state.seasons = {};
    for (const [y, o] of Object.entries(snow)) {
      if (o.n >= 355 && `${+y + 1}-06-30` <= state.lastDate) state.seasons[y] = o.sum;
    }
  }

  const shown = () => state.winters.slice(-Math.min(state.span, state.winters.length));
  const val = (y, mi) => state.wm[y][mi][state.measure];

  // ---------- render ----------
  function updateNote() { $('#dataNote').textContent = `${state.noteBase || ''}${state.source ? ` · from ${state.source}` : ''}`; }

  function renderAll() {
    const W = shown();
    if (!W.length) { setStatus('Not enough complete winters of data for this location.', 'warn'); return; }
    state.noteBase = `${W.length} winters, ${yl(W[0])} to ${yl(W[W.length - 1])} · data through ${state.lastDate}${state.elevM != null ? ` · model elevation ${Math.round(state.elevM * 3.281)} ft` : ''}`;
    updateNote();
    renderStats(W); renderProfile(W); renderNights(W); renderHeat(W); renderMonthSeg(); renderTrend(W);
    renderSnow(); renderTable(W);
    if (!state.bins && state.payload && state.payload.bins && W.every((y) => state.payload.bins[y])) {
      state.bins = state.payload.bins; state.binsWinters = W; $('#hoursBtn').disabled = true; // already cached: no download needed
    }
    if (state.bins) renderHours();
  }

  function renderStats(W) {
    const t = state.thr, m = state.measure;
    const pct = MN.map((_, mi) => (100 * W.filter((y) => val(y, mi) <= t).length) / W.length);
    const top = Math.max(...pct);
    const best = MN.filter((_, i) => pct[i] === top);
    const half = MN.filter((_, i) => pct[i] >= 50);
    const xs = W, ys = W.map((y) => avg(MON.map((_, mi) => val(y, mi))));
    const rg = regress(xs, ys);
    const nightsPer = avg(W.map((y) => state.wm[y].reduce((s, o) => s + o.lows.filter((v) => v <= t).length, 0)));
    $('#stats').innerHTML = [
      stat(`Months where the average ${MEASURE[m]} is ≤ ${t} °F`, half.length ? half.join(', ') : 'None', 'in at least half of the winters shown'),
      stat(best.length > 1 ? 'Most reliable months (tied)' : 'Most reliable month', best.join(', '), `${Math.round(top)}% of winters at or below ${t} °F`),
      stat('Nights with a low ≤ ' + t + ' °F', f0(nightsPer), 'per winter, Nov–Apr (average)'),
      rg ? stat('Nov–Apr trend', `${rg.slope * 10 >= 0 ? '+' : ''}${(rg.slope * 10).toFixed(1)} °F`, `per decade in the ${MEASURE[m]}; winters vary a lot, so treat it as rough`) : '',
    ].join('');
  }
  function stat(k, v, n) { return `<div class="stat"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span><span class="n">${esc(n)}</span></div>`; }

  function renderProfile(W) {
    const mean = MN.map((_, mi) => avg(W.map((y) => val(y, mi))));
    const lo = MN.map((_, mi) => Math.min(...W.map((y) => val(y, mi))));
    const hi = MN.map((_, mi) => Math.max(...W.map((y) => val(y, mi))));
    chart('profChart', {
      type: 'line',
      data: {
        labels: MN,
        datasets: [
          { label: 'Warmest winter', data: hi, borderColor: '#ff922b', borderDash: [5, 4], pointRadius: 2, fill: false, borderWidth: 1.5 },
          { label: `Average ${MEASURE[state.measure]}`, data: mean, borderColor: '#e6edf7', backgroundColor: 'rgba(116,192,252,0.12)', borderWidth: 3, pointRadius: 4, fill: '+1', tension: 0.2 },
          { label: 'Coldest winter', data: lo, borderColor: '#74c0fc', borderDash: [5, 4], pointRadius: 2, fill: false, borderWidth: 1.5 },
          { label: `Threshold ${state.thr} °F`, data: MN.map(() => state.thr), borderColor: '#69db7c', borderWidth: 2, pointRadius: 0 },
        ],
      },
      options: baseOpts('°F'),
    });
  }

  function renderNights(W) {
    const t = state.thr;
    const nights = MN.map((_, mi) => avg(W.map((y) => state.wm[y][mi].lows.filter((v) => v <= t).length)));
    chart('nightsChart', {
      type: 'bar',
      data: { labels: MN, datasets: [{ label: `Days with a low ≤ ${t} °F`, data: nights, backgroundColor: '#4dabf7' }] },
      options: { ...baseOpts('days per month'), plugins: { legend: { display: false } } },
    });
  }

  function renderHeat(W) {
    const t = state.thr;
    let h = '<thead><tr><th>Winter</th>' + MN.map((m) => `<th>${m}</th>`).join('') + '</tr></thead><tbody>';
    for (const y of [...W].reverse()) {
      h += `<tr><td>${yl(y)}</td>`;
      for (let mi = 0; mi < 6; mi++) {
        const v = val(y, mi), d = v - t, a = Math.min(Math.abs(d) / 15, 1);
        const bg = d <= 0 ? `rgba(59,130,246,${0.15 + 0.7 * a})` : `rgba(245,120,60,${0.15 + 0.7 * a})`;
        h += `<td style="background:${bg}" title="${yl(y)} ${MN[mi]}: ${f1(v)} °F (${d <= 0 ? '' : '+'}${f1(d)} vs ${t})">${f0(v)}</td>`;
      }
      h += '</tr>';
    }
    $('#heat').innerHTML = h + '</tbody>';
  }

  function renderMonthSeg() {
    const seg = $('#monSeg');
    seg.innerHTML = ['all', ...MN].map((m) => `<button data-m="${m}" class="${state.month === m ? 'on' : ''}">${m === 'all' ? 'Nov–Apr' : m}</button>`).join('');
    seg.querySelectorAll('button').forEach((b) => { b.onclick = () => { state.month = b.dataset.m; renderMonthSeg(); renderTrend(shown()); }; });
  }

  function renderTrend(W) {
    const mi = state.month === 'all' ? -1 : MN.indexOf(state.month);
    const ys = W.map((y) => (mi < 0 ? avg(MON.map((_, k) => val(y, k))) : val(y, mi)));
    const rg = regress(W, ys);
    const label = mi < 0 ? 'Nov–Apr' : state.month;
    $('#trendTxt').textContent = rg
      ? `${label} average ${MEASURE[state.measure]}: ${rg.slope * 10 >= 0 ? '+' : ''}${(rg.slope * 10).toFixed(1)} °F per decade across ${W.length} winters (${yl(W[0])} to ${yl(W[W.length - 1])}). Year-to-year swings are large, so the trend line is a rough guide.`
      : '';
    chart('trendChart', {
      type: 'line',
      data: {
        labels: W.map(yl),
        datasets: [
          { label: `${label} ${MEASURE[state.measure]}`, data: ys, borderColor: '#74c0fc', backgroundColor: '#74c0fc', pointRadius: 3, borderWidth: 1.5 },
          rg ? { label: 'Trend', data: W.map((y) => rg.at(y)), borderColor: '#ff922b', borderWidth: 2.5, pointRadius: 0 } : null,
          { label: `Threshold ${state.thr} °F`, data: W.map(() => state.thr), borderColor: '#69db7c', borderWidth: 2, pointRadius: 0 },
        ].filter(Boolean),
      },
      options: baseOpts('°F'),
    });
  }

  // ---- snowmaking hours (wet bulb) ----
  $('#hoursBtn').onclick = loadHours;
  async function loadHours() {
    const token = state.loadToken;
    const W = shown();
    const payload = state.payload;
    payload.bins = payload.bins || {};
    const missing = W.filter((y) => !payload.bins[y]);
    $('#hoursBtn').disabled = true;
    try {
      if (missing.length) {
        const want = new Set(missing);
        const lastYear = +state.lastDate.slice(0, 4);
        const from = Math.min(...missing), to = Math.min(Math.max(...missing) + 1, lastYear);
        const chunks = [];
        for (let a = from; a <= to; a += 5) chunks.push([a, Math.min(a + 4, to)]);
        let done = 0;
        const fresh = {};
        for (const [a, b] of chunks) {
          $('#hoursProgress').textContent = `Loading hourly data… ${done}/${chunks.length} (only winters not already cached)`;
          const j = await archive({
            start_date: `${a}-01-01`, end_date: b === lastYear ? state.lastDate : `${b}-12-31`,
            hourly: 'temperature_2m,relative_humidity_2m',
          });
          if (token !== state.loadToken) return;
          Core.addHourly(fresh, j.hourly, want);
          done++;
        }
        for (const y of missing) payload.bins[y] = fresh[y] || Core.emptyBins();
        saveBrowserCache();
      }
      state.bins = payload.bins;
      state.binsWinters = W;
      $('#hoursProgress').textContent = '';
      renderHours();
    } catch (err) {
      $('#hoursProgress').textContent = `Could not load hourly data (${err.message}).`;
      $('#hoursBtn').disabled = false;
    }
  }
  function hoursAt(y, mi, t) {
    const arr = state.bins[y][mi];
    const lim = Math.min(Core.NBINS - 1, Math.round(t) - Core.BIN_MIN);
    let s = 0;
    for (let i = 0; i <= lim; i++) s += arr[i];
    return s;
  }
  function renderHours() {
    const W = state.binsWinters.filter((y) => state.bins[y]);
    const t = state.thr;
    $('#hoursBody').hidden = false;
    const perWinter = W.map((y) => MON.reduce((s, _, mi) => s + hoursAt(y, mi, t), 0));
    const perMonth = MN.map((_, mi) => avg(W.map((y) => hoursAt(y, mi, t))));
    const bi = perWinter.indexOf(Math.max(...perWinter)), wi = perWinter.indexOf(Math.min(...perWinter));
    $('#hoursStats').innerHTML = [
      stat(`Hours with wet bulb ≤ ${t} °F`, Math.round(avg(perWinter)).toLocaleString(), 'per winter, Nov–Apr (average)'),
      stat('Best winter', `${Math.round(perWinter[bi]).toLocaleString()} h`, yl(W[bi])),
      stat('Worst winter', `${Math.round(perWinter[wi]).toLocaleString()} h`, yl(W[wi])),
      stat('Best month', MN[perMonth.indexOf(Math.max(...perMonth))], `${Math.round(Math.max(...perMonth))} h on average`),
    ].join('');
    chart('hoursMonthChart', {
      type: 'bar',
      data: { labels: MN, datasets: [{ label: `Average hours per month with wet bulb ≤ ${t} °F`, data: perMonth, backgroundColor: '#4dabf7' }] },
      options: baseOpts('hours'),
    });
    const rg = regress(W, perWinter);
    chart('hoursWinterChart', {
      type: 'bar',
      data: {
        labels: W.map(yl),
        datasets: [
          { label: `Snowmaking hours per winter (wet bulb ≤ ${t} °F)`, data: perWinter, backgroundColor: '#4dabf7' },
          rg ? { type: 'line', label: 'Trend', data: W.map((y) => rg.at(y)), borderColor: '#ff922b', borderWidth: 2.5, pointRadius: 0 } : null,
        ].filter(Boolean),
      },
      options: baseOpts('hours'),
    });
  }

  // ---- snowfall & El Niño / La Niña ----
  function renderSnow() {
    const ys = Object.keys(state.seasons).map(Number).sort((a, b) => a - b);
    const el = $('#ensoStats');
    if (ys.length < 10) { el.innerHTML = '<div class="stat"><span class="k">Not enough seasons of snowfall data for this location.</span></div>'; if (charts.snowChart) charts.snowChart.destroy(); $('#ensoTable').innerHTML = ''; return; }
    const pool = state.base === 'norm' ? ys.filter((y) => y >= 1991 && y <= 2019) : ys;
    const base = avg(pool.map((y) => state.seasons[y]));
    const sets = {
      'El Niño': ys.filter((y) => ENSO[y] && ENSO[y].phase === 'El Niño'),
      'La Niña': ys.filter((y) => ENSO[y] && ENSO[y].phase === 'La Niña'),
      Neutral: ys.filter((y) => !ENSO[y]),
    };
    const baseName = state.base === 'norm' ? '1991–2020 mean' : 'full-record mean';
    const tile = (name, label) => {
      const a = sets[name], m = avg(a.map((y) => state.seasons[y]));
      const diff = m != null && base ? ((m - base) / base) * 100 : null;
      const below = a.filter((y) => state.seasons[y] < base).length;
      return stat(label, m == null ? '–' : `${f1(m)} in`, a.length ? `${diff >= 0 ? '+' : ''}${Math.round(diff)}% vs ${baseName} · ${below} of ${a.length} seasons below it` : 'no seasons');
    };
    el.innerHTML = tile('El Niño', 'El Niño winter average') + tile('La Niña', 'La Niña winter average') + tile('Neutral', 'Neutral winter average')
      + stat(`Comparison: ${baseName}`, `${f1(base)} in`, `${pool.length} seasons`);

    chart('snowChart', {
      type: 'bar',
      data: {
        labels: ys.map(yl),
        datasets: [
          { label: 'Season snowfall (in)', data: ys.map((y) => state.seasons[y]), backgroundColor: ys.map((y) => enColor(ENSO[y])) },
          { type: 'line', label: baseName, data: ys.map(() => base), borderColor: '#e6edf7', borderDash: [6, 4], borderWidth: 2, pointRadius: 0 },
        ],
      },
      options: { ...baseOpts('inches'), plugins: { legend: { display: false } } },
    });
    let leg = document.getElementById('snowLegend');
    if (!leg) { leg = document.createElement('div'); leg.id = 'snowLegend'; leg.className = 'legend'; $('#snowChart').parentElement.after(leg); }
    leg.innerHTML = `<span><i style="--c:${OTHER_COLOR}"></i>Neutral</span>`
      + ['El Niño', 'La Niña'].map((p) => `<span>${p}:</span>` + Object.entries(PHASE_COLOR[p]).map(([k, c]) => `<span><i style="--c:${c}"></i>${k}</span>`).join('')).join('')
      + `<span><i style="--c:#e6edf7"></i>${baseName}</span>`;

    document.querySelectorAll('#phaseSeg button').forEach((b) => b.classList.toggle('on', b.dataset.p === state.phase));
    const rows = ys.filter((y) => ENSO[y] && (state.phase === 'both' || ENSO[y].phase === state.phase)).reverse();
    let h = '<thead><tr><th>Winter</th><th>Phase</th><th>Strength</th><th>Peak ONI</th><th>Snowfall (in)</th><th>vs mean</th></tr></thead><tbody>';
    for (const y of rows) {
      const v = state.seasons[y], d = v - base, e = ENSO[y];
      h += `<tr><td>${yl(y)}</td><td>${e.phase}</td><td>${e.strength}</td><td>${e.peak >= 0 ? '+' : ''}${e.peak.toFixed(1)}</td><td>${f1(v)}</td><td>${d >= 0 ? '+' : ''}${f1(d)}</td></tr>`;
    }
    $('#ensoTable').innerHTML = h + '</tbody>';
  }

  function renderTable(W) {
    const t = state.thr;
    let h = '<thead><tr><th>Month</th><th>Avg low</th><th>Avg mean</th><th>Avg high</th><th>Coldest winter</th><th>Warmest winter</th><th>Winters ≤ threshold</th></tr></thead><tbody>';
    MN.forEach((m, mi) => {
      const v = (k) => W.map((y) => state.wm[y][mi][k]);
      const series = W.map((y) => val(y, mi));
      const ci = series.indexOf(Math.min(...series)), wi = series.indexOf(Math.max(...series));
      const pct = (100 * series.filter((x) => x <= t).length) / W.length;
      h += `<tr><td>${m}</td><td>${f1(avg(v('min')))}</td><td>${f1(avg(v('mean')))}</td><td>${f1(avg(v('max')))}</td>` +
        `<td>${f1(series[ci])} (${yl(W[ci])})</td><td>${f1(series[wi])} (${yl(W[wi])})</td><td>${Math.round(pct)}%</td></tr>`;
    });
    $('#tbl').innerHTML = h + `</tbody><caption class="hint" style="caption-side:bottom;text-align:left;padding-top:6px">Coldest/warmest and the threshold column use the selected measure (${MEASURE[state.measure]}). All values °F.</caption>`;
  }


  // ---------- sharing the cache with the repository ----------
  // A static page can't commit to GitHub, so: (1) download the cache file, or (2) ask the repo's workflow to build it.
  function currentKey() { return Core.cacheKey(state.place.lat, state.place.lon); }
  $('#cacheDownloadBtn').onclick = () => {
    if (!state.payload) return;
    const blob = new Blob([JSON.stringify(state.payload)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.payload.key}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('#cacheRequestBtn').onclick = async () => {
    const p = state.place;
    const text = `${Core.roundCoord(p.lat)}, ${Core.roundCoord(p.lon)}, ${p.name}`;
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard may be blocked */ }
    $('#cacheHelp').hidden = false;
    $('#cacheHelp').innerHTML = `Opening the repository's <b>Refresh climate cache</b> workflow. Choose <b>Run workflow</b> and enter latitude <b>${esc(Core.roundCoord(p.lat))}</b>, longitude <b>${esc(Core.roundCoord(p.lon))}</b>, name <b>${esc(p.name)}</b> (copied to your clipboard as “${esc(text)}”). When it finishes, this place loads from the repository for everyone. `
      + `Or run <code>node scripts/build-cache.mjs ${esc(Core.roundCoord(p.lat))} ${esc(Core.roundCoord(p.lon))} "${esc(p.name)}"</code> locally and commit <code>data/</code>.`;
    window.open(`https://github.com/${CFG.repo}/actions/workflows/refresh-cache.yml`, '_blank', 'noopener');
  };

  // ---------- controls ----------
  function syncControls() {
    $('#thr').value = state.thr;
    $('#thrOut').textContent = state.thr;
    document.querySelectorAll('#measureSeg button').forEach((b) => b.classList.toggle('on', b.dataset.m === state.measure));
    document.querySelectorAll('#spanSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.n === state.span));
  }
  $('#thr').oninput = (e) => {
    state.thr = +e.target.value; store.set('snowwx.hist.thr', state.thr);
    $('#thrOut').textContent = state.thr;
    if (state.daily) renderAll();
  };
  document.querySelectorAll('#measureSeg button').forEach((b) => { b.onclick = () => { state.measure = b.dataset.m; store.set('snowwx.hist.measure', state.measure); syncControls(); if (state.daily) renderAll(); }; });
  document.querySelectorAll('#spanSeg button').forEach((b) => {
    b.onclick = () => {
      state.span = +b.dataset.n; store.set('snowwx.hist.span', state.span); syncControls();
      if (state.bins) { state.bins = null; $('#hoursBody').hidden = true; $('#hoursBtn').disabled = false; }
      if (state.daily) renderAll();
    };
  });
  document.querySelectorAll('#phaseSeg button').forEach((b) => { b.onclick = () => { state.phase = b.dataset.p; if (state.daily) renderSnow(); }; });
  document.querySelectorAll('#baseSeg button').forEach((b) => {
    b.onclick = () => {
      state.base = b.dataset.b;
      document.querySelectorAll('#phaseSeg button').forEach((b) => { b.onclick = () => { state.phase = b.dataset.p; if (state.daily) renderSnow(); }; });
  document.querySelectorAll('#baseSeg button').forEach((x) => x.classList.toggle('on', x === b));
      if (state.daily) renderSnow();
    };
  });

  // ---------- start ----------
  loadResorts();
  syncControls();
  const qs = new URLSearchParams(location.search);
  const qLat = parseFloat(qs.get('lat')), qLon = parseFloat(qs.get('lon'));
  if (Number.isFinite(qLat) && Number.isFinite(qLon)) {
    setPlace({ name: qs.get('name') || `${qLat.toFixed(3)}, ${qLon.toFixed(3)}`, region: '', lat: qLat, lon: qLon });
  } else {
    const r = state.resorts.find((x) => x.id === store.get('snowwx.resort', CFG.defaultResortId)) || state.resorts[0];
    setPlace({ name: r.name, region: r.region || '', lat: r.lat, lon: r.lon });
  }
})();
