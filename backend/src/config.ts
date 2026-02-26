import dotenv from 'dotenv';
import crypto from 'crypto';

// Load environment variables from .env if present
dotenv.config();

/**
 * Helper to generate a random secret.  In development, if a required
 * secret is missing we will auto‑generate one and print a warning.  In
 * production the application aborts unless EPHEMERAL_SECRETS_IN_PROD=1.
 */
function generateSecret(name: string): string {
  const bytes = crypto.randomBytes(32);
  const secret = bytes.toString('hex');
  console.warn(`⚠️  [dev] Generated missing secret for ${name}.  Do not rely on this secret in production.`);
  return secret;
}

const env = process.env;

// Determine environment
const isProd = env.NODE_ENV === 'production';

// Secrets – auto‑generate in development if missing
let cookieSecret = env.COOKIE_SECRET;
let kmsMasterKey = env.KMS_MASTER_KEY;
let sodiumServerPepper = env.SODIUM_SERVER_PEPPER;

if (!cookieSecret || !kmsMasterKey || !sodiumServerPepper) {
  if (!isProd || env.EPHEMERAL_SECRETS_IN_PROD === '1') {
    cookieSecret = cookieSecret || generateSecret('COOKIE_SECRET');
    kmsMasterKey = kmsMasterKey || generateSecret('KMS_MASTER_KEY');
    sodiumServerPepper = sodiumServerPepper || generateSecret('SODIUM_SERVER_PEPPER');
  } else {
    throw new Error('Required secrets are missing in production.  Set COOKIE_SECRET, KMS_MASTER_KEY and SODIUM_SERVER_PEPPER.');
  }
}

export interface AppConfig {
  port: number;
  nodeEnv: string;
  mongoUri: string;
  redisUrl: string;
  cookieSecret: string;
  kmsMasterKey: string;
  sodiumServerPepper: string;
  corsOrigins: string[];
  sessionTtlDays: number;
  dmTtlHours: number;
  anonRoomTtlHours: number;
  anonBufferSize: number;
  redisSoftLimitMb: number;
  redisHardLimitMb: number;
  redisMaxMb: number;
  redisWatchdogIntervalSeconds: number;
  socketIoWebsocketOnly: boolean;
  rateLimitEnabled: boolean;
  cloudinary: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
    folderBase: string;
    maxUploadBytes: number;
  };
}

// Parse comma separated CORS origins
const corsOrigin = env.CORS_ORIGIN || '';
const corsOrigins = corsOrigin
  .split(',')
  .map((o) => o.trim())
  .filter((o) => !!o);

export const config: AppConfig = {
  port: Number(env.PORT || 3000),
  nodeEnv: env.NODE_ENV || 'development',
  mongoUri: env.MONGO_URI || '',
  redisUrl: env.REDIS_URL || '',
  cookieSecret: cookieSecret!,
  kmsMasterKey: kmsMasterKey!,
  sodiumServerPepper: sodiumServerPepper!,
  corsOrigins,
  sessionTtlDays: Number(env.SESSION_TTL_DAYS || 30),
  dmTtlHours: Number(env.DM_TTL_HOURS || 24),
  anonRoomTtlHours: Number(env.ANON_ROOM_TTL_HOURS || 5),
  anonBufferSize: Number(env.ANON_BUFFER_SIZE || 20),
  redisSoftLimitMb: Number(env.REDIS_SOFT_LIMIT_MB || 20),
  redisHardLimitMb: Number(env.REDIS_HARD_LIMIT_MB || 23),
  redisMaxMb: Number(env.REDIS_MAX_MB || 23.4),
  redisWatchdogIntervalSeconds: Number(env.REDIS_WATCHDOG_INTERVAL_SECONDS || 30),
  socketIoWebsocketOnly: env.SOCKETIO_WEBSOCKET_ONLY === '1',
  rateLimitEnabled: env.RATE_LIMIT_ENABLED !== '0',
  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: env.CLOUDINARY_API_KEY || '',
    apiSecret: env.CLOUDINARY_API_SECRET || '',
    folderBase: env.CLOUDINARY_FOLDER_BASE || 'app',
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024),
  },
};