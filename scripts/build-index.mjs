#!/usr/bin/env node
/**
 * build-index.mjs — 生成插件菜单 plugins.json（schema v0.1）
 *
 * 用法：
 *   node scripts/build-index.mjs --source official-local --root "<node_modules/@deepseek-ai 路径>"
 *   node scripts/build-index.mjs --source github-topic [--token ghp_xxx] [--since YYYY-MM-DD] [--limit N] [--llm]
 *
 * 特性：
 *   - 无第三方依赖（只用 Node 内置 fetch/fs）
 *   - 幂等：同一输入重复运行产出一致
 *   - 入选（D7）：三信号任一（盖章/依赖/标签）——topic 候选自带标签即入选
 *   - 质量分（D9）：星星 + 活跃度 + 用户评分 加权（权重待真实数据校准）
 *   - LLM（D10）：--llm 时对入选候选做 3-in-1（分类/安装方式/安全报告），分类非插件者出池；结果缓存
 *
 * 设计依据：docs/design/menu-schema.md（决策 D1–D10、§五·A）、docs/analysis/04 §三
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, hasLLM, analyzePlugin, readCache, writeCache } from "./lib/llm.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // plgstore/
const OUT_DIR = join(ROOT, "data");
const SCHEMA_VERSION = "0.1.0";
const GENERATOR = "dsh-market-index@0.1.0";
const GITHUB_API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const has = (name) => args.includes(`--${name}`);
const env = await loadEnv();
const source = flag("source", "official-local");
const officialRoot = flag("root", process.env.DSH_OFFICIAL_ROOT ?? "");
const token = flag("token", process.env.GITHUB_TOKEN ?? env.GITHUB_TOKEN ?? "");
const since = flag("since", "");
const limit = Number(flag("limit", "0")) || 0;
const useLLM = has("llm");

if (useLLM && !hasLLM(env)) {
  console.warn("[warn] --llm 已指定但 .env 里没有 DEEPSEEK_API_KEY，将跳过 LLM 分析");
}

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const nowIso = now();

/* ---------------- 通用 ------------- */

async function readPkg(dir) {
  try {
    return JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  } catch (e) {
    console.warn(`  [warn] 读取 package.json 失败: ${dir} (${e.message})`);
    return null;
  }
}

const isBundle = (pkg) => !!(pkg?.dsh?.bundle?.patch || pkg?.dsh?.bundle === true);
const isClient = (pkg) => !!pkg?.dsh?.client;

