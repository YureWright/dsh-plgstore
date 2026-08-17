# DSH 插件生态与现有"市场"项目对比分析

> 目标：为「DSH 插件市场 + 每日插件日报」确定差异化定位与分步路线。
> 状态：**定稿**（2025 年检索；3 个并行子代理 × web_search + 本地源码核实；标注"未查到"的项需后续直连仓库二次核实）

---

## 0. 结论先行

1. **DSH 没有官方插件市场**：官方约 200 个 `@deepseek-ai/dsh-*` 插件全部在单一 monorepo（[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)）内，Web 设置页只有只读的插件清单 tab 和配置卡片，不能浏览、搜索、安装第三方插件。
2. **没有统一官方的 GitHub 标签**：官方包 package.json 连 `keywords` 字段都没有。社区存在一个约定 topic **`dsh-plugin`**（多个聚合项目引用它），但无强制规范、无法保证覆盖。
3. **已有多个社区市场项目**，其中 [yyyyukari/dsh-plugin-workshop](https://github.com/yyyyukari/dsh-plugin-workshop) 与目标高度重合（详见 §2 对比表，子代理深挖中）。
4. **差异化机会**：现有项目都缺"每日插件日报 / 新插件推送 / 趋势历史"这类内容型能力；DSH 自带 `cordis-plugin-timer` 与 `dsh-schedule`，日报天然可以做成 DSH 插件内的定时任务，这是原生集成点。

---

## 1. 本地源码核实（第一手，非二手资料）

### 1.1 插件安装机制 = 转发给 pnpm

`dsh plugin --profile <name> add <pkg>` 的实现（`@deepseek-ai/dsh` 包 `lib/plugin-*.js`）：

1. 首次使用时初始化 profile 目录（写入 `package.json` + `dsh.profile` manifest + `cordis.patch.yml`）。
2. `spawnSync("pnpm", args, { cwd: profileDir })` —— **原样转发给 pnpm**，因此 `add`/`remove`/`update`/`why` 全部可用。
3. pnpm 成功后做一次"对账"（reconcile）：依赖中凡 package.json 声明了 `dsh.bundle.patch` 的包，会被追加进 `dsh.profile.bundles` 层栈；被移除或失去声明的包会离开层栈。
4. 装了不带 bundle 声明的纯库会打一条 warning（仍是依赖，但不是 profile 层）。
5. git 托管插件需要 `pnpm-workspace.yaml` 的 `allowBuilds` 白名单（pnpm 10 默认拦 build scripts）。
6. 前置条件：**PATH 上有 pnpm**。

**对"一键安装"的含义**：市场端不需要自己实现安装逻辑，只要拿到 **npm 包名**（或 git spec），即可：
- 服务端/本机执行 `dsh plugin --profile <profile> add <pkg>`（最稳，复用对账逻辑）；或
- 直接进 profile 目录跑 `pnpm add <pkg>`（绕开 dsh CLI，但会漏掉 reconcile；不推荐）。

### 1.2 现有"插件管理"UI 是只读的

- `dsh-host-plugin-inventory`：只读投影，`pluginInventory/list` Remote 每次调用读 `ctx.loader.entries()`，返回 id、模块标识、有效启用状态、根 Fiber 阶段（pending/loading/active/failed/unloading）。README 明言：**不能启用、停用、添加或移除插件**，无来源模型、无历史、无订阅。
- `dsh-client-ui-settings-plugins`：设置页"插件配置"tab，只渲染**正在运行且被 api-proxy 白名单暴露**的宿主插件配置卡片（bash / agent-loop / web-search-deepseek 等）。第三方插件默认**不会被暴露**到 UI（需要改 `packages/host/apiproxy` 白名单）。
- `dsh-client-ui-settings-plugin-inventory`：只读清单 tab。

### 1.3 UI 扩展点（市场 UI 的挂载位置）

设置页 slot 体系（已核实）：
- `settings.section`（根级列表 slot）→ 一个 section 内可声明 `settings.plugins.tab`（tab 列表）→ 每个 tab 可声明 `settings.plugin.item`（卡片列表）。
- 插件通过 `ctx.slots.register({ name: "...", ... })` + `ctx.slots.inject(...)` 贡献 UI；locale 通过 `ctx.locale.register(NS, {...})` 注册多语言。

**结论**：市场 UI 可以作为 DSH 插件注册一个新的 `settings.plugins.tab`（如"发现/Market"），或独立 `settings.section`；无需改 DSH 本体。

### 1.4 定时能力（日报的天然挂载点）

- `@deepseek-ai/cordis-plugin-timer`：cordis 定时器服务，已随 dsh 安装。
- `dsh-schedule`：agent 会话内调度（`schedule_create/list/delete` 工具，支持 `at`/`after`/`every`，`every` 最短 5 分钟）。
- **日报方案候选**：cordis-plugin-timer 做每日一次的数据抓取与聚合（纯数据层，不依赖模型）；如需"模型写日报摘要/评测"，可配合 `dsh-schedule` 或按需触发一个 headless 会话。

---

## 2. 社区项目对比（调研完成）

> 调研方式：仅 web_search（网络受限，无法直连 GitHub/npm/raw），结论来自搜索引擎返回的仓库描述、npm 页与 raw 链接摘要；未确认处标注"未查到"。基准对比项目为 dsh-plugin-workshop。

| 项目 | 定位 | 技术形态 | 数据来源 | 一键安装 | 热度/排行 | 成熟度 | 缺口 |
|---|---|---|---|---|---|---|---|
| [yyyyukari/dsh-plugin-workshop](https://github.com/yyyyukari/dsh-plugin-workshop) | Steam 工坊风格浏览器（"browser for the DSH Web UI"），zero-server、GitHub 驱动 | JS 项目（有 package.json，master 分支）；是否 cordis 插件/前端框架**未查到**；zero-server 推断=纯浏览器端调 GitHub | 未查到（生态惯例为 GitHub topic 搜索） | 描述有"智能一键安装/更新/卸载 + 已装插件管理器"，具体命令**未查到** | 描述有 trending 窗口，算法**未查到** | stars/活跃度**未查到** | 无日报/排行历史/评测/验证徽章/agent 工具/离线缓存/多 profile 支持（见 §2.3） |
| [Noob-stupid/dsh-plugin-hub](https://github.com/Noob-stupid/dsh-plugin-hub) | 管理面板 + 市场二合一 | npm 包 `dsh-plugin-hub`（另有 `dsh-plugin-store`，关系未查明），推断为 cordis 插件 | GitHub topic `dsh-plugin` | 描述有一键安装，实现细节未查到 | 未提及 | stars 未查到 | 无趋势/翻译/更新/卸载细节 |
| [YELEBAI/dsh-plugin-marketplace](https://github.com/YELEBAI/dsh-plugin-marketplace) | "Verified + autonomous registry" 治理型市场 | cordis 插件（v0.6.1，中英双 README；npm 另有 `@ruihuahe/dsh-plugin-marketplace`，同源性未确认） | 自称自动维护注册表（机制未证实） | "自定义插件位置"暗示可安装到指定 profile/目录，未证实 | 未查到 | 相对活跃（有 Issue 迭代） | 搜索/排行/翻译/零服务器缺失 |
| [mishibeikejie/zat-dsh-engine](https://github.com/mishibeikejie/zat-dsh-engine) | 可视化市场 | 未发现 npm 包，形态未查到 | 未查到 | 描述有安装，细节未查到 | 未提及 | 信息最稀薄，可能早期 | 细节全缺 |
| [hikariming/dshfind](https://github.com/hikariming/dshfind) | 原理学习 + 市场 + 最佳实践 | 推断为学习/文档型仓库，非插件 | 未查到 | 不适用 | 未查到 | 未查到 | 无实际安装能力 |
| [vlln/plugin-registry](https://github.com/vlln/plugin-registry) | 社区"薄控制台" + make-dsh-plugin 开发引导 skill | 注册表/引导仓库 | 未细查 | — | — | 未查到 | 非市场 |
| `dsh-external/hub` | 社区插件中心（组织**非官方**） | 组织仓库（页面未直接检索到，经 0xsline README 间接确认） | 未细查 | — | — | 未查到 | 非市场 |

### 2.2 同赛道横向补充（重要）

- **[AwesomeHou/dsh-plugin-marketplace](https://github.com/AwesomeHou/dsh-plugin-marketplace)**：实时同步 topic **1800+ 仓库**、分页设置页、一键安装，还提供 **agent 工具 `market_search` / `market_install`** —— 目前看到的最激进项目，注意它意味着 `dsh-plugin` topic 下仓库量已上千。
- 同类还有 [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market)、vvlife/whalehub-dsh、Sanqi-normal/dsh-webui-market-plugin 等。
- **生态主流模式已定型**："GitHub topic `dsh-plugin` 搜索 + 一键安装进 profile"。
- 共性问题：**都不做内容运营**（无日报/新插件推送/趋势历史），且 stars 与安装实现代码普遍未能从搜索摘要中核实，需直连仓库二次验证。

精选列表（可作"推荐/精选"数据源）—— 已核实：
- [0xsline/awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness) —— 按"插件/工具/基础设施"分类，聚合 dsh-external/hub + dsh-plugin topic
- [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) —— 约 **270 个插件**（V2EX 帖子数据），另有门户/搜索工具
- [bruc3van/awesome-dsh-plugin](https://github.com/bruc3van/awesome-dsh-plugin) —— 含 **TOP100.md** 排行（字段格式未确认）
- [AdamPlatin123/awesome-dsh-plugins](https://github.com/AdamPlatin123/awesome-dsh-plugins) —— **每日兼容性追踪**目录（PLUGINS.md）
- 共性：**以 GitHub 链接为主，npm 包名与安装命令没有统一格式** —— 意味着市场必须自己做元数据规范化。

### 2.1 官方生态现状（子代理核实）

- 官方文档 `docs/user/develop/basic/` 含 index/tool/publish/config.md，哲学是"**一切皆插件**"；`publish.md` 支持 npm / GitHub / tarball 三种发布形式；安装多经 `dsh plugin add`。
- **没有官方市场落地**。但有两个重要信号：
  - **RFC #1629**：官方脚手架 `pnpm create dsh-plugin`（正在推进的插件模板/发布规范）；
  - **公测新闻**：DeepSeek 官方宣布"开放 npm 插件生态"。
- 结论：官方**迟早会做市场或至少统一发布规范**；我们的项目应把"适配官方未来规范"作为架构约束，避免自造互不兼容的元数据格式。

### 2.3 安全与信任（所有"一键安装"工具的共性风险，必读）

来自 DSH 官方讨论 [#587](https://github.com/deepseek-ai/deepseek-harness/discussions/587)（子代理核实到的最重要发现）：

1. **第三方插件启动即获得完整配置树写权限**（无沙箱/无权限细分）；
2. **`dsh plugin add` 没有签名与来源校验** —— 装任何包都等于把任意代码放进 profile；
3. 因此**任何"一键装任意插件"的市场工具都继承此风险**，dsh-plugin-workshop 宣称的"签名过滤"是否真正缓解未知。

**对市场架构的硬性要求**：
- 安装必须**显式用户确认**（对应 DSH user-approval 机制），并清楚展示将要执行的确切命令；
- 提供**信任分层与验证徽章**（官方包 > awesome 精选 > topic 仓库 > 待验证），而不是假装"全都能装"；
- 预留**来源校验**扩展位（若官方未来推出签名/校验规范，如 RFC #1629 相关，直接对接）。

---

## 3. 差异化定位（定稿）

**一句话定位**：不是又一个"GitHub 搜索壳"，而是**带内容运营与信任分层的 DSH 插件发现层** —— 搜索 / 排行 / 一键安装之外，提供**每日插件日报**（新发布、更新、趋势、精选）与**数据快照历史**（排行变化、安装量趋势）。

调研确认的**全行业真空**（所有竞品都没做，正好是我们的地盘）：
1. **每日插件日报**：每日定时抓取 → 结构化日报（新插件 / 更新 / 本周趋势 / 编辑推荐）→ UI 内浏览 + 导出 Markdown/订阅（dsh-plugin-workshop 等均未提及）。
2. **趋势与历史**：GitHub stars 与 npm 下载量的**时间序列快照**，支持"本周新增 star"排行（竞品只有实时值）。
3. **信任分层与验证徽章**：官方 monorepo / awesome 精选 / topic 仓库 / 待验证，逐级标注 —— 这是对 #587 安全风险的正面回应，竞品都回避了。
4. **原生集成**：注册进 `settings.plugins.tab`，复用 locale/slot 体系；一键安装复用 `dsh plugin add` 对账逻辑 + 显式确认。
5. **（可选）agent 侧工具**：参考 AwesomeHou 的 `market_search`/`market_install`，但**默认关闭**，仅作为进阶功能（安全面更大）。

**明确不做（第一版）**：自定义注册表托管、插件评分/评测系统、个性化推荐算法、多 profile 切换面板 —— 等核心四件套（搜索/排行/安装/日报）跑稳再议。

---

## 4. 分步路线（定稿）

> 原则：慢、稳、每步可验证；架构稳定性优先于功能数量。每步都有明确验证标准，不跳过。

- **Step 0 ✅（已完成）**：生态与竞品调研 → 本文档定稿。
- **Step 1**：数据层原型 —— 只读插件索引（官方 monorepo 包 + topic 仓库 + npm 元数据），落成 JSON/SQLite，**离线可浏览**。验证标准：能列出、搜索、排序，且索引可重建（抓取脚本幂等）。
- **Step 2**：信息架构 —— 插件元数据 schema（名称、npm 包名、GitHub、描述、分类、依赖 DSH 版本、来源层、验证状态、安装方式），**对齐官方 publish.md 与未来的 RFC #1629 规范**。验证标准：schema 能无损容纳官方包与 topic 仓库两种来源。
- **Step 3**：只读市场 UI（DSH 插件形式）—— 浏览/搜索/详情/排行，**不含写操作**。验证标准：作为 DSH 插件加载进 web profile，slot/locale 正常，空态与限流兜底可见。
- **Step 4**：一键安装 —— 复用 `dsh plugin add` 对账逻辑，**显式用户确认 + 命令预览 + 结果回显**；处理 pnpm 缺失、`allowBuilds`、git 托管等边界。验证标准：装/卸/更新插件后 profile bundles 对账正确。
- **Step 5**：每日插件日报 —— cordis-plugin-timer 定时聚合 + 日报渲染 + **历史快照存储**（趋势数据从此开始积累）。验证标准：连续 3 天出报、数据一致、断网可重试。
- **Step 6**：信任分层落地 —— 验证徽章、来源标注、安装前风险提示页。验证标准：每个插件详情页都可见来源层与验证状态。

---

## 附：信息来源

- DSH 本地源码：`node_modules/@deepseek-ai/dsh/lib/plugin-*.js`、`dsh-host-plugin-inventory`、`dsh-client-ui-settings-plugins`（v0.1.0-rc.6）
- 官方仓库：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)；官方文档 `docs/user/develop/basic/{index,tool,publish,config}.md`；官方讨论 [#587](https://github.com/deepseek-ai/deepseek-harness/discussions/587)
- 社区项目与列表：见 §2 表格链接（3 个子代理 × web_search，2025 年检索；stars/安装代码等标注"未查到"的项需后续直连仓库二次核实）
