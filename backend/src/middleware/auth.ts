import { FastifyReply, FastifyRequest } from 'fastify';
import { SessionModel, UserModel, ISession, IUser } from '../db/central';

/**
 * Attaches the authenticated user to the request.  Expects a cookie named
 * `sessionId`.  Returns 401 if the session is missing, invalid or expired.
 */
export async function authPreHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { sessionId } = (request.cookies as { [key: string]: string }) || {};
  if (!sessionId) {
    reply.status(401).send({ error: 'Missing session cookie' });
    return;
  }
  const session: ISession | null = await SessionModel.findOne({ sessionId }).exec();
  if (!session) {
    reply.status(401).send({ error: 'Invalid session' });
    return;
  }
  if (session.expiresAt.getTime() < Date.now()) {
    // Clean up expired session
    await SessionModel.deleteOne({ _id: session._id }).exec();
    reply.status(401).send({ error: 'Session expired' });
    return;
  }
  const user: IUser | null = await UserModel.findById(session.userId).exec();
  if (!user) {
    reply.status(401).send({ error: 'User not found' });
    return;
  }
  // Attach user to request for downstream handlers
  (request as any).session = session;
  (request as any).user = user;
}