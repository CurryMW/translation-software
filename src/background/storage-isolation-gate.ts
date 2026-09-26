export interface StorageIsolationGate {
  /** Runs an action only after trusted-context storage isolation succeeds. */
  runIfReady(action: () => void | Promise<void>): Promise<boolean>;
}

interface Dependencies {
  setTrustedContexts(): Promise<void>;
}

/**
 * A service worker must not expose any storage-backed capability until Chrome
 * confirms that `storage.local` is restricted to trusted extension contexts.
 * Initialization is single-flight and all failures resolve to a fail-closed
 * boolean so top-level event listeners never create an unhandled rejection.
 */
export function createStorageIsolationGate(dependencies: Dependencies): StorageIsolationGate {
  const readiness = dependencies.setTrustedContexts().then(() => true).catch(() => false);
  return {
    async runIfReady(action) {
      if (!await readiness) return false;
      try {
        await action();
        return true;
      } catch {
        return false;
      }
    },
  };
}
