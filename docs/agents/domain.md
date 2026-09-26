# 领域文档

本文规定工程技能在探索代码库时如何读取本仓库的领域文档。

## 开始探索前应读取

- 根目录的 **`CONTEXT.md`**；或者
- 如果根目录存在 **`CONTEXT-MAP.md`**，则按其中的指引找到各上下文的 `CONTEXT.md`，并读取与当前主题相关的文件。
- **`docs/adr/`** 中与即将处理区域相关的 ADR。在多上下文仓库中，还应检查 `src/<context>/docs/adr/` 内特定上下文的决策。

如果这些文件不存在，**直接继续，不作提示**。不要把缺失文件作为问题，也不要预先建议创建。`/domain-modeling` 技能（可由 `/grill-with-docs` 和 `/improve-codebase-architecture` 间接调用）会在术语或决策真正确定后按需创建它们。

## 文件结构

单上下文仓库（绝大多数仓库）：

```text
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

多上下文仓库（根目录存在 `CONTEXT-MAP.md`）：

```text
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← 系统级决策
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← 上下文专属决策
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## 使用词汇表中的术语

当输出内容需要命名领域概念时，例如议题标题、重构建议、假设或测试名称，应使用 `CONTEXT.md` 定义的术语，不要漂移到词汇表明确要求避免的同义词。

如果需要的概念尚未出现在词汇表中，这是一条需要关注的信号：要么正在引入项目并不使用的新语言，应重新考虑；要么确实存在术语缺口，应记录下来供 `/domain-modeling` 处理。

## 标明与 ADR 的冲突

如果输出内容与已有 ADR 冲突，应明确指出冲突，而不是静默覆盖。例如：

> _与 ADR-0007（事件溯源订单）冲突——但值得重新讨论，因为……_
