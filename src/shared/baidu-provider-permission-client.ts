import { BAIDU_PROVIDER_ORIGIN_PATTERN } from "./baidu-provider";

export interface BaiduProviderPermissionClient {
  /** Must be called only from an explicit options-page user gesture. */
  ensure(): Promise<boolean>;
}

export const chromeBaiduProviderPermissionClient: BaiduProviderPermissionClient = {
  ensure() {
    const request = { origins: [BAIDU_PROVIDER_ORIGIN_PATTERN] };
    // `permissions.request` must run synchronously from the options button's
    // click stack. Awaiting a preliminary `contains` check loses that gesture
    // in Chromium, so an already-granted origin simply resolves true here.
    return chrome.permissions.request(request);
  },
};