const shortName = (full) => full.replace(/^@[^/]+\//, "");

function makeOfficialRecord(pkg) {
  return {
    id: pkg.name,
    name: shortName(pkg.name),
    summary: pkg.description ?? "",
    sources: ["official-monorepo"],
    trustLayer: "official",
    github: {
      owner: "deepseek-ai",
      repo: "deepseek-harness",
      url: "https://github.com/deepseek-ai/deepseek-harness",
      stars: null,
      topics: ["deepseek-harness"],
      pushedAt: null,
    },
    npm: {
      name: pkg.name,
      version: pkg.version,
      downloadsLastMonth: null,
      keywords: pkg.keywords ?? [],
      dshDeclarations: { bundle: true, client: isClient(pkg) },
    },
    score: 10, // 官方固定高分
    firstSeen: nowIso,
    updatedAt: nowIso,
    install: { method: "npm", packageSpec: pkg.name },
  };
}

/** D9 质量分（0–10）：星星 + 活跃度 + 用户评分 加权。权重 ❓ 待真实数据校准。 */
function qualityScore(stars, pushedAt) {
  const starsScore = Math.min(1, (stars ?? 0) / 2000); // 0~1：2000 星封顶
  let activityScore = 0.1;
  const pushed = pushedAt ? new Date(pushedAt).getTime() : 0;
  const age = Date.now() - pushed;
  if (pushed && age < 90 * 864e5) activityScore = 1;
  else if (pushed && age < 365 * 864e5) activityScore = 0.5;
  const ratingsScore = 0; // 无评分数据（Step 11 后接入）
  const s = starsScore * 0.5 + activityScore * 0.4 + ratingsScore * 0.1;
  return Math.round(s * 10);
}

async function fetchText(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "dsh-market-index" } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function writeOutput(records, meta) {
  const byTrustLayer = {};
  for (const r of records) byTrustLayer[r.trustLayer] = (byTrustLayer[r.trustLayer] ?? 0) + 1;
  const menu = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: nowIso,
    generator: GENERATOR,
    stats: { total: records.length, byTrustLayer },
    plugins: records,
  };

  const required = ["id", "name", "sources", "trustLayer", "score", "firstSeen", "updatedAt", "install"];
  const errors = [];
  const seen = new Set();
  for (const r of records) {
    for (const f of required) if (r[f] === undefined) errors.push(`缺少字段 ${f}: ${r.id}`);
    if (seen.has(r.id)) errors.push(`id 重复: ${r.id}`);
    seen.add(r.id);
  }
  if (errors.length) {
    console.error("自检失败：\n" + errors.join("\n"));
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "plugins.json"), JSON.stringify(menu, null, 2) + "\n");
  await writeFile(join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2) + "\n");

  console.log(`✅ 已写入 data/plugins.json（${records.length} 条）与 data/meta.json`);
  console.log(`   信任档分布: ${JSON.stringify(byTrustLayer)}`);
}

/* ---------------- 模式一：official-local ------------- */

async function runOfficialLocal(root) {
  if (!root) {
    console.error(
      "缺少官方包目录。请传 --root \"<node_modules/@deepseek-ai 路径>\" 或设置 DSH_OFFICIAL_ROOT。\n" +
        "示例：node scripts/build-index.mjs --source official-local --root \"C:/.../node_modules/@deepseek-ai\""
    );
    process.exit(2);
  }
  const entries = await readdir(root, { withFileTypes: true });
  const records = [];
  const excluded = [];
  let scanned = 0;

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const pkg = await readPkg(join(root, e.name));
    if (!pkg || !pkg.name) continue;
    scanned++;
    if (isBundle(pkg)) {
      records.push(makeOfficialRecord(pkg));
    } else {
      excluded.push({
        name: pkg.name,
        reason: isClient(pkg) ? "client-component（web 界面组件，随 bundle 分发，非独立安装）" : "internal-lib（内部零件）",
      });
    }
  }

  const meta = {
    schemaVersion: SCHEMA_VERSION,
    generator: GENERATOR,
    mode: "official-local",
    officialRoot,
    generatedAt: nowIso,
    scannedOfficialPackages: scanned,
    included: records.length,
    excludedCount: excluded.length,
    excluded,
    notes: [
      "官方包仅收录声明 dsh.bundle 的 profile 层（决策 D3；与 PROFILE_TEMPLATES 一致）。",
      "stars/downloadsLastMonth 本地离线为 null，联网 enrich 模式后填充。",
      "firstSeen/updatedAt 为首次本地建索引时间，非上游真实时间。",
    ],
  };
  await writeOutput(records, meta);
}

/* ---------------- 模式二：github-topic ------------- */

async function ghFetch(pathname, params) {
  const q = new URLSearchParams(params).toString();
  const res = await fetch(`${GITHUB_API}${pathname}?${q}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "dsh-market-index",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${pathname} -> ${res.status} ${res.statusText}`);
  return res.json();
}

