# SnowmakingWX version notes

Newest first. Each version is live at https://jjmung.github.io/snowmakingwx/ once its pull request is merged to `main`.

---

## 1.4 — November 13, 2026

**History page: production window** ([PR #3](https://github.com/jjmung/snowmakingwx/pull/3))

Added
- **Production window picker** in the History settings. Choose the part of the winter you make snow in, anywhere from November 1 to May 1. The default is **November 1 to February 1**, and the choice is remembered on the device.

Changed
- The former "Nov–Apr trend" now covers the production window and is labelled with it, both in the trend tile and in "How each month has changed".
- **Snowmaking hours** are analyzed over the production window: average hours per winter, best winter, worst winter, the per-winter chart and its trend line. "Best month" is now the best month inside the window.
- "Nights with a low at or below the threshold" counts only the production window.
- Months outside the window are dimmed in the "Nights cold enough to run" and monthly snowmaking-hours charts.
- The **Download cache file** and **Add to repository cache** buttons are hidden for now. Their code is unchanged.

Unchanged
- Temperature data for all of November through April is still shown in the monthly profile, heat map, bar charts and summary table.

Notes
- The window works in whole months, so "to February 1" means through January 31.
- A winter still counts only once all of November through April is in.

---

## 1.3 — November 13, 2026

**Forecast page: adjustable wet bulb limit** ([PR #2](https://github.com/jjmung/snowmakingwx/pull/2))

Added
- **Wet bulb limit slider** above the wet bulb chart, with −/+ buttons and Reset. It moves the dashed go / no-go line from its 28 °F default to anywhere between 15 and 35 °F, in half-degree steps.

Changed
- The limit is the real go / no-go threshold, not only a drawn line. Rating bands, the outlook strip, snowmaking windows, hour-count cards and the legend all follow it. Colder rating zones keep their configured limits but never sit above the line.
- The limit is saved in the browser and applies to every location on that device.

---

## 1.2 — October 31, 2026

**Climate history** ([PR #1](https://github.com/jjmung/snowmakingwx/pull/1))

Added
- **History page** (`history.html`): winters back to 1950 for any location, against an adjustable snowmaking threshold. Includes the typical winter by month, nights cold enough to run, a winter-by-month heat map, per-month trends and a monthly summary table.
- **Snowmaking hours**: hours at or below the threshold by wet bulb, per month and per winter, loaded on request.
- **El Niño and La Niña snowfall**: seasonal snowfall by ENSO phase and strength, classed from NOAA's Oceanic Niño Index.
- **Climate cache**: repository cache files, a browser cache, a cache builder script and a monthly **Refresh climate cache** GitHub Action.

---

## 1.1 — October 12, 2026

**Location search**

Added
- Search for a resort, town, address or `lat, lon` from the header.
- Shareable links: the address bar carries the searched location.
- **☆ Save** adds a searched place to the saved list.

---

## 1.0 — October 11, 2026

**First release**

- Hourly snowmaking forecast from the National Weather Service gridpoint forecast, for 48 hours, 72 hours or 7 days.
- Wet bulb computed from temperature and humidity at the grid cell's elevation, with Excellent / Good / Fair / Marginal ratings.
- Hourly outlook strip, summary cards, wet bulb and wind charts, snowmaking windows and an hourly table.
- Plume drift map with placeable fan and tower guns and an hour-by-hour playback.
- Saved locations and guns stored in the browser.
