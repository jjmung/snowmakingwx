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

    const wbChart = new Chart(wbCanvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'Wet bulb °F', data: [], borderColor: css('--wb'), backgroundColor: css('--wb'), borderWidth: 3, pointRadius: 0, tension: 0.3, yAxisID: 'y' },
          { label: 'Temp °F', data: [], borderColor: css('--temp'), backgroundColor: css('--temp'), borderWidth: 1.5, pointRadius: 0, tension: 0.3, yAxisID: 'y' },
          { label: 'Dew point °F', data: [], borderColor: css('--dew'), backgroundColor: css('--dew'), borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, tension: 0.3, yAxisID: 'y' },
          { label: 'Humidity %', data: [], borderColor: css('--rh'), backgroundColor: hexA(css('--rh'), 0.08), fill: true, borderWidth: 1, pointRadius: 0, tension: 0.3, yAxisID: 'rh' },
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
          tooltip: { ...tooltip, callbacks: { ...tooltip.callbacks, label: (c) => `${c.dataset.label}: ${Math.round(c.parsed.y)}` } },
        },
      },
      plugins: [zoneBandsPlugin(cfg.wetBulbZones), cursorPlugin],
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
      plugins: [windLimitsPlugin(cfg.wind), windArrowsPlugin, cursorPlugin],
    });

    function update(newView) {
      view = newView;
      tickStep = view.length <= 48 ? 3 : 6;
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
      windChart.$arrowStep = view.length <= 48 ? 2 : 3;

      wbChart.update();
      windChart.update();
    }

    function setCursor(i) {
      wbChart.$cursor = i;
      windChart.$cursor = i;
      wbChart.draw();
      windChart.draw();
    }

    return { update, setCursor };
  }

  window.SnowCharts = { createCharts };
})();
