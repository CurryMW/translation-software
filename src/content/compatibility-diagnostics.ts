/**
 * Session-only compatibility counters. Values intentionally have no payload,
 * URL, account, DOM or timestamp fields so this object cannot become browsing
 * history by accident.
 */
export type CompatibilityDiagnosticKind = "block-skipped" | "page-fallback" | "region-skipped" | "exception-disabled";
export type CompatibilityDiagnosticError = "unsafe-context" | "unsafe-page" | "layout-breakage" | "scroll-breakage" | "interaction-breakage" | "unsupported-region";

export interface CompatibilityDiagnosticSnapshot {
  readonly counts: Partial<Record<CompatibilityDiagnosticKind, number>>;
  readonly errors: Partial<Record<CompatibilityDiagnosticError, number>>;
}

const kinds = new Set<CompatibilityDiagnosticKind>(["block-skipped", "page-fallback", "region-skipped", "exception-disabled"]);
const errors = new Set<CompatibilityDiagnosticError>(["unsafe-context", "unsafe-page", "layout-breakage", "scroll-breakage", "interaction-breakage", "unsupported-region"]);

export function createCompatibilityDiagnostics() {
  const countByKind = new Map<CompatibilityDiagnosticKind, number>();
  const countByError = new Map<CompatibilityDiagnosticError, number>();
  const increment = <T>(map: Map<T, number>, value: T) => map.set(value, (map.get(value) ?? 0) + 1);

  return {
    record(kind: CompatibilityDiagnosticKind, error?: CompatibilityDiagnosticError | string, _unsafeContext?: unknown): void {
      if (!kinds.has(kind)) return;
      increment(countByKind, kind);
      if (typeof error === "string" && errors.has(error as CompatibilityDiagnosticError)) increment(countByError, error as CompatibilityDiagnosticError);
    },
    snapshot(): CompatibilityDiagnosticSnapshot {
      return {
        counts: Object.fromEntries([...countByKind.entries()].sort(([left], [right]) => left.localeCompare(right))),
        errors: Object.fromEntries([...countByError.entries()].sort(([left], [right]) => left.localeCompare(right))),
      };
    },
    reset(): void {
      countByKind.clear();
      countByError.clear();
    },
  };
}
