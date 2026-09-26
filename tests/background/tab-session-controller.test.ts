import { describe, expect, it, vi } from "vitest";
import { createTabSessionController } from "../../src/background/tab-session-controller";

const provider = { adapter: "fake" as const, version: "fake-v1" };

function createController({ active = true, enabled = true, compatibilityPaused = false }: { active?: boolean; enabled?: boolean; compatibilityPaused?: boolean } = {}) {
  return createTabSessionController({
    provider,
    getTabSite: vi.fn().mockResolvedValue({ domain: "article.example.test", origin: "https://article.example.test/*" }),
    isTabActive: vi.fn().mockResolvedValue(active),
    hasHostPermission: vi.fn().mockResolvedValue(true),
    getSettings: vi.fn().mockResolvedValue({ enabled, targetLanguage: "zh" }),
    isDomainCompatibilityPaused: vi.fn().mockResolvedValue(compatibilityPaused),
    createSessionId: (() => {
      let next = 0;
      return () => `session-${++next}`;
    })(),
  });
}

describe("标签页切入会话行为接缝", () => {
  it("同一 tab 的并发 top/frame reconnect 线性化为一个 stay，不能互相覆盖待确认状态", async () => {
    const controller = createController();

    const [top, child] = await Promise.all([controller.connect(7), controller.connect(7)]);

    expect(top).toMatchObject({ ok: true, disposition: "awaiting-decision" });
    expect(child).toMatchObject({ ok: true, disposition: "awaiting-decision" });
    if (!top.ok || !child.ok) throw new Error("预期同一 tab 返回可用 stay");
    expect(child.session.id).toBe(top.session.id);
  });

  it("会话尚未落地时后台化或域停用会废止异步 reconnect，不能在事后创建 stay", async () => {
    const settingResolvers: Array<(value: { enabled: boolean; targetLanguage: "zh" }) => void> = [];
    const controller = createTabSessionController({
      provider,
      getTabSite: vi.fn().mockResolvedValue({ domain: "article.example.test", origin: "https://article.example.test/*" }),
      isTabActive: vi.fn().mockResolvedValue(true),
      hasHostPermission: vi.fn().mockResolvedValue(true),
      getSettings: vi.fn(() => new Promise<{ enabled: boolean; targetLanguage: "zh" }>((resolve) => { settingResolvers.push(resolve); })),
      createSessionId: () => "stay-race",
    });

    const pausedConnect = controller.connect(7);
    await vi.waitFor(() => expect(settingResolvers).toHaveLength(1));
    controller.pauseAllExcept(8);
    settingResolvers.shift()?.({ enabled: true, targetLanguage: "zh" });
    await expect(pausedConnect).resolves.toEqual({ ok: false, error: "UNAVAILABLE" });

    const invalidatedConnect = controller.connect(7);
    await vi.waitFor(() => expect(settingResolvers).toHaveLength(1));
    controller.invalidateDomain("article.example.test");
    settingResolvers.shift()?.({ enabled: true, targetLanguage: "zh" });
    await expect(invalidatedConnect).resolves.toEqual({ ok: false, error: "UNAVAILABLE" });
  });

  it("已开启且当前可见的标签页必须先处于待确认状态，确认后才允许提交", async () => {
    const controller = createController();

    const pending = await controller.foreground(7);

    expect(pending).toMatchObject({ ok: true, disposition: "awaiting-decision", targetLanguage: "zh", provider });
    if (!pending.ok) throw new Error("预期前台会话");
    expect(await controller.permits(7, pending.session.id)).toBe(false);
    await expect(controller.decide(7, pending.session.id, "accept")).resolves.toEqual({ ok: true, disposition: "allowed" });
    expect(await controller.permits(7, pending.session.id)).toBe(true);
  });

  it("拒绝保留会话但不会许可新的翻译；下次切回使用新的待确认会话", async () => {
    const controller = createController();
    const first = await controller.foreground(7);
    if (!first.ok) throw new Error("预期前台会话");

    await expect(controller.decide(7, first.session.id, "reject")).resolves.toEqual({ ok: true, disposition: "rejected" });
    expect(await controller.permits(7, first.session.id)).toBe(false);
    expect(controller.pause(7)).toEqual({ session: first.session, reason: "background" });

    const second = await controller.foreground(7);
    expect(second).toMatchObject({ ok: true, disposition: "awaiting-decision" });
    if (!second.ok) throw new Error("预期新的前台会话");
    expect(second.session.id).not.toBe(first.session.id);
  });

  it("后台、未开启或过期会话均 fail closed，且不会建立可提交会话", async () => {
    await expect(createController({ active: false }).foreground(7)).resolves.toEqual({ ok: false, error: "UNAVAILABLE" });
    await expect(createController({ enabled: false }).foreground(7)).resolves.toEqual({ ok: false, error: "UNAVAILABLE" });

    const controller = createController();
    const first = await controller.foreground(7);
    if (!first.ok) throw new Error("预期前台会话");
    controller.pause(7);
    const second = await controller.foreground(7);
    if (!second.ok) throw new Error("预期新会话");
    await controller.decide(7, second.session.id, "accept");

    await expect(controller.decide(7, first.session.id, "accept")).resolves.toEqual({ ok: false, error: "STALE_SESSION" });
    expect(await controller.permits(7, first.session.id)).toBe(false);
    expect(await controller.permits(7, second.session.id)).toBe(true);
  });

  it("已知高风险域名在持久兼容性暂停期间不建立会话，其他域名仍可用", async () => {
    const paused = createController({ compatibilityPaused: true });
    await expect(paused.foreground(7)).resolves.toEqual({ ok: false, error: "UNAVAILABLE" });

    const safe = createController({ compatibilityPaused: false });
    await expect(safe.foreground(7)).resolves.toMatchObject({ ok: true, disposition: "awaiting-decision" });
  });

  it("标签页各自隔离会话与确认状态", async () => {
    const controller = createController();
    const first = await controller.foreground(7);
    const second = await controller.foreground(8);
    if (!first.ok || !second.ok) throw new Error("预期前台会话");

    await controller.decide(7, first.session.id, "accept");

    expect(await controller.permits(7, first.session.id)).toBe(true);
    expect(await controller.permits(8, second.session.id)).toBe(false);
  });

  it("首次切入另一标签页时可枚举并废止已有停留，旧会话不再许可提交", async () => {
    const controller = createController();
    const first = await controller.foreground(7);
    if (!first.ok) throw new Error("预期前台会话");
    await controller.decide(7, first.session.id, "accept");

    expect(controller.pauseAllExcept(8)).toEqual([{ tabId: 7, session: first.session, reason: "background" }]);
    expect(await controller.permits(7, first.session.id)).toBe(false);
  });

  it("切入未开启标签页前仍先废止已知标签页会话，避免迟到结果写回旧页", async () => {
    const controller = createTabSessionController({
      provider,
      getTabSite: vi.fn((tabId: number) => Promise.resolve(tabId === 7
        ? { domain: "enabled.example.test", origin: "https://enabled.example.test/*" }
        : { domain: "disabled.example.test", origin: "https://disabled.example.test/*" })),
      isTabActive: vi.fn().mockResolvedValue(true),
      hasHostPermission: vi.fn().mockResolvedValue(true),
      getSettings: vi.fn((domain: string) => Promise.resolve({ enabled: domain === "enabled.example.test", targetLanguage: "zh" as const })),
      createSessionId: () => "stay-enabled",
    });
    const enabled = await controller.foreground(7);
    if (!enabled.ok) throw new Error("预期已开启标签页有会话");
    await controller.decide(7, enabled.session.id, "accept");

    expect(controller.pauseAllExcept(8)).toEqual([{ tabId: 7, session: enabled.session, reason: "background" }]);
    await expect(controller.foreground(8)).resolves.toEqual({ ok: false, error: "UNAVAILABLE" });
    expect(await controller.permits(7, enabled.session.id)).toBe(false);
  });

  it("延迟的 S1 废止不会误删其后建立的 S2", async () => {
    const controller = createController();
    const first = await controller.foreground(7);
    const second = await controller.foreground(7);
    if (!first.ok || !second.ok) throw new Error("预期两个连续前台会话");
    await controller.decide(7, second.session.id, "accept");

    expect(controller.pause(7, first.session.id)).toBeUndefined();
    expect(await controller.permits(7, second.session.id)).toBe(true);
  });

  it("同一前台停留重新连接时采用当前网站目标语言，但保留既有许可", async () => {
    let targetLanguage: "zh" | "jp" = "zh";
    const controller = createTabSessionController({
      provider,
      getTabSite: vi.fn().mockResolvedValue({ domain: "article.example.test", origin: "https://article.example.test/*" }),
      isTabActive: vi.fn().mockResolvedValue(true),
      hasHostPermission: vi.fn().mockResolvedValue(true),
      getSettings: vi.fn(() => Promise.resolve({ enabled: true, targetLanguage })),
      createSessionId: () => "stay-1",
    });
    const first = await controller.foreground(7);
    if (!first.ok) throw new Error("预期前台会话");
    await controller.decide(7, first.session.id, "accept");
    targetLanguage = "jp";

    await expect(controller.connect(7)).resolves.toMatchObject({
      ok: true,
      session: first.session,
      disposition: "allowed",
      targetLanguage: "jp",
    });
    expect(await controller.permits(7, first.session.id)).toBe(true);
  });

  it("目标语言更新后拒绝同会话旧语言任务，且不改变其他标签页的语言或 provider 版本", async () => {
    const targets = new Map<string, "zh" | "en" | "jp">([["a.example.test", "zh"], ["b.example.test", "en"]]);
    const controller = createTabSessionController({
      provider,
      getTabSite: vi.fn((tabId: number) => Promise.resolve(tabId === 7
        ? { domain: "a.example.test", origin: "https://a.example.test/*" }
        : { domain: "b.example.test", origin: "https://b.example.test/*" })),
      isTabActive: vi.fn().mockResolvedValue(true),
      hasHostPermission: vi.fn().mockResolvedValue(true),
      getSettings: vi.fn((domain: string) => Promise.resolve({ enabled: true, targetLanguage: targets.get(domain)! })),
      createSessionId: (() => {
        let index = 0;
        return () => `stay-${++index}`;
      })(),
    });
    const a = await controller.foreground(7);
    const b = await controller.foreground(8);
    if (!a.ok || !b.ok) throw new Error("预期两个站点均建立会话");
    await controller.decide(7, a.session.id, "accept");
    await controller.decide(8, b.session.id, "accept");
    targets.set("a.example.test", "jp");

    controller.updateDomainTargetLanguage("a.example.test", "jp");
    expect(await controller.permits(7, a.session.id, "zh" as never)).toBe(false);
    expect(await controller.permits(7, a.session.id, "jp" as never)).toBe(true);
    await expect(controller.connect(8)).resolves.toMatchObject({ targetLanguage: "en", provider });
  });

  it("前台许可检查等待依赖期间被暂停时，旧异步检查不能重新放行", async () => {
    let resolvePermission: ((allowed: boolean) => void) | undefined;
    const hasHostPermission = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { resolvePermission = resolve; }));
    const controller = createTabSessionController({
      provider,
      getTabSite: vi.fn().mockResolvedValue({ domain: "article.example.test", origin: "https://article.example.test/*" }),
      isTabActive: vi.fn().mockResolvedValue(true),
      hasHostPermission,
      getSettings: vi.fn().mockResolvedValue({ enabled: true, targetLanguage: "zh" }),
      createSessionId: () => "stay-1",
    });
    const session = await controller.foreground(7);
    if (!session.ok) throw new Error("预期前台会话");
    await controller.decide(7, session.session.id, "accept");

    const permitted = controller.permits(7, session.session.id, "zh");
    await vi.waitFor(() => expect(hasHostPermission).toHaveBeenCalledTimes(3));
    controller.pause(7);
    resolvePermission?.(true);

    await expect(permitted).resolves.toBe(false);
  });

  it("权限与设置读取完成后仍复核标签页可见性和当前 hostname", async () => {
    let active = true;
    let resolvePermission: ((allowed: boolean) => void) | undefined;
    const hasHostPermission = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { resolvePermission = resolve; }));
    const controller = createTabSessionController({
      provider,
      getTabSite: vi.fn().mockResolvedValue({ domain: "article.example.test", origin: "https://article.example.test/*" }),
      isTabActive: vi.fn(() => Promise.resolve(active)),
      hasHostPermission,
      getSettings: vi.fn().mockResolvedValue({ enabled: true, targetLanguage: "zh" }),
      createSessionId: () => "stay-1",
    });
    const session = await controller.foreground(7);
    if (!session.ok) throw new Error("预期前台会话");
    await controller.decide(7, session.session.id, "accept");

    const permitted = controller.permits(7, session.session.id, "zh");
    await vi.waitFor(() => expect(hasHostPermission).toHaveBeenCalledTimes(3));
    active = false;
    resolvePermission?.(true);

    await expect(permitted).resolves.toBe(false);
  });

  it("许可检查等待期间目标语言更新后，旧语言任务不能重新通过", async () => {
    let resolvePermission: ((allowed: boolean) => void) | undefined;
    const hasHostPermission = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { resolvePermission = resolve; }));
    const controller = createTabSessionController({
      provider,
      getTabSite: vi.fn().mockResolvedValue({ domain: "article.example.test", origin: "https://article.example.test/*" }),
      isTabActive: vi.fn().mockResolvedValue(true),
      hasHostPermission,
      getSettings: vi.fn().mockResolvedValue({ enabled: true, targetLanguage: "zh" }),
      createSessionId: () => "stay-1",
    });
    const session = await controller.foreground(7);
    if (!session.ok) throw new Error("预期前台会话");
    await controller.decide(7, session.session.id, "accept");

    const permitted = controller.permits(7, session.session.id, "zh");
    await vi.waitFor(() => expect(hasHostPermission).toHaveBeenCalledTimes(3));
    controller.updateDomainTargetLanguage("article.example.test", "jp");
    resolvePermission?.(true);

    await expect(permitted).resolves.toBe(false);
  });

  it("创建新前台停留时读取当前 provider 快照，不让旧 stay 跟随 provider 切换", async () => {
    let currentProvider: { adapter: "fake" | "baidu"; version: string } = provider;
    const controller = createTabSessionController({
      provider: () => currentProvider,
      getTabSite: vi.fn().mockResolvedValue({ domain: "article.example.test", origin: "https://article.example.test/*" }),
      isTabActive: vi.fn().mockResolvedValue(true),
      hasHostPermission: vi.fn().mockResolvedValue(true),
      getSettings: vi.fn().mockResolvedValue({ enabled: true, targetLanguage: "zh" }),
      createSessionId: (() => { let index = 0; return () => `stay-${++index}`; })(),
    });
    const oldStay = await controller.foreground(7);
    if (!oldStay.ok) throw new Error("预期旧停留");
    currentProvider = { adapter: "baidu", version: "baidu-v1" };
    controller.pause(7, oldStay.session.id);

    await expect(controller.foreground(7)).resolves.toMatchObject({
      provider: { adapter: "baidu", version: "baidu-v1" },
    });
    expect(oldStay.provider).toEqual(provider);
  });
});
