// _template.js — 真实渠道适配器模板（文件名以 _ 开头 = 不会被加载，纯文档/脚手架）
//
// 接一个新上游的完整步骤：
//   1. 复制本文件为 channels/<你的渠道>.js（文件名用小写英文，即渠道 id）
//   2. 改写下面标着 ✏️ 的占位实现（上游 Base URL、鉴权头、建单/查询路径、字段映射）
//   3. 重启服务 —— 渠道自动出现在面板（server.js 与前端零改动）
//
// ─────────────────────────────── 契约速览 ───────────────────────────────
// 六件套（必须导出）：DEFAULTS / probe / models / videoModels / image / video
// 元数据（可选）：    NAME / DESC / KEY_LABEL / SETTINGS_FIELDS / CAPS / resetCache
//
//   · 生图统一 resolve { images: [url, ...] }；生视频统一 resolve { url }。
//     上游的一切差异（异步 task_id 轮询、垫图形态、退款、转码…）都在适配器内消化，绝不外漏，
//     下游只见平台的统一模型表与统一 /v1 接口。
//   · 「建单前」的报错（上游还没创建任务）请给 err.stage = 'submit'：
//     平台会按管理员配置的「模型兜底表」自动换道重提，并归入可自动重试类。
//   · opts（平台已归一）：{ model, ar, res, size?, samples?, dur?, audio?, negative?,
//     ref[], refUrls[], refVideoUrls[], refAudioUrls[], host, 'no-prefix' }
//       - ref       垫图原值（photo id / 公网 URL / 服务器文件路径，形态随渠道约定）
//       - refUrls   平台已转成公网 URL 的垫图（本地上传的图由平台托管在 /uploads/… 供上游拉取）
//                   —— 上游只收 URL 的渠道用这个字段即可
//   · acc.token 是挂账号时管理员粘贴的密钥；settings 是渠道设置（面板可改）
//   · prompt 里下游用 {{1}} {{2}} 指代垫图（也接受 @image1 写法，平台已归一为 {{N}}），
//     需要显式标记的渠道自行替换；无此约定的渠道直接剥掉占位符

'use strict';

const NAME = '示例渠道';
const DESC = '一句话能力说明（挂账号形态 + 能力，面板渠道设置页展示）';
const KEY_LABEL = 'API Key';

const CAPS = {
  // dualMode: true,            // 账号有 包量(unlimited)/积分(credits) 双模式 + credits 兜底逻辑
  // autoProbe: true,           // 平台每 10 分钟自动向上游刷新账号余额/权益清单
  // publicCatalog: true,       // 不挂账号也能拉到公开模型目录（面板提前展示、播种定价）
  // videoRefUploadOnly: true,  // 视频垫图只认上传/base64，不认裸 URL（平台提交时即拒并提示用户）
  // needsImageSize: true,      // 生图要 WxH 尺寸串（平台按画幅+分辨率档自动算好 opts.size）
};

const DEFAULTS = {
  baseUrl: 'https://api.example.com', // ✏️ 上游地址
  publicBase: '',                     // 本机公网地址（垫图公网链接用；空 = 按请求 Host 推断）
  imgConcPerAccount: 2,               // 每账号并发生图（按上游限频调）
  vidConcPerAccount: 1,               // 每账号并发生视频
  pollMs: 3000,                       // 异步任务轮询间隔
};
const SETTINGS_FIELDS = { // 渠道设置表单：key → [label, type]（type: text | number | check）
  baseUrl: ['Base URL', 'text'],
  publicBase: ['公网地址(垫图用,空=自动)', 'text'],
  imgConcPerAccount: ['每账号并发生图', 'number'],
  vidConcPerAccount: ['每账号并发生视频', 'number'],
  pollMs: ['轮询间隔 ms', 'number'],
};

// 统一出站请求：超时 60s；上游信封里的业务错抛 Error（message 会展示给管理员/日志）
async function call(settings, token, method, apiPath, body) {
  const r = await fetch(String(settings.baseUrl || '').replace(/\/$/, '') + apiPath, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, // ✏️ 鉴权头
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((data.error && data.error.message) || data.message || `上游 ${r.status}`); e.status = r.status; throw e; }
  return data;
}

async function probe(settings, token) { // 挂账号体检：验密钥 + 读账号信息（抛错 = 拒绝入库）
  const me = await call(settings, token, 'GET', '/v1/me'); // ✏️ 上游账号信息端点
  return { plan: me.plan || me.tier || '已验证', credits: me.credits ?? null,
    tokenExpires: me.expires_at || null, note: '' };
}

async function models(settings) { // 图片模型目录（upstream_cost 元/次，首次入库 ×10 播种售价）
  const d = await call(settings, '', 'GET', '/v1/models'); // ✏️ 公开目录通常免鉴权
  return (d.data || []).map(m => ({ id: m.id, name: m.name || m.id, reference: !!m.ref_image, // 垫图能力位
    sizes: m.sizes || [], resolutions: m.resolutions || [],
    upstream_cost: Number(m.price) || 0.01, upstream_res_price: m.res_price || undefined }));
}
async function videoModels() { return []; } // 无视频能力返回空数组即可

async function image(settings, acc, opts, prompt) { // → { images: [url × samples] }
  let create;
  try {
    create = await call(settings, acc.token, 'POST', '/v1/images', { // ✏️ 建单
      model: opts.model, prompt, size: opts.size, samples: opts.samples, ref: opts.refUrls,
    });
  } catch (e) { e.stage = 'submit'; throw e; } // 建单前失败：平台按兜底表自动换道
  for (let i = 0; i < 300; i++) { // 轮询到终态（间隔 pollMs；上限自行按上游定）
    const t = await call(settings, acc.token, 'GET', `/v1/images/${create.id}`);
    if (t.status === 'succeeded') return { images: (t.output || []).map(o => o.url) };
    if (t.status === 'failed') throw new Error(t.error || '上游生图失败');
    await new Promise(r => setTimeout(r, settings.pollMs || 3000));
  }
  throw new Error('上游生图超时');
}

async function video(settings, acc, opts, prompt) { // → { url }
  let create;
  try {
    create = await call(settings, acc.token, 'POST', '/v1/videos', { // ✏️ 建单
      model: opts.model, prompt, duration: opts.dur, aspect_ratio: opts.ar,
      audio: opts.audio, ref: opts.refUrls, ref_videos: opts.refVideoUrls, ref_audios: opts.refAudioUrls,
    });
  } catch (e) { e.stage = 'submit'; throw e; }
  for (let i = 0; i < 600; i++) {
    const t = await call(settings, acc.token, 'GET', `/v1/videos/${create.id}`);
    if (t.status === 'succeeded') return { url: t.video_url };
    if (t.status === 'failed') throw new Error(t.error || '上游生视频失败');
    await new Promise(r => setTimeout(r, settings.pollMs || 3000));
  }
  throw new Error('上游生视频超时');
}

module.exports = { NAME, DESC, KEY_LABEL, CAPS, DEFAULTS, SETTINGS_FIELDS, probe, models, videoModels, image, video };
