#!/usr/bin/env node
/**
 * build-sqlite.mjs — 把菜单 + 评估报告建成本地 SQLite 库（data/market.db）
 *
 * 用途：query-menu 的 SQL 查询后端；也是未来市场 UI 的数据底座原型。
 * 依赖：Node >= 22 内置 node:sqlite（零第三方依赖）。
 *
 * 用法：node scripts/build-sqlite.mjs
 */
import { readFile, readdir, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { categorize } from "./lib/categories.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA = join(ROOT, "data");
const CACHE = join(DATA, "reports");
const DB = join(DATA, "market.db");

const menu = JSON.parse(await readFile(join(DATA, "plugins.json"), "utf8"));

// 加载评估报告
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

const db = new DatabaseSync(DB);
db.exec(`
  DROP TABLE IF EXISTS plugins;
  CREATE TABLE plugins (
    id TEXT PRIMARY KEY,
    name TEXT,
    summary TEXT,
    trust_layer TEXT,
    sources TEXT,
    category TEXT,
    score REAL,
    first_seen TEXT,
    updated_at TEXT,
    install_method TEXT,
    package_spec TEXT,
    github_url TEXT,
    github_stars INTEGER,
    github_pushed TEXT,
    npm_name TEXT,
    npm_version TEXT,
    dl_last_month INTEGER,
    report_level TEXT,
    report_intro TEXT,
    report_risks TEXT,
    report_post TEXT,
    report_notes TEXT,
    classification TEXT,
    classification_conf REAL,
    search_text TEXT
  );
  CREATE INDEX idx_cat ON plugins(category);
  CREATE INDEX idx_trust ON plugins(trust_layer);
  CREATE INDEX idx_install ON plugins(install_method);
  CREATE INDEX idx_score ON plugins(score);
  CREATE INDEX idx_stars ON plugins(github_stars);
  CREATE INDEX idx_dl ON plugins(dl_last_month);
`);

const stmt = db.prepare(`INSERT INTO plugins (
  id,name,summary,trust_layer,sources,category,score,first_seen,updated_at,
  install_method,package_spec,github_url,github_stars,github_pushed,
  npm_name,npm_version,dl_last_month,
  report_level,report_intro,report_risks,report_post,report_notes,
  classification,classification_conf,search_text
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

let n = 0;
for (const p of menu.plugins) {
  const r = reports.get(p.id);
  const er = r?.evaluationReport;
  const cls = r?.classification;
  const searchText = [p.id, p.name, p.summary, er?.intro, er?.risks, er?.notes, (p.github?.topics ?? []).join(" ")]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  stmt.run(
    p.id, p.name, p.summary ?? null, p.trustLayer, (p.sources ?? []).join(","), categorize(p),
    p.score, p.firstSeen ?? null, p.updatedAt ?? null,
    p.install?.method ?? null, p.install?.packageSpec ?? null,
    p.github?.url ?? null, p.github?.stars ?? null, p.github?.pushedAt ?? null,
    p.npm?.name ?? null, p.npm?.version ?? null, p.npm?.downloadsLastMonth ?? null,
    er?.level ?? null, er?.intro ?? null, er?.risks ?? null, er?.postInstallNotes ?? null, er?.notes ?? null,
    cls?.type ?? null, cls?.confidence ?? null, searchText,
  );
  n++;
}
db.close();

const size = (await (await import("node:fs/promises")).stat(DB)).size;
console.log(`✅ SQLite 库已生成：${DB}（${n} 行，${(size / 1024).toFixed(0)} KB，含索引）`);
