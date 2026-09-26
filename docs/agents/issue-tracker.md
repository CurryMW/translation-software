# 议题跟踪器：GitHub

本仓库的议题和规格说明存放在 GitHub 仓库 `CurryMW/translation-software` 的 Issues 中。所有操作均使用 `gh` CLI。

## 约定

- **创建议题**：`gh issue create --title "..." --body "..."`。多行正文使用 heredoc。
- **读取议题**：`gh issue view <number> --comments`；用 `jq` 筛选评论，并同时获取标签。
- **列出议题**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，并按需添加 `--label` 和 `--state` 筛选条件。
- **评论议题**：`gh issue comment <number> --body "..."`
- **添加或移除标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭议题**：`gh issue close <number> --comment "..."`

从 `git remote -v` 推断仓库；在克隆的仓库内运行时，`gh` 会自动完成此操作。

## 是否将 Pull Request 作为分诊入口

**将 PR 作为需求入口：否。** _（如果本仓库将外部 PR 视为功能请求，可改为“是”；`/triage` 会读取此标志。）_

当此项设为“是”时，PR 使用与议题相同的标签和状态，并改用对应的 `gh pr` 命令：

- **读取 PR**：使用 `gh pr view <number> --comments`，并用 `gh pr diff <number>` 查看差异。
- **列出待分诊的外部 PR**：运行 `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，仅保留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE` 的 PR；排除 `OWNER`、`MEMBER` 和 `COLLABORATOR`。
- **评论、添加或移除标签、关闭**：使用 `gh pr comment`、`gh pr edit --add-label` / `--remove-label`、`gh pr close`。

GitHub 的议题和 PR 共用同一个编号空间，因此单独的 `#42` 可能表示其中任意一种。先运行 `gh pr view 42`，失败后再运行 `gh issue view 42` 以确认类型。

## 当技能要求“发布到议题跟踪器”时

创建一个 GitHub Issue。

## 当技能要求“获取相关票据”时

运行 `gh issue view <number> --comments`。

## Wayfinding 操作

供 `/wayfinder` 使用。**路线图（map）**是一个独立议题，**子票据（child）**是其下属议题。

- **路线图**：一个带有 `wayfinder:map` 标签的议题，正文包含 Notes、Decisions-so-far 和 Fog。使用 `gh issue create --label wayfinder:map` 创建。
- **子票据**：通过 GitHub 子议题关系（使用 `gh api` 调用 sub-issues 端点）连接到路线图的议题。如果仓库未启用子议题，则在路线图正文的任务列表中加入子票据，并在子票据正文顶部写入 `Part of #<map>`。标签为 `wayfinder:<type>`，其中类型是 `research`、`prototype`、`grilling` 或 `task`。票据被认领后，分配给负责推进的开发者。
- **阻塞关系**：GitHub 原生议题依赖关系是规范且在 UI 中可见的表示方式。使用 `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` 添加依赖边，其中 `<blocker-db-id>` 是阻塞议题的数字数据库 ID，可通过 `gh api repos/<owner>/<repo>/issues/<n> --jq .id` 获取；它不是 `#number` 或 `node_id`。GitHub 通过 `issue_dependencies_summary.blocked_by` 报告仍然打开的阻塞项。若原生依赖关系不可用，则在子票据正文顶部写入 `Blocked by: #<n>, #<n>`。当所有阻塞议题均已关闭时，票据解除阻塞。
- **前沿查询**：列出路线图中仍然打开的子票据；丢弃存在未关闭阻塞项或已有负责人认领的票据，按路线图顺序选择第一个可执行票据。
- **认领**：运行 `gh issue edit <n> --add-assignee @me`；这是会话中的首次写操作。
- **解决**：运行 `gh issue comment <n> --body "<answer>"`，然后运行 `gh issue close <n>`，最后把上下文指针（摘要与链接）追加到路线图的 Decisions-so-far。
