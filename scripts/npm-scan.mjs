#!/usr/bin/env node
/**
 * npm-scan.mjs — Step 3：npm 通道发现（补"只发 npm 没贴 GitHub 标签"的插件）
 *
 * 两阶段（带检查点，可断点续跑）：
 *   node scripts/npm-scan.mjs --phase discover     # 阶段1：搜索 + D7 体检 → data/cache/npm-candidates.json
 *   node scripts/npm-scan.mjs --phase llm          # 阶段2：读候选 → LLM 评估 → 并入 data/plugins.json
 *   node scripts/npm-scan.mjs --limit 20 --phase llm  # 限数量测试
 * 并发：discover 8 路、llm 4 路（DeepSeek 限流自动重试）。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, hasLLM, analyzePlugin, readCache, writeCache } from "./lib/llm.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA = join(ROOT, "data");
const MENU = join(DATA, "plugins.json");
const CAND_FILE = join(DATA, "cache", "npm-candidates.json");
const SYNC = join(DATA, "cache", "npm-sync.json");
const SEARCH = "https://registry.npmjs.org/-/v1/search";
const REGISTRY = "https://registry.npmjs.org";
const CHANGES = "https://replicate.npmjs.com/registry/_changes";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const phase = flag("phase", "all");
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
const fetchJson = async (url) => {
  const txt = await fetchText(url);
  return txt ? JSON.parse(txt) : null;
};

/** 并发执行器：items 逐个跑 worker 函数，最多 concurrency 个并行。 */
async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

/* ---------------- 阶段 1：发现 + D7 体检 ---------------- */

async function backfillCandidates() {
  const queries = ["keywords:dsh-plugin", "keywords:deepseek-harness", "keywords:dsh", "dsh-plugin", "deepseek-harness", "dsh harness"];
  const seen = new Map();
  for (const q of queries) {
    for (let from = 0; from < 250; from += 250) {
      const data = await fetchJson(`${SEARCH}?text=${encodeURIComponent(q)}&size=250&from=${from}`);
      if (!data?.objects?.length) break;
      for (const o of data.objects) {
        const p = o.package;
        if (!p?.name || seen.has(p.name)) continue;
        seen.set(p.name, {
          name: p.name,
          version: p.version,
          description: p.description ?? "",
          keywords: p.keywords ?? [],
          downloadsMonthly: o.downloads?.monthly ?? 0,
          repositoryUrl: p.links?.repository ?? p.links?.homepage ?? null,
        });
      }
      if (data.objects.length < 250) break;
      await sleep(150);
    }
    await sleep(250);
  }
  return [...seen.values()];
}

function entryCheck(pkg) {
  const dsh = pkg?.dsh;
  if (dsh?.bundle?.patch || dsh?.bundle === true || dsh?.client) return { pass: true, signal: "盖章(dsh 声明)" };
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}), ...(pkg?.peerDependencies ?? {}) };
  const coreHit = Object.keys(deps).find((d) => d === "@deepseek-ai/cordis" || d.startsWith("@deepseek-ai/dsh-"));
  if (coreHit) return { pass: true, signal: `依赖(${coreHit})` };
  return { pass: false, reason: "无盖章、无 DSH 核心依赖" };
}

