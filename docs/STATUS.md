# 会话断点（当前状态）

> 最后更新：2026-08-16（继续日，GitHub 候选处理中）。

## 当前进度

- ✅ Step 1、Step 2 完成；
- 🔄 Step 3 进行中：
  - ✅ npm 通道：418 个已全部入库；50 个缺失报告已补跑（`fix-missing-reports.mjs` 已支持 npm 来源）；
  - 🔄 **GitHub 候选处理中**：763 候选 → 去重后 651 待处理（112 已在菜单），`process-github-candidates.mjs` 后台跑（job pwsh-5），约 1-1.5 小时；
  - 菜单当前 457 条（3 官方 + 36 GitHub + 418 npm），GitHub 并入后预计 ~1100。

## 接下来（GitHub 处理完成后）

1. 重新生成审阅报告：`node scripts/report-html.mjs`
2. 抽查统计：`node scripts/query-menu.mjs stats`
3. 汇报最终规模/成本/去重数字
4. Step 4+5（市场 UI + 一键安装）是下一步大块，动手前先和用户确认方案（流程约定）

## 关键文件

- 菜单：`data/plugins.json`
- 候选/检查点：`data/cache/github-candidates.json`（763）、`data/cache/npm-candidates.json`、`data/cache/llm/*.json`
- 审计：`data/meta.json`；报告：`report.html`
- 总账本：`docs/ROADMAP.md`

## 已配置（.env，勿提交）

- `DEEPSEEK_API_KEY`、`GITHUB_TOKEN`（经典版）

## 提醒

- LLM 偶发 "fetch failed"（DeepSeek 网络抖动）——缺报告的用 `fix-missing-reports.mjs` 幂等补跑；
- 实体合并逻辑在 npm-scan/process-github 中（按 github.url 匹配，官方仓库有防误并守卫）。
