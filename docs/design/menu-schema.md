# 菜单格式设计 v0.1（plugins.json 索引 schema）

> 状态：**待评审**。对应 ROADMAP Step 1。评审通过后作为数据契约冻结，进入 Step 2。
> 呈现方式说明：菜单 = 数据库。机器侧用 JSON Schema（`data/schema/plugins.schema.json`）做校验；人类侧用本文档（字段表 + 决策 + 开放问题）；验证侧用示例数据（`data/examples/plugins.example.json`）。页面原型（Figma 类）留到 Step 4 店面 UI 时再做。

## 一、菜单文件长什么样（目标布局）

中央厨房（或本地脚本）产出的目录结构：

```
data/
  plugins.json              # 菜单本体：当前快照（一条记录 = 一件插件）
  meta.json                 # 生成信息：schema 版本、生成时间、生成器、来源健康度
  history/
    2025-01-01.json         # 每日快照（追加式，排行/趋势的数据源，Step 7 开始积累）
  daily-report.md           # 每日日报（Step 7）
schema/plugins.schema.json  # 本文件的机器可读规格
examples/plugins.example.json
```

**关键决策 D1：历史不进菜单。** 每件插件只记 `firstSeen`（首次发现时间），趋势数据放独立的历史快照文件。理由：菜单保持小、追加式写入、趋势计算简单（对两个快照的同一字段）。**待确认。**

## 一·五、以"表"理解菜单（非技术视角）

> 现在**不建真正的数据库**，用 JSON 文件即可；"表"是帮你理解结构的概念。若未来数据量/查询复杂，可平移迁移到 SQLite。表与 JSON 的对应：**每件插件在主表一行，JSON 里就是一条记录；附属小表在 JSON 里打包成子对象**。

| 表（登记簿） | 存什么 | 与 JSON 的对应 | 是否进菜单 |
|---|---|---|---|
| **插件表**（主表） | 每件插件一行：编号、名字、简介、信任档、打分、首次发现、最近更新 | 记录的顶层字段 | ✅ |
| **来源表** | 从哪发现的（可多路） | sources[] | ✅ |
| **GitHub 身份表** | GitHub 户口：owner/repo/链接/星/话题/最近推送 | github | ✅ |
| **npm 身份表** | npm 户口：包名/版本/下载量/关键词/官方盖章 | npm | ✅ |
| **安装表** | 怎么搬回家：来源方式 + 给 dsh 的口令 | install | ✅ |
| **风险报告表** | AI 说明书（**v0.2/Step 6 加入**，v0.1 无） | riskReport | ❌ 以后版本 |
| **评价明细表**（1 对多） | **每一条**用户评价单独一行：插件 ID、匿名用户 ID、星级、短评、时间、是否装机验证 | 独立表，用 `pluginId` 连接；汇总（总数/平均/分布）**v0.3/Step 11 加入菜单** | ❌ 以后版本 |
| **历史表** | 每日一次的身价快照（星/下载/排名），**不进菜单**，单独 `history/日期.json` | —（独立文件） | ❌ 单独账本 |

**一句话**：菜单 JSON v0.1 = 把主表 + 身份/安装表按"一件插件一条记录"打包成的**快递单**；**评价明细**和**历史**是独立账本；**风险报告与评价汇总**按 D6 决策推迟到后续版本（见字段表下方说明）。

> **评价为什么单独建表（用户建议采纳）**：一件插件可能几百条评价，全塞进插件记录里既臃肿又难查询。拆成"评价明细表"：每行一条评价，`pluginId` 指向插件 ID（一对多）。菜单里保留派生汇总（count/avg/distribution）供店面直接显示；明细表由写通道（Step 11）维护。