function githubFromRepo(url) {
  if (!url) return null;
  const m = /github\.com[/:]([^/]+)\/([^/#.]+)/.exec(url);
  if (!m) return null;
  return { owner: m[1], repo: m[2], url: `https://github.com/${m[1]}/${m[2]}`, stars: null, topics: [], pushedAt: null };
}

async function phaseDiscover() {
  let state = { done: [], newEntries: [], skipped: [], merges: [] };
  try {
    state = JSON.parse(await readFile(CAND_FILE, "utf8"));
    console.log(`断点续跑：已完成 ${state.done.length} 个`);
  } catch {}
  const doneSet = new Set(state.done);

  console.log("npm 存量扫描中……");
  const candidates = await backfillCandidates();
  const todo = candidates.filter((c) => !doneSet.has(c.name) && !c.name.startsWith("@deepseek-ai/"));
  console.log(`候选 ${candidates.length} 个，待体检 ${todo.length} 个（并发 8）……`);

  const menu = JSON.parse(await readFile(MENU, "utf8"));
  const existingIds = new Set(menu.plugins.map((p) => p.id));
  const existingUrls = new Map(menu.plugins.filter((p) => p.github?.url).map((p) => [p.github.url, p]));

  const batchSize = 25;
  let idx = 0;
  while (idx < todo.length) {
    const batch = todo.slice(idx, idx + batchSize);
    await mapLimit(batch, 8, async (c) => {
      doneSet.add(c.name);
      if (existingIds.has(c.name)) return;
      const pkg = await fetchJson(`${REGISTRY}/${encodeURIComponent(c.name)}/latest`);
      if (!pkg) {
        state.skipped.push({ name: c.name, reason: "无法获取包清单" });
        return;
      }
      const entry = entryCheck(pkg);
      if (!entry.pass) {
        state.skipped.push({ name: c.name, reason: entry.reason });
        return;
      }
      const gh = githubFromRepo(c.repositoryUrl);
      if (gh && existingUrls.has(gh.url)) {
        const target = existingUrls.get(gh.url);
        // 防误并：指向官方 monorepo 的 npm 包（非 @deepseek-ai scope）多是 fork/复制品，按新记录处理
        const isOfficialRepo = target.github?.owner === "deepseek-ai" && target.github?.repo === "deepseek-harness";
        if (isOfficialRepo && !c.name.startsWith("@deepseek-ai/")) {
          state.newEntries.push({ c, pkg, gh });
          console.log(`  ⚠️ ${c.name} 指向官方仓库但非官方 scope，按新记录处理`);
          return;
        }
        target.npm = { name: c.name, version: c.version, downloadsLastMonth: c.downloadsMonthly, keywords: c.keywords, dshDeclarations: { bundle: !!pkg?.dsh?.bundle, client: !!pkg?.dsh?.client } };
        target.install = { method: "npm", packageSpec: c.name };
        if (!target.sources.includes("npm-registry")) target.sources.push("npm-registry");
        state.merges.push({ repo: target.id, npm: c.name });
        console.log(`  🔗 并入现有记录：${target.id} ← npm:${c.name}`);
        return;
      }
      state.newEntries.push({ c, pkg, gh });
      console.log(`  ✅ 新发现：${c.name}（${entry.signal}）`);
    });
    idx += batch.length;
    state.done = [...doneSet];
    await mkdir(join(DATA, "cache"), { recursive: true });
    await writeFile(CAND_FILE, JSON.stringify(state, null, 2)); // 每批存检查点
    console.log(`  进度 ${idx}/${todo.length}（新 ${state.newEntries.length} / 跳过 ${state.skipped.length} / 合并 ${state.merges.length}）`);
  }

  // 增量基线
  const changes = await fetchJson(`${CHANGES}?limit=1`);
  await writeFile(
    SYNC,
    JSON.stringify(
      { lastRun: new Date().toISOString(), lastSeq: changes?.last_seq ?? null, note: "增量：--incremental 用 lastSeq 续跑" },
      null,
      2,
    ),
  );
  // 持久化合并结果（阶段1会改 menu 记录）
  const byTrustLayer = {};
  for (const p of menu.plugins) byTrustLayer[p.trustLayer] = (byTrustLayer[p.trustLayer] ?? 0) + 1;
  menu.stats = { total: menu.plugins.length, byTrustLayer };
  menu.generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  await writeFile(MENU, JSON.stringify(menu, null, 2) + "\n");
  console.log(`\n✅ 阶段1完成：新插件 ${state.newEntries.length}，跳过 ${state.skipped.length}，合并 ${state.merges.length}，lastSeq=${changes?.last_seq}，菜单已更新（含合并）`);
}

/* ---------------- 阶段 2：LLM 评估 + 入库 ---------------- */

async function phaseLLM() {
  const state = JSON.parse(await readFile(CAND_FILE, "utf8"));
  const menu = JSON.parse(await readFile(MENU, "utf8"));
  const inMenu = new Set(menu.plugins.map((p) => p.id));
  const todo = state.newEntries.filter((e) => !inMenu.has(e.c.name));
  const slice = limit ? todo.slice(0, limit) : todo;
  console.log(`待评估 ${todo.length} 个（本次处理 ${slice.length}，并发 4，每 15 个存一次检查点）……`);

  const llmStats = { promptTokens: 0, completionTokens: 0 };
  let analyzed = 0;
  const BATCH = 15;

  const processOne = async ({ c, pkg, gh }) => {
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const record = {
      id: c.name,
      name: c.name.includes("/") ? c.name.split("/")[1] : c.name,
      summary: c.description,
      sources: ["npm-registry"],
      trustLayer: "unverified",
      github: gh,
      npm: { name: c.name, version: c.version, downloadsLastMonth: c.downloadsMonthly, keywords: c.keywords, dshDeclarations: { bundle: !!pkg?.dsh?.bundle, client: !!pkg?.dsh?.client } },
      score: 5,
      firstSeen: now,
      updatedAt: now,
      install: { method: "npm", packageSpec: c.name },
    };
    if (hasLLM(env)) {
      const cached = await readCache(c.name);
      let analysis = cached;
      if (!analysis) {
        try {
          const readme = (await fetchText(`https://cdn.jsdelivr.net/npm/${encodeURIComponent(c.name)}/README.md`)) ?? "";
          analysis = await analyzePlugin(env, {
            name: record.name,
            repoUrl: gh?.url ?? c.repositoryUrl ?? "",
            stars: null,
            pushedAt: null,
            topics: [],
            readme,
            packageJson: JSON.stringify(pkg),
          });
          await writeCache(c.name, analysis);
          analyzed++;
          llmStats.promptTokens += analysis.usage?.prompt_tokens ?? 0;
          llmStats.completionTokens += analysis.usage?.completion_tokens ?? 0;
        } catch (e) {
          console.warn(`  [warn] ${c.name} 分析失败: ${e.message}`);
          analysis = null;
        }
      }
      if (analysis?.install?.method && analysis.install.packageSpec && ["npm", "git", "tarball"].includes(analysis.install.method)) {
        record.install = { method: analysis.install.method, packageSpec: analysis.install.packageSpec };
      }
      if (analysis?.summaryZh) record.summary = analysis.summaryZh;
    }
    menu.plugins.push(record);
    console.log(`  ✅ 入库 ${c.name}`);
  };

  let i = 0;
  while (i < slice.length) {
    const batch = slice.slice(i, i + BATCH);
    await mapLimit(batch, 4, processOne);
    i += batch.length;
    // 检查点：写菜单 + 从候选里移除已处理
    const byTrustLayer = {};
    for (const p of menu.plugins) byTrustLayer[p.trustLayer] = (byTrustLayer[p.trustLayer] ?? 0) + 1;
    menu.stats = { total: menu.plugins.length, byTrustLayer };
    menu.generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    await writeFile(MENU, JSON.stringify(menu, null, 2) + "\n");
    const processedNames = new Set(batch.map((e) => e.c.name));
    state.newEntries = state.newEntries.filter((e) => !processedNames.has(e.c.name));
    await writeFile(CAND_FILE, JSON.stringify(state, null, 2));
    console.log(`  检查点 ${i}/${slice.length}（菜单 ${menu.plugins.length} 条）`);
  }

  const costCNY = (llmStats.promptTokens / 1e6) * 2 + (llmStats.completionTokens / 1e6) * 8;
  console.log(`\n✅ 阶段2完成：本次入库 ${slice.length}，菜单共 ${menu.plugins.length} 条`);
  console.log(`   LLM 分析 ${analyzed} 次（缓存 ${slice.length - analyzed}），估算 ¥${costCNY.toFixed(3)}`);
}

/* ---------------- 增量订阅：只处理上次同步后新发布的包 ---------------- */

async function phaseIncremental() {
  const SYNC_FILE = join(DATA, "cache", "npm-sync.json");
  let lastSeq = 0;
  try {
    lastSeq = JSON.parse(await readFile(SYNC_FILE, "utf8")).lastSeq ?? 0;
  } catch {}
  console.log(`增量同步：上次 lastSeq=${lastSeq}`);

  const menu = JSON.parse(await readFile(MENU, "utf8"));
  const existingIds = new Set(menu.plugins.map((p) => p.id));

  // 1) 分页追平 changes feed（直到拿不满一页 = 已追平），只取 id + seq；上限防跑飞
  const newCandidates = [];
  let checked = 0;
  let from = lastSeq;
  let pages = 0;
  const MAX_PAGES = 60; // 积压过大时停止追平，提示改用全量重扫
  while (pages < MAX_PAGES) {
    const changes = await fetchJson(`${CHANGES}?since=${from}&limit=2000`);
    if (!changes?.results?.length) break;
    pages++;
    for (const row of changes.results) {
      const name = row.id;
      if (!name || name.startsWith("@deepseek-ai/")) continue;
      if (existingIds.has(name)) continue;
      // 名字无 dsh 信号的跳过（快速通道）；完整兜底靠周期性全量重扫（--phase discover，幂等）
      if (!/dsh|deepseek[- ]?harness|cordis/i.test(name)) continue;
      checked++;
      const pkg = await fetchJson(`${REGISTRY}/${encodeURIComponent(name)}/latest`);
      if (!pkg) continue;
      const entry = entryCheck(pkg);
      if (!entry.pass) continue;
      newCandidates.push({ c: { name, version: pkg.version, description: pkg.description ?? "", keywords: pkg.keywords ?? [], downloadsMonthly: null, repositoryUrl: pkg.repository?.url ?? null }, pkg, gh: githubFromRepo(pkg.repository?.url) });
      console.log(`  ✅ 新候选：${name}（${entry.signal}）`);
      await sleep(120);
    }
    from = changes.last_seq ?? from;
    if (changes.results.length < 2000) break; // 追平
    console.log(`  已处理 ${pages * 2000} 条变更…（lastSeq ${from}）`);
  }
  if (pages >= MAX_PAGES) {
    console.warn(`[warn] 积压超过 ${MAX_PAGES * 2000} 条变更，已停止追平（避免无限跑）。`);
    console.warn(`       建议：直接跑一次全量重扫 node scripts/npm-scan.mjs --phase discover（幂等），并把基线重置到当前（见 npm-sync.json）。`);
  }
  console.log(`变更分页 ${pages} 页，体检 ${checked} 个`);

  // 2) 追加到候选池
  if (newCandidates.length) {
    let state = { done: [], newEntries: [], skipped: [], merges: [] };
    try {
      state = JSON.parse(await readFile(CAND_FILE, "utf8"));
    } catch {}
    const seen = new Set(state.newEntries.map((e) => e.c.name));
    for (const nc of newCandidates) if (!seen.has(nc.c.name)) state.newEntries.push(nc);
    await mkdir(join(DATA, "cache"), { recursive: true });
    await writeFile(CAND_FILE, JSON.stringify(state, null, 2));
  }

  // 3) 推进 lastSeq
  await writeFile(
    SYNC_FILE,
    JSON.stringify({ lastRun: new Date().toISOString(), lastSeq: from, note: "增量基线（名字无 dsh 信号的靠周期全量重扫兜底）" }, null, 2),
  );
  console.log(`\n✅ 增量发现完成：新候选 ${newCandidates.length} 个，lastSeq 推进至 ${from}`);
  console.log(`   下一步：node scripts/npm-scan.mjs --phase llm（评估新候选并入菜单）`);
}

/* ---------------- 入口 ---------------- */

if (phase === "incremental") await phaseIncremental();
if (phase === "discover" || phase === "all") await phaseDiscover();
if (phase === "llm" || phase === "all") await phaseLLM();
