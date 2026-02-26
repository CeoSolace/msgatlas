import crypto from 'crypto';
import * as sodium from 'libsodium-wrappers';
import { config } from '../config';

/**
 * Derive a 32‑byte symmetric encryption key from the configured KMS master key
 * and server pepper.  We combine the values and hash them with SHA256.
 */
function deriveKey(): Uint8Array {
  const combined = `${config.kmsMasterKey}:${config.sodiumServerPepper}`;
  const hash = crypto.createHash('sha256').update(combined).digest();
  return new Uint8Array(hash);
}

/**
 * Encrypt a plaintext string using libsodium's secretbox.  The resulting
 * ciphertext is base64 encoded as `nonce:cipher`.
 */
export async function encryptString(plain: string): Promise<string> {
  await sodium.ready;
  const key = deriveKey();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const messageBytes = sodium.from_string(plain);
  const cipher = sodium.crypto_secretbox_easy(messageBytes, nonce, key);
  const result = `${sodium.to_base64(nonce)}:${sodium.to_base64(cipher)}`;
  return result;
}

/**
 * Decrypt a previously encrypted string.  Accepts input of the form
 * `nonce:cipher`.  Returns the plaintext string or throws on failure.
 */
export async function decryptString(encrypted: string): Promise<string> {
  await sodium.ready;
  const key = deriveKey();
  const [nonceB64, cipherB64] = encrypted.split(':');
  if (!nonceB64 || !cipherB64) {
    throw new Error('Invalid encrypted value');
  }
  const nonce = sodium.from_base64(nonceB64);
  const cipher = sodium.from_base64(cipherB64);
  const decrypted = sodium.crypto_secretbox_open_easy(cipher, nonce, key);
  if (!decrypted) {
    throw new Error('Decryption failed');
  }
  return sodium.to_string(decrypted);
}