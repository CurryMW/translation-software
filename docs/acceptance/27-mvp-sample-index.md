# 票据 #27：固定样本索引

本索引只保留稳定 ID、语言类别和本地夹具类别，不保存真实网页正文、译文、账号或网址。30 个样本的组成必须固定为：18 个英文正文/帖子/评论、4 个中英混合块、4 个英文长文本/换行/特殊字符块、2 个日语、1 个韩语、1 个西班牙语。所有样本目标语言为简体中文（`zh`）。

| ID | 类别 | 源语言 | 本地夹具类别 | 结果 |
| --- | --- | --- | --- | --- |
| EN-01–EN-06 | 英文正文 | `en` | `static/article` | `pending` |
| EN-07–EN-12 | 英文帖子 | `en` | `static/post` | `pending` |
| EN-13–EN-18 | 英文评论 | `en` | `static/comment` | `pending` |
| MIX-01–MIX-04 | 中英混合块 | `mixed` | `static/mixed-language` | `pending` |
| LONG-01–LONG-04 | 英文长文本/换行/特殊字符 | `en` | `static/long-text` | `pending` |
| JA-01–JA-02 | 日语 | `ja` | `static/language` | `pending` |
| KO-01 | 韩语 | `ko` | `static/language` | `pending` |
| ES-01 | 西班牙语 | `es` | `static/language` | `pending` |

验收时每个 ID 需要单独记录：内容对应、顺序、目标语言、无遗漏/重复/截断，以及人工语义结果（`understood` / `unclear` / `reverse-meaning`）。供应商措辞问题和扩展数据损坏必须分栏记录；没有真实服务或用户人工结果时保持 `pending`，不能填充推测性译文。

排除语料（链接、导航、按钮、菜单、代码、表单、编辑区、隐藏内容、纯数字、纯标点、纯 emoji）不计入 30 个样本，另由本地内容发现和扩展 E2E 断言“没有翻译任务”。
