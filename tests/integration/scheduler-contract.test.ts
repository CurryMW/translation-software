import { describe, expect, it } from "vitest";
import {
  BAIDU_PLAN_LIMITS,
  DEFAULT_TRANSLATION_USAGE_SETTINGS,
  isBaiduPlanId,
  isTranslationUsageSettings,
} from "../../src/shared/translation-usage";
import {
  isTranslationCancellationMessage,
  isPageSessionDecisionMessage,
  isPageSessionRouteChangedMessage,
  isTranslationPreflightMessage,
  SITE_MESSAGE_TYPES,
  TRANSLATION_MESSAGE_TYPES,
} from "../../src/shared/messages";

describe("可视调度与本地字符预算共享契约", () => {
  it("标准版严格串行且 QPS 为 1，高级版不作为默认值", () => {
    expect(DEFAULT_TRANSLATION_USAGE_SETTINGS).toEqual({
      plan: "standard",
      monthlyCharacterBudget: 50_000,
    });
    expect(BAIDU_PLAN_LIMITS.standard).toMatchObject({
      maxConcurrency: 1,
      qps: 1,
      safeRequestCharacters: 1_000,
    });
    expect(BAIDU_PLAN_LIMITS.advanced).toMatchObject({
      maxConcurrency: 10,
      qps: 10,
      safeRequestCharacters: 6_000,
    });
  });

  it("只接受显式套餐和非负安全整数形式的本地月度预算", () => {
    expect(isBaiduPlanId("standard")).toBe(true);
    expect(isBaiduPlanId("premium")).toBe(false);
    expect(isTranslationUsageSettings({ plan: "advanced", monthlyCharacterBudget: 125_000 })).toBe(true);
    expect(isTranslationUsageSettings({ plan: "standard", monthlyCharacterBudget: -1 })).toBe(false);
    expect(isTranslationUsageSettings({ plan: "standard", monthlyCharacterBudget: 1.5 })).toBe(false);
  });

  it("取消与实际提交前预检消息只携带任务标识，不携带正文", () => {
    const session = { id: "stay-1" };
    const cancellation = {
      type: TRANSLATION_MESSAGE_TYPES.cancel,
      session,
      payload: { requestId: "request-1", blockId: "block-1" },
    };
    const preflight = {
      type: TRANSLATION_MESSAGE_TYPES.preflight,
      session,
      payload: { requestId: "request-1", blockId: "block-1" },
    };

    expect(isTranslationCancellationMessage(cancellation)).toBe(true);
    expect(isTranslationPreflightMessage(preflight)).toBe(true);
    expect(isTranslationCancellationMessage({ type: TRANSLATION_MESSAGE_TYPES.cancel, payload: cancellation.payload })).toBe(false);
    expect(isTranslationPreflightMessage({ type: TRANSLATION_MESSAGE_TYPES.preflight, payload: preflight.payload })).toBe(false);
    expect(cancellation.payload).not.toHaveProperty("text");
    expect(preflight.payload).not.toHaveProperty("text");
  });

  it("SPA 路由失效信号只携带前台停留会话，不携带 URL、正文或路由标识", () => {
    const routeChanged = {
      type: SITE_MESSAGE_TYPES.routeChanged,
      payload: { session: { id: "stay-1" } },
    };

    expect(isPageSessionRouteChangedMessage(routeChanged)).toBe(true);
    expect(isPageSessionRouteChangedMessage({ type: "page-session.route-changed-wrong" })).toBe(false);
    expect(isPageSessionRouteChangedMessage({ type: SITE_MESSAGE_TYPES.routeChanged })).toBe(false);
    expect(routeChanged.payload).toEqual({ session: { id: "stay-1" } });
    expect(JSON.stringify(routeChanged)).not.toMatch(/url|text|routeId/iu);
  });

  it("前台停留会话决策只接受有效会话标识和明确决定", () => {
    expect(isPageSessionDecisionMessage({
      type: SITE_MESSAGE_TYPES.sessionDecision,
      payload: { session: { id: "stay-1" }, decision: "accept" },
    })).toBe(true);
    expect(isPageSessionDecisionMessage({
      type: SITE_MESSAGE_TYPES.sessionDecision,
      payload: { session: { id: "stay-1" }, decision: "reject" },
    })).toBe(true);
    expect(isPageSessionDecisionMessage({
      type: SITE_MESSAGE_TYPES.sessionDecision,
      payload: { session: { id: "" }, decision: "accept" },
    })).toBe(false);
    expect(isPageSessionDecisionMessage({
      type: SITE_MESSAGE_TYPES.sessionDecision,
      payload: { session: { id: "stay-1" }, decision: "close" },
    })).toBe(false);
  });
});
