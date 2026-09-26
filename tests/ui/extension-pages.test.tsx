import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OptionsPage } from "../../src/options/options-page";
import { PopupPage } from "../../src/popup/popup-page";
import type { CredentialClient } from "../../src/shared/credential-client";
import type { SiteToggleClient } from "../../src/shared/site-toggle-client";
import type { TranslationUsageClient } from "../../src/shared/translation-usage-client";
import type { BaiduManualSmokeClient } from "../../src/shared/baidu-manual-smoke-client";
import type { BaiduManualSmokeRunResult } from "../../src/shared/baidu-manual-smoke";
import type { BaiduProviderPermissionClient } from "../../src/shared/baidu-provider-permission-client";
import type { TranslationAppearanceClient } from "../../src/shared/translation-appearance-client";

function siteClient(status: Awaited<ReturnType<SiteToggleClient["status"]>>): SiteToggleClient {
  return {
    status: vi.fn().mockResolvedValue(status),
    enable: vi.fn(),
    disable: vi.fn(),
    setTargetLanguage: vi.fn(),
  };
}

describe("扩展用户界面", () => {
  it("popup 的打开设置按钮文字与背景保持可见对比", async () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("src/ui.css", "utf8");
    document.head.append(style);
    try {
      const credentialClient: CredentialClient = { status: vi.fn().mockResolvedValue({ configured: true }), save: vi.fn(), clear: vi.fn() };
      render(<PopupPage client={credentialClient} siteClient={siteClient({ kind: "unsupported" })} openOptions={vi.fn()} />);
      const button = await screen.findByRole("button", { name: "打开设置" });
      const computed = getComputedStyle(button);
      expect(computed.color).toBe("rgb(255, 255, 255)");
      expect(computed.backgroundImage).toContain("linear-gradient");
    } finally {
      style.remove();
    }
  });

  it("人工烟囱确认项保持紧凑的复选框布局", async () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("src/ui.css", "utf8");
    document.head.append(style);
    try {
      const credentialClient: CredentialClient = { status: vi.fn().mockResolvedValue({ configured: true }), save: vi.fn(), clear: vi.fn() };
      render(
        <OptionsPage
          client={credentialClient}
          usageClient={{ get: vi.fn().mockResolvedValue({ ok: false, error: "STORAGE_FAILURE" }), update: vi.fn() }}
          manualSmokeClient={{ prepare: vi.fn(), run: vi.fn() }}
          providerPermissionClient={{ ensure: vi.fn() }}
        />,
      );
      const checkbox = await screen.findByLabelText("QPS");
      expect(checkbox.closest("label")).toHaveClass("checkbox-option");
      expect(getComputedStyle(checkbox).width).toBe("1.1rem");
    } finally {
      style.remove();
    }
  });

  it("设置页可选择并保存译文文字颜色", async () => {
    const credentialClient: CredentialClient = { status: vi.fn().mockResolvedValue({ configured: true }), save: vi.fn(), clear: vi.fn() };
    const appearanceClient: TranslationAppearanceClient = {
      get: vi.fn().mockResolvedValue({ ok: true, settings: { textColor: "adaptive" } }),
      update: vi.fn().mockResolvedValue({ ok: true, settings: { textColor: "blue" } }),
    };
    render(<OptionsPage client={credentialClient} appearanceClient={appearanceClient} />);

    const color = await screen.findByRole("radio", { name: "深蓝" });
    await userEvent.click(color);
    await userEvent.click(screen.getByRole("button", { name: "保存译文样式" }));
    expect(appearanceClient.update).toHaveBeenCalledWith({ textColor: "blue" });
    expect(await screen.findByText("译文样式已保存，刷新网页后生效。")).toBeVisible();
  });

  it("设置页可选择套餐和非负本地预算，并说明这是扩展估算", async () => {
    const credentialClient: CredentialClient = { status: vi.fn().mockResolvedValue({ configured: false }), save: vi.fn(), clear: vi.fn() };
    const usageClient: TranslationUsageClient = {
      get: vi.fn().mockResolvedValue({ ok: true, snapshot: { settings: { plan: "standard", monthlyCharacterBudget: 50_000 }, periodKey: "2026-09", submittedCharacters: 20, remainingCharacters: 49_980 } }),
      update: vi.fn().mockResolvedValue({ ok: true, snapshot: { settings: { plan: "advanced", monthlyCharacterBudget: 12 }, periodKey: "2026-09", submittedCharacters: 20, remainingCharacters: 0 } }),
    };
    render(<OptionsPage client={credentialClient} usageClient={usageClient} />);

    expect(await screen.findByText(/本扩展估算/)).toBeVisible();
    expect(screen.getByText("标准版页面请求按 QPS 1 串行。")).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText("百度套餐"), "advanced");
    const budget = screen.getByLabelText("本地月度字符预算");
    await userEvent.clear(budget);
    await userEvent.type(budget, "12");
    await userEvent.click(screen.getByRole("button", { name: "保存本地预算" }));
    expect(usageClient.update).toHaveBeenCalledWith({ plan: "advanced", monthlyCharacterBudget: 12 });
    expect(screen.getByText(/不是百度官方账单/)).toBeVisible();
  });
  it("popup 显示未配置状态，并可打开设置页", async () => {
    const openOptions = vi.fn();
    const client: CredentialClient = {
      status: vi.fn().mockResolvedValue({ configured: false }),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const currentSite = siteClient({ kind: "not-authorized", domain: "article.example.test" });

    render(<PopupPage client={client} siteClient={currentSite} openOptions={openOptions} />);

    expect(await screen.findByText("尚未配置翻译服务")).toBeVisible();
    expect(screen.getByText("此网站尚未授权")).toBeVisible();
    expect(screen.getByRole("button", { name: "授权并开启此网站翻译" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "打开设置" }));
    expect(openOptions).toHaveBeenCalledOnce();
  });

  it("popup 对 Chrome 内部页显示不支持状态，不提供授权开关", async () => {
    const client: CredentialClient = { status: vi.fn().mockResolvedValue({ configured: false }), save: vi.fn(), clear: vi.fn() };
    render(<PopupPage client={client} siteClient={siteClient({ kind: "unsupported" })} openOptions={vi.fn()} />);

    expect(await screen.findByText("此页面不支持翻译")).toBeVisible();
    expect(screen.queryByRole("button", { name: "授权并开启此网站翻译" })).not.toBeInTheDocument();
  });

  it("权限被拒绝后保留未授权状态", async () => {
    const client: CredentialClient = { status: vi.fn().mockResolvedValue({ configured: false }), save: vi.fn(), clear: vi.fn() };
    const currentSite: SiteToggleClient = {
      status: vi.fn().mockResolvedValue({ kind: "not-authorized", domain: "article.example.test" }),
      enable: vi.fn().mockResolvedValue({ ok: false, error: "PERMISSION_DENIED" }),
      disable: vi.fn(),
      setTargetLanguage: vi.fn(),
    };
    render(<PopupPage client={client} siteClient={currentSite} openOptions={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "授权并开启此网站翻译" }));

    expect(await screen.findByText("未获授权，未启用页面翻译")).toBeVisible();
    expect(currentSite.disable).not.toHaveBeenCalled();
  });

  it("已授权网站可关闭页面翻译，并以当前页面会话停止为结果", async () => {
    const client: CredentialClient = { status: vi.fn().mockResolvedValue({ configured: true }), save: vi.fn(), clear: vi.fn() };
    const currentSite: SiteToggleClient = {
      status: vi.fn().mockResolvedValue({ kind: "authorized", domain: "article.example.test", settings: { enabled: true, targetLanguage: "zh" } }),
      enable: vi.fn(),
      disable: vi.fn().mockResolvedValue({ ok: true, status: { kind: "authorized", domain: "article.example.test", settings: { enabled: false, targetLanguage: "zh" } } }),
      setTargetLanguage: vi.fn(),
    };
    render(<PopupPage client={client} siteClient={currentSite} openOptions={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "关闭此网站翻译" }));

    expect(await screen.findByText("此网站翻译已关闭")).toBeVisible();
    expect(currentSite.disable).toHaveBeenCalledOnce();
  });

  it("popup 只提供当前百度 MVP 目标语言，并将选择保存到当前网站", async () => {
    const client: CredentialClient = { status: vi.fn().mockResolvedValue({ configured: true }), save: vi.fn(), clear: vi.fn() };
    const currentSite: SiteToggleClient = {
      status: vi.fn().mockResolvedValue({ kind: "authorized", domain: "article.example.test", settings: { enabled: true, targetLanguage: "zh" } }),
      enable: vi.fn(),
      disable: vi.fn(),
      setTargetLanguage: vi.fn().mockResolvedValue({ ok: true, status: { kind: "authorized", domain: "article.example.test", settings: { enabled: true, targetLanguage: "jp" } } }),
    };
    render(<PopupPage client={client} siteClient={currentSite} openOptions={vi.fn()} />);

    const control = await screen.findByLabelText("目标语言");
    expect(Array.from((control as HTMLSelectElement).options).map((option) => option.value)).toEqual(["zh", "en", "jp", "kor", "spa"]);
    expect(screen.queryByRole("option", { name: "法语" })).not.toBeInTheDocument();
    await userEvent.selectOptions(control, "jp");

    expect(currentSite.setTargetLanguage).toHaveBeenCalledWith("jp");
    expect(await screen.findByText("目标语言：日语")).toBeVisible();
  });

  it("设置页保存后只显示已配置状态且不回显密钥", async () => {
    const client: CredentialClient = {
      status: vi.fn().mockResolvedValue({ configured: false }),
      save: vi.fn().mockResolvedValue({ ok: true, status: { configured: true } }),
      clear: vi.fn(),
    };
    render(<OptionsPage client={client} />);

    await screen.findByText("尚未配置翻译服务");
    await userEvent.type(screen.getByLabelText("百度 APPID"), "test-app");
    await userEvent.type(screen.getByLabelText("密钥"), "x");
    fireEvent.submit(screen.getByRole("button", { name: "保存凭据" }).closest("form")!);

    await waitFor(() => expect(screen.getByText("已配置翻译服务")).toBeVisible());
    expect(screen.queryByText("x")).not.toBeInTheDocument();
    expect(screen.getByLabelText("密钥")).toHaveValue("");
  });

  it("设置页能清除已保存的假凭据", async () => {
    const client: CredentialClient = {
      status: vi.fn().mockResolvedValue({ configured: true }),
      save: vi.fn(),
      clear: vi.fn().mockResolvedValue({ ok: true, status: { configured: false } }),
    };
    render(<OptionsPage client={client} />);

    expect(await screen.findByText("已配置翻译服务")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "清除凭据" }));
    await waitFor(() => expect(screen.getByText("尚未配置翻译服务")).toBeVisible());
  });

  it("设置页以字符数和二次确认执行一次人工百度烟囱，不回显输入或输出正文", async () => {
    const credentialClient: CredentialClient = { status: vi.fn().mockResolvedValue({ configured: true }), save: vi.fn(), clear: vi.fn() };
    const usageClient: TranslationUsageClient = {
      get: vi.fn().mockResolvedValue({ ok: true, snapshot: { settings: { plan: "standard", monthlyCharacterBudget: 50_000 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 50_000 } }),
      update: vi.fn(),
    };
    const smokeClient: BaiduManualSmokeClient = {
      prepare: vi.fn().mockResolvedValue({ ok: true, confirmationToken: "opaque", sourceCharacterCount: 19 }),
      run: vi.fn().mockResolvedValue({ ok: true, provider: "baidu", submittedCharacters: 19 }),
    };
    const permissionClient: BaiduProviderPermissionClient = { ensure: vi.fn().mockResolvedValue(true) };
    render(<OptionsPage client={credentialClient} usageClient={usageClient} manualSmokeClient={smokeClient} providerPermissionClient={permissionClient} />);

    for (const label of ["当前免费额度与计费条款", "QPS", "可用语言方向", "单次长度", "数据处理条款"]) {
      await userEvent.click(await screen.findByLabelText(label));
    }
    await userEvent.click(screen.getByRole("button", { name: "准备人工烟囱测试" }));
    expect(permissionClient.ensure).toHaveBeenCalledOnce();
    expect(smokeClient.prepare).toHaveBeenCalledWith({
      plan: "standard",
      quotaAndPricingConfirmed: true,
      qpsConfirmed: true,
      languageDirectionsConfirmed: true,
      singleRequestLengthConfirmed: true,
      dataTermsConfirmed: true,
    });
    expect(await screen.findByText("本次将提交 19 个源字符。")) .toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "确认并发送一次人工烟囱请求" }));
    expect(smokeClient.run).toHaveBeenCalledWith("opaque");
    expect(await screen.findByText("人工烟囱已通过；重新确认当前标签页后，后续页面翻译将使用百度。")) .toBeVisible();
    expect(screen.queryByText("opaque")).not.toBeInTheDocument();
  });

  it.each([
    ["AUTHENTICATION_FAILED", "百度鉴权失败，请核对 APPID、密钥和服务开通状态"],
    ["NETWORK_ERROR", "无法连接百度翻译服务，请检查网络"],
    ["TIMEOUT", "百度翻译服务响应超时"],
    ["RATE_LIMITED", "请求频率受限，请按当前账户 QPS 稍后手动重试"],
    ["PROVIDER_QUOTA_EXHAUSTED", "百度账户额度不足或已耗尽，请核对账户额度"],
    ["UNSUPPORTED_LANGUAGE", "百度账户不支持本次语言方向"],
    ["INVALID_REQUEST", "百度拒绝了固定测试请求，请核对接口产品与账号权限"],
    ["CONTENT_RISK", "百度内容安全策略拒绝了固定测试请求"],
    ["SERVICE_UNAVAILABLE", "百度翻译服务暂不可用"],
  ] as const)("人工烟囱以脱敏类别告知用户 %s，不暴露服务端详情", async (error, safeCategory) => {
    const credentialClient: CredentialClient = { status: vi.fn().mockResolvedValue({ configured: true }), save: vi.fn(), clear: vi.fn() };
    const usageClient: TranslationUsageClient = {
      get: vi.fn().mockResolvedValue({ ok: true, snapshot: { settings: { plan: "standard", monthlyCharacterBudget: 50_000 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 50_000 } }),
      update: vi.fn(),
    };
    const smokeClient: BaiduManualSmokeClient = {
      prepare: vi.fn().mockResolvedValue({ ok: true, confirmationToken: "opaque", sourceCharacterCount: 19 }),
      run: vi.fn().mockResolvedValue({ ok: false, error }),
    };
    const permissionClient: BaiduProviderPermissionClient = { ensure: vi.fn().mockResolvedValue(true) };
    render(<OptionsPage client={credentialClient} usageClient={usageClient} manualSmokeClient={smokeClient} providerPermissionClient={permissionClient} />);

    await userEvent.click(await screen.findByRole("button", { name: "准备人工烟囱测试" }));
    await screen.findByText("本次将提交 19 个源字符。");
    await userEvent.click(screen.getByRole("button", { name: "确认并发送一次人工烟囱请求" }));

    expect(await screen.findByText(new RegExp(safeCategory))).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("仅显示脱敏类别，系统不会自动重试。");
    expect(screen.queryByText("server detail")).not.toBeInTheDocument();
    expect(smokeClient.run).toHaveBeenCalledOnce();
  });

  it.each([
    ["READINESS_STORAGE_FAILURE", "百度请求已成功发送，但扩展无法保存通过状态", false],
    ["USAGE_RESERVATION_FAILURE", "无法预留本地用量", true],
    ["RUN_INTERNAL_FAILURE", "请求状态无法确认", false],
  ] as const)("运行阶段基础设施失败 %s 会如实说明请求状态", async (error, safeCategory, definitelyNotSent) => {
    const credentialClient: CredentialClient = { status: vi.fn().mockResolvedValue({ configured: true }), save: vi.fn(), clear: vi.fn() };
    const usageClient: TranslationUsageClient = {
      get: vi.fn().mockResolvedValue({ ok: true, snapshot: { settings: { plan: "standard", monthlyCharacterBudget: 50_000 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 50_000 } }),
      update: vi.fn(),
    };
    const smokeClient: BaiduManualSmokeClient = {
      prepare: vi.fn().mockResolvedValue({ ok: true, confirmationToken: "opaque", sourceCharacterCount: 19 }),
      run: vi.fn().mockResolvedValue({ ok: false, error }),
    };
    const permissionClient: BaiduProviderPermissionClient = { ensure: vi.fn().mockResolvedValue(true) };
    render(<OptionsPage client={credentialClient} usageClient={usageClient} manualSmokeClient={smokeClient} providerPermissionClient={permissionClient} />);

    await userEvent.click(await screen.findByRole("button", { name: "准备人工烟囱测试" }));
    await screen.findByText("本次将提交 19 个源字符。");
    await userEvent.click(screen.getByRole("button", { name: "确认并发送一次人工烟囱请求" }));

    expect(await screen.findByText(new RegExp(safeCategory))).toBeVisible();
    if (definitelyNotSent) expect(screen.getByRole("alert")).toHaveTextContent("未发送请求");
    else expect(screen.getByRole("alert")).not.toHaveTextContent("未发送请求");
    expect(smokeClient.run).toHaveBeenCalledOnce();
  });

  it("烟囱失败不回显原始错误附加字段，且不会自动重试", async () => {
    const credentialClient: CredentialClient = { status: vi.fn().mockResolvedValue({ configured: true }), save: vi.fn(), clear: vi.fn() };
    const usageClient: TranslationUsageClient = {
      get: vi.fn().mockResolvedValue({ ok: true, snapshot: { settings: { plan: "standard", monthlyCharacterBudget: 50_000 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 50_000 } }),
      update: vi.fn(),
    };
    const rawFailure = {
      ok: false,
      error: "AUTHENTICATION_FAILED",
      providerMessage: "server detail",
      responseBody: "translated secret",
      request: "q=private page text",
      credentials: "secret-value",
    } as unknown as BaiduManualSmokeRunResult;
    const smokeClient: BaiduManualSmokeClient = {
      prepare: vi.fn().mockResolvedValue({ ok: true, confirmationToken: "opaque", sourceCharacterCount: 19 }),
      run: vi.fn().mockResolvedValue(rawFailure),
    };
    const permissionClient: BaiduProviderPermissionClient = { ensure: vi.fn().mockResolvedValue(true) };
    render(<OptionsPage client={credentialClient} usageClient={usageClient} manualSmokeClient={smokeClient} providerPermissionClient={permissionClient} />);

    await userEvent.click(await screen.findByRole("button", { name: "准备人工烟囱测试" }));
    await screen.findByText("本次将提交 19 个源字符。");
    await userEvent.click(screen.getByRole("button", { name: "确认并发送一次人工烟囱请求" }));

    expect(await screen.findByText(/百度鉴权失败/)).toBeVisible();
    expect(screen.queryByText(/server detail|translated secret|private page text|secret-value/)).not.toBeInTheDocument();
    expect(smokeClient.run).toHaveBeenCalledOnce();
  });

  it.each([
    ["CREDENTIAL_STORAGE_FAILURE", "无法读取后台凭据状态"],
    ["USAGE_STORAGE_FAILURE", "无法读取或更新本地预算状态"],
    ["TOKEN_GENERATION_FAILURE", "后台无法创建一次性确认令牌"],
    ["PREPARE_INTERNAL_FAILURE", "人工烟囱准备流程内部异常"],
    ["WORKER_OPERATION_FAILURE", "后台安全队列异常"],
    ["STORAGE_FAILURE", "扩展本地存储或后台服务异常"],
    ["UNTRUSTED_SENDER", "扩展页面来源不受信任"],
    ["UNAVAILABLE", "扩展后台 service worker 尚未就绪"],
  ] as const)("预检失败以脱敏类别告知用户 %s，不发送请求", async (error, safeCategory) => {
    const credentialClient: CredentialClient = { status: vi.fn().mockResolvedValue({ configured: true }), save: vi.fn(), clear: vi.fn() };
    const usageClient: TranslationUsageClient = {
      get: vi.fn().mockResolvedValue({ ok: true, snapshot: { settings: { plan: "standard", monthlyCharacterBudget: 50_000 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 50_000 } }),
      update: vi.fn(),
    };
    const smokeClient: BaiduManualSmokeClient = {
      prepare: vi.fn().mockResolvedValue({ ok: false, error }),
      run: vi.fn(),
    };
    const permissionClient: BaiduProviderPermissionClient = { ensure: vi.fn().mockResolvedValue(true) };
    render(<OptionsPage client={credentialClient} usageClient={usageClient} manualSmokeClient={smokeClient} providerPermissionClient={permissionClient} />);

    await userEvent.click(await screen.findByRole("button", { name: "准备人工烟囱测试" }));
    expect(await screen.findByText(new RegExp(safeCategory))).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("未发送请求");
    expect(smokeClient.run).not.toHaveBeenCalled();
  });

  it("真实服务权限拒绝或安全门错误都不会触发提交，也不会显示服务端详情", async () => {
    const credentialClient: CredentialClient = { status: vi.fn().mockResolvedValue({ configured: true }), save: vi.fn(), clear: vi.fn() };
    const usageClient: TranslationUsageClient = {
      get: vi.fn().mockResolvedValue({ ok: true, snapshot: { settings: { plan: "standard", monthlyCharacterBudget: 50_000 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 50_000 } }),
      update: vi.fn(),
    };
    const prepare = vi.fn();
    const smokeClient: BaiduManualSmokeClient = { prepare, run: vi.fn() };
    const permissionClient: BaiduProviderPermissionClient = { ensure: vi.fn().mockResolvedValue(false) };
    render(<OptionsPage client={credentialClient} usageClient={usageClient} manualSmokeClient={smokeClient} providerPermissionClient={permissionClient} />);

    await userEvent.click(await screen.findByRole("button", { name: "准备人工烟囱测试" }));

    expect(await screen.findByText("未获得百度服务所需权限，未发送任何请求。")).toBeVisible();
    expect(prepare).not.toHaveBeenCalled();
    expect(screen.queryByText("server detail")).not.toBeInTheDocument();
  });

  it("权限、准备和确认的 Promise 拒绝都只显示有限提示，且不会留下可用确认", async () => {
    const credentialClient: CredentialClient = { status: vi.fn().mockResolvedValue({ configured: true }), save: vi.fn(), clear: vi.fn() };
    const usageClient: TranslationUsageClient = {
      get: vi.fn().mockResolvedValue({ ok: true, snapshot: { settings: { plan: "standard", monthlyCharacterBudget: 50_000 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 50_000 } }),
      update: vi.fn(),
    };
    const genericFailure = "人工烟囱未通过；未显示服务端详情，系统不会自动重试。";
    const permissionRejected: BaiduProviderPermissionClient = { ensure: vi.fn().mockRejectedValue(new Error("server detail")) };
    const noPrepare: BaiduManualSmokeClient = { prepare: vi.fn(), run: vi.fn() };
    const first = render(<OptionsPage client={credentialClient} usageClient={usageClient} manualSmokeClient={noPrepare} providerPermissionClient={permissionRejected} />);
    await userEvent.click(await screen.findByRole("button", { name: "准备人工烟囱测试" }));
    expect(await screen.findByText(genericFailure)).toBeVisible();
    expect(noPrepare.prepare).not.toHaveBeenCalled();
    first.unmount();

    const prepareRejected: BaiduManualSmokeClient = { prepare: vi.fn().mockRejectedValue(new Error("server detail")), run: vi.fn() };
    const permissionGranted: BaiduProviderPermissionClient = { ensure: vi.fn().mockResolvedValue(true) };
    const second = render(<OptionsPage client={credentialClient} usageClient={usageClient} manualSmokeClient={prepareRejected} providerPermissionClient={permissionGranted} />);
    await userEvent.click(await screen.findByRole("button", { name: "准备人工烟囱测试" }));
    expect(await screen.findByText(genericFailure)).toBeVisible();
    expect(screen.queryByText(/本次将提交/)).not.toBeInTheDocument();
    second.unmount();

    const runRejected: BaiduManualSmokeClient = {
      prepare: vi.fn().mockResolvedValue({ ok: true, confirmationToken: "opaque", sourceCharacterCount: 19 }),
      run: vi.fn().mockRejectedValue(new Error("server detail")),
    };
    render(<OptionsPage client={credentialClient} usageClient={usageClient} manualSmokeClient={runRejected} providerPermissionClient={permissionGranted} />);
    await userEvent.click(await screen.findByRole("button", { name: "准备人工烟囱测试" }));
    await screen.findByText("本次将提交 19 个源字符。");
    await userEvent.click(screen.getByRole("button", { name: "确认并发送一次人工烟囱请求" }));
    expect(await screen.findByText(genericFailure)).toBeVisible();
    expect(screen.queryByText("人工烟囱已通过；重新确认当前标签页后，后续页面翻译将使用百度。")) .not.toBeInTheDocument();
  });

  it("待处理中的准备请求只能启动一次，避免重复点击竞态", async () => {
    let grant: ((granted: boolean) => void) | undefined;
    const credentialClient: CredentialClient = { status: vi.fn().mockResolvedValue({ configured: true }), save: vi.fn(), clear: vi.fn() };
    const usageClient: TranslationUsageClient = { get: vi.fn().mockResolvedValue({ ok: true, snapshot: { settings: { plan: "standard", monthlyCharacterBudget: 50_000 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 50_000 } }), update: vi.fn() };
    const permissionClient: BaiduProviderPermissionClient = { ensure: vi.fn(() => new Promise<boolean>((resolve) => { grant = resolve; })) };
    const smokeClient: BaiduManualSmokeClient = { prepare: vi.fn().mockResolvedValue({ ok: false, error: "ACCOUNT_REVIEW_REQUIRED" }), run: vi.fn() };
    render(<OptionsPage client={credentialClient} usageClient={usageClient} manualSmokeClient={smokeClient} providerPermissionClient={permissionClient} />);

    const button = await screen.findByRole("button", { name: "准备人工烟囱测试" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(permissionClient.ensure).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "正在准备人工烟囱测试…" })).toBeDisabled();
    expect(screen.getByLabelText("百度套餐")).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存凭据" })).toBeDisabled();
    grant?.(true);
    await waitFor(() => expect(smokeClient.prepare).toHaveBeenCalledOnce());
  });

  it("准备后撤回任一账户确认会立即废止令牌并要求重新准备", async () => {
    const credentialClient: CredentialClient = { status: vi.fn().mockResolvedValue({ configured: true }), save: vi.fn(), clear: vi.fn() };
    const usageClient: TranslationUsageClient = { get: vi.fn().mockResolvedValue({ ok: true, snapshot: { settings: { plan: "standard", monthlyCharacterBudget: 50_000 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 50_000 } }), update: vi.fn() };
    const smokeClient: BaiduManualSmokeClient = {
      prepare: vi.fn().mockResolvedValue({ ok: true, confirmationToken: "opaque", sourceCharacterCount: 19 }),
      run: vi.fn(),
    };
    const permissionClient: BaiduProviderPermissionClient = { ensure: vi.fn().mockResolvedValue(true) };
    render(<OptionsPage client={credentialClient} usageClient={usageClient} manualSmokeClient={smokeClient} providerPermissionClient={permissionClient} />);

    for (const label of ["当前免费额度与计费条款", "QPS", "可用语言方向", "单次长度", "数据处理条款"]) {
      await userEvent.click(await screen.findByLabelText(label));
    }
    await userEvent.click(screen.getByRole("button", { name: "准备人工烟囱测试" }));
    expect(await screen.findByText("本次将提交 19 个源字符。")) .toBeVisible();

    await userEvent.click(screen.getByLabelText("QPS"));
    expect(screen.queryByText("本次将提交 19 个源字符。")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "准备人工烟囱测试" })).toBeVisible();
    expect(smokeClient.run).not.toHaveBeenCalled();
  });

  it("套餐、成功保存本地用量以及凭据变更都会废止旧账户审查和确认", async () => {
    const credentialClient: CredentialClient = {
      status: vi.fn().mockResolvedValue({ configured: true }),
      save: vi.fn().mockResolvedValue({ ok: true, status: { configured: true } }),
      clear: vi.fn().mockResolvedValue({ ok: true, status: { configured: false } }),
    };
    const usageClient: TranslationUsageClient = {
      get: vi.fn().mockResolvedValue({ ok: true, snapshot: { settings: { plan: "standard", monthlyCharacterBudget: 50_000 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 50_000 } }),
      update: vi.fn().mockResolvedValue({ ok: true, snapshot: { settings: { plan: "advanced", monthlyCharacterBudget: 50_000 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 50_000 } }),
    };
    const smokeClient: BaiduManualSmokeClient = {
      prepare: vi.fn().mockResolvedValue({ ok: true, confirmationToken: "opaque", sourceCharacterCount: 19 }),
      run: vi.fn().mockResolvedValue({ ok: true, provider: "baidu", submittedCharacters: 19 }),
    };
    const permissionClient: BaiduProviderPermissionClient = { ensure: vi.fn().mockResolvedValue(true) };
    render(<OptionsPage client={credentialClient} usageClient={usageClient} manualSmokeClient={smokeClient} providerPermissionClient={permissionClient} />);
    const labels = ["当前免费额度与计费条款", "QPS", "可用语言方向", "单次长度", "数据处理条款"];
    const completeReview = async () => {
      for (const label of labels) await userEvent.click(screen.getByLabelText(label));
    };
    const prepare = async () => {
      await userEvent.click(screen.getByRole("button", { name: "准备人工烟囱测试" }));
      await screen.findByText("本次将提交 19 个源字符。");
    };

    await completeReview();
    await prepare();
    await userEvent.click(screen.getByRole("button", { name: "确认并发送一次人工烟囱请求" }));
    await screen.findByText("人工烟囱已通过；重新确认当前标签页后，后续页面翻译将使用百度。");
    await userEvent.selectOptions(screen.getByLabelText("百度套餐"), "advanced");
    expect(screen.queryByText("人工烟囱已通过；重新确认当前标签页后，后续页面翻译将使用百度。")) .not.toBeInTheDocument();
    for (const label of labels) expect(screen.getByLabelText(label)).not.toBeChecked();

    await completeReview();
    await prepare();
    await userEvent.click(screen.getByRole("button", { name: "保存本地预算" }));
    await waitFor(() => expect(screen.queryByText(/本次将提交/)).not.toBeInTheDocument());
    for (const label of labels) expect(screen.getByLabelText(label)).not.toBeChecked();

    await completeReview();
    await prepare();
    await userEvent.type(screen.getByLabelText("百度 APPID"), "local-app");
    await userEvent.type(screen.getByLabelText("密钥"), "local-secret");
    fireEvent.submit(screen.getByRole("button", { name: "保存凭据" }).closest("form")!);
    await waitFor(() => expect(screen.queryByText(/本次将提交/)).not.toBeInTheDocument());
    for (const label of labels) expect(screen.getByLabelText(label)).not.toBeChecked();

    await completeReview();
    await prepare();
    await userEvent.click(screen.getByRole("button", { name: "清除凭据" }));
    await waitFor(() => expect(screen.queryByText(/本次将提交/)).not.toBeInTheDocument());
    for (const label of labels) expect(screen.getByLabelText(label)).not.toBeChecked();
  });
});
