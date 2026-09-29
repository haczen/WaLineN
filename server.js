#!/usr/bin/env node
'use strict';
/**
 * WaLineN — 通用渠道分发网关（渠道管理 & 模型分发系统）
 *   上游：渠道适配器（channels/*.js 自动发现，自带可跑通的 demo 演示渠道），
 *         管理员挂账号，按账号空闲度分发任务
 *   下游：用户/代理 + sk- 密钥 + 平台积分计费；对外 OpenAI 风格 /v1 接口
 *
 *   面板  /            SPA（web/)，管理员/代理/用户三种视角
 *   API   /v1/*        Bearer sk-xxx 生图/生视频/模型/任务查询
 *   数据  data/waline.json（账号 token 明文存盘，权限 root，注意保管）
 *
 * 零依赖，Node >= 18。systemd: waline.service（端口 8792）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const STATE = path.join(DATA, 'waline.json');
const UPLOADS = path.join(DATA, 'uploads');
const RESULTS = path.join(DATA, 'results');
const PORT = Number(process.env.PORT || 8792);
const JOBS_CAP = 500;
const BODY_LIMIT = 64 * 1024 * 1024;

fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(RESULTS, { recursive: true });
const log = (...a) => console.log(new Date().toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }), ...a); // 北京时间

// ---------- channel adapter ----------
// 渠道适配器自动发现：channels/ 下每个 .js 都是一个适配器（契约见 channels/demo.js 头部注释），
// 下划线开头的文件视为纯文档模板不加载。新渠道 = 复制 demo.js 改名实现六件套，无需改 server.js。
// 渠道注册表：适配器统一 image/video 契约，上游接口细节（task_id/@引用/字段差异）绝不外漏
const CHANNEL_TYPES = {};
for (const f of fs.readdirSync(path.join(__dirname, 'channels')).filter(f => f.endsWith('.js') && !f.startsWith('_'))) {
  try { CHANNEL_TYPES[path.basename(f, '.js')] = require('./channels/' + f); }
  catch (e) { console.error(`[channel] 适配器加载失败 ${f}: ${e.message}`); }
}
// 适配器能力位（适配器可选导出 CAPS）：
//   dualMode          账号支持 包量(unlimited)/积分(credits) 双模式 + credits 兜底
//   autoProbe         账号定时自动体检（积分/权益/token 到期，10 分钟一轮）
//   publicCatalog     未挂账号也能拉公开模型目录（授权编辑/播种定价用）
//   videoRefUploadOnly 视频垫图只认上传素材 id / base64，不认裸 URL
//   needsImageSize    生图要 WxH 尺寸串（平台按模型 sizes 与画幅就近挑）
const capsOf = (ad) => ((ad && ad.CAPS) || {});

// ---------- state ----------
let S;
// 落盘防抖 + 原子写（2026-09-18 流畅性优化）：状态 ~1.8MB，原来每次 touch 都同步全量序列化
// （还是美化缩进格式）+ 直写，任务密集时反复阻塞事件循环，面板 API 全排队——「点页等 3-5 秒」
// 的元凶之一。改：400ms 防抖合流 + tmp→rename 原子写（崩溃不再可能留半份截断的状态文件），
// SIGTERM（systemctl stop/restart）退出前强制冲刷；硬崩溃最多丢最近 400ms 的内存态
let _saveT = null, _dirty = false;
function flushState() {
  _dirty = false;
  const tmp = STATE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(S)); // 紧凑 JSON：去掉 null,1 美化（体积 -20%、序列化更快）
  fs.renameSync(tmp, STATE);
}
function save() {
  _dirty = true;
  if (_saveT) return;
  _saveT = setTimeout(() => { _saveT = null; try { flushState(); } catch (e) { console.log(`[save] 落盘失败: ${String(e.message).slice(0, 80)}`); } }, 400);
}
function load() {
  try { S = JSON.parse(fs.readFileSync(STATE, 'utf8')); }
  catch {
    S = { users: [], channels: [], pricing: {}, fallbacks: {}, jobs: [] }; // 定价全部由渠道模型目录的 upstream_cost 自动播种，面板可改
  }
  S.logs = S.logs || []; S.ledger = S.ledger || [];
  S.codes = S.codes || []; // 兑换码库存（充值管理）：{ id, code, credits, note, createdAt, used:{uid,name,at}|null }
  S.fallbacks = S.fallbacks || {}; // 模型兜底表 { 原模型: 兜底模型 }——原模型建单失败自动换道重提
  // 失败自动重试次数（默认 5）：任务失败属可重试类 → 退避后回排队重跑，
  // 管理员概览页可随时改（0-10；0=关）。详见 autoRetryRequeue
  S.autoRetry = Number.isInteger(S.autoRetry) ? Math.max(0, Math.min(10, S.autoRetry)) : 5;
  // 成片转存保留天数（部分渠道成片落 /results/ 的保留期，到期每日自动清理）：1-30，默认 7
  S.resultsRetention = Number.isInteger(S.resultsRetention) ? Math.max(1, Math.min(30, S.resultsRetention)) : 7;
  ensureChannels();
  // 启动清扫：进程已死，运行中的 runJob 不可能再回来 —— 标失败 + 清 inFlight 坑位。
  // 垫图保留（同失败任务待遇，可一键重试），过期走下面的 48h 回收
  let swept = 0;
  for (const j of S.jobs) if (j.status === 'queued' || j.status === 'running') {
    j.status = 'failed'; j.error = '服务重启，任务中断'; j.updatedAt = Date.now(); swept++;
  }
  // 任务实际引用的全部本地文件 = refFiles（新任务）∪ opts.ref 里的绝对路径（refFiles 落档
  // 前的老任务只在 opts.ref 挂路径——09-18 实锤一例：2h 前的任务重试报垫图 48h，其实是
  // 启动孤儿回收只看 refFiles 把文件误删了）
  const allLocalRefsOf = (j) => [...new Set([
    ...(j.refFiles || []),
    ...(((j.opts || {}).ref) || []).filter(r => typeof r === 'string' && r.startsWith('/')),
  ])];
  { // 失败任务垫图保留 48h（一键重试用）；过期清掉，但要跳过仍被其他任务引用的文件——
    // 重试新单与旧失败单共用同一份素材，按「文件是否还有人引用」判，不能按单清
    const CUT = Date.now() - 48 * 3600 * 1000;
    const stale = S.jobs.filter(j => j.status === 'failed' && j.updatedAt < CUT && j.refFiles && j.refFiles.length);
    if (stale.length) {
      const stillUsed = new Set(S.jobs.filter(j => !stale.includes(j)).flatMap(allLocalRefsOf));
      let freed = 0;
      for (const j of stale) {
        for (const f of j.refFiles) if (!stillUsed.has(f)) { try { fs.rmSync(f, { force: true }); freed++; } catch {} }
        j.refFiles = [];
      }
      if (freed) { log(`[cleanup] 回收过期失败任务垫图 ${freed} 个文件（>48h）`); save(); }
    }
  }
  { // 历史素材回收：结果只存上游 URL 不落盘，垫图用完即删——扫掉不再被任何任务引用的 up_* 文件
    const live = new Set(S.jobs.flatMap(allLocalRefsOf));
    let freed = 0, bytes = 0;
    for (const f of fs.readdirSync(UPLOADS)) {
      if (!f.startsWith('up_') || live.has(path.join(UPLOADS, f))) continue;
      try { bytes += fs.statSync(path.join(UPLOADS, f)).size; fs.rmSync(path.join(UPLOADS, f), { force: true }); freed++; } catch {}
    }
    if (freed) { log(`[cleanup] 启动回收历史垫图 ${freed} 个文件，释放 ${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`); save(); }
  }
  { // 平台成片（本地超分/交付转码产物）保留 7 天，过期自动清——上游直链本身 ~24h 就失效。
    // 09-18 起部分渠道成片落盘交付（上游内容源限速，直链用户端拉不动），清理也改成
    // 启动 + 每日一扫（原来只在启动时扫，长期不重启就只攒不清）
    sweepResults();
  }
  { // 一次性迁移：受限代理名下「未设限」的存量下级补继承代理授权（历史上建号默认全开=越权）
    let n = 0;
    for (const ag of S.users.filter(u => u.role === 'agent' && u.grants))
      for (const kid of S.users.filter(u => u.parent === ag.id && !u.grants)) {
        kid.grants = JSON.parse(JSON.stringify(ag.grants)); n++;
      }
    if (n) { log(`[migrate] ${n} 个受限代理下级补继承授权（原未设限=全部模型）`); save(); }
  }
  for (const c of S.channels) for (const a of c.accounts || []) if (a.inFlight) a.inFlight = {};
  if (swept) { log(`boot sweep: ${swept} 个中断任务标记 failed`); save(); }
  if (!S.users.some(u => u.role === 'admin')) { // 首启：建管理员，密码只打日志 + .bootstrap-admin
    const pass = 'walinen-' + crypto.randomBytes(4).toString('hex');
    S.users.push(mkUser('admin', pass, 'admin'));
    save();
    fs.writeFileSync(path.join(DATA, '.bootstrap-admin'), `admin / ${pass}\n`, { mode: 0o600 });
    log(`bootstrap admin: admin / ${pass}  (also in data/.bootstrap-admin — 登录后请改密)`);
  }
}
const uid = (p) => p + '_' + crypto.randomBytes(5).toString('hex');
// 平台成片 7 天过期清理（启动扫 + 每日定时扫）
function sweepResults() {
  const DAYS = Math.max(1, Math.min(30, Number(S.resultsRetention) || 7)); // 管理员可调（概览页）
  const CUT = Date.now() - DAYS * 24 * 3600 * 1000;
  let n = 0, bytes = 0;
  try {
    for (const f of fs.readdirSync(RESULTS)) {
      const fp = path.join(RESULTS, f);
      try { const st = fs.statSync(fp); if (st.mtimeMs < CUT) { bytes += st.size; fs.rmSync(fp, { force: true }); n++; } } catch {}
    }
  } catch {}
  if (n) log(`[cleanup] 清理过期成片 ${n} 个（>${DAYS} 天），释放 ${(bytes / 1024 / 1024).toFixed(1)}MB`);
}
setInterval(sweepResults, 24 * 3600 * 1000);
function mkUser(name, password, role, parent = null, balance = 0) {
  const salt = crypto.randomBytes(8).toString('hex');
  return { id: uid('u'), name, salt, passHash: hash(password, salt), role, parent, balance, status: 'active',
           keys: [], createdAt: Date.now() };
}
function hash(password, salt) { return crypto.scryptSync(String(password), salt, 32).toString('hex'); }
const checkPass = (u, p) => crypto.timingSafeEqual(Buffer.from(u.passHash), Buffer.from(hash(p, u.salt)));

load();
S.sessions = S.sessions || {}; // 登录态随状态文件走，重启不掉线

// ---------- sessions ----------
// 会话持久化（2026-09-18 用户反馈「一段时间没用就被登出」）：曾用内存 Map，服务一重启
// 登录态全蒸发（部署频繁时体感就是随机掉线）。现随 waline.json 落盘（防抖原子保存），
// 有效期 30 天，活跃用户滑动续期（touchSession）——常用的人基本不会再被要求重新登录。
const SESSION_MS = 30 * 24 * 3600 * 1000;
function sessionUser(req) {
  const m = /waline_session=([a-f0-9]+)/.exec(req.headers.cookie || '');
  const s = m && S.sessions[m[1]];
  if (!s) return null;
  if (s.exp < Date.now()) { delete S.sessions[m[1]]; save(); return null; }
  const u = S.users.find(u => u.id === s.uid) || null;
  return u && u.status !== 'active' ? null : u; // 停用即踢下线（登录/API-key 链路本就拦截）
}
// 滑动续期：剩余不足半程才动，续满 + 刷新 cookie，30 天内来过一次就不会掉线
function touchSession(req, res) {
  const m = /waline_session=([a-f0-9]+)/.exec(req.headers.cookie || '');
  const s = m && S.sessions[m[1]];
  if (!s || s.exp - Date.now() > SESSION_MS / 2) return;
  s.exp = Date.now() + SESSION_MS;
  res.setHeader('Set-Cookie', `waline_session=${m[1]}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}`);
  save();
}
const isAdmin = (u) => u && u.role === 'admin';
const isAdminOrSelf = (me, u) => isAdmin(me) || (me && u && me.id === u.id);

// ---------- billing ----------
// 模型授权：u.grants = { [modelId]: {image?, videoPerSec?, videoFlat?} }
// 键存在 = 授权可用；价字段 = 该用户专属价（覆盖全局定价）；u.grants 未设 = 全部模型·全局价
const grantOf = (u, id) => (u && u.grants && u.grants[id]) || null;
// 级联授权（2026-09-09 用户要求）：自己被授过还不够——「整条上级链」上每个设了 grants 的节点
// 都要放行。上级（含代理）后续收回的模型，下级已派生的授权/继承副本自动失效。
// 未设 grants 的祖先 = 不限；走到链头全放行 = 可用。seen 防脏状态成环。
const modelAllowed = (u, id) => {
  const seen = new Set();
  for (let x = u; x && !seen.has(x.id); x = x.parent ? S.users.find(p => p.id === x.parent) : null) {
    seen.add(x.id);
    if (x.grants && !x.grants[id]) return false;
  }
  return true;
};
const effPricing = (u, id) => ({ ...(S.pricing[id] || {}), ...(grantOf(u, id) || {}) }); // 用户实际执行价
function priceOf(model, kind, opts = {}, user = null) {
  const p = { ...(S.pricing[model] || {}), ...(grantOf(user, model) || {}) }; // 专属价优先
  if (kind === 'image') { // 分辨率组合价优先（imageRes），未配回落默认
    const base = (opts.res && p.imageRes && p.imageRes[opts.res] != null) ? p.imageRes[opts.res] : (p.image ?? 1);
    return Math.max(0.01, base) * Math.max(1, Number(opts.samples || 1));
  }
  const r = (opts.res && p.videoRes && p.videoRes[opts.res]) || {}; // 分辨率组合价优先，未配回落默认
  const flat = r.flat != null ? r.flat : p.videoFlat;
  if (flat != null) return Math.max(0.01, flat); // 一口价（mode 或旧数据 videoFlat 推断）
  return Math.max(0.01, (r.perSec != null ? r.perSec : (p.videoPerSec ?? 2))) * Math.max(1, Number(opts.dur || 5));
}
// 分辨率组合价的对外脱敏形态：视频 {res:{flat|perSec}}（只带当前计费方式的字段），图片 {res:价}
function resPriceMap(p, resolutions, mode) {
  const out = {};
  for (const r of resolutions || []) {
    const v = p.videoRes && p.videoRes[r];
    if (!v) continue;
    if (mode === 'flat') { if (v.flat != null) out[r] = { flat: v.flat }; }
    else if (v.perSec != null) out[r] = { perSec: v.perSec };
  }
  return out;
}
const round2 = (n) => Math.round(n * 100) / 100;

// ---------- 平台日志 / 积分流水 ----------
const LOG_CAP = 2000; // 各留 2000 条，超出淘汰最旧
function logAct(actor, act, detail = '') { // 操作审计：面板与 /v1 的一切动作
  const who = !actor ? '系统' : typeof actor === 'string' ? actor : `${actor.name}·${actor.role}`;
  S.logs.push({ t: Date.now(), actor: who, act: String(act).slice(0, 40), detail: String(detail).slice(0, 200) });
  if (S.logs.length > LOG_CAP) S.logs.splice(0, S.logs.length - LOG_CAP);
}
function moveCredit(u, delta, reason, ref = null) { // 积分流水（同时动账，负值兜到 0）
  u.balance = round2(Math.max(0, (u.balance || 0) + delta));
  S.ledger.push({ t: Date.now(), uid: u.id, user: u.name, delta: round2(delta), balance: u.balance, reason: String(reason).slice(0, 80), ref });
  if (S.ledger.length > LOG_CAP) S.ledger.splice(0, S.ledger.length - LOG_CAP);
  return u.balance;
}

// ---------- channel dispatch（多渠道）----------
function ensureChannels() {
  for (const [id, ad] of Object.entries(CHANNEL_TYPES)) {
    const ch = S.channels.find(c => c.id === id);
    if (!ch) S.channels.push({ id, type: id, name: ad.NAME || id, enabled: true, settings: { ...ad.DEFAULTS }, accounts: [] });
    else ch.settings = { ...ad.DEFAULTS, ...ch.settings }; // 适配器加了新默认键时补齐（已有值不覆盖）
  }
  // 适配器文件已移除的渠道：整个停用（保留数据与任务记录，不再派发）
  for (const ch of S.channels) if (!CHANNEL_TYPES[ch.type]) ch.enabled = false;
}
const chAcc = (ch) => ch.accounts.filter(a => a.enabled);

// 全渠道统一模型表（带 channel 标），校验/面板/对外清单共用
// catalog=true 含未挂号渠道的公开清单（声明 publicCatalog 能力的适配器免账号出目录）——
// 授权编辑/播种定价用；默认只列「有账号能接」的，保证提交即可派发
async function allModels(kind, catalog = false) {
  const out = [];
  for (const ch of S.channels) {
    const ad = CHANNEL_TYPES[ch.type]; if (!ad || !ch.enabled) continue;
    if (!chAcc(ch).length && (!catalog || !capsOf(ad).publicCatalog)) continue; // 无公开目录能力的渠道必须挂账号才出清单
    const list = kind === 'image'
      ? await ad.models(ch.settings, ch.accounts).catch(() => [])
      : await ad.videoModels(ch.settings, ch.accounts).catch(() => []);
    for (const m of list) out.push({ ...m, id: String(m.id || m.name), channel: ch.id, // id 统一字符串
      refUploadOnly: capsOf(ad).videoRefUploadOnly === true && kind === 'video' }); // 垫图规格位：该模型垫图只认上传/base64 不认 URL（对外不说渠道名）
  }
  return out;
}
// 模型注册表：id → 渠道（同步供调度器查；只含有可用账号的渠道）
const MODEL_REG = { image: new Map(), video: new Map() };
let PREV_SEEN = null; // 上一轮目录 id 全集——孤儿清理的「连续两轮缺席」参照
async function rebuildModelReg() {
  MODEL_REG.image.clear(); MODEL_REG.video.clear();
  let seeded = false;
  const seen = new Set(); // 全渠道目录 id（含未挂号渠道的公开清单）——定价孤儿清理用
  for (const ch of S.channels) {
    const ad = CHANNEL_TYPES[ch.type]; if (!ad || !ch.enabled) continue;
    const hasAcc = chAcc(ch).length;
    if (!hasAcc && !capsOf(ad).publicCatalog) continue; // 无公开目录能力的渠道没账号拉不到清单
    const imgs = await ad.models(ch.settings, ch.accounts).catch(() => []);
    const vids = await ad.videoModels(ch.settings, ch.accounts).catch(() => []);
    for (const m of [...imgs, ...vids]) seen.add(String(m.id || m.name));
    if (hasAcc) for (const m of imgs) { const id = String(m.id || m.name); if (!MODEL_REG.image.has(id)) MODEL_REG.image.set(id, { ch: ch.id }); }
    if (hasAcc) for (const m of vids) { const id = String(m.id || m.name); if (!MODEL_REG.video.has(id)) MODEL_REG.video.set(id, { ch: ch.id }); }
    seeded = seedPricing(ch.type, [...imgs.map(m => ({ id: m.id, cost: m.upstream_cost, kind: 'image', res_prices: m.upstream_res_price })),
      ...vids.map(m => ({ id: m.id || m.name, cost: m.upstream_cost, kind: 'video', perSec: m.perSec === true }))]) || seeded;
  }
  // 定价孤儿清理：上游已下架的模型（全渠道目录查无此 id）定价行删掉，不然定价页一直挂「未分组」。
  // 防误杀三重闸：目录拉挂了（上游集体超时空表）seen 太小不清；某渠道单轮抖动缺席不清——
  // 连续两轮（PREV_SEEN 也没有）才判死；进程刚起第一轮没有历史参照不清
  if (PREV_SEEN && seen.size >= 20) {
    const keys = Object.keys(S.pricing);
    const dead = keys.filter(k => !seen.has(k) && !PREV_SEEN.has(k));
    if (dead.length && dead.length < keys.length) {
      for (const k of dead) delete S.pricing[k];
      log(`[model-reg] 清理已下架模型定价 ${dead.length} 条: ${dead.slice(0, 8).join(', ')}${dead.length > 8 ? ' …' : ''}`);
      seeded = true;
    }
  }
  PREV_SEEN = seen;
  if (seeded) save();
}
rebuildModelReg().catch(e => log('model reg init fail:', e.message)); // 模型注册表（调度器同步查）
setInterval(() => rebuildModelReg().catch(e => log('model reg refresh fail:', e.message)), 10 * 60 * 1000);

// 账号自动体检：声明了 autoProbe 能力的渠道，积分 / 权益清单 / token 到期每 10 分钟向上游刷新
let probing = false;
setInterval(async () => {
  if (probing) return; probing = true; // 上游慢时不叠拍
  try {
    for (const ch of S.channels) {
      const ad = CHANNEL_TYPES[ch.type]; if (!ad || !ch.enabled || !capsOf(ad).autoProbe) continue;
      for (const acc of ch.accounts.filter(a => a.enabled)) {
        try { acc.info = { ...acc.info, ...await ad.probe(ch.settings, acc.token) }; acc.lastCheck = Date.now(); save(); }
        catch (e) { log(`[probe] ${ch.id}·${acc.label} 自动体检失败: ${String(e.message).slice(0, 80)}`); } // 失败保留旧值，不动账号状态
      }
    }
  } finally { probing = false; }
}, 10 * 60 * 1000);

// 渠道模型首次入库按 上游成本×10 播种默认价（管理员在定价页可改）
function seedPricing(type, models) {
  let hit = false;
  for (const m of models) {
    if (!m.id || S.pricing[m.id]) continue;
    if (m.kind === 'image') {
      const p = { image: Math.max(1, Math.round((m.cost || 0.1) * 10 * 10) / 10) };
      // 渠道给明每档上游价时同步播种分辨率价（4K 档通常明显贵过 1K）
      if (m.res_prices && typeof m.res_prices === 'object') {
        p.imageRes = {};
        for (const [r, c] of Object.entries(m.res_prices)) p.imageRes[r] = Math.max(1, Math.round((Number(c) || 0.1) * 10 * 10) / 10);
      }
      S.pricing[m.id] = p;
    }
    else if (m.perSec) S.pricing[m.id] = { videoPerSec: Math.max(0.1, Math.round((m.cost || 0.1) * 10 * 10) / 10) }; // 按秒计费模型
    else S.pricing[m.id] = { videoFlat: Math.max(2, Math.round((m.cost || 0.5) * 10 * 10) / 10) };
    hit = true;
  }
  return hit;
}

function pickAccount(kind, model) {
  const chId = (MODEL_REG[kind].get(String(model)) || {}).ch; // 注册表查模型归属渠道（id 字符串化）
  const ch = S.channels.find(c => c.id === chId && c.enabled);
  if (!ch) return null;
  const cap = kind === 'video' ? (ch.settings.vidConcPerAccount || 1) : (ch.settings.imgConcPerAccount || 2);
  const capOf = (a) => ((a.inFlight && a.inFlight[kind]) || 0) < cap;
  const byIdle = (a, b) => ((a.inFlight[kind] || 0) - (b.inFlight[kind] || 0));
  if (capsOf(CHANNEL_TYPES[ch.type]).dualMode) { // 包量/积分双模式 + credits 兜底
    for (const mode of ch.settings.modePriority || ['unlimited', 'credits']) {
      const ok = ch.accounts.filter(a => a.enabled && a.mode === mode && capOf(a) &&
        (mode === 'unlimited' ? (a.info.unlimited || []).includes(model) : (a.info.credits || 0) > 20));
      if (ok.length) return { ch, acc: ok.sort(byIdle)[0], credits: false };
    }
    // unlimited 权益不含该模型（平台权益会变）→ 允许兜底的账号走 credits
    const fb = ch.accounts.filter(a => a.enabled && capOf(a) && fbEnabled(ch, a) && (a.info.credits || 0) > 20).sort(byIdle);
    return fb.length ? { ch, acc: fb[0], credits: true } : null;
  }
  // 按量付费渠道：能用就挑最闲的
  const ok = chAcc(ch).filter(capOf).sort(byIdle);
  return ok.length ? { ch, acc: ok[0], credits: false } : null;
}
// credits 兜底开关：账号显式设置优先，未设跟随渠道默认（默认开）
const fbEnabled = (ch, a) => a.creditFallback === undefined ? ch.settings.creditFallback !== false : !!a.creditFallback;
const busy = (acc, kind, d) => { acc.inFlight = acc.inFlight || {}; acc.inFlight[kind] = Math.max(0, (acc.inFlight[kind] || 0) + d); };
// 取消/正常结束都只回收一次坑位：管理员强制取消 running 任务时立即腾位置给下一个
const releaseSlot = (j, acc) => { if (j._rel || !acc) return; j._rel = true; busy(acc, j.kind, -1); };

// ---------- jobs ----------
// 上游报错对外脱敏：额度/积分类一律只说
// "代理额度不足"；其余剥掉 "HTTP xxx POST /path:" 传输前缀（上游 API 结构不外漏）、URL 打码。
// 管理端不受影响，仍看原文；注意别误伤"费用已退回/积分已退还"这类退款告知——只认"短缺"语义
const QUOTA_ERR = /积分不足|点数不足|额度不足|余额不足|需要\s*[\d.,]+\s*[,，]?\s*(?:当前|剩余|可用)|insufficient\s+(?:credit|balance|quota|point|fund)|HTTP 402|status[":\s]+402/i;
const userErr = (s) => QUOTA_ERR.test(s) ? '代理额度不足'
  : String(s).replace(/^HTTP \d+\s+\w+\s+(?:https?:\/\/\S+|[^:\s]+):\s*/, '') // 传输前缀（含上游路径/整条 URL）
             .replace(/^\{"error":"([^"]+)"\}\s*$/, '$1')            // 裸 JSON 信封拆开
             .replace(/https?:\/\/[^\s'"”』）)]+/g, '[服务方]');
// trim=true：列表/概览等面板批量视图裁掉长 prompt 与 error（prompt 普遍 2-5KB，50 条任务的
// 列表 7 成体积在 prompt 上，600KB 未压缩响应是切页卡的主源）。详情页/单任务查询仍回全量
function jobView(j, viewer, trim) {
  const admin = isAdmin(viewer);
  const clip = (s, n) => s == null ? s : (String(s).length > n ? String(s).slice(0, n) + '…' : String(s));
  return { id: j.id, kind: j.kind, status: j.status, model: j.model,
           prompt: trim ? clip(j.prompt, 300) : j.prompt, refs: j.refs,
           images: j.images, url: j.url, note: j.note || null, user: j.userName,
           error: admin ? (trim ? clip(j.error, 200) : j.error) : (j.error ? clip(userErr(j.error), trim ? 200 : Infinity) : j.error), // 上游细节不外漏
           ...(admin ? { channel: j.channel || null } : {}), // 渠道归属只给管理员
           billing: j.billing, createdAt: j.createdAt, updatedAt: j.updatedAt };
}
function newJob(user, kind, model, prompt, refs, price) {
  const j = { id: crypto.randomBytes(8).toString('hex'), user: user.id, userName: user.name,
    kind, model, prompt: String(prompt).slice(0, 8000), refs, status: 'queued',
    images: [], url: null, error: null, billing: { price, billed: false }, createdAt: Date.now(), updatedAt: Date.now() };
  S.jobs.push(j);
  if (S.jobs.length > JOBS_CAP) { // 只淘汰终态任务（排队/运行中的保留），淘汰的进归档不再丢
    const dead = S.jobs.filter(x => x.status !== 'queued' && x.status !== 'running');
    while (S.jobs.length > JOBS_CAP && dead.length) archiveAppend(S.jobs.splice(S.jobs.indexOf(dead.shift()), 1)[0]);
  }
  return j;
}
// 任务归档（souls 同款）：淘汰出热表的任务逐行 append 到 jobs-archive.jsonl，/api/jobs
// 惰性增量合并（记上次读到的 size，只读新增段），面板历史不再只有最近 500 条。内存里
// 最多留 3000 条，超了丢最老的（jsonl 文件本身全量保留）
const ARCHIVE = path.join(DATA, 'jobs-archive.jsonl');
let _arch = { size: 0, list: [] };
function archiveAppend(j) { try { fs.appendFileSync(ARCHIVE, JSON.stringify(j) + '\n'); } catch (e) { console.log(`[archive] 追加失败: ${String(e.message).slice(0, 60)}`); } }
function archiveJobs() {
  try {
    const st = fs.statSync(ARCHIVE);
    if (st.size < _arch.size) _arch = { size: 0, list: [] }; // 文件被截断/手工清理，从头重读
    if (st.size > _arch.size) {
      const fd = fs.openSync(ARCHIVE, 'r'), buf = Buffer.alloc(st.size - _arch.size);
      fs.readSync(fd, buf, 0, buf.length, _arch.size); fs.closeSync(fd);
      for (const line of buf.toString('utf8').split('\n')) { try { if (line.trim()) _arch.list.push(JSON.parse(line)); } catch {} }
      _arch.size = st.size;
      if (_arch.list.length > 3000) _arch.list = _arch.list.slice(-3000);
    }
  } catch {}
  return _arch.list;
}
const touch = (j, patch) => { Object.assign(j, patch, { updatedAt: Date.now() }); if (j.status === 'done' || j.status === 'failed') save(); };

// 分发循环：找得到空闲账号就跑，找不到等下一拍
setInterval(() => {
  for (const j of S.jobs.filter(x => x.status === 'queued')) {
    if (j._notBefore && Date.now() < j._notBefore) continue; // 自动重试退避中，到点再派
    const pick = pickAccount(j.kind, j.model);
    if (!pick) { // 派不出去：坑位忙/无匹配账号。约 30 秒后在任务上写明原因，别让人干等
      j._miss = (j._miss || 0) + 1;
      if (j._miss === 45 && !j.note) {
        const chR = S.channels.find(c => c.id === ((MODEL_REG[j.kind].get(String(j.model)) || {}).ch));
        let why = '并发坑位已满，排队中';
        const a0 = chR && chR.accounts.find(a => a.enabled);
        if (chR && capsOf(CHANNEL_TYPES[chR.type] || {}).dualMode && a0 && a0.mode === 'unlimited'
            && !(a0.info.unlimited || []).includes(String(j.model)) && !fbEnabled(chR, a0))
          why = '模型不在该账号包量权益，且 credits 兜底已关（渠道页可开）';
        j.note = `等待中：${why}`;
        save();
      }
      continue;
    }
    if (j._miss) { j._miss = 0; if (j.note && j.note.startsWith('等待中')) { j.note = null; save(); } }
    const { ch, acc, credits } = pick;
    j.channel = ch.id;
    touch(j, { status: 'running' });
    if (!j.opts) j.opts = {};
    if (credits && !j.opts.forceCredits) { j.opts.forceCredits = true; j.note = '无 unlimited 权益，走 credits（扣账号积分）'; save(); }
    busy(acc, j.kind, +1); j.accId = acc.id;
    // 重跑（自动重试/换道兜底）的 job 带着上一轮的 _rel=true——releaseSlot 的只回收一次守卫
    // 会把本轮的坑位吞掉不还（曾因此漏 1 坑、并发直接砍半）。派发即清，每轮各还各的
    delete j._rel;
    runJob(j, acc).finally(() => { releaseSlot(j, acc); if (j._wake) j._wake(); });
  }
}, 700);

// 模型兜底（2026-09-07 用户要求）：原模型「提交阶段」失败 → 自动改用管理员配置的兜底模型重排。
// 只在适配器标记 e.stage==='submit'（上游没建任务=不扣上游钱，换道无双扣风险）时触发；
// 计费仍按原模型提交时算好的 j.billing.price；j._fb 标记只兜一次，防 A→B→A 打环。
function requeueFallback(j, fbTo, e) {
  const chId = (MODEL_REG[j.kind].get(String(fbTo)) || {}).ch;
  const ch2 = chId && S.channels.find(c => c.id === chId && c.enabled && c.accounts.some(a => a.enabled));
  const u = S.users.find(x => x.id === j.user);
  if (!ch2 || !modelAllowed(u, fbTo)) {
    log(`[job] ${j.id} 兜底 ${j.model}→${fbTo} 不可用（渠道无账号/用户无权），按原失败处理`);
    return false;
  }
  const from = j.model;
  j._fb = true; j.note = `兜底：${from} 提交失败，自动改用 ${fbTo}`;
  j.model = fbTo; if (j.opts) j.opts.model = fbTo;
  j.channel = ch2.id; j.accId = null;
  touch(j, { status: 'queued', error: null }); save();
  logAct('系统', '模型兜底', `${from} → ${fbTo} job=${j.id}（${String(e.message).slice(0, 80)}）`);
  log(`[job] ${j.id} 提交失败（${String(e.message).slice(0, 80)}）→ 兜底换道 ${from} → ${fbTo} 重新排队`);
  return true;
}

// 平台级失败自动重试（2026-09-18 用户要求，默认 5 次、管理员概览页可改）：失败若属「可重试类」
// → 指数退避后回排队重跑（重新过 pickAccount，可换账号）。只重试瞬态/上游侧失败——垫图判
// 风险/肖像/版权这类确定性审核拒绝重投必再挂，不烧次数也不骚扰上游审核；重启中断单已由
// boot sweep 判死（不参与，防崩溃循环）；取消单永不重试；计费只在成功时发生，重试无双扣
const RETRYABLE_FAIL = /710082041|没有派发生成工具|没有调用生成工具|high demand|710022002|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|HTTP 5\d\d|SSLError|curl: \(35\)|轮询连续失败|上游任务超时|超上限|额度|点数不足|video request failed|生成时间过长|费用已退回|积分已退还|aborted due to timeout/;
// 确定性拒绝（换词/换图才有救）：版权/肖像/垫图判风险的报错同样带「没有派发生成工具」前缀，
// 先排雷再谈重试——2026-09-18 用全部历史错误实测过分类。HTTP 40[13] 原是挡无效 key，
// 但欠费类 403（预扣费额度失败）恰恰该重试——重分发会换到有余额的账号，故单独豁免
const NON_RETRYABLE = /版权|肖像|risk_fake_item|判风险|outside range|HTTP 40[13]/;
const QUOTA_FAIL = /预扣费额度|额度不足|剩余额度|点数不足|余额不足|insufficient/i;
function autoRetryRequeue(j, e) {
  const max = Math.max(0, Math.min(10, Number(S.autoRetry) || 0));
  const n = (j._retry || 0) + 1;
  const msg = String(e.message || '');
  if (n > max || !RETRYABLE_FAIL.test(msg) || (NON_RETRYABLE.test(msg) && !QUOTA_FAIL.test(msg))) return false;
  const wait = Math.min(300, 15 * 2 ** (n - 1)); // 15s→30s→60s→120s→240s，封顶 5min
  j._retry = n;
  j.note = `自动重试 ${n}/${max}：${msg.slice(0, 50)}`;
  j._notBefore = Date.now() + wait * 1000;
  touch(j, { status: 'queued', error: msg }); // error 留案：重试期间台账能看到上次败因
  log(`[job] ${j.id} 失败（${msg.slice(0, 80)}）→ 自动重试 ${n}/${max}，${wait}s 后重跑`);
  save();
  return true;
}

async function runJob(j, acc) {
  const ch = S.channels.find(c => c.id === j.channel);
  const ad = ch && CHANNEL_TYPES[ch.type];
  if (!ch || !ad) { touch(j, { status: 'failed', error: '渠道适配器不存在（文件被移除？）' }); return; } // 适配器下线后旧任务直接判失败
  // 平台级 watchdog（全渠道 5h 没出结果即判失败）：
  // 渠道适配器自己到 5h 会退，这里 5h+5min 兜底——多 5 分钟让渠道层带上游 task id 的报错优先
  const guarded = (p) => {
    let t;
    const bomb = new Promise((_, no) => { t = setTimeout(() => no(new Error('任务超时（>5h），平台自动判失败')), 5 * 3600 * 1000 + 5 * 60 * 1000); });
    p.catch(() => {}); // watchdog 判死后渠道 promise 迟到失败——别当 unhandled rejection 炸进程
    return Promise.race([p, bomb]).finally(() => clearTimeout(t));
  };
  const attempt = (o) => {
    const p = j.kind === 'image'
      ? ad.image(ch.settings, acc, o, j.prompt)
      : ad.video(ch.settings, acc, o, j.prompt);
    return guarded(p);
  };
  try {
    let res;
    try {
      res = await attempt(j.opts);
    } catch (e) { // unlimited 跑不通（权益失效/清单过期 409）→ 转 credits 扣账号积分重试一次
      if (capsOf(ad).dualMode && !j.opts.forceCredits && acc.mode === 'unlimited' && fbEnabled(ch, acc) && (acc.info.credits || 0) > 20 &&
          /unlimited entitlement/i.test(String(e.message))) {
        log(`[job] ${j.id} unlimited 失败（${String(e.message).slice(0, 100)}）→ credits 重试`);
        j.note = 'unlimited 跑不通，已转 credits（扣账号积分）';
        j.opts.forceCredits = true; save();
        res = await attempt(j.opts);
      } else throw e;
    }
    if (j.status === 'cancelled') { log(`[job] ${j.id} 已取消，丢弃上游结果（不扣费）`); cleanupJobRefs(j); return; }
    const u = S.users.find(x => x.id === j.user);
    if (u) { moveCredit(u, -j.billing.price, `任务扣费 ${j.model}`, j.id); u.spent = round2((u.spent || 0) + j.billing.price); }
    acc.stats = acc.stats || {}; acc.stats[j.kind] = (acc.stats[j.kind] || 0) + 1;
    touch(j, { status: 'done',
      images: (res.images || []).map(i => i.url || i), url: res.url || null,
      prompt_id: res.prompt_id || null, note: res.note || j.note || null,
      billing: { ...j.billing, billed: true } });
    log(`[job] done ${j.id} ${j.model} user=${j.userName} -${j.billing.price}cr`);
    cleanupJobRefs(j);
  } catch (e) {
    if (j.status === 'cancelled') { log(`[job] ${j.id} 已取消，忽略上游报错`); cleanupJobRefs(j); return; }
    // 建单前失败（e.stage==='submit'，上游无任务=无上游计费）→ 按兜底表自动换道重排
    const fbTo = !j._fb && e.stage === 'submit' ? String((S.fallbacks || {})[j.model] || '') : '';
    if (fbTo && fbTo !== j.model && requeueFallback(j, fbTo, e)) return; // 已重新排队，交给分发循环
    if (autoRetryRequeue(j, e)) return; // 可重试类失败：退避后回排队（可能换账号）
    touch(j, { status: 'failed', error: e.message });
    log(`[job] FAIL ${j.id} ${j.model}: ${e.message}`);
    // 失败不清垫图：保留 48h 供面板一键重试（boot sweep 过期回收）；done/cancelled 才即时清
  }
}

// ---------- helpers ----------
function httpErr(code, msg) { const e = new Error(msg); e.code = code; return e; }
// gzip 压缩（2026-09-18 流畅性优化）：/api/jobs 列表 50 条带全量 prompt 时未压缩 ~600KB，
// 弱网链路上和视频下载抢带宽——「下载慢、切页卡」另一半元凶。>1KB 且客户端声明 gzip 才压，
// level 6 典型把 JSON 压到 1/10。压缩失败原样返回（gzip 偶发 内存吃紧抛错，别让请求挂掉）
function gzOf(req, buf) {
  if (buf.length < 1024 || !/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) return null;
  try { return zlib.gzipSync(buf, { level: 6 }); } catch { return null; }
}
const jres = (req, res, code, obj) => {
  const raw = Buffer.from(JSON.stringify(obj));
  const gz = gzOf(req, raw);
  if (gz) return res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding', 'Content-Length': gz.length }), void res.end(gz);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': raw.length }); res.end(raw);
};
function userByKey(key) {
  for (const u of S.users) { const k = u.keys.find(x => x.key === key); if (k) return { u, k }; }
  return {};
}
// 垫图瘦身（ffmpeg 缩边长 + JPEG 重编码，stdin/stdout 管道不落临时文件）
// 面板端已在浏览器压过一轮，这里是 API 直传大图的兜底；失败返回 null 保持原图，绝不拒收
function ffSlim(buf, dim, q) {
  const { spawn } = require('child_process');
  return new Promise((ok) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
      '-vf', `scale=min(iw\\,${dim}):min(ih\\,${dim}):force_original_aspect_ratio=decrease:force_divisible_by=2`,
      '-q:v', String(q), '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1']);
    const out = [];
    p.stdout.on('data', d => out.push(d));
    p.on('error', () => ok(null));
    p.on('close', () => ok(out.length ? Buffer.concat(out) : null));
    p.stdin.on('error', () => {}); // ffmpeg 提前退出时 EPIPE 别炸
    p.stdin.end(buf);
  });
}
async function saveUpload(b64, budget) {
  const m = /^data:image\/(png|jpe?g|webp);base64,/.exec(b64);
  let buf = Buffer.from(m ? b64.slice(m[0].length) : b64, 'base64');
  let ext = m ? (m[1] === 'png' ? '.png' : /jpe?g/.test(m[1]) ? '.jpg' : '.webp') : null;
  if (!ext) {
    if (buf[0] === 0x89 && buf[1] === 0x50) ext = '.png';
    else if (buf[0] === 0xff && buf[1] === 0xd8) ext = '.jpg';
    else if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') ext = '.webp';
    else throw httpErr(400, '参考图仅支持 png/jpg/webp');
  }
  if (buf.length < 1024) throw httpErr(400, '参考图太小/损坏');
  // 超预算的尽力压（逐档降，都不进预算就用最小档——2026-09-07 用户明确：不拒收）；ffmpeg 不可用则原图照收
  if (budget != null && buf.length > budget) {
    let last = null;
    for (const [dim, q] of [[2048, 3], [1600, 7], [1280, 12], [960, 20]]) {
      const out = await ffSlim(buf, dim, q);
      if (!out) break;
      last = out;
      if (out.length <= budget) break;
    }
    if (last && last.length >= 1024) { buf = last; ext = '.jpg'; } // JPEG 无透明通道，压过即转 jpg
  }
  const f = path.join(UPLOADS, `up_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`);
  fs.writeFileSync(f, buf);
  return { f, size: buf.length };
}
// API 直传垫图（base64）累计 ≤20MB（与面板口径一致；URL/photo id/用户自备路径不经这里）
const REF_BUDGET = 20 * 1024 * 1024;
async function normalizeRefs(body) {
  const refs = []; // { kind: 'id' | 'url' | 'file', value, fresh: 本次新落盘的素材 }
  let used = 0;
  for (const r of [].concat(body.ref || [], body.image ? [body.image] : [], body.images || [])) {
    if (typeof r !== 'string' || !r.trim()) continue;
    const s = r.trim();
    if (/^\d+$/.test(s)) { refs.push({ kind: 'id', value: s }); continue; }
    if (/^https?:\/\//i.test(s)) { refs.push({ kind: 'url', value: s }); continue; }
    if (!fs.existsSync(path.resolve(ROOT, s))) {
      const { f, size } = await saveUpload(s, REF_BUDGET - used);
      used += size;
      refs.push({ kind: 'file', value: f, fresh: true }); continue;
    }
    const p = path.resolve(ROOT, s);
    if (!p.startsWith(ROOT + path.sep)) throw httpErr(400, 'ref 文件必须在服务目录内');
    refs.push({ kind: 'file', value: p });
  }
  return refs;
}
// ---------- 视频/音频参考素材（2026-09-18 自 souls 移植）----------
// 本机 2 核 2G 压不动视频转码——不瘦身、原样落盘，只做体积封顶；走同一条 up_* 公链（终态即清）
const MEDIA_FILE_MAX = { video: 40 * 1024 * 1024, audio: 10 * 1024 * 1024 }; // 单文件封顶（视频 40MB 含 base64 膨胀仍在 BODY_LIMIT 64MB 内）
function mediaExt(buf) {
  const s = (o, n) => buf.slice(o, o + n).toString('latin1');
  if (s(4, 4) === 'ftyp') return '.mp4'; // mp4/mov 家族容器
  if (s(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return '.mp3';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE') return '.wav';
  if (s(0, 4) === 'OggS') return '.ogg';
  if (s(0, 4) === 'fLaC') return '.flac';
  return null;
}
async function saveMedia(b64, kind) {
  const m = /^data:[\w.+-]+\/[\w.+-]+;base64,/.exec(b64);
  const buf = Buffer.from(m ? b64.slice(m[0].length) : b64, 'base64');
  const max = MEDIA_FILE_MAX[kind], label = kind === 'video' ? '视频' : '音频';
  if (buf.length < 1024) throw httpErr(400, `${label}参考文件太小/损坏`);
  if (buf.length > max) throw httpErr(413, `${label}参考单文件超上限（≤${Math.round(max / 1048576)}MB）`);
  const ext = mediaExt(buf) || (kind === 'video' ? '.mp4' : '.mp3'); // 嗅不出容器按 kind 兜底
  const f = path.join(UPLOADS, `up_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`);
  fs.writeFileSync(f, buf);
  return { f, size: buf.length };
}
async function normalizeMedia(body, kind) { // refVideos / refAudios：URL 直传 / base64 落盘 / 服务端路径（同垫图三形态）
  const out = [];
  for (const r of [].concat((kind === 'video' ? body.refVideos : body.refAudios) || [])) {
    if (typeof r !== 'string' || !r.trim()) continue;
    const s = r.trim();
    if (/^https?:\/\//i.test(s)) { out.push({ kind: 'url', value: s }); continue; }
    if (fs.existsSync(path.resolve(ROOT, s))) {
      const p = path.resolve(ROOT, s);
      if (!p.startsWith(ROOT + path.sep)) throw httpErr(400, 'ref 文件必须在服务目录内');
      out.push({ kind: 'file', value: p }); continue;
    }
    const { f } = await saveMedia(s, kind);
    out.push({ kind: 'file', value: f, fresh: true });
  }
  return out;
}
// 任务终态即清素材：结果只存上游 URL（不下载），垫图文件上游拉完就没用了——
// 只删本次为该任务落盘的 up_* 文件（用户自备的服务端路径不动）
function cleanupJobRefs(j) {
  if (!j.refFiles || !j.refFiles.length) return;
  let n = 0;
  for (const f of j.refFiles) {
    const b = path.basename(String(f));
    if (!b.startsWith('up_') || !String(f).startsWith(UPLOADS + path.sep)) continue;
    try { fs.rmSync(f, { force: true }); n++; } catch {}
  }
  if (n) log(`[cleanup] ${j.id} 已清垫图素材 ${n} 个文件`);
  j.refFiles = [];
}
// 上传文件 → 公网 URL（部分上游只收公网参考图；static 路由托管 /uploads）
// 优先取目标渠道的 publicBase，没配就借用任一渠道配的（全局语义：本机公网地址），最后按请求 Host 推
function publicFileUrl(host, file, chId) {
  const pb = ((S.channels.find(c => c.id === chId && c.settings.publicBase) ||
               S.channels.find(c => c.settings.publicBase)) || { settings: {} }).settings.publicBase;
  const base = (pb && String(pb).replace(/\/$/, '')) || `http://${host || '127.0.0.1:8792'}`;
  return `${base}/uploads/${path.basename(file)}`;
}
async function pickSize(ch, model, body) {
  if (body.size) return body.size;
  if (!body.aspect_ratio) return undefined;
  const list = await CHANNEL_TYPES[ch.type].models(ch.settings, ch.accounts).catch(() => []);
  const m = list.find(x => x.id === model);
  const [aw, ah] = body.aspect_ratio.split(':').map(Number);
  const target = (body.resolution || '1K').toUpperCase() === '2K' ? 2048 : 1024;
  const pool0 = (m ? m.sizes : []).map(s => s.split('x').map(Number));
  const cands = pool0.filter(([w, h]) => Math.abs(w / h - aw / ah) < 0.02);
  const pool = cands.length ? cands : pool0;
  if (!pool.length) return undefined;
  const b = pool.reduce((b, [w, h]) => Math.abs(Math.max(w, h) - target) < Math.abs(Math.max(b[0], b[1]) - target) ? [w, h] : b);
  return `${b[0]}x${b[1]}`;
}
const snapDur = (spec, dur) => // 就近取该模型允许的档位（统一视频模型表都带 duration[]）
  Array.isArray(spec && spec.duration) && spec.duration.length
    ? spec.duration.reduce((b, d) => Math.abs(d - dur) < Math.abs(b - dur) ? d : b) : dur;

// 下游可用 {{1}} 或 @image1 指代第 1 张垫图（两种写法统一归一成 {{N}}）
const normRefs = (p) => String(p == null ? '' : p).replace(/@image(\d+)/gi, '{{$1}}');

// ---------- panel api (/api/*) ----------
function subtree(me) { // 代理能看到的用户 = 自己 + 直接下级
  if (isAdmin(me)) return S.users;
  return S.users.filter(u => u.id === me.id || u.parent === me.id);
}
const pubUser = (u) => ({ id: u.id, name: u.name, role: u.role, status: u.status,
  models: u.grants ? Object.keys(u.grants).length : -1, // -1 = 全部模型；面板徽标用
  grants: u.grants || null, balance: round2(u.balance || 0),
  spent: round2(u.spent || 0), parent: u.parent, keys: u.keys.map(k => ({ ...k, key: k.key.slice(0, 8) + '…' + k.key.slice(-4) })),
  createdAt: u.createdAt, children: S.users.filter(x => x.parent === u.id).length });
const fullUser = (u) => ({ ...pubUser(u), keys: u.keys });

async function apiRoute(req, res, body, me) {
  const p = req.url.split('?')[0];
  const q = Object.fromEntries(new URLSearchParams(req.url.split('?')[1] || ''));
  const M = req.method;

  if (M === 'POST' && p === '/api/login') {
    const u = S.users.find(x => x.name === body.name);
    if (!u || !checkPass(u, body.password || '')) {
      logAct(`${String(body.name || '?')}·?`, '登录失败', '用户名或密码错误');
      throw httpErr(401, '用户名或密码错误');
    }
    if (u.status !== 'active') throw httpErr(403, '账号已停用');
    const t = crypto.randomBytes(24).toString('hex');
    for (const [k, v] of Object.entries(S.sessions)) if (v.exp < Date.now()) delete S.sessions[k]; // 顺手清过期
    S.sessions[t] = { uid: u.id, exp: Date.now() + SESSION_MS };
    save();
    logAct(u, '登录', '面板');
    res.setHeader('Set-Cookie', `waline_session=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}`);
    return [200, { ok: true, role: u.role, name: u.name }];
  }
  if (M === 'POST' && p === '/api/logout') {
    const m = /waline_session=([a-f0-9]+)/.exec(req.headers.cookie || '');
    if (m) { delete S.sessions[m[1]]; save(); }
    res.setHeader('Set-Cookie', 'waline_session=; Max-Age=0');
    return [200, { ok: true }];
  }
  if (!me) throw httpErr(401, '未登录');

  if (M === 'GET' && p === '/api/me') return [200, fullUser(me)];
  if (M === 'POST' && p === '/api/password') {
    if (!checkPass(me, body.old || '')) throw httpErr(400, '旧密码错误');
    me.passHash = hash(body.new, me.salt); save();
    return [200, { ok: true }];
  }
  if (M === 'POST' && p === '/api/profile') { // 个人中心自助：改自己的用户名/密码（旧密码验证身份）
    if (!checkPass(me, body.old || '')) throw httpErr(400, '旧密码错误');
    const name = body.name != null ? String(body.name).trim() : me.name;
    if (name !== me.name) {
      if (!name || name.length > 40) throw httpErr(400, '用户名需 1–40 个字符');
      if (S.users.some(u => u.name === name)) throw httpErr(400, '用户名已存在');
      const old = me.name;
      me.name = name;
      logAct(me, '改用户名', `${old} → ${name}`);
    }
    if (body.password) {
      if (String(body.password).length < 6) throw httpErr(400, '密码 ≥6 位');
      me.passHash = hash(body.password, me.salt);
      logAct(me, '改密', '个人中心自助');
    }
    save();
    return [200, fullUser(me)];
  }
  if (M === 'POST' && p === '/api/me/keys' && body.name) { // 给自己发密钥（用户/代理均可）
    me.keys.push({ key: 'sk-' + crypto.randomBytes(16).toString('hex'), name: String(body.name).slice(0, 40), createdAt: Date.now(), status: 'active', spent: 0 });
    save(); return [200, fullUser(me)];
  }
  if (M === 'POST' && p.startsWith('/api/me/keys/status') && body.key) {
    const k = me.keys.find(x => x.key === body.key); if (!k) throw httpErr(404, '密钥不存在');
    k.status = body.status === 'active' ? 'active' : 'disabled'; save();
    return [200, fullUser(me)];
  }
  if (M === 'POST' && p === '/api/me/keys/del' && body.key) { // 删除自己的密钥（立即失效，不可恢复）
    if (!me.keys.some(x => x.key === body.key)) throw httpErr(404, '密钥不存在');
    me.keys = me.keys.filter(x => x.key !== body.key);
    logAct(me, '删密钥', `${String(body.key).slice(0, 8)}…`);
    save(); return [200, fullUser(me)];
  }

  if (M === 'GET' && p === '/api/overview' && isAdmin(me)) {
    const day = Date.now() - 86400e3;
    const jobs = S.jobs.filter(x => x.createdAt > day);
    return [200, {
      users: S.users.length, agents: S.users.filter(u => u.role === 'agent').length,
      keys: S.users.reduce((n, u) => n + u.keys.length, 0),
      jobs24h: jobs.length, done24h: jobs.filter(x => x.status === 'done').length,
      billed24h: round2(jobs.filter(x => x.billing.billed).reduce((n, x) => n + x.billing.price, 0)),
      balanceIssued: round2(S.users.reduce((n, u) => n + (u.balance || 0), 0)),
      channels: S.channels.map(ch => ({ id: ch.id, name: ch.name, enabled: ch.enabled, accounts: ch.accounts.length,
        up: ch.accounts.filter(a => a.enabled).length, unlimited: ch.accounts.filter(a => a.enabled && a.mode === 'unlimited').length })),
      recent: S.jobs.slice(-8).reverse().map(j => jobView(j, me, true)),
      autoRetry: S.autoRetry,
      resultsRetention: S.resultsRetention,
    }];
  }
  if (M === 'POST' && p === '/api/autoretry' && isAdmin(me)) { // 失败自动重试次数（管理员随时改，即时生效）
    S.autoRetry = Math.max(0, Math.min(10, Math.round(Number(body.n)) || 0));
    save(); logAct(me, '系统设置', `失败自动重试次数 → ${S.autoRetry} 次`);
    return [200, { ok: true, autoRetry: S.autoRetry }];
  }
  if (M === 'POST' && p === '/api/retention' && isAdmin(me)) { // 成片转存保留天数（1-30，改完下一轮清扫生效）
    S.resultsRetention = Math.max(1, Math.min(30, Math.round(Number(body.days)) || 7));
    save(); logAct(me, '系统设置', `成片转存保留 → ${S.resultsRetention} 天`);
    sweepResults(); // 缩短保留立即清一轮，别等明天
    return [200, { ok: true, resultsRetention: S.resultsRetention }];
  }

  // ---- 渠道管理（管理员）----
  if (isAdmin(me)) {
    if (M === 'GET' && p === '/api/channels') {
      return [200, S.channels.map(ch => { const ad = CHANNEL_TYPES[ch.type] || {};
        return { ...ch, // meta：适配器自描述（UI 按它渲染渠道名/设置表单/能力位，零硬编码）
          meta: { name: ad.NAME || ch.type, desc: ad.DESC || '', keyLabel: ad.KEY_LABEL || 'API Key',
            fields: ad.SETTINGS_FIELDS || [], caps: capsOf(ad) },
          settings: { ...ch.settings }, accounts: ch.accounts.map(a => ({ ...a,
          token: a.token.slice(0, 12) + '…' + a.token.slice(-8), info: a.info, stats: a.stats || {}, inFlight: a.inFlight || {},
          lastCheck: a.lastCheck || null })) }; })];
    }
    if (M === 'POST' && /^\/api\/channel\/[a-z]+\/account$/.test(p)) { // 添加账号（token 形态由适配器自验）
      const ch = S.channels.find(c => p.startsWith(`/api/channel/${c.id}/`));
      const ad = CHANNEL_TYPES[ch.type];
      const token = String(body.token || '').trim();
      if (!token || token.length < 20) throw httpErr(400, 'token 太短，不像合法密钥');
      const info = await ad.probe(ch.settings, token); // 体检失败会抛错
      logAct(me, '挂账号', `${ch.id} · ${String(body.label || info.name).slice(0, 30)}`);
      const dual = capsOf(ad).dualMode; // 双模式渠道（包量/积分）才有 mode 与兜底开关
      ch.accounts.push({ id: uid('a'), label: String(body.label || info.email || info.name).slice(0, 40),
        token, mode: dual ? (body.mode === 'credits' ? 'credits' : 'unlimited') : 'credits', enabled: true,
        creditFallback: dual && body.creditFallback != null ? !!body.creditFallback : undefined,
        info: { ...info, credits: info.credits ?? 0 }, lastCheck: Date.now(), stats: {}, inFlight: { image: 0, video: 0 } });
      save(); rebuildModelReg();
      return [200, { ok: true, info }];
    }
    const am = p.match(/^\/api\/channel\/([a-z]+)\/account\/([a-z0-9_]+)(\/check)?$/);
    if (am) {
      const ch = S.channels.find(c => c.id === am[1]);
      const ad = ch && CHANNEL_TYPES[ch.type];
      const acc = ch && ch.accounts.find(a => a.id === am[2]);
      if (!ch || !ad || !acc) throw httpErr(404, '账号不存在');
      if (M === 'POST' && am[3]) { logAct(me, '账号体检', `${ch.id} · ${acc.label}`); acc.info = { ...acc.info, ...await ad.probe(ch.settings, acc.token) }; acc.lastCheck = Date.now(); save(); return [200, { ok: true, info: acc.info }]; }
      if (M === 'DELETE') { logAct(me, '删账号', `${ch.id} · ${acc.label}`); ch.accounts = ch.accounts.filter(a => a.id !== am[2]); save(); rebuildModelReg(); return [200, { ok: true }]; }
      if (M === 'POST') {
        if (body.label !== undefined) acc.label = String(body.label).slice(0, 40);
        logAct(me, '账号设置', `${ch.id} · ${acc.label} ${JSON.stringify({ ...body }).slice(0, 60)}`);
        if (capsOf(ad).dualMode) {
          if (body.mode) acc.mode = body.mode === 'credits' ? 'credits' : 'unlimited';
          if (body.creditFallback !== undefined) acc.creditFallback = body.creditFallback === null ? undefined : !!body.creditFallback;
        }
        if (body.enabled !== undefined) { acc.enabled = !!acc.enabled; }
        save(); rebuildModelReg();
        return [200, { ok: true }];
      }
    }
    if (M === 'POST' && /^\/api\/channel\/[a-z]+\/settings$/.test(p)) {
      const ch = S.channels.find(c => p === `/api/channel/${c.id}/settings`);
      const s2 = body.settings || body;
      for (const k of Object.keys(ch.settings)) // 只收已知键，类型跟旧值走
        if (s2[k] !== undefined) ch.settings[k] = typeof ch.settings[k] === 'number' && !Array.isArray(s2[k]) ? Number(s2[k]) : s2[k];
      if (s2.creditFallback !== undefined) ch.settings.creditFallback = !!s2.creditFallback;
      if (body.enabled !== undefined) ch.enabled = !!body.enabled;
      logAct(me, '渠道设置', `${ch.id} ${Object.keys(s2).join(',')}${body.enabled !== undefined ? ` ${ch.enabled ? '启用' : '停用'}` : ''}`);
      save(); rebuildModelReg();
      return [200, { ok: true, settings: ch.settings }];
    }
    if (M === 'POST' && p === '/api/pricing') {
      const out = {}; // 清洗：数字标量 + 分辨率组合价（imageRes:{res:价} / videoRes:{res:{flat|perSec}}）+ mode
      for (const [id, e] of Object.entries(body || {})) {
        const o = {};
        for (const [k, v] of Object.entries(e || {})) {
          if (typeof v === 'number' && isFinite(v)) o[k] = v;
          else if (k === 'mode' && (v === 'flat' || v === 'perSec')) o.mode = v;
          else if (v && typeof v === 'object') {
            const r = {};
            for (const [res, rv] of Object.entries(v)) {
              if (typeof rv === 'number' && isFinite(rv)) r[res] = rv;
              else if (rv && typeof rv === 'object' && typeof rv.flat === 'number') r[res] = { flat: rv.flat };
              else if (rv && typeof rv === 'object' && typeof rv.perSec === 'number') r[res] = { perSec: rv.perSec };
            }
            if (Object.keys(r).length) o[k] = r;
          }
        }
        if (Object.keys(o).length) out[id] = o;
      }
      S.pricing = out; logAct(me, '定价更新', `${Object.keys(out).length} 个模型`); save(); return [200, S.pricing];
    }
    // 手动刷新模型目录（10min 自动重建之外的管理员按钮）：穿透适配器缓存重拉上游清单
    if (M === 'POST' && p === '/api/models/refresh') {
      for (const ad of Object.values(CHANNEL_TYPES)) { try { ad.resetCache && ad.resetCache(); } catch {} }
      await rebuildModelReg();
      logAct(me, '刷新模型目录', `图片 ${MODEL_REG.image.size} · 视频 ${MODEL_REG.video.size}`);
      return [200, { ok: true, image: MODEL_REG.image.size, video: MODEL_REG.video.size }];
    }
    // ---- 充值管理（管理员）：生成/查询/作废兑换码。码即库存——贴到发卡平台卖，
    // 买家拿码回 POST /api/redeem 兑积分。面值 = 积分，兑换即入账并记流水 ----
    if (M === 'GET' && p === '/api/codes') {
      let list = S.codes.slice().reverse();
      if (q.status === 'unused') list = list.filter(c => !c.used);
      if (q.status === 'used') list = list.filter(c => c.used);
      if (q.k) { const k = String(q.k).toLowerCase(); list = list.filter(c => c.code.toLowerCase().includes(k) || String(c.note || '').toLowerCase().includes(k)); }
      const unused = S.codes.filter(c => !c.used), used = S.codes.filter(c => c.used);
      return [200, { codes: list.slice(0, Number(q.limit) || 200), stats: {
        total: S.codes.length, unused: unused.length, unusedCredits: round2(unused.reduce((n, c) => n + c.credits, 0)),
        redeemed: used.length, redeemedCredits: round2(used.reduce((n, c) => n + c.credits, 0)) } }];
    }
    if (M === 'POST' && p === '/api/codes') {
      const credits = Math.round(Number(body.credits) * 100) / 100;
      const count = Math.min(100, Math.max(1, Number(body.count) || 1));
      if (!(credits > 0)) throw httpErr(400, '面值必须是正数（积分/张）');
      const note = String(body.note || '').slice(0, 40);
      const AB = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉易混 I/L/O/0/1
      const taken = new Set(S.codes.map(c => c.code));
      const made = [];
      while (made.length < count) {
        let code = 'WL';
        for (let g = 0; g < 3; g++) { code += '-'; for (let i = 0; i < 4; i++) code += AB[crypto.randomBytes(1)[0] % AB.length]; }
        if (taken.has(code)) continue;
        taken.add(code);
        const c = { id: uid('c'), code, credits, note, createdAt: Date.now(), used: null };
        S.codes.push(c); made.push(c);
      }
      logAct(me, '生成兑换码', `${count} 张 × ${credits} 积分${note ? ` · ${note}` : ''}`);
      save();
      return [200, { ok: true, made: made.map(({ code, credits: cr }) => ({ code, credits: cr })) }];
    }
    const cdel = p.match(/^\/api\/code\/([a-z0-9_]+)$/);
    if (cdel && M === 'DELETE') {
      const c = S.codes.find(x => x.id === cdel[1]);
      if (!c) throw httpErr(404, '兑换码不存在');
      if (c.used) throw httpErr(400, '已兑换的码不能删（冲账走用户余额调整）');
      S.codes = S.codes.filter(x => x.id !== c.id);
      logAct(me, '作废兑换码', `${c.code} · ${c.credits} 积分`);
      save(); return [200, { ok: true }];
    }
    if (M === 'POST' && p === '/api/codes/clear') { // 一键清空：删光未兑换的，已兑换记录保留（对账用）
      const before = S.codes.length;
      S.codes = S.codes.filter(c => c.used);
      const n = before - S.codes.length;
      if (!n) throw httpErr(400, '没有未兑换的码可清');
      logAct(me, '清空兑换码', `删除未兑换 ${n} 张（保留已兑换 ${S.codes.length} 条）`);
      save();
      return [200, { ok: true, removed: n, kept: S.codes.length }];
    }
  }
  // 模型兜底表（2026-09-07）：staff 可读；改写仅管理员。{ 原模型: 兜底模型 }，POST 全量覆盖，空值=清除
  if (M === 'GET' && p === '/api/fallbacks' && me.role !== 'user') return [200, S.fallbacks];
  if (M === 'POST' && p === '/api/fallbacks' && isAdmin(me)) {
    const out = {};
    for (const [m, to] of Object.entries(body || {})) {
      const t = String(to || '').trim();
      if (!t) continue;
      const kind = MODEL_REG.video.has(m) ? 'video' : MODEL_REG.image.has(m) ? 'image' : null;
      if (m === t) throw httpErr(400, `兜底模型不能是自身: ${m}`);
      if (!kind) throw httpErr(400, `${m} 不在可派发模型清单`);
      if (!MODEL_REG[kind].has(t)) throw httpErr(400, `兜底模型 ${t} 不在可派发清单（或与 ${m} 类型不符：需同为${kind === 'video' ? '视频' : '生图'}模型）`);
      out[m] = t;
    }
    S.fallbacks = out;
    logAct(me, '兜底更新', Object.keys(out).length ? Object.entries(out).map(([a, b]) => `${a}→${b}`).join('，') : '（已清空）');
    save(); return [200, S.fallbacks];
  }
  // 全局定价表：staff 可读（代理给下级定价要参照），改写仅管理员
  if (M === 'GET' && p === '/api/pricing' && me.role !== 'user') return [200, S.pricing];
  // 平台操作日志（仅管理员；k=关键词模糊筛 actor/act/detail）
  if (M === 'GET' && p === '/api/logs') {
    if (!isAdmin(me)) throw httpErr(403, '仅管理员');
    let list = S.logs.slice().reverse();
    if (q.k) list = list.filter(x => `${x.actor}${x.act}${x.detail}`.includes(q.k));
    return [200, list.slice(0, Number(q.limit) || 200)];
  }
  // 积分流水：admin 全平台 / 代理 自己+直接下级 / 用户 自己
  if (M === 'GET' && p === '/api/ledger') {
    let list = S.ledger.slice().reverse();
    if (!isAdmin(me)) { const ids = new Set(subtree(me).map(u => u.id)); list = list.filter(x => ids.has(x.uid)); }
    if (q.user) list = list.filter(x => x.user === q.user);
    return [200, list.slice(0, Number(q.limit) || 200)];
  }
  // 兑换码充值：任何登录角色。格式 WL-XXXX-XXXX-XXXX；一码一次，重复兑换报已兑人
  if (M === 'POST' && p === '/api/redeem') {
    const code = String(body.code || '').trim().toUpperCase();
    if (!/^WL(-[A-Z2-9]{4}){3}$/.test(code)) throw httpErr(400, '兑换码格式不对（WL-XXXX-XXXX-XXXX）');
    const c = S.codes.find(x => x.code === code);
    if (!c) throw httpErr(404, '兑换码不存在，请核对后重试');
    if (c.used) throw httpErr(400, `该码已被 ${c.used.name} 于 ${new Date(c.used.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} 兑换`);
    c.used = { uid: me.id, name: me.name, at: Date.now() };
    moveCredit(me, c.credits, `兑换码充值 ${code.slice(0, 11)}`);
    logAct(me, '兑换充值', `${code} → +${c.credits} 积分（余 ${me.balance}）`);
    save();
    return [200, { ok: true, credits: c.credits, balance: me.balance }];
  }

  // ---- 用户管理（管理员全部 / 代理仅下级）----
  if (M === 'GET' && p === '/api/users') return [200, subtree(me).map(pubUser)];
  if (M === 'POST' && p === '/api/users') {
    if (S.users.some(u => u.name === body.name)) throw httpErr(400, '用户名已存在');
    if (!body.name || !body.password || body.password.length < 6) throw httpErr(400, '需要用户名和 ≥6 位密码');
    const roles = isAdmin(me) ? ['user', 'agent', 'admin'] : ['user', 'agent'];
    if (!roles.includes(body.role)) throw httpErr(400, '角色只能是 ' + roles.join('/'));
    const bal = Math.max(0, Number(body.balance) || 0);
    let parent = null;
    if (isAdmin(me)) { // 管理员可指定代理作为上级（铸积分，不扣自己）；管理员不挂上级
      parent = body.role === 'admin' ? null : (body.parent || null);
      if (parent && !S.users.some(u => u.id === parent)) throw httpErr(400, '上级不存在');
    } else { // 代理：只能建 user，挂自己名下，初始积分从自身余额划扣
      if (me.role !== 'agent') throw httpErr(403, '无权建号');
      if (body.role !== 'user') throw httpErr(403, '代理只能建用户（建代理找管理员）');
      if (bal > 0 && me.balance < bal) throw httpErr(400, `自身余额不足（${round2(me.balance)}）`);
      parent = me.id;
    }
    const u = mkUser(body.name, body.password, body.role, parent, 0);
    // 受限代理建号：下级继承代理当前的授权副本（否则新号默认全部模型=越权）；
    // 代理自身不设限 → 下级也不设限（与原行为一致）
    if (me.role === 'agent' && me.grants) u.grants = JSON.parse(JSON.stringify(me.grants));
    S.users.push(u);
    if (bal > 0) {
      if (isAdmin(me)) moveCredit(u, bal, '管理员铸分（初始）');
      else { moveCredit(me, -bal, `建号划拨 → ${u.name}`); moveCredit(u, bal, `代理划拨 ← ${me.name}`); }
    }
    logAct(me, '建号', `${u.name}（${u.role}）初始 ${bal} 分`);
    save();
    return [200, pubUser(u)];
  }
  const um = p.match(/^\/api\/user\/([a-z0-9_]+)(\/key)?$/);
  if (um && M === 'POST') {
    const target = S.users.find(u => u.id === um[1]);
    const mine = isAdmin(me) || (me && target && target.parent === me.id);
    if (!target || !mine) throw httpErr(403, '无权操作该用户');
    if (um[2] === '/key') { // 发密钥（完整 key 只回显这一次）
      const key = 'sk-' + crypto.randomBytes(16).toString('hex');
      target.keys.push({ key, name: String(body.name || 'default').slice(0, 40), createdAt: Date.now(), status: 'active', spent: 0 });
      logAct(me, '发密钥', `${target.name}·${String(body.name || 'default').slice(0, 20)}`);
      save(); return [200, { ...pubUser(target), newKey: key }];
    }
    if (body.balanceDelta !== undefined) {
      const d = Number(body.balanceDelta);
      if (!isFinite(d)) throw httpErr(400, 'balanceDelta 非法');
      if (!isAdmin(me)) { // 代理只能从自己余额划拨
        if (d > 0 && me.balance < d) throw httpErr(400, '自身余额不足');
        moveCredit(me, -d, `划拨 → ${target.name}`);
      }
      moveCredit(target, d, isAdmin(me) ? `管理员${d >= 0 ? '充值' : '扣回'}` : `代理划拨 ← ${me.name}`);
      logAct(me, '调账', `${target.name} ${d >= 0 ? '+' : ''}${round2(d)} 分`);
      save(); return [200, pubUser(target)];
    }
    if (body.balance !== undefined) { // 直接设为目标余额（仅 admin）
      if (!isAdmin(me)) throw httpErr(403, '仅管理员可直接设置余额');
      const n = Number(body.balance);
      if (!isFinite(n) || n < 0) throw httpErr(400, 'balance 非法');
      const diff = round2(n - (target.balance || 0));
      moveCredit(target, diff, `管理员设余额 → ${round2(n)}`);
      logAct(me, '设余额', `${target.name} → ${round2(n)} 分（${diff >= 0 ? '+' : ''}${diff}）`);
      save(); return [200, pubUser(target)];
    }
    if (body.status) { target.status = body.status === 'active' ? 'active' : 'disabled'; logAct(me, '账号状态', `${target.name} → ${target.status}`); }
    if (body.password) { if (String(body.password).length < 6) throw httpErr(400, '密码 ≥6 位'); target.passHash = hash(body.password, target.salt); logAct(me, '改密', target.name); }
    save(); return [200, pubUser(target)];
  }
  if (um && M === 'DELETE') { // 删除用户（仅 admin，不可删自己/其他 admin）
    const target = S.users.find(u => u.id === um[1]);
    if (!isAdmin(me)) throw httpErr(403, '仅管理员可删除用户');
    if (!target) throw httpErr(404, '用户不存在');
    if (target.id === me.id) throw httpErr(400, '不能删除自己');
    if (target.role === 'admin') throw httpErr(400, '不能删除其他管理员');
    // 级联删除：被删用户的所有下级一并移除（代理的下级跟着代理走）
    const toDel = new Set([target.id]);
    let changed = true;
    while (changed) { changed = false; for (const u of S.users) if (u.parent && toDel.has(u.parent) && !toDel.has(u.id)) { toDel.add(u.id); changed = true; } }
    const delNames = S.users.filter(u => toDel.has(u.id)).map(u => u.name);
    S.users = S.users.filter(u => !toDel.has(u.id));
    logAct(me, '删号', `${delNames.join(' / ')}（${delNames.length} 个）`);
    save();
    return [200, { ok: true, deleted: delNames }];
  }
  const gmm = p.match(/^\/api\/user\/([a-z0-9_]+)\/models$/);
  if (gmm && M === 'POST') { // 模型授权与专属定价：grants=null 清限制（全部模型）
    const target = S.users.find(u => u.id === gmm[1]);
    if (!target) throw httpErr(404, '用户不存在');
    if (!(isAdmin(me) || (me.role === 'agent' && target.parent === me.id))) throw httpErr(403, '无权操作该用户');
    if (target.role === 'admin' && body.grants != null) // 管理员不可被设限（2026-09-12 实锤：把自己限到 1 个模型，全面板目录视野跟着被锁死）；grants=null 解锁仍允许
      throw httpErr(400, '管理员不受模型限制——限制管理员会把自己的面板视野一起锁死');
    // 代理语义：只能动「自己被授过的」模型；上级授给下级的原样保留（改不了也删不掉），
    // 清限制（grants=null）也只清自己那份——否则代理给下级开全部模型就是越权提权
    const higher = (tgt) => !isAdmin(me)
      ? Object.fromEntries(Object.entries(tgt.grants || {}).filter(([id]) => !modelAllowed(me, id))) : null;
    if (body.grants === null || body.grants === undefined) {
      const keep = higher(target);
      if (keep && Object.keys(keep).length) target.grants = keep;
      else if (isAdmin(me)) delete target.grants; // 管理员才真能恢复全部模型
      else target.grants = {}; // 代理清完自己授的 = 下级无可用模型（不能放开成全部）
      save(); return [200, pubUser(target)];
    }
    if (typeof body.grants !== 'object' || Array.isArray(body.grants)) throw httpErr(400, 'grants 非法');
    const clean = higher(target) || {};
    for (const [id, v] of Object.entries(body.grants)) {
      if (!id || typeof v !== 'object') continue;
      if (!isAdmin(me) && !modelAllowed(me, id)) continue; // 视野外模型：面板本就看不见，带了也跳过
      const g = {};
      for (const k of ['image', 'videoPerSec', 'videoFlat']) {
        const n = Number(v[k]);
        if (isFinite(n) && n > 0) g[k] = round2(n);
      }
      clean[id] = g; // 空对象 = 授权·按全局价
    }
    if (Object.keys(clean).length) target.grants = clean;
    else if (isAdmin(me)) delete target.grants; // 管理员存空 = 恢复全部模型
    else target.grants = {}; // 代理存空 = 下级无可用模型（受限代理不能把下级放开成全部模型）
    logAct(me, '模型授权', `${target.name} → ${target.grants ? Object.keys(target.grants).join(',') || '（无可用模型）' : '全部模型'}`);
    save(); return [200, pubUser(target)];
  }

  if (M === 'POST' && p === '/api/key/status') {
    const { u } = userByKey(String(body.key || ''));
    if (!u || !isAdmin(me) && me.id !== u.id) throw httpErr(403, '无权操作');
    const k = u.keys.find(x => x.key === body.key);
    if (!k) throw httpErr(404, '密钥不存在');
    k.status = body.status === 'active' ? 'active' : 'disabled'; save();
    return [200, { ok: true }];
  }

  // ---- 任务 ----
  const jc = p.match(/^\/api\/job\/([0-9a-f]+)\/cancel$/);
  if (jc && M === 'POST') { // 管理员强制取消（含卡死任务）；本人只能撤自己还在排队的
    const j = S.jobs.find(x => x.id === jc[1]);
    if (!j) throw httpErr(404, '任务不存在');
    if (!isAdmin(me) && j.user !== me.id) throw httpErr(403, '仅管理员可取消他人任务');
    if (!isAdmin(me) && j.status !== 'queued') throw httpErr(403, '运行中的任务只有管理员能强制取消');
    if (j.status !== 'queued' && j.status !== 'running') throw httpErr(400, `任务已 ${j.status}，无需取消`);
    if (j.status === 'running') { // 立即归还坑位，别让下一个任务陪僵尸轮询干等
      const chR = S.channels.find(c => c.id === j.channel);
      releaseSlot(j, chR && chR.accounts.find(a => a.id === j.accId));
    }
    j.status = 'cancelled'; j.note = null; j.error = null; cleanupJobRefs(j); save();
    logAct(me, '取消任务', `${j.id} ${j.kind} ${j.model}（${j.userName}）`);
    return [200, { ok: true, status: 'cancelled' }];
  }
  const jr = p.match(/^\/api\/job\/([0-9a-f]+)\/retry$/);
  if (jr && M === 'POST') { // 一键重试：按原任务参数重开一单，走完整提交流程（授权/定价/余额重新校验）
    const j = S.jobs.find(x => x.id === jr[1]);
    if (!j) throw httpErr(404, '任务不存在');
    if (!isAdmin(me) && j.user !== me.id) throw httpErr(403, '只能重试自己的任务');
    if (j.status !== 'failed' && j.status !== 'cancelled') throw httpErr(400, `任务已 ${j.status}，只有失败/已取消任务能重试`);
    const u = S.users.find(x => x.id === j.user);
    if (!u || u.status !== 'active') throw httpErr(400, '任务所属账号已停用/删除，无法重试');
    // 本地参考素材（垫图/视频/音频）已被回收 → 拒绝：悄悄丢素材重生成=结果和原意图不符，
    // 宁可让人回创作台重提。优先用 refFiles（含媒体素材的全量本地文件清单）
    const o = j.opts || {};
    const locals = Array.isArray(j.refFiles) && j.refFiles.length ? j.refFiles
      : [].concat(o.ref || []).filter(r => { const s = String(r || ''); return s && !/^\d+$/.test(s) && !/^https?:\/\//i.test(s); });
    if (locals.some(f => !fs.existsSync(f))) throw httpErr(400, '参考素材已过保留期（失败任务素材留 48 小时），请回创作台重新提交');
    const body2 = { model: j.model, prompt: j.prompt, ref: o.ref || [], ar: o.ar, res: o.res || (j.billing && j.billing.res),
      dur: o.dur, audio: o.audio, samples: o.samples, no_prefix: o['no-prefix'],
      refVideos: (o.refVideoUrls || []), refAudios: (o.refAudioUrls || []) }; // 视频/音频参考随重试重开不丢
    const j2 = j.kind === 'image' ? await submitImage(u, body2, req.headers.host) : await submitVideo(u, body2, req.headers.host);
    logAct(me, '重试任务', `${j.id} → ${j2.id} ${j.kind} ${j.model}（原失败: ${String(j.error || '').slice(0, 60)}）`);
    return [202, { id: j2.id, status: j2.status }];
  }
  if (M === 'GET' && p === '/api/jobs') {
    let list = archiveJobs().concat(S.jobs); // 热表 + 归档合并；归档按 mtime 增量懒加载，无感
    if (!isAdmin(me)) list = list.filter(x => x.user === me.id || (S.users.find(u => u.id === x.user) || {}).parent === me.id);
    if (q.user) list = list.filter(x => x.userName === q.user || x.user === q.user);
    if (q.status) list = list.filter(x => x.status === q.status);
    if (q.kind) list = list.filter(x => x.kind === q.kind);
    const full = q.full === '1'; // 创作台作品流要完整 prompt（仅 12 条，体积可控）；台账列表仍走裁剪
    return [200, list.slice(-Math.min(500, Number(q.limit) || 50)).reverse().map(j => jobView(j, me, !full))];
  }
  const jm = p.match(/^\/api\/job\/([0-9a-f]+)$/);
  if (M === 'GET' && jm) {
    const j = S.jobs.find(x => x.id === jm[1]);
    if (!j || (!isAdmin(me) && j.user !== me.id && (S.users.find(u => u.id === j.user) || {}).parent !== me.id))
      throw httpErr(404, '任务不存在');
    return [200, jobView(j, me)];
  }

  // ---- 创作台（会话即身份，与 /v1 同一条计费/分发管线）----
  if (M === 'GET' && p === '/api/models') {
    assertAnyChannel();
    const cat = q.catalog === '1' && me.role !== 'user'; // 目录：含未挂号渠道（授权编辑用）
    if (q.video) {
      const vids = (await allModels('video', cat)).filter(m => modelAllowed(me, m.id));
      return [200, { models: vids.map(m => { // channel 只给管理员；用户只见规格与价格
        const p = effPricing(me, m.id);
        const mode = p.mode === 'flat' || (p.mode == null && p.videoFlat != null) ? 'flat' : 'perSec';
        const o = { id: m.id, name: m.name, refUploadOnly: m.refUploadOnly === true,
          duration: m.duration, aspect_ratio: m.aspect_ratio, audio: !!m.audio, maxRef: m.maxRef ?? null,
          maxVideo: m.maxVideo || 0, maxAudio: m.maxAudio || 0, maxAudioSec: m.maxAudioSec || 0, // 槽位=能力规格，非渠道信息
          resolutions: m.resolutions || [], mode,
          priceFlat: (p.videoFlat) ?? null, pricePerSec: (p.videoPerSec) ?? null,
          priceRes: resPriceMap(p, m.resolutions, mode) };
        if (isAdmin(me)) o.channel = m.channel;
        return o; }) }];
    }
    const list = (await allModels('image', cat)).filter(m => modelAllowed(me, m.id));
    return [200, { models: list.map(({ channel, ...m }) => { const p = effPricing(me, m.id); // channel 只给管理员
      return { ...m, ...(isAdmin(me) ? { channel } : {}), price: p.image ?? 1, priceRes: p.imageRes || {} }; }) }];
  }
  if (M === 'POST' && p === '/api/studio/generate') {
    const j = body.kind === 'video' ? await submitVideo(me, body, req.headers.host) : await submitImage(me, body, req.headers.host);
    log(`[studio] ${me.name} → ${j.kind} ${j.model} (#${j.id})`);
    return [202, { id: j.id, status: j.status }];
  }
  throw httpErr(404, '不存在的接口: ' + p);
}

// ---------- 提交（/v1 与面板创作台共用；user 已通过各自鉴权） ----------
function assertAnyChannel() {
  if (!S.channels.some(c => c.enabled && c.accounts.some(a => a.enabled))) throw httpErr(503, '服务暂不可用，请稍后再试');
}
async function submitImage(user, body, reqHost) {
  assertAnyChannel();
  if (!body.prompt) throw httpErr(400, '参数错误: prompt 必填');
  const list = await allModels('image'); // 未知模型没有账号能接，会永远排队
  const model = String(body.model || 'gpt20').trim();
  let spec = list.find(m => m.id === model);
  const dispatchable = !!spec;
  if (!spec) spec = (await allModels('image', true).catch(() => [])).find(m => m.id === model)
    || (() => { throw httpErr(400, `未知模型 ${model} — ${list.map(m => m.id).join(' / ')}`); })();
  if (!modelAllowed(user, model)) throw httpErr(403, `无权使用模型 ${model}，请联系管理员/代理开通`);
  if (!dispatchable) throw httpErr(503, `模型 ${model} 暂不可用（服务未就绪），请稍后再试或联系管理员`);
  const samples = Math.max(1, Number(body.samples || body.n || 1));
  const res = String(body.resolution || body.res || '').toLowerCase() || undefined;
  const price = priceOf(model, 'image', { samples, res }, user);
  if ((user.balance || 0) < price) throw httpErr(402, `积分不足: 需 ${price}, 余额 ${round2(user.balance || 0)}`);
  const refs = await normalizeRefs(body);
  const opts = { model, ar: body.aspect_ratio || body.ar, res,
    samples, ref: refs.map(r => r.value),
    refUrls: refs.filter(r => r.kind !== 'id').map(r => r.kind === 'url' ? r.value : publicFileUrl(reqHost, r.value, spec.channel)),
    negative: body.negative, enhance: body.enhance, 'no-prefix': body.no_prefix === true };
  const chObj = S.channels.find(c => c.id === spec.channel);
  if (chObj && capsOf(CHANNEL_TYPES[chObj.type]).needsImageSize) opts.size = await pickSize(chObj, model, body); // 声明该能力的渠道要 WxH 尺寸
  const j = newJob(user, 'image', model, normRefs(body.prompt), refs.length, price);
  j.channel = spec.channel; j.opts = opts;
  j.refFiles = refs.filter(r => r.kind === 'file').map(r => r.value); // 全部本地素材（含重试复用的旧文件）都挂任务名下，终结统一清
  if (res) j.billing.res = res; // 组合计费凭据（哪档分辨率）
  save();
  logAct(user, '提交生图', `${model} ×${samples} 预估 ${price} 分${refs.length ? ` · 垫图×${refs.length}` : ''}`);
  return j;
}
async function submitVideo(user, body, reqHost) {
  assertAnyChannel();
  if (!body.prompt) throw httpErr(400, '参数错误: prompt 必填');
  const list = await allModels('video');
  let model = body.model != null ? String(body.model).trim() : '';
  if (!model) { // 不指定模型：取清单第一个可用模型
    model = (list[0] || {}).id;
    if (!model) throw httpErr(503, '无可用视频模型');
  }
  let spec = list.find(m => m.id === model);
  const dispatchable = !!spec;
  if (!spec) spec = (await allModels('video', true).catch(() => [])).find(m => m.id === model)
    || (() => { throw httpErr(400, `未知视频模型 ${model} — ${list.map(m => m.id).join(' / ')}`); })();
  if (!modelAllowed(user, model)) throw httpErr(403, `无权使用模型 ${model}，请联系管理员/代理开通`);
  if (!dispatchable) throw httpErr(503, `模型 ${model} 暂不可用（服务未就绪），请稍后再试或联系管理员`);
  const dur = snapDur(spec, Number(body.dur || body.duration || body.seconds || 5));
  const res = String(body.res || body.resolution || '').toLowerCase() || undefined;
  const price = priceOf(model, 'video', { dur, res }, user);
  if ((user.balance || 0) < price) throw httpErr(402, `积分不足: 需 ${price}, 余额 ${round2(user.balance || 0)}`);
  const refs = await normalizeRefs(body);
  const upOnly = spec.refUploadOnly === true; // 模型能力位：垫图只认上传/base64 素材（不认裸 URL）
  if (upOnly && refs.some(r => r.kind === 'url')) // 该模型垫图上游只认上传素材，提交时就拒
    throw httpErr(400, '该模型的垫图只支持 photo id / base64 / 上传文件，不支持裸图片 URL');
  // 视频/音频参考：先按清单槽位验数再落盘（拒绝的请求一个文件都不留），不支持/超槽都 400
  const rawCnt = (k) => [].concat(body[k] || []).filter(x => typeof x === 'string' && x.trim()).length;
  const nV = rawCnt('refVideos'), nA = rawCnt('refAudios');
  const maxV = spec.maxVideo || 0, maxA = spec.maxAudio || 0;
  if ((nV || nA) && !maxV && !maxA)
    throw httpErr(400, `模型 ${model} 不支持视频/音频参考`);
  if (nV > maxV || nA > maxA)
    throw httpErr(400, `模型 ${model} 参考上限：视频 ${maxV} / 音频 ${maxA}（当前 视频×${nV} 音频×${nA}）`);
  let vrefs = [], arefs = [];
  try { // 落盘途中失败（413 超大等）把已落的新文件回收，别留孤儿
    vrefs = await normalizeMedia(body, 'video');
    arefs = await normalizeMedia(body, 'audio');
    // 单段参考音频时长上限（部分上游限 15s）：超长上游建单后必挂，虽失败自动
    // 退款但用户白等十几分钟——提交时就 400；探测失败（null）放行，交上游兜底
    if (spec.maxAudioSec && arefs.length) {
      const { execFile: ef } = require('child_process');
      const durOf = (src) => new Promise((ok) => ef('ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src],
        { timeout: 30 * 1000 }, (e, out) => (e || !parseFloat(out) ? ok(null) : ok(parseFloat(out)))));
      for (const r of arefs) {
        const d = r.kind === 'url' ? null : await durOf(r.value); // URL 不下载预检，交给上游
        if (d != null && d > spec.maxAudioSec + 0.05)
          throw httpErr(400, `参考音频最长 ${spec.maxAudioSec} 秒（这段 ${d.toFixed(1)}s），请剪短后重传`);
      }
    }
  } catch (e) {
    [...vrefs, ...arefs].filter(r => r.fresh).forEach(r => { try { fs.rmSync(r.value, { force: true }); } catch {} });
    throw e;
  }
  const opts = { model, ar: body.ar || body.aspect_ratio, res,
    dur, audio: body.audio !== undefined ? !!body.audio : spec.audio === true, ref: refs.map(r => r.value), host: reqHost,
    refUrls: upOnly ? [] : refs.filter(r => r.kind !== 'id').map(r => r.kind === 'url' ? r.value : publicFileUrl(reqHost, r.value, spec.channel)),
    refVideoUrls: vrefs.map(r => r.kind === 'url' ? r.value : publicFileUrl(reqHost, r.value, spec.channel)),
    refAudioUrls: arefs.map(r => r.kind === 'url' ? r.value : publicFileUrl(reqHost, r.value, spec.channel)),
    'no-prefix': body.no_prefix === true };
  const j = newJob(user, 'video', model, normRefs(body.prompt), refs.length + vrefs.length + arefs.length, price);
  j.channel = spec.channel; j.opts = opts;
  j.refFiles = [...refs, ...vrefs, ...arefs].filter(r => r.kind === 'file').map(r => r.value); // 全部本地素材（含重试复用的旧文件）都挂任务名下，终结统一清
  if (res) j.billing.res = res; // 组合计费凭据（哪档分辨率）
  save();
  const parts = [['垫图', refs.length], ['视频', vrefs.length], ['音频', arefs.length]].filter(([, n]) => n).map(([k, n]) => ` · ${k}×${n}`).join('');
  logAct(user, '提交生视频', `${model} ${dur}s 预估 ${price} 分${parts}`);
  return j;
}

// ---------- public api (/v1/*) ----------
async function v1Route(req, res, body, query) {
  const p = req.url.split('?')[0];
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const { u: user, k: key } = userByKey(auth);
  if (!user) throw httpErr(401, '无效 API key');
  if (user.status !== 'active' || !key || key.status !== 'active') throw httpErr(403, '密钥或账号已停用');
  assertAnyChannel();

  if (req.method === 'GET' && p === '/v1/models') { // 统一模型清单（不带渠道细节）
    // 渠道/成本绝不外漏；只列该 key 用户被授权的模型
    if (query.video === '1') {
      const vids = (await allModels('video')).filter(m => modelAllowed(user, m.id));
      return [200, { models: vids.map(({ channel, upstream_cost, ...m }) => {
        const p = effPricing(user, m.id);
        const mode = p.mode === 'flat' || (p.mode == null && p.videoFlat != null) ? 'flat' : 'perSec';
        return { id: m.id, name: m.name, reference: true, duration: m.duration, aspect_ratio: m.aspect_ratio,
          audio: !!m.audio, maxRef: m.maxRef, refUploadOnly: m.refUploadOnly === true,
          maxVideo: m.maxVideo || 0, maxAudio: m.maxAudio || 0, maxAudioSec: m.maxAudioSec || 0,
          resolutions: m.resolutions || [], mode,
          priceFlat: p.videoFlat ?? null, pricePerSec: p.videoPerSec ?? null,
          priceRes: resPriceMap(p, m.resolutions, mode) };
      }) }];
    }
    return [200, { models: (await allModels('image')).filter(m => modelAllowed(user, m.id))
      .map(({ channel, upstream_cost, credit_cost, ...m }) => { const p = effPricing(user, m.id);
        return { ...m, price: p.image ?? 1, priceRes: p.imageRes || {} }; }) }];
  }

  const gm = p.match(/^\/v1\/(images|videos)\/([0-9a-f]+)$/);
  if (req.method === 'GET' && gm) {
    const j = S.jobs.find(x => x.id === gm[2] && x.user === user.id && x.kind === (gm[1] === 'images' ? 'image' : 'video'));
    if (!j) throw httpErr(404, '任务不存在');
    return [200, jobView(j, user)];
  }

  if (req.method === 'POST' && p === '/v1/images/generations') {
    const j = await submitImage(user, body, req.headers.host);
    if (!/^(1|true|yes)$/i.test(query.wait || '')) return [202, { id: j.id, status: j.status }];
    await new Promise(r => { j._wake = r; if (j.status === 'done' || j.status === 'failed') j._wake(); });
    return [200, jobView(j, user)];
  }

  if (req.method === 'POST' && p === '/v1/videos/generations') {
    const j = await submitVideo(user, body, req.headers.host);
    return [202, { id: j.id, status: j.status }];
  }
  throw httpErr(404, '不存在的接口: ' + p);
}

// ---------- static (web/) ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const _gzCache = new Map(); // 静态文件压缩缓存：`${file}:${mtime}` → gzip Buffer（改文件 mtime 变即自动失效）
function serveStatic(res, p, req) {
  if (p.startsWith('/uploads/')) { // 上传垫图公网托管（渠道上游要拉取参考图）
    const full = path.join(UPLOADS, path.basename(p));
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      const buf = fs.readFileSync(full);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
        'Content-Length': buf.length, 'Cache-Control': 'public, max-age=3600' });
      res.end(buf); return true;
    }
  }
  if (p.startsWith('/results/')) { // 平台交付的本地超分成片（流式 + Range，视频拖进度条要）
    const full = path.join(RESULTS, path.basename(p));
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      const size = fs.statSync(full).size, range = req.headers.range;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        const start = m && m[1] ? +m[1] : 0, end = m && m[2] ? Math.min(+m[2], size - 1) : size - 1;
        if (start <= end) {
          res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${size}`,
            'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'public, max-age=86400' });
          fs.createReadStream(full, { start, end }).pipe(res); return true;
        }
      }
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': size, 'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=86400' });
      fs.createReadStream(full).pipe(res); return true;
    }
  }
  const file = p === '/' ? 'index.html' : p.slice(1);
  const full = path.join(ROOT, 'web', path.normalize(file).replace(/^(\.\.[\/\\])+/, ''));
  if (!full.startsWith(path.join(ROOT, 'web')) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return false;
  let buf = fs.readFileSync(full);
  // CDN（Cloudflare）会把 JS/CSS 按扩展名缓存数小时并改写 cache-control，源站的 no-cache 拦不住——
  // 2026-09-13 实锤：改完前端用户 4 小时看不到。对策：HTML（不被 CDN 缓存）引用带 mtime 指纹
  // 的 ?v=，文件一改 URL 即变，浏览器必然拉新；带 v 的资源直接 immutable 长缓存，CDN 变加速器
  const versioned = /[?&]v=/.test(req.url);
  if (file === 'index.html') {
    const v = (f) => fs.statSync(path.join(ROOT, 'web', f)).mtimeMs.toString(36);
    buf = Buffer.from(buf.toString('utf8').replace(/(app\.js|style\.css)(?=")/g, (m) => `${m}?v=${v(m)}`));
  }
  // 文本资源 gzip（2026-09-18 流畅性优化）：app.js 未压缩 122KB，弱网首屏光下载脚本就 1s+。
  // html/css/js/svg 才压；按 mtime 键缓存压缩结果（同 mtime 复用，改文件自然失效），immu-
  // table 缓存 + CDN 只认 URL，内容编码协商对它们无感。图片/视频直出，>8MB 不压（也压不动多少）
  const headers = { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Content-Length': buf.length,
    'Cache-Control': (versioned ? 'public, max-age=31536000, immutable' : 'no-cache') };
  const textMime = /\.(html|css|js|svg)$/.test(full);
  const wantsGz = /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));
  if (textMime && wantsGz && buf.length < 8 * 1024 * 1024) {
    const key = `${full}:${fs.statSync(full).mtimeMs}`;
    let gz = _gzCache.get(key);
    if (!gz) { gz = gzOf(req, buf); if (gz) { if (_gzCache.size > 32) _gzCache.clear(); _gzCache.set(key, gz); } }
    if (gz) { headers['Content-Encoding'] = 'gzip'; headers['Vary'] = 'Accept-Encoding'; headers['Content-Length'] = gz.length; res.writeHead(200, headers); res.end(gz); return true; }
  }
  res.writeHead(200, headers);
  res.end(buf);
  return true;
}

const server = http.createServer((req, res) => {
  // 超限不再掐连接（掐了客户端只见网络错误、服务端零日志零任务零扣分——曾有大素材上传
  // “不扣分也不动”即此）：改为丢弃后续分块但把 body 收完，回 413 让用户看到真实原因
  const chunks = [];
  let recLen = 0, over = false;
  req.on('data', c => { if (over) return; chunks.push(c); if ((recLen += c.length) > BODY_LIMIT) { over = true; chunks.length = 0; } });
  req.on('error', () => {});
  req.on('end', async () => {
    let body = {};
    const p = req.url.split('?')[0];
    try {
      if (over) throw httpErr(413, '素材总量超上限：垫图+参考视频 base64 打包后超 64MB，请删减素材或压缩参考视频后重试');
      if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const me = sessionUser(req);
      if (me) touchSession(req, res); // 滑动续期（剩余不足半程才写盘）
      if (p.startsWith('/api/')) {
        const [code, out] = await apiRoute(req, res, body, me);
        return jres(req, res, code, out);
      }
      if (p.startsWith('/v1/')) {
        const q = Object.fromEntries(new URLSearchParams(req.url.split('?')[1] || ''));
        const [code, out] = await v1Route(req, res, body, q);
        return jres(req, res, code, out);
      }
      if (req.method === 'GET' && (serveStatic(res, p, req) || p === '/health')) {
        if (p === '/health') return jres(req, res, 200, { ok: true, service: 'waline', uptime: process.uptime() | 0 });
        return;
      }
      throw httpErr(404, 'Not Found');
    } catch (e) {
      return jres(req, res, e.code || 500, e.code ? { error: e.message } : { error: '内部错误: ' + e.message });
    } finally {
      log(req.method, p, res.statusCode);
    }
  });
});
server.requestTimeout = 30 * 60 * 1000; // 弱网上行传 20MB+ 垫图可能超 10 分钟，被掐同样零痕迹（2026-09-21）
server.headersTimeout = 15 * 1000;

server.listen(PORT, '0.0.0.0', () => log(`walinen listening on 0.0.0.0:${PORT}`));
process.on('SIGTERM', () => { try { if (_dirty) flushState(); } catch {} server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000); });
