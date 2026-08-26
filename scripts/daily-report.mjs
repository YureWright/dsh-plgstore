#!/usr/bin/env node
/**
 * daily-report.mjs — 每日插件日报生成器
 *
 * 板块：
 *   1. 🆕 新推出的插件（最近 48h 首次收录）
 *   2. 🔥 涨星最快（对比历史快照 data/history/<date>.json；首次运行无历史 → 用"近期活跃热门"代替并开始积累）
 *   3. ✨ 热门更新（近 48h 有推送、星数高）
 * 每条：名称 + 直达链接 + 简介 + 功能介绍(评估报告 intro) + 档位 + 质量分。
 * 输出：daily.html（网页）+ daily.md（markdown），写入项目根目录（随流水线提交）。
 * 同时写入今日历史快照 data/history/<date>.json（星/下载量，供明日涨星对比）。
 */
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA = join(ROOT, "data");
const REPORTS = join(DATA, "reports");
const HISTORY = join(DATA, "history");

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const now = new Date();
const today = now.toISOString().slice(0, 10);

const menu = JSON.parse(await readFile(join(DATA, "plugins.json"), "utf8"));
const plugins = menu.plugins;

// 窗口判定：存在"前一天"的历史快照 → 每日 48h；否则视为首次（14 天窗口覆盖存量数据）
let prevStars = null;
let hasPriorSnapshot = false;
try {
  const files = (await readdir(HISTORY)).filter((f) => f.endsWith(".json") && !f.startsWith(today)).sort();
  if (files.length) {
    hasPriorSnapshot = true;
    prevStars = new Map(JSON.parse(await readFile(join(HISTORY, files[files.length - 1]), "utf8")).map((r) => [r.id, r.stars ?? 0]));
  }
} catch {}
const WINDOW_MS = (hasPriorSnapshot ? 48 : 24 * 14) * 3600 * 1000;

// 载入评估报告（intro 功能介绍 + level）
const reports = new Map();
try {
  for (const f of await readdir(REPORTS)) {
    if (!f.endsWith(".json")) continue;
    try {
      const d = JSON.parse(await readFile(join(REPORTS, f), "utf8"));
      reports.set(d.id ?? f, d.result);
    } catch {}
  }
} catch {}

const nowMs = Date.now();
const inWindow = (t) => t && nowMs - new Date(t).getTime() < WINDOW_MS;

// ---- 板块 1：新推出（首次收录在 48h 内）----
const fresh = plugins
  .filter((p) => inWindow(p.firstSeen))
  .sort((a, b) => (b.firstSeen ?? "").localeCompare(a.firstSeen ?? ""))
  .slice(0, 10);

// ---- 板块 3：热门更新（近 48h 推送 & 星高）----
const updated = plugins
  .filter((p) => inWindow(p.github?.pushedAt) && (p.github?.stars ?? 0) >= 50)
  .sort((a, b) => (b.github?.stars ?? 0) - (a.github?.stars ?? 0))
  .slice(0, 10);

// ---- 板块 2：涨星最快（历史快照对比，prevStars 已在顶部加载）----
let trending;
let trendingNote;
if (prevStars) {
  trending = plugins
    .map((p) => ({ p, prev: prevStars.get(p.id) ?? 0, now: p.github?.stars ?? 0 }))
    .filter((x) => x.prev > 0 && x.now > x.prev)
    .sort((a, b) => (b.now - b.prev) - (a.now - a.prev))
    .slice(0, 10);
  trendingNote = "按「今日星数 − 昨日星数」排序（历史快照积累中）";
} else {
  // 首次：无历史 → 近期活跃的高星插件作为替代，从今天开始积累
  trending = plugins
    .filter((p) => inWindow(p.github?.pushedAt) && (p.github?.stars ?? 0) >= 100)
    .sort((a, b) => (b.github?.stars ?? 0) - (a.github?.stars ?? 0))
    .slice(0, 10)
    .map((p) => ({ p, prev: null, now: p.github?.stars ?? 0 }));
  trendingNote = "（首次运行暂无历史快照，先展示近期活跃热门；从今日起积累星数变化）";
}

