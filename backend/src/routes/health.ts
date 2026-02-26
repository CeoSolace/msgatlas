import { FastifyInstance, FastifyPluginOptions } from 'fastify';

/**
 * Expose a simple health check at /health.  Useful for Render or other
 * platforms to monitor container status.
 */
export async function healthRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  fastify.get('/health', async (_request, reply) => {
    reply.send({ status: 'ok', timestamp: Date.now() });
  });
}