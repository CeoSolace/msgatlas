import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { authPreHandler } from '../middleware/auth';
import { ServerRegistryModel, ServerMembershipModel, UserModel } from '../db/central';
import { encryptString } from '../utils/cryptoUtil';
import { getServerConnection } from '../db/serverPool';

/**
 * Server and channel management routes.
 */
export async function serverRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // POST /api/server/create – create a new server backed by an external MongoDB
  fastify.post('/api/server/create', { preHandler: authPreHandler }, async (request, reply) => {
    const bodySchema = z.object({
      name: z.string().min(1).max(100),
      externalMongoUri: z.string(),
    });
    const body = bodySchema.parse(request.body);
    // Encrypt external URI after validation
    // getServerConnection will validate.  We'll call decryptString later when connecting.
    const encryptedUri = await encryptString(body.externalMongoUri);
    const owner = (request as any).user;
    const server = await ServerRegistryModel.create({
      name: body.name,
      ownerId: owner._id,
      encryptedMongoUri: encryptedUri,
    });
    // Add membership for owner
    await ServerMembershipModel.create({ serverId: server._id, userId: owner._id, role: 'owner' });
    reply.send({ success: true, id: server._id.toString() });
  });

  // GET /api/server/list – list servers the user belongs to
  fastify.get('/api/server/list', { preHandler: authPreHandler }, async (request, reply) => {
    const user = (request as any).user;
    const memberships = await ServerMembershipModel.find({ userId: user._id }).exec();
    const serverIds = memberships.map((m) => m.serverId);
    const servers = await ServerRegistryModel.find({ _id: { $in: serverIds } }).exec();
    const list = servers.map((srv) => ({ id: srv._id.toString(), name: srv.name, iconUrl: srv.iconUrl || null }));
    reply.send({ servers: list });
  });

  // GET /api/server/:id/channels – list channels in a server (requires membership)
  fastify.get('/api/server/:id/channels', { preHandler: authPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user;
    const membership = await ServerMembershipModel.findOne({ serverId: id, userId: user._id }).exec();
    if (!membership) {
      reply.status(403).send({ error: 'Not a member of this server' });
      return;
    }
    const server = await ServerRegistryModel.findById(id).exec();
    if (!server) {
      reply.status(404).send({ error: 'Server not found' });
      return;
    }
    // Connect to per‑server DB and fetch channels
    const conn = await getServerConnection(server._id.toString(), server.encryptedMongoUri);
    // Define Channel model on this connection if not existing
    const channelSchema = new conn.Schema({
      name: { type: String, required: true },
      createdAt: { type: Date, default: () => new Date() },
    });
    const Channel = conn.models.Channel || conn.model('Channel', channelSchema);
    const channels = await Channel.find({}).exec();
    reply.send({ channels: channels.map((c: any) => ({ id: c._id.toString(), name: c.name })) });
  });

  // GET /api/server/:id/members – list members with public keys (requires membership)
  fastify.get('/api/server/:id/members', { preHandler: authPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user;
    const membership = await ServerMembershipModel.findOne({ serverId: id, userId: user._id }).exec();
    if (!membership) {
      reply.status(403).send({ error: 'Not a member of this server' });
      return;
    }
    const memberships = await ServerMembershipModel.find({ serverId: id }).exec();
    const userIds = memberships.map((m) => m.userId);
    const users = await UserModel.find({ _id: { $in: userIds } }).exec();
    const result = users.map((u) => ({
      id: u._id.toString(),
      displayName: u.displayName,
      curve25519PublicKey: u.curve25519PublicKey,
    }));
    reply.send({ members: result });
  });

  // POST /api/server/:id/join – join a server by ID.  Requires authentication.
  fastify.post('/api/server/:id/join', { preHandler: authPreHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user;
    // Check server exists
    const server = await ServerRegistryModel.findById(id).exec();
    if (!server) {
      reply.status(404).send({ error: 'Server not found' });
      return;
    }
    // Check existing membership
    const existing = await ServerMembershipModel.findOne({ serverId: id, userId: user._id }).exec();
    if (existing) {
      reply.send({ joined: true });
      return;
    }
    // Create membership with role member
    await ServerMembershipModel.create({ serverId: id, userId: user._id, role: 'member' });
    reply.send({ joined: true });
  });
}