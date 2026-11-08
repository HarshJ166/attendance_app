// Keeps the Render free server awake during working hours: Render sleeps a service after 15 idle minutes.
// Cron (UTC) in wrangler.jsonc: every 10 min, 01:00–15:50 UTC = 06:30–21:20 IST. Free plan: well under 750 h/month.
export default {
  async scheduled(_event, _env, ctx) {
    ctx.waitUntil(fetch('https://geomark-api.onrender.com/health', { headers: { 'user-agent': 'geomark-keepalive' } }));
  },
};
