import {
  MVP_SAMPLE_INDEX,
  RELEASE_GATE_CHECKS,
  evaluateMvpReleaseGate,
  summarizeMvpSamples,
} from "../src/shared/mvp-release-gate";

const strict = process.argv.includes("--strict");
const result = evaluateMvpReleaseGate(RELEASE_GATE_CHECKS);
const summary = summarizeMvpSamples(MVP_SAMPLE_INDEX);

console.log("MVP release gate (#27)");
console.log(`status: ${result.status}`);
console.log(`samples: ${summary.total} (en ${summary.english}, mixed ${summary.mixed}, long ${summary.long}, ja ${summary.japanese}, ko ${summary.korean}, es ${summary.spanish})`);
if (result.blockers.length > 0) {
  console.log(`blockers: ${result.blockers.join(", ")}`);
  console.log("真实百度 smoke 与四站人工验收不会由此命令自动执行或被推断为通过。");
}

// 默认信息性运行保持可执行但不阻塞；CI/发布前可显式使用 --strict。
if (strict && result.status !== "ready") process.exitCode = 1;
