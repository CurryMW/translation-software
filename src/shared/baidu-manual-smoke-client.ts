import type { BaiduAccountReview, BaiduManualSmokePreparation, BaiduManualSmokeRunResult } from "./baidu-manual-smoke";
import { BAIDU_MANUAL_SMOKE_MESSAGE_TYPES } from "./messages";

export interface BaiduManualSmokeClient {
  prepare(review: BaiduAccountReview): Promise<BaiduManualSmokePreparation>;
  run(confirmationToken: string): Promise<BaiduManualSmokeRunResult>;
}

export const chromeBaiduManualSmokeClient: BaiduManualSmokeClient = {
  async prepare(review) {
    return chrome.runtime.sendMessage({ type: BAIDU_MANUAL_SMOKE_MESSAGE_TYPES.prepare, payload: review });
  },
  async run(confirmationToken) {
    return chrome.runtime.sendMessage({ type: BAIDU_MANUAL_SMOKE_MESSAGE_TYPES.run, payload: { confirmationToken } });
  },
};
