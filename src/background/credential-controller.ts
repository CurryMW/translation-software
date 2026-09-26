import type {
  CredentialMutationResult,
  CredentialStatus,
} from "../shared/credential-types";
import {
  CREDENTIAL_MESSAGE_TYPES,
  isCredentialMessage,
  type CredentialMessage,
} from "../shared/messages";

const STORAGE_KEY = "baiduCredentials";

type Sender = {
  id?: string;
  tab?: unknown;
  url?: string;
};

interface CredentialStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

interface StoredCredentials {
  appId: string;
  secret: string;
  revision: string;
}

export interface CredentialController {
  handle(message: unknown, sender: Sender, extensionId: string): Promise<CredentialStatus | CredentialMutationResult>;
  /** Service-worker-only read path; it is never exposed through Runtime messages. */
  readForServiceWorker(): Promise<StoredCredentials | undefined>;
}

function isTrustedExtensionPage(sender: Sender, extensionId: string): boolean {
  return (
    typeof sender.url === "string" &&
    sender.url.startsWith(`chrome-extension://${extensionId}/`)
  );
}

function isTrustedOptionsPage(sender: Sender, extensionId: string): boolean {
  return sender.url === `chrome-extension://${extensionId}/options.html`;
}

function credentialsFrom(value: unknown): StoredCredentials | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const credentials = value as Partial<StoredCredentials>;
  if (typeof credentials.appId !== "string" || typeof credentials.secret !== "string") return undefined;
  return {
    appId: credentials.appId,
    secret: credentials.secret,
    // Legacy credential records were created before the safety gate. They
    // cannot match any persisted readiness record, which requires a UUID.
    revision: typeof credentials.revision === "string" && credentials.revision.length > 0 ? credentials.revision : "legacy",
  };
}

async function configured(storage: CredentialStorage): Promise<CredentialStatus> {
  const stored = await storage.get(STORAGE_KEY);
  return { configured: credentialsFrom(stored[STORAGE_KEY]) !== undefined };
}

function validInput(message: Extract<CredentialMessage, { type: typeof CREDENTIAL_MESSAGE_TYPES.save }>): boolean {
  return message.payload.appId.trim().length > 0 && message.payload.secret.trim().length > 0;
}

export function createCredentialController({ storage, createRevision = () => crypto.randomUUID() }: { storage: CredentialStorage; createRevision?: () => string }): CredentialController {
  return {
    async readForServiceWorker() {
      try {
        const stored = await storage.get(STORAGE_KEY);
        return credentialsFrom(stored[STORAGE_KEY]);
      } catch {
        return undefined;
      }
    },
    async handle(message, sender, extensionId) {
      if (!isCredentialMessage(message)) {
        return { ok: false, error: "UNTRUSTED_SENDER" };
      }

      if (!isTrustedExtensionPage(sender, extensionId)) {
        return message.type === CREDENTIAL_MESSAGE_TYPES.status
          ? { configured: false }
          : { ok: false, error: "UNTRUSTED_SENDER" };
      }

      if (message.type !== CREDENTIAL_MESSAGE_TYPES.status && !isTrustedOptionsPage(sender, extensionId)) {
        return { ok: false, error: "UNTRUSTED_SENDER" };
      }

      try {
        if (message.type === CREDENTIAL_MESSAGE_TYPES.status) {
          return configured(storage);
        }
        if (message.type === CREDENTIAL_MESSAGE_TYPES.clear) {
          await storage.remove(STORAGE_KEY);
          return { ok: true, status: { configured: false } };
        }
        if (!validInput(message)) {
          return { ok: false, error: "INVALID_CREDENTIALS" };
        }
        await storage.set({
          [STORAGE_KEY]: {
            appId: message.payload.appId.trim(),
            secret: message.payload.secret,
            revision: createRevision(),
          },
        });
        return { ok: true, status: { configured: true } };
      } catch {
        return { ok: false, error: "STORAGE_FAILURE" };
      }
    },
  };
}
