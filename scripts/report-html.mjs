#!/usr/bin/env node
/**
 * report-html.mjs — 生成插件市场审阅报告（HTML，自包含可双击打开）
 *
 * 性能优化版：卡片瘦身（评估报告点击展开，从内嵌 JSON 懒加载）；
 * 筛选用 display 切换（不再反复重建 DOM）；分类与 SQLite/查询共用同一套规则。
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CATS, CAT_LABEL, categorize } from "./lib/categories.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA = join(ROOT, "data");
const CACHE = join(DATA, "reports");

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const badge = (text, cls) => `<span class="badge ${cls}">${esc(text)}</span>`;
const trustBadge = (t) => (t === "official" ? badge("官方", "b-official") : t === "curated" ? badge("精选", "b-curated") : badge("待验证", "b-unverified"));
const levelBadge = (l) => (l === "ok" ? badge("😊 放心用", "b-ok") : l === "caution" ? badge("🤔 留个心眼", "b-caution") : badge("⚠️ 别急着装", "b-warning"));
function installBadge(m) {
  const map = { npm: ["npm", "b-npm"], git: ["git", "b-git"], tarball: ["tarball", "b-tarball"], none: ["不可安装", "b-none"] };
  const [label, cls] = map[m] ?? [m, "b-none"];
  return badge(label, cls);
}

/** ISO UTC → 北京时间（UTC+8，无夏令时）显示。 */
function beijingTime(iso) {
  if (!iso) return "";
  const bj = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  return bj.toISOString().replace("T", " ").slice(0, 19) + "（北京时间）";
}

const menu = JSON.parse(await readFile(join(DATA, "plugins.json"), "utf8"));
const meta = JSON.parse(await readFile(join(DATA, "meta.json"), "utf8"));
const reports = new Map();
try {
  for (const f of await readdir(CACHE)) {
    if (!f.endsWith(".json")) continue;
    try {
      const d = JSON.parse(await readFile(join(CACHE, f), "utf8"));
      reports.set(d.id ?? f, d.result);
    } catch {}
  }
} catch {}

const plugins = menu.plugins;
const byTrust = menu.stats.byTrustLayer ?? {};
const installCount = {};
const catCount = {};
for (const p of plugins) {
  installCount[p.install.method] = (installCount[p.install.method] ?? 0) + 1;
  catCount[categorize(p)] = (catCount[categorize(p)] ?? 0) + 1;
}

// 评估报告数据（内嵌 JSON，点击展开懒加载；文本已转义，避免 innerHTML 渲染错乱）
const reportBlob = {};
for (const p of plugins) {
  const r = reports.get(p.id);
  const er = r?.evaluationReport;
  const cls = r?.classification;
  if (er || cls) {
    reportBlob[p.id] = {
      level: er?.level ?? null,
      intro: esc(er?.intro ?? ""),
      risks: esc(er?.risks ?? ""),
      post: esc(er?.postInstallNotes ?? "无"),
      notes: er?.notes && er.notes !== "无" ? esc(er.notes) : null,
      clsType: cls?.type ?? null,
      clsConf: cls?.confidence ?? null,
      clsReason: esc(cls?.reason ?? null),
    };
  }
}

