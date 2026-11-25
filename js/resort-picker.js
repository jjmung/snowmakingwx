// Location dropdown with resort logos. A native <select> can't show images, so this keeps the
// page's <select id="resortSelect"> as the source of truth (hidden) and draws a button + list
// over it. Picking an item sets the select's value and fires its normal "change" event, so the
// page code that fills and reads the select works unchanged.
(function () {
  const PIN = '<svg class="rp-pin" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 15s5-4.6 5-8.5A5 5 0 0 0 3 6.5C3 10.4 8 15 8 15z"/><circle cx="8" cy="6.5" r="1.8"/></svg>';

  function enhance(select, logos) {
    const wrap = document.createElement('div');
    wrap.className = 'rp';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rp-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    const list = document.createElement('div');
    list.className = 'rp-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', select.getAttribute('aria-label') || 'Location');
    list.hidden = true;
    select.before(wrap);
    wrap.append(btn, list, select);
    select.hidden = true;
    select.tabIndex = -1;

    const icon = (value) => (logos[value] ? `<img class="rp-logo" src="${logos[value]}" alt="">` : PIN);
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

    function syncButton() {
      const o = select.selectedOptions[0];
      const label = o ? o.text : '';
      btn.innerHTML = `${o && o.value ? icon(o.value) : PIN}<span class="rp-label">${esc(label)}</span><span class="rp-caret" aria-hidden="true">▾</span>`;
      btn.setAttribute('aria-label', `${select.getAttribute('aria-label') || 'Location'}: ${label}`);
      btn.title = label;
    }

    function buildList() {
      list.innerHTML = [...select.options]
        .filter((o) => o.value) // a placeholder like "Saved locations…" stays on the button only
        .map((o) => `<button type="button" role="option" class="rp-opt" data-v="${esc(o.value)}" aria-selected="${o.selected}">${icon(o.value)}<span>${esc(o.text)}</span></button>`)
        .join('');
    }

    function open(on) {
      if (on) buildList();
      list.hidden = !on;
      btn.setAttribute('aria-expanded', on);
      if (on) (list.querySelector('[aria-selected="true"]') || list.querySelector('.rp-opt'))?.focus();
    }

    function choose(v) {
      open(false);
      btn.focus();
      if (v === select.value) return;
      select.value = v;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    btn.onclick = () => open(list.hidden);
    btn.onkeydown = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); open(true); }
    };
    list.onclick = (e) => { const b = e.target.closest('.rp-opt'); if (b) choose(b.dataset.v); };
    list.onkeydown = (e) => {
      const items = [...list.querySelectorAll('.rp-opt')];
      const k = items.indexOf(document.activeElement);
      const go = (n) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
      // Keep arrow keys here; the Forecast page uses ← / → to step hours.
      e.stopPropagation();
      if (e.key === 'ArrowDown') go(k + 1);
      else if (e.key === 'ArrowUp') go(k - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(items.length - 1);
      else if (e.key === 'Escape') { open(false); btn.focus(); }
      else if (e.key === 'Tab') open(false);
    };
    document.addEventListener('click', (e) => { if (!list.hidden && !wrap.contains(e.target)) open(false); });

    // Follow the page's own changes to the select: options added or removed, and value set in code.
    new MutationObserver(syncButton).observe(select, { childList: true, subtree: true, characterData: true });
    const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(select, 'value', {
      configurable: true,
      get() { return proto.get.call(this); },
      set(v) { proto.set.call(this, v); syncButton(); },
    });
    select.addEventListener('change', syncButton);
    syncButton();
  }

  window.SnowResortPicker = { enhance };
})();
