#!/usr/bin/env node
/**
 * merge-menu.mjs — 合并官方 + 社区两份菜单为最终 plugins.json
 *
 * 输入：
 *   data/plugins.json          （当前 = 官方 3 条，来自 official-local）
 *   data/community.backup.json （社区 36 条快照）
 * 输出：data/plugins.json（合并）+ data/meta.json（合并审计信息）
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA = join(ROOT, "data");

const official = JSON.parse(await readFile(join(DATA, "plugins.json"), "utf8"));
const community = JSON.parse(await readFile(join(DATA, "community.backup.json"), "utf8"));
const communityMeta = JSON.parse(await readFile(join(DATA, "community.meta.backup.json"), "utf8"));

// 合并 + 去重（id 冲突时官方优先）
const byId = new Map();
for (const p of official.plugins) byId.set(p.id, p);
for (const p of community.plugins) if (!byId.has(p.id)) byId.set(p.id, p);
const plugins = [...byId.values()].sort((a, b) => {
  if (a.trustLayer === "official" && b.trustLayer !== "official") return -1;
  if (b.trustLayer === "official" && a.trustLayer !== "official") return 1;
  return b.score - a.score;
});

const byTrustLayer = {};
for (const p of plugins) byTrustLayer[p.trustLayer] = (byTrustLayer[p.trustLayer] ?? 0) + 1;

const menu = {
  schemaVersion: official.schemaVersion,
  generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  generator: "dsh-market-index@0.1.0 (merge)",
  stats: { total: plugins.length, byTrustLayer },
  plugins,
};

const meta = {
  schemaVersion: official.schemaVersion,
  generator: "dsh-market-index@0.1.0 (merge)",
  mergedAt: menu.generatedAt,
  official: { count: official.plugins.length },
  community: {
    count: community.plugins.length,
    crawledCandidates: communityMeta.crawledCandidates,
    processed: communityMeta.processed,
    skippedCount: communityMeta.skippedCount,
    skipped: communityMeta.skipped,
    suspiciousCount: communityMeta.suspiciousCount,
    suspicious: communityMeta.suspicious,
    llm: communityMeta.llm,
  },
  notes: [
    "菜单 = 官方 3 + 社区 36 合并（id 冲突官方优先）。",
    "社区部分审计信息（跳过/存疑/成本）见 community 字段。",
  ],
};

await writeFile(join(DATA, "plugins.json"), JSON.stringify(menu, null, 2) + "\n");
await writeFile(join(DATA, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
console.log(`✅ 合并完成：${plugins.length} 条（官方 ${official.plugins.length} + 社区 ${community.plugins.length}）`);
console.log(`   信任档: ${JSON.stringify(byTrustLayer)}`);
