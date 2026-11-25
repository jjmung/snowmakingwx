// SnowmakingWX configuration. Edit thresholds and resorts here.
window.SNOWWX_CONFIG = {
  defaultResortId: 'granite-peak',

  // GitHub repo that holds the climate cache (data/cache) and the refresh workflow.
  repo: 'jjmung/snowmakingwx',

  // Built-in resorts, in dropdown order. Additional resorts can be saved from the map
  // ("Save map center as location"). `logo` is the resort's icon shown in the location dropdown.
  resorts: [
    { id: 'granite-peak', name: 'Granite Peak', region: 'Rib Mountain, WI', lat: 44.9260, lon: -89.6845, zoom: 16, logo: 'assets/logos/granite-peak.svg' },
    { id: 'lutsen', name: 'Lutsen Mountains', region: 'Lutsen, MN', lat: 47.6560, lon: -90.7251, zoom: 15, logo: 'assets/logos/lutsen.svg' },
    { id: 'snow-river', name: 'Snow River', region: 'Wakefield, MI', lat: 46.5022, lon: -89.9738, zoom: 15, logo: 'assets/logos/snow-river.svg' },
  ],

  // Wet bulb rating zones in °F. Each zone applies up to and including `max`.
  wetBulbZones: [
    { key: 'excellent', label: 'Excellent', max: 18, color: '#4dabf7' },
    { key: 'good', label: 'Good', max: 22, color: '#3bc9db' },
    { key: 'fair', label: 'Fair', max: 25, color: '#69db7c' },
    { key: 'marginal', label: 'Marginal', max: 26, color: '#ffd43b' },
    { key: 'none', label: 'Too warm', max: Infinity, color: '#495057' },
  ],

  // Zone colors used when "Color blind" is switched on in the top bar: a light-to-dark blue
  // ramp for the workable zones and amber for marginal, so zones differ by brightness as well as hue.
  colorBlind: {
    zones: { excellent: '#e7f5ff', good: '#74c0fc', fair: '#228be6', marginal: '#f08c00', none: '#495057' },
  },

  // Wind limits in mph. Above `limitMph` sustained (or `gustLimitMph` gusts) the hour is flagged as wind-limited.
  wind: { cautionMph: 15, limitMph: 25, gustLimitMph: 35 },

  // Simple plume model: drift length = throw + wind speed (m/s) × hang time (s).
  gunTypes: {
    fan: { label: 'Fan gun', throwM: 45, hangS: 14 },
    tower: { label: 'Tower / stick', throwM: 20, hangS: 18 },
  },

  cacheMinutes: 15,
};
