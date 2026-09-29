// demo.js — 演示渠道适配器（同时是「最小适配器」参考实现）
// 不连任何上游：本地即时生成 SVG 占位图，用于跑通 安装 → 挂账号 → 计费 → 分发 → 出图 全流程。
// 接真实上游请照抄 _template.js 的形状（HTTP 建单 + 轮询）。
//
// ────────────────────────── 适配器六件套契约（必须导出） ─────────────────────────
//   DEFAULTS      渠道设置默认值（面板「渠道设置」表单按 SETTINGS_FIELDS 渲染，键须对齐）
//   probe         挂账号体检：验密钥真伪，返回 { plan, credits?, unlimited?, tokenExpires?, note? }
//   models        图片模型目录 [{ id, name, sizes?, resolutions?, reference?, upstream_cost, upstream_res_price? }]
//   videoModels   视频模型目录 [{ id, name, duration[], aspect_ratio[], audio?, maxRef?, maxVideo?, maxAudio?, maxAudioSec?, perSec?, upstream_cost }]
//   image         生图：resolve { images: [url, ...] }（samples 张）
//   video         生视频：resolve { url }
// ────────────────────────── 可选导出 ─────────────────────────
//   NAME / DESC / KEY_LABEL / SETTINGS_FIELDS   自描述元数据（面板零硬编码渲染）
//   CAPS          能力位 { dualMode, autoProbe, publicCatalog, videoRefUploadOnly, needsImageSize }
//   resetCache()  面板「刷新模型目录」按钮回调（静态目录无需缓存，可不导出）

'use strict';

const NAME = 'Demo 演示渠道';
const DESC = '内置演示渠道 · 不连上游 · 本地即时出 SVG 占位图（体验分发/计费全流程用）';
const KEY_LABEL = 'Demo Token（任意 ≥20 位字符串）';

const CAPS = { publicCatalog: true }; // 静态目录：不挂账号也能在面板看到模型清单

const DEFAULTS = {
  imgConcPerAccount: 2,   // 每账号并发生图（分发循环按它限并发坑位）
  vidConcPerAccount: 1,   // 每账号并发生视频
  palette: 'latte',       // 占位图配色：latte / matcha / berry
};

const SETTINGS_FIELDS = { // 渠道设置表单：key → [label, type]（type: text | number | check）
  imgConcPerAccount: ['每账号并发生图', 'number'],
  vidConcPerAccount: ['每账号并发生视频', 'number'],
  palette: ['占位图配色(latte/matcha/berry)', 'text'],
};

const PALETTES = {
  latte: { bg: '#F5EDE2', ink: '#6F4E37', accent: '#C08552' },
  matcha: { bg: '#EDF2E4', ink: '#4A5D3A', accent: '#87A96B' },
  berry: { bg: '#F6E7EC', ink: '#7D3548', accent: '#C0697F' },
};

// 模型目录：upstream_cost = 上游单次成本（元）——首次入库平台按 ×10 播种默认售价（分），定价页可改
const IMG_MODELS = [
  { id: 'demo-canvas', name: 'Demo 画布（支持垫图 / 分辨率档）', reference: true,
    sizes: ['1024x1024', '1280x720', '720x1280', '1792x1024', '1024x1792'],
    resolutions: ['1k', '2k'],
    upstream_cost: 0.01, upstream_res_price: { '1k': 0.01, '2k': 0.02 } },
  { id: 'demo-sketch', name: 'Demo 素描（无档位一口价）', reference: false,
    sizes: ['1024x1024'],
    upstream_cost: 0.02 },
];
const VID_MODELS = [
  { id: 'demo-clip', name: 'Demo 短片（按秒计费演示）', duration: [5, 10],
    aspect_ratio: ['16:9', '9:16', '1:1'], audio: false, maxRef: 1, perSec: true, upstream_cost: 0.005 },
];

async function probe(settings, token) { // 挂账号体检：演示渠道不连上游，直接放行
  return { plan: 'Demo · 本地演示', credits: 9999, unlimited: [], tokenExpires: null,
    note: '演示渠道：余额为假数据' };
}

async function models() { return IMG_MODELS; }
async function videoModels() { return VID_MODELS; }

// ---- 生成：本地 SVG 占位图 ----
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function svgOf(palette, w, h, title, sub) {
  const p = PALETTES[palette] || PALETTES.latte;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="100%" height="100%" fill="${p.bg}"/>
<path d="M0 ${h * 0.72} C ${w * 0.25} ${h * 0.6}, ${w * 0.4} ${h * 0.86}, ${w * 0.6} ${h * 0.72} S ${w * 0.9} ${h * 0.58}, ${w} ${h * 0.7} L ${w} ${h} L 0 ${h} Z" fill="${p.accent}" opacity="0.25"/>
<circle cx="${w / 2}" cy="${h / 2 - 26}" r="46" fill="none" stroke="${p.accent}" stroke-width="6" opacity="0.9"/>
<text x="50%" y="${h / 2 + 6}" text-anchor="middle" font-family="sans-serif" font-size="34" font-weight="700" fill="${p.ink}">Demo</text>
<text x="50%" y="${h / 2 + 36}" text-anchor="middle" font-family="sans-serif" font-size="16" fill="${p.ink}" opacity="0.75">${esc(title)}</text>
<text x="50%" y="${h - 26}" text-anchor="middle" font-family="sans-serif" font-size="13" fill="${p.ink}" opacity="0.55">${esc(sub)}</text>
</svg>`);
}

function sizeOf(opts) { // opts.size 优先（声明 needsImageSize 的渠道由平台算好塞入），否则按画幅近似
  if (opts.size) { const [w, h] = String(opts.size).split('x').map(Number); if (w && h) return [w, h]; }
  const [aw, ah] = String(opts.ar || '1:1').split(':').map(Number);
  const r = aw && ah ? aw / ah : 1;
  return r >= 1 ? [Math.round(1024 * r), 1024] : [1024, Math.round(1024 / r)];
}

async function image(settings, acc, opts, prompt) { // → { images: [url × samples] }
  await sleep(600 + Math.random() * 800); // 模拟上游耗时
  const [w, h] = sizeOf(opts);
  const n = Math.max(1, Number(opts.samples || 1));
  const images = [];
  for (let i = 0; i < n; i++)
    images.push(svgOf(settings.palette, w, h, String(prompt || '').slice(0, 24), `${opts.model} · ${w}x${h} · #${i + 1}/${n}`));
  return { images };
}

async function video(settings, acc, opts, prompt) { // → { url }
  await sleep(Math.min(Number(opts.dur || 5), 10) * 400); // 模拟上游耗时（随时长）
  const dim = { '16:9': [640, 360], '9:16': [360, 640], '1:1': [480, 480] }[String(opts.ar || '16:9')] || [640, 360];
  return { url: svgOf(settings.palette, dim[0], dim[1], String(prompt || '').slice(0, 24), `${opts.model} · ${opts.dur}s · 演示成片`),
    note: '演示成片：SVG 占位图（真实渠道此处返回上游视频直链）' };
}

module.exports = { NAME, DESC, KEY_LABEL, CAPS, DEFAULTS, SETTINGS_FIELDS, probe, models, videoModels, image, video };
