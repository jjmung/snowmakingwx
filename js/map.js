// Leaflet map with snow gun markers and wind-driven plume drift cones.
(function () {
  const EARTH_R = 6371008.8;
  const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const dirText = (deg) => (deg == null ? '—' : DIRS[Math.round(deg / 22.5) % 16]);

  function destination(lat, lon, bearingDeg, distM) {
    const d = distM / EARTH_R;
    const th = (bearingDeg * Math.PI) / 180;
    const p1 = (lat * Math.PI) / 180;
    const l1 = (lon * Math.PI) / 180;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th));
    const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [(p2 * 180) / Math.PI, (l2 * 180) / Math.PI];
  }

  function cone(lat, lon, bearing, half, len, steps = 12) {
    const pts = [[lat, lon]];
    for (let i = 0; i <= steps; i++) pts.push(destination(lat, lon, bearing - half + (2 * half * i) / steps, len));
    return pts;
  }

  // Estimate plume geometry for one gun type in one forecast hour.
  function plumeGeometry(hour, gunType) {
    const wind = hour.windMph || 0;
    const gust = Math.max(hour.gustMph || 0, wind);
    const calm = wind < 2 || hour.windDir == null;
    const gustiness = wind > 0 ? (gust - wind) / Math.max(wind, 3) : 0;
    return {
      calm,
      bearing: ((hour.windDir ?? 0) + 180) % 360,
      length: gunType.throwM + wind * 0.44704 * gunType.hangS,
      gustLength: gunType.throwM + gust * 0.44704 * gunType.hangS,
      halfAngle: Math.min(40, 10 + gustiness * 30),
    };
  }

  function createSnowMap(el, cfg, { onGunsChanged }) {
    const map = L.map(el, { zoomControl: true });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    });
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    });
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: '&copy; OpenStreetMap contributors, SRTM | &copy; OpenTopoMap (CC-BY-SA)',
    });
    satellite.addTo(map);
    L.control.layers({ Satellite: satellite, Topo: topo, Streets: streets }, null, { position: 'topleft' }).addTo(map);
    L.control.scale({ imperial: true, metric: true }).addTo(map);

    const plumeLayer = L.layerGroup().addTo(map);
    const gunLayer = L.layerGroup().addTo(map);

    // Wind compass overlay
    const Compass = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const div = L.DomUtil.create('div', 'map-compass');
        L.DomEvent.disableClickPropagation(div);
        return div;
      },
    });
    const compass = new Compass().addTo(map);

    let guns = [];
    let resort = null;
    let hour = null;
    let zoneColor = '#4dabf7';
    let addMode = false;
    let addType = 'fan';

    map.on('click', (e) => {
      if (!addMode) return;
      const n = guns.length + 1;
      guns.push({ id: `g${Date.now()}`, name: `Gun ${n}`, type: addType, lat: e.latlng.lat, lon: e.latlng.lng });
      changed();
    });

    function changed() {
      onGunsChanged(guns);
      drawGuns();
      drawPlumes();
    }

    function gunPopup(gun) {
      const wrap = document.createElement('div');
      wrap.className = 'gun-popup';
      const name = document.createElement('input');
      name.value = gun.name;
      name.onchange = () => { gun.name = name.value; onGunsChanged(guns); };
      const type = document.createElement('select');
      for (const [k, t] of Object.entries(cfg.gunTypes)) type.add(new Option(t.label, k, false, k === gun.type));
      type.onchange = () => { gun.type = type.value; changed(); };
      const del = document.createElement('button');
      del.textContent = 'Remove gun';
      del.className = 'btn danger';
      del.onclick = () => { guns = guns.filter((g) => g !== gun); map.closePopup(); changed(); };
      wrap.append(name, type, del);
      return wrap;
    }

    function drawGuns() {
      gunLayer.clearLayers();
      for (const gun of guns) {
        const m = L.marker([gun.lat, gun.lon], {
          draggable: true,
          icon: L.divIcon({ className: `gun-icon gun-${gun.type}`, iconSize: [16, 16] }),
          title: gun.name,
        });
        m.on('dragend', () => {
          const p = m.getLatLng();
          gun.lat = p.lat;
          gun.lon = p.lng;
          onGunsChanged(guns);
          drawPlumes();
        });
        m.bindPopup(() => gunPopup(gun));
        m.addTo(gunLayer);
      }
    }

    function drawPlume(lat, lon, gunType, dashed) {
      const g = plumeGeometry(hour, gunType);
      const style = { color: zoneColor, weight: 2, fillColor: zoneColor, dashArray: dashed ? '4 4' : null, interactive: false };
      if (g.calm) {
        L.circle([lat, lon], { ...style, radius: gunType.throwM, fillOpacity: 0.3 }).addTo(plumeLayer);
        return;
      }
      L.polygon(cone(lat, lon, g.bearing, g.halfAngle * 1.25, g.gustLength), { ...style, weight: 1, fillOpacity: 0.18, dashArray: '3 5' }).addTo(plumeLayer);
      L.polygon(cone(lat, lon, g.bearing, g.halfAngle, g.length), { ...style, fillOpacity: 0.5 }).addTo(plumeLayer);
    }

    function drawPlumes() {
      plumeLayer.clearLayers();
      if (!hour) return;
      if (guns.length) {
        for (const gun of guns) drawPlume(gun.lat, gun.lon, cfg.gunTypes[gun.type] || cfg.gunTypes.fan, false);
      } else if (resort) {
        // Reference plume at the resort point until guns are placed
        drawPlume(resort.lat, resort.lon, cfg.gunTypes.fan, true);
        L.circleMarker([resort.lat, resort.lon], { radius: 4, color: '#fff', weight: 1, fillOpacity: 0.8 })
          .bindTooltip('Reference fan gun — add your own guns with “+ Add gun”')
          .addTo(plumeLayer);
      }
    }

    function drawCompass() {
      const div = compass.getContainer();
      if (!hour) { div.innerHTML = ''; return; }
      const calm = !hour.windMph || hour.windMph < 2 || hour.windDir == null;
      const rot = ((hour.windDir ?? 0) + 180) % 360;
      div.innerHTML = `
        <svg viewBox="-50 -50 100 100" width="84" height="84" aria-hidden="true">
          <circle r="44" fill="rgba(11,19,32,.75)" stroke="rgba(255,255,255,.35)"/>
          <text y="-32" text-anchor="middle" font-size="11" fill="#fff">N</text>
          <text y="40" text-anchor="middle" font-size="10" fill="#aab">S</text>
          <text x="36" y="4" text-anchor="middle" font-size="10" fill="#aab">E</text>
          <text x="-36" y="4" text-anchor="middle" font-size="10" fill="#aab">W</text>
          ${calm ? '<text y="5" text-anchor="middle" font-size="13" fill="#fff">calm</text>' : `
          <g transform="rotate(${rot})">
            <line y1="22" y2="-18" stroke="${zoneColor}" stroke-width="4" stroke-linecap="round"/>
            <path d="M0,-28 L-9,-14 L9,-14 Z" fill="${zoneColor}"/>
          </g>`}
        </svg>
        <div class="compass-label">${calm ? 'Calm' : `${dirText(hour.windDir)} ${Math.round(hour.windMph)}`}${!calm && hour.gustMph > hour.windMph + 2 ? `<span> G${Math.round(hour.gustMph)}</span>` : ''} mph</div>`;
    }

    return {
      map,
      setResort(r, savedGuns) {
        resort = r;
        guns = savedGuns || [];
        map.setView([r.lat, r.lon], r.zoom || 15);
        drawGuns();
        drawPlumes();
      },
      setHour(h, color) {
        hour = h;
        zoneColor = color;
        drawPlumes();
        drawCompass();
      },
      setAddMode(on, type) {
        addMode = on;
        if (type) addType = type;
        el.classList.toggle('adding', on);
      },
      setAddType(type) { addType = type; },
      center() { const c = map.getCenter(); return { lat: c.lat, lon: c.lng, zoom: map.getZoom() }; },
      invalidate() { map.invalidateSize(); },
    };
  }

  window.SnowMap = { createSnowMap, plumeGeometry, dirText };
})();
