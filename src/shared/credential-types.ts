export interface BaiduCredentialsInput {
  appId: string;
  secret: string;
}

export interface CredentialStatus {
  configured: boolean;
}

export type CredentialMutationResult =
  | { ok: true; status: CredentialStatus }
  | {
      ok: false;
      error: "INVALID_CREDENTIALS" | "UNTRUSTED_SENDER" | "STORAGE_FAILURE";
    };
