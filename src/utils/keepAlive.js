const https = require('https');

const PING_INTERVAL = 5 * 60 * 1000;

function ping(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      console.log(`[KeepAlive] Pinged ${url} — ${res.statusCode}`);
      resolve(true);
    }).on('error', (err) => {
      console.error(`[KeepAlive] Ping failed for ${url}:`, err.message);
      resolve(false);
    });
  });
}

function startKeepAlive() {
  const url = process.env.SELF_URL;
  if (!url) {
    console.warn('[KeepAlive] SELF_URL not set — skipping auto-ping');
    return;
  }
  console.log(`[KeepAlive] Starting — will ping ${url} every ${PING_INTERVAL / 60000} minutes`);
  ping(url);
  setInterval(() => ping(url), PING_INTERVAL);
}

module.exports = { startKeepAlive };
