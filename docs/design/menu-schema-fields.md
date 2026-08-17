# 字段说明档案（menu-schema-fields.md）

> 菜单格式 v0.1 的**逐字段中文说明书**。机器规格见 `data/schema/plugins.schema.json`；本档案是给人看的完整字典。
> 使用：查字段 → 看"是什么 / 谁填 / 何时填 / 示例"。所有时间一律 UTC。

## ⚠️ v0.1 推迟字段（决策 D6：不预埋，靠升版加回）

以下字段**设计已完成、但 v0.1 菜单中不存在**（避免空位维护噪音），对应版本升级时再加回：

| 字段 | 何时加回 | 出处 |
|---|---|---|
| categories（分类） | v0.2（自动打标实现后） | menu-schema.md 决策 D4 |
| verifiedAt（验证时间） | 有验证流程时（Step 6/8 相关） | menu-schema.md 决策 D6 |
| riskReport（AI 说明书） | Step 6 | 03-risk-report-and-discovery.md |
| ratings 汇总（评价小计） | Step 11（明细表独立维护） | 05-feedback-and-rating.md |

下方详细说明保留，作为 v0.2/v0.3 的实现参考。

---

## 一、顶层字段（菜单封面）

### schemaVersion —— 格式版本
- **是什么**：这份菜单用的格式是第几版（如 `0.1.0`）。
- **谁填**：生成端（厨房/本地脚本）。**何时填**：每次生成。
- **为什么重要**：格式改了必须升版本号，店面读到不认识的版本就提示"菜单太新/太旧"，而不是乱解析。
- **示例**：`"0.1.0"`

### generatedAt —— 生成时间
- **是什么**：这份菜单是什么时候做出来的（UTC）。
- **谁填**：生成端。**何时填**：每次生成。
- **示例**：`"2025-01-01T00:00:00Z"`

### generator —— 生成器
- **是什么**：谁生成了这份菜单（用于排查"这菜单哪来的/是不是旧的"）。
- **谁填**：生成端。**何时填**：每次生成。
- **示例**：`"dsh-market-index@0.1.0"`

### stats —— 统计
- **是什么**：菜单里总共多少件插件、各信任档各多少（给店面显示"共 N 件"用）。
- **谁填**：生成端。**何时填**：每次生成，自动数。
- **示例**：`{ "total": 2, "byTrustLayer": { "official": 1, "curated": 0, "unverified": 1 } }`

### plugins —— 插件列表
- **是什么**：菜单正文，一件插件一条记录（数组）。
- **谁填**：生成端。**何时填**：每次生成。
- **示例**：见下文每条记录。

---

## 二、单条插件记录字段

### id —— 身份证号
- **是什么**：这件插件的稳定编号，全场唯一，不变。
- **规则**：有 npm 包名 → 用包名；没有 → 用 `owner/repo`（GitHub 门牌号）。
- **谁填**：生成端（实体合并时定）。**何时填**：首次进池时定，以后不变。
- **示例**：`"@deepseek-ai/dsh-tool-fs"` 或 `"some-user/dsh-plugin-cc"`
- **为什么重要**：评分明细表、历史账本都用它做"挂钩"（外键）。

### name —— 名字
- **是什么**：展示名（货架上挂的名字）。
- **谁填**：生成端（取 npm 包名或仓库名）。**何时填**：首次进池。
- **示例**：`"dsh-plugin-cc"`

### summary —— 简介
- **是什么**：一句话说明它是干嘛的。
- **谁填**：生成端（取 GitHub 描述或 npm 描述，都没有则留空，由 Step 6 AI 补写）。
- **何时填**：首次进池，可随上游更新。
- **示例**：`"Bridge DeepSeek Harness into Claude Code for review and delegation"`

### categories —— 分类
- **是什么**：它属于哪个筐。
- **词表 v0.1**：`tool`（工具）/ `ui`（界面）/ `skill`（技能）/ `integration`（对接）/ `other`（其他）。
- **谁填**：v0.1 生成端粗分 + 人工兜底；以后用 GitHub 标签 + npm 关键词自动打。
- **示例**：`["integration"]`

### sources —— 来源
- **是什么**：这件插件是从哪发现的（**可多个**，同一件被多渠道发现就都记）。
- **取值**：`official-monorepo`（官方大仓库）/ `github-topic`（GitHub 话题标签）/ `npm-registry`（npm 仓库）/ `awesome-list`（社区精选清单）/ `self-submitted`（作者自荐）。
- **谁填**：生成端（发现流水线）。**何时填**：发现时追加，不删除历史来源。
- **示例**：`["official-monorepo", "npm-registry"]`

### trustLayer —— 信任档
- **是什么**：出厂贴好的信任标签：**official 官方 ✅ / curated 精选 🟡 / unverified 待验证 ⚠️**。
- **谁填**：生成端推导后**存储**（消费端只读不重算）。**何时填**：进池时定，可因验证/举报升降级。
- **怎么推（草案）**：来自 deepseek-ai 官方仓库 → official；在精选清单 → curated；其余 → unverified。
- **示例**：`"official"`

### verifiedAt —— 验证时间
- **是什么**：最近一次"验货"通过的时间；没验过就是 `null`。
- **谁填**：生成端/验货流水线（Step 6 AI 验货、Step 10 人工反馈）。**何时填**：验货通过时。
- **示例**：`"2025-01-01T00:00:00Z"` 或 `null`

### score —— 打分
- **是什么**：多信号加权总分（官方盖章、话题、精选、名字、星数、下载量……），**低于阈值不进菜单**。
- **谁填**：生成端。**何时填**：进池与每次重算时。权重用真实数据校准（开放问题 Q1）。
- **示例**：`8`

### firstSeen —— 首次发现
- **是什么**：第一次发现它的时间（算"新上架"靠它）。
- **谁填**：生成端。**何时填**：进池时。
- **示例**：`"2025-01-01T00:00:00Z"`

### updatedAt —— 最近更新
- **是什么**：这条记录信息最近一次刷新的时间（星/下载/版本有变就刷新）。
- **谁填**：生成端。**何时填**：每次重算。
- **示例**：`"2025-01-01T00:00:00Z"`

### github —— GitHub 户口（子对象）
| 子字段 | 中文 | 说明 | 示例 |
|---|---|---|---|
| owner | 房主 | GitHub 用户名 | `"some-user"` |
| repo | 房名 | 仓库名 | `"dsh-plugin-cc"` |
| url | 门牌号 | 仓库完整链接 | `"https://github.com/some-user/dsh-plugin-cc"` |
| stars | 粉丝数 | 点赞数（身价信号之一） | `42` |
| topics | 贴的标签 | 仓库自己挂的 GitHub 话题 | `["dsh-plugin"]` |
| pushedAt | 最近动工 | 最近一次推送代码的时间 | `"2025-01-01T00:00:00Z"` |

- **谁填**：生成端（GitHub 搜索/API）。**何时填**：进池与每次重算。没有 GitHub 身份则为 `null`。

### npm —— npm 户口（子对象）
| 子字段 | 中文 | 说明 | 示例 |
|---|---|---|---|
| name | 包名 | npm 包名 | `"@deepseek-ai/dsh-tool-fs"` |
| version | 当前版本 | 最新版号 | `"0.1.0-rc.6"` |
| downloadsLastMonth | 月下载量 | 上个月被下载次数（身价信号之二） | `1200` |
| keywords | 关键词 | 发布时填的搜索词 | `["dsh", "tool"]` |
| dshDeclarations.bundle | 插件身份-装层 | package.json 是否声明 `dsh.bundle.patch`（**是插件的最硬证据**） | `true` |
| dshDeclarations.client | 插件身份-带 UI | 是否声明 `dsh.client` 并导出 `./client`（自带网页界面） | `false` |

- **谁填**：生成端（npm 元数据）。**何时填**：进池与每次重算。没有 npm 身份则为 `null`。
- **注意**：dshDeclarations 是作者**自报**（按官方格式声明），不是 DeepSeek 认证——详见"官方盖章"说明。

### riskReport —— AI 说明书（预留槽位）
| 子字段 | 中文 | 说明 |
|---|---|---|
| status | 状态 | `not-generated` 未生成 / `local` 本机生成 / `shared` 共享缓存 |
| level | 档位 | `ok` 放心 / `caution` 留个心眼 / `warning` 别急着装（未生成为 null） |
| summary | 摘要 | 大白话结论 |
| generatedAt | 生成时间 | |

- **谁填**：店面（用用户本机模型，Step 6）；共享后厨房（Step 10）。**何时填**：用户点开详情页时懒生成，结果本地缓存。
- v0.1 恒为 `{ "status": "not-generated" }`。

### ratings —— 评价汇总（预留槽位，只放"小计"）
| 子字段 | 中文 | 说明 |
|---|---|---|
| count | 评价总数 | 多少条评价 |
| avg | 平均分 | 1–5 之间；没评价为 null |
| distribution | 分布 | 5 个数字 = 1 星~5 星各多少人 |

- **谁填**：写通道（Step 11）从**评价明细表**重算派生。**何时填**：有评价后。
- **为什么只有汇总**：几百条评价不进菜单（会撑爆）；明细存在独立"评价明细表"，每行一条，用 `pluginId` 连回这件插件。
- v0.1 恒为 `{ "count": 0, "avg": null, "distribution": [0,0,0,0,0] }`。

### install —— 安装信息（搬运单）
| 子字段 | 中文 | 说明 |
|---|---|---|
| method | 搬运方式 | `npm`（npm 仓库）/ `git`（Git 仓库）/ `tarball`（压缩包） |
| packageSpec | 搬运口令 | 原样传给 `dsh plugin add` 的字符串 |

- **谁填**：生成端（根据它有哪个身份定）。**何时填**：进池时。
- **示例**：`{ "method": "npm", "packageSpec": "dsh-plugin-cc" }`

---

## 三、独立表（不进菜单）

### 评价明细表（Step 11）
每行一条评价，`pluginId` 指向插件 `id`（一对多）：
| 字段 | 中文 | 说明 |
|---|---|---|
| ratingId | 评价号 | 唯一 |
| pluginId | 插件号 | → plugins.id（外键） |
| anonUserId | 匿名用户号 | DSH 匿名身份证 |
| stars | 星级 | 1–5 |
| comment | 短评 | 可选 |
| createdAt | 评价时间 | UTC |
| installedVerified | 装机验证 | 是否确认装过 |
| status | 状态 | normal / flagged（被举报） |

### 历史表（Step 7 起每日记）
每天一件插件一行身价快照：`date`、`pluginId`、`stars`、`downloadsLastMonth`、`rank`。算趋势/排行变化翻它。

---

## 四、易混点速查

| 概念 | 一句话 | 别和什么混 |
|---|---|---|
| sources 来源 | 从哪**发现**的 | 不等于 install 从哪**安装** |
| trustLayer 信任档 | 出身（官方/精选/待验证） | 不等于 AI 报告的"风险档"，也不等于用户评分 |
| dshDeclarations | 作者**自报**是插件（格式正确） | 不等于 DeepSeek **认证**安全 |
| ratings 汇总 | 评价的"小计" | 明细在独立表，不在菜单 |
| score 打分 | 机器算的"值不值得进菜单" | 不等于用户评分（ratings） |
