// Chart.js charts: wet bulb / temp / RH and wind.
(function () {
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // Vertical line at the selected hour (index stored on chart.$cursor)
  const cursorPlugin = {
    id: 'cursor',
    afterDatasetsDraw(chart) {
      const i = chart.$cursor;
      if (i == null) return;
      const x = chart.scales.x.getPixelForValue(i);
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = css('--text');
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.restore();
    },
  };

  // Dashed marker where the NWS forecast ends and the extended-range model begins
  const extendedPlugin = {
    id: 'extended',
    afterDatasetsDraw(chart) {
      const i = chart.$extStart;
      if (i == null || i < 1) return;
      const x = chart.scales.x.getPixelForValue(i - 0.5);
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = css('--muted');
      ctx.fillStyle = css('--muted');
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText('Extended range →', x + 6, top + 12);
      ctx.restore();
    },
  };

  // ---------- day / night ----------
  // Sky color for a sun altitude (degrees): night, twilight, a warm glow at the horizon, day.
  const SKY_STOPS = [
    [-18, [11, 18, 34]],
    [-8, [32, 40, 78]],
    [-2, [92, 70, 110]],
    [1, [196, 120, 70]],
    [8, [74, 128, 186]],
    [40, [96, 160, 222]],
  ];
  function skyColor(alt) {
    if (alt == null) return 'transparent';
    if (alt <= SKY_STOPS[0][0]) return `rgb(${SKY_STOPS[0][1]})`;
    for (let k = 1; k < SKY_STOPS.length; k++) {
      const [a1, c1] = SKY_STOPS[k];
      if (alt <= a1) {
        const [a0, c0] = SKY_STOPS[k - 1];
        const f = (alt - a0) / (a1 - a0);
        return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * f)).join(',')})`;
      }
    }
    return `rgb(${SKY_STOPS[SKY_STOPS.length - 1][1]})`;
  }
  // How dark night is, 0 (sun up) to 1 (sun 12° or more below the horizon).
  const nightLevel = (alt) => Math.max(0, Math.min(1, -alt / 12));

  // Darkens the night hours across the whole chart, fading through twilight.
  const dayNightPlugin = {
    id: 'dayNight',
    beforeDatasetsDraw(chart) {
      const view = chart.$view;
      if (!view || !view.length) return;
      const { top, bottom, left, right } = chart.chartArea;
      const x = chart.scales.x;
      const ctx = chart.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, right - left, bottom - top);
      ctx.clip();
      view.forEach((h, i) => {
        if (h.sunAlt == null) return;
        const a = nightLevel(h.sunAlt);
        if (!a) return;
        const x0 = x.getPixelForValue(i - 0.5);
        const x1 = x.getPixelForValue(i + 0.5);
        ctx.fillStyle = `rgba(2, 6, 20, ${(a * 0.32).toFixed(3)})`;
        ctx.fillRect(x0, top, x1 - x0 + 0.5, bottom - top);
      });
      ctx.restore();
    },
    // Line the sky track up with the plot area and move the sun / moon to the selected hour.
    afterRender(chart) {
      if (chart.$placeSky) chart.$placeSky();
    },
  };

  // Shaded wet bulb rating bands behind the temperature chart
  function zoneBandsPlugin(zones) {
    return {
      id: 'zoneBands',
      beforeDatasetsDraw(chart) {
        const y = chart.scales.y;
        const { left, right } = chart.chartArea;
        const ctx = chart.ctx;
        ctx.save();
        let lower = y.min;
        for (const z of zones) {
          const upper = Math.min(z.max, y.max);
          if (upper > lower) {
            const yTop = y.getPixelForValue(upper);
            const yBot = y.getPixelForValue(lower);
            ctx.fillStyle = hexA(z.color, z.key === 'none' ? 0.06 : 0.13);
            ctx.fillRect(left, yTop, right - left, yBot - yTop);
          }
          lower = Math.max(lower, z.max);
          if (lower >= y.max) break;
        }
        // Snowmaking threshold line
        const limit = zones[zones.length - 2].max;
        if (limit > y.min && limit < y.max) {
          const yl = y.getPixelForValue(limit);
          ctx.strokeStyle = hexA(zones[zones.length - 2].color, 0.8);
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(left, yl);
          ctx.lineTo(right, yl);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = hexA(zones[zones.length - 2].color, 0.95);
          ctx.font = '11px system-ui, sans-serif';
          ctx.fillText(`${limit}°F wet bulb`, left + 6, yl - 4);
        }
        ctx.restore();
      },
    };
  }

  // Horizontal reference lines for wind limits
  function windLimitsPlugin(wind) {
    return {
      id: 'windLimits',
      beforeDatasetsDraw(chart) {
        const y = chart.scales.y;
        const { left, right } = chart.chartArea;
        const ctx = chart.ctx;
        ctx.save();
        ctx.font = '11px system-ui, sans-serif';
        for (const [v, color, label] of [
          [wind.cautionMph, css('--caution'), 'caution'],
          [wind.limitMph, css('--danger'), 'limit'],
        ]) {
          if (v > y.max) continue;
          const yy = y.getPixelForValue(v);
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.7;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(left, yy);
          ctx.lineTo(right, yy);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = color;
          ctx.fillText(`${v} mph ${label}`, left + 6, yy - 4);
        }
        ctx.restore();
      },
    };
  }

  // Arrows above the wind chart pointing in the direction snow will drift (downwind)
  const windArrowsPlugin = {
    id: 'windArrows',
    afterDatasetsDraw(chart) {
      const view = chart.$view;
      if (!view) return;
      const x = chart.scales.x;
      const step = chart.$arrowStep || 3;
      const ctx = chart.ctx;
      const yc = chart.chartArea.top - 12;
      ctx.save();
      ctx.strokeStyle = css('--text');
      ctx.fillStyle = css('--text');
      ctx.lineWidth = 1.5;
      view.forEach((h, i) => {
        if (i % step !== 0 || h.windDir == null || !h.windMph) return;
        const px = x.getPixelForValue(i);
        const rad = (((h.windDir + 180) % 360) * Math.PI) / 180;
        const len = 5 + Math.min(h.windMph, 30) / 6;
        ctx.save();
        ctx.translate(px, yc);
        ctx.rotate(rad);
        ctx.beginPath();
        ctx.moveTo(0, len);
        ctx.lineTo(0, -len);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -len - 2);
        ctx.lineTo(-3.5, -len + 4);
        ctx.lineTo(3.5, -len + 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
      ctx.restore();
    },
  };

  function createCharts(wbCanvas, windCanvas, cfg, onSelect) {
    const grid = css('--grid');
    const muted = css('--muted');
    Chart.defaults.color = muted;
    Chart.defaults.font.family = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

    const cb = !!(window.SnowA11y && window.SnowA11y.colorBlind); // dotted humidity line as a second cue
    let view = [];
    let tickStep = 6;

    const xScale = {
      grid: { color: grid },
      ticks: {
        autoSkip: false,
        maxRotation: 0,
        callback: (v, i) => {
          const h = view[i];
          if (!h) return '';
          if (h.hour24 === 0) return h.dayShort;
          return h.hour24 % tickStep === 0 ? h.hourShort : '';
        },
      },
    };

    const tooltip = {
      mode: 'index',
      intersect: false,
      callbacks: { title: (items) => view[items[0].dataIndex]?.fullLabel ?? '' },
    };

    function handleClick(evt, _els, chart) {
      const pts = chart.getElementsAtEventForMode(evt, 'index', { intersect: false }, false);
      if (pts.length) onSelect(pts[0].index);
    }

    // Readout above the wet bulb chart: the hovered hour, or the selected hour when not hovering.
    const readout = document.getElementById('wbReadout');
    let wbHover = null;
    const fmt = (v, unit) => (v == null ? '—' : `${Math.round(v)}${unit}`);
    function showReadout() {
      if (!readout) return;
      const i = wbHover ?? wbChart.$cursor;
      const h = view[i];
      if (wbChart.$placeSky) placeSky();
      if (!h) { readout.innerHTML = ''; return; }
      const ds = wbChart.data.datasets;
      const item = (k, label, value, extra = '') =>
        `<span class="ro-item"><i class="ro-key${ds[k].borderDash?.length ? ' dashed' : ''}" style="--c:${ds[k].borderColor}"></i>${label} <b>${value}</b>${extra}</span>`;
      readout.innerHTML = `<span class="ro-time">${h.fullLabel}${wbHover == null ? ' <small>selected</small>' : ''}</span>
        ${item(0, 'Wet bulb', fmt(h.wbF, '°F'), h.zone ? ` <span class="chip" style="--c:${h.zone.color}">${h.zone.label}</span>` : '')}
        ${item(1, 'Temp', fmt(h.tempF, '°F'))}
        ${item(2, 'Dew point', fmt(h.dewF, '°F'))}
        ${item(3, 'Humidity', fmt(h.rh, '%'))}
        ${h.sunAlt == null ? '' : `<span class="ro-item ro-sun"><i class="ro-ic ${h.isDay ? 'sun' : 'moon'}"></i><b>${h.isDay ? 'Day' : 'Night'}</b>${h.nextSun ? ` · ${h.nextSun.type === 'rise' ? 'sunrise' : 'sunset'} ${h.nextSun.label}` : ''}</span>`}`;
    }

    // Sky track above the chart: sky color hour by hour, and a sun (day) or moon (night)
    // that glides to the selected or hovered hour. Sun height follows its real altitude.
    const sky = document.getElementById('wbSky');
    let skyKey = '';
    function placeSky() {
      if (!sky) return;
      const area = wbChart.chartArea;
      if (!area || !view.length || view[0].sunAlt == null) { sky.hidden = true; return; }
      sky.hidden = false;
      const inner = sky.firstElementChild;
      inner.style.left = `${area.left}px`;
      inner.style.width = `${area.right - area.left}px`;
      const x = wbChart.scales.x;
      const span = area.right - area.left;
      // Rebuild the sky gradient only when the hours or the width change
      const key = `${view.length}:${view[0].t}:${Math.round(span)}`;
      if (key !== skyKey) {
        skyKey = key;
        const stops = view.map((h, i) => `${skyColor(h.sunAlt)} ${(((x.getPixelForValue(i) - area.left) / span) * 100).toFixed(2)}%`);
        inner.querySelector('.sky-band').style.background = `linear-gradient(to right, ${stops.join(', ')})`;
      }
      const i = Math.max(0, Math.min(view.length - 1, wbHover ?? wbChart.$cursor ?? 0));
      const h = view[i];
      const body = inner.querySelector('.sky-body');
      const maxAlt = Math.max(10, ...view.map((v) => v.sunAlt));
      // 0 = on the horizon (bottom of the track), 1 = top. The moon rises as the night deepens.
      const lift = h.isDay ? Math.max(0, h.sunAlt) / maxAlt : nightLevel(h.sunAlt) * 0.75;
      body.style.left = `${x.getPixelForValue(i) - area.left}px`;
      body.style.setProperty('--lift', lift.toFixed(3));
      body.classList.toggle('night', !h.isDay);
    }
    wbCanvas.addEventListener('mouseleave', () => { wbHover = null; showReadout(); });

    const wbChart = new Chart(wbCanvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'Wet bulb °F', data: [], borderColor: css('--wb'), backgroundColor: css('--wb'), borderWidth: 3, pointRadius: 0, tension: 0.3, yAxisID: 'y' },
          { label: 'Temp °F', data: [], borderColor: css('--temp'), backgroundColor: css('--temp'), borderWidth: 1.5, pointRadius: 0, tension: 0.3, yAxisID: 'y' },
          { label: 'Dew point °F', data: [], borderColor: css('--dew'), backgroundColor: css('--dew'), borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, tension: 0.3, yAxisID: 'y' },
          { label: 'Humidity %', data: [], borderColor: css('--rh'), backgroundColor: hexA(css('--rh'), 0.08), fill: true, borderWidth: 1, borderDash: cb ? [2, 3] : [], pointRadius: 0, tension: 0.3, yAxisID: 'rh' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        onClick: handleClick,
        scales: {
          x: xScale,
          y: { grid: { color: grid }, title: { display: true, text: '°F' } },
          rh: { position: 'right', min: 0, max: 100, grid: { display: false }, title: { display: true, text: 'RH %' } },
        },
        plugins: {
          legend: { labels: { boxWidth: 12, boxHeight: 3 } },
          // No floating box over the lines: the hovered hour is shown in a bar above the chart.
          tooltip: {
            ...tooltip,
            enabled: false,
            external: ({ tooltip: t }) => {
              wbHover = t.opacity === 0 || !t.dataPoints?.length ? null : t.dataPoints[0].dataIndex;
              showReadout();
            },
          },
        },
      },
      plugins: [zoneBandsPlugin(cfg.wetBulbZones), dayNightPlugin, extendedPlugin, cursorPlugin],
    });

    const windChart = new Chart(windCanvas, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [
          { type: 'line', label: 'Gust mph', data: [], borderColor: css('--gust'), backgroundColor: css('--gust'), borderWidth: 1.5, pointRadius: 0, tension: 0.3, order: 0 },
          { type: 'bar', label: 'Sustained mph', data: [], backgroundColor: [], borderWidth: 0, barPercentage: 1, categoryPercentage: 0.9, order: 1 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 26 } },
        interaction: { mode: 'index', intersect: false },
        onClick: handleClick,
        scales: {
          x: xScale,
          y: { beginAtZero: true, suggestedMax: 30, grid: { color: grid }, title: { display: true, text: 'mph' } },
        },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 6 } },
          tooltip: {
            ...tooltip,
            callbacks: {
              ...tooltip.callbacks,
              label: (c) => `${c.dataset.label}: ${Math.round(c.parsed.y)}`,
              afterBody: (items) => {
                const h = view[items[0].dataIndex];
                return h && h.windDir != null ? `From ${h.dirText} (${Math.round(h.windDir)}°)` : '';
              },
            },
          },
        },
      },
      plugins: [windLimitsPlugin(cfg.wind), windArrowsPlugin, extendedPlugin, cursorPlugin],
    });

    wbChart.$placeSky = placeSky;

    function update(newView) {
      view = newView;
      wbChart.$view = view;
      tickStep = view.length <= 48 ? 3 : view.length <= 168 ? 6 : 12;
      const ext = view.findIndex((h) => h.ext);
      wbChart.$extStart = windChart.$extStart = ext < 0 ? null : ext;
      const labels = view.map((h) => h.fullLabel);
      const r = (v) => (v == null ? null : Math.round(v * 10) / 10);

      wbChart.data.labels = labels;
      wbChart.data.datasets[0].data = view.map((h) => r(h.wbF));
      wbChart.data.datasets[1].data = view.map((h) => r(h.tempF));
      wbChart.data.datasets[2].data = view.map((h) => r(h.dewF));
      wbChart.data.datasets[3].data = view.map((h) => r(h.rh));
      const temps = view.flatMap((h) => [h.tempF, h.dewF, h.wbF]).filter((v) => v != null);
      wbChart.options.scales.y.min = Math.floor((Math.min(...temps, 10) - 3) / 5) * 5;
      wbChart.options.scales.y.max = Math.ceil((Math.max(...temps, 35) + 3) / 5) * 5;

      const colors = { ok: css('--wind'), caution: css('--caution'), limit: css('--danger') };
      windChart.data.labels = labels;
      windChart.data.datasets[0].data = view.map((h) => r(h.gustMph));
      windChart.data.datasets[1].data = view.map((h) => r(h.windMph));
      windChart.data.datasets[1].backgroundColor = view.map((h) => colors[h.windFlag]);
      windChart.$view = view;
      windChart.$arrowStep = view.length <= 48 ? 2 : view.length <= 168 ? 3 : 4;

      wbChart.update();
      windChart.update();
      showReadout();
    }

    // A new selection (click, ← / → keys, strip, calendar, map slider) replaces any hover
    // in the readout, so arrow keys update it even while the mouse rests on the chart.
    function setCursor(i) {
      wbHover = null;
      wbChart.setActiveElements([]);
      wbChart.tooltip?.setActiveElements([], { x: 0, y: 0 });
      wbChart.$cursor = i;
      windChart.$cursor = i;
      wbChart.draw();
      windChart.draw();
      showReadout();
      keepInView(wbChart, i);
      keepInView(windChart, i);
    }

    // When a chart is wider than the screen (10d / 16d), scroll it so the selected hour stays visible.
    function keepInView(chart, i) {
      const box = chart.canvas.closest('.chart-scroll');
      if (!box || box.scrollWidth <= box.clientWidth || !chart.scales.x) return;
      const x = chart.scales.x.getPixelForValue(i);
      const pad = Math.min(80, box.clientWidth / 4);
      if (x < box.scrollLeft + pad) box.scrollLeft = x - pad;
      else if (x > box.scrollLeft + box.clientWidth - pad) box.scrollLeft = x - box.clientWidth + pad;
    }

    return { update, setCursor };
  }

  window.SnowCharts = { createCharts };
})();
