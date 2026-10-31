#!/usr/bin/env node
// Builds climate cache files for SnowmakingWX so the History page does not have to call Open-Meteo
// for every visitor. Output: data/cache/<lat>_<lon>.json and data/index.json.
//
//   node scripts/build-cache.mjs                        refresh every place in data/locations.json
//   node scripts/build-cache.mjs 44.926 -89.684 "Granite Peak"   add one place (also saved to locations.json)
//   node scripts/build-cache.mjs --force                ignore the 30-day freshness check
//
// Needs Node 18+ (global fetch). No dependencies. Set OPENMETEO_ARCHIVE to point at a different base URL.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = createRequire(import.meta.url)(join(root, 'js', 'climate-core.js'));
const BASE = process.env.OPENMETEO_ARCHIVE || 'https://archive-api.open-meteo.com/v1/archive';
const START = '1950-01-01';
const PAUSE_MS = +(process.env.CACHE_PAUSE_MS || 1500);
const FRESH_DAYS = 30;

const args = process.argv.slice(2);
const force = args.includes('--force');
const pos = args.filter((a) => !a.startsWith('--'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const locFile = join(root, 'data', 'locations.json');
const idxFile = join(root, 'data', 'index.json');
mkdirSync(join(root, 'data', 'cache'), { recursive: true });

async function api(lat, lon, params) {
  const url = `${BASE}?${new URLSearchParams({ latitude: lat.toFixed(2), longitude: lon.toFixed(2), timezone: 'auto', ...params })}`;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(url);
    if (res.ok) { await sleep(PAUSE_MS); return res.json(); }
    const body = await res.text().catch(() => '');
    if (res.status === 429 || res.status >= 500) {
      const wait = 30000 * attempt;
      console.warn(`  ${res.status} from the API (${body.slice(0, 120)}); waiting ${wait / 1000}s (attempt ${attempt}/6)`);
      await sleep(wait);
      continue;
    }
    throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
  }
  throw new Error('API kept rate-limiting; try again later');
}

async function buildOne(loc) {
  const lat = core.roundCoord(loc.lat), lon = core.roundCoord(loc.lon);
  const key = core.cacheKey(lat, lon);
  const file = join(root, 'data', 'cache', `${key}.json`);
  const old = readJson(file, null);
  if (old && !force && Date.now() - Date.parse(old.fetched) < FRESH_DAYS * 864e5) {
    console.log(`${loc.name} (${key}): cache is fresh (${old.fetched.slice(0, 10)}), skipping`);
    return old;
  }
  console.log(`${loc.name} (${key}): fetching daily data…`);
  const end = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const j = await api(lat, lon, {
    start_date: START, end_date: end, temperature_unit: 'fahrenheit', precipitation_unit: 'inch',
    daily: 'temperature_2m_max,temperature_2m_min,temperature_2m_mean,snowfall_sum',
  });
  const d = j.daily;
  let last = d.time.length - 1;
  while (last > 0 && d.temperature_2m_min[last] == null) last--;
  const n = last + 1;
  const through = d.time[last];
  const cut = (a, f) => a.slice(0, n).map(f);

  // Winters (Nov y .. Apr y+1) that are fully inside the data
  const winters = [];
  for (let y = +START.slice(0, 4); `${y + 1}-04-30` <= through; y++) winters.push(y);
  const want = new Set(winters);
  const bins = {};
  const lastYear = +through.slice(0, 4);
  for (let a = winters[0]; a <= lastYear; a += 5) {
    const b = Math.min(a + 4, lastYear);
    console.log(`  hourly ${a}-${b}`);
    const h = await api(lat, lon, {
      start_date: `${a}-01-01`, end_date: b === lastYear ? through : `${b}-12-31`,
      hourly: 'temperature_2m,relative_humidity_2m',
    });
    core.addHourly(bins, h.hourly, want);
  }
  const payload = {
    v: core.CACHE_VERSION, key, name: loc.name, lat, lon,
    fetched: new Date().toISOString(), through, elevation: j.elevation ?? null,
    daily: {
      start: d.time[0],
      min: cut(d.temperature_2m_min, core.r1), max: cut(d.temperature_2m_max, core.r1),
      mean: cut(d.temperature_2m_mean, core.r1), snow: cut(d.snowfall_sum, core.r2),
    },
    bins,
  };
  writeFileSync(file, JSON.stringify(payload));
  console.log(`  wrote ${file} (${(JSON.stringify(payload).length / 1e6).toFixed(2)} MB, data through ${through})`);
  return payload;
}

const locs = readJson(locFile, { locations: [] });
if (pos.length >= 2) {
  const lat = +pos[0], lon = +pos[1];
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    console.error('Usage: node scripts/build-cache.mjs <lat> <lon> [name]'); process.exit(1);
  }
  const key = core.cacheKey(lat, lon);
  if (!locs.locations.some((l) => core.cacheKey(l.lat, l.lon) === key)) {
    locs.locations.push({ name: pos[2] || key.replace('_', ', '), lat: core.roundCoord(lat), lon: core.roundCoord(lon) });
    writeFileSync(locFile, JSON.stringify(locs, null, 2) + '\n');
  }
}

const index = { locations: [] };
let failed = 0;
for (const loc of locs.locations) {
  try {
    const p = await buildOne(loc);
    index.locations.push({ key: p.key, name: loc.name, lat: p.lat, lon: p.lon, through: p.through, fetched: p.fetched });
  } catch (err) {
    failed++;
    console.error(`${loc.name}: ${err.message}`);
    // keep the previous index entry (and its file) if there was one
    const prev = readJson(idxFile, { locations: [] }).locations.find((l) => l.key === core.cacheKey(loc.lat, loc.lon));
    if (prev) index.locations.push(prev);
  }
}
writeFileSync(idxFile, JSON.stringify(index, null, 2) + '\n');
console.log(`Done: ${index.locations.length} cached, ${failed} failed.`);
process.exit(failed && !index.locations.length ? 1 : 0);
