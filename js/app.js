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
    obs: null, // latest station observation for the Now card
    view: [],
    rangeH: store.get('snowwx.range', 384), // 16 days unless the user picked another range
    sel: 0,
    playTimer: null,
  };

  // Adjustable wet bulb limit: the go / no-go line on the chart. Sliding it moves the top
  // of the "Marginal" zone; colder zones keep their configured limits but never sit above it.
  const Z = CFG.wetBulbZones;
  const BASE_MAX = Z.map((z) => z.max);
  const DEFAULT_LIMIT = BASE_MAX[Z.length - 2];
  const clampLimit = (v) => (Number.isFinite(v) ? Math.max(15, Math.min(35, Math.round(v * 2) / 2)) : DEFAULT_LIMIT);
  const wbLimit = () => Z[Z.length - 2].max;

  function applyWbLimit(limit) {
    for (let i = 0; i < Z.length - 1; i++) Z[i].max = i === Z.length - 2 ? limit : Math.min(BASE_MAX[i], limit);
  }
  applyWbLimit(clampLimit(store.get('snowwx.wbLimit', DEFAULT_LIMIT)));

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

  function decorate(hours, tz, lat, lon) {
    const f = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts });
    const fHour = f({ hour: 'numeric', hourCycle: 'h23' });
    const fShortHour = f({ hour: 'numeric' });
    const fDay = f({ weekday: 'short' });
    const fFull = f({ weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric' });
    const fDate = f({ year: 'numeric', month: '2-digit', day: '2-digit' }); // for a per-day key
    const fMonth = f({ month: 'short' });
    const fDayNum = f({ day: 'numeric' });
    for (const h of hours) {
      h.hour24 = parseInt(fHour.format(h.t), 10) % 24;
      h.hourShort = fShortHour.format(h.t).replace(' AM', 'a').replace(' PM', 'p');
      h.dayShort = fDay.format(h.t);
      h.fullLabel = fFull.format(h.t);
      h.dayKey = fDate.format(h.t);
      h.monthShort = fMonth.format(h.t);
      h.dayNum = parseInt(fDayNum.format(h.t), 10);
      h.zone = zoneFor(h.wbF);
      h.windFlag = windFlag(h);
      h.dirText = dirText(h.windDir);
    }
    // Day / night: sun altitude for each hour, and the next sunrise or sunset after it.
    if (hours.length && lat != null) {
      const { sunAltitude, sunEvents, HORIZON } = window.SnowSun;
      const fTime = f({ hour: 'numeric', minute: '2-digit' });
      const events = sunEvents(hours[0].t - 86400e3, hours[hours.length - 1].t + 2 * 86400e3, lat, lon);
      let k = 0;
      for (const h of hours) {
        h.sunAlt = sunAltitude(h.t, lat, lon);
        h.isDay = h.sunAlt > HORIZON;
        while (k < events.length && events[k].t <= h.t) k++;
        const ev = events[k];
        h.nextSun = ev ? { type: ev.type, label: fTime.format(ev.t) } : null;
      }
    }
    return hours;
  }

  async function load(force = false) {
    const r = state.resort;
    const key = `snowwx.cache.${r.lat.toFixed(4)},${r.lon.toFixed(4)}`;
    const cached = store.get(key, null);
    setStatus('');
    loadObs();
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

  // Real conditions for the Now card. The forecast stays on screen if this fails.
  async function loadObs() {
    const r = state.resort;
    try {
      const obs = await window.SnowWeather.fetchCurrent(r.lat, r.lon);
      if (state.resort !== r) return; // switched resorts while loading
      state.obs = obs;
    } catch (e) {
      console.error(e);
      if (state.resort !== r) return;
      // Keep the last reading until it is too old to call "now"
      if (state.obs && Date.now() - state.obs.t > 90 * 60e3) state.obs = null;
    }
    if (state.data) renderCards();
  }

  function show(data) {
    const now = Math.floor(Date.now() / 3600e3) * 3600e3;
    data.hours = data.hours.filter((h) => h.t >= now);
    decorate(data.hours, data.meta.timeZone, state.resort.lat, state.resort.lon);
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
    document.querySelectorAll('.range-seg button').forEach((b) => b.classList.toggle('on', +b.dataset.h === state.rangeH));
    sizeCharts();
    charts.update(state.view);
    renderCards();
    renderExtNote();
    renderStrip();
    renderWindows();
    renderTable();
    const slider = $('#hourSlider');
    slider.max = state.view.length - 1;
    select(state.sel);
  }

  function sizeCharts() {
    const perHour = state.view.length > 168 ? 6 : 9;
    document.querySelectorAll('.chart-box, .sky-track').forEach((b) => {
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
    return wins.map((w) => ({ ...w, ...summarize(w.hours) }));
  }

  // Min wet bulb, its zone, and average wind speed / direction for a run of hours.
  function summarize(hours) {
    const minWb = Math.min(...hours.map((h) => h.wbF));
    const avgWind = hours.reduce((s, h) => s + (h.windMph || 0), 0) / hours.length;
    // Vector-average wind direction
    let x = 0, y = 0;
    for (const h of hours) if (h.windDir != null) { x += Math.sin((h.windDir * Math.PI) / 180); y += Math.cos((h.windDir * Math.PI) / 180); }
    const avgDir = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
    return { minWb, avgWind, avgDir, best: zoneFor(minWb) };
  }

  function chip(zone) {
    return `<span class="chip" style="--c:${zone.color}">${zone.label}</span>`;
  }

  // "Now" uses the latest station observation; the forecast hour is the fallback.
  function nowCard(fc) {
    const o = state.obs;
    if (!o) {
      return `
      <div class="card">
        <div class="card-label">Now · forecast for ${fc.fullLabel}</div>
        <div class="card-value">${deg(fc.wbF)}F <small>wet bulb</small></div>
        <div class="card-sub">${chip(fc.zone)} ${deg(fc.tempF)}F · ${num(fc.rh)}% RH · ${fc.dirText} ${num(fc.windMph)} mph</div>
        <div class="card-sub">No current station report; showing the forecast</div>
      </div>`;
    }
    const time = new Intl.DateTimeFormat('en-US', { timeZone: state.data.meta.timeZone, hour: 'numeric', minute: '2-digit' }).format(o.t);
    const wind = o.windMph == null ? 'wind —'
      : o.windMph < 1 ? 'Calm'
      : `${o.windDir == null ? '' : dirText(o.windDir) + ' '}${num(o.windMph)} mph${o.gustMph ? ` G${num(o.gustMph)}` : ''}`;
    const st = o.station;
    const name = String(st.name).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return `
      <div class="card">
        <div class="card-label">Now · observed ${time}</div>
        <div class="card-value">${deg(o.wbF)}F <small>wet bulb</small></div>
        <div class="card-sub">${chip(zoneFor(o.wbF))} ${deg(o.tempF)}F · ${num(o.rh)}% RH · ${wind}</div>
        <div class="card-sub"><a href="https://www.weather.gov/wrh/timeseries?site=${encodeURIComponent(st.id)}" target="_blank" rel="noopener" title="Open this station's observations on weather.gov">${name} (${st.id}), ${st.distMi.toFixed(st.distMi < 10 ? 1 : 0)} mi ${dirText(st.bearing)}</a> · forecast this hour ${deg(fc.wbF)}F</div>
      </div>`;
  }

  function renderCards() {
    const v = state.view;
    const now = v[0];
    const wins = findWindows(v);
    const next = wins[0];
    const hoursOk = v.filter(usable).length;
    const hoursGood = v.filter((h) => usable(h) && h.wbF <= CFG.wetBulbZones[1].max).length;
    const coldest = v.reduce((a, h) => (h.wbF < a.wbF ? h : a), v[0]);
    const label = state.rangeH >= 168 ? `next ${Math.round(Math.min(state.rangeH, Math.max(v.length, 168)) / 24)} days` : `next ${state.rangeH} h`;

    $('#cards').innerHTML = `
      ${nowCard(now)}
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

  // Says where the NWS forecast ends and the extended-range model takes over.
  function renderExtNote() {
    const el = $('#extNote');
    const first = state.view.find((h) => h.ext);
    if (first) {
      el.textContent = `From ${first.fullLabel} on (dashed line), hours come from extended-range global models instead of the NWS forecast. Treat them as a trend, not a schedule.`;
    } else if (state.rangeH > 168) {
      el.textContent = 'The extended outlook past the NWS forecast is not available right now. Try Refresh.';
    }
    el.hidden = !first && state.rangeH <= 168;
  }

  function renderStrip() {
    const strip = $('#strip');
    strip.innerHTML = '';
    let dayEl = null;
    let lastDay = null;
    let lastExt = false;
    state.view.forEach((h, i) => {
      const extStart = !!h.ext && !lastExt;
      lastExt = !!h.ext;
      if (h.dayShort !== lastDay || extStart) {
        lastDay = h.dayShort;
        dayEl = document.createElement('div');
        dayEl.className = `strip-day${h.ext ? ' ext' : ''}${extStart ? ' ext-first' : ''}`;
        dayEl.innerHTML = `<div class="strip-day-label">${h.dayShort}</div><div class="strip-cells"></div>`;
        strip.appendChild(dayEl);
      }
      const c = document.createElement('button');
      c.className = `cell wind-${h.windFlag}`;
      c.style.setProperty('--c', h.zone.color);
      c.title = `${h.fullLabel}: WB ${deg(h.wbF)}F (${h.zone.label}), wind ${h.dirText} ${num(h.windMph)} G${num(h.gustMph)} mph${h.ext ? ' · extended range' : ''}`;
      c.dataset.i = i;
      c.onclick = () => select(i);
      dayEl.querySelector('.strip-cells').appendChild(c);
      dayEl.style.flexGrow = dayEl.querySelector('.strip-cells').children.length;
    });
  }

  // Calendar of the snowmaking windows: one cell per forecast day, laid out by week.
  // Each day shows a 24-hour bar (usable hours in their zone color) and the part of
  // every window that falls on that day; windows crossing midnight continue on the next day.
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function renderWindowCalendar(wins) {
    const el = $('#winCal');
    const v = state.view;
    if (!v.length) { el.innerHTML = ''; return; }

    const days = [];
    const byKey = new Map();
    v.forEach((h, i) => {
      let d = byKey.get(h.dayKey);
      if (!d) {
        d = { key: h.dayKey, first: h, slots: Array(24).fill(null), segs: [], ext: false };
        byKey.set(h.dayKey, d);
        days.push(d);
      }
      d.slots[h.hour24] = i;
      if (h.ext) d.ext = true;
    });

    for (const w of wins) {
      let seg = null;
      for (let i = w.start; i <= w.end; i++) {
        const h = v[i];
        if (!seg || seg.day !== h.dayKey) {
          seg = { day: h.dayKey, start: i, end: i, hours: [], contFrom: i > w.start };
          byKey.get(h.dayKey).segs.push(seg);
        }
        seg.end = i;
        seg.hours.push(h);
      }
      const segs = days.flatMap((d) => d.segs).filter((sg) => sg.start >= w.start && sg.end <= w.end);
      segs.forEach((sg, k) => { sg.contTo = k < segs.length - 1 || w.end === v.length - 1; });
    }

    const lead = WEEKDAYS.indexOf(days[0].first.dayShort);
    const blanks = '<div class="cal-day blank" aria-hidden="true"></div>'.repeat(Math.max(lead, 0));
    const cells = days
      .map((d) => {
        const usableHours = d.slots.filter((i) => i != null && usable(v[i])).length;
        const bar = d.slots
          .map((i, hr) => {
            if (i == null) return '<i class="cal-hr none"></i>';
            const h = v[i];
            const ok = usable(h);
            return `<i class="cal-hr${ok ? ' ok' : ''}" data-i="${i}" style="--c:${h.zone.color}" title="${h.fullLabel}: WB ${deg(h.wbF)}F (${h.zone.label}), wind ${h.dirText} ${num(h.windMph)} mph${ok ? '' : ' · not usable'}"></i>`;
          })
          .join('');
        const segs = d.segs
          .map((sg) => {
            const sum = summarize(sg.hours);
            const a = v[sg.start];
            const b = v[sg.end];
            const time = sg.start === sg.end ? a.hourShort : `${a.hourShort}–${b.hourShort}`;
            return `<button class="cal-seg sel-range" data-i="${sg.start}" data-end="${sg.end}" style="--c:${sum.best.color}" title="${a.fullLabel} → ${b.fullLabel}">
              <i class="sel-tick" aria-hidden="true"></i>
              <span class="cal-seg-time">${sg.contFrom ? '← ' : ''}${time}${sg.contTo ? ' →' : ''}</span>
              <span class="cal-seg-meta"><b>${sg.hours.length} h</b> · ${deg(sum.minWb)}F ${chip(sum.best)}</span>
              <span class="cal-seg-meta">${Math.round(sum.avgWind)} mph ${dirText(sum.avgDir)}</span>
            </button>`;
          })
          .join('');
        return `<div class="cal-day${d.ext ? ' ext' : ''}${usableHours ? '' : ' idle'}" data-day="${d.key}">
          <div class="cal-date"><span>${d.first.dayShort}</span> <b>${d.first.monthShort} ${d.first.dayNum}</b>${usableHours ? `<span class="cal-total">${usableHours} h</span>` : ''}</div>
          <div class="cal-bar">${bar}<i class="cal-mark" aria-hidden="true"></i></div>
          ${segs || '<div class="cal-none">No window</div>'}
        </div>`;
      })
      .join('');
    el.innerHTML = `<div class="cal-head">${WEEKDAYS.map((w) => `<div>${w}</div>`).join('')}</div><div class="cal-grid">${blanks}${cells}</div>`;
    el.querySelectorAll('.cal-hr[data-i]').forEach((c) => (c.onclick = () => select(+c.dataset.i)));
    el.querySelectorAll('.cal-seg').forEach((b) => (b.onclick = () => select(+b.dataset.i)));
  }

  function renderWindows() {
    const wins = findWindows(state.view);
    renderWindowCalendar(wins);
    const el = $('#windows');
    if (!wins.length) {
      el.innerHTML = `<p class="muted">No hours with wet bulb ≤ ${CFG.wetBulbZones[3].max}°F and workable wind in this range.</p>`;
      return;
    }
    el.innerHTML = wins
      .map((w) => {
        const a = state.view[w.start];
        const b = state.view[w.end];
        return `<button class="window sel-range" data-i="${w.start}" data-end="${w.end}" style="--c:${w.best.color}">
          <i class="sel-tick" aria-hidden="true"></i>
          <div class="window-time">${a.fullLabel} → ${b.fullLabel}${w.end === state.view.length - 1 ? '+' : ''}${b.ext ? '<span class="tag-ext">extended range</span>' : ''}</div>
          <div class="window-meta"><b>${w.hours.length} h</b> · min WB ${deg(w.minWb)}F ${chip(w.best)} · avg wind ${Math.round(w.avgWind)} mph from ${dirText(w.avgDir)}</div>
        </button>`;
      })
      .join('');
    el.querySelectorAll('.window').forEach((b) => (b.onclick = () => select(+b.dataset.i)));
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

  // Show the selected hour in the Snowmaking windows section: a gray line on that day's
  // 24-hour bar in the calendar, and on any window card (calendar or list) that holds the hour,
  // placed by where the hour falls inside the window. Moves with the arrow keys.
  function markWindows(h) {
    const i = state.sel;
    document.querySelectorAll('#winCal .cal-day').forEach((d) => {
      const on = d.dataset.day === h.dayKey;
      d.classList.toggle('sel-day', on);
      if (on) d.querySelector('.cal-mark').style.left = `${((h.hour24 + 0.5) / 24) * 100}%`;
    });
    document.querySelectorAll('.sel-range').forEach((c) => {
      const a = +c.dataset.i;
      const b = +c.dataset.end;
      const on = i >= a && i <= b;
      c.classList.toggle('sel', on);
      if (on) c.querySelector('.sel-tick').style.left = `${((i - a + 0.5) / (b - a + 1)) * 100}%`;
    });
  }

  // The outlook strip scrolls sideways on long ranges: keep the selected cell in view,
  // the same way the charts keep their selected hour in view.
  function keepStripInView() {
    const wrap = $('#strip').parentElement;
    const cell = $('#strip .cell.sel');
    if (!cell || wrap.scrollWidth <= wrap.clientWidth) return;
    const x = cell.getBoundingClientRect().left - wrap.getBoundingClientRect().left + wrap.scrollLeft;
    const w = cell.offsetWidth;
    const pad = Math.min(80, wrap.clientWidth / 4);
    if (x < wrap.scrollLeft + pad) wrap.scrollLeft = x - pad;
    else if (x + w > wrap.scrollLeft + wrap.clientWidth - pad) wrap.scrollLeft = x + w - wrap.clientWidth + pad;
  }

  function select(i) {
    if (!state.view.length) return;
    state.sel = Math.max(0, Math.min(i, state.view.length - 1));
    const h = state.view[state.sel];
    document.querySelectorAll('#strip .cell').forEach((c) => c.classList.toggle('sel', +c.dataset.i === state.sel));
    keepStripInView();
    document.querySelectorAll('#hourTable tbody tr').forEach((r) => r.classList.toggle('sel', +r.dataset.i === state.sel));
    markWindows(h);
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

  function syncWbLimitUI() {
    $('#wbLimitRange').value = wbLimit();
    $('#wbLimitVal').textContent = `${wbLimit()}°F`;
    $('#wbLimitReset').hidden = wbLimit() === DEFAULT_LIMIT;
  }

  function setWbLimit(v) {
    const limit = clampLimit(v);
    applyWbLimit(limit);
    store.set('snowwx.wbLimit', limit);
    syncWbLimitUI();
    renderLegend();
    if (!state.data) return;
    for (const h of state.data.hours) h.zone = zoneFor(h.wbF);
    render();
  }

  function renderLegend() {
    $('#legend').innerHTML =
      CFG.wetBulbZones
        .map((z, i) => {
          if (i > 0 && z.max <= CFG.wetBulbZones[i - 1].max) return ''; // zone squeezed out by the limit
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
    state.obs = null;
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

  // Plume drift map starts collapsed; once the user opens or closes it, that state is kept.
  const mapPanel = $('#mapPanel');
  mapPanel.open = store.get('snowwx.mapOpen', false);
  mapPanel.addEventListener('toggle', () => {
    store.set('snowwx.mapOpen', mapPanel.open);
    if (!mapPanel.open) return;
    // Leaflet can't size a hidden map; re-measure on open and keep the same center.
    const c = snowMap.center();
    snowMap.invalidate();
    snowMap.map.setView([c.lat, c.lon], c.zoom, { animate: false });
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
  // Snowmaking windows view: calendar (default), calendar + cards, or cards only. Remembered.
  const ic = (body) => `<svg class="view-ic" viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
  const IC_CAL = '<rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5 1.5v3M11 1.5v3"/>';
  const IC_CARDS = '<rect x="2" y="2.5" width="12" height="4" rx="1"/><rect x="2" y="9.5" width="12" height="4" rx="1"/>';
  const WIN_VIEWS = {
    cal: { label: 'Calendar', icon: ic(IC_CAL) },
    both: { label: 'Calendar + cards', icon: ic('<rect x="1.5" y="2" width="7" height="7" rx="1"/><path d="M1.5 4.5h7"/><rect x="1.5" y="11" width="13" height="3" rx="1"/><path d="M10.5 3h4M10.5 5.5h4M10.5 8h4"/>') },
    cards: { label: 'Cards', icon: ic(IC_CARDS) },
  };
  const viewBtn = $('#winViewBtn');
  const viewList = $('#winViewList');
  viewList.querySelectorAll('button').forEach((b) => (b.innerHTML = `${WIN_VIEWS[b.dataset.v].icon}${WIN_VIEWS[b.dataset.v].label}`));
  function setWinView(v) {
    if (!WIN_VIEWS[v]) v = 'cal';
    $('#winWrap').dataset.view = v;
    viewBtn.innerHTML = `${WIN_VIEWS[v].icon}<span>${WIN_VIEWS[v].label}</span><span class="caret" aria-hidden="true">▾</span>`;
    viewBtn.setAttribute('aria-label', `Windows view: ${WIN_VIEWS[v].label}`);
    viewList.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', b.dataset.v === v));
    store.set('snowwx.winView', v);
  }
  function openViewMenu(open) {
    viewList.hidden = !open;
    viewBtn.setAttribute('aria-expanded', open);
    if (open) (viewList.querySelector('[aria-checked="true"]') || viewList.querySelector('button')).focus();
  }
  setWinView(store.get('snowwx.winView', 'cal'));
  viewBtn.onclick = () => openViewMenu(viewList.hidden);
  viewList.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; setWinView(b.dataset.v); openViewMenu(false); viewBtn.focus(); };
  viewList.onkeydown = (e) => {
    const items = [...viewList.querySelectorAll('button')];
    const k = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(k + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
    if (e.key === 'Escape') { openViewMenu(false); viewBtn.focus(); }
  };
  document.addEventListener('click', (e) => { if (!viewList.hidden && !e.target.closest('#winView')) openViewMenu(false); });

  // Range pickers on Snowmaking windows and Hourly outlook share one setting.
  document.querySelectorAll('.range-seg').forEach((seg) => (seg.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.rangeH = +b.dataset.h;
    store.set('snowwx.range', state.rangeH);
    render();
  }));
  $('#hourSlider').oninput = (e) => select(+e.target.value);

  $('#wbLimitRange').oninput = (e) => setWbLimit(+e.target.value);
  $('#wbLimitDown').onclick = () => setWbLimit(wbLimit() - 1);
  $('#wbLimitUp').onclick = () => setWbLimit(wbLimit() + 1);
  $('#wbLimitReset').onclick = () => setWbLimit(DEFAULT_LIMIT);
  syncWbLimitUI();

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
  // preventDefault stops the browser from scrolling the wide (10d / 16d) charts sideways
  // instead; the charts scroll themselves to keep the selected hour in view.
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    select(state.sel + (e.key === 'ArrowRight' ? 1 : -1));
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
  setInterval(() => loadObs(), 5 * 60e3); // stations report every 5-20 minutes
})();
