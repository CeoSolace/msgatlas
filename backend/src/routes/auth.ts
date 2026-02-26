import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import argon2 from 'argon2';
import { UserModel, SessionModel } from '../db/central';
import { config } from '../config';

/**
 * Auth routes: registration, login, logout.  Sets an HTTP‑only cookie
 * containing the session ID on successful login/registration.
 */
export async function authRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // POST /api/auth/register
  fastify.post('/api/auth/register', async (request, reply) => {
    const bodySchema = z.object({
      email: z.string().email(),
      password: z.string().min(8),
      displayName: z.string().min(1).max(100),
      publicKey: z.string(),
      curve25519PublicKey: z.string(),
    });
    const body = bodySchema.parse(request.body);
    const existing = await UserModel.findOne({ email: body.email }).exec();
    if (existing) {
      reply.status(400).send({ error: 'Email already in use' });
      return;
    }
    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
    const user = await UserModel.create({
      email: body.email,
      passwordHash,
      displayName: body.displayName,
      publicKey: body.publicKey,
      curve25519PublicKey: body.curve25519PublicKey,
    });
    // Create session
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
    await SessionModel.create({ sessionId, userId: user._id, expiresAt });
    // Set cookie
    reply.setCookie('sessionId', sessionId, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
    reply.send({ success: true, userId: user._id.toString() });
  });

  // POST /api/auth/login
  fastify.post('/api/auth/login', async (request, reply) => {
    const bodySchema = z.object({
      email: z.string().email(),
      password: z.string(),
    });
    const body = bodySchema.parse(request.body);
    const user = await UserModel.findOne({ email: body.email }).exec();
    if (!user) {
      reply.status(401).send({ error: 'Invalid credentials' });
      return;
    }
    const ok = await argon2.verify(user.passwordHash, body.password);
    if (!ok) {
      reply.status(401).send({ error: 'Invalid credentials' });
      return;
    }
    // Create new session
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
    await SessionModel.create({ sessionId, userId: user._id, expiresAt });
    reply.setCookie('sessionId', sessionId, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
    reply.send({ success: true, userId: user._id.toString() });
  });

  // POST /api/auth/logout
  fastify.post('/api/auth/logout', async (request, reply) => {
    const { sessionId } = (request.cookies as { [key: string]: string }) || {};
    if (sessionId) {
      await SessionModel.deleteOne({ sessionId }).exec();
    }
    reply.clearCookie('sessionId', { path: '/' });
    reply.send({ success: true });
  });
}