export interface WorkerBootstrapGate {
  runIfReady<T>(action: () => T | Promise<T>): Promise<{ ready: true; value: T } | { ready: false }>;
}

/**
 * One worker-lifetime bootstrap barrier. Runtime messages wait for trusted
 * storage, persisted safety readiness and the concrete provider runtime to be
 * restored together; bootstrap failure rejects every capability fail-closed.
 */
export function createWorkerBootstrapGate(bootstrap: () => Promise<void>): WorkerBootstrapGate {
  const readiness = bootstrap().then(() => true, () => false);
  return {
    async runIfReady(action) {
      if (!await readiness) return { ready: false };
      try {
        return { ready: true, value: await action() };
      } catch {
        return { ready: false };
      }
    },
  };
}
