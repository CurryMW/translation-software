/** Persistent fail-closed pause list for domains with a confirmed safety risk. */
export const COMPATIBILITY_PAUSES_STORAGE_KEY = "compatibilityPausesByDomain";
export const MANAGED_COMPATIBILITY_PAUSES_STORAGE_KEY = "managedCompatibilityPausesByDomain";

export type CompatibilityPauseReason = "privacy" | "page-breakage" | "cost";

export interface CompatibilityPause {
  readonly domain: string;
  readonly reason: CompatibilityPauseReason;
  readonly pausedAt: number;
}

interface CompatibilityPauseStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

export interface CompatibilityPauseController {
  isPaused(domain: string): Promise<boolean>;
  list(): Promise<CompatibilityPause[]>;
  pause(domain: string, reason: CompatibilityPauseReason): Promise<void>;
  clear(domain: string): Promise<void>;
  reconcileManaged(records: readonly { domain: string; enabled: boolean; pause?: CompatibilityPauseReason }[]): Promise<void>;
}

const reasons = new Set<CompatibilityPauseReason>(["privacy", "page-breakage", "cost"]);

function normalizedDomain(value: string): string | undefined {
  const domain = value.trim().toLowerCase();
  if (!domain || domain.length > 253 || domain.includes("/")) return undefined;
  try {
    const hostname = new URL(`https://${domain}`).hostname;
    return hostname === domain && hostname.includes(".") ? hostname : undefined;
  } catch {
    return undefined;
  }
}

function readPauses(value: unknown): Record<string, CompatibilityPause> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const entries: Record<string, CompatibilityPause> = {};
  for (const candidate of Object.values(value)) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const pause = candidate as Partial<CompatibilityPause>;
    const domain = typeof pause.domain === "string" ? normalizedDomain(pause.domain) : undefined;
    if (!domain || !reasons.has(pause.reason as CompatibilityPauseReason) || typeof pause.pausedAt !== "number" || !Number.isSafeInteger(pause.pausedAt) || pause.pausedAt < 0) continue;
    entries[domain] = { domain, reason: pause.reason as CompatibilityPauseReason, pausedAt: pause.pausedAt };
  }
  return entries;
}

export function createCompatibilityPauseController({ storage, now = () => Date.now(), managedDomains = [] }: { storage: CompatibilityPauseStorage; now?: () => number; managedDomains?: readonly string[] }): CompatibilityPauseController {
  let mutation = Promise.resolve();
  const knownManagedDomains = new Set(managedDomains.map(normalizedDomain).filter((domain): domain is string => Boolean(domain)));
  let lastManualSnapshot: Record<string, CompatibilityPause> = {};
  let lastManagedSnapshot: Record<string, CompatibilityPause> = {};
  let hasSuccessfulRead = false;

  async function read(): Promise<Record<string, CompatibilityPause> | undefined> {
    try {
      const [manual, managed] = await Promise.all([
        storage.get(COMPATIBILITY_PAUSES_STORAGE_KEY),
        storage.get(MANAGED_COMPATIBILITY_PAUSES_STORAGE_KEY),
      ]);
      lastManualSnapshot = readPauses(manual[COMPATIBILITY_PAUSES_STORAGE_KEY]);
      lastManagedSnapshot = readPauses(managed[MANAGED_COMPATIBILITY_PAUSES_STORAGE_KEY]);
      hasSuccessfulRead = true;
      return { ...lastManualSnapshot, ...lastManagedSnapshot };
    } catch {
      return undefined;
    }
  }

  function serialize(pauses: Record<string, CompatibilityPause>): Record<string, CompatibilityPause> {
    return Object.fromEntries(Object.entries(pauses).sort(([left], [right]) => left.localeCompare(right)));
  }

  function enqueue(operation: () => Promise<void>): Promise<void> {
    const next = mutation.then(operation, operation);
    mutation = next.catch(() => undefined);
    return next;
  }

  return {
    async isPaused(domain) {
      const normalized = normalizedDomain(domain);
      if (!normalized) return false;
      const pauses = await read();
      // Before the first successful read there is no trustworthy answer: fail
      // closed for every domain. After a successful read, retain the last
      // known snapshot during a transient outage without globally disabling
      // unrelated domains.
      if (pauses === undefined) {
        if (!hasSuccessfulRead) return true;
        return Boolean(lastManualSnapshot[normalized] || lastManagedSnapshot[normalized]) || knownManagedDomains.has(normalized);
      }
      return Boolean(pauses[normalized]);
    },

    async list() {
      return Object.values((await read()) ?? {}).sort((left, right) => left.domain.localeCompare(right.domain));
    },

    pause(domain, reason) {
      const normalized = normalizedDomain(domain);
      if (!normalized || !reasons.has(reason)) return Promise.resolve();
      return enqueue(async () => {
        if (await read() === undefined) return;
        const pauses = { ...lastManualSnapshot };
        const timestamp = now();
        pauses[normalized] = { domain: normalized, reason, pausedAt: Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : 0 };
        await storage.set({ [COMPATIBILITY_PAUSES_STORAGE_KEY]: serialize(pauses) });
        lastManualSnapshot = pauses;
      });
    },

    clear(domain) {
      const normalized = normalizedDomain(domain);
      if (!normalized) return Promise.resolve();
      return enqueue(async () => {
        if (await read() === undefined) return;
        const pauses = { ...lastManualSnapshot };
        if (!pauses[normalized]) return;
        delete pauses[normalized];
        await storage.set({ [COMPATIBILITY_PAUSES_STORAGE_KEY]: serialize(pauses) });
        lastManualSnapshot = pauses;
      });
    },

    reconcileManaged(records) {
      return enqueue(async () => {
        // Establish a successful storage snapshot before changing the
        // managed gate. If storage is unavailable, keep the previous managed
        // state and fail closed rather than pretending reconciliation worked.
        if (await read() === undefined) return;
        const managed: Record<string, CompatibilityPause> = {};
        const nextKnownManagedDomains = new Set<string>();
        for (const record of records) {
          const domain = normalizedDomain(record.domain);
          if (!domain) continue;
          if (record.enabled && record.pause) {
            nextKnownManagedDomains.add(domain);
            const timestamp = now();
            const reason = reasons.has(record.pause) ? record.pause : "privacy";
            managed[domain] = { domain, reason, pausedAt: Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : 0 };
          }
        }
        await storage.set({ [MANAGED_COMPATIBILITY_PAUSES_STORAGE_KEY]: serialize(managed) });
        knownManagedDomains.clear();
        for (const domain of nextKnownManagedDomains) knownManagedDomains.add(domain);
        lastManagedSnapshot = managed;
      });
    },
  };
}
