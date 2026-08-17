#!/usr/bin/env node
/**
 * query-menu.mjs — 菜单查询小工具（Step 2 收尾）
 *
 * 用法：
 *   node scripts/query-menu.mjs list                 # 列出全部
 *   node scripts/query-menu.mjs search <关键词>       # 按名字/简介/总结搜索
 *   node scripts/query-menu.mjs top <N>              # 质量分 Top N
 *   node scripts/query-menu.mjs show <id或名字>       # 显示单条完整记录
 *   node scripts/query-menu.mjs stats                # 统计
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const [cmd, arg] = process.argv.slice(2);

const menu = JSON.parse(await readFile(join(ROOT, "data", "plugins.json"), "utf8"));
const plugins = menu.plugins;

const L = (s) => String(s ?? "").toLowerCase();
const match = (p, kw) =>
  L(p.id).includes(kw) || L(p.name).includes(kw) || L(p.summary).includes(kw);

if (cmd === "list") {
  for (const p of plugins) console.log(`- ${p.id.padEnd(40)} score=${p.score} ${p.install.method.padEnd(7)} ${p.trustLayer}`);
} else if (cmd === "search") {
  if (!arg) { console.error("用法: search <关键词>"); process.exit(2); }
  const kw = L(arg);
  const hits = plugins.filter((p) => match(p, kw));
  console.log(`命中 ${hits.length} 条：`);
  for (const p of hits) console.log(`- ${p.id.padEnd(40)} score=${p.score} | ${(p.summary ?? "").slice(0, 60)}`);
} else if (cmd === "top") {
  const n = Number(arg ?? 10) || 10;
  [...plugins].sort((a, b) => b.score - a.score).slice(0, n).forEach((p) =>
    console.log(`- ${p.id.padEnd(40)} score=${p.score} stars=${p.github?.stars ?? "?"} ${p.install.method}`));
} else if (cmd === "show") {
  if (!arg) { console.error("用法: show <id或名字>"); process.exit(2); }
  const kw = L(arg);
  const p = plugins.find((x) => x.id === kw || L(x.name).includes(kw) || L(x.id).includes(kw));
  if (!p) { console.error("未找到"); process.exit(1); }
  console.log(JSON.stringify(p, null, 2));
} else if (cmd === "stats") {
  const byTrust = {};
  const byInstall = {};
  for (const p of plugins) {
    byTrust[p.trustLayer] = (byTrust[p.trustLayer] ?? 0) + 1;
    byInstall[p.install.method] = (byInstall[p.install.method] ?? 0) + 1;
  }
  console.log(`总数: ${plugins.length}`);
  console.log(`信任档: ${JSON.stringify(byTrust)}`);
  console.log(`安装方式: ${JSON.stringify(byInstall)}`);
  console.log(`schemaVersion: ${menu.schemaVersion} | generatedAt: ${menu.generatedAt}`);
} else {
  console.error("未知命令（list / search / top / show / stats）");
  process.exit(2);
}
