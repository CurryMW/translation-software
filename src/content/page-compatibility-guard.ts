export type PageCompatibilityFailure = "layout-breakage" | "scroll-breakage" | "interaction-breakage" | "unsafe-page";

interface PageCompatibilityGuardDependencies {
  removeUi(): void;
  cancelPending(): void;
  pauseSession(): void;
  notify(reason: PageCompatibilityFailure): void;
}

/** One-shot page-level rollback. The guard has no host-page data or persistence. */
export function createPageCompatibilityGuard(dependencies: PageCompatibilityGuardDependencies) {
  let paused = false;
  return {
    report(reason: PageCompatibilityFailure): boolean {
      if (paused) return false;
      paused = true;
      dependencies.cancelPending();
      dependencies.removeUi();
      dependencies.pauseSession();
      dependencies.notify(reason);
      return true;
    },
    isPaused(): boolean { return paused; },
  };
}
