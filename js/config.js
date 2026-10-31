// SnowmakingWX configuration. Edit thresholds and resorts here.
window.SNOWWX_CONFIG = {
  defaultResortId: 'granite-peak',

  // GitHub repo that holds the climate cache (data/cache) and the refresh workflow.
  repo: 'jjmung/snowmakingwx',

  // Built-in resorts. Additional resorts can be saved from the map ("Save map center as resort").
  resorts: [
    { id: 'granite-peak', name: 'Granite Peak', region: 'Wausau, WI', lat: 44.9260, lon: -89.6845, zoom: 16 },
  ],

  // Wet bulb rating zones in °F. Each zone applies up to and including `max`.
  wetBulbZones: [
    { key: 'excellent', label: 'Excellent', max: 18, color: '#4dabf7' },
    { key: 'good', label: 'Good', max: 22, color: '#3bc9db' },
    { key: 'fair', label: 'Fair', max: 25, color: '#69db7c' },
    { key: 'marginal', label: 'Marginal', max: 28, color: '#ffd43b' },
    { key: 'none', label: 'Too warm', max: Infinity, color: '#495057' },
  ],

  // Wind limits in mph. Above `limitMph` sustained (or `gustLimitMph` gusts) the hour is flagged as wind-limited.
  wind: { cautionMph: 15, limitMph: 25, gustLimitMph: 35 },

  // Simple plume model: drift length = throw + wind speed (m/s) × hang time (s).
  gunTypes: {
    fan: { label: 'Fan gun', throwM: 45, hangS: 14 },
    tower: { label: 'Tower / stick', throwM: 20, hangS: 18 },
  },

  cacheMinutes: 15,
};
