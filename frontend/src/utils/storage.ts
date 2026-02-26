/**
 * Persist generated encryption keys to localStorage.  IndexedDB could be
 * used instead for better isolation, but localStorage suffices for the
 * demonstration.  Keys are stored under the `encryptionKeys` key.
 */
export function saveKeys(keys: { identityKey: string; identityPublicKey: string; curveSecretKey: string; curvePublicKey: string }): void {
  localStorage.setItem('encryptionKeys', JSON.stringify(keys));
}

/**
 * Load encryption keys from localStorage.  Returns null if not present
 * or parsing fails.
 */
export function loadKeys(): {
  identityKey: string;
  identityPublicKey: string;
  curveSecretKey: string;
  curvePublicKey: string;
} | null {
  const stored = localStorage.getItem('encryptionKeys');
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}