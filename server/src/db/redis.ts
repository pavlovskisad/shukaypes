import Redis from 'ioredis';

const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const redis = new Redis(url, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

// Throttle error logging — a dead/unreachable host emits a connection error
// roughly every second, which floods the logs. Log the first one, then at
// most once a minute, so an outage is visible without drowning everything.
let lastErrLogAt = 0;
redis.on('error', (err) => {
  const now = Date.now();
  if (now - lastErrLogAt > 60_000) {
    lastErrLogAt = now;
    console.error('[redis]', err.message);
  }
});