async function crawlTopic() {
  // 候选缓存：重跑不重复消耗搜索 API 配额（幂等 + 省限额）
  const CACHE_FILE = join(OUT_DIR, "cache", "candidates.json");
  if (!has("force-crawl")) {
    try {
      const cached = JSON.parse(await readFile(CACHE_FILE, "utf8"));
      console.log(`使用候选缓存（${cached.length} 个，--force-crawl 可重新抓取）`);
      return cached;
    } catch {}
  }
  const buckets = [];
  // DSH 很新（开发者预览约 2026-06，正式发布 2026-08），只爬这之后；--since 可覆盖
  const start = since || "2026-06-01";
  const end = new Date().toISOString().slice(0, 10);
  for (let t = new Date(start); t <= new Date(end); t.setMonth(t.getMonth() + 6)) {
    const lo = t.toISOString().slice(0, 10);
    const hi = new Date(t.getFullYear(), t.getMonth() + 6, 1).toISOString().slice(0, 10);
    buckets.push(`${lo}..${hi}`);
  }
  const items = [];
  const fullCrawl = has("discover-only"); // 全量模式：不早停、放慢节拍（搜索配额 10 次/分钟）
  const earlyStop = limit && !fullCrawl ? limit * 3 : 0;
  const pageSleep = fullCrawl ? 6500 : 250;
  outer: for (const range of buckets) {
    for (let page = 1; page <= 10; page++) {
      const data = await ghFetch("/search/repositories", {
        q: `topic:dsh-plugin created:${range}`,
        per_page: 100,
        page,
        sort: "stars",
      });
      items.push(...data.items);
      if (earlyStop && items.length >= earlyStop) break outer;
      if (data.items.length < 100 || data.total_count <= page * 100) break;
      await new Promise((r) => setTimeout(r, pageSleep));
    }
  }
  // 写候选缓存（只存精简字段，控制体积）
  await mkdir(join(OUT_DIR, "cache"), { recursive: true });
  const slim = items.map((i) => ({
    full_name: i.full_name,
    name: i.name,
    description: i.description,
    html_url: i.html_url,
    stargazers_count: i.stargazers_count,
    pushed_at: i.pushed_at,
    topics: i.topics ?? [],
    owner: { login: i.owner.login },
  }));
  await writeFile(CACHE_FILE, JSON.stringify(slim));
  return slim;
}

async function analyzeCandidate(item, packageJson) {
  const full = item.full_name;
  const [owner, repo] = full.split("/");
  const readme = await fetchRepoReadme(owner, repo);

  const result = await analyzePlugin(env, {
    name: item.name,
    repoUrl: item.html_url,
    stars: item.stargazers_count,
    pushedAt: item.pushed_at,
    topics: item.topics ?? [],
    readme,
    packageJson,
  });
  await writeCache(full, result);
  return { full, item, result };
}

