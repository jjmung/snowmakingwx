# SnowmakingWX

Hourly snowmaking forecast built on the free National Weather Service API (api.weather.gov). Static HTML/JS, with no build step and no API key.

## Features
- **Outlook strip**: one colored cell per hour, rated by wet bulb (Excellent ≤18°F, Good ≤22, Fair ≤25, Marginal ≤28). Hatched cells mean the wind is over the limit.
- **Charts**: wet bulb, temperature, dew point and RH, plus a wind chart (sustained, gusts, and arrows showing which way snow will drift).
- **Plume drift map**: satellite, topo or street map. Place fan or tower guns, then scrub or play through the hours to see estimated plume direction and reach.
- **Snowmaking windows**: continuous stretches of workable hours, with min wet bulb and average wind.
- **Locations**: Granite Peak is the default. "Save map center as location" adds a resort, or open a link like `?lat=44.926&lon=-89.684&name=My%20Hill`.

Wet bulb is computed psychrometrically from NWS temperature and humidity, corrected for the grid cell's elevation.
Thresholds, wind limits and gun parameters (throw, hang time) live in `js/config.js`.
Guns and saved locations are stored in the browser's localStorage, so each device has its own.

## Run locally
    python3 -m http.server 8000

Then open http://localhost:8000. To view it on your phone over the same Wi-Fi, open `http://<your-PC-IP>:8000`.

## Host it (free)
Push this folder to a GitHub repo and turn on GitHub Pages (or use Netlify or Cloudflare Pages). Every file is static.