```json
{
  "schemaVersion": "0.1.0",
  "generatedAt": "2025-01-01T00:00:00Z",
  "generator": "dsh-market-index@0.1.0",
  "stats": { "total": 2, "byTrustLayer": { "official": 1, "curated": 0, "unverified": 1 } },
  "plugins": [ ... ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| schemaVersion | string | ✅ | 语义化版本；**菜单格式变更必须升版**，消费端按版本兼容 |
| generatedAt | string(UTC) | ✅ | 生成时间 |
| generator | string | 建议 | 生成器标识（便于排查"这份菜单谁生成的"） |
| stats | object | 建议 | 汇总数，方便消费端显示 |
| plugins | array | ✅ | 插件记录数组 |

## 二、顶层结构

（顶层结构说明：菜单文件本身像一张"封面页 + 内容列表"。封面记 `schemaVersion`（格式版本）、`generatedAt`（生成时间）、`generator`（谁生成的）、`stats`（总共有多少件）；内容就是 `plugins` 数组——每件插件一条记录。详见上方 JSON 示例与字段表。）

## 三、单条插件记录（一件"菜"的信息）

```json
{
  "id": "@deepseek-ai/dsh-tool-fs",
  "name": "dsh-tool-fs",
  "summary": "Filesystem tool set for the DeepSeek Harness agent",
  "sources": ["official-monorepo", "npm-registry"],
  "trustLayer": "official",
  "github": { "owner": "deepseek-ai", "repo": "deepseek-harness", "url": "https://github.com/deepseek-ai/deepseek-harness", "stars": 12345, "topics": ["deepseek-harness"], "pushedAt": "2025-01-01T00:00:00Z" },
  "npm": { "name": "@deepseek-ai/dsh-tool-fs", "version": "0.1.0-rc.6", "downloadsLastMonth": 1200, "dshDeclarations": { "bundle": false, "client": false } },
  "score": 8,
  "firstSeen": "2025-01-01T00:00:00Z",
  "updatedAt": "2025-01-01T00:00:00Z",
  "install": { "method": "npm", "packageSpec": "@deepseek-ai/dsh-tool-fs" }
}
```

> v0.1 故意**不预埋**未来字段（categories / verifiedAt / riskReport / ratings）——需要时靠升版（v0.2/v0.3）加回，见决策 D6。

### 字段表

> 完整中文说明见《字段说明档案》（`menu-schema-fields.md`）。本表为速查。

| 字段 | 中文名 | 类型 | 必填 | 一句话 |
|---|---|---|---|---|
| id | 身份证号 | string | ✅ | 有 npm 包名用包名，否则 `owner/repo`（决策 D2） |
| name | 名字 | string | ✅ | 展示名（npm 包名或仓库名） |
| summary | 简介 | string | 建议 | 一句话简介（GitHub/npm 描述） |
| sources | 来源 | enum[] | ✅ | 从哪发现的（官方/topic/npm/精选/自荐，可多个） |
| trustLayer | 信任档 | enum | ✅ | 官方✅ / 精选🟡 / 待验证⚠️（生成端贴好，消费端直接读，决策 D5） |
| github | GitHub 户口 | object/null | 建议 | owner/repo/url/stars/topics/pushedAt |
| npm | npm 户口 | object/null | 建议 | name/version/downloadsLastMonth/dshDeclarations |
| score | 质量分 | number | ✅ | **不是入选门槛**（D8）；**公式（D9）= 星星 + 活跃度 + 用户评分 +（下载量可选）加权**；用于排序/推荐与"可能不好用"提示，权重待真实数据校准 |
| firstSeen | 首次发现 | string(UTC) | ✅ | 第一次发现它的时间 |
| updatedAt | 最近更新 | string(UTC) | ✅ | 信息最近刷新时间 |
| install | 安装信息 | object | ✅ | method（npm/git/tarball）+ packageSpec（给 dsh 的口令） |

> **推迟到后续版本的字段**（决策 D6，不预埋）：categories（v0.2 有自动打标再加）、verifiedAt（有验证流程再加）、riskReport（Step 6 加）、ratings 汇总（Step 11 加，明细表独立）。

### 子对象说明

- **npm.dshDeclarations**：`{ bundle: bool, client: bool }` —— **官方"身份证"信号**（package.json 是否声明 `dsh.bundle` / `dsh.client`）。这是"准"的关键字段，Step 2 打分直接用。
- **github / npm 同时为 null**：理论上不该出现（无任何身份的候选直接出池）。
- **同一插件 GitHub ↔ npm 双身份**：实体合并为一条记录，两个子对象都填，`sources` 记两者。

## 四、关键决策（用户已拍板 ✅ / 待确认）

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| D1 | 历史快照 | **独立文件**（history/），不内嵌 | 菜单小、追加式、趋势计算简单 |
| D2 | id 稳定规则 | npm 包名优先，否则 owner/repo | 包名全局唯一且稳定；仓库会改名/迁移 |
| D3 | 官方仓库过滤 | **只收"用户可安装"的包**（声明 dsh.bundle/dsh.client，或是 profile 依赖），内部库（如 dsh-fs、dsh-session 这类纯依赖）不进菜单 | 官方 monorepo ~200 包很多是内部零件，混进来会污染菜单 |
| D4 | 分类词表 | **推迟到 v0.2**：等 GitHub topics + npm keywords 自动打标实现后再加 categories | 现在没有自动打标，分类只能人工填，白维护 |
| D5 | trustLayer 存储 vs 重算 | **存储**（生成端推导） | 消费端（店面/网站）零逻辑；推导规则集中在生成端一处改 |
| D6 | 未来字段预埋？ | **不预埋**：riskReport/ratings/categories/verifiedAt 等用到时靠**升版**（v0.2/v0.3）加回 | 空字段 = 维护噪音；schemaVersion 就是为升级设计的 |
| **D7** ✅ | **入选标准（用户修订 v2）** | **三信号任一即入选**：① 有盖章（dsh.bundle / dsh.client 声明）② 有依赖（依赖 `@deepseek-ai/cordis` 或 `dsh-*` 核心包）③ 官方（deepseek-ai 官方仓库）。**GitHub 标签不再算数**（实测 top 榜全是蹭标签大项目）。三者皆无 → 不入选。分数**不是**入选门槛 | 标签可被任意蹭；依赖/盖章/官方才是真凭据 |
| **D8** ✅ | **score 的作用（用户拍板）** | **质量/可用性分**：不决定入选，只用于①告诉用户"可能用不了/不好用"②推荐/排序时低分靠后 | 分数是提示不是闸门；与热度分分开（见 D9） |
| **D9** ✅ | **质量分公式（用户拍板）** | **一个分**：星星数 + 活跃度 + 用户评分 +（下载量可选）加权；用于排序/推荐与"可能不好用"提示。权重待真实数据校准 | 用户指定：星/活跃/评分都是"别人用过"的信号 |
| **D10** ✅ | **LLM 能力（用户拍板）** | **厨房自出**：API 部署 GitHub Actions；用途 = 填充安装方式 + 类型判断 + 全面评估报告（含功能介绍）+ 每日日报；**不做入选筛选**（入选归 D7）。用户本机模型作可选兜底 | 集中生成、一次共享，避免每用户各算各的 |
| **D11** ✅ | **不可安装的插件（用户拍板）** | `install.method = "none"`：保留在菜单，但评估报告说清楚"未找到安装方式"，且**不推荐**（分数归零，排序垫底） | 做好了必然能装；找不到装法就该标出来而不是给假按钮 |
| **D12** ✅ | **LLM 智能检索/推荐（用户新增需求）** | 用户用自然语言描述需求 → LLM 根据菜单+评估报告匹配并推荐插件（见 ROADMAP Step 13） | 从"逛市场"升级为"问市场" |

> 注：D3 与 D7 的衔接——**官方仓库**仍按 D3（只收 bundle），**第三方**按 D7 三信号；否则官方 39 个网页组件（有 dsh.client 盖章但非独立安装）会混进菜单。

## 五、开放问题（❓，进待核实清单）

- Q1（已随 D8 变更）：`score` 不再设入选门槛；需校准的是**排序权重**（质量分与热度分如何合并），待真实数据。
- Q2（已有数据答案）：官方"可安装 vs 内部库"用 dsh.bundle 声明可区分（3 个 bundle 与 PROFILE_TEMPLATES 一致）。
- Q3（已随 D6 暂缓）：categories 自动打标留到 v0.2。

### 五·A、安装方式判定（定稿，D10）

**背景**：`dsh plugin add <spec>` 原样转发给 pnpm，所以安装形态 = pnpm 支持的形态。

**pnpm 实际支持的安装形态**：

| method | packageSpec 长什么样 | 什么时候用 | 坑（如实） |
|---|---|---|---|
| npm | `包名` 或 `包名@版本` | 插件发布了 npm 包 | 最省事，依赖自动装 |
| git | `git+https://github.com/owner/repo.git`（或 `github:owner/repo`，可带 `#分支/tag`） | 只有 GitHub 仓库、没发 npm | ① pnpm 10 默认**拦 build 脚本**：git 装的插件若带 prepare 脚本，要在 profile 的 `pnpm-workspace.yaml` 加 `allowBuilds` 白名单，否则装不上 ② 首次安装要**克隆+构建**，慢；本机要有 git ③ 依赖解析走 git 协议，网络要求高 |
| tarball | `https://…/pkg.tgz`（常是 GitHub release 资产） | 以压缩包分发 | 需确认 URL 可达；无版本管理 |
| path | `file:../pkg` / `link:` | 本地开发 | **市场不提供**（`dsh plugin add` 会锚定相对路径，那是给作者自测用的） |

