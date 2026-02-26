import { useEffect, useState } from 'react';
import type * as Sodium from 'libsodium-wrappers';

/**
 * Hook to load and expose libsodium.  Returns `sodium` once ready.  The
 * wrapper library is loaded asynchronously and memoised for future calls.
 */
export function useSodium() {
  const [sodium, setSodium] = useState<Sodium | null>(null);
  useEffect(() => {
    let mounted = true;
    import('libsodium-wrappers').then(async (mod) => {
      await mod.ready;
      if (mounted) setSodium(mod as unknown as Sodium);
    });
    return () => {
      mounted = false;
    };
  }, []);
  return sodium;
}