# 🛒 dsh-plgstore — DSH 插件市场

给 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 做的**插件市场 + 每日日报**（日报规划中）。

核心思路：**多源发现 + AI 全面评估 + 一份总菜单**。
- **发现**：官方仓库（100%）+ GitHub `dsh-plugin` 话题（全量）+ npm 存量（中央点）三路并集、实体去重；
- **评估**：DeepSeek LLM 为每个插件生成**全面评估报告**（大白话功能介绍 / 风险 / 三档结论 / 装后要点 / 类型判断）；
- **审阅**：`report.html` —— 1108 条插件的可交互审阅界面（**分类 / 筛选 / 排序 / 检索**，也是未来市场 UI 的设计蓝本）。

## 📊 当前数据（2026-08-17）

| 来源 | 数量 | 说明 |
|---|---|---|
| 官方 monorepo | 3 | 可安装的 profile bundle（dsh-base / web-app / headless） |
| GitHub `dsh-plugin` | 763 | 999 候选 → D7 体检（依赖/盖章/官方）入选 |
| npm 存量 | 418 | npm 是"中央点"——不贴标签的插件几乎都在这里 |
| **合计（去重后）** | **1108** | 评估报告覆盖 **100%**，缺报告 0 |

安装方式分布：npm 678 / git 354 / tarball 35 / 不可安装 41。

## 🛠 工具（Node ≥ 18，无第三方依赖）

| 命令 | 作用 |
|---|---|
| `node scripts/build-index.mjs --source official-local --root <路径>` | 枚举官方 bundle（本地 DSH 安装目录） |
| `node scripts/build-index.mjs --source github-topic --discover-only` | GitHub 全量爬取 + D7 体检（存候选） |
| `node scripts/npm-scan.mjs --phase discover` / `--phase llm` | npm 发现 + LLM 评估（两阶段、检查点、可续跑） |
| `node scripts/process-github-candidates.mjs` | 处理 GitHub 候选（LLM + 并入菜单） |
| `node scripts/fix-missing-reports.mjs` | 幂等补跑缺失的评估报告 |
| `node scripts/query-menu.mjs <list\|search\|top\|show\|stats>` | 命令行查菜单 |
| `node scripts/report-html.mjs` | 生成 `report.html` 审阅报告 |

## 🚀 快速开始

```powershell
# 1. 配置（复制 .env.example 为 .env，填入 key）
DEEPSEEK_API_KEY=sk-...      # LLM 评估（必填）
A_GITHUB_TOKEN=ghp_...       # GitHub API（推荐，配额翻倍；GITHUB_ 前缀被保留，故用 A_）

# 2. 重新生成菜单（三路进货）
node scripts/npm-scan.mjs --phase discover
node scripts/npm-scan.mjs --phase llm
node scripts/process-github-candidates.mjs

# 3. 生成审阅报告 + SQLite 查询库
node scripts/report-html.mjs
node scripts/build-sqlite.mjs
```

## 🤖 每日自动更新（GitHub Actions，中央厨房）

仓库已带 `.github/workflows/daily.yml`：每天自动跑完整流水线（发现新插件 → LLM 评估 → 刷新已有 → 更新报告）并提交回仓库。启用步骤：

1. 仓库 **Settings → Secrets and variables → Actions → New repository secret**，添加两个：
   - `DEEPSEEK_API_KEY`（DeepSeek API key）
   - `A_GITHUB_TOKEN`（个人访问令牌，需 `repo` 权限——GitHub 禁止 `GITHUB_` 前缀的 secret 名，故加 A_；建议单独生成一个只给本仓库用的）
2. 提交后 Actions 会按计划（每天 02:10 UTC）或手动（Actions → daily-market → Run workflow）执行。
3. 首次执行前建议手动跑一次验证 Secrets 配置正确。

> 提示：DeepSeek 2026-08 起采用**峰谷定价**（高峰 9:00-12:00、14:00-18:00 北京时间为 2 倍价），Actions 的 02:10 UTC = 北京 10:10 正处高峰——如想省钱可把 cron 改到 UTC 20:00（北京 4:00，低谷）。

## 🗺 路线图

见 [`docs/ROADMAP.md`](docs/ROADMAP.md)：Step 1（菜单格式）✅、Step 2（第一本电话簿）✅、Step 3（增量发现）存量 ✅ / 增量订阅进行中、Step 4+（市场 UI / 一键安装 / 日报 / 评分 / LLM 推荐）待做。

## ⚠️ 免责声明

- 评估报告由 **LLM 生成，仅供参考，非安全认证**——安装第三方插件前请自行判断；
- 入选标准（D7）= 依赖 / 盖章 / 官方三信号任一，标签不算数（实测话题榜污染严重）；
- 数据每日变动，`plugins.json` 是快照。

## 📂 目录结构

```
docs/          设计文档、总账本（ROADMAP）、会话断点（STATUS）
scripts/       抓取/评估/查询/报告工具（零依赖）
data/          plugins.json（菜单）、meta.json（审计）、schema/、examples/
report.html    审阅报告（生成物）
```

## 📄 License

[MIT](LICENSE)
