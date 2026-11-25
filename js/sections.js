// Collapsible, reorderable page sections. Each <section data-sec="id"> gets, at the right end
// of its first .panel-head, a drag handle and a collapse button. Order and collapsed sections are saved
// in localStorage under `storageKey`, so each device keeps its own layout.
//
// Reorder: drag the ⠿ handle (mouse or touch), or focus it and press ↑ / ↓.
// Collapse: the ▾ button or a click on the section title.
(function () {
  function enhance({ storageKey, resetButton }) {
    const ls = {
      get(d) { try { const v = localStorage.getItem(storageKey); return v ? JSON.parse(v) : d; } catch { return d; } },
      set(v) { try { localStorage.setItem(storageKey, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    };
    const all = () => [...document.querySelectorAll('section[data-sec]')];
    const first = all()[0];
    if (!first) return;
    const parent = first.parentElement;
    const defaultOrder = all().map((s) => s.dataset.sec);
    const anchor = all().at(-1).nextElementSibling; // sections stay before whatever follows them (the footer)

    function save() {
      ls.set({ order: all().map((s) => s.dataset.sec), collapsed: all().filter((s) => s.classList.contains('collapsed')).map((s) => s.dataset.sec) });
    }
    function setCollapsed(sec, on) {
      const was = sec.classList.contains('collapsed');
      sec.classList.toggle('collapsed', on);
      const btn = sec.querySelector('.sec-toggle');
      btn.setAttribute('aria-expanded', !on);
      btn.title = on ? 'Expand section' : 'Collapse section';
      // Charts inside a section that was hidden need to measure themselves again
      if (was && !on) requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
    function applyOrder(order) {
      const byId = Object.fromEntries(all().map((s) => [s.dataset.sec, s]));
      // Saved order first, then any section added since the layout was saved, in page order
      const ids = [...order.filter((id) => byId[id]), ...defaultOrder.filter((id) => !order.includes(id))];
      for (const id of ids) parent.insertBefore(byId[id], anchor);
    }

    // ---------- controls ----------
    for (const sec of all()) {
      const head = sec.querySelector('.panel-head');
      const h2 = head.querySelector('h2');
      const title = h2.textContent;
      const grip = document.createElement('button');
      grip.type = 'button';
      grip.className = 'sec-grip';
      grip.textContent = '⠿';
      grip.setAttribute('aria-label', `Move section “${title}”. Use the up and down arrow keys, or drag.`);
      grip.title = 'Drag to move, or use ↑ / ↓';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'sec-toggle';
      toggle.innerHTML = '<span aria-hidden="true">▾</span>';
      toggle.setAttribute('aria-label', `Show or hide “${title}”`);
      // Controls sit at the right end of the title row, after any section tools
      const ctrl = document.createElement('div');
      ctrl.className = 'sec-ctrl';
      ctrl.append(grip, toggle);
      head.append(ctrl);
      head.classList.add('has-sec');
      h2.classList.add('sec-title');
      toggle.onclick = () => { setCollapsed(sec, !sec.classList.contains('collapsed')); save(); };
      h2.onclick = toggle.onclick;

      grip.onkeydown = (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const sib = e.key === 'ArrowUp' ? sec.previousElementSibling : sec.nextElementSibling;
        if (!sib || !sib.matches('section[data-sec]')) return;
        if (e.key === 'ArrowUp') parent.insertBefore(sec, sib); else parent.insertBefore(sib, sec);
        grip.focus();
        sec.scrollIntoView({ block: 'nearest' });
        save();
      };
      grip.onpointerdown = (e) => startDrag(e, sec, grip);
    }

    // ---------- drag (pointer events: mouse, touch and pen) ----------
    const marker = document.createElement('div');
    marker.className = 'sec-drop';
    let drag = null;
    function startDrag(e, sec, grip) {
      if (e.button !== 0) return;
      e.preventDefault();
      try { grip.setPointerCapture(e.pointerId); } catch { /* not a live pointer */ }
      drag = { sec, grip, target: null, before: true };
      sec.classList.add('dragging');
      document.body.classList.add('sec-dragging');
      grip.onpointermove = moveDrag;
      grip.onpointerup = grip.onpointercancel = endDrag;
    }
    function moveDrag(e) {
      if (!drag) return;
      // Scroll the page when dragging near the top or bottom edge
      const edge = 60;
      if (e.clientY < edge) window.scrollBy(0, -12);
      else if (e.clientY > innerHeight - edge) window.scrollBy(0, 12);
      const secs = all().filter((s) => s !== drag.sec);
      let target = null, before = true;
      for (const s of secs) {
        const r = s.getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { target = s; before = true; break; }
        target = s; before = false;
      }
      drag.target = target;
      drag.before = before;
      if (!target) { marker.remove(); return; }
      const r = target.getBoundingClientRect();
      const y = (before ? r.top - 8 : r.bottom + 8) + scrollY;
      Object.assign(marker.style, { top: `${y - 2}px`, left: `${r.left + scrollX}px`, width: `${r.width}px` });
      if (!marker.isConnected) document.body.append(marker);
    }
    function endDrag() {
      if (!drag) return;
      const { sec, grip, target, before } = drag;
      if (target) parent.insertBefore(sec, before ? target : target.nextElementSibling);
      sec.classList.remove('dragging');
      document.body.classList.remove('sec-dragging');
      marker.remove();
      grip.onpointermove = grip.onpointerup = grip.onpointercancel = null;
      drag = null;
      if (target) save();
    }

    // ---------- saved layout ----------
    const saved = ls.get(null);
    if (saved) {
      applyOrder(saved.order || []);
      for (const sec of all()) setCollapsed(sec, (saved.collapsed || []).includes(sec.dataset.sec));
    } else for (const sec of all()) setCollapsed(sec, false);

    if (resetButton) {
      resetButton.onclick = () => {
        try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
        applyOrder(defaultOrder);
        for (const sec of all()) setCollapsed(sec, false);
      };
    }
  }

  window.SnowSections = { enhance };
})();
