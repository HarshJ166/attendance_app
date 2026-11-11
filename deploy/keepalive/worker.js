// Keeps the Render free server awake during working hours: Render sleeps a service after 15 idle minutes.
// Cron (UTC) in wrangler.jsonc: every 10 min, 01:00–15:50 UTC = 06:30–21:20 IST. Free plan: well under 750 h/month.
//
// Waking a sleeping Render service takes 20–60 s. The fetch is awaited inside the handler (a cron run may take
// minutes of wall time; waiting costs no CPU) instead of ctx.waitUntil, which gave up before the wake finished.
const URL = 'https://geomark-api.onrender.com/health';

export default {
  async scheduled() {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const started = Date.now();
      try {
        const res = await fetch(URL, { headers: { 'user-agent': 'geomark-keepalive' }, signal: AbortSignal.timeout(90_000) });
        console.log(`attempt ${attempt}: HTTP ${res.status} in ${Date.now() - started} ms`);
        if (res.ok) return;
      } catch (e) {
        console.log(`attempt ${attempt}: ${e} after ${Date.now() - started} ms`);
      }
    }
  },
};
