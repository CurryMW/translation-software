export interface WorkerSafetyOperationQueue {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

/**
 * Serializes safety-sensitive worker operations that share credentials, plan
 * and manual-smoke readiness. It deliberately retains no operation payloads.
 */
export function createWorkerSafetyOperationQueue(): WorkerSafetyOperationQueue {
  let tail = Promise.resolve();
  return {
    run(operation) {
      const result = tail.then(operation, operation);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}
