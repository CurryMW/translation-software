export interface SiteExceptionRecord {
  readonly id: string;
  readonly domain: string;
  readonly trigger: string;
  readonly reason: string;
  readonly fixture: string;
  readonly fallback: string;
  readonly reviewTrigger: string;
  readonly enabled: boolean;
  readonly triggerSelector?: string;
  readonly pause?: "privacy" | "page-breakage" | "cost";
}

export type SiteExceptionStrategy = "exception" | "generic" | "skip";

export const SITE_EXCEPTION_REGISTRY: readonly SiteExceptionRecord[] = [
  {
    id: "synthetic-site-exception",
    domain: "synthetic-site.example.test",
    trigger: "A synthetic fixture marker identifies the wrapped reading region.",
    triggerSelector: "[data-synthetic-site-exception-root]",
    reason: "The fixture models a host wrapper that cannot be safely inferred by generic discovery.",
    fixture: "tests/manual-fixtures/synthetic-site-exception.html",
    fallback: "If the marker is absent or generic safety fails, skip the affected region.",
    reviewTrigger: "fixture structure or generic discovery changes",
    enabled: true,
  },
];

export interface SiteExceptionTrigger {
  readonly triggerMatched: boolean;
  readonly genericSafetyPassed: boolean;
}

export interface SiteExceptionRegistry {
  resolve(domain: string, trigger: SiteExceptionTrigger): SiteExceptionRecord | undefined;
  strategy(domain: string, trigger: SiteExceptionTrigger): SiteExceptionStrategy;
  setEnabled(id: string, enabled: boolean): boolean;
  list(): readonly SiteExceptionRecord[];
}

function normalizeDomain(value: string): string | undefined {
  const domain = value.trim().toLowerCase();
  if (!domain || domain.includes("/") || domain.length > 253) return undefined;
  try {
    const hostname = new URL(`https://${domain}`).hostname;
    return hostname === domain && hostname.includes(".") ? hostname : undefined;
  } catch {
    return undefined;
  }
}

function validRecord(value: SiteExceptionRecord): SiteExceptionRecord | undefined {
  const domain = normalizeDomain(value.domain);
  if (!domain || !value.id || !value.trigger || !value.reason || !value.fixture || !value.fallback || !value.reviewTrigger) return undefined;
  if (value.triggerSelector && typeof document !== "undefined") {
    try { document.querySelector(value.triggerSelector); } catch { return undefined; }
  }
  return { ...value, domain };
}

export function createSiteExceptionRegistry(initial: readonly SiteExceptionRecord[] = SITE_EXCEPTION_REGISTRY): SiteExceptionRegistry {
  const records = new Map<string, SiteExceptionRecord>();
  for (const candidate of initial) {
    const record = validRecord(candidate);
    if (record) records.set(record.id, record);
  }

  const resolve = (domain: string, trigger: SiteExceptionTrigger): SiteExceptionRecord | undefined => {
      const normalized = normalizeDomain(domain);
      if (!normalized || !trigger.triggerMatched) return undefined;
      return [...records.values()].find((record) => record.enabled && record.domain === normalized);
  };

  return {
    resolve,
    strategy(domain, trigger) {
      if (resolve(domain, trigger)) return "exception";
      return trigger.genericSafetyPassed ? "generic" : "skip";
    },
    setEnabled(id, enabled) {
      const current = records.get(id);
      if (!current || current.enabled === enabled) return Boolean(current);
      records.set(id, { ...current, enabled });
      return true;
    },
    list() {
      return [...records.values()].sort((left, right) => left.id.localeCompare(right.id));
    },
  };
}

/** Runtime adapter seam: trigger matching is kept outside the generic scanner. */
export function siteExceptionStrategyForDocument(
  registry: SiteExceptionRegistry,
  document: Document,
  domain: string,
  genericSafetyPassed: boolean,
): SiteExceptionStrategy {
  const triggerMatched = Boolean(siteExceptionRecordForDocument(registry, document, domain));
  return registry.strategy(domain, { triggerMatched, genericSafetyPassed });
}

/** Returns the validated, enabled exception record whose trigger is present. */
export function siteExceptionRecordForDocument(
  registry: SiteExceptionRegistry,
  document: Document,
  domain: string,
): SiteExceptionRecord | undefined {
  const normalized = normalizeDomain(domain);
  if (!normalized) return undefined;
  const record = registry.list().find((candidate) => candidate.domain === normalized);
  if (!record || !record.enabled) return undefined;
  if (record.triggerSelector) {
    try {
      if (!document.querySelector(record.triggerSelector)) return undefined;
    } catch {
      return undefined;
    }
  }
  return record;
}
