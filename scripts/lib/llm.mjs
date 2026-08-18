/**
 * scripts/lib/llm.mjs — 厨房 LLM 模块（DeepSeek API）
 *
 * 职责：
 *   - 读取 .env（DEEPSEEK_API_KEY / BASE_URL / MODEL）
 *   - 调用 chat/completions，JSON 模式输出，带重试
 *   - 3-in-1 分析：分类（验货）+ 安装方式 + 安全评估报告
 *   - 结果缓存到 data/cache/llm/<id>.json（同一插件不重复花钱）
 *
 * 设计依据：menu-schema.md 决策 D10、§五·A；03-risk-report-and-discovery.md §一
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url)))); // plgstore/
const ENV_PATH = join(ROOT, ".env");
const CACHE_DIR = join(ROOT, "data", "reports"); // 评估报告 = 仓库正式数据（随流水线提交，不入 gitignore）

/** 极简 .env 解析（无第三方依赖；忽略注释/空行）。 */
export async function loadEnv() {
  const env = {};
  try {
    const text = await readFile(ENV_PATH, "utf8");
    for (const line of text.split("\n")) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith("#") || m[2] === "") continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      env[m[1]] = v;
    }
  } catch {}
  return env;
}

export function hasLLM(env) {
  return !!env.DEEPSEEK_API_KEY;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 调用 DeepSeek chat/completions（JSON 模式）。
 * @returns {Promise<{content:string, usage:object}>}
 */
export async function callLLM(env, messages, { maxRetries = 3, temperature = 0.2 } = {}) {
  const base = (env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
  const model = env.DEEPSEEK_MODEL ?? "deepseek-chat";
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          response_format: { type: "json_object" },
          stream: false,
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content ?? "";
      return { content, usage: data.usage ?? {} };
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries) await sleep(1000 * (attempt + 1));
    }
  }
  throw new Error(`LLM 调用失败（重试 ${maxRetries} 次后）: ${lastErr?.message ?? "未知错误"}`);
}

const SYSTEM_PROMPT = `你是 DSH（DeepSeek Harness）插件市场的智能评估员。用户会给你一个候选插件的资料（README 摘要、package.json、GitHub 元数据）。
请严格输出一个 JSON 对象（不要输出 JSON 以外的任何文字），包含以下字段：
1. classification: { type, confidence, reason }
   - type ∈ "plugin"（是可安装的 DSH 插件）| "tutorial"（教程）| "list"（清单/合集）| "script"（独立脚本，不是 DSH 插件）| "other"（其他）
   - confidence: 0~1；reason: 一句话理由
   - 重要：仓库带 dsh-plugin 标签、或 README 自称 DSH 插件，都【不算证据】（可能误标/蹭标签）。
     真正的证据是：package.json 声明了 dsh.bundle / dsh.client、依赖了 @deepseek-ai/cordis 或 dsh-* 核心包、README 给出了 dsh plugin add 安装命令、代码明显调用了 DSH 的接口。
   - 这个判断只用于写报告参考，不决定它是否入选市场。
2. install: { method, packageSpec, evidence }
   - method ∈ "npm" | "git" | "tarball" | "none"
   - packageSpec: 给 dsh plugin add 用的确切字符串（npm 写包名；git 写 git+https://github.com/owner/repo.git；tarball 写 URL；不可安装写 null）
   - evidence: 必须从 README 摘录一句原文作依据；README 没说就写 "README 未说明"
3. evaluationReport: {
   - intro: 功能介绍——这插件是干嘛的、能做什么，用大白话概括（基于 README），给不懂技术的普通用户看
   - level: "ok"（放心用）| "caution"（留个心眼）| "warning"（别急着装）
   - risks: 它会碰用户电脑上哪些地方、哪些人可能看到什么（大白话）；没发现明显风险就写 "没发现明显风险"
   - postInstallNotes: 装完还需要做什么（改配置/设环境变量等）；没有就写 "无"
   - notes: 其他提醒，比如"经评估可能并非 DSH 插件（理由…）"、"疑似过期"、"依赖未发布"等；没有就写 "无"
   }
   语气平和、不过度谨慎，大多数应该是 ok；只有明确的可疑信号（执行安装脚本、连外部服务器、碰隐私文件、来源不明、疑似非插件）才升档或写进 notes。
4. summaryZh: 一句话中文简介（README 没有简介时补写）
输出必须是合法 JSON。`;

