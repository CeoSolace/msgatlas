import Redis from 'ioredis';
import { config } from '../config';

/**
 * Starts a watchdog that periodically checks Redis memory usage and trims
 * anonymous chat buffers when usage exceeds configured limits.  The
 * watchdog never throws; in case of errors it logs a warning and
 * continues.
 */
export function startRedisWatchdog(redis: Redis): void {
  const intervalMs = config.redisWatchdogIntervalSeconds * 1000;
  /**
   * Use SCAN instead of KEYS to iterate over anon room keys without blocking
   * Redis.  The watchdog shortens TTLs when the soft limit is exceeded and
   * deletes rooms when the hard limit is exceeded.  It always exits early
   * once memory usage drops below the configured soft limit.
   */
  async function check() {
    try {
      const info = await redis.info('memory');
      const usedMemMatch = info.match(/used_memory:(\d+)/);
      if (!usedMemMatch) return;
      const used = parseInt(usedMemMatch[1], 10);
      const usedMb = used / (1024 * 1024);
      // Nothing to do if below soft limit
      if (usedMb < config.redisSoftLimitMb) {
        return;
      }
      // Iterate over anon:room:* keys using SCAN cursor
      let cursor = '0';
      const anonKeys: string[] = [];
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'anon:room:*', 'COUNT', 100);
        cursor = nextCursor;
        anonKeys.push(...keys);
        // Break early if too many keys collected to avoid memory blow up
        if (anonKeys.length > 1000) {
          break;
        }
      } while (cursor !== '0');
      if (usedMb > config.redisHardLimitMb) {
        // Hard limit exceeded: delete rooms until under soft limit
        for (const key of anonKeys) {
          await redis.del(key);
          const infoAfter = await redis.info('memory');
          const match = infoAfter.match(/used_memory:(\d+)/);
          if (!match) break;
          const newUsed = parseInt(match[1], 10) / (1024 * 1024);
          if (newUsed < config.redisSoftLimitMb) break;
        }
      } else {
        // Soft limit exceeded: shorten TTL on anon rooms to encourage eviction
        for (const key of anonKeys) {
          const ttl = await redis.ttl(key);
          if (ttl > 60) {
            await redis.expire(key, 60);
          }
        }
      }
    } catch (err) {
      console.warn('Redis watchdog error', err);
    }
  }
  setInterval(check, intervalMs).unref();
}