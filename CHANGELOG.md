# SnowmakingWX version notes

Newest first. Each version is live at https://jjmung.github.io/snowmakingwx/ once its pull request is merged to `main`.

---

## 1.9 — November 25, 2026

**Forecast page: layout, windows calendar, chart readout and day / night** ([PR #10](https://github.com/jjmung/snowmakingwx/pull/10))

Changed
- **Wet bulb limit** slider moved to the top of the page, above the summary cards. Its **default is now 26 °F** (was 28 °F), so Marginal covers 25–26 °F. If you have moved the slider before, your setting is kept.
- **Snowmaking windows** moved up, between the summary cards and the hourly outlook. The hourly table moved with it.
- **Plume drift map** is now collapsible and starts closed. Once you open or close it, the page remembers that. Clicking a window still opens the map at that hour.
- **Wet bulb, temperature & humidity chart**: the floating hover box is gone. The hovered or selected hour's time, wet bulb and rating, temperature, dew point and humidity show in a bar above the chart, in larger text, so the lines stay visible.
- **Arrow keys** on the 10d and 16d views now step through the hours instead of scrolling the wide charts sideways, and the charts scroll to keep the selected hour on screen. Arrow keys also update the chart's data bar while the mouse rests on the chart.

Added
- **Range picker** (48h to 16d) on the Snowmaking windows section, linked to the one on the hourly outlook.
- **Windows calendar**: one cell per forecast day, laid out by week. Each day shows its usable hours, a 24-hour bar colored by wet bulb rating, and a card per window with times, hours, coldest wet bulb and rating, and average wind. Windows crossing midnight are split across both days, marked → and ←. Click a card to open the map at that hour, or a bar segment to select that hour. On phones the days stack in a simple grid.
- **View dropdown** next to the Snowmaking windows heading, with icons: Calendar (the default), Calendar + cards, or Cards. The choice is remembered.
- **Day and night on the wet bulb chart**: a sky strip above the chart, colored by the sun's height hour by hour, with a sun or crescent moon that glides to the selected hour. The sun's height follows its real altitude. Night hours are shaded across the chart, and the data bar says Day or Night with the next sunset or sunrise.

Notes
- Sunrise, sunset and sun height are computed on the page from the location (`js/sun.js`), to within about a minute. The moon marks night only; its height and shape are not the real moon's position or phase.
- The sun and moon slide between hours; devices set to reduce motion move them without animation.
- The History page's snowmaking threshold still defaults to 28 °F.

---

## 1.8 — November 15, 2026

**Color blind mode** ([PR #8](https://github.com/jjmung/snowmakingwx/pull/8))

Added
- A **◐ Color blind** button in the top bar of the Forecast and History pages. It switches the page to colors that stay readable with red-green and blue-yellow color blindness. The page reloads in the new colors, the button stays highlighted, and the choice is remembered on the device.
- **Wet bulb zones** (strip, chips, legend, chart bands, plume) become a light-to-dark blue ramp for Excellent, Good and Fair, with amber for Marginal, so zones differ by brightness as well as color.
- **Wet bulb chart**: temperature in deep orange, dew point in dashed blue, humidity in dotted yellow, so the lines differ by pattern as well as color.
- **Wind chart**: blue, yellow and dark orange bars for ok, caution and limit, with a white gust line.
- **Wind-limited hours** on the strip use black-and-white stripes instead of red.
- **History page**: the threshold line turns yellow.

Changed
- Top bar buttons wrap onto a second line on narrow screens.

Notes
- One mode covers the common types of color blindness; there is no separate setting per type.
- The colors were checked with a color-blindness simulation and tested by several color blind users, who could read all the information. More testers are welcome.
- Gun markers, the History heat map and the El Niño / La Niña colors are unchanged; they already differ by shape or by a blue-versus-orange split.
- The zone colors for this mode can be edited in `js/config.js`.

---

## 1.7 — November 15, 2026

**Forecast page: 10- and 16-day outlook** ([PR #7](https://github.com/jjmung/snowmakingwx/pull/7))

Added
- **10d and 16d buttons** on the hourly outlook, next to 48h, 72h and 7d. The longer views feed the strip, both charts, the summary cards, the windows list, the hourly table and the plume map.
- Hours past the end of the National Weather Service forecast (about day 7) come from **Open-Meteo** global models, adjusted to the same elevation as the NWS grid. The NWS hours are unchanged.
- Markers where the extended range begins: a dashed line labelled "Extended range" on the charts, a dashed divider and italic day labels on the strip, an "extended range" tag on windows that run into those days, and a note under the strip.

Notes
- Hourly wet bulb two weeks out is a rough guide. Treat the extended days as a trend, not a schedule.
- The two sources do not agree exactly, so the lines can step where they meet.
- On the 10d and 16d views, "Snowmaking hours" and "Coldest wet bulb" include the extended days.
- If Open-Meteo cannot be reached, the page still shows the NWS forecast and says the extended outlook is unavailable.

---

## 1.6 — November 15, 2026

**Forecast page: observed conditions in the Now card** ([PR #6](https://github.com/jjmung/snowmakingwx/pull/6))

Changed
- The **Now** card shows real observed conditions from the nearest reporting National Weather Service station instead of the forecast for the current hour. Wet bulb, temperature, humidity and wind all come from the station report, and the label gives the time of the report.

Added
- The station name, ID and distance under the reading, as a **link to that station's observations on weather.gov**. The forecast wet bulb for the hour sits beside it for comparison.
- Observations reload every 5 minutes and with the Refresh button.
- If the nearest station has no report from the last 90 minutes, the next three closest are tried. If none are reporting, the card shows the forecast and says so.

Notes
- The station is usually an airport near the hill, not on it. For Granite Peak it is Wausau Downtown Airport, about 3 miles east at base elevation, so the summit can differ.
- Airport 5-minute reports round temperature to whole degrees Celsius, so the observed wet bulb can be off by about 1°F.
- The charts, outlook strip, windows and hourly table still use the forecast.

---

## 1.5 — November 13, 2026

**History page: daily temperature by winter** ([PR #5](https://github.com/jjmung/snowmakingwx/pull/5))

Added
- **Daily temperature by winter** panel, between Snowmaking hours and the El Niño section. A line chart of the average (mean) temperature for each day of one winter.
- **Winter dropdown** covering 1950-51 onward, newest first. The current winter is included and marked "(in progress)".
- **From / To calendar pickers**, limited to November 1 through May 1 of the chosen winter. The default is **November 1 to February 1**; "Reset dates" restores it, and the range is remembered on the device.
- A dashed comparison line: the average for the same calendar days over the winters shown in Settings.
- The snowmaking threshold line, and a summary sentence with the period average, the difference from the multi-winter average, the coldest and warmest day, and the number of days at or below the threshold.

Notes
- The date range on this chart is separate from the production window in Settings.

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
