import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { authPreHandler } from '../middleware/auth';
import { UserModel, ServerMembershipModel, ServerRegistryModel } from '../db/central';

/**
 * User routes: fetch profile, public keys, membership information.
 */
export async function userRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // GET /api/me – return current user profile and server memberships
  fastify.get('/api/me', { preHandler: authPreHandler }, async (request, reply) => {
    const user = (request as any).user;
    // Query memberships
    const memberships = await ServerMembershipModel.find({ userId: user._id }).exec();
    const serverIds = memberships.map((m) => m.serverId);
    const servers = await ServerRegistryModel.find({ _id: { $in: serverIds } }).exec();
    const serverList = servers.map((srv) => ({ id: srv._id.toString(), name: srv.name, iconUrl: srv.iconUrl || null }));
    reply.send({
      id: user._id.toString(),
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl || null,
      publicKey: user.publicKey,
      curve25519PublicKey: user.curve25519PublicKey,
      servers: serverList,
    });
  });

  // GET /api/users/:id/public-keys – fetch a user's public keys
  fastify.get('/api/users/:id/public-keys', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = await UserModel.findById(id).exec();
    if (!user) {
      reply.status(404).send({ error: 'User not found' });
      return;
    }
    reply.send({
      id: user._id.toString(),
      publicKey: user.publicKey,
      curve25519PublicKey: user.curve25519PublicKey,
      avatarUrl: user.avatarUrl || null,
      displayName: user.displayName,
    });
  });
}