**判定流程（硬规则优先 → LLM 兜底 → 装前验证）**：
1. **有 npm 身份** → HEAD 请求 `registry.npmjs.org/<name>` 确认存在 → `npm`（记最新版本）；
2. **只有 GitHub、仓库根有 package.json 且写了 name** → 查 npm 同名包：确认 → npm；查不到 → git；
3. **只有 GitHub、无 package.json** → `git` + 默认分支；
4. **疑似压缩包分发**（README 提示 release 下载）→ LLM 判定 tarball 并提取 URL；
5. **LLM 兜底**：硬规则对不上 / 与 README 装法矛盾 / 完全无法判断 → LLM 读 README + package.json，输出结构化 `{ method, packageSpec, confidence, 依据摘录 }`（每条带出处可追溯）；
6. **装前验证**：npm → registry 可达；git → 仓库存在且有 package.json；tarball → URL 可达。**验证失败 → 菜单里该件不提供一键安装**（店面置灰 + AI 报告里说明原因），不加新字段（遵守 D6）。

**装后注意事项**：部分插件装完还要改配置/设环境变量——install 字段不承载这类信息，由**安全评估报告（Step 6）的"装后要点"段**承担。

## 六、与设计文档的对应

- 来源五路 / 打分 / 信任分层 → `04-kitchen-plan-and-discovery.md` §二、§三
- 风险报告槽位 → `03-risk-report-and-discovery.md` §一
- 评分槽位 → `05-feedback-and-rating.md` §四
- schema 中心化友好（生成端可换）→ `02-architecture-decision.md` 关键设计决策
