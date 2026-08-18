#!/usr/bin/env node
/**
 * query-menu.mjs — SQLite 查询工具（data/market.db，由 build-sqlite.mjs 生成）
 *
 * 用法：
 *   node scripts/query-menu.mjs list [--cat 分类] [--trust official|unverified] [--install npm|git|tarball|none] [--sort score|stars|dl|name|newest] [--limit N]
 *   node scripts/query-menu.mjs search <关键词> [同样的筛选参数]
 *   node scripts/query-menu.mjs top <N> [--cat 分类]
 *   node scripts/query-menu.mjs show <id>
 *   node scripts/query-menu.mjs stats
 *   node scripts/query-menu.mjs cats
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DB = join(ROOT, "data", "market.db");
const args = process.argv.slice(2);
const [cmd, arg1] = args;

const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const cat = flag("cat");
const trust = flag("trust");
const install = flag("install");
const sort = flag("sort") ?? "score";
const limitN = Number(flag("limit") ?? "0") || 0;

const ORDER = {
  score: "score DESC, github_stars DESC",
  stars: "github_stars DESC NULLS LAST",
  dl: "dl_last_month DESC NULLS LAST",
  name: "name ASC",
  newest: "first_seen DESC",
};

let db;
try {
  db = new DatabaseSync(DB);
} catch (e) {
  console.error(`打不开 ${DB}，先运行：node scripts/build-sqlite.mjs`);
  process.exit(2);
}

function where() {
  const w = [];
  if (cat) w.push(`category = '${cat}'`);
  if (trust) w.push(`trust_layer = '${trust}'`);
  if (install) w.push(`install_method = '${install}'`);
  return w.length ? "WHERE " + w.join(" AND ") : "";
}

const LIMIT = limitN ? ` LIMIT ${limitN}` : "";

if (cmd === "list") {
  const rows = db.prepare(`SELECT id,name,score,install_method,trust_layer,category,github_stars,dl_last_month FROM plugins ${where()} ORDER BY ${ORDER[sort] ?? ORDER.score}${LIMIT}`).all();
  for (const r of rows) console.log(`- ${r.id.padEnd(42)} score=${r.score} ${String(r.install_method).padEnd(7)} ${String(r.category).padEnd(6)} ⭐${r.github_stars ?? "?"} 下载${r.dl_last_month ?? "?"}`);
} else if (cmd === "search") {
  if (!arg1) { console.error("用法: search <关键词>"); process.exit(2); }
  const kw = `%${arg1.toLowerCase()}%`;
  const rows = db.prepare(`SELECT id,name,score,install_method,category FROM plugins WHERE search_text LIKE ? ORDER BY score DESC${LIMIT}`).all(kw);
  console.log(`命中 ${rows.length} 条（关键词 ${arg1}）：`);
  for (const r of rows) console.log(`- ${r.id.padEnd(42)} score=${r.score} ${String(r.install_method).padEnd(7)} ${r.category}`);
} else if (cmd === "top") {
  const n = Number(arg1 ?? 10) || 10;
  const rows = db.prepare(`SELECT id,score,github_stars,install_method,category FROM plugins ${where()} ORDER BY score DESC, github_stars DESC LIMIT ${n}`).all();
  for (const r of rows) console.log(`- ${r.id.padEnd(42)} score=${r.score} ⭐${r.github_stars ?? "?"} ${String(r.install_method).padEnd(7)} ${r.category}`);
} else if (cmd === "show") {
  if (!arg1) { console.error("用法: show <id>"); process.exit(2); }
  const r = db.prepare("SELECT * FROM plugins WHERE id = ? OR name LIKE ?").get(arg1, `%${arg1}%`);
  if (!r) { console.error("未找到"); process.exit(1); }
  console.log(JSON.stringify(r, null, 2));
} else if (cmd === "stats") {
  const total = db.prepare("SELECT COUNT(*) c FROM plugins").get().c;
  const byTrust = db.prepare("SELECT trust_layer t, COUNT(*) c FROM plugins GROUP BY trust_layer").all();
  const byInstall = db.prepare("SELECT install_method t, COUNT(*) c FROM plugins GROUP BY install_method").all();
  console.log(`总数: ${total}`);
  console.log(`信任档: ${byTrust.map((x) => `${x.t}=${x.c}`).join(", ")}`);
  console.log(`安装: ${byInstall.map((x) => `${x.t}=${x.c}`).join(", ")}`);
} else if (cmd === "cats") {
  const rows = db.prepare("SELECT category, COUNT(*) c FROM plugins GROUP BY category ORDER BY c DESC").all();
  for (const r of rows) console.log(`${r.category.padEnd(8)} ${r.c}`);
} else {
  console.error("未知命令（list / search / top / show / stats / cats）");
  process.exit(2);
}
