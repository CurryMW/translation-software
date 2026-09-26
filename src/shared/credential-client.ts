import type { BaiduCredentialsInput, CredentialMutationResult, CredentialStatus } from "./credential-types";
import { CREDENTIAL_MESSAGE_TYPES } from "./messages";

export interface CredentialClient {
  status(): Promise<CredentialStatus>;
  save(input: BaiduCredentialsInput): Promise<CredentialMutationResult>;
  clear(): Promise<CredentialMutationResult>;
}

export const chromeCredentialClient: CredentialClient = {
  async status() {
    return chrome.runtime.sendMessage({ type: CREDENTIAL_MESSAGE_TYPES.status });
  },
  async save(input) {
    return chrome.runtime.sendMessage({ type: CREDENTIAL_MESSAGE_TYPES.save, payload: input });
  },
  async clear() {
    return chrome.runtime.sendMessage({ type: CREDENTIAL_MESSAGE_TYPES.clear });
  },
};
