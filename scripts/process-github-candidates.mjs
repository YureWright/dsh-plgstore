#!/usr/bin/env node
/**
 * process-github-candidates.mjs — 处理 GitHub 全量候选（discover-only 的产出）
 *
 * 读取 data/cache/github-candidates.json → 去重（已在菜单的跳过）→ LLM 评估 → 并入 data/plugins.json。
 * 每 15 个存检查点，可断点续跑。
 *
 * 用法：node scripts/process-github-candidates.mjs [--limit N]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, hasLLM, analyzePlugin, readCache, writeCache } from "./lib/llm.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA = join(ROOT, "data");
const MENU = join(DATA, "plugins.json");
const CAND = join(DATA, "cache", "github-candidates.json");

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const limit = Number(flag("limit", "0")) || 0;
const env = await loadEnv();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchText(url, timeoutMs = 20000) {
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
async function mapLimit(items, concurrency, worker) {
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

function qualityScore(stars, pushedAt) {
  const starsScore = Math.min(1, (stars ?? 0) / 2000);
  let activityScore = 0.1;
  const pushed = pushedAt ? new Date(pushedAt).getTime() : 0;
  const age = Date.now() - pushed;
  if (pushed && age < 90 * 864e5) activityScore = 1;
  else if (pushed && age < 365 * 864e5) activityScore = 0.5;
  return Math.round((starsScore * 0.5 + activityScore * 0.4) * 10);
}

let cand;
try {
  cand = JSON.parse(await readFile(CAND, "utf8"));
} catch {
  console.log("data/cache/github-candidates.json 不存在（尚未爬取 GitHub 候选；本地先用 build-index --discover-only 生成）→ 跳过 GitHub 处理");
  process.exit(0);
}
const menu = JSON.parse(await readFile(MENU, "utf8"));

// 去重：菜单里已存在（按 id 或 github.url）
const existingById = new Map(menu.plugins.map((p) => [p.id, p]));
const existingByUrl = new Map(menu.plugins.filter((p) => p.github?.url).map((p) => [p.github.url, p]));

// 已在菜单的 → 刷新星星/推送时间/标签（不重跑 LLM）
const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
let refreshed = 0;
for (const c of cand.candidates) {
  const item = c.item;
  let rec = existingById.get(item.full_name) ?? existingByUrl.get(item.html_url);
  if (!rec) continue;
  if (rec.github) {
    if (item.stargazers_count != null) rec.github.stars = item.stargazers_count;
    if (item.pushed_at) rec.github.pushedAt = item.pushed_at;
    if (item.topics?.length) rec.github.topics = item.topics;
    rec.updatedAt = nowIso;
    refreshed++;
  }
}
if (refreshed > 0) {
  await writeFile(MENU, JSON.stringify(menu, null, 2) + "\n");
  console.log(`🔄 已刷新 ${refreshed} 个已有记录的 GitHub 元数据`);
}

const todo = cand.candidates.filter((c) => {
  const item = c.item;
  if (existingById.has(item.full_name)) return false;
  if (existingByUrl.has(item.html_url)) return false;
  return true;
});
const slice = limit ? todo.slice(0, limit) : todo;
console.log(`github 候选 ${cand.candidates.length}，已在菜单 ${cand.candidates.length - todo.length}，待处理 ${slice.length}（并发 4，每 15 个检查点）……`);

const llmStats = { promptTokens: 0, completionTokens: 0 };
let analyzed = 0;
const BATCH = 15;

const processOne = async ({ item, packageJson }) => {
  const full = item.full_name;
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const record = {
    id: full,
    name: item.name,
    summary: item.description ?? "",
    sources: ["github-topic"],
    trustLayer: "unverified",
    github: {
      owner: item.owner?.login ?? full.split("/")[0],
      repo: item.name,
      url: item.html_url,
      stars: item.stargazers_count ?? null,
      topics: item.topics ?? [],
      pushedAt: item.pushed_at ?? null,
    },
    npm: null,
    score: qualityScore(item.stargazers_count, item.pushed_at),
    firstSeen: now,
    updatedAt: now,
    install: { method: "git", packageSpec: `git+https://github.com/${full}.git` },
  };

  if (hasLLM(env)) {
    const cached = await readCache(full);
    let analysis = cached;
    if (!analysis) {
      try {
        const [owner, repo] = full.split("/");
        const readme =
          (await fetchText(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@main/README.md`)) ??
          (await fetchText(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@master/README.md`)) ??
          "";
        analysis = await analyzePlugin(env, {
          name: item.name,
          repoUrl: item.html_url,
          stars: item.stargazers_count ?? null,
          pushedAt: item.pushed_at ?? null,
          topics: item.topics ?? [],
          readme,
          packageJson,
        });
        await writeCache(full, analysis);
        analyzed++;
        llmStats.promptTokens += analysis.usage?.prompt_tokens ?? 0;
        llmStats.completionTokens += analysis.usage?.completion_tokens ?? 0;
      } catch (e) {
        console.warn(`  [warn] ${full} 分析失败: ${e.message}`);
        analysis = null;
      }
    }
    if (analysis?.install?.method && analysis.install.packageSpec && ["npm", "git", "tarball"].includes(analysis.install.method)) {
      record.install = { method: analysis.install.method, packageSpec: analysis.install.packageSpec };
      if (analysis.install.method === "npm") {
        record.npm = { name: analysis.install.packageSpec.replace(/@\d.*$/, ""), version: null, downloadsLastMonth: null, keywords: [], dshDeclarations: null };
      }
    } else if (analysis?.install?.method === "none" || (analysis && !analysis.install?.packageSpec)) {
      record.install = { method: "none", packageSpec: null };
      record.score = 0;
    }
    if (analysis?.summaryZh) record.summary = analysis.summaryZh;
  }
  menu.plugins.push(record);
  console.log(`  ✅ 入库 ${full}`);
};

let i = 0;
while (i < slice.length) {
  const batch = slice.slice(i, i + BATCH);
  await mapLimit(batch, 4, processOne);
  i += batch.length;
  const byTrustLayer = {};
  for (const p of menu.plugins) byTrustLayer[p.trustLayer] = (byTrustLayer[p.trustLayer] ?? 0) + 1;
  menu.stats = { total: menu.plugins.length, byTrustLayer };
  menu.generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  await writeFile(MENU, JSON.stringify(menu, null, 2) + "\n");
  console.log(`  检查点 ${i}/${slice.length}（菜单 ${menu.plugins.length} 条）`);
}

const costCNY = (llmStats.promptTokens / 1e6) * 2 + (llmStats.completionTokens / 1e6) * 8;
console.log(`\n✅ GitHub 候选处理完成：本次入库 ${slice.length}，菜单共 ${menu.plugins.length} 条`);
console.log(`   LLM 分析 ${analyzed} 次（缓存 ${slice.length - analyzed}），估算 ¥${costCNY.toFixed(3)}`);
