#!/usr/bin/env node
/**
 * fix-missing-reports.mjs — 补跑缺失的 LLM 评估报告（npm 与 GitHub 来源都支持）
 *
 * 场景：某插件上次分析失败/无缓存（LLM 网络抖动、输出非 JSON 等），此脚本对
 * data/plugins.json 中「社区/npm 来源且无缓存报告」的记录补做一次分析。
 * 只用 jsdelivr + LLM，不碰 GitHub 搜索 API。
 *
 * 用法：node scripts/fix-missing-reports.mjs [--limit N]
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, hasLLM, analyzePlugin, readCache, writeCache } from "./lib/llm.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MENU = join(ROOT, "data", "plugins.json");
const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const limit = Number(flag("limit", "0")) || 0;
const env = await loadEnv();
if (!hasLLM(env)) {
  console.error(".env 里没有 DEEPSEEK_API_KEY");
  process.exit(2);
}

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

const cacheId = (id) => id.replace(/[^a-zA-Z0-9._@-]/g, "_");

// 找缺报告的记录（readCache 是 async，逐个 await 收集）
const menu = JSON.parse(await readFile(MENU, "utf8"));
const todo = [];
for (const p of menu.plugins) {
  if (!p.sources.some((s) => s === "npm-registry" || s === "github-topic")) continue;
  if (await readCache(p.id)) continue;
  todo.push(p);
}
const slice = limit ? todo.slice(0, limit) : todo;
console.log(`缺报告 ${todo.length} 个，本次处理 ${slice.length}（并发 3）……`);

let fixed = 0;
const BATCH = 9;
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

let batchIdx = 0;
for (let i = 0; i < slice.length; i += BATCH) {
  const batch = slice.slice(i, i + BATCH);
  await mapLimit(batch, 3, async (p) => {
    const isNpm = p.sources.includes("npm-registry") && p.npm?.name;
    const isGh = p.sources.includes("github-topic") && p.github?.owner && p.github?.repo;
    if (!isNpm && !isGh) return;
    let readme = "";
    let packageJson = null;
    try {
      if (isNpm) {
        const n = encodeURIComponent(p.npm.name);
        readme = (await fetchText(`https://cdn.jsdelivr.net/npm/${n}/README.md`)) ?? "";
        packageJson = await fetchText(`https://cdn.jsdelivr.net/npm/${n}/package.json`);
      } else {
        const { owner, repo } = p.github;
        for (const br of ["main", "master"]) {
          readme = readme || (await fetchText(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@${br}/README.md`)) || "";
          packageJson = packageJson || (await fetchText(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@${br}/package.json`));
        }
      }
      const result = await analyzePlugin(env, {
        name: p.name,
        repoUrl: p.github?.url ?? (isNpm ? `https://www.npmjs.com/package/${p.npm.name}` : ""),
        stars: p.github?.stars ?? null,
        pushedAt: p.github?.pushedAt ?? null,
        topics: p.github?.topics ?? [],
        readme,
        packageJson,
      });
      await writeCache(p.id, result);
      // 回填安装方式与简介
      const inst = result.install ?? {};
      if (inst.method && inst.packageSpec && ["npm", "git", "tarball"].includes(inst.method)) {
        p.install = { method: inst.method, packageSpec: inst.packageSpec };
        if (inst.method === "npm" && !p.npm) p.npm = { name: inst.packageSpec.replace(/@\d.*$/, ""), version: null, downloadsLastMonth: null, keywords: [], dshDeclarations: null };
      } else if (inst.method === "none" || !inst.packageSpec) {
        p.install = { method: "none", packageSpec: null };
        p.score = 0;
      }
      if (result.summaryZh) p.summary = result.summaryZh;
      fixed++;
      console.log(`  ✅ ${p.id}`);
    } catch (e) {
      console.warn(`  [warn] ${p.id} 补跑失败: ${e.message}`);
    }
  });
  batchIdx += batch.length;
  await writeFile(MENU, JSON.stringify(menu, null, 2) + "\n");
  console.log(`  检查点 ${batchIdx}/${slice.length}`);
}

console.log(`\n补跑完成：成功 ${fixed} / ${slice.length}，菜单已回写`);
