import { BAIDU_PLAN_LIMITS, type BaiduPlanId } from "../shared/translation-usage";

export interface BaiduSubmissionGate {
  /** Reserves the next provider submission start without ever persisting text. */
  waitForTurn(plan: BaiduPlanId): Promise<void>;
}

/**
 * Worker-lifetime QPS gate shared by direct manual smoke and every concrete
 * Baidu scheduler runtime. It records starts rather than completions: an
 * aborted request remains a conservative, non-recoverable rate-limit event.
 */
export function createBaiduSubmissionGate({
  now = () => Date.now(),
  wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
}: {
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
} = {}): BaiduSubmissionGate {
  let lastSubmissionStartedAt = Number.NEGATIVE_INFINITY;
  let serial = Promise.resolve();

  return {
    waitForTurn(plan) {
      const result = serial.then(async () => {
        const earliestStart = lastSubmissionStartedAt + 1_000 / BAIDU_PLAN_LIMITS[plan].qps;
        const delay = Math.max(0, earliestStart - now());
        if (delay > 0) await wait(delay);
        lastSubmissionStartedAt = now();
      });
      serial = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}