/** 抓仓库文件：jsdelivr CDN 优先（不占 GitHub 配额），GitHub API 兜底。 */
async function fetchRepoFile(owner, repo, filename, candidates) {
  for (const [br, file] of candidates) {
    const txt = await fetchText(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@${br}/${file}`);
    if (txt) return txt;
  }
  // 兜底：GitHub API contents（raw accept 直接返回文本）
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${filename}`, {
    headers: { Accept: "application/vnd.github.raw", "User-Agent": "dsh-market-index", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) return null;
  return await res.text();
}

async function fetchRepoPackageJson(owner, repo) {
  return await fetchRepoFile(owner, repo, "package.json", [
    ["main", "package.json"],
    ["master", "package.json"],
  ]);
}

async function fetchRepoReadme(owner, repo) {
  const viaCDN = await fetchRepoFile(owner, repo, "README.md", [
    ["main", "README.md"],
    ["master", "README.md"],
    ["main", "README.zh.md"],
    ["master", "README.zh.md"],
    ["main", "README.en.md"],
    ["master", "README.en.md"],
  ]);
  if (viaCDN) return viaCDN;
  // 兜底：GitHub API /readme（自动识别任意 README 文件名）
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/readme`, {
    headers: { Accept: "application/vnd.github.raw", "User-Agent": "dsh-market-index", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) return "";
  return await res.text();
}

/** D7（修订版）：入选只看「依赖 / 盖章 / 官方」，标签不再算数。 */
function entryCheck(packageJsonText, owner, repo) {
  if (owner === "deepseek-ai" && repo === "deepseek-harness") return { pass: true, signal: "official" };
  if (!packageJsonText) return { pass: false, reason: "无 package.json" };
  let pkg;
  try {
    pkg = JSON.parse(packageJsonText);
  } catch {
    return { pass: false, reason: "package.json 解析失败" };
  }
  const dsh = pkg.dsh;
  if (dsh?.bundle?.patch || dsh?.bundle === true || dsh?.client) return { pass: true, signal: "盖章(dsh 声明)" };
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
  const coreHit = Object.keys(deps).find((d) => d === "@deepseek-ai/cordis" || d.startsWith("@deepseek-ai/dsh-"));
  if (coreHit) return { pass: true, signal: `依赖(${coreHit})` };
  return { pass: false, reason: "无盖章、无 DSH 核心依赖、非官方" };
}

async function runGithubTopic() {
  console.log("github-topic 模式（需外网）……");
  let items;
  try {
    items = await crawlTopic();
  } catch (e) {
    console.error(`[error] 网络不可用或 GitHub 拒绝：${e.message}`);
    process.exit(1);
  }
  console.log(`抓到候选 ${items.length} 个（去重后 ${new Set(items.map((i) => i.full_name)).size} 个）`);

  const records = [];
  const suspicious = [];
  const skipped = []; // 未通过 D7（无依赖/盖章/官方）
  const llmStats = { analyzed: 0, cached: 0, promptTokens: 0, completionTokens: 0 };
  const discoverOnly = has("discover-only"); // 只发现+体检，不写菜单、不调 LLM
  const githubCandidates = []; // discover-only 的输出

  // 按星星降序处理（--limit 时先看热门样本）
  const ordered = [...items].sort((a, b) => b.stargazers_count - a.stargazers_count);
  const processed = new Set();
  let count = 0;

  for (const item of ordered) {
    const full = item.full_name;
    const [owner, repo] = full.split("/");
    if (processed.has(full)) continue;
    processed.add(full);
    if (limit && !discoverOnly && count >= limit) break;
    count++;

    // D7（修订版）：先取 package.json 验明正身
    const packageJson = await fetchRepoPackageJson(owner, repo);
    const entry = entryCheck(packageJson, owner, repo);
    if (!entry.pass) {
      skipped.push({ id: full, reason: entry.reason });
      if (!discoverOnly) console.log(`  [${count}] ${full} — 未入选：${entry.reason}`);
      continue;
    }
    if (discoverOnly) {
      githubCandidates.push({ item, packageJson, entrySignal: entry.signal });
      console.log(`  [${count}] ${full}（${entry.signal}）→ 已入候选，待 LLM`);
      continue;
    }

    const base = {
      id: full,
      name: item.name,
      summary: item.description ?? "",
      sources: ["github-topic"],
      trustLayer: "unverified",
      github: {
        owner: item.owner.login,
        repo: item.name,
        url: item.html_url,
        stars: item.stargazers_count,
        topics: item.topics ?? [],
        pushedAt: item.pushed_at ?? null,
      },
      npm: null,
      score: qualityScore(item.stargazers_count, item.pushed_at),
      firstSeen: nowIso,
      updatedAt: nowIso,
      install: { method: "git", packageSpec: `git+https://github.com/${full}.git` },
    };

    if (useLLM && hasLLM(env)) {
      const cached = await readCache(full);
      let analysis;
      if (cached) {
        analysis = cached;
        llmStats.cached++;
      } else {
        try {
          const { result } = await analyzeCandidate(item, packageJson);
          analysis = result;
          llmStats.analyzed++;
          llmStats.promptTokens += analysis.usage?.prompt_tokens ?? 0;
          llmStats.completionTokens += analysis.usage?.completion_tokens ?? 0;
        } catch (e) {
          console.warn(`  [warn] ${full} 分析失败: ${e.message}（保留为未验证）`);
          analysis = null;
        }
      }
      if (analysis?.classification) {
        const cls = analysis.classification;
        // 分类不决定入选；非插件/低信心只进"存疑清单"供人工复查
        if (cls.type !== "plugin" || (cls.confidence ?? 1) < 0.6) {
          suspicious.push({ id: full, type: cls.type, confidence: cls.confidence, reason: cls.reason ?? "" });
        }
        // 安装方式：LLM 输出为准；"none"= 不可安装（保留在菜单但分数归零、不推荐）
        const inst = analysis.install ?? {};
        if (inst.method && inst.packageSpec && ["npm", "git", "tarball"].includes(inst.method)) {
          base.install = { method: inst.method, packageSpec: inst.packageSpec };
          if (inst.method === "npm") {
            base.npm = { name: inst.packageSpec.replace(/@\d.*$/, ""), version: null, downloadsLastMonth: null, keywords: [], dshDeclarations: null };
          }
        } else if (inst.method === "none" || !inst.packageSpec) {
          base.install = { method: "none", packageSpec: null };
          base.score = 0; // 不推荐
        }
        if (analysis.summaryZh) base.summary = analysis.summaryZh;
      }
    }
    records.push(base);
    console.log(`  [${count}] ${full}（${entry.signal}，stars=${item.stargazers_count}）`);
  }

  if (discoverOnly) {
    const out = {
      discoveredAt: nowIso,
      crawled: items.length,
      processed: count,
      entered: githubCandidates.length,
      skippedCount: skipped.length,
      skipped,
      candidates: githubCandidates,
    };
    await mkdir(join(OUT_DIR, "cache"), { recursive: true });
    await writeFile(join(OUT_DIR, "cache", "github-candidates.json"), JSON.stringify(out, null, 2));
    console.log(`\n✅ discover-only 完成：候选 ${githubCandidates.length} 个（跳过 ${skipped.length}），已存 data/cache/github-candidates.json`);
    return;
  }

  const costCNY = (llmStats.promptTokens / 1e6) * 2 + (llmStats.completionTokens / 1e6) * 8; // 保守估算 ¥2/百万入、¥8/百万出
  const meta = {
    schemaVersion: SCHEMA_VERSION,
    generator: GENERATOR,
    mode: "github-topic",
    generatedAt: nowIso,
    crawledCandidates: items.length,
    processed: count,
    included: records.length,
    skippedCount: skipped.length,
    skipped,
    suspiciousCount: suspicious.length,
    suspicious,
    llm: useLLM
      ? {
          enabled: true,
          analyzed: llmStats.analyzed,
          fromCache: llmStats.cached,
          promptTokens: llmStats.promptTokens,
          completionTokens: llmStats.completionTokens,
          estimatedCostCNY: +costCNY.toFixed(3),
          note: "价格按输入 ¥2/百万、输出 ¥8/百万保守估算，以 DeepSeek 官方价格为准",
        }
      : { enabled: false },
    notes: [
      "入选 = D7 修订版：依赖 / 盖章 / 官方，标签不再算数（用户 2026-08-15 拍板）。",
      "LLM 分类不筛选，仅记入存疑清单供人工复查；评估报告暂存 data/cache/llm/，v0.2 进菜单。",
      "质量分 = 星星+活跃度+评分 加权（D9），权重待校准；install.method=none 的插件分数归零（不推荐）。",
    ],
  };
  await writeOutput(records, meta);
}

/* ---------------- 入口 ------------- */

if (source === "official-local") {
  await runOfficialLocal(officialRoot);
} else if (source === "github-topic") {
  await runGithubTopic();
} else {
  console.error(`未知 --source: ${source}（支持 official-local / github-topic）`);
  process.exit(2);
}
