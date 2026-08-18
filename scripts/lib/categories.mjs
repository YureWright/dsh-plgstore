/**
 * scripts/lib/categories.mjs — 呈现层分类（共享：build-sqlite / report-html / query-menu 用同一套）
 * 正式分类 v0.2 进 schema 后，此模块改为读 schema 的 categories。
 */
export const CATS = [
  { key: "chat", label: "💬 聊天/通讯", re: /feishu|lark|dingtalk|\bding\b|wechat|weixin|\bqq\b|telegram|slack|onebot|im-gateway|im-hub|im-bridge|\bim\b|notify|notifier|message|wecom|bili/ },
  { key: "vision", label: "👁 视觉/图像", re: /vision|image|\bocr\b|eyes?|photo|picture|multimodal|mm-vision|read-image|sight/ },
  { key: "voice", label: "🎤 语音", re: /voice|speak|\btts\b|\basr\b|whisper|funasr|speech/ },
  { key: "mem", label: "🧠 记忆/上下文", re: /memor|mnemon|context|knowledge|recall|remember|history-sync|memory|memo|her-memory/ },
  { key: "usage", label: "💰 用量/余额", re: /balance|usage|token|cost|billing|quota|pricing|meter|spend|budget|monitor|stats|status|gauge|dashboard|panel|charge/ },
  { key: "pet", label: "🐳 宠物/娱乐", re: /pet|whale|game|mini|galgame|meme|tavern|anime|live2d|dock|achievement|fun/ },
  { key: "ui", label: "🎨 界面/外观", re: /client-ui|webui|ui-|theme|skin|sidebar|navbar|tui|mobile|appearance|background|wallpaper|bottom-bar|side-panel|layout|popout|focus-chat/ },
  { key: "mgmt", label: "🗂 管理/市场", re: /manager|manage|hub|store|market|install|inventory|plug-manager|session-manager|rules-manager|settings|config/ },
  { key: "dev", label: "🛠 开发/运维", re: /codex|code|ssh|git|docker|terminal|bash|dev|deploy|ops|mcp|api|sandbox|test|build|review|lint|http|web-search|search/ },
  { key: "other", label: "📦 其他", re: /./ },
];

export const CAT_LABEL = Object.fromEntries(CATS.map((c) => [c.key, c.label]));

/** 根据插件记录（id/name/summary）判定分类。 */
export function categorize(p) {
  const hay = `${p.id} ${p.name} ${p.summary ?? ""}`.toLowerCase();
  return CATS.find((c) => c.re.test(hay)).key;
}
