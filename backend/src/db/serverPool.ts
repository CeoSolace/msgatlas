import mongoose, { Connection } from 'mongoose';
import LRU from 'lru-cache';
import { decryptString } from '../utils/cryptoUtil';
import { config } from '../config';
import dns from 'dns/promises';
import net from 'net';

/**
 * LRU cache of per‑server MongoDB connections.  Keys are server IDs.  Values
 * are open mongoose.Connection instances.  When an entry is evicted the
 * underlying connection is closed.
 */
const pool = new LRU<string, Connection>({
  max: 20,
  ttl: 30 * 60 * 1000, // 30 minutes inactivity TTL
  dispose: (_key, conn) => {
    conn.close().catch(() => void 0);
  },
});

/**
 * Validate an external MongoDB URI to ensure it does not point to a private
 * IP address, enforces TLS and only uses the default MongoDB port.  Throws
 * an error if validation fails.
 */
async function validateExternalMongoUri(uri: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch (err) {
    throw new Error('Invalid external Mongo URI');
  }
  if (!/^mongodb(\+srv)?$/.test(parsed.protocol.replace(':', ''))) {
    throw new Error('External Mongo URI must use mongodb or mongodb+srv scheme');
  }
  // Enforce TLS unless using SRV which implies TLS by default
  const searchParams = parsed.searchParams;
  const tls = searchParams.get('tls') || searchParams.get('ssl');
  if (!parsed.protocol.startsWith('mongodb+srv') && tls !== 'true') {
    throw new Error('External Mongo URI must enable TLS (tls=true)');
  }
  // Block localhosts and private IPs
  const hostname = parsed.hostname;
  // Disallow common local domains
  const forbiddenHosts = ['localhost', '127.0.0.1', '0.0.0.0'];
  if (forbiddenHosts.includes(hostname)) {
    throw new Error('External Mongo URI cannot point to a local host');
  }
  // Resolve DNS to an IP and verify it is not private
  try {
    const { address } = await dns.lookup(hostname);
    if (isPrivateIp(address)) {
      throw new Error('External Mongo URI resolves to a private IP');
    }
  } catch (err) {
    // If DNS lookup fails, be conservative and reject
    throw new Error('Failed to resolve external Mongo URI');
  }
  // Optional: restrict ports (allow default 27017).  With mongodb+srv the port is omitted.
  if (parsed.port && parsed.port !== '27017') {
    throw new Error('External Mongo URI must use port 27017');
  }
}

/**
 * Detect whether an IP is private (RFC 1918 + loopback).
 */
function isPrivateIp(ip: string): boolean {
  if (!net.isIP(ip)) return true;
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

/**
 * Get or create a mongoose.Connection for the given server.  The server’s
 * encrypted MongoDB URI is decrypted with the configured KMS master key and
 * pepper.  The URI is validated before connecting.  Connections are
 * cached in an LRU pool and automatically closed when evicted.
 */
export async function getServerConnection(
  serverId: string,
  encryptedMongoUri: string
): Promise<Connection> {
  // Return cached connection if present
  const existing = pool.get(serverId);
  if (existing) return existing;
  // Decrypt and validate
  const uri = await decryptString(encryptedMongoUri);
  await validateExternalMongoUri(uri);
  // Create a new connection
  const conn = await mongoose.createConnection(uri, {
    // enable autoIndex because each server manages its own indexes
    // @ts-ignore – options may vary across Mongoose versions
    autoIndex: true,
  }).asPromise();
  // Add to cache
  pool.set(serverId, conn);
  return conn;
}