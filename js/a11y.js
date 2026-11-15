// Color blind mode: swaps in a palette that stays readable with red-green and blue-yellow
// color blindness. The choice is remembered on the device; toggling reloads the page so every
// chart, map and legend is drawn in the new colors.
(function () {
  const KEY = 'snowwx.colorBlind';
  const CFG = window.SNOWWX_CONFIG;
  let on = false;
  try { on = localStorage.getItem(KEY) === '1'; } catch { /* storage unavailable */ }

  if (on) {
    document.documentElement.dataset.cb = '1'; // switches the CSS color variables
    const zones = (CFG.colorBlind && CFG.colorBlind.zones) || {};
    for (const z of CFG.wetBulbZones) if (zones[z.key]) z.color = zones[z.key];
  }
  window.SnowA11y = { colorBlind: on };

  const btn = document.getElementById('cbBtn');
  if (!btn) return;
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on ? 'Color blind friendly colors are on. Click to switch back.' : 'Switch to color blind friendly colors';
  btn.onclick = () => {
    try { localStorage.setItem(KEY, on ? '0' : '1'); } catch { return; }
    location.reload();
  };
})();
