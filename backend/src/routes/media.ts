import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import { config } from '../config';
import { authPreHandler } from '../middleware/auth';
import { UserModel, ServerRegistryModel } from '../db/central';

/**
 * Compute a Cloudinary API signature.  Parameters must be sorted
 * alphabetically and concatenated as `key=value` pairs with `&`.
 */
function computeCloudinarySignature(params: Record<string, any>, apiSecret: string): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const toSign = sorted + apiSecret;
  return crypto.createHash('sha1').update(toSign).digest('hex');
}

export async function mediaRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // Signed upload endpoint
  fastify.post('/api/media/sign', { preHandler: authPreHandler }, async (request, reply) => {
    const bodySchema = z.object({
      folder: z.string().optional(),
      type: z.enum(['avatar', 'serverIcon', 'attachment']),
      serverId: z.string().optional(),
    });
    const body = bodySchema.parse(request.body);
    const timestamp = Math.floor(Date.now() / 1000);
    // Determine folder path
    let folder = config.cloudinary.folderBase;
    if (body.type === 'avatar') {
      folder += '/avatars';
    } else if (body.type === 'serverIcon') {
      folder += '/server-icons';
    } else {
      folder += '/attachments';
    }
    if (body.folder) {
      folder += `/${body.folder}`;
    }
    const params: Record<string, any> = {
      folder,
      timestamp,
    };
    const signature = computeCloudinarySignature(params, config.cloudinary.apiSecret);
    reply.send({
      cloudName: config.cloudinary.cloudName,
      apiKey: config.cloudinary.apiKey,
      timestamp,
      signature,
      folder,
    });
  });

  // Confirmation endpoint
  fastify.post('/api/media/confirm', { preHandler: authPreHandler }, async (request, reply) => {
    const bodySchema = z.object({
      type: z.enum(['avatar', 'serverIcon', 'attachment']),
      public_id: z.string(),
      secure_url: z.string().url(),
      bytes: z.number(),
      width: z.number().optional(),
      height: z.number().optional(),
      format: z.string().optional(),
      resource_type: z.string().optional(),
      serverId: z.string().optional(),
    });
    const body = bodySchema.parse(request.body);
    const { secure_url } = body;
    // Validate domain
    try {
      const url = new URL(secure_url);
      if (!url.hostname.includes('cloudinary.com')) {
        reply.status(400).send({ error: 'Invalid secure_url' });
        return;
      }
    } catch (err) {
      reply.status(400).send({ error: 'Invalid secure_url' });
      return;
    }
    // Check cloud name matches
    if (!secure_url.includes(config.cloudinary.cloudName)) {
      reply.status(400).send({ error: 'Cloudinary cloud name mismatch' });
      return;
    }
    const user = (request as any).user;
    if (body.type === 'avatar') {
      // Update user record
      await UserModel.updateOne(
        { _id: user._id },
        { avatarPublicId: body.public_id, avatarUrl: secure_url }
      ).exec();
    } else if (body.type === 'serverIcon') {
      if (!body.serverId) {
        reply.status(400).send({ error: 'serverId is required for serverIcon uploads' });
        return;
      }
      const server = await ServerRegistryModel.findById(body.serverId).exec();
      if (!server) {
        reply.status(404).send({ error: 'Server not found' });
        return;
      }
      // Only owner can update icon
      if (server.ownerId.toString() !== user._id.toString()) {
        reply.status(403).send({ error: 'Only the server owner can update the icon' });
        return;
      }
      server.iconPublicId = body.public_id;
      server.iconUrl = secure_url;
      await server.save();
    } else {
      // Attachments are stored as part of encrypted message payload on the client.  Optionally we could store metadata here.
      // For now we simply acknowledge.
    }
    reply.send({ success: true });
  });
}