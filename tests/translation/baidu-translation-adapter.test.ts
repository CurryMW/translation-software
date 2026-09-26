import { describe, expect, it, vi } from "vitest";
import { BaiduTranslationAdapter } from "../../src/background/baidu-translation-adapter";
import { TranslationAdapterError } from "../../src/shared/translation";

const input = { text: "local source", sourceLanguage: "auto" as const, targetLanguage: "zh" as const };

async function expectSanitizedFailure(adapter: BaiduTranslationAdapter, expectedError: string, providerCode?: string): Promise<void> {
  try {
    await adapter.translate(input);
    throw new Error("预期适配器失败");
  } catch (error) {
    expect(error).toBeInstanceOf(TranslationAdapterError);
    const failure = (error as TranslationAdapterError).failure;
    expect(failure).toEqual(providerCode === undefined ? { error: expectedError } : { error: expectedError, providerCode });
    expect(JSON.stringify(failure)).not.toContain("must never escape");
    expect(JSON.stringify(failure)).not.toContain("adapter-secret");
    expect(JSON.stringify(failure)).not.toContain(input.text);
  }
}

describe("百度通用文本翻译适配器", () => {
  it("只以 POST 必需字段提交单个文本内容块，并将成功映射为统一结果", async () => {
    const postForm = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ from: "en", trans_result: [{ dst: "local-fixture-result" }] }),
    });
    const adapter = new BaiduTranslationAdapter({
      credentials: async () => ({ appId: "2015063000000001", secret: "12345678" }),
      postForm,
      salt: () => "1435660288",
    });

    await expect(adapter.translate({ text: "apple", sourceLanguage: "auto", targetLanguage: "zh" })).resolves.toEqual({
      translatedText: "local-fixture-result",
      sourceLanguage: "en",
      targetLanguage: "zh",
      adapter: "baidu",
    });
    expect(postForm).toHaveBeenCalledOnce();
    const [, fields] = postForm.mock.calls[0]!;
    expect(Object.keys(fields).sort()).toEqual(["appid", "from", "q", "salt", "sign", "to"]);
    expect(fields.from).toBe("auto");
    expect(fields.to).toBe("zh");
    expect(fields.sign).toBe("f89f9594663708c1605f3d736d01d2d4");
    expect(JSON.stringify(fields)).not.toContain("12345678");
  });

  it.each([
    ["52003", "AUTHENTICATION_FAILED"],
    ["54001", "AUTHENTICATION_FAILED"],
    [54003, "RATE_LIMITED"],
    ["54004", "PROVIDER_QUOTA_EXHAUSTED"],
    ["54000", "INVALID_REQUEST"],
    ["54005", "INVALID_REQUEST"],
    ["58000", "AUTHENTICATION_FAILED"],
    ["58001", "UNSUPPORTED_LANGUAGE"],
    ["58002", "SERVICE_UNAVAILABLE"],
    ["90107", "AUTHENTICATION_FAILED"],
  ] as const)("将百度错误码 %s 映射为脱敏类别", async (errorCode, error) => {
    const postForm = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ error_code: errorCode, error_msg: "must never escape" }) });
    const adapter = new BaiduTranslationAdapter({
      credentials: async () => ({ appId: "local-app", secret: "adapter-secret" }),
      postForm,
      salt: () => "123",
    });

    await expectSanitizedFailure(adapter, error, String(errorCode));
    expect(postForm).toHaveBeenCalledOnce();
  });

  it.each([
    [401, "AUTHENTICATION_FAILED"],
    [403, "AUTHENTICATION_FAILED"],
    [429, "RATE_LIMITED"],
    [500, "SERVICE_UNAVAILABLE"],
    [599, "SERVICE_UNAVAILABLE"],
  ] as const)("将 HTTP %s 映射为脱敏类别且不重试", async (status, error) => {
    const postForm = vi.fn().mockResolvedValue({ status, json: async () => ({ error_msg: "must never escape" }) });
    const adapter = new BaiduTranslationAdapter({ credentials: async () => ({ appId: "local-app", secret: "adapter-secret" }), postForm, salt: () => "123" });

    await expectSanitizedFailure(adapter, error);
    expect(postForm).toHaveBeenCalledOnce();
  });

  it("未配置凭据时在请求前拒绝，绝不调用 transport", async () => {
    const postForm = vi.fn();
    const adapter = new BaiduTranslationAdapter({ credentials: async () => undefined, postForm, salt: () => "123" });

    await expectSanitizedFailure(adapter, "AUTHENTICATION_FAILED");
    expect(postForm).not.toHaveBeenCalled();
  });

  it("页面调度可在 QPS 门前冻结一次凭据快照，提交闭包不再读取存储", async () => {
    const credentials = vi.fn().mockResolvedValue({ appId: "local-app", secret: "adapter-secret" });
    const postForm = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ from: "en", trans_result: [{ dst: "local fixture" }] }) });
    const adapter = new BaiduTranslationAdapter({ credentials, postForm, salt: () => "123" });

    const submit = await adapter.prepareSubmission(input);
    await expect(submit()).resolves.toMatchObject({ adapter: "baidu" });
    expect(credentials).toHaveBeenCalledOnce();
    expect(postForm).toHaveBeenCalledOnce();
  });

  it.each([
    [{ error_code: "unknown", error_msg: "must never escape" }],
    [{ error_code: [] }],
    [null],
    [{}],
    [{ trans_result: [] }],
    [{ trans_result: [{ dst: "" }] }],
  ])("将未知、畸形或空成功响应收敛为脱敏服务错误", async (body) => {
    const postForm = vi.fn().mockResolvedValue({ status: 200, json: async () => body });
    const adapter = new BaiduTranslationAdapter({ credentials: async () => ({ appId: "local-app", secret: "adapter-secret" }), postForm, salt: () => "123" });

    await expectSanitizedFailure(adapter, "SERVICE_UNAVAILABLE");
    expect(postForm).toHaveBeenCalledOnce();
  });

  it("保留未知但合法的数字 provider code，仍只暴露统一服务类别", async () => {
    const postForm = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ error_code: 99999, error_msg: "must never escape" }) });
    const adapter = new BaiduTranslationAdapter({ credentials: async () => ({ appId: "local-app", secret: "adapter-secret" }), postForm, salt: () => "123" });

    await expectSanitizedFailure(adapter, "SERVICE_UNAVAILABLE", "99999");
    expect(postForm).toHaveBeenCalledOnce();
  });

  it("JSON 解析失败不会泄露原始异常，仅返回统一服务类别", async () => {
    const postForm = vi.fn().mockResolvedValue({ status: 200, json: async () => { throw new Error("must never escape"); } });
    const adapter = new BaiduTranslationAdapter({ credentials: async () => ({ appId: "local-app", secret: "adapter-secret" }), postForm, salt: () => "123" });

    await expectSanitizedFailure(adapter, "SERVICE_UNAVAILABLE");
    expect(postForm).toHaveBeenCalledOnce();
  });

  it("将 transport 网络异常和 Abort 超时分别收敛为有限类别，且每次至多提交一次", async () => {
    const network = vi.fn().mockRejectedValue(new Error("must never escape"));
    const networkAdapter = new BaiduTranslationAdapter({ credentials: async () => ({ appId: "local-app", secret: "adapter-secret" }), postForm: network, salt: () => "123" });
    await expectSanitizedFailure(networkAdapter, "NETWORK_ERROR");
    expect(network).toHaveBeenCalledOnce();

    const timeoutTransport = vi.fn(async (_endpoint: string, _fields: Record<string, string>, signal: AbortSignal) => {
      await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("must never escape")), { once: true }));
      throw new Error("unreachable");
    });
    let fireTimeout: (() => void) | undefined;
    const timer = { setTimeout: (action: () => void) => { fireTimeout = action; return 1 as unknown as ReturnType<typeof setTimeout>; }, clearTimeout: vi.fn() };
    const timeoutAdapter = new BaiduTranslationAdapter({
      credentials: async () => ({ appId: "local-app", secret: "adapter-secret" }),
      postForm: timeoutTransport,
      salt: () => "123",
      timeoutMs: 1,
      timer,
    });
    const pendingTimeout = timeoutAdapter.translate(input);
    await vi.waitFor(() => expect(timeoutTransport).toHaveBeenCalledOnce());
    fireTimeout?.();
    try {
      await pendingTimeout;
      throw new Error("预期超时失败");
    } catch (error) {
      expect(error).toBeInstanceOf(TranslationAdapterError);
      expect((error as TranslationAdapterError).failure).toEqual({ error: "TIMEOUT" });
    }
    expect(timeoutTransport).toHaveBeenCalledOnce();
    expect(timer.clearTimeout).toHaveBeenCalledOnce();
  });

  it("安全失效中止在途 transport 时只返回有限网络类别，不泄露中止原因", async () => {
    let signal: AbortSignal | undefined;
    const postForm = vi.fn((_endpoint: string, _fields: Record<string, string>, activeSignal: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal = activeSignal;
      activeSignal.addEventListener("abort", () => reject(new Error("local abort detail must never escape")), { once: true });
    }));
    const adapter = new BaiduTranslationAdapter({ credentials: async () => ({ appId: "local-app", secret: "adapter-secret" }), postForm, salt: () => "123" });

    const pending = adapter.translate(input);
    await vi.waitFor(() => expect(postForm).toHaveBeenCalledOnce());
    adapter.abortAll();
    await expectSanitizedFailurePromise(pending, "NETWORK_ERROR");
    expect(signal?.aborted).toBe(true);
    expect(postForm).toHaveBeenCalledOnce();
  });

  it("按 requestId 中止同一长文本任务的全部并行片段", async () => {
    const signals: AbortSignal[] = [];
    const postForm = vi.fn((_endpoint: string, _fields: Record<string, string>, activeSignal: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signals.push(activeSignal);
      activeSignal.addEventListener("abort", () => reject(new Error("local abort detail must never escape")), { once: true });
    }));
    const adapter = new BaiduTranslationAdapter({ credentials: async () => ({ appId: "local-app", secret: "adapter-secret" }), postForm, salt: () => "123" });

    const first = adapter.translate({ ...input, requestId: "long-request" });
    const second = adapter.translate({ ...input, requestId: "long-request" });
    await vi.waitFor(() => expect(postForm).toHaveBeenCalledTimes(2));
    adapter.abortRequest("long-request");
    await expectSanitizedFailurePromise(first, "NETWORK_ERROR");
    await expectSanitizedFailurePromise(second, "NETWORK_ERROR");
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});

async function expectSanitizedFailurePromise(pending: Promise<unknown>, expectedError: string): Promise<void> {
  try {
    await pending;
    throw new Error("预期适配器失败");
  } catch (error) {
    expect(error).toBeInstanceOf(TranslationAdapterError);
    const failure = (error as TranslationAdapterError).failure;
    expect(failure).toEqual({ error: expectedError });
    expect(JSON.stringify(failure)).not.toContain("local abort detail");
  }
}
