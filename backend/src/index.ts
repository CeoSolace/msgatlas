import fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import http from 'http';
import Redis from 'ioredis';

import { config } from './config';
import { initCentralDb } from './db/central';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/user';
import { serverRoutes } from './routes/server';
import { mediaRoutes } from './routes/media';
import { healthRoutes } from './routes/health';
import { setupSocketIO } from './socket/index';
import { startRedisWatchdog } from './watchdog/redisWatchdog';

async function buildServer(): Promise<FastifyInstance> {
  const app = fastify({ logger: true });
  // Register cookie plugin (required for session ID cookie)
  await app.register(cookie, {
    secret: config.cookieSecret,
    parseOptions: {},
  });
  // Secure headers
  await app.register(helmet, { contentSecurityPolicy: false });
  // CORS – allow configured origins
  await app.register(cors, {
    origin: (_origin, cb) => {
      // Allow requests with no origin (like curl) or in allowed list
      if (!_origin || config.corsOrigins.includes(_origin)) {
        cb(null, true);
        return;
      }
      cb(new Error('Not allowed'), false);
    },
    credentials: true,
  });
  // Register routes
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(serverRoutes);
  await app.register(mediaRoutes);
  return app;
}

async function start() {
  try {
    // Initialise database
    await initCentralDb();
    const app = await buildServer();
    // Create Redis client for general usage (presence/watchdog)
    const redisClient = new Redis(config.redisUrl);
    redisClient.on('error', (err) => {
      app.log.error({ err }, 'Redis error');
    });
    // Start Redis watchdog
    startRedisWatchdog(redisClient);
    // Start HTTP server
    await app.listen({ port: config.port, host: '0.0.0.0' });
    const httpServer: http.Server = app.server;
    // Wait for fastify to be ready before attaching Socket.IO
    await app.ready();
    await setupSocketIO(httpServer, app);
    app.log.info(`Server listening on port ${config.port}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

start();