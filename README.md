# SnowmakingWX

Hourly snowmaking forecast built on the free National Weather Service API (api.weather.gov). Static HTML/JS, with no build step and no API key.

## Features
- **Outlook strip**: one colored cell per hour, rated by wet bulb (Excellent ≤18°F, Good ≤22, Fair ≤25, Marginal ≤28). Hatched cells mean the wind is over the limit.
- **Charts**: wet bulb, temperature, dew point and RH, plus a wind chart (sustained, gusts, and arrows showing which way snow will drift).
- **Plume drift map**: satellite, topo or street map. Place fan or tower guns, then scrub or play through the hours to see estimated plume direction and reach.
- **Snowmaking windows**: continuous stretches of workable hours, with min wet bulb and average wind.
- **Location search**: type a resort, town, address or `lat, lon` in the header (U.S. only; geocoding by OpenStreetMap Nominatim). The address bar updates so the link can be shared, and **☆ Save** adds the place to your list.
- **Locations**: Granite Peak is the default. "Save map center as location" adds a resort, or open a link like `?lat=44.926&lon=-89.684&name=My%20Hill`.

- **Climate history** (`history.html`, linked from the header): for the current or any searched location, 50+ winters of Nov–Apr temperature by month against an adjustable snowmaking threshold (typical winter, nights cold enough, winter-by-month heatmap, trends), optional wet-bulb snowmaking hours, and seasonal snowfall in El Niño and La Niña winters. Data comes live from the Open-Meteo ERA5 archive; ENSO winters are classed from NOAA ONI values in `js/enso.js`.

Wet bulb is computed psychrometrically from NWS temperature and humidity, corrected for the grid cell's elevation.
Thresholds, wind limits and gun parameters (throw, hang time) live in `js/config.js`.
Guns and saved locations are stored in the browser's localStorage, so each device has its own.

## Climate-history cache
The History page calls the free Open-Meteo archive, which has rate limits, so results are cached in layers:
1. **Repository cache** (`data/cache/<lat>_<lon>.json`, listed in `data/index.json`): shipped with the site and loaded first. Built by `scripts/build-cache.mjs` for every place in `data/locations.json`; the **Refresh climate cache** GitHub Action reruns it monthly and commits the result. To add a place, use the History page's **Add to repository cache** button (opens the workflow; enter the lat/lon/name it shows), or run `node scripts/build-cache.mjs <lat> <lon> "<name>"` and commit `data/`.
2. **Browser cache** (IndexedDB): anything fetched live is kept on that device, including hourly wet-bulb results. **Download cache file** saves a place's file so it can be dropped into `data/cache/`.
3. **Live API**: only when neither cache has the place (or the cache is over 60 days old; the older copy is used if the live call fails). Place-search results are also remembered for 30 days.
Cache keys round coordinates to 0.01°, so nearby searches share a file.

## Run locally
    python3 -m http.server 8000

Then open http://localhost:8000. To view it on your phone over the same Wi-Fi, open `http://<your-PC-IP>:8000`.

## Host it (free)
Push this folder to a GitHub repo and turn on GitHub Pages (or use Netlify or Cloudflare Pages). Every file is static.