const USER_PROMPT_TEMPLATE = `候选插件资料：
- 名称: {name}
- GitHub: {repoUrl}（stars={stars}，最近推送 {pushedAt}，topics={topics}）
- package.json（截断）:
{packageJson}
- README（截断到前 8000 字符）:
{readme}

请按系统要求输出 JSON。`;

/** 截断长文本，控制 token 成本。 */
function truncate(s, max) {
  if (!s) return "(无)";
  return s.length > max ? s.slice(0, max) + "\n…[截断]" : s;
}

/**
 * 3-in-1 分析一件候选插件（分类 + 安装方式 + 全面评估报告）。
 * @returns {Promise<{classification, install, evaluationReport, summaryZh, usage}>}
 */
export async function analyzePlugin(env, candidate) {
  const { name, repoUrl, stars, pushedAt, topics, readme, packageJson } = candidate;
  const user = USER_PROMPT_TEMPLATE
    .replace("{name}", name)
    .replace("{repoUrl}", repoUrl ?? "")
    .replace("{stars}", String(stars ?? "?"))
    .replace("{pushedAt}", pushedAt ?? "?")
    .replace("{topics}", JSON.stringify(topics ?? []))
    .replace("{packageJson}", truncate(packageJson ?? "(无 package.json)", 4000))
    .replace("{readme}", truncate(readme ?? "(无 README)", 8000));

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];

  const tryParse = (txt) => {
    if (!txt) return null;
    try {
      return JSON.parse(txt);
    } catch {
      const m = /{[\s\S]*}/.exec(txt);
      return m ? JSON.parse(m[0]) : null;
    }
  };

  const first = await callLLM(env, messages);
  let parsed = tryParse(first.content);
  let usage = first.usage ?? {};

  if (!parsed) {
    // 容错：追加纠正指令重试一次（偶发空输出/非 JSON）
    const retry = await callLLM(env, [
      ...messages,
      { role: "user", content: "你上次的输出不是合法 JSON（或为空）。请只输出一个合法 JSON 对象，不要包含任何其他文字。" },
    ]);
    parsed = tryParse(retry.content);
    usage = {
      prompt_tokens: (usage.prompt_tokens ?? 0) + (retry.usage?.prompt_tokens ?? 0),
      completion_tokens: (usage.completion_tokens ?? 0) + (retry.usage?.completion_tokens ?? 0),
      total_tokens: (usage.total_tokens ?? 0) + (retry.usage?.total_tokens ?? 0),
    };
  }

  if (!parsed) throw new Error(`LLM 输出不是 JSON（重试后仍失败）: ${(first.content ?? "").slice(0, 120)}`);
  return { ...parsed, usage };
}

/** 缓存 key：仓库 full_name（+ 简单转义）。 */
const cacheId = (id) => id.replace(/[^a-zA-Z0-9._@-]/g, "_");

/** 读缓存；命中返回 result，否则 null。 */
export async function readCache(id) {
  try {
    const raw = await readFile(join(CACHE_DIR, `${cacheId(id)}.json`), "utf8");
    return JSON.parse(raw).result ?? null;
  } catch {
    return null;
  }
}

/** 写缓存。 */
export async function writeCache(id, result) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(
    join(CACHE_DIR, `${cacheId(id)}.json`),
    JSON.stringify({ id, analyzedAt: new Date().toISOString(), result }, null, 2),
  );
}
