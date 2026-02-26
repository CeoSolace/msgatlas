import type { FastifyInstance } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import http from 'http';
import { config } from '../config';
import { SessionModel, DMMessageModel, ServerRegistryModel, ServerMembershipModel } from '../db/central';
import { getServerConnection } from '../db/serverPool';
import { ObjectId } from 'mongoose';
import crypto from 'crypto';

interface SocketData {
  userId: string;
}

/**
 * Parse a cookie header into an object.  Does not decode URI components.
 */
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [k, v] = pair.trim().split('=');
    if (k) result[k] = v || '';
  }
  return result;
}

export async function setupSocketIO(
  server: http.Server,
  fastify: FastifyInstance
): Promise<SocketIOServer> {
  const pubClient = new Redis(config.redisUrl, { lazyConnect: true });
  const subClient = pubClient.duplicate();
  await pubClient.connect();
  await subClient.connect();
  const io = new SocketIOServer(server, {
    cors: {
      origin: config.corsOrigins,
      credentials: true,
    },
    transports: config.socketIoWebsocketOnly ? ['websocket'] : ['polling', 'websocket'],
  });
  io.adapter(createAdapter(pubClient, subClient));
  // Middleware: authenticate socket connection
  io.use(async (socket, next) => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      const sessionId = cookies['sessionId'];
      if (!sessionId) return next(new Error('unauthenticated'));
      const session = await SessionModel.findOne({ sessionId }).exec();
      if (!session) return next(new Error('unauthenticated'));
      if (session.expiresAt.getTime() < Date.now()) {
        await SessionModel.deleteOne({ _id: session._id });
        return next(new Error('session expired'));
      }
      socket.data = socket.data || {};
      (socket.data as SocketData).userId = session.userId.toString();
      // join personal room
      socket.join((socket.data as SocketData).userId);
      return next();
    } catch (err) {
      return next(new Error('unauthenticated'));
    }
  });
  // On connection
  io.on('connection', (socket) => {
    const userId = (socket.data as SocketData).userId;
    // Presence key: presence:user:<id>
    const presenceKey = `presence:user:${userId}`;
    const setPresence = async () => {
      await pubClient.set(presenceKey, '1', 'EX', 60);
    };
    setPresence().catch(() => {});
    const presenceInterval = setInterval(setPresence, 30 * 1000);
    // DM send
    socket.on('dm:send', async (payload: any, ack?: (response: any) => void) => {
      try {
        const schema = {
          toUserId: '',
          ciphertext: '',
          nonce: '',
          attachment: undefined,
        };
        const { toUserId, ciphertext, nonce, attachment } = payload;
        if (!toUserId || !ciphertext || !nonce) return;
        const newMsg = await DMMessageModel.create({
          fromUserId: new ObjectId(userId),
          toUserId: new ObjectId(toUserId),
          ciphertext: Buffer.from(ciphertext, 'base64'),
          nonce: Buffer.from(nonce, 'base64'),
          attachment,
          ackBySender: true,
        });
        const messagePayload = {
          id: newMsg._id.toString(),
          fromUserId: userId,
          toUserId,
          ciphertext,
          nonce,
          attachment,
          createdAt: newMsg.createdAt,
        };
        // Send to recipient and back to sender
        io.to(toUserId).emit('dm:receive', messagePayload);
        socket.emit('dm:sent', messagePayload);
        if (ack) ack({ success: true, id: newMsg._id.toString() });
      } catch (err) {
        if (ack) ack({ error: 'failed to send' });
      }
    });
    // DM ack
    socket.on('dm:ack', async (payload: any) => {
      try {
        const { id } = payload || {};
        if (!id) return;
        const msg = await DMMessageModel.findById(id).exec();
        if (!msg) return;
        if (msg.fromUserId.toString() === userId) msg.ackBySender = true;
        if (msg.toUserId.toString() === userId) msg.ackByRecipient = true;
        if (msg.ackBySender && msg.ackByRecipient) {
          await DMMessageModel.deleteOne({ _id: id }).exec();
        } else {
          await msg.save();
        }
      } catch (err) {
        // ignore errors
      }
    });
    // Server join
    socket.on('server:join', async (payload: any, ack?: (response: any) => void) => {
      try {
        const { serverId, channelId } = payload || {};
        if (!serverId) return;
        // verify membership
        const membership = await ServerMembershipModel.findOne({ serverId, userId }).exec();
        if (!membership) {
          ack && ack({ error: 'not a member' });
          return;
        }
        const room = `channel:${serverId}:${channelId || 'general'}`;
        socket.join(room);
        ack && ack({ success: true });
      } catch (err) {
        ack && ack({ error: 'join failed' });
      }
    });
    // Server message
    socket.on('server:send', async (payload: any, ack?: (response: any) => void) => {
      try {
        const { serverId, channelId, ciphertext, nonce, attachment } = payload || {};
        if (!serverId || !channelId || !ciphertext || !nonce) return;
        // verify membership
        const membership = await ServerMembershipModel.findOne({ serverId, userId }).exec();
        if (!membership) {
          ack && ack({ error: 'not a member' });
          return;
        }
        const server = await ServerRegistryModel.findById(serverId).exec();
        if (!server) {
          ack && ack({ error: 'server not found' });
          return;
        }
        const conn = await getServerConnection(serverId, server.encryptedMongoUri);
        // Define ServerMessage model on this connection
        const msgSchema = new conn.Schema({
          serverId: { type: conn.Types.ObjectId, required: true },
          channelId: { type: conn.Types.ObjectId, required: true },
          fromUserId: { type: conn.Types.ObjectId, required: true },
          ciphertext: { type: Buffer, required: true },
          nonce: { type: Buffer, required: true },
          attachment: {
            publicId: { type: String },
            secureUrl: { type: String },
            width: { type: Number },
            height: { type: Number },
            bytes: { type: Number },
            format: { type: String },
            resourceType: { type: String },
          },
          createdAt: { type: Date, default: () => new Date() },
        });
        const ServerMessage = conn.models.ServerMessage || conn.model('ServerMessage', msgSchema);
        const newMsg = await ServerMessage.create({
          serverId: new conn.Types.ObjectId(serverId),
          channelId: new conn.Types.ObjectId(channelId),
          fromUserId: new conn.Types.ObjectId(userId),
          ciphertext: Buffer.from(ciphertext, 'base64'),
          nonce: Buffer.from(nonce, 'base64'),
          attachment,
        });
        const room = `channel:${serverId}:${channelId}`;
        const messagePayload = {
          id: newMsg._id.toString(),
          serverId,
          channelId,
          fromUserId: userId,
          ciphertext,
          nonce,
          attachment,
          createdAt: newMsg.createdAt,
        };
        io.to(room).emit('server:receive', messagePayload);
        ack && ack({ success: true, id: newMsg._id.toString() });
      } catch (err) {
        ack && ack({ error: 'failed to send' });
      }
    });
    // Clean up on disconnect
    socket.on('disconnect', () => {
      clearInterval(presenceInterval);
      pubClient.del(presenceKey).catch(() => {});
    });

    /**
     * Anonymous chat rooms – create/join/send messages.  Rooms are stored
     * entirely in Redis with a 5‑hour TTL.  Messages are broadcast via
     * Socket.IO and not persisted.
     */
    socket.on('anon:create', async (ack?: (resp: any) => void) => {
      try {
        const roomId = crypto.randomBytes(8).toString('hex');
        const redisKey = `anon:room:${roomId}`;
        await pubClient.set(redisKey, '1', 'EX', config.anonRoomTtlHours * 3600);
        // join Socket.IO room
        socket.join(`anon:${roomId}`);
        ack && ack({ roomId });
      } catch (err) {
        ack && ack({ error: 'failed' });
      }
    });
    socket.on('anon:join', async ({ roomId }: { roomId: string }, ack?: (resp: any) => void) => {
      if (!roomId) {
        ack && ack({ error: 'missing roomId' });
        return;
      }
      const redisKey = `anon:room:${roomId}`;
      const exists = await pubClient.exists(redisKey);
      if (!exists) {
        ack && ack({ error: 'room not found' });
        return;
      }
      socket.join(`anon:${roomId}`);
      // refresh TTL on join
      await pubClient.expire(redisKey, config.anonRoomTtlHours * 3600);
      ack && ack({ success: true });
    });
    socket.on('anon:send', async (payload: any, ack?: (resp: any) => void) => {
      const { roomId, ciphertext, nonce } = payload || {};
      if (!roomId || !ciphertext || !nonce) {
        ack && ack({ error: 'invalid payload' });
        return;
      }
      const redisKey = `anon:room:${roomId}`;
      const exists = await pubClient.exists(redisKey);
      if (!exists) {
        ack && ack({ error: 'room not found' });
        return;
      }
      // Broadcast to room
      io.to(`anon:${roomId}`).emit('anon:message', {
        roomId,
        fromUserId: userId,
        ciphertext,
        nonce,
        timestamp: Date.now(),
      });
      ack && ack({ success: true });
    });
  });
  return io;
}