// Sun position and sunrise / sunset, computed locally (no API).
// Low-precision solar formulas: altitude is good to well under a degree and
// sunrise / sunset to about a minute, which is plenty for a day / night guide.
(function () {
  const RAD = Math.PI / 180;

  // Sun altitude in degrees above the horizon at time t (ms) for lat / lon (degrees).
  function sunAltitude(t, lat, lon) {
    const d = t / 86400000 + 2440587.5 - 2451545.0; // days since J2000
    const g = (357.529 + 0.98560028 * d) * RAD; // mean anomaly
    const q = 280.459 + 0.98564736 * d; // mean longitude
    const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // ecliptic longitude
    const e = (23.439 - 0.00000036 * d) * RAD; // obliquity
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const gmst = (18.697374558 + 24.06570982441908 * d) % 24; // hours
    const ha = (gmst * 15 + lon) * RAD - ra; // local hour angle
    const la = lat * RAD;
    return Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) / RAD;
  }

  // Altitude of the sun's upper edge at sunrise / sunset, with refraction.
  const HORIZON = -0.833;

  // Sunrise and sunset times (ms) between t0 and t1, found by stepping 10 minutes
  // and bisecting each horizon crossing.
  function sunEvents(t0, t1, lat, lon) {
    const step = 10 * 60e3;
    const f = (t) => sunAltitude(t, lat, lon) - HORIZON;
    const out = [];
    let a = t0;
    let fa = f(a);
    for (let b = t0 + step; b <= t1; b += step) {
      const fb = f(b);
      if ((fa < 0) !== (fb < 0)) {
        let lo = a, hi = b, flo = fa;
        for (let k = 0; k < 20; k++) {
          const mid = (lo + hi) / 2;
          const fm = f(mid);
          if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
        }
        out.push({ t: (lo + hi) / 2, type: fa < 0 ? 'rise' : 'set' });
      }
      a = b;
      fa = fb;
    }
    return out;
  }

  window.SnowSun = { sunAltitude, sunEvents, HORIZON };
})();
