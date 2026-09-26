/**
 * #27 的可执行放行门槛数据。
 *
 * 这里只保存样本 ID、检查状态和脱敏说明，不保存真实网站正文、译文、URL、
 * 账号或凭据。真实百度烟囱和四站人工验收必须由用户单独完成，不能由本模块
 * 推断为通过。
 */

export type MvpSampleGroup =
  | "english"
  | "mixed"
  | "long"
  | "japanese"
  | "korean"
  | "spanish";

export interface MvpSample {
  readonly id: string;
  readonly group: MvpSampleGroup;
  readonly sourceLanguage: "en" | "mixed" | "ja" | "ko" | "es";
  readonly targetLanguage: "zh";
  /** 只指向本地夹具类别，不包含页面内容。 */
  readonly fixtureRef: string;
}

const englishSamples: readonly MvpSample[] = Array.from({ length: 18 }, (_, index) => ({
  id: `EN-${String(index + 1).padStart(2, "0")}`,
  group: "english" as const,
  sourceLanguage: "en" as const,
  targetLanguage: "zh" as const,
  fixtureRef: index < 6 ? "static/article" : index < 12 ? "static/post" : "static/comment",
}));

const mixedSamples: readonly MvpSample[] = Array.from({ length: 4 }, (_, index) => ({
  id: `MIX-${String(index + 1).padStart(2, "0")}`,
  group: "mixed" as const,
  sourceLanguage: "mixed" as const,
  targetLanguage: "zh" as const,
  fixtureRef: "static/mixed-language",
}));

const longSamples: readonly MvpSample[] = Array.from({ length: 4 }, (_, index) => ({
  id: `LONG-${String(index + 1).padStart(2, "0")}`,
  group: "long" as const,
  sourceLanguage: "en" as const,
  targetLanguage: "zh" as const,
  fixtureRef: "static/long-text",
}));

const japaneseSamples: readonly MvpSample[] = Array.from({ length: 2 }, (_, index) => ({
  id: `JA-${String(index + 1).padStart(2, "0")}`,
  group: "japanese" as const,
  sourceLanguage: "ja" as const,
  targetLanguage: "zh" as const,
  fixtureRef: "static/language",
}));

export const MVP_SAMPLE_INDEX: readonly MvpSample[] = Object.freeze([
  ...englishSamples,
  ...mixedSamples,
  ...longSamples,
  ...japaneseSamples,
  {
    id: "KO-01",
    group: "korean",
    sourceLanguage: "ko",
    targetLanguage: "zh",
    fixtureRef: "static/language",
  },
  {
    id: "ES-01",
    group: "spanish",
    sourceLanguage: "es",
    targetLanguage: "zh",
    fixtureRef: "static/language",
  },
]);

export interface MvpSampleSummary {
  total: number;
  english: number;
  mixed: number;
  long: number;
  japanese: number;
  korean: number;
  spanish: number;
}

export function summarizeMvpSamples(samples: readonly MvpSample[]): MvpSampleSummary {
  const summary: MvpSampleSummary = {
    total: samples.length,
    english: 0,
    mixed: 0,
    long: 0,
    japanese: 0,
    korean: 0,
    spanish: 0,
  };
  for (const sample of samples) summary[sample.group] += 1;
  return summary;
}

export type ReleaseGateCheckStatus = "pass" | "pending" | "blocked" | "not-run";

export interface ReleaseGateCheck {
  readonly id: string;
  readonly title: string;
  readonly required: boolean;
  readonly status: ReleaseGateCheckStatus;
  readonly evidence: string;
}

/**
 * 这是 #27 的初始记录。它故意不把已有局部证据扩大成最终候选构建已通过。
 */
export const RELEASE_GATE_CHECKS: readonly ReleaseGateCheck[] = Object.freeze([
  {
    id: "automated-verify",
    title: "统一本地 verify",
    required: true,
    status: "not-run",
    evidence: "release:gate 不会自动运行 verify；当前候选证据另见 docs/acceptance/27-mvp-release-gate.md。",
  },
  {
    id: "behavior-matrix",
    title: "关键行为矩阵",
    required: true,
    status: "pending",
    evidence: "局部自动化测试已存在；尚未生成 #27 脱敏汇总。",
  },
  {
    id: "fixed-samples",
    title: "30 个固定样本集成完整性",
    required: true,
    status: "pending",
    evidence: "已建立仅含 ID 的索引；尚未填写逐样本验收结果。",
  },
  {
    id: "latency-and-scan",
    title: "加载、首条译文与扫描性能",
    required: true,
    status: "pending",
    evidence: "需从本地动态夹具记录中位数、P95、静止后请求与扫描计数。",
  },
  {
    id: "x-scroll-performance",
    title: "X 十分钟滚动与内存体感",
    required: true,
    status: "pending",
    evidence: "必须在当前 Chrome Stable 人工检查；本记录不代替人工结果。",
  },
  {
    id: "privacy-and-clear-data",
    title: "隐私阻断清单与清除本地数据",
    required: true,
    status: "pending",
    evidence: "自动化有凭据隔离/脱敏覆盖；完整清除链路仍需在候选构建验收。",
  },
  {
    id: "chrome-stable",
    title: "Chrome Stable 安装与扩展页人工验收",
    required: true,
    status: "pending",
    evidence: "#13 仅覆盖本地合成夹具；#27 候选构建需要重新留证。",
  },
  {
    id: "baidu-real-smoke",
    title: "真实百度烟囱测试",
    required: true,
    status: "pending",
    evidence: "未使用真实凭据，不能声称通过；由用户显式执行一次不超过 300 字符的测试。",
  },
  {
    id: "core-sites-manual-acceptance",
    title: "X、Wikipedia、GitHub、Hacker News 四站人工验收",
    required: true,
    status: "blocked",
    evidence: "依赖 #26；当前不得将真实网站核心路径标记为通过。",
  },
  {
    id: "ticket-26-dependency",
    title: "票据 #26 依赖解除",
    required: true,
    status: "pending",
    evidence: "#26 的本地通用修复已完成，但四站 Chrome Stable 人工核心路径尚未验收；在人工证据完成前保持 pending。",
  },
]);

export interface MvpReleaseGateResult {
  status: "ready" | "pending";
  blockers: readonly string[];
}

export function evaluateMvpReleaseGate(checks: readonly ReleaseGateCheck[]): MvpReleaseGateResult {
  const blockers = checks
    .filter(check => check.required && check.status !== "pass")
    .map(check => check.id);
  return blockers.length > 0
    ? { status: "pending", blockers }
    : { status: "ready", blockers: [] };
}
