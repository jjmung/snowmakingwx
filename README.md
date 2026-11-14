# ❄ SnowmakingWX

**Hourly snowmaking forecast and climate history for any U.S. ski hill.**

Live site: **https://jjmung.github.io/snowmakingwx/**

SnowmakingWX turns the free National Weather Service forecast into the numbers a snowmaker actually uses: wet bulb by the hour, when the windows open and close, where the wind will carry the plume, and how this winter stacks up against the last 75. It is plain HTML and JavaScript, with no build step, no server and no API key.

Current version: **1.5** (November 13, 2026). See [CHANGELOG.md](CHANGELOG.md) for version notes.

---

## Contents
- [What it does](#what-it-does)
- [Forecast page](#forecast-page)
- [History page](#history-page)
- [How the numbers are calculated](#how-the-numbers-are-calculated)
- [Settings you can change](#settings-you-can-change)
- [Climate-history cache](#climate-history-cache)
- [Run it locally](#run-it-locally)
- [Host it and deploy changes](#host-it-and-deploy-changes)
- [Project layout](#project-layout)
- [Data sources and limits](#data-sources-and-limits)

---

## What it does

| Question | Where to look |
| --- | --- |
| Can we make snow tonight, and for how long? | Forecast page: outlook strip, summary cards, snowmaking windows |
| How cold is the wet bulb, hour by hour? | Forecast page: wet bulb, temperature & humidity chart |
| Where will the snow land with this wind? | Forecast page: plume drift map |
| How many hours does a normal season give us? | History page: snowmaking hours |
| Are our production months getting warmer? | History page: production-window trend |
| What happens here in El Niño and La Niña winters? | History page: snowfall by ENSO phase |

---

## Forecast page

`index.html`. Covers the next 48 hours, 72 hours or 7 days.

- **Summary cards.** Current wet bulb and rating, the next snowmaking window, total workable hours and the coldest wet bulb in the range.
- **Hourly outlook strip.** One colored cell per hour, rated by wet bulb. Hatched cells mean the wind is over the limit.

  | Rating | Wet bulb |
  | --- | --- |
  | Excellent | ≤ 18 °F |
  | Good | 18–22 °F |
  | Fair | 22–25 °F |
  | Marginal | 25–28 °F |
  | Too warm | > 28 °F |

- **Wet bulb, temperature & humidity chart.** Wet bulb, air temperature, dew point and relative humidity, over shaded rating bands. The dashed line is the go / no-go wet bulb limit.
- **Adjustable wet bulb limit.** A slider above the chart (with −/+ buttons and Reset) moves the go / no-go line anywhere from 15 to 35 °F. The default is 28 °F. The rating bands, outlook strip, snowmaking windows, hour counts and legend all follow the limit you set, and it is remembered on that device.
- **Wind chart.** Sustained wind and gusts with caution and limit lines. Arrows point the way snow will drift.
- **Plume drift map.** Satellite, topo or street map. Place fan or tower guns, then scrub or play through the hours to see the estimated plume direction and reach for each gun.
- **Snowmaking windows.** Each continuous stretch of workable hours, with its length, minimum wet bulb and average wind. An hourly table sits underneath.
- **Location search.** Type a resort, town, address or `lat, lon` in the header (U.S. only). The address bar updates so the link can be shared, and **☆ Save** adds the place to your list.
- **Saved locations.** Granite Peak (Wausau, WI) is the default. "Save map center as location" adds a place, or open a link like `?lat=44.926&lon=-89.684&name=My%20Hill`.

Keyboard: the left and right arrow keys step through the hours.

---

## History page

`history.html`, linked from the header. Works for the current location or any place worldwide that you search for.

- **Settings.** Snowmaking threshold (10–34 °F), temperature measure (daily low, mean or high), number of winters shown (20, 30, 50 or all) and the production window.
- **Production window.** Pick the part of the winter you actually make snow in. The default is **November 1 to February 1**, and any span from November 1 to May 1 can be chosen. The window drives:
  - the temperature trend (the trend tile and the first button in "How each month has changed"),
  - the nights-per-winter figure,
  - the whole snowmaking-hours analysis: average hours per winter, best and worst winter, the per-winter chart and its trend line.

  Temperature data for all of November through April stays on the page. Months outside the window are dimmed in the monthly bar charts.
- **A typical winter, month by month.** Average, coldest and warmest winter for each month against your threshold.
- **Nights cold enough to run.** Average days per month with a low at or below the threshold.
- **Every winter, every month.** A heat map of each winter since 1950, colored by distance from the threshold.
- **How each month has changed.** Trend per decade for the production window or any single month.
- **Snowmaking hours.** Hours with wet bulb at or below the threshold, from hourly temperature and humidity. Loaded on request because it is a larger download.
- **Daily temperature by winter.** A line chart of the average temperature for each day of one winter. Pick the winter from a dropdown (1950-51 onward, including the one in progress) and set the From and To dates with calendar pickers, anywhere from November 1 to May 1. The default is November 1 to February 1. A dashed line shows the average for the same days over the winters shown in Settings, and a summary gives the period average, coldest and warmest day, and days at or below the threshold.
- **Snowfall in El Niño and La Niña winters.** Seasonal snowfall by ENSO phase and strength, compared with the full-record or 1991–2020 mean.
- **Monthly summary table.**

---

## How the numbers are calculated

- **Forecast wet bulb.** Solved psychrometrically from NWS temperature and humidity, corrected for the pressure at the forecast grid cell's elevation.
- **History wet bulb.** Stull (2011) formula from hourly reanalysis temperature and humidity, at sea-level pressure.
- **Workable hour.** Wet bulb at or below the limit, and wind at or below 25 mph sustained and 35 mph in gusts.
- **Plume reach.** Throw distance plus wind speed × hang time. This is a rough estimate for aiming guns, not a dispersion model.
- **Production window.** Works in whole months, so "to February 1" means through January 31.
- **Complete winters only.** A winter counts in the history once all of November through April is in, so the current winter is excluded until it ends.
- **ENSO class.** From NOAA's Oceanic Niño Index. A winter is El Niño when the October–January readings stay at or above +0.5 and La Niña when they stay at or below −0.5; strength comes from the peak reading. NOAA's official list uses slightly different rules, so a few winters can differ.

---

## Settings you can change

**On the page** (saved in the browser, so each device keeps its own):

| Setting | Page | Default |
| --- | --- | --- |
| Wet bulb limit | Forecast | 28 °F |
| Forecast range | Forecast | 72 h |
| Saved locations and placed guns | Forecast | Granite Peak, no guns |
| Snowmaking threshold | History | 28 °F |
| Temperature measure | History | Daily low |
| Winters shown | History | 50 |
| Production window | History | Nov 1 – Feb 1 |
| Daily temperature date range | History | Nov 1 – Feb 1 |

**In `js/config.js`** (applies to everyone):

- built-in resorts and the default resort
- wet bulb rating zones and their colors
- wind caution and limit speeds
- gun types (throw distance and hang time)
- forecast refresh interval

---

## Climate-history cache

The History page uses the free Open-Meteo archive, which has rate limits, so results are cached in three layers:

1. **Repository cache** (`data/cache/<lat>_<lon>.json`, listed in `data/index.json`). Shipped with the site and tried first. `scripts/build-cache.mjs` builds a file for every place in `data/locations.json`, and the **Refresh climate cache** GitHub Action reruns it monthly and commits the result.
2. **Browser cache** (IndexedDB). Anything fetched live is kept on that device, including hourly wet bulb results.
3. **Live API.** Used only when neither cache has the place, or the cached copy is more than 60 days old. If the live call fails, the older copy is used.

Cache keys round coordinates to 0.01° (about 1 km), so nearby searches share a file. Place-search results are remembered for 30 days.

**Add a place to the repository cache**

- From GitHub: open **Actions → Refresh climate cache → Run workflow** and enter the latitude, longitude and name.
- Locally: `node scripts/build-cache.mjs <lat> <lon> "<name>"`, then commit `data/`.

The History page also has **Download cache file** and **Add to repository cache** buttons. They are hidden for now; the code is still in place.

---

## Run it locally

    python3 -m http.server 8000

Then open http://localhost:8000. To view it on a phone over the same Wi-Fi, open `http://<your-PC-IP>:8000`.

No install is needed. `scripts/build-cache.mjs` needs Node 18 or newer and has no dependencies.

---

## Host it and deploy changes

Every file is static, so any static host works (GitHub Pages, Netlify, Cloudflare Pages).

This repository deploys with GitHub Pages from the `main` branch:

1. Commit work on `dev` and push it.
2. Open a pull request from `dev` to `main` and merge it.
3. GitHub Pages rebuilds in about a minute. A hard refresh may be needed to see new scripts.

To roll back a release, revert its pull request on GitHub.

---

## Project layout

    index.html              Forecast page
    history.html            Climate history page
    css/styles.css          Shared styles
    css/history.css         History page styles
    js/config.js            Resorts, rating zones, wind limits, gun types
    js/weather.js           NWS forecast loader and wet bulb math
    js/charts.js            Forecast charts (Chart.js)
    js/map.js               Plume drift map (Leaflet)
    js/app.js               Forecast page logic
    js/history.js           History page logic
    js/climate-core.js      Wet bulb and binning rules shared by the page and the cache builder
    js/enso.js              ONI table and El Niño / La Niña classification
    scripts/build-cache.mjs Climate cache builder
    data/                   Repository climate cache
    .github/workflows/      Monthly cache refresh

Libraries are loaded from a CDN: Chart.js 4.4.1 and Leaflet 1.9.4.

---

## Data sources and limits

- **Forecast:** [National Weather Service API](https://www.weather.gov/documentation/services-web-api) gridpoint forecast. U.S. locations only, and the service has occasional outages.
- **History:** [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) (ERA5 / ERA5-Land reanalysis, 1950 onward). This is a gridded model of the location, not a weather station record, so it can run a few degrees off a nearby station. Modeled snowfall is only a rough guide.
- **ENSO:** NOAA Climate Prediction Center Oceanic Niño Index.
- **Place search:** OpenStreetMap Nominatim.
- **Map tiles:** Esri World Imagery, OpenStreetMap and OpenTopoMap.

SnowmakingWX is a planning aid. Check conditions on the hill before committing crews, water and power.
