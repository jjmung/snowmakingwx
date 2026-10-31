// SnowmakingWX app wiring.
(function () {
  const CFG = window.SNOWWX_CONFIG;
  const $ = (s) => document.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const { dirText, plumeGeometry } = window.SnowMap;

  const state = {
    resorts: [],
    resort: null,
    data: null,
    view: [],
    rangeH: store.get('snowwx.range', 72),
    sel: 0,
    playTimer: null,
  };

  const zoneFor = (wbF) => CFG.wetBulbZones.find((z) => wbF <= z.max);
  function windFlag(h) {
    const w = CFG.wind;
    if ((h.windMph ?? 0) > w.limitMph || (h.gustMph ?? 0) > w.gustLimitMph) return 'limit';
    if ((h.windMph ?? 0) > w.cautionMph) return 'caution';
    return 'ok';
  }
  const usable = (h) => h.zone.key !== 'none' && h.windFlag !== 'limit';
  const deg = (v) => (v == null ? '—' : `${Math.round(v)}°`);
  const num = (v) => (v == null ? '—' : Math.round(v));

  // ---------- data ----------

  function decorate(hours, tz) {
    const f = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts });
    const fHour = f({ hour: 'numeric', hourCycle: 'h23' });
    const fShortHour = f({ hour: 'numeric' });
    const fDay = f({ weekday: 'short' });
    const fFull = f({ weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric' });
    for (const h of hours) {
      h.hour24 = parseInt(fHour.format(h.t), 10) % 24;
      h.hourShort = fShortHour.format(h.t).replace(' AM', 'a').replace(' PM', 'p');
      h.dayShort = fDay.format(h.t);
      h.fullLabel = fFull.format(h.t);
      h.zone = zoneFor(h.wbF);
      h.windFlag = windFlag(h);
      h.dirText = dirText(h.windDir);
    }
    return hours;
  }

  async function load(force = false) {
    const r = state.resort;
    const key = `snowwx.cache.${r.lat.toFixed(4)},${r.lon.toFixed(4)}`;
    const cached = store.get(key, null);
    setStatus('');
    if (!force && cached && Date.now() - cached.meta.fetched < CFG.cacheMinutes * 60e3) {
      return show(cached);
    }
    setStatus('Loading National Weather Service forecast…', 'info');
    $('#refreshBtn').disabled = true;
    try {
      const data = await window.SnowWeather.fetchForecast(r.lat, r.lon);
      store.set(key, data);
      setStatus('');
      show(data);
    } catch (e) {
      console.error(e);
      if (cached) {
        setStatus(`Couldn't refresh forecast (${e.message}). Showing data from ${new Date(cached.meta.fetched).toLocaleString()}.`, 'warn');
        show(cached);
      } else {
        setStatus(`Couldn't load forecast: ${e.message}. The NWS API only covers U.S. locations and occasionally has outages — try Refresh.`, 'error');
      }
    } finally {
      $('#refreshBtn').disabled = false;
    }
  }

  function show(data) {
    const now = Math.floor(Date.now() / 3600e3) * 3600e3;
    data.hours = data.hours.filter((h) => h.t >= now);
    decorate(data.hours, data.meta.timeZone);
    // Keep the selected hour across refreshes
    const prevT = state.view[state.sel]?.t;
    state.data = data;
    state.sel = Math.max(0, data.hours.findIndex((h) => h.t === prevT));
    const m = data.meta;
    $('#placeLabel').textContent = `${state.resort.name} · NWS ${m.office} ${m.gridX},${m.gridY} · ${Math.round(m.elevM * 3.28084)} ft grid elev.`;
    $('#updated').textContent = `Forecast issued ${new Date(m.updated).toLocaleString()} · fetched ${new Date(m.fetched).toLocaleTimeString()}`;
    render();
  }

  // ---------- rendering ----------

  function render() {
    if (!state.data) return;
    state.view = state.data.hours.slice(0, state.rangeH);
    state.sel = Math.min(state.sel, state.view.length - 1);
    document.querySelectorAll('#rangeSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.h === state.rangeH));
    sizeCharts();
    charts.update(state.view);
    renderCards();
    renderStrip();
    renderWindows();
    renderTable();
    const slider = $('#hourSlider');
    slider.max = state.view.length - 1;
    select(state.sel);
  }

  function sizeCharts() {
    const perHour = 9;
    document.querySelectorAll('.chart-box').forEach((b) => {
      b.style.minWidth = `${Math.max(state.view.length * perHour, 0)}px`;
    });
  }

  function findWindows(view) {
    const wins = [];
    let cur = null;
    view.forEach((h, i) => {
      if (usable(h)) {
        if (!cur) cur = { start: i, end: i, hours: [] };
        cur.end = i;
        cur.hours.push(h);
      } else if (cur) {
        wins.push(cur);
        cur = null;
      }
    });
    if (cur) wins.push(cur);
    return wins.map((w) => {
      const minWb = Math.min(...w.hours.map((h) => h.wbF));
      const avgWind = w.hours.reduce((s, h) => s + (h.windMph || 0), 0) / w.hours.length;
      // Vector-average wind direction
      let x = 0, y = 0;
      for (const h of w.hours) if (h.windDir != null) { x += Math.sin((h.windDir * Math.PI) / 180); y += Math.cos((h.windDir * Math.PI) / 180); }
      const avgDir = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
      return { ...w, minWb, avgWind, avgDir, best: zoneFor(minWb) };
    });
  }

  function chip(zone) {
    return `<span class="chip" style="--c:${zone.color}">${zone.label}</span>`;
  }

  function renderCards() {
    const v = state.view;
    const now = v[0];
    const wins = findWindows(v);
    const next = wins[0];
    const hoursOk = v.filter(usable).length;
    const hoursGood = v.filter((h) => usable(h) && h.wbF <= CFG.wetBulbZones[1].max).length;
    const coldest = v.reduce((a, h) => (h.wbF < a.wbF ? h : a), v[0]);
    const label = state.rangeH === 168 ? 'next 7 days' : `next ${state.rangeH} h`;

    $('#cards').innerHTML = `
      <div class="card">
        <div class="card-label">Now · ${now.fullLabel}</div>
        <div class="card-value">${deg(now.wbF)}F <small>wet bulb</small></div>
        <div class="card-sub">${chip(now.zone)} ${deg(now.tempF)}F · ${num(now.rh)}% RH · ${now.dirText} ${num(now.windMph)} mph</div>
      </div>
      <div class="card">
        <div class="card-label">Next snowmaking window</div>
        ${next
          ? `<div class="card-value">${v[next.start].fullLabel}</div>
             <div class="card-sub">${next.hours.length} h${next.end === v.length - 1 ? '+' : ''} · min WB ${deg(next.minWb)}F ${chip(next.best)}</div>`
          : `<div class="card-value muted">None</div><div class="card-sub">in the ${label}</div>`}
      </div>
      <div class="card">
        <div class="card-label">Snowmaking hours · ${label}</div>
        <div class="card-value">${hoursOk} <small>h</small></div>
        <div class="card-sub">${hoursGood} h good or better (≤ ${CFG.wetBulbZones[1].max}°F WB)</div>
      </div>
      <div class="card">
        <div class="card-label">Coldest wet bulb · ${label}</div>
        <div class="card-value">${deg(coldest.wbF)}F</div>
        <div class="card-sub">${coldest.fullLabel} ${chip(coldest.zone)}</div>
      </div>`;
  }

  function renderStrip() {
    const strip = $('#strip');
    strip.innerHTML = '';
    let dayEl = null;
    let lastDay = null;
    state.view.forEach((h, i) => {
      if (h.dayShort !== lastDay) {
        lastDay = h.dayShort;
        dayEl = document.createElement('div');
        dayEl.className = 'strip-day';
        dayEl.innerHTML = `<div class="strip-day-label">${h.dayShort}</div><div class="strip-cells"></div>`;
        strip.appendChild(dayEl);
      }
      const c = document.createElement('button');
      c.className = `cell wind-${h.windFlag}`;
      c.style.setProperty('--c', h.zone.color);
      c.title = `${h.fullLabel}: WB ${deg(h.wbF)}F (${h.zone.label}), wind ${h.dirText} ${num(h.windMph)} G${num(h.gustMph)} mph`;
      c.dataset.i = i;
      c.onclick = () => select(i);
      dayEl.querySelector('.strip-cells').appendChild(c);
      dayEl.style.flexGrow = dayEl.querySelector('.strip-cells').children.length;
    });
  }

  function renderWindows() {
    const wins = findWindows(state.view);
    const el = $('#windows');
    if (!wins.length) {
      el.innerHTML = `<p class="muted">No hours with wet bulb ≤ ${CFG.wetBulbZones[3].max}°F and workable wind in this range.</p>`;
      return;
    }
    el.innerHTML = wins
      .map((w) => {
        const a = state.view[w.start];
        const b = state.view[w.end];
        return `<button class="window" data-i="${w.start}" style="--c:${w.best.color}">
          <div class="window-time">${a.fullLabel} → ${b.fullLabel}${w.end === state.view.length - 1 ? '+' : ''}</div>
          <div class="window-meta"><b>${w.hours.length} h</b> · min WB ${deg(w.minWb)}F ${chip(w.best)} · avg wind ${Math.round(w.avgWind)} mph from ${dirText(w.avgDir)}</div>
        </button>`;
      })
      .join('');
    el.querySelectorAll('.window').forEach((b) => (b.onclick = () => { select(+b.dataset.i); $('#mapPanel').scrollIntoView({ behavior: 'smooth' }); }));
  }

  function renderTable() {
    const rows = state.view
      .map((h, i) => `<tr data-i="${i}">
        <td>${h.fullLabel}</td>
        <td><span class="dot" style="--c:${h.zone.color}"></span>${deg(h.wbF)}</td>
        <td>${deg(h.tempF)}</td><td>${deg(h.dewF)}</td><td>${num(h.rh)}%</td>
        <td>${h.dirText}</td><td class="w-${h.windFlag}">${num(h.windMph)}</td><td>${num(h.gustMph)}</td>
        <td>${num(h.sky)}%</td><td>${num(h.pop)}%</td><td>${h.snowIn ? h.snowIn.toFixed(1) : '—'}</td>
        <td>${h.zone.label}${h.windFlag === 'limit' ? ' · wind' : ''}</td></tr>`)
      .join('');
    const t = $('#hourTable');
    t.innerHTML = `<thead><tr><th>Time</th><th>WB °F</th><th>Temp</th><th>Dew</th><th>RH</th><th>Dir</th><th>Wind</th><th>Gust</th><th>Sky</th><th>PoP</th><th>Snow in</th><th>Rating</th></tr></thead><tbody>${rows}</tbody>`;
    t.querySelectorAll('tbody tr').forEach((tr) => (tr.onclick = () => select(+tr.dataset.i)));
  }

  function renderDetail(h) {
    const guns = Object.entries(CFG.gunTypes)
      .map(([, t]) => {
        const g = plumeGeometry(h, t);
        return `<li><span>${t.label}</span><b>${g.calm ? `~${Math.round(t.throwM * 3.28)} ft radius` : `${Math.round(g.length * 3.28)} ft (gusts ${Math.round(g.gustLength * 3.28)} ft)`}</b></li>`;
      })
      .join('');
    const windNote = {
      ok: 'Wind is workable.',
      caution: 'Breezy — expect drift and uneven coverage; aim guns accordingly.',
      limit: 'Wind exceeds limits — plumes will blow off target; consider shutting down exposed guns.',
    }[h.windFlag];
    $('#hourDetail').innerHTML = `
      <div class="detail-time">${h.fullLabel}</div>
      <div class="detail-wb" style="--c:${h.zone.color}">${deg(h.wbF)}F <small>wet bulb</small> ${chip(h.zone)}</div>
      <dl>
        <dt>Temperature</dt><dd>${deg(h.tempF)}F</dd>
        <dt>Dew point</dt><dd>${deg(h.dewF)}F</dd>
        <dt>Humidity</dt><dd>${num(h.rh)}%</dd>
        <dt>Wind</dt><dd>${h.dirText} ${num(h.windMph)} mph</dd>
        <dt>Gusts</dt><dd>${num(h.gustMph)} mph</dd>
        <dt>Snow drifts toward</dt><dd>${h.windDir == null || (h.windMph ?? 0) < 2 ? '—' : dirText((h.windDir + 180) % 360)}</dd>
        <dt>Sky / precip</dt><dd>${num(h.sky)}% · ${num(h.pop)}%</dd>
      </dl>
      <p class="detail-note w-${h.windFlag}">${windNote}</p>
      <div class="detail-sub">Estimated plume reach</div>
      <ul class="plume-list">${guns}</ul>`;
  }

  function select(i) {
    if (!state.view.length) return;
    state.sel = Math.max(0, Math.min(i, state.view.length - 1));
    const h = state.view[state.sel];
    document.querySelectorAll('#strip .cell').forEach((c) => c.classList.toggle('sel', +c.dataset.i === state.sel));
    document.querySelectorAll('#hourTable tbody tr').forEach((r) => r.classList.toggle('sel', +r.dataset.i === state.sel));
    charts.setCursor(state.sel);
    snowMap.setHour(h, h.zone.key === 'none' ? '#ced4da' : h.zone.color);
    renderDetail(h);
    $('#hourSlider').value = state.sel;
    $('#sliderLabel').textContent = h.fullLabel;
  }

  function setStatus(msg, kind) {
    const el = $('#status');
    el.hidden = !msg;
    el.className = `status ${kind || ''}`;
    el.textContent = msg;
  }

  function renderLegend() {
    $('#legend').innerHTML =
      CFG.wetBulbZones
        .map((z, i) => {
          const lo = i === 0 ? '' : `${CFG.wetBulbZones[i - 1].max}–`;
          const range = z.max === Infinity ? `> ${CFG.wetBulbZones[i - 1].max}°F` : i === 0 ? `≤ ${z.max}°F` : `${lo}${z.max}°F`;
          return `<span><i style="--c:${z.color}"></i>${z.label} <small>${range}</small></span>`;
        })
        .join('') + `<span><i class="hatch"></i>Wind limited <small>&gt; ${CFG.wind.limitMph} mph / G${CFG.wind.gustLimitMph}</small></span>`;
  }

  // ---------- resorts & guns ----------

  function loadResorts() {
    state.resorts = [...CFG.resorts, ...store.get('snowwx.customResorts', [])];
    const sel = $('#resortSelect');
    sel.innerHTML = '';
    for (const r of state.resorts) sel.add(new Option(r.region ? `${r.name} — ${r.region}` : r.name, r.id));
  }

  function selectResort(id) {
    state.resort = state.resorts.find((r) => r.id === id) || state.resorts[0];
    const r = state.resort;
    $('#resortSelect').value = r.id;
    $('#deleteResortBtn').hidden = !r.custom;
    $('#saveResortBtn').hidden = !r.temp;
    if (!r.temp) store.set('snowwx.resort', r.id);

    // Keep the address bar shareable: searched locations get ?lat&lon&name, saved ones a clean URL
    const url = new URL(location.href);
    url.search = r.temp ? new URLSearchParams({ lat: r.lat.toFixed(4), lon: r.lon.toFixed(4), name: r.name }).toString() : '';
    try { history.replaceState(null, '', url); } catch { /* ignore */ }

    $('#histLink').href = `history.html?${new URLSearchParams({ lat: r.lat.toFixed(4), lon: r.lon.toFixed(4), name: r.name })}`;
    snowMap.setResort(r, store.get(`snowwx.guns.${r.id}`, []));
    load();
  }

  // A searched or linked location that isn't saved to the list yet.
  function openTempLocation({ name, region = '', lat, lon, zoom = 14 }) {
    const id = `temp-${lat.toFixed(4)},${lon.toFixed(4)}`;
    let r = state.resorts.find((x) => x.id === id || (Math.abs(x.lat - lat) < 1e-4 && Math.abs(x.lon - lon) < 1e-4));
    if (!r) {
      r = { id, name: name || `${lat.toFixed(3)}, ${lon.toFixed(3)}`, region, lat, lon, zoom, temp: true };
      state.resorts = state.resorts.filter((x) => !x.temp);
      state.resorts.push(r);
      const sel = $('#resortSelect');
      [...sel.options].filter((o) => o.value.startsWith('temp-')).forEach((o) => o.remove());
      sel.add(new Option(`${r.name}${r.region ? ` — ${r.region}` : ''} (search)`, r.id));
    }
    selectResort(r.id);
  }

  // ---------- location search ----------

  const COORDS_RE = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/;

  // OpenStreetMap Nominatim geocoder (free; search on submit only, per its usage policy)
  async function geocode(q) {
    const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q, format: 'jsonv2', countrycodes: 'us', limit: '6', addressdetails: '1' })}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`search service returned ${res.status}`);
    return (await res.json()).map((p) => {
      const a = p.address || {};
      const town = a.city || a.town || a.village || a.hamlet || a.county || '';
      const region = [town, a.state].filter(Boolean).join(', ');
      return { name: p.name || p.display_name.split(',')[0], region, label: p.display_name, lat: +p.lat, lon: +p.lon };
    });
  }

  function closeResults() {
    $('#searchResults').hidden = true;
    $('#searchResults').innerHTML = '';
  }

  function chooseResult(p) {
    closeResults();
    $('#searchInput').value = '';
    $('#searchInput').blur();
    openTempLocation({ name: p.name, region: p.region, lat: p.lat, lon: p.lon, zoom: 15 });
  }

  $('#searchForm').onsubmit = async (e) => {
    e.preventDefault();
    const q = $('#searchInput').value.trim();
    if (!q) return;
    const m = COORDS_RE.exec(q);
    if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) {
      return chooseResult({ name: '', region: '', lat: +m[1], lon: +m[2] });
    }
    const box = $('#searchResults');
    box.hidden = false;
    box.innerHTML = '<div class="search-msg">Searching…</div>';
    try {
      const results = await geocode(q);
      if (!results.length) {
        box.innerHTML = `<div class="search-msg">No U.S. places found for “${q.replace(/[<>&]/g, '')}”. Try adding a town or state.</div>`;
        return;
      }
      box.innerHTML = '';
      for (const p of results) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'search-hit';
        b.innerHTML = '<b></b><small></small>';
        b.querySelector('b').textContent = p.name;
        b.querySelector('small').textContent = p.label;
        b.onclick = () => chooseResult(p);
        box.appendChild(b);
      }
      box.querySelector('button').focus();
    } catch (err) {
      box.innerHTML = `<div class="search-msg">Search failed (${err.message}). Check your connection and try again.</div>`;
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

  $('#saveResortBtn').onclick = () => {
    const r = state.resort;
    if (!r.temp) return;
    const saved = { ...r, id: `custom-${Date.now()}`, custom: true };
    delete saved.temp;
    store.set('snowwx.customResorts', [...store.get('snowwx.customResorts', []), saved]);
    store.set(`snowwx.guns.${saved.id}`, store.get(`snowwx.guns.${r.id}`, []));
    loadResorts();
    selectResort(saved.id);
  };

  // ---------- init ----------

  const charts = window.SnowCharts.createCharts($('#wbChart'), $('#windChart'), CFG, (i) => select(i));
  const snowMap = window.SnowMap.createSnowMap($('#map'), CFG, {
    onGunsChanged: (guns) => store.set(`snowwx.guns.${state.resort.id}`, guns),
  });

  const gunType = $('#gunTypeSelect');
  for (const [k, t] of Object.entries(CFG.gunTypes)) gunType.add(new Option(t.label, k));
  gunType.onchange = () => snowMap.setAddType(gunType.value);

  let adding = false;
  $('#addGunBtn').onclick = () => {
    adding = !adding;
    snowMap.setAddMode(adding, gunType.value);
    $('#addGunBtn').classList.toggle('on', adding);
    $('#addGunBtn').textContent = adding ? 'Done placing' : '+ Add gun';
  };

  $('#setLocBtn').onclick = () => {
    const name = prompt('Name for this location (forecast will use the current map center):');
    if (!name) return;
    const c = snowMap.center();
    const r = { id: `custom-${Date.now()}`, name, region: '', lat: +c.lat.toFixed(4), lon: +c.lon.toFixed(4), zoom: c.zoom, custom: true };
    store.set('snowwx.customResorts', [...store.get('snowwx.customResorts', []), r]);
    loadResorts();
    selectResort(r.id);
  };

  $('#deleteResortBtn').onclick = () => {
    if (!state.resort.custom || !confirm(`Remove “${state.resort.name}” and its guns?`)) return;
    store.set('snowwx.customResorts', store.get('snowwx.customResorts', []).filter((r) => r.id !== state.resort.id));
    try { localStorage.removeItem(`snowwx.guns.${state.resort.id}`); } catch { /* ignore */ }
    loadResorts();
    selectResort(CFG.defaultResortId);
  };

  $('#resortSelect').onchange = (e) => selectResort(e.target.value);
  $('#refreshBtn').onclick = () => load(true);
  $('#rangeSeg').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.rangeH = +b.dataset.h;
    store.set('snowwx.range', state.rangeH);
    render();
  };
  $('#hourSlider').oninput = (e) => select(+e.target.value);

  $('#playBtn').onclick = () => {
    if (state.playTimer) {
      clearInterval(state.playTimer);
      state.playTimer = null;
      $('#playBtn').textContent = '▶';
      return;
    }
    $('#playBtn').textContent = '❚❚';
    state.playTimer = setInterval(() => select((state.sel + 1) % state.view.length), 500);
  };

  // Keyboard: left/right arrows step through hours
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 'ArrowRight') select(state.sel + 1);
    if (e.key === 'ArrowLeft') select(state.sel - 1);
  });

  renderLegend();
  loadResorts();

  // Ad-hoc location from the URL, e.g. ?lat=44.926&lon=-89.684&name=Granite%20Peak
  const qs = new URLSearchParams(location.search);
  const qLat = parseFloat(qs.get('lat'));
  const qLon = parseFloat(qs.get('lon'));
  if (Number.isFinite(qLat) && Number.isFinite(qLon)) {
    openTempLocation({ name: qs.get('name') || '', lat: qLat, lon: qLon, zoom: +qs.get('zoom') || 14 });
  } else {
    selectResort(store.get('snowwx.resort', CFG.defaultResortId));
  }
  setInterval(() => load(), CFG.cacheMinutes * 60e3);
})();