// 卡片（瘦身版：报告点击展开）
const cards = plugins
  .map((p) => {
    const cat = categorize(p);
    const stars = p.github?.stars;
    const dl = p.npm?.downloadsLastMonth;
    const hasReport = reportBlob[p.id] ? 1 : 0;
    return `<div class="card" data-cat="${cat}" data-trust="${p.trustLayer}" data-install="${p.install.method}" data-source="${(p.sources ?? []).join(",")}" data-score="${p.score}" data-stars="${stars ?? ""}" data-dl="${dl ?? ""}" data-first="${p.firstSeen ?? ""}" data-name="${esc((p.id + " " + p.name + " " + (p.summary ?? "")).toLowerCase())}" data-id="${esc(p.id)}">
  <div class="card-head">
    <div class="card-title">
      <a href="${esc(p.github?.url ?? "#")}" target="_blank">${esc(p.name)}</a>
      <span class="id">${esc(p.id)}</span>
    </div>
    <div class="card-badges">${badge(CAT_LABEL[cat], "b-cat")} ${trustBadge(p.trustLayer)} ${installBadge(p.install.method)}</div>
  </div>
  <div class="score">质量分 <b>${p.score}</b>/10 <span class="dim">${stars != null ? "⭐" + stars : ""}${dl != null ? " · 月下载 " + dl : ""}</span></div>
  <div class="summary">${esc(p.summary || "(无简介)")}</div>
  <div class="fields">
    <div class="field"><span class="k">安装</span> ${installBadge(p.install.method)} 口令：<code>${esc(p.install.packageSpec ?? "-")}</code></div>
    ${p.github ? `<div class="field"><span class="k">GitHub</span> ⭐${stars ?? "?"} · 推送 ${esc((p.github.pushedAt ?? "").slice(0, 10)) || "-"}</div>` : ""}
    ${p.npm ? `<div class="field"><span class="k">npm</span> ${esc(p.npm.name)}@${esc(p.npm.version ?? "?")} · 月下载 ${dl ?? "?"}</div>` : ""}
  </div>
  ${hasReport ? `<button class="rep-btn" data-rep="${esc(p.id)}">📋 查看评估报告</button><div class="report" id="rep-${esc(p.id)}" hidden></div>` : `<div class="report dim">（无评估报告）</div>`}
</div>`;
  })
  .join("\n");

const suspiciousRows = (meta.community?.suspicious ?? [])
  .map((s) => `<tr><td>${esc(s.id)}</td><td>${esc(s.type)}</td><td>${s.confidence}</td><td>${esc(s.reason ?? "")}</td></tr>`)
  .join("");
const skippedRows = (meta.community?.skipped ?? [])
  .map((s) => `<tr><td>${esc(s.id)}</td><td>${esc(s.reason ?? "")}</td></tr>`)
  .join("");