// ---- 保存今日历史快照 ----
await mkdir(HISTORY, { recursive: true });
const snapshot = plugins.map((p) => ({ id: p.id, stars: p.github?.stars ?? 0, downloads: p.npm?.downloadsLastMonth ?? 0 }));
await writeFile(join(HISTORY, `${today}.json`), JSON.stringify(snapshot));

// ---- 渲染 ----
const badge = (t, l) => `<span class="b ${t}">${l}</span>`;
function itemCard(p, extra) {
  const r = reports.get(p.id);
  const intro = r?.evaluationReport?.intro ? esc(r.evaluationReport.intro) : null;
  const level = r?.evaluationReport?.level;
  const levelBadge = level === "ok" ? badge("ok", "😊 放心用") : level === "caution" ? badge("caution", "🤔 留个心眼") : level === "warning" ? badge("warn", "⚠️ 别急着装") : "";
  const link = p.github?.url ?? (p.npm?.name ? `https://www.npmjs.com/package/${encodeURIComponent(p.npm.name)}` : "#");
  return `<div class="card">
  <div class="hd"><a href="${esc(link)}" target="_blank">${esc(p.name)}</a>${levelBadge}${extra ?? ""}<span class="dim">质量分 ${p.score}${p.github?.stars != null ? " · ⭐" + p.github.stars : ""}</span></div>
  <div class="sum">${esc(p.summary || "(无简介)")}</div>
  ${intro ? `<div class="intro">📋 ${intro}</div>` : ""}
</div>`;
}
function section(icon, title, note, href, list, extraFn) {
  // 板块导航卡：点卡片跳市场页对应视图
  const head = `<a class="sec-card" href="${href}">
  <div class="sec-icon">${icon}</div>
  <div class="sec-body"><div class="sec-title">${title}</div><div class="sec-note">${note ?? ""}</div></div>
  <div class="sec-go">去市场 →</div>
</a>`;
  if (!list.length) return head + `<p class="muted">今日暂无</p>`;
  return head + list.map((x) => (x.p ? itemCard(x.p, extraFn ? extraFn(x) : "") : itemCard(x, extraFn ? extraFn(x) : ""))).join("");
}

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH 插件市场 · 每日日报 ${today}</title>
<style>
:root{--bg:#0f1117;--card:#171a23;--fg:#e8eaf0;--dim:#9aa0b0;--line:#2a2f42;--green:#3ddc84;--orange:#ffb020;--red:#ff5c5c;--blue:#5aa2ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;line-height:1.6}
.wrap{max-width:860px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:24px;margin:0 0 4px}a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
.sub{color:var(--dim);font-size:13px;margin-bottom:24px}
h2{font-size:18px;margin:32px 0 6px;border-left:3px solid var(--blue);padding-left:10px}
.muted{color:var(--dim);font-size:12px;margin:0 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin-bottom:10px}
.hd{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-weight:700}
.b{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px}.b.ok{background:#123524;color:var(--green)}.b.caution{background:#33290f;color:var(--orange)}.b.warn{background:#3a1515;color:var(--red)}.b.grow{background:#0f2440;color:var(--blue)}
.dim{color:var(--dim);font-size:12px;font-weight:400;margin-left:auto}
.sum{font-size:13px;margin-top:4px}
.intro{font-size:13px;color:var(--fg);background:#1c2030;border-radius:8px;padding:8px 10px;margin-top:8px}
.foot{margin-top:40px;color:var(--dim);font-size:12px;border-top:1px solid var(--line);padding-top:12px}
.nav-card{display:flex;align-items:center;gap:14px;background:linear-gradient(135deg,#1c2030,#17203a);border:1px solid #3a4a7a;border-radius:14px;padding:12px 18px;margin-bottom:20px;text-decoration:none;color:var(--fg);transition:transform .15s}
.nav-card:hover{transform:translateY(-2px)}
.nav-icon{font-size:26px}.nav-body{flex:1}.nav-title{font-size:15px;font-weight:700}.nav-stats{font-size:12px;color:var(--dim);margin-top:2px}.nav-go{background:var(--blue);color:#0b1220;font-size:13px;font-weight:600;padding:7px 14px;border-radius:9px;white-space:nowrap}
.sec-card{display:flex;align-items:center;gap:12px;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--blue);border-radius:12px;padding:10px 16px;margin:26px 0 10px;text-decoration:none;color:var(--fg);transition:transform .15s}
.sec-card:hover{transform:translateY(-2px);border-color:var(--blue)}
.sec-icon{font-size:22px}.sec-body{flex:1}.sec-title{font-size:16px;font-weight:700}.sec-note{font-size:12px;color:var(--dim);margin-top:1px}.sec-go{color:var(--blue);font-size:12px;font-weight:600;white-space:nowrap}
</style></head><body><div class="wrap">
<a class="nav-card" href="index.html">
  <div class="nav-icon">🛒</div>
  <div class="nav-body">
    <div class="nav-title">DSH 插件市场 <span class="dim">共 ${plugins.length} 个插件</span></div>
    <div class="nav-stats">浏览全部插件 · 分类筛选排序检索 · 每个插件带 AI 评估报告</div>
  </div>
  <div class="nav-go">逛市场 →</div>
</a>
<h1>📰 每日日报</h1>
<div class="sub">${today} · 数据每天 13:00 自动更新</div>
${section("🆕", "新推出的插件", "最近 48 小时首次收录 · 点卡看全部新货", "index.html?sort=newest", fresh)}
${section("🔥", "涨星最快的插件", trendingNote, "index.html?sort=stars-desc", trending.map((x) => ({ p: x.p, delta: x.prev != null ? `+${x.now - x.prev}` : null })), (x) => (x.delta ? badge("grow", `📈 ${x.delta}⭐`) : ""))}
${section("✨", "热门插件的更新", "近 48 小时有代码推送的高星插件 · 点卡按星数排行", "index.html?sort=stars-desc", updated)}
<div class="foot">评估报告由 AI 生成，仅供参考，非安全认证。历史快照：data/history/（每日一份，用于涨星统计）。</div>
</div></body></html>`;

const md = `# 🛒 DSH 插件市场 · 每日日报（${today}）

## 🆕 新推出的插件
${fresh.map((p) => `- **${p.name}** ${p.github?.url ? `[链接](${p.github.url})` : ""} — ${p.summary || ""}`).join("\n") || "今日暂无"}

## 🔥 涨星最快的插件
${trendingNote}
${trending.map((x) => `- **${x.p.name}** ⭐${x.now}${x.prev != null ? `（+${x.now - x.prev}）` : ""} — ${x.p.summary || ""}`).join("\n") || "暂无"}

## ✨ 热门插件的更新
${updated.map((p) => `- **${p.name}** ⭐${p.github?.stars ?? "?"} — ${p.summary || ""} ${p.github?.url ? `[链接](${p.github.url})` : ""}`).join("\n") || "今日暂无"}

---
> 评估报告由 AI 生成，仅供参考，非安全认证。历史快照见 data/history/。
`;

await writeFile(join(ROOT, "daily.html"), html);
await writeFile(join(ROOT, "daily.md"), md);
// 供市场页导航卡展示今日摘要
await writeFile(join(DATA, "latest-report.json"), JSON.stringify({ date: today, fresh: fresh.length, trending: trending.length, updated: updated.length }));
// 存档：docs/daily-report/<日期>.html（供 daily.html 历史列表链接）
const ARCHIVE_DIR = join(ROOT, "docs", "daily-report");
await mkdir(ARCHIVE_DIR, { recursive: true });
await writeFile(join(ARCHIVE_DIR, `${today}.html`), html);
console.log(`✅ 每日日报已生成（${today}）：新 ${fresh.length} / 涨星 ${trending.length} / 更新 ${updated.length}；历史快照 data/history/${today}.json；存档 docs/daily-report/${today}.html`);