const catChips = CATS.map((c) => `<button class="chip" data-cat-chip="${c.key}" data-active="false">${c.label} <span class="cnt">${catCount[c.key] ?? 0}</span></button>`).join("");
const trustChips = [["official", "官方"], ["unverified", "待验证"]].map(([k, l]) => `<button class="chip" data-trust-chip="${k}" data-active="false">${l} <span class="cnt">${byTrust[k] ?? 0}</span></button>`).join("");
const installChips = [["npm", "npm"], ["git", "git"], ["tarball", "tarball"], ["none", "不可安装"]].map(([k, l]) => `<button class="chip" data-install-chip="${k}" data-active="false">${l} <span class="cnt">${installCount[k] ?? 0}</span></button>`).join("");
const sourceChips = [["npm-registry", "npm"], ["github-topic", "GitHub"], ["official-monorepo", "官方仓库"]].map(([k, l]) => `<button class="chip" data-source-chip="${k}" data-active="false">${l}</button>`).join("");

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DSH 插件市场</title>
<style>
  :root { --bg:#0f1117; --card:#171a23; --card2:#1c2030; --fg:#e8eaf0; --dim:#9aa0b0; --line:#2a2f42;
    --green:#3ddc84; --orange:#ffb020; --red:#ff5c5c; --blue:#5aa2ff; --purple:#b48cff; --teal:#3ddcd0; --gray:#8a90a0; --pink:#ff8fb3; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font-family: "Microsoft YaHei","PingFang SC",system-ui,sans-serif; line-height:1.6; }
  .wrap { max-width: 1200px; margin: 0 auto; padding: 28px 20px 80px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .sub { color: var(--dim); font-size: 13px; margin-bottom: 18px; }
  .stats { display:grid; grid-template-columns: repeat(auto-fit, minmax(120px,1fr)); gap:10px; margin-bottom: 20px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 14px; }
  .stat .n { font-size: 24px; font-weight: 700; }
  .stat .l { color:var(--dim); font-size: 12px; }
  .toolbar { position:sticky; top:0; z-index:10; background:rgba(15,17,23,.96); border:1px solid var(--line); border-radius:14px; padding:12px 14px; margin-bottom:16px; }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:4px 0; }
  .row .lab { color:var(--dim); font-size:12px; min-width:44px; }
  input.search { flex:1; min-width:200px; background:var(--card); border:1px solid var(--line); color:var(--fg); padding:8px 12px; border-radius:10px; font-size:14px; }
  select { background:var(--card); border:1px solid var(--line); color:var(--fg); padding:7px 10px; border-radius:10px; font-size:13px; }
  .chip { background:var(--card); border:1px solid var(--line); color:var(--dim); padding:4px 11px; border-radius:999px; font-size:12px; cursor:pointer; }
  .chip:hover { border-color:var(--blue); color:var(--fg); }
  .chip[data-active="true"] { background:var(--blue); border-color:var(--blue); color:#0b1220; font-weight:600; }
  .chip .cnt { opacity:.7; }
  .result-bar { color:var(--dim); font-size:13px; margin-bottom:12px; }
  .cards { display:grid; grid-template-columns: repeat(auto-fill, minmax(430px,1fr)); gap:12px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px 16px; }
  .card.hidden { display:none; }
  .card-head { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; }
  .card-title a { color:var(--fg); font-size:15px; font-weight:700; text-decoration:none; }
  .card-title a:hover { color:var(--blue); }
  .id { display:block; color:var(--dim); font-size:11px; font-family:Consolas,monospace; word-break:break-all; }
  .card-badges { display:flex; gap:5px; flex-wrap:wrap; justify-content:flex-end; }
  .badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; white-space:nowrap; }
  .b-official{background:#123524;color:var(--green);border:1px solid var(--green);}
  .b-curated{background:#33290f;color:var(--orange);border:1px solid var(--orange);}
  .b-unverified{background:#2a2020;color:var(--orange);border:1px solid #6b5420;}
  .b-ok{background:#123524;color:var(--green);}
  .b-caution{background:#33290f;color:var(--orange);}
  .b-warning{background:#3a1515;color:var(--red);}
  .b-npm{background:#0f2440;color:var(--blue);}
  .b-git{background:#241240;color:var(--purple);}
  .b-tarball{background:#0f3330;color:var(--teal);}
  .b-none{background:#232630;color:var(--gray);}
  .b-cat{background:#2a1a35;color:var(--pink);border:1px solid #5a2a55;}
  .score { margin:8px 0 4px; font-size:13px; color:var(--dim); }
  .score b { color:var(--fg); font-size:16px; }
  .dim { color:var(--dim); }
  .summary { color:var(--fg); font-size:13px; margin-bottom:10px; }
  .fields { border-top:1px dashed var(--line); padding-top:8px; }
  .field { font-size:12px; color:var(--fg); margin:3px 0; }
  .k { color:var(--dim); display:inline-block; min-width:62px; }
  code { background:var(--card2); padding:1px 6px; border-radius:5px; font-size:11px; font-family:Consolas,monospace; }
  .rep-btn { margin-top:10px; background:var(--card2); border:1px solid var(--blue); color:var(--blue); padding:5px 12px; border-radius:9px; font-size:12px; cursor:pointer; }
  .rep-btn:hover { background:var(--blue); color:#0b1220; }
  .report { margin-top:10px; border:1px solid var(--line); border-radius:10px; background:var(--card2); padding:10px 13px; font-size:13px; }
  .report-block { margin:4px 0; }
  .report-block.warn { color:var(--orange); }
  .report-block.dim { color:var(--dim); }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); }
  th { color:var(--dim); font-weight:600; }
  .muted { color:var(--dim); font-size:12px; }
  details { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 14px; margin-top:8px; }
  summary { cursor:pointer; font-weight:600; }
  .foot { margin-top:40px; color:var(--dim); font-size:12px; border-top:1px solid var(--line); padding-top:14px; }
  .empty { color:var(--dim); text-align:center; padding:40px 0; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🛒 DSH 插件市场</h1>
  <div class="sub">生成时间 ${esc(beijingTime(menu.generatedAt))} · 共 ${plugins.length} 条 · 报告 ${Object.keys(reportBlob).length} 份（点击展开，懒加载）</div>

  <div class="stats">
    <div class="stat"><div class="n">${plugins.length}</div><div class="l">插件总数</div></div>
    <div class="stat"><div class="n">${byTrust.official ?? 0}</div><div class="l">官方</div></div>
    <div class="stat"><div class="n">${byTrust.unverified ?? 0}</div><div class="l">待验证</div></div>
    <div class="stat"><div class="n">${installCount.npm ?? 0}</div><div class="l">npm 安装</div></div>
    <div class="stat"><div class="n">${installCount.git ?? 0}</div><div class="l">git 安装</div></div>
    <div class="stat"><div class="n">${installCount.tarball ?? 0}</div><div class="l">tarball</div></div>
    <div class="stat"><div class="n">${installCount.none ?? 0}</div><div class="l">不可安装</div></div>
  </div>

  <div class="toolbar">
    <div class="row"><input class="search" id="q" placeholder="🔍 检索名称 / 简介 / 评估报告…"><select id="sort">
      <option value="score-desc">按 质量分 ↓</option>
      <option value="score-asc">按 质量分 ↑</option>
      <option value="stars-desc">按 星星数 ↓</option>
      <option value="dl-desc">按 月下载量 ↓</option>
      <option value="newest">按 最新发现</option>
      <option value="name">按 名称 A-Z</option>
    </select></div>
    <div class="row"><span class="lab">分类</span>${catChips}</div>
    <div class="row"><span class="lab">信任</span>${trustChips}<span class="lab" style="margin-left:10px">安装</span>${installChips}<span class="lab" style="margin-left:10px">来源</span>${sourceChips}</div>
    <div class="row"><button class="chip" id="reset" style="border-color:var(--red);color:var(--red)">✕ 重置全部</button><span id="count" class="result-bar" style="margin:0 0 0 8px"></span></div>
  </div>

  <div class="cards" id="cards">${cards}</div>
  <div class="empty" id="empty" style="display:none">没有匹配的插件，试试放宽筛选条件</div>

  <h2>存疑清单（${meta.community?.suspicious?.length ?? 0}）</h2>
  ${(meta.community?.suspicious?.length ?? 0) > 0 ? `<table><tr><th>插件</th><th>AI 类型</th><th>信心</th><th>理由</th></tr>${suspiciousRows}</table>` : `<div class="muted">无</div>`}

  <details>
    <summary>跳过清单（${meta.community?.skippedCount ?? 0}）— 未通过 D7</summary>
    ${(meta.community?.skipped?.length ?? 0) > 0 ? `<table><tr><th>仓库</th><th>原因</th></tr>${skippedRows}</table>` : `<div class="muted">无</div>`}
  </details>

  <div class="foot">评估报告由 LLM 生成，仅供参考，非安全认证。分类为呈现层启发式（v0.2 进 schema）。</div>
</div>
<script>
window.__REPORTS__ = ${JSON.stringify(reportBlob)};
const cards = Array.from(document.querySelectorAll(".card"));
const grid = document.getElementById("cards");
const q = document.getElementById("q");
const sortSel = document.getElementById("sort");
const countEl = document.getElementById("count");
const emptyEl = document.getElementById("empty");
const state = { cat: null, trust: null, install: null, source: null };

function setChip(sel, key, val) {
  document.querySelectorAll(sel).forEach((c) => { c.dataset.active = c.dataset[key] === val && val ? "true" : "false"; });
}
function bindChips(sel, key, prop) {
  document.querySelectorAll(sel).forEach((c) => c.onclick = () => {
    state[prop] = state[prop] === c.dataset[key] ? null : c.dataset[key];
    setChip(sel, key, state[prop]);
    render();
  });
}
bindChips("[data-cat-chip]", "catChip", "cat");
bindChips("[data-trust-chip]", "trustChip", "trust");
bindChips("[data-install-chip]", "installChip", "install");
bindChips("[data-source-chip]", "sourceChip", "source");
document.getElementById("reset").onclick = () => { state.cat = state.trust = state.install = state.source = null; q.value = ""; document.querySelectorAll(".chip").forEach((c) => c.dataset.active = "false"); render(); };
q.addEventListener("input", render);
sortSel.addEventListener("change", render);

let lastSort = "";
function render() {
  const kw = q.value.trim().toLowerCase();
  let visible = [];
  // 筛选：display 切换（快，不重建 DOM）
  for (const c of cards) {
    let ok = true;
    if (state.cat && c.dataset.cat !== state.cat) ok = false;
    else if (state.trust && c.dataset.trust !== state.trust) ok = false;
    else if (state.install && c.dataset.install !== state.install) ok = false;
    else if (state.source && !c.dataset.source.split(",").includes(state.source)) ok = false;
    else if (kw && !c.dataset.name.includes(kw)) ok = false;
    c.classList.toggle("hidden", !ok);
    if (ok) visible.push(c);
  }
  // 排序：仅在排序值变化时重排
  const sort = sortSel.value;
  if (sort !== lastSort) {
    lastSort = sort;
    visible.sort((a, b) => {
      const n = (v, d) => { const x = parseFloat(v); return isNaN(x) ? d : x; };
      if (sort === "score-desc") return n(b.dataset.score, -1) - n(a.dataset.score, -1);
      if (sort === "score-asc") return n(a.dataset.score, 1e9) - n(b.dataset.score, 1e9);
      if (sort === "stars-desc") return n(b.dataset.stars, -1) - n(a.dataset.stars, -1);
      if (sort === "dl-desc") return n(b.dataset.dl, -1) - n(a.dataset.dl, -1);
      if (sort === "newest") return b.dataset.first.localeCompare(a.dataset.first);
      return a.dataset.name.localeCompare(b.dataset.name);
    });
    visible.forEach((c) => grid.appendChild(c));
  }
  emptyEl.style.display = visible.length ? "none" : "";
  countEl.textContent = "显示 " + visible.length + " / " + cards.length + " 条";
}

// 评估报告懒加载（点击展开）——注意：此处禁用模板字符串，避免与外层模板冲突
document.addEventListener("click", function (e) {
  var btn = e.target.closest(".rep-btn");
  if (!btn) return;
  var id = btn.dataset.rep;
  var box = document.getElementById("rep-" + id);
  if (!box || box.innerHTML) return;
  var r = window.__REPORTS__[id];
  if (!r) return;
  var levelLabel = r.level === "ok" ? "😊 放心用" : r.level === "caution" ? "🤔 留个心眼" : r.level === "warning" ? "⚠️ 别急着装" : "";
  var html = '<div class="report-block"><b>📋 评估报告' + (levelLabel ? " · " + levelLabel : "") + "</b></div>" +
    '<div class="report-block">' + (r.intro || "") + "</div>" +
    '<div class="report-block"><span class="k">风险</span> ' + (r.risks || "") + "</div>" +
    '<div class="report-block"><span class="k">装后</span> ' + (r.post || "") + "</div>";
  if (r.notes && r.notes !== "无") html += '<div class="report-block warn"><span class="k">提醒</span> ' + r.notes + "</div>";
  if (r.clsType) html += '<div class="report-block dim">AI 类型判断：' + r.clsType + "（信心 " + r.clsConf + "）— " + (r.clsReason || "") + "（仅参考）</div>";
  box.innerHTML = html;
  box.hidden = false;
});
render();
</script>
</body>
</html>`;

await writeFile(join(ROOT, "report.html"), html);
await writeFile(join(ROOT, "index.html"), html); // GitHub Pages 根入口（同一内容）
console.log(`✅ 已生成 report.html + index.html（${plugins.length} 条，报告懒加载 + display 切换筛选）`);
