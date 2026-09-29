'use strict';
/* WaLineN 面板 —— 零框架 SPA：hash 路由 + 视图渲染，咖啡拿铁×动漫风 / 侧边栏布局。角色：admin / agent / user */
const $ = (s, el) => (el || document).querySelector(s);
const app = $('#app');
let ME = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtT = (ts) => new Date(ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); // 平台统一北京时间
const stChip = (s) => `<span class="st-${esc(s)}"><i class="dot"></i>${esc(s)}</span>`;
const n2 = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString();

async function api(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}
function toast(msg, ms = 2200) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
const confirmDel = (what) => confirm(`确认删除 ${what}？此操作不可撤销。`);
async function copyText(t) { // 剪贴板；http 非安全上下文降级 execCommand
  try { await navigator.clipboard.writeText(t); toast('已复制到剪贴板'); return; } catch {}
  const ta = document.createElement('textarea');
  ta.value = t; ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select();
  const ok = document.execCommand('copy'); ta.remove();
  toast(ok ? '已复制到剪贴板' : '复制失败，请手动选择复制');
}
const docCard = (title, code, hint = '') => `
  <div class="doc-card">
    <div class="doc-head"><span class="doc-title">${esc(title)}</span>
      <button class="btn mini" data-copy>复制</button></div>
    ${hint ? `<div class="doc-hint">${esc(hint)}</div>` : ''}
    <pre class="docs">${esc(code)}</pre>
  </div>`;

/* ---------- 品牌 ---------- */
const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C08552"/><stop offset="1" stop-color="#8B5E34"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#lg)"/><path d="M6 20c3-6 6-6 9 0s6 6 9 0" stroke="#FBF3E4" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>`;
const I = {
  studio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/></svg>',
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
  channel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17.5l9 5 9-5"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M3.5 20c.6-3.3 2.9-5 5.5-5s4.9 1.7 5.5 5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16.5 15.3c2.3.3 3.8 1.9 4.3 4.7"/></svg>',
  pricing: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M20.6 13.4L12 4.8H4v8l8.6 8.6a2 2 0 0 0 2.8 0l5.2-5.2a2 2 0 0 0 0-2.8z"/><circle cx="7.5" cy="7.5" r="1" fill="currentColor" stroke="none"/></svg>',
  jobs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  logs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9.5 12h5M9.5 16h5"/></svg>',
  me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4.5 21c.8-4 4-6.2 7.5-6.2s6.7 2.2 7.5 6.2"/></svg>',
  caret: '<svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  topup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8z"/><path d="M14 7v10" stroke-dasharray="2 2.4" stroke-linecap="round"/></svg>',
};

/* ---------- 登录 ---------- */
function viewLogin() {
  app.innerHTML = `
  <div class="login-bg"><div class="login-panel">
    <div class="login-brand">${LOGO}<h1>Wa<em>Line</em></h1><p>渠道管理与模型分发系统</p></div>
    <form class="card login-card" id="lf">
      <div class="field"><label>账户</label><input name="name" autocomplete="username" required></div>
      <div class="field"><label>密码</label><input name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn pri" type="submit">登 录</button>
      <div class="err" id="lerr"></div>
    </form>
  </div></div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const j = await api('POST', '/api/login', { name: f.get('name'), password: f.get('password') });
      ME = await api('GET', '/api/me');
      location.hash = j.role === 'admin' ? '#/overview' : j.role === 'agent' ? '#/users' : '#/studio';
      render();
    } catch (err) { $('#lerr').textContent = err.message; }
  };
}

/* ---------- 框架 ---------- */
const NAV = [
  ['studio', '创作', 'any', I.studio],
  ['overview', '概览', 'admin', I.overview], ['channel', '渠道', 'admin', I.channel], ['users', '用户', 'staff', I.users],
  ['pricing', '定价', 'admin', I.pricing], ['topup', '充值', 'admin', I.topup], ['jobs', '任务', 'any', I.jobs],
  ['logs', '日志', 'admin', I.logs, [['logs/act', '操作日志'], ['logs/credit', '积分流水']]],
  ['me', '个人中心', 'any', I.me],
];
function shell(active, html, cls = '') {
  const nav = NAV.filter(([, , r]) => r === 'any' || (r === 'staff' && ME.role !== 'user') || ME.role === r)
    .map(([id, label, , icon, subs]) => {
      const on = active === id || active.startsWith(id + '/');
      if (!subs) return `<a href="#/${id}" class="${on ? 'on' : ''}">${icon}<span>${label}</span></a>`;
      // 分组项：子项常驻展开（不折叠不悬停，看见即可直接点）
      return `<div class="grp"><a href="#/${subs[0][0]}" title="${label}">${icon}<span>${label}</span></a>
        <div class="sub">${subs.map(([sid, sl]) => `<a href="#/${sid}" class="${active === sid ? 'on' : ''}">${sl}</a>`).join('')}</div></div>`;
    }).join('');
  app.innerHTML = `
  <div class="layout">
    <aside class="side">
      <div class="brand">${LOGO}<span class="w">Wa<em>Line</em></span></div>
      <nav class="side-nav">${nav}</nav>
      <div class="side-foot">
        <div class="who"><b>${esc(ME.name)}</b><span class="tag">${esc(ME.role)}</span></div>
        <div class="bal">余额 <b id="sbal">${n2(ME.balance)}</b> 积分 · <a href="#/me" class="bal-link">充值</a></div>
        <button class="btn mini" id="out">退出</button>
      </div>
    </aside>
    <div class="main"><div class="wrap ${cls}">${html}</div></div>
  </div>`;
  $('#out').onclick = async (e) => { e.preventDefault(); await api('POST', '/api/logout'); ME = null; render(); };
}
const sec = (no, title, sub, inner) => `
  <section class="sec"><div class="sec-head"><h2>${String(title).replace(/([一-鿿]) +(?=[一-鿿])/g, '$1')}</h2><div class="sub">${sub}</div></div>${inner}</section>`;

/* ---------- 概览 ---------- */
async function viewOverview() {
  const d = await api('GET', '/api/overview');
  shell('overview', `
    <div class="page-title">概览<span class="right">${d.channels.filter(c => c.enabled).length}/${d.channels.length} 渠道在线 · 快照 ${fmtT(Date.now())}</span></div>
    <div class="page-desc">用户、密钥与 24 小时任务流水 · 各渠道健康 · 点结果列缩略图可预览 / 下载</div>
    <div class="cards">
      <div class="card"><div class="k">用户</div><div class="v">${d.users} <small>人 · 代理 ${d.agents}</small></div></div>
      <div class="card"><div class="k">在发密钥</div><div class="v">${d.keys}</div></div>
      <div class="card"><div class="k">24H 任务</div><div class="v">${d.jobs24h} <small>成 ${d.done24h}</small></div></div>
      <div class="card"><div class="k">24H 计费</div><div class="v acc">${n2(d.billed24h)}<small> 积分</small></div></div>
      <div class="card"><div class="k">在兑积分余额</div><div class="v">${n2(d.balanceIssued)}</div></div>
    </div>
    <div class="panel">
      <h3>♻️ 失败自动重试<span class="hint">— 瞬态/上游类失败自动重跑 · 审核类拒绝不计次</span><span class="sp"></span></h3>
      <div style="padding:0 0 8px">任务失败后自动重试
        <input id="arN" type="number" min="0" max="10" value="${d.autoRetry}" style="width:60px"> 次
        <button class="btn mini" id="arSave">保存</button>
        <span class="muted">0=关闭（当前 ${d.autoRetry}）· 间隔 15s→30s→60s… 递增，重新分发可换账号</span></div>
    </div>
    <div class="panel">
      <h3>💾 成片转存保留<span class="hint">— 渠道成片转存本机 /results/ 后的保留期</span><span class="sp"></span></h3>
      <div style="padding:0 0 8px">转存成片保留
        <input id="rtN" type="number" min="1" max="30" value="${d.resultsRetention}" style="width:60px"> 天
        <button class="btn mini" id="rtSave">保存</button>
        <span class="muted">1-30 天（当前 ${d.resultsRetention}）· 到期每日自动清理；调短保存会立即清一轮</span></div>
    </div>
    <div class="panel">
      <h3>🗂️ 渠道健康<span class="hint">— 账号可用性与包量模式</span><span class="sp"></span>
        <a class="btn mini" href="#/channel">渠道管理 →</a></h3>
      <div class="tscroll slim"><table class="idx"><tr><th>渠道</th><th>状态</th><th>账号</th><th>unlimited 模式</th><th></th></tr>
      ${d.channels.map(c => `<tr><td><b>${esc(c.name)}</b> <span class="muted mono">${esc(c.id)}</span></td>
        <td>${stChip(c.enabled ? 'active' : 'off')}</td><td class="num">${c.up}/${c.accounts} 可用</td>
        <td class="num">${c.unlimited}</td><td><a class="btn mini" href="#/channel">管理 →</a></td></tr>`).join('')}
      </table></div>
    </div>
    <div class="panel">
      <h3>🎬 最近任务<span class="hint">— 全平台最新 8 条 · 点缩略图预览</span><span class="sp"></span>
        <a class="btn mini" href="#/jobs">任务台账 →</a></h3>
      ${jobsTable(d.recent, false, true)}
    </div>`);
  bindResultActs(d.recent);
  bindRetry(viewOverview);
  const arS = document.getElementById('arSave');
  if (arS) arS.onclick = async () => {
    const n = Math.max(0, Math.min(10, Number(document.getElementById('arN').value) || 0));
    await api('POST', '/api/autoretry', { n });
    viewOverview();
  };
  const rtS = document.getElementById('rtSave');
  if (rtS) rtS.onclick = async () => {
    const days = Math.max(1, Math.min(30, Number(document.getElementById('rtN').value) || 7));
    await api('POST', '/api/retention', { days });
    viewOverview();
  };
}

/* ---------- 渠道（多渠道：适配器统一契约，账号/设置面板逐渠道渲染） ---------- */
/* 渠道设置表单字段与能力说明不在前端硬编码 —— 由各适配器自描述
   （NAME / DESC / KEY_LABEL / SETTINGS_FIELDS / CAPS），经 /api/channels 的
   meta 字段下发，前端按 meta 渲染；新增渠道前端零改动。 */
const CH_F = { ch: 'all', st: 'all', q: '' }; // 账号列表筛选（跨渲染记忆；纯前端筛行，不打接口）
const CH_SEL = { add: '', set: '' }; // 添加账号 / 渠道设置两个面板各自选中的渠道
const CH_T = { timer: 0 }; // 渠道页轮询句柄（切页/重渲即停）

async function viewChannel() {
  if (CH_T.timer) { clearInterval(CH_T.timer); CH_T.timer = 0; }
  let [chs, ms, vs] = await Promise.all([
    api('GET', '/api/channels'),
    api('GET', '/api/models?catalog=1').catch(() => ({ models: [] })),
    api('GET', '/api/models?video=1&catalog=1').catch(() => ({ models: [] })),
  ]);
  const mCnt = {}, vCnt = {}; // 渠道 → 图片 / 视频模型数（目录口径，含未挂号渠道）
  for (const m of ms.models || []) mCnt[m.channel] = (mCnt[m.channel] || 0) + 1;
  for (const m of vs.models || []) vCnt[m.channel] = (vCnt[m.channel] || 0) + 1;
  const chStat = (ch) => { // 单渠道聚合：可用 / 占用 / 已服务
    let up = 0, ifi = 0, ifv = 0, served = 0;
    for (const a of ch.accounts) {
      if (a.enabled) up++;
      ifi += a.inFlight.image || 0; ifv += a.inFlight.video || 0;
      served += (a.stats.image || 0) + (a.stats.video || 0);
    }
    return { up, ifi, ifv, served };
  };
  const mkTot = () => chs.reduce((t, ch) => {
    const s = chStat(ch);
    t.acc += ch.accounts.length; t.up += s.up; t.ifi += s.ifi; t.ifv += s.ifv; t.served += s.served;
    return t;
  }, { acc: 0, up: 0, ifi: 0, ifv: 0, served: 0 });
  let tot = mkTot();
  const imgN = Object.values(mCnt).reduce((s, x) => s + x, 0);
  const vidN = Object.values(vCnt).reduce((s, x) => s + x, 0);
  // 面板选中渠道 / 筛选条件兜底（渠道变动后不失配）
  if (!chs.some(c => c.id === CH_SEL.add)) CH_SEL.add = chs[0] ? chs[0].id : '';
  if (!chs.some(c => c.id === CH_SEL.set)) CH_SEL.set = chs[0] ? chs[0].id : '';
  if (CH_F.ch !== 'all' && !chs.some(c => c.id === CH_F.ch)) CH_F.ch = 'all';
  const capTags = (id) => `${mCnt[id] ? '<span class="tag">生图</span>' : ''}${vCnt[id] ? '<span class="tag acc">视频</span>' : ''}` || '<span class="muted">—</span>';
  const chOpts = (cur, kind) => chs.map(c => `<option value="${esc(c.id)}"${c.id === cur ? ' selected' : ''}>${esc(c.name)}${kind ? `（${esc((c.meta && c.meta.keyLabel) || 'API Key')}）` : ''}</option>`).join('');

  // 渠道状态面板：一渠道一行，启停渠道；点「账号」列数字筛下方账号列表
  const ovRows = () => chs.map(c => { const s = chStat(c); return `<tr>
    <td><b>${esc(c.name)}</b> <span class="muted mono" style="font-size:11px">${esc(c.id)}</span></td>
    <td>${capTags(c.id)}</td>
    <td>${stChip(c.enabled ? 'active' : 'off')}</td>
    <td class="num"><button class="linkish" data-jump="${esc(c.id)}" title="点击筛选下方账号列表">${s.up}/${c.accounts.length}</button> <span class="muted">可用</span></td>
    <td class="num">${mCnt[c.id] || 0} <span class="muted">图</span> · ${vCnt[c.id] || 0} <span class="muted">视</span></td>
    <td class="num">${s.ifi}图 / ${s.ifv}视</td>
    <td class="num">${s.served}</td>
    <td style="white-space:nowrap"><button class="btn mini" data-cht="${esc(c.id)}">${c.enabled ? '停用渠道' : '启用渠道'}</button></td></tr>`; }).join('');

  // 账号列表面板：全部渠道一表，渠道 / 状态 / 关键词纯前端筛（轮询重画行，模型/表单面板不动）
  const chkAgo = (a) => a.lastCheck ? `上游体检于 ${Math.max(1, Math.round((Date.now() - a.lastCheck) / 60000))} 分钟前（每 10 分钟自动体检）` : '';
  const accRows = () => chs.flatMap(ch => ch.accounts.map(a => `
    <tr data-ch="${esc(ch.id)}" data-st="${a.enabled ? 'on' : 'off'}">
      <td><span class="tag acc">${esc(ch.name)}</span></td>
      <td><b>${esc(a.label)}</b><br><span class="muted mono" style="font-size:11px">${esc(a.token)}</span></td>
      <td>${esc(a.info.plan || '-')}<br><span class="muted">${a.info.tokenExpires ? '至 ' + esc(a.info.tokenExpires.slice(0, 10)) : (a.info.note ? esc(a.info.note.slice(0, 18)) : '长期')}</span></td>
      <td class="num"${a.info.credits != null && a.lastCheck ? ` title="${chkAgo(a)}"` : ''}>${a.info.credits == null ? '<span class="muted">上游计</span>' : n2(a.info.credits)}</td>
      <td>${ch.meta && ch.meta.caps && ch.meta.caps.dualMode ? `<span class="tag ${a.mode === 'unlimited' ? 'acc' : ''}">${esc(a.mode)}</span>
        ${a.creditFallback === undefined ? '<span class="tag">兜底·随渠道</span>' : `<span class="tag ${a.creditFallback ? 'gd' : ''}">兜底·${a.creditFallback ? '开' : '关'}</span>`}<br>
        ${(a.info.unlimited || []).length ? `<span class="tag gd" title="${esc((a.info.unlimited || []).join('、'))}">包量 ${(a.info.unlimited || []).length} 模型</span>` : '<span class="muted">按量</span>'}` : '<span class="tag">按条计费</span>'}</td>
      <td>${stChip(a.enabled ? 'active' : 'disabled')}</td>
      <td class="num">${a.inFlight.image || 0}图 / ${a.inFlight.video || 0}视</td>
      <td class="num">${(a.stats.image || 0) + (a.stats.video || 0)}</td>
      <td style="white-space:nowrap">
        <button class="btn mini" data-act="check" data-ch="${ch.id}" data-id="${a.id}" title="立即向上游查积分 / 包量清单">${a.lastCheck ? '复检' : '体检'}</button>
        ${ch.meta && ch.meta.caps && ch.meta.caps.dualMode ? `<button class="btn mini" data-act="mode" data-ch="${ch.id}" data-id="${a.id}">${a.mode === 'unlimited' ? '转积分' : '转包量'}</button>
        <button class="btn mini" data-act="fb" data-ch="${ch.id}" data-id="${a.id}">兜底</button>` : ''}
        <button class="btn mini" data-act="toggle" data-ch="${ch.id}" data-id="${a.id}">${a.enabled ? '停用' : '启用'}</button>
        <button class="btn mini" data-act="del" data-ch="${ch.id}" data-id="${a.id}" style="border-color:var(--danger);color:var(--danger)">删除</button>
      </td></tr>`)).join('');

  // 渠道设置面板：渠道下拉换字段（只重画本面板，其他面板的编辑态不受影响）
  const sfFields = (chId) => {
    const ch = chs.find(c => c.id === chId);
    if (!ch) return '<span class="muted">暂无渠道</span>';
    return Object.entries((ch.meta && ch.meta.fields) || {}).map(([k, [label, type]]) => {
      const v = ch.settings[k];
      if (type === 'check') return `<div class="field" style="justify-content:flex-end"><label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" name="${k}" style="width:auto" ${v !== false ? 'checked' : ''}> ${label}</label></div>`;
      const val = Array.isArray(v) ? v.join(',') : (v ?? '');
      return `<div class="field"><label>${label}</label><input name="${k}" type="${type === 'number' ? 'number' : 'text'}" value="${esc(val)}" ${type === 'number' ? 'min="1"' : ''}></div>`;
    }).join('');
  };

  const cardsHTML = () => `
      <div class="card"><div class="k">挂载账号</div><div class="v ${tot.up ? 'ok' : 'warn'}">${tot.up} <small>可用 / 共 ${tot.acc}</small></div></div>
      <div class="card"><div class="k">生成中占用</div><div class="v ${tot.ifi + tot.ifv ? 'warn' : 'dim'}">${tot.ifi}<small>图</small> / ${tot.ifv}<small>视</small></div></div>
      <div class="card"><div class="k">累计服务</div><div class="v">${tot.served}<small> 次</small></div></div>
      <div class="card"><div class="k">图片模型</div><div class="v acc">${imgN}</div></div>
      <div class="card"><div class="k">视频模型</div><div class="v acc">${vidN}</div></div>`;
  shell('channel', `
    <div class="page-title">渠道管理<span class="right"><button class="btn mini" id="chmref" title="重拉各渠道最新模型清单：新模型自动播价上架、下架的自动清理（每 10 分钟也会自动刷新一次）">↻ 刷新模型目录</button> <span id="chpr">${chs.filter(c => c.enabled).length}/${chs.length} 启用 · ${tot.acc} 账号</span></span></div>
    <div class="page-desc">上游渠道与账号池 · 按渠道分流生图 / 生视频 · 账号级并发、模式与体检管理</div>
    <div class="cards" id="chcards">${cardsHTML()}</div>
    <div class="panel">
      <h3>🗂️ 渠道状态<span class="hint">— 能力与实时占用</span><span class="sp"></span><span class="hint">点「账号」列数字可筛下方列表</span></h3>
      <div class="tscroll"><table class="idx" id="chov"><tr><th>渠道</th><th>能力</th><th>状态</th><th>账号</th><th>模型</th><th>占用</th><th>已服务</th><th>操作</th></tr>${ovRows()}</table></div>
    </div>
    <div class="panel" id="accpanel">
      <h3>🗃️ 账号列表<span class="hint" id="acchint">— ${tot.up}/${tot.acc} 可用 · 8 秒自动刷新</span><span class="sp"></span>
        <input id="chq" placeholder="🔍 搜账号 / 密钥…" style="width:168px" value="${esc(CH_F.q)}">
        <select id="chst" style="width:92px"><option value="all">全部状态</option><option value="on"${CH_F.st === 'on' ? ' selected' : ''}>启用</option><option value="off"${CH_F.st === 'off' ? ' selected' : ''}>停用</option></select>
        <select id="chch" style="width:118px"><option value="all">全部渠道</option>${chs.map(c => `<option value="${esc(c.id)}"${CH_F.ch === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></h3>
      <div class="tscroll"><table class="idx" id="acctbl"><tr><th>渠道</th><th>账号</th><th>套餐</th><th>积分</th><th>模式 / 计费</th><th>状态</th><th>占用</th><th>已服务</th><th>操作</th></tr>
        ${accRows() || `<tr><td colspan="9" class="empty">尚无账号 —— 下方「添加账号」挂第一个</td></tr>`}</table></div>
      <div class="hint" id="accnt" style="margin-top:8px"></div>
    </div>
    <div class="panel">
      <h3>➕ 添加账号<span class="sp"></span><span class="hint">入库前实时体检：验密钥真伪并读取上游账号信息</span></h3>
      <form id="af">
        <div class="toolbar">
          <div class="field"><label>渠道</label><select id="afch">${chOpts(CH_SEL.add, true)}</select></div>
          <div class="field"><label>标注 / Label</label><input name="label" placeholder="如 主号-PLUS" style="width:180px"></div>
          <span id="af-dual" style="display:flex;gap:10px">
            <div class="field"><label>使用模式</label><select name="mode"><option value="unlimited">unlimited 包量</option><option value="credits">credits 积分</option></select></div>
            <div class="field"><label>credits 兜底</label><select name="fb"><option value="">跟随渠道</option><option value="1">开</option><option value="0">关</option></select></div>
          </span>
        </div>
        <div class="field" style="margin-top:12px"><label>密钥（按所选渠道的要求粘贴 API Key / Token）</label>
          <textarea name="token" rows="2" style="width:100%" required></textarea></div>
        <div class="toolbar" style="margin-top:12px"><button class="btn pri" type="submit">体检并入库</button></div>
        <div class="err" id="aerr" style="text-align:left"></div>
      </form>
    </div>
    <div class="panel">
      <h3>⚙️ 渠道设置<span class="sp"></span>
        <div class="field"><label>渠道</label><select id="sfch">${chOpts(CH_SEL.set)}</select></div></h3>
      <p class="hint" id="sfdesc" style="margin:-2px 0 12px"></p>
      <form id="sf">
        <div class="row" id="sfbody"></div>
        <div class="toolbar" style="margin-top:14px">
          <button class="btn pri" type="submit">保存设置</button>
          <button class="btn" type="button" id="sftoggle"></button>
        </div>
      </form>
    </div>`);

  // —— 绑定 ——
  const applyF = () => { // 账号列表筛选：只隐行不重渲，表单编辑态不丢
    const q = CH_F.q.trim().toLowerCase();
    let hit = 0;
    app.querySelectorAll('#acctbl tr[data-ch]').forEach(tr => {
      const ok = (CH_F.ch === 'all' || tr.dataset.ch === CH_F.ch)
        && (CH_F.st === 'all' || tr.dataset.st === CH_F.st)
        && (!q || tr.textContent.toLowerCase().includes(q));
      tr.style.display = ok ? '' : 'none';
      if (ok) hit++;
    });
    $('#accnt').textContent = tot.acc ? `显示 ${hit} / ${tot.acc} 个账号` : '';
  };
  $('#chq').oninput = (e) => { CH_F.q = e.target.value; applyF(); };
  $('#chq').onkeydown = (e) => { if (e.key === 'Escape') { CH_F.q = ''; e.target.value = ''; applyF(); } };
  $('#chst').onchange = (e) => { CH_F.st = e.target.value; applyF(); };
  $('#chch').onchange = (e) => { CH_F.ch = e.target.value; applyF(); };
  applyF();

  const bindRows = () => { // 行内按钮绑定（轮询重画行后需重绑）
    app.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => { // 渠道状态 → 一键筛账号列表并滚过去
      CH_F.ch = b.dataset.jump;
      const s = $('#chch'); if (s) s.value = CH_F.ch;
      applyF();
      $('#accpanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    app.querySelectorAll('[data-cht]').forEach(b => b.onclick = async () => {
      const c = chs.find(x => x.id === b.dataset.cht);
      try { await api('POST', `/api/channel/${c.id}/settings`, { enabled: !c.enabled }); toast(`已${c.enabled ? '停用' : '启用'}渠道 ${c.name}`); viewChannel(); }
      catch (err) { toast(err.message); }
    });
  };
  bindRows();

  const dualVis = () => { const c = chs.find(x => x.id === $('#afch').value); $('#af-dual').style.display = c && c.meta && c.meta.caps && c.meta.caps.dualMode ? 'flex' : 'none'; }; // 双模式渠道才有 模式 / 兜底两项
  $('#afch').onchange = () => { CH_SEL.add = $('#afch').value; dualVis(); };
  dualVis();
  $('#af').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const chId = $('#afch').value;
    const payload = { label: f.get('label'), token: f.get('token') };
    if (chs.find(c => c.id === chId && c.meta && c.meta.caps && c.meta.caps.dualMode)) { payload.mode = f.get('mode'); payload.creditFallback = f.get('fb') === '' ? null : f.get('fb') === '1'; }
    try {
      const r = await api('POST', `/api/channel/${chId}/account`, payload);
      const dch = chs.find(c => c.id === chId);
      toast(`已入库：${r.info.plan || r.info.name || '账号可用'}${dch && dch.meta && dch.meta.caps && dch.meta.caps.dualMode ? ` · ${(r.info.unlimited || []).length} 个包量模型` : ''}`); viewChannel();
    } catch (err) { $('#aerr').textContent = err.message; }
  };

  const sfPaint = () => { // 设置面板：换渠道只重画字段与说明
    const chId = $('#sfch').value;
    const ch = chs.find(c => c.id === chId);
    $('#sfdesc').textContent = ch && ch.meta ? `${ch.meta.desc || ''}（挂账号：${ch.meta.keyLabel || 'API Key'}）` : '';
    $('#sfbody').innerHTML = sfFields(chId);
    $('#sftoggle').textContent = ch && ch.enabled ? '停用渠道' : '启用渠道';
  };
  $('#sfch').onchange = () => { CH_SEL.set = $('#sfch').value; sfPaint(); };
  sfPaint();
  $('#sf').onsubmit = async (e) => {
    e.preventDefault();
    const chId = $('#sfch').value;
    const fields = SETTINGS_FIELDS[chId] || {};
    const f = new FormData(e.target);
    const out = {};
    for (const [k, [, type]] of Object.entries(fields)) {
      if (type === 'check') out[k] = f.get(k) === 'on';
      else if (type === 'csv') out[k] = String(f.get(k) || '').split(',').map(x => x.trim()).filter(Boolean);
      else if (type === 'number') out[k] = Number(f.get(k));
      else out[k] = f.get(k);
    }
    try { await api('POST', `/api/channel/${chId}/settings`, { settings: out }); toast('渠道设置已保存'); viewChannel(); }
    catch (err) { toast(err.message); }
  };
  $('#sftoggle').onclick = async () => {
    const ch = chs.find(c => c.id === $('#sfch').value);
    if (!ch) return;
    try { await api('POST', `/api/channel/${ch.id}/settings`, { enabled: !ch.enabled }); toast('已切换渠道状态'); viewChannel(); }
    catch (err) { toast(err.message); }
  };

  const bindActs = () => { // 账号行操作按钮（轮询重画行后需重绑）
    app.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
      const { id, act, ch: chId } = b.dataset;
      const ch = chs.find(x => x.id === chId);
      try {
        if (act === 'del') { if (!confirmDel('该账号')) return; await api('DELETE', `/api/channel/${chId}/account/${id}`); toast('已删除'); }
        if (act === 'check') { const r = await api('POST', `/api/channel/${chId}/account/${id}/check`); toast(`体检 OK：${r.info.plan} · 积分 ${r.info.credits ?? '上游计'} · 包量 ${(r.info.unlimited || []).length} 模型`); }
        if (act === 'mode') { const a = ch.accounts.find(x => x.id === id); await api('POST', `/api/channel/${chId}/account/${id}`, { mode: a.mode === 'unlimited' ? 'credits' : 'unlimited' }); toast('已切换使用模式'); }
        if (act === 'fb') {
          const a = ch.accounts.find(x => x.id === id);
          const cur = a.creditFallback === undefined ? 'def' : a.creditFallback ? 'on' : 'off';
          const next = cur === 'def' ? true : cur === 'on' ? false : null; // 随渠道 → 开 → 关 → 随渠道
          await api('POST', `/api/channel/${chId}/account/${id}`, { creditFallback: next });
          toast(next === null ? '兜底：跟随渠道默认' : next ? '兜底：开' : '兜底：关');
        }
        if (act === 'toggle') { const a = ch.accounts.find(x => x.id === id); await api('POST', `/api/channel/${chId}/account/${id}`, { enabled: !a.enabled }); toast('已切换'); }
        viewChannel();
      } catch (err) { toast(err.message); }
    });
  };
  bindActs();

  // —— 手动刷新模型目录（页头按钮）：重拉上游清单后只重画统计卡与两张表，表单编辑态不动 ——
  $('#chmref').onclick = async () => {
    const b = $('#chmref'); b.disabled = true; b.textContent = '刷新中…';
    try {
      const r = await api('POST', '/api/models/refresh');
      const [ms2, vs2] = await Promise.all([
        api('GET', '/api/models?catalog=1').catch(() => ({ models: [] })),
        api('GET', '/api/models?video=1&catalog=1').catch(() => ({ models: [] }))]);
      for (const k of Object.keys(mCnt)) delete mCnt[k];
      for (const k of Object.keys(vCnt)) delete vCnt[k];
      for (const m of ms2.models || []) mCnt[m.channel] = (mCnt[m.channel] || 0) + 1;
      for (const m of vs2.models || []) vCnt[m.channel] = (vCnt[m.channel] || 0) + 1;
      imgN = Object.values(mCnt).reduce((s, x) => s + x, 0);
      vidN = Object.values(vCnt).reduce((s, x) => s + x, 0);
      paintTables();
      toast(`模型目录已刷新：图片 ${r.image} · 视频 ${r.video}`);
    } catch (e) { toast(e.message); }
    b.disabled = false; b.textContent = '↻ 刷新模型目录';
  };

  // —— 页内轮询：8 秒拉一次渠道数据，只重画统计卡与两张表；表单 / 筛选面板不动 ——
  const OV_HEAD = '<tr><th>渠道</th><th>能力</th><th>状态</th><th>账号</th><th>模型</th><th>占用</th><th>已服务</th><th>操作</th></tr>';
  const ACC_HEAD = '<tr><th>渠道</th><th>账号</th><th>套餐</th><th>积分</th><th>模式 / 计费</th><th>状态</th><th>占用</th><th>已服务</th><th>操作</th></tr>';
  const paintTables = () => {
    tot = mkTot();
    $('#chpr').innerHTML = `${chs.filter(c => c.enabled).length}/${chs.length} 启用 · ${tot.acc} 账号`;
    $('#chcards').innerHTML = cardsHTML();
    $('#chov').innerHTML = OV_HEAD + ovRows();
    $('#acctbl').innerHTML = ACC_HEAD + (accRows() || `<tr><td colspan="9" class="empty">尚无账号 —— 下方「添加账号」挂第一个</td></tr>`);
    $('#acchint').textContent = `— ${tot.up}/${tot.acc} 可用 · 8 秒自动刷新`;
    bindRows(); bindActs(); applyF();
  };
  CH_T.timer = setInterval(async () => {
    if (!$('#acctbl')) { clearInterval(CH_T.timer); CH_T.timer = 0; return; } // 已切走
    try { chs = await api('GET', '/api/channels'); paintTables(); } catch { /* 网络抖动下拍再拉 */ }
  }, 8000);
}

/* ---------- 通用分页：一页最多 20 条。pagerHTML 出条 / bindPager 接点击 / pgSlice 切片（越界自动收回到末页） ---------- */
const PG_SIZE = 20;
function pagerHTML(total, page) {
  const pages = Math.max(1, Math.ceil(total / PG_SIZE));
  const cnt = `<span class="muted" style="font-family:var(--sans);font-size:11px">${total} 条${pages > 1 ? ` · ${page}/${pages} 页` : ''}</span>`;
  if (pages <= 1) return `<div class="pager">${cnt}</div>`;
  const want = [...new Set([1, 2, pages - 1, pages, page - 1, page, page + 1])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  const nums = [];
  for (let i = 0; i < want.length; i++) {
    if (i && want[i] - want[i - 1] > 1) nums.push('<span class="pg-ell">…</span>');
    nums.push(`<button class="btn mini pg${want[i] === page ? ' on' : ''}" data-pg="${want[i]}">${want[i]}</button>`);
  }
  return `<div class="pager">
    <button class="btn mini pg" data-pg="${page - 1}"${page <= 1 ? ' disabled' : ''}>‹</button>${nums.join('')}
    <button class="btn mini pg" data-pg="${page + 1}"${page >= pages ? ' disabled' : ''}>›</button>${cnt}</div>`;
}
function bindPager(el, fn) {
  if (!el) return;
  el.querySelectorAll('button[data-pg]').forEach(b => b.onclick = () => { const p = +b.dataset.pg; if (p >= 1 && !b.disabled) fn(p); });
}
function pgSlice(list, page) {
  const pages = Math.max(1, Math.ceil(list.length / PG_SIZE));
  const p = Math.min(Math.max(1, page || 1), pages);
  return { page: p, rows: list.slice((p - 1) * PG_SIZE, p * PG_SIZE) };
}

/* ---------- 用户 ---------- */
function keyListCell(u) {
  return u.keys.length ? `${u.keys.length} 把` : '<span class="muted">—</span>';
}
const USERS_Q = { q: '' }; // 用户名录搜索（跨渲染记忆；纯前端筛行）
const USERS_PG = { page: 1 }; // 用户名录分页（搜索后按命中集分页，隐行不摘 DOM）
async function viewUsers() {
  const users = await api('GET', '/api/users');
  const isAdmin = ME.role === 'admin';
  const rows = users.filter(u => u.id !== ME.id || isAdmin).map(u => `
    <tr data-n="${esc(u.name.toLowerCase())}">
      <td><b>${esc(u.name)}</b>${u.parent === ME.id && !isAdmin ? ' <span class="tag">下级</span>' : ''}<br>
        <span class="muted" style="font-size:11px;font-family:var(--sans)">${new Date(u.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })} 入册</span></td>
      <td><span class="tag ${u.role === 'agent' ? 'acc' : ''}">${esc(u.role)}</span></td>
      <td>${stChip(u.status)}</td>
      <td class="num"><b>${n2(u.balance)}</b></td>
      <td class="num">${n2(u.spent)}</td>
      <td>${keyListCell(u)}${u.children ? ` · ${u.children} 下级` : ''}<br>
        <span class="tag ${u.models === -1 ? 'gd' : ''}" style="font-size:10px">${u.models === -1 ? '全部模型' : u.models + ' 模型'}</span></td>
      <td style="white-space:nowrap">
        ${u.role !== 'admin' ? `<button class="btn mini" data-act="gm" data-id="${u.id}">模型</button>` : ''}
        <button class="btn mini" data-act="key" data-id="${u.id}">发密钥</button>
        <button class="btn mini" data-act="bal" data-id="${u.id}" data-n="${u.name}" data-b="${u.balance}">调账</button>
        ${isAdmin ? `<button class="btn mini" data-act="setbal" data-id="${u.id}" data-n="${u.name}" data-b="${u.balance}">设余额</button>` : ''}
        ${isAdmin && u.role !== 'admin' ? `<button class="btn mini del" data-act="del" data-id="${u.id}" data-n="${u.name}">删除</button>` : ''}
        <button class="btn mini" data-act="pw" data-id="${u.id}">改密</button>
        <button class="btn mini" data-act="st" data-id="${u.id}" data-s="${u.status}">${u.status === 'active' ? '停用' : '启用'}</button>
      </td></tr>`).join('');
  shell('users', `
    <div class="page-title">用户管理<span class="right">共 ${users.length} 个账户 · ${users.filter(u => u.role === 'agent').length} 代理</span></div>
    <div class="page-desc">${isAdmin ? '管理员视图：用户与代理的账号、余额、密钥与模型授权' : '代理视图：自己与下级账户'}</div>
    <div class="panel">
      <h3>➕ 新建${isAdmin ? '账户' : '下级'}<span class="sp"></span><span class="hint">${isAdmin ? 'user 普通用户 · agent 可发展下级并划扣积分' : '初始积分从自己余额划扣'}</span></h3>
      <form class="inline" id="uf">
        <div class="field"><label>用户名</label><input name="name" placeholder="如 zoe" required style="width:150px"></div>
        <div class="field"><label>密码</label><input name="password" placeholder="≥6 位" required minlength="6" style="width:130px"></div>
        <div class="field"><label>身份</label><select name="role" style="width:110px"><option value="user">user 用户</option>${isAdmin ? '<option value="agent">agent 代理</option><option value="admin">admin 管理员</option>' : ''}</select></div>
        <div class="field"><label>初始积分${isAdmin ? '' : '（划扣自己）'}</label><input name="balance" type="number" min="0" placeholder="0" style="width:96px"></div>
        <button class="btn pri" type="submit" style="margin-bottom:2px">创 建</button>
        <span class="err" id="uerr" style="flex:1 1 100%;margin:0;min-height:0;text-align:left"></span>
      </form>
    </div>
    <div class="panel">
      <h3>🗂️ 用户名录<span class="hint">— ${isAdmin ? 'USERS & AGENTS' : 'AGENCY · MY CIRCLE'}</span><span class="sp"></span>
        <input id="uq" placeholder="🔍 搜用户名…" style="width:168px" value="${esc(USERS_Q.q)}"></h3>
      <div class="tscroll"><table class="idx" id="utable"><tr><th>用户</th><th>角色</th><th>状态</th><th>余额</th><th>累计消费</th><th>密钥/下级</th><th>操作</th></tr>
        ${rows || '<tr><td colspan="7" class="empty">还没有下级 —— 上方建一个</td></tr>'}</table></div>
      <div id="upg"></div>
    </div>`);

  const applyUQ = () => { // 搜索 + 分页：只隐行不重渲（新建表单编辑态不丢）；命中集内按页显隐
    const q = USERS_Q.q.trim().toLowerCase();
    const trs = [...app.querySelectorAll('#utable tr[data-n]')];
    const hit = trs.filter(tr => !q || tr.dataset.n.includes(q));
    const { page, rows } = pgSlice(hit, USERS_PG.page); USERS_PG.page = page;
    trs.forEach(tr => { tr.style.display = rows.includes(tr) ? '' : 'none'; });
    const box = $('#upg'); box.innerHTML = pagerHTML(hit.length, page);
    bindPager(box, p => { USERS_PG.page = p; applyUQ(); });
  };
  $('#uq').oninput = (e) => { USERS_Q.q = e.target.value; USERS_PG.page = 1; applyUQ(); };
  $('#uq').onkeydown = (e) => { if (e.key === 'Escape') { USERS_Q.q = ''; e.target.value = ''; USERS_PG.page = 1; applyUQ(); } };
  applyUQ();

  $('#uf').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api('POST', '/api/users', { name: f.get('name'), password: f.get('password'), role: f.get('role'), balance: +f.get('balance') || 0 }); toast('已建号'); viewUsers(); }
    catch (err) { $('#uerr').textContent = err.message; }
  };
  app.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
    const { id, act } = b.dataset;
    try {
      if (act === 'gm') { location.hash = '#/user-models/' + id; return; }
      if (act === 'key') { const r = await api('POST', `/api/user/${id}/key`, { name: 'panel' }); prompt(`新密钥（只显示这一次）：`, r.newKey); }
      if (act === 'bal') {
        const d = ME.role === 'agent' ? '（从自己余额划扣，扣完为止）' : '';
        const v = prompt(`给 ${b.dataset.n} 调账：输入正数为充值，负数为扣账${d}`, '10');
        const n = Number(v);
        if (v === null || !Number.isFinite(n) || n === 0) return;
        await api('POST', `/api/user/${id}`, { balanceDelta: n });
        toast(n > 0 ? `充值成功 +${n2(n)}` : `扣账成功 ${n2(n)}`);
      }
      if (act === 'setbal') {
        const v = prompt(`给 ${b.dataset.n} 设置余额（直接设为目标值，非增量）：`, b.dataset.b);
        const n = Number(v);
        if (v === null || !Number.isFinite(n) || n < 0) return;
        await api('POST', `/api/user/${id}`, { balance: n });
        toast(`余额已设为 ${n2(n)}`);
      }
      if (act === 'del') {
        const name = b.dataset.n;
        if (!confirm(`确认删除用户 ${name}？该用户及其所有密钥将被移除，操作不可恢复。`)) return;
        await api('DELETE', `/api/user/${id}`);
        toast(`已删除 ${name}`);
      }
      if (act === 'pw') { const v = prompt('新密码 (≥6)：'); if (!v) return; await api('POST', `/api/user/${id}`, { password: v }); toast('已改密'); }
      if (act === 'st') await api('POST', `/api/user/${id}`, { status: b.dataset.s === 'active' ? 'disabled' : 'active' });
      viewUsers();
    } catch (err) { toast(err.message); }
  });
}

/* ---------- 模型授权（admin 给代理/用户，代理给自己的下级；专属价可覆盖全局。
   与定价页同骨架：按渠道分组 → 渠道内分图片 / 视频两表，顶部关键词搜索 + 分页） ---------- */
async function viewUserModels(uid) {
  const [users, ms, vs, pricing, chs] = await Promise.all([
    api('GET', '/api/users'), api('GET', '/api/models?catalog=1'), api('GET', '/api/models?video=1&catalog=1'), api('GET', '/api/pricing'),
    api('GET', '/api/channels').catch(() => [])]); // 拉渠道名做分组头；代理无权限时回退显示渠道 id
  const u = users.find(x => x.id === uid);
  if (!u) { toast('用户不存在'); return location.hash = '#/users'; }
  const grants = u.grants || {};
  const all = [ ...ms.models.map(m => ({ ...m, kind: 'image' })), ...vs.models.map(m => ({ ...m, kind: 'video' })) ]
    .filter((m, i, a) => a.findIndex(x => x.id === m.id) === i)
    .sort((a, b) => a.id.localeCompare(b.id));
  // 已授权但不在当前可见清单里的模型（代理视野受限时）也要展示，避免一保存就丢授权；
  // 非管理员看不见 = 上级授的 → 锁定行（服务端也会原样保留，这里只是让代理知道动不了）
  const extra = Object.keys(grants).filter(id => !all.some(m => m.id === id))
    .map(id => ({ id, name: id, kind: '?', channel: '?', locked: ME.role !== 'admin' }));
  const models = [...all, ...extra];
  const chName = Object.fromEntries(chs.map(c => [c.id, c.name]));
  const chShow = (id) => chName[id] || id;
  // 分组：管理员按渠道分组（渠道内再分图片/视频两表）；其他人不见渠道——图片/视频两张平表。
  // 归属不明的（上级授权的锁定行）落「未分组」
  const groups = new Map(), etc = [];
  for (const m of models) {
    if (m.channel === '?') { etc.push(m); continue; }
    const key = (ME.role === 'admin' && m.channel) ? m.channel : '_';
    let g = groups.get(key);
    if (!g) groups.set(key, g = { image: [], video: [] });
    (m.kind === 'video' ? g.video : g.image).push(m);
  }
  const gEnts = [...groups.entries()].sort((a, b) => (a[0] === '_' ? 1 : 0) - (b[0] === '_' ? 1 : 0)
    || chShow(a[0]).localeCompare(chShow(b[0])));
  const TBL_IMG = '<tr><th></th><th>图片模型</th><th>生图 / 每张</th></tr>';
  const TBL_VID = '<tr><th></th><th>视频模型</th><th>视频价</th></tr>';
  const TBL_ANY = '<tr><th></th><th>模型</th><th>类型</th><th>生图 / 每张</th><th>视频价</th></tr>';
  const priceIn = (m, k, ph) => {
    const v = grants[m.id] && grants[m.id][k] != null ? grants[m.id][k] : '';
    return `<input type="number" step="0.5" min="0" data-k="${k}" data-m="${esc(m.id)}" value="${v}" placeholder="${ph}" style="width:76px">`;
  };
  const phOf = (m, k, dflt) => (pricing[m.id] || {})[k] ?? dflt;
  const lockRow = (m, span) => `<tr data-m="${esc(m.id)}" class="muted">
    <td><input type="checkbox" checked disabled title="上级授权，代理不可改动"></td>
    <td colspan="${span}"><b>${esc(m.name)}</b> <span class="mono" style="font-size:11px">${esc(m.id)}</span></td></tr>`;
  const rowImg = (m) => m.locked ? lockRow(m, 2) : `<tr data-m="${esc(m.id)}">
    <td><input type="checkbox" data-ck data-m="${esc(m.id)}" ${grants[m.id] ? 'checked' : ''}></td>
    <td><b>${esc(m.name)}</b> <span class="muted mono" style="font-size:11px">${esc(m.id)}</span></td>
    <td>${priceIn(m, 'image', phOf(m, 'image', 1))}</td></tr>`;
  // 视频价只出一个框，跟全局定价的计费方式走（有 videoFlat=一口价模型，否则按秒）——
  // 两个框都摆着的话填错那个不会生效（计费一口价优先），纯误导
  const vidPriceCell = (m) => {
    const p = pricing[m.id] || {}, flat = p.videoFlat != null;
    return `<span class="tag ${flat ? 'acc' : ''}" style="margin-right:8px">${flat ? '一口价' : '按秒'}</span>`
      + priceIn(m, flat ? 'videoFlat' : 'videoPerSec', flat ? p.videoFlat : (p.videoPerSec ?? 2));
  };
  const rowVid = (m) => m.locked ? lockRow(m, 2) : `<tr data-m="${esc(m.id)}">
    <td><input type="checkbox" data-ck data-m="${esc(m.id)}" ${grants[m.id] ? 'checked' : ''}></td>
    <td><b>${esc(m.name)}</b> <span class="muted mono" style="font-size:11px">${esc(m.id)}</span></td>
    <td>${vidPriceCell(m)}</td></tr>`;
  const rowAny = (m) => m.locked ? lockRow(m, 4) : `<tr data-m="${esc(m.id)}">
    <td><input type="checkbox" data-ck data-m="${esc(m.id)}" ${grants[m.id] ? 'checked' : ''}></td>
    <td><b>${esc(m.name)}</b> <span class="muted mono" style="font-size:11px">${esc(m.id)}</span></td>
    <td><span class="tag ${m.kind === 'video' ? 'acc' : ''}">${esc(m.kind)}</span></td>
    <td>${priceIn(m, 'image', 1)}</td><td>${vidPriceCell(m)}</td></tr>`;
  const parts = [];
  let no = 0;
  for (const [cid, g] of gEnts) {
    if (!g.image.length && !g.video.length) continue;
    no++;
    const flat = cid === '_'; // 非管理员：不暴露渠道，只分图片/视频
    parts.push(`<div class="gsec">${sec(String(no).padStart(2, '0'),
      flat ? '模 型 · 全 部' : `渠 道 · ${esc(chShow(cid)).toUpperCase()}`,
      flat ? `MODELS · 图片 ${g.image.length} · 视频 ${g.video.length}` : `CHANNEL / ${esc(cid)} · 图片 ${g.image.length} · 视频 ${g.video.length}`,
      (g.image.length ? `<div class="tscroll"><table class="idx">${TBL_IMG}${g.image.map(rowImg).join('')}</table></div>` : '')
      + (g.video.length ? `<div class="tscroll" style="margin-top:${g.image.length ? 14 : 0}px"><table class="idx">${TBL_VID}${g.video.map(rowVid).join('')}</table></div>` : ''))}</div>`);
  }
  no++;
  parts.push(`<div class="gsec">${sec(String(no).padStart(2, '0'), '未 分 组 / 上 级 授 权', `UNGROUPED · ${etc.length} 个 · 渠道归属未知`,
    `<div class="tscroll"><table class="idx">${TBL_ANY}${etc.map(rowAny).join('') || '<tr><td colspan="6" class="empty">暂无</td></tr>'}</table></div>`)}</div>`);
  // 搜索：按模型 ID / 展示名 / 渠道实时筛行 + 命中集内分页（display:none 隐行，勾选与价格不丢）
  let gmQ = '', gmPage = 1;
  const qTxt = {};
  for (const m of models) qTxt[m.id] = `${m.id} ${m.name} ${chShow(m.channel || '')}`.toLowerCase();
  const applyFilter = () => {
    const q = gmQ.trim().toLowerCase();
    const trs = [...app.querySelectorAll('tr[data-m]')];
    const hit = trs.filter(tr => !q || (qTxt[tr.dataset.m] || '').includes(q));
    const { page, rows } = pgSlice(hit, gmPage); gmPage = page;
    trs.forEach(tr => { tr.style.display = rows.includes(tr) ? '' : 'none'; });
    // 本页没有可见行的渠道组整段隐藏（分页/搜索筛空时组头不空挂）
    app.querySelectorAll('.gsec').forEach(b => {
      b.style.display = [...b.querySelectorAll('tr[data-m]')].some(tr => tr.style.display !== 'none') ? '' : 'none';
    });
    const n = $('#gs-n'); if (n) n.textContent = q ? `匹配 ${hit.length} 个模型` : '';
    const box = $('#gspg'); if (box) { box.innerHTML = pagerHTML(hit.length, page); bindPager(box, p => { gmPage = p; applyFilter(); }); }
  };
  shell('users', sec('01', `模 型 授 权 · ${esc(u.name)}`, u.grants ? `${Object.keys(grants).length} 个已授权` : '未设限制 · 全部模型', `
    <div class="pill-tabs">
      <button class="btn" id="gm-all">全部模型（清除限制）</button>
      <button class="btn pri" id="gm-save">保存授权</button>
      <button class="btn" id="gm-back">← 返回</button>
    </div>
    <div class="row" style="margin:14px 0;align-items:flex-end">
      <div class="field" style="flex:1;min-width:420px;margin-bottom:0"><label>搜 索 模 型</label>
        <input id="gsrch" placeholder="🔍 模型 ID / 展示名 / 渠道，实时筛选（Esc 清空）…" style="width:100%"></div>
      <span class="muted" id="gs-n" style="font-family:var(--sans);font-size:11px;padding-bottom:10px"></span>
    </div>
    <div id="gspg"></div>
    <p class="muted" style="font-family:var(--sans);font-size:11px;margin:10px 0">按渠道分组、渠道内分图片 / 视频表；勾选 = 授权使用；价格留空按全局价，填了即为该用户专属价。生图按张；视频价按全局定价的计费方式只显示适用的那种（一口价或按秒）。目录含未挂号渠道的模型——授权了也要等渠道挂上账号才能实际提交。</p>` + parts.join('')));
  const sBox = $('#gsrch');
  sBox.oninput = () => { gmQ = sBox.value; gmPage = 1; applyFilter(); };
  sBox.onkeydown = (e) => { if (e.key === 'Escape') { gmQ = ''; sBox.value = ''; gmPage = 1; applyFilter(); } };
  applyFilter();
  $('#gm-back').onclick = () => location.hash = '#/users';
  $('#gm-all').onclick = async () => {
    await api('POST', `/api/user/${uid}/models`, { grants: null }); toast('已恢复全部模型'); viewUserModels(uid); };
  $('#gm-save').onclick = async () => {
    const out = {};
    app.querySelectorAll('[data-ck]').forEach(ck => {
      if (!ck.checked) return;
      const id = ck.dataset.m, g = {};
      app.querySelectorAll(`input[data-m="${CSS.escape(id)}"][data-k]`).forEach(i => { if (i.value !== '') g[i.dataset.k] = +i.value; });
      out[id] = g;
    });
    if (!Object.keys(out).length && !confirm('没有勾选任何模型——保存后该下级将无可用模型。价格不会单独生效，需要同时勾选左侧选框。确定保存？')) return;
    try { await api('POST', `/api/user/${uid}/models`, { grants: out }); toast(`已保存 ${Object.keys(out).length} 个模型授权`); viewUserModels(uid); }
    catch (e) { toast(e.message); }
  };
}

/* ---------- 定价（先按渠道分组，渠道内再分图片 / 视频模型） ---------- */
async function viewPricing() {
  const [p0, fb, ms, vs, chs] = await Promise.all([
    api('GET', '/api/pricing'), api('GET', '/api/fallbacks'),
    api('GET', '/api/models?catalog=1'), api('GET', '/api/models?video=1&catalog=1'),
    api('GET', '/api/channels').catch(() => [])]);
  const ids = [...new Set([...(ms.models || []).map(m => m.id), ...(vs.models || []).map(m => m.id)])];
  const kindOf = {}, chanOf = {}; // 目录：模型 → 类型 / 所属渠道
  for (const m of ms.models || []) { kindOf[m.id] = 'image'; chanOf[m.id] = m.channel; }
  for (const m of vs.models || []) { if (!kindOf[m.id]) { kindOf[m.id] = 'video'; chanOf[m.id] = m.channel; } }
  const chList = chs.length ? chs.map(c => ({ id: c.id, name: c.name }))
    : [...new Set(Object.values(chanOf))].map(id => ({ id, name: id }));
  const nameOf = {}; // 模型 → 展示名（搜索要能按名字命中）
  for (const m of ms.models || []) nameOf[m.id] = m.name;
  for (const m of vs.models || []) if (!nameOf[m.id]) nameOf[m.id] = m.name;
  const resOf = {}; // 模型 → 可选分辨率（组合价输入；目录没有分辨率档的模型不显示）
  for (const m of [...(ms.models || []), ...(vs.models || [])]) if (m.resolutions && m.resolutions.length) resOf[m.id] = m.resolutions;
  const fbSel = (m) => `<select data-fb class="mono" style="max-width:170px;font-size:12px">` +
    ['', ...ids.filter(x => x !== m)].map(x => `<option value="${esc(x)}"${(fb[m] || '') === x ? ' selected' : ''}>${x ? esc(x) : '（无）'}</option>`).join('') + '</select>';
  const delBtn = '<button class="btn mini" data-del style="color:var(--danger);border-color:var(--danger)">移除</button>';
  const inK = (k, v) => `<input data-k="${k}" type="number" step="0.5" min="0" value="${v ?? ''}" style="width:90px">`;
  const inR = (r, v) => `<input data-rk="${esc(r)}" type="number" step="0.5" min="0" value="${v ?? ''}" style="width:64px">`;
  const NO_RES = '<span class="muted" style="font-family:var(--sans);font-size:11px">单一画质</span>';
  const vidModeOf = (v) => v.mode === 'flat' || (v.mode == null && v.videoFlat != null) ? 'flat' : 'perSec'; // 旧数据按一口价推断
  const imgResCell = (m, v) => {
    const rs = resOf[m] || [];
    if (!rs.length) return NO_RES;
    const ir = v.imageRes || {};
    return `<span class="pill-inline" style="flex-wrap:wrap">${rs.map(r => `<label class="res-in">${esc(r)} ${inR(r, ir[r])}<i>/张</i></label>`).join('')}</span>`;
  };
  const vidResCell = (m, v) => {
    const rs = resOf[m] || [];
    if (!rs.length) return '<span class="muted" style="font-family:var(--sans);font-size:11px">单一分辨率</span>';
    const mode = vidModeOf(v), vr = v.videoRes || {};
    return `<span class="pill-inline" style="flex-wrap:wrap">${rs.map(r => {
      const rv = vr[r] || {};
      return `<label class="res-in">${esc(r)} ${inR(r, rv.flat != null ? rv.flat : rv.perSec)}<i class="res-unit">${mode === 'flat' ? '/条' : '/秒'}</i></label>`;
    }).join('')}</span>`;
  };
  const rowImg = (m, v) => `
    <tr data-m="${esc(m)}" data-kind="image"><td class="mono"><b>${esc(m)}</b></td>
      <td>${inK('image', v.image)}</td><td>${imgResCell(m, v)}</td>
      <td>${fbSel(m)}</td><td>${delBtn}</td></tr>`;
  const rowVid = (m, v) => { // 计费方式单选：按秒（默认价=每秒）/ 一口价（默认价=每条）；组合价随方式切换单位
    const mode = vidModeOf(v);
    return `
    <tr data-m="${esc(m)}" data-kind="video"><td class="mono"><b>${esc(m)}</b></td>
      <td><span class="pill-inline"><label class="rb"><input type="radio" name="md-${esc(m)}" data-mode="perSec" ${mode === 'perSec' ? 'checked' : ''}>按秒</label>
        <label class="rb"><input type="radio" name="md-${esc(m)}" data-mode="flat" ${mode === 'flat' ? 'checked' : ''}>一口价</label></span></td>
      <td><span class="cell-persec" style="${mode === 'perSec' ? '' : 'display:none'}">${inK('videoPerSec', v.videoPerSec)} <i class="muted" style="font-family:var(--sans);font-size:11px">/秒</i></span>
          <span class="cell-flat" style="${mode === 'flat' ? '' : 'display:none'}">${inK('videoFlat', v.videoFlat)} <i class="muted" style="font-family:var(--sans);font-size:11px">/条</i></span></td>
      <td>${vidResCell(m, v)}</td>
      <td>${fbSel(m)}</td><td>${delBtn}</td></tr>`;
  };
  const rowAny = (m, v) => `
    <tr data-m="${esc(m)}" data-kind="any"><td class="mono"><b>${esc(m)}</b></td>
      <td>${inK('image', v.image)}</td><td>${inK('videoPerSec', v.videoPerSec)}</td><td>${inK('videoFlat', v.videoFlat)}</td>
      <td>${fbSel(m)}</td><td>${delBtn}</td></tr>`;
  const TBL_IMG = '<tr><th>图片模型</th><th>默认价 / 每张</th><th>分辨率价 / 每张</th><th>兜底模型</th><th></th></tr>';
  const TBL_VID = '<tr><th>视频模型</th><th>计费方式</th><th>默认价</th><th>分辨率组合价</th><th>兜底模型</th><th></th></tr>';
  const TBL_ANY = '<tr><th>模型</th><th>生图 / 每张</th><th>视频 / 每秒</th><th>视频一口价</th><th>兜底模型</th><th></th></tr>';
  let p = p0;
  // 搜索 + 分页：按模型 ID 或渠道名实时筛，命中集内按页显隐（display:none 隐藏，不摘 DOM——collect 仍能收到隐藏行的值）
  let pricingQ = '', pricingPage = 1;
  const chTxt = Object.fromEntries(chList.map(c => [c.id, `${c.name} ${c.id}`.toLowerCase()]));
  const txtOf = (mid) => `${mid} ${nameOf[mid] || mid}`.toLowerCase(); // 搜索词命中模型 ID 或展示名
  const applyFilter = () => {
    const q = pricingQ.trim().toLowerCase();
    const trs = [...app.querySelectorAll('tr[data-m]')];
    const hit = trs.filter(tr => !q || txtOf(tr.dataset.m).includes(q)
      || (chanOf[tr.dataset.m] && chTxt[chanOf[tr.dataset.m]].includes(q)));
    const { page, rows } = pgSlice(hit, pricingPage); pricingPage = page;
    trs.forEach(tr => { tr.style.display = rows.includes(tr) ? '' : 'none'; });
    // 本页没有可见行的渠道组整段隐藏（分页/搜索筛空时组头不空挂）
    app.querySelectorAll('.gsec').forEach(b => {
      b.style.display = [...b.querySelectorAll('tr[data-m]')].some(tr => tr.style.display !== 'none') ? '' : 'none';
    });
    const n = $('#psrch-n'); if (n) n.textContent = q ? `匹配 ${hit.length} 个模型` : '';
    const box = $('#ppg'); if (box) { box.innerHTML = pagerHTML(hit.length, page); bindPager(box, p => { pricingPage = p; applyFilter(); }); }
  };
  // 收集当前 DOM 里的定价（加行前先收，未保存的改动不丢）。
  // 视频行按当前勾选的计费方式收：一口价时不收每秒价（反之亦然），组合价也只带当前方式字段
  const collect = () => {
    const out = {};
    app.querySelectorAll('tr[data-m]').forEach(tr => {
      const o = {};
      const kind = tr.dataset.kind;
      const mode = tr.querySelector('input[data-mode]:checked')?.value || null;
      tr.querySelectorAll('input[data-k]').forEach(i => {
        if (i.value === '') return;
        if (kind === 'video' && mode === 'flat' && i.dataset.k === 'videoPerSec') return;
        if (kind === 'video' && mode === 'perSec' && i.dataset.k === 'videoFlat') return;
        o[i.dataset.k] = +i.value;
      });
      const imgRes = {}, vidRes = {};
      tr.querySelectorAll('input[data-rk]').forEach(i => {
        if (i.value === '') return;
        const r = i.dataset.rk;
        if (kind === 'video' && mode) vidRes[r] = mode === 'flat' ? { flat: +i.value } : { perSec: +i.value };
        else imgRes[r] = +i.value; // 图片行（未分组行没有分辨率输入，不受影响）
      });
      if (Object.keys(imgRes).length) o.imageRes = imgRes;
      if (Object.keys(vidRes).length) o.videoRes = vidRes;
      if (kind === 'video' && mode) o.mode = mode;
      if (Object.keys(o).length) out[tr.dataset.m] = o;
    });
    return out;
  };
  const collectFb = () => {
    const out = {};
    app.querySelectorAll('tr[data-m]').forEach(tr => {
      const s = tr.querySelector('select[data-fb]'); if (s && s.value) out[tr.dataset.m] = s.value;
    });
    return out;
  };
  const paint = () => {
    const groups = new Map(chList.map(c => [c.id, { name: c.name, image: [], video: [] }])); // 渠道 → 两类模型
    const etc = []; // 不在任何渠道清单里的模型（手动加的）
    for (const [m, v] of Object.entries(p)) {
      const g = groups.get(chanOf[m]);
      if (!g) { etc.push([m, v]); continue; }
      (kindOf[m] === 'video' ? g.video : g.image).push([m, v]);
    }
    const parts = [];
    let no = 0;
    for (const { id, name, image, video } of groups.values()) {
      if (!image.length && !video.length) continue;
      no++;
      parts.push(`<div class="gsec">${sec(String(no).padStart(2, '0'), `渠 道 · ${esc(name).toUpperCase()}`,
        `CHANNEL / ${esc(id)} · 图片 ${image.length} · 视频 ${video.length}`,
        (image.length ? `<h3 class="mini" style="margin:2px 0 8px">图片模型</h3>
          <div class="tscroll"><table class="idx">${TBL_IMG}${image.map(([m, v]) => rowImg(m, v)).join('')}</table></div>` : '')
        + (video.length ? `<h3 class="mini" style="margin:${image.length ? 18 : 2}px 0 8px">视频模型</h3>
          <div class="tscroll"><table class="idx">${TBL_VID}${video.map(([m, v]) => rowVid(m, v)).join('')}</table></div>` : ''))}</div>`);
    }
    no++;
    parts.push(`<div class="gsec">${sec(String(no).padStart(2, '0'), '未 分 组 模 型', `UNGROUPED · ${etc.length} 个 · 不在任何渠道清单`,
      `<div class="tscroll"><table class="idx" id="pt-etc">${TBL_ANY}${etc.map(([m, v]) => rowAny(m, v)).join('')
        || '<tr><td colspan="6" class="empty">暂无——目录外的模型 ID 会落在这里</td></tr>'}</table></div>`)}</div>`);
    no++;
    parts.push(sec(String(no).padStart(2, '0'), '新 增 与 保 存', 'ADD & SAVE', `
      <div class="row">
        <div class="field"><label>新增模型 ID</label><input id="pm" placeholder="nanobanana2"></div>
        <button class="btn" id="padd">加行</button>
        <button class="btn pri" id="psave">保存定价</button>
        <span class="muted" style="font-family:var(--sans);font-size:11px;margin-left:10px;padding-bottom:8px">留空 = 不售卖。视频先选计费方式：按秒=每秒×时长，一口价=每条一口。分辨率价是对应组合的专属价（未填的分辨率用默认价）；图片分辨率价=该画质每张。兜底=该模型上游建单失败时自动换道重提（计费仍按原模型价，只兜一次）</span>
      </div>`));
    shell('pricing', `
    <div class="row" style="margin-bottom:14px;align-items:flex-end">
      <div class="field" style="flex:1;min-width:420px;margin-bottom:0"><label>搜 索 定 价</label>
        <input id="psrch" placeholder="🔍 模型 ID / 展示名 / 渠道，实时筛选（Esc 清空）…" value="${esc(pricingQ)}" style="width:100%"></div>
      <button class="btn" id="prefresh" title="重拉各渠道最新模型清单：新模型自动播种默认价，上游下架的自动清理（每 10 分钟也会自动刷新一次）">↻ 刷新模型目录</button>
      <span class="muted" id="psrch-n" style="font-family:var(--sans);font-size:11px;padding-bottom:10px"></span>
    </div><div id="ppg"></div>` + parts.join(''));
    const sBox = $('#psrch');
    sBox.oninput = () => { pricingQ = sBox.value; pricingPage = 1; applyFilter(); };
    sBox.onkeydown = (e) => { if (e.key === 'Escape') { pricingQ = ''; sBox.value = ''; pricingPage = 1; applyFilter(); } };
    $('#prefresh').onclick = async () => { // 重拉各渠道上游清单 → 重建注册表 + 播价 + 清孤儿，然后整页重画
      const norm = (o) => JSON.stringify(Object.fromEntries(Object.entries(o) // 与 collect() 同口径（丢空值）再比，防误报
        .map(([m, v]) => {
          const c = {};
          for (const [k, x] of Object.entries(v || {})) {
            if (typeof x === 'number' && isFinite(x)) c[k] = x;
            else if (k === 'mode' && (x === 'flat' || x === 'perSec')) c[k] = x;
            else if (x && typeof x === 'object') { // 组合价：数字（imageRes）或 {flat|perSec}（videoRes）
              const r = {};
              for (const [rk, rv] of Object.entries(x)) r[rk] = typeof rv === 'number' ? rv
                : (typeof rv.flat === 'number' ? { flat: rv.flat } : { perSec: rv.perSec });
              if (Object.keys(r).length) c[k] = r;
            }
          }
          return [m, c];
        }).filter(([, v]) => Object.keys(v).length)));
      if (norm(collect()) !== norm(p) && !confirm('有未保存的定价改动，刷新目录会丢弃这些改动，继续？')) return;
      const b = $('#prefresh'); b.disabled = true; b.textContent = '刷新中…';
      try {
        const r = await api('POST', '/api/models/refresh');
        toast(`模型目录已刷新：图片 ${r.image} · 视频 ${r.video}`);
        await viewPricing(); // 重画拿新目录/新播种价
      } catch (e) { b.disabled = false; b.textContent = '↻ 刷新模型目录'; toast(e.message); }
    };
    applyFilter();
    // 视频计费方式切换：切默认价输入的显隐 + 组合价单位文案（/秒 ↔ /条）
    app.querySelectorAll('tr[data-kind="video"]').forEach(tr => {
      const upd = () => {
        const mode = tr.querySelector('input[data-mode]:checked')?.value || 'perSec';
        const cp = tr.querySelector('.cell-persec'), cf = tr.querySelector('.cell-flat');
        if (cp) cp.style.display = mode === 'perSec' ? '' : 'none';
        if (cf) cf.style.display = mode === 'flat' ? '' : 'none';
        tr.querySelectorAll('.res-unit').forEach(i => { i.textContent = mode === 'flat' ? '/条' : '/秒'; });
      };
      tr.querySelectorAll('input[data-mode]').forEach(r => { r.onchange = upd; });
    });
    app.querySelectorAll('[data-del]').forEach(b => b.onclick = () => b.closest('tr').remove());
    $('#padd').onclick = () => {
      const m = $('#pm').value.trim();
      if (!m || p[m] !== undefined) return toast('模型名空或已存在');
      p = { ...collect(), [m]: {} }; // 收好未保存的改动再重分组，新行落进所属渠道
      $('#pm').value = '';
      paint();
    };
    $('#psave').onclick = async () => {
      try { await api('POST', '/api/pricing', collect()); await api('POST', '/api/fallbacks', collectFb()); }
      catch (e) { return toast(e.message); }
      toast('定价与兜底已保存'); viewPricing();
    };
  };
  paint();
}

/* ---------- 充值管理（管理员）：兑换码 = 发卡平台库存 ---------- */
const BUY_LINKS = [ // 发卡平台商品：面值(积分/张) → 购买页。登记你自己的售卖链接；留空则相关购买按钮自动隐藏
  // { credits: 10, url: 'https://你的发卡平台/商品页' },
];
const buyLinkOf = (c) => BUY_LINKS.find(x => x.credits === Number(c)) || null;
let topupF = { status: '', k: '', page: 1 };
async function viewTopup() {
  const d = await api('GET', '/api/codes?limit=500' + (topupF.status ? '&status=' + topupF.status : ''));
  let list = d.codes;
  if (topupF.k) { const k = topupF.k.toLowerCase(); list = list.filter(c => c.code.toLowerCase().includes(k) || String(c.note || '').toLowerCase().includes(k)); }
  const { page, rows } = pgSlice(list, topupF.page); topupF.page = page;
  const st = d.stats;
  shell('topup', `
    <div class="page-title">充值管理<span class="right">兑换码 ${st.total} 张 · 未兑 ${st.unused}</span></div>
    <div class="page-desc">生成兑换码 → 把码批量贴到发卡平台对应商品做库存${BUY_LINKS.length ? '（' + BUY_LINKS.map(b => `<a href="${b.url}" target="_blank" rel="noopener">${b.credits} 积分档</a>`).join(' · ') + '）' : ''} → 买家付款拿码 → 回本平台「个人中心 · 充值」兑换积分，即时到账</div>
    <div class="cards">
      <div class="card"><div class="k">未兑换</div><div class="v ${st.unused ? 'acc' : 'dim'}">${st.unused}<small> 张</small></div></div>
      <div class="card"><div class="k">未兑面值合计</div><div class="v">${n2(st.unusedCredits)}<small> 积分</small></div></div>
      <div class="card"><div class="k">已兑换</div><div class="v ok">${st.redeemed}<small> 张</small></div></div>
      <div class="card"><div class="k">累计充值入账</div><div class="v">${n2(st.redeemedCredits)}<small> 积分</small></div></div>
    </div>
    <div class="panel">
      <h3>🎫 生成兑换码<span class="hint">— 一批同面值；生成后一键复制，贴到发卡平台库存</span><span class="sp"></span>
        <button class="btn mini" id="cclear" title="删除全部未兑换的码（已兑换的记录保留供对账）" style="color:var(--danger);border-color:var(--danger)">一键清空未兑换</button></h3>
      <form id="cgf" class="inline">
        <div class="field"><label>面值（积分 / 张）</label><input name="credits" type="number" min="1" step="1" value="100" style="width:130px" required></div>
        <div class="field"><label>数量（张）</label><input name="count" type="number" min="1" max="100" value="10" style="width:100px" required></div>
        <div class="field"><label>备注（可选，如 100积分档）</label><input name="note" placeholder="100 积分档" style="width:180px"></div>
        <button class="btn pri" type="submit">生 成</button>
      </form>
      <div id="cgmade" style="margin-top:12px"></div>
    </div>
    <div class="panel">
      <h3>📋 兑换码库存<span class="sp"></span>
        <span class="pill-inline">
          <button class="btn mini ${topupF.status === '' ? 'on' : ''}" data-cs="">全部 ${st.total}</button>
          <button class="btn mini ${topupF.status === 'unused' ? 'on' : ''}" data-cs="unused">未兑换 ${st.unused}</button>
          <button class="btn mini ${topupF.status === 'used' ? 'on' : ''}" data-cs="used">已兑换 ${st.redeemed}</button>
        </span>
        <input id="cq" placeholder="🔍 搜码 / 备注…" style="width:150px;padding:6px 12px;font-size:12px" value="${esc(topupF.k)}"></h3>
      <div class="tscroll"><table class="idx"><tr><th>兑换码</th><th>面值</th><th>状态</th><th>兑换人 / 时间</th><th>生成时间</th><th>备注</th><th>操作</th></tr>
        ${rows.map(c => `<tr data-c="${esc(c.id)}">
          <td><span class="mono code-chip" data-copy-code="${esc(c.code)}" title="点击复制">${esc(c.code)}</span></td>
          <td class="num">${n2(c.credits)}</td>
          <td>${c.used ? '<span class="tag">已兑换</span>' : '<span class="tag gd">未兑换</span>'}</td>
          <td style="font-size:12px">${c.used ? `<b>${esc(c.used.name)}</b> · ${fmtT(c.used.at)}` : '<span class="muted">—</span>'}</td>
          <td class="muted" style="font-size:12px;white-space:nowrap">${fmtT(c.createdAt)}</td>
          <td style="font-size:12px">${esc(c.note || '')}</td>
          <td>${c.used ? '' : `<button class="btn mini" data-cdel="${esc(c.id)}" style="color:var(--danger);border-color:var(--danger)">作废</button>`}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="empty">还没有兑换码 —— 上方生成第一批</td></tr>'}</table></div>
      <div id="cpg">${pagerHTML(list.length, page)}</div>
    </div>`);
  bindPager($('#cpg'), p => { topupF.page = p; viewTopup(); });
  const paintMade = (made) => { // 生成结果：码列表 + 一键复制（一行一码，可直接批量导入发卡平台）
    const bl = buyLinkOf(made[0] && made[0].credits);
    $('#cgmade').innerHTML = made.length ? `
      <div class="doc-toolbar"><span class="muted">本次生成 ${made.length} 张 · 面值 ${n2(made[0].credits)} 积分/张</span>
        <span><button class="btn mini" id="cgcopy">复制全部（一行一码）</button>
        ${bl ? `<a class="btn mini pri" href="${bl.url}" target="_blank" rel="noopener">去 ${bl.credits} 积分档商品加库存 ↗</a>`
             : (BUY_LINKS.length ? '<span class="muted" style="font-family:var(--sans)">该面值没有对应商品（发卡平台只有 ' + BUY_LINKS.map(b => b.credits + ' 积分档').join(' / ') + '）</span>' : '')}</span></div>
      <pre class="docs">${esc(made.map(c => c.code).join('\n'))}</pre>` : '';
    const cp = $('#cgcopy'); if (cp) cp.onclick = () => copyText(made.map(c => c.code).join('\n'));
  };
  $('#cgf').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api('POST', '/api/codes', { credits: +f.get('credits'), count: +f.get('count'), note: f.get('note') });
      toast(`已生成 ${r.made.length} 张兑换码`);
      topupF.page = 1;
      await viewTopup(); // 重画统计与库存表
      paintMade(r.made); // 新 DOM 上补本次生成的码（重画后 #cgmade 是新元素，再填）
    } catch (err) { toast(err.message); }
  };
  app.querySelectorAll('[data-cs]').forEach(b => b.onclick = () => { topupF.status = b.dataset.cs; topupF.page = 1; viewTopup(); });
  $('#cclear').onclick = async () => {
    if (!st.unused) return toast('没有未兑换的码可清');
    if (!confirm(`确认清空全部 ${st.unused} 张未兑换兑换码（未兑面值合计 ${n2(st.unusedCredits)} 积分）？\n已兑换的 ${st.redeemed} 条记录会保留供对账。此操作不可撤销。`)) return;
    try {
      const r = await api('POST', '/api/codes/clear');
      toast(`已清空：删除 ${r.removed} 张，保留已兑换 ${r.kept} 条`);
      topupF.page = 1;
      viewTopup();
    } catch (e) { toast(e.message); }
  };
  const cqi = $('#cq');
  cqi.oninput = () => { topupF.k = cqi.value; topupF.page = 1; };
  cqi.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); viewTopup(); } };
  app.querySelectorAll('[data-copy-code]').forEach(el => el.onclick = () => copyText(el.dataset.copyCode));
  app.querySelectorAll('[data-cdel]').forEach(b => b.onclick = async () => {
    if (!confirmDel('该未兑换码')) return;
    try { await api('DELETE', '/api/code/' + b.dataset.cdel); toast('已作废'); viewTopup(); }
    catch (e) { toast(e.message); }
  });
}

/* ---------- 任务 ---------- */
function bindCancel() {
  app.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
    if (!confirm('确认取消该任务？已排队的立即移除，运行中的强制终止（不扣费）')) return;
    try { await api('POST', `/api/job/${b.dataset.cancel}/cancel`); toast('已取消'); }
    catch (e) { toast(e.message); }
    viewJobs();
  });
}
// 失败任务一键重试：原参数重开一单（价格/授权按当前口径重算），成功后刷新所在视图
function bindRetry(refresh) {
  app.querySelectorAll('[data-retry]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { await api('POST', `/api/job/${b.dataset.retry}/retry`); toast('已重新提交排队'); refresh && refresh(); }
    catch (e) { b.disabled = false; toast(e.message); }
  });
}

// ---------- 预览灯箱：图片/视频大图预览 + 下载（概览 / 任务台账 / 创作台共用） ----------
const PV = { items: [], i: 0, el: null };
function pvOpen(items, i = 0) {
  PV.items = (items || []).filter(x => x && x.url); PV.i = Math.max(0, i);
  if (!PV.items.length) return;
  if (!PV.el) {
    PV.el = document.createElement('div'); PV.el.className = 'pv-overlay';
    PV.el.innerHTML = `<button class="pv-x" title="关闭 (Esc)">×</button>
      <button class="pv-nav pv-prev" title="上一个 (←)">‹</button>
      <div class="pv-stage"></div>
      <button class="pv-nav pv-next" title="下一个 (→)">›</button>
      <div class="pv-cap"></div>`;
    document.body.appendChild(PV.el);
    PV.el.addEventListener('click', e => { if (e.target === PV.el) pvClose(); }); // 点遮罩关
    PV.el.querySelector('.pv-x').onclick = pvClose;
    PV.el.querySelector('.pv-prev').onclick = () => pvGo(-1);
    PV.el.querySelector('.pv-next').onclick = () => pvGo(1);
    document.addEventListener('keydown', e => {
      if (!PV.el.classList.contains('on')) return;
      if (e.key === 'Escape') pvClose();
      else if (e.key === 'ArrowLeft') pvGo(-1);
      else if (e.key === 'ArrowRight') pvGo(1);
    });
  }
  PV.el.classList.add('on');
  pvPaint();
}
function pvClose() { if (!PV.el) return; PV.el.querySelector('.pv-stage').innerHTML = ''; PV.el.classList.remove('on'); }
function pvGo(d) { const n = PV.items.length; if (n) { PV.i = (PV.i + d + n) % n; pvPaint(); } }
function pvPaint() {
  const it = PV.items[PV.i];
  PV.el.querySelector('.pv-stage').innerHTML = it.video
    ? `<video controls autoplay src="${esc(it.url)}"></video>`
    : `<img src="${esc(it.url)}" alt="">`;
  PV.el.querySelector('.pv-cap').innerHTML =
    `<span>${esc(it.label || '')}${PV.items.length > 1 ? ` <i class="pv-count">${PV.i + 1}/${PV.items.length} · 方向键切换</i>` : ''}</span>
     <a class="btn mini" href="${esc(it.url)}" download target="_blank" rel="noopener">⬇ 下载</a>`;
}
// 任务的媒体清单（灯箱用）：视频一条、图片一组
const pvItemsOf = (j) => j.kind === 'video'
  ? (j.url && j.status === 'done' ? [{ url: j.url, video: true, label: `${j.model} · ${fmtT(j.createdAt)}` }] : [])
  : (j.images || []).map(u => ({ url: u, label: `${j.model} · ${fmtT(j.createdAt)}` }));
// 表格渲染后绑定：缩略图/视频点开灯箱，预览/下载按钮（list = 本次渲染的 job 数组）
function bindResultActs(list) {
  app.querySelectorAll('tr[data-job]').forEach(tr => {
    const j = list.find(x => x.id === tr.dataset.job); if (!j) return;
    const items = pvItemsOf(j);
    tr.querySelectorAll('[data-pv]').forEach(el => el.onclick = () => {
      const k = items.findIndex(x => x.url === el.dataset.pv); pvOpen(items, k < 0 ? 0 : k);
    });
    const po = tr.querySelector('[data-pvopen]');
    if (po) po.onclick = () => pvOpen(items, 0);
    const da = tr.querySelector('[data-dlall]');
    if (da) da.onclick = () => items.forEach((it, k) => setTimeout(() => { // 多文件逐个触发，隔 400ms 免浏览器拦
      const a = document.createElement('a'); a.href = it.url; a.download = ''; a.target = '_blank'; a.rel = 'noopener'; a.click();
    }, k * 400));
  });
}
// 结果单元格：缩略图可点灯箱 + 显式 预览/下载 按钮
function resultCell(j) {
  if (j.kind === 'image') {
    const urls = j.images || [];
    if (!urls.length) return '';
    return `<div class="results">${urls.slice(0, 3).map(u => `<img src="${esc(u)}" loading="lazy" alt="" data-pv="${esc(u)}">`).join('')
      + (urls.length > 3 ? `<span class="muted" style="font-size:11px">+${urls.length - 3}</span>` : '')}
      <span class="racts"><button class="btn mini" data-pvopen="1">预览</button><button class="btn mini" data-dlall="1">下载</button></span></div>`;
  }
  return j.url && j.status === 'done'
    ? `<div class="results video"><video preload="metadata" muted playsinline src="${esc(j.url)}" data-pv="${esc(j.url)}"></video>
       <span class="racts"><button class="btn mini" data-pvopen="1">预览</button><a class="btn mini" href="${esc(j.url)}" download target="_blank" rel="noopener">下载</a></span></div>`
    : '';
}
function jobsTable(list, showUser = true, compact = false) {
  if (!list.length) return '<div class="empty">无任务</div>';
  // 定宽列布局：长提示词/错误串压不破表（自动布局里 td 的 max-width 管不住无断点长中文），
  // 溢出省略号、悬浮 title 看全文；compact（概览）再去掉编号/计费列
  const col = (w) => `<col${w ? ` style="width:${w}px"` : ''}>`;
  const cols = [
    ...(compact ? [] : [col(84)]),   // 编号
    ...(showUser ? [col(84)] : []),  // 用户
    col(52),                         // 类型
    col(130),                        // 模型
    col(),                           // 提示词（分余量）
    col(compact ? 170 : 200),        // 结果
    col(),                           // 状态（分余量）
    ...(compact ? [] : [col(52)]),   // 计费
    col(108),                        // 时间
    col(84),                         // 操作
  ].join('');
  return `<div class="tscroll slim"><table class="idx tbl-fixed"><colgroup>${cols}</colgroup><tr>${compact ? '' : '<th>编号</th>'}${showUser ? '<th>用户</th>' : ''}<th>类型</th><th>模型</th><th>提示词</th><th>结果</th><th>状态</th>${compact ? '' : '<th>计费</th>'}<th>时间</th><th>操作</th></tr>
    ${list.map(j => `<tr data-job="${esc(j.id)}">${compact ? '' : `<td class="mono">${esc(j.id.slice(0, 10))}</td>`}
      ${showUser ? `<td>${esc(j.user)}</td>` : ''}
      <td><span class="tag ${j.kind === 'video' ? 'acc' : ''}">${esc(j.kind)}</span></td>
      <td class="mono"><span class="ell" title="${esc(j.model)}">${esc(j.model)}</span></td>
      <td><span class="ell" title="${esc(j.prompt)}">${esc(j.prompt)}</span></td>
      <td>${resultCell(j)}</td>
      <td>${stChip(j.status)}${j.note ? `<br><span class="tag gd" style="font-size:10px">${esc(j.note)}</span>` : ''}${j.error ? `<br><span class="st-failed" style="font-size:11px" title="${esc(j.error)}">${esc(j.error.slice(0, 60))}${j.error.length > 60 ? '…' : ''}</span>` : ''}</td>
      ${compact ? '' : `<td class="num">${j.billing.billed ? n2(j.billing.price) : `<span class="muted">${n2(j.billing.price)}*</span>`}</td>`}
      <td class="muted" style="font-size:12px;white-space:nowrap">${fmtT(j.createdAt)}</td>
      <td>${(j.status === 'queued' || j.status === 'running') && (ME.role === 'admin' || (ME.name === j.user && j.status === 'queued'))
        ? `<button class="btn mini" data-cancel="${esc(j.id)}">取消</button>` : ''}${(j.status === 'failed' || j.status === 'cancelled') && (ME.role === 'admin' || ME.name === j.user)
        ? `<button class="btn mini" data-retry="${esc(j.id)}">重试</button>` : ''}</td></tr>`).join('')}</table></div>`;
}
let jobsFilter = {};
async function viewJobs() {
  const { page: _p, ...rest } = jobsFilter; // page 只在客户端用，不进查询串
  const q = new URLSearchParams({ limit: 200, ...rest }).toString(); // 200 条：归档任务也在列表里（服务端已裁 prompt，200 条 ≈ 压缩后几十 KB）
  const list = await api('GET', '/api/jobs?' + q);
  const { page, rows } = pgSlice(list, jobsFilter.page); jobsFilter.page = page;
  const pill = (k, v, label) => `<button class="btn ${String(jobsFilter[k] || '') === String(v) && (v !== '' || !jobsFilter[k]) ? 'on' : ''}" data-f="${k}" data-v="${v}">${label}</button>`;
  shell('jobs', sec('01', '任 务 台 账', `${ME.role === 'admin' ? '全平台 · ' : ''}${list.length} 条`, `
    <div class="pill-tabs">
      ${pill('kind', '', '全部')}${pill('kind', 'image', '生图')}${pill('kind', 'video', '生视频')}
      ${pill('status', '', '全部状态')}${pill('status', 'done', 'done')}${pill('status', 'failed', 'failed')}${pill('status', 'running', 'running')}${pill('status', 'cancelled', 'cancelled')}
      <input id="jf-u" placeholder="按用户名筛 ↵" value="${esc(jobsFilter.user || '')}" style="width:130px">
    </div>${jobsTable(rows)}<div id="jpg">${pagerHTML(list.length, page)}</div>`));
  bindPager($('#jpg'), p => { jobsFilter.page = p; viewJobs(); });
  bindResultActs(rows);
  bindRetry(viewJobs);
  app.querySelectorAll('[data-f]').forEach(b => b.onclick = () => {
    const k = b.dataset.f, v = b.dataset.v;
    if (v === '') delete jobsFilter[k]; else jobsFilter[k] = v;
    jobsFilter.page = 1; viewJobs();
  });
  bindCancel();
  $('#jf-u').onkeydown = (e) => {
    if (e.key !== 'Enter') return; e.preventDefault();
    const v = e.target.value.trim();
    if (v) jobsFilter.user = v; else delete jobsFilter.user;
    jobsFilter.page = 1; viewJobs();
  };
}

/* ---------- 平台日志（管理员）：操作审计 + 积分流水，时间均为北京时间 ---------- */
/* ---------- 平台日志（管理员）：侧边栏「日志」下拉分两页 —— 操作日志 / 积分流水，北京时间 ---------- */
let logsQ = { k: '', page: 1 }, ledQ = { user: '', page: 1 };
async function viewLogs(tab) { // 'act' 操作日志（默认） | 'credit' 积分流水；一次只拉一张表
  if (tab === 'credit') {
    const ledger = await api('GET', '/api/ledger?limit=200' + (ledQ.user ? '&user=' + encodeURIComponent(ledQ.user) : ''));
    const { page, rows } = pgSlice(ledger, ledQ.page); ledQ.page = page;
    shell('logs/credit', `
      <div class="pill-tabs">
        <a class="btn" href="#/logs/act">操作日志</a>
        <button class="btn on">积分流水</button>
      </div>
      ${sec('01', '积 分 流 水', `LEDGER · ${ledger.length} 条 · 北京时间`, `
      <div class="row" style="margin-bottom:10px"><div class="field" style="max-width:280px">
        <input id="lu" placeholder="按用户名筛 ↵" value="${esc(ledQ.user)}"></div></div>
      <div class="tscroll"><table class="idx"><tr><th>时间</th><th>用户</th><th>变动</th><th>余额</th><th>事由</th><th>关联</th></tr>
      ${rows.map(l => `<tr><td class="muted mono" style="font-size:11px;white-space:nowrap">${fmtT(l.t)}</td>
        <td><b>${esc(l.user)}</b></td>
        <td class="num" style="color:${l.delta >= 0 ? 'var(--ok)' : 'var(--danger)'}">${l.delta >= 0 ? '+' : ''}${n2(l.delta)}</td>
        <td class="num">${n2(l.balance)}</td>
        <td style="font-size:12px">${esc(l.reason)}</td>
        <td class="mono muted" style="font-size:11px">${l.ref ? esc(String(l.ref).slice(0, 10)) : '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">无记录</td></tr>'}</table></div>
      <div id="lpg">${pagerHTML(ledger.length, page)}</div>`)}`);
    $('#lu').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ledQ.user = e.target.value.trim(); ledQ.page = 1; viewLogs('credit'); } };
    bindPager($('#lpg'), p => { ledQ.page = p; viewLogs('credit'); });
    return;
  }
  const logs = await api('GET', '/api/logs?limit=200' + (logsQ.k ? '&k=' + encodeURIComponent(logsQ.k) : ''));
  const { page, rows } = pgSlice(logs, logsQ.page); logsQ.page = page;
  shell('logs/act', `
    <div class="pill-tabs">
      <button class="btn on">操作日志</button>
      <a class="btn" href="#/logs/credit">积分流水</a>
    </div>
    ${sec('01', '操 作 日 志', `AUDIT · ${logs.length} 条 · 北京时间`, `
      <div class="row" style="margin-bottom:10px"><div class="field" style="max-width:280px">
        <input id="lq" placeholder="搜操作者/动作/详情 ↵" value="${esc(logsQ.k)}"></div></div>
      <div class="tscroll slim"><table class="idx"><tr><th>时间</th><th>操作者</th><th>动作</th><th>详情</th></tr>
      ${rows.map(l => `<tr><td class="muted mono" style="font-size:11px;white-space:nowrap">${fmtT(l.t)}</td>
        <td><b>${esc(l.actor)}</b></td><td><span class="tag">${esc(l.act)}</span></td>
        <td class="muted" style="font-size:12px">${esc(l.detail)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">无记录</td></tr>'}</table></div>
      <div id="apg">${pagerHTML(logs.length, page)}</div>`)}`);
  $('#lq').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); logsQ.k = e.target.value.trim(); logsQ.page = 1; viewLogs('act'); } };
  bindPager($('#apg'), p => { logsQ.page = p; viewLogs('act'); });
}

/* ---------- 个人中心 ---------- */
let mePg = 1;
async function viewMe() {
  const [me, ledger] = await Promise.all([api('GET', '/api/me'), api('GET', '/api/ledger?limit=50')]);
  const { page, rows } = pgSlice(ledger, mePg); mePg = page;
  const host = location.origin;
  const demoKey = me.keys[0] ? me.keys[0].key : 'sk-你的密钥';
  const DOCS = [ // 渲染与「复制全部文档」共用一份源；面向接入方：只讲怎么调，不涉及任何内部信息
    { t: '第 1 步 · 准备：地址 + 密钥', h: '密钥在下一节「04 API 密钥」里签发、复制；把下面示例中的 sk-… 换成你自己的密钥就能直接跑',
      c: `# ① API 地址就是本面板地址，所有接口在 /v1 下：
#    ${host}
# ② 每个请求都要带这两个请求头：
Authorization: Bearer ${demoKey}
Content-Type: application/json` },
    { t: '第 2 步 · 生图（最简上手）', h: '?wait=1 = 同步等出图（等几秒~几十秒直接拿结果）；想马上返回就去掉它，见第 4 步',
      c: `curl -X POST "${host}/v1/images/generations?wait=1" \\
  -H "Authorization: Bearer ${demoKey}" -H "Content-Type: application/json" \\
  -d '{"model":"gpt20","prompt":"a cat on the moon, cinematic","aspect_ratio":"16:9"}'

# 成功返回（images 就是图片地址，约 1 天内有效，及时下载）：
# {"id":"a1b2c3d4…","status":"done","images":["https://…/xxx.png"],"billing":{"price":1,"billed":true}}` },
    { t: '第 3 步 · 生视频（提交 → 轮询）', h: '视频要生成几分钟：先提交拿 id，再反复查同一个地址，status 变 done 时 url 字段就是视频',
      c: `# ① 提交：
curl -X POST "${host}/v1/videos/generations" \\
  -H "Authorization: Bearer ${demoKey}" -H "Content-Type: application/json" \\
  -d '{"model":"ltx25pro","prompt":"a dog running on the beach, slow motion","ar":"16:9","dur":6,"res":"720p"}'

# 返回：{"id":"9f8e7d6c…","status":"queued"}

# ② 轮询（每 5~10 秒查一次，直到 status: done / failed）：
curl -H "Authorization: Bearer ${demoKey}" ${host}/v1/videos/9f8e7d6c…

# 完成返回：{"id":"9f8e7d6c…","status":"done","url":"https://…/xxx.mp4","billing":{…}}` },
    { t: '第 4 步 · 异步模式（生图去掉 ?wait=1）', h: '和生视频一个套路：返回 {id} → 轮询 GET /v1/images/<id>，done 时 images 出结果',
      c: `curl -X POST "${host}/v1/images/generations" \\
  -H "Authorization: Bearer ${demoKey}" -H "Content-Type: application/json" \\
  -d '{"model":"gpt20","prompt":"a cat on the moon"}'
# → {"id":"a1b2c3d4…","status":"queued"}
curl -H "Authorization: Bearer ${demoKey}" ${host}/v1/images/a1b2c3d4…
# → status 变 done 时 images 出结果` },
    { t: '第 5 步 · 垫图（给 AI 一张参考图）', h: 'ref 是数组，三种写法可混用；prompt 里 {{1}}、{{2}} 指代第 1、2 张垫图',
      c: `"ref": [
  "251539",                        # 素材 id（纯数字）
  "https://cdn.xx/a.png",          # 公网图片 URL
  "data:image/png;base64,iVBOR…"   # base64（图片文件内容转成的长字符串）
]

# prompt 里指代垫图：让 {{1}} 里的人物微笑挥手
# 有些模型垫图不收图片 URL（清单里 refUploadOnly:true），此时用素材 id 或 base64` },
    { t: '第 6 步 · 模型清单与价格（先查再调）', h: '只能看到你有权使用的模型；价格即你的实际扣费价',
      c: `curl -H "Authorization: Bearer ${demoKey}" ${host}/v1/models          # 生图模型
curl -H "Authorization: Bearer ${demoKey}" ${host}/v1/models?video=1   # 视频模型

# 返回字段说明：
#   image.price        生图默认价（积分/张）
#   video.mode         视频计费方式：perSec=按秒，flat=一口价
#   video.priceFlat    一口价（积分/条）—— mode 为 flat 时看它
#   video.pricePerSec  按秒价（积分/秒）—— mode 为 perSec 时按 秒数×它 计费
#   resolutions        可选分辨率（如 480p/720p/2k…），提交时传 "res":"720p"
#   priceRes           分辨率组合价——该分辨率用这里的价，没列出的分辨率用上面的默认价
#                     例：priceRes {"720p":{"flat":8}} → 选 720p 一口 8 积分
#   duration           可选时长档（秒）；aspect_ratio 画幅；maxRef 垫图张数上限
#   refUploadOnly      true = 该模型垫图只收 素材id/base64，不收图片 URL` },
    { t: '第 7 步 · 常见问题', h: '',
      c: `401 无效 API key     → 密钥抄错或已删除，回「04 API 密钥」核对
402 积分不足         → 回「02 充值·兑换码」购买兑换码充值后重试
404 任务不存在       → 只能查自己提交的任务；核对 id 是否抄对
任务 30 分钟未完成   → 自动标记 failed，不扣积分
结果地址约 1 天失效  → 出图/出片后尽快下载保存
任务失败不扣积分     → 换模型或调整提示词后重试即可` },
  ];
  shell('me', `
    ${sec('01', '个 人 中 心', 'ACCOUNT', `
      <div class="stats">
        <div class="stat"><div class="v">${n2(me.balance)}</div><div class="k">积分余额</div></div>
        <div class="stat"><div class="v">${n2(me.spent)}</div><div class="k">累计消费</div></div>
        <div class="stat"><div class="v">${me.keys.length}</div><div class="k">持有密钥</div></div>
      </div>`)}
    ${sec('02', '充 值 · 兑 换 码', 'TOP-UP', `
      <div class="card" style="max-width:720px">
        <div class="row">
          <div class="field" style="flex:1;min-width:250px"><label>兑换码（WL-XXXX-XXXX-XXXX）</label>
            <input id="rdc" placeholder="粘贴购买得到的兑换码" autocomplete="off" style="text-transform:uppercase;font-family:var(--mono)"></div>
          <button class="btn pri" id="rdgo" style="margin-bottom:6px">兑 换</button>
        </div>
        ${BUY_LINKS.length ? `<div class="row" style="margin-top:14px">
          <label style="margin:0">购买兑换码</label>
          ${BUY_LINKS.map(b => `<a class="btn" href="${b.url}" target="_blank" rel="noopener">买 ${b.credits} 积分 ↗</a>`).join('')}
        </div>` : ''}
        <p class="muted" style="font-family:var(--sans);font-size:11.5px;margin-top:12px;line-height:1.8">
          充值流程：按要充的面值点上方购买按钮，在发卡平台下单 → 平台自动把兑换码发给你 → 回到这里粘贴兑换，积分即时到账、余额立即可用。
          一码只能兑换一次，兑换后即作废。</p>
      </div>`)}
    ${sec('03', '我 的 流 水', 'MY LEDGER · 北京时间', `
      <div class="tscroll slim"><table class="idx"><tr><th>时间</th><th>变动</th><th>余额</th><th>事由</th></tr>
      ${rows.map(l => `<tr><td class="muted mono" style="font-size:11px;white-space:nowrap">${fmtT(l.t)}</td>
        <td class="num" style="color:${l.delta >= 0 ? 'var(--ok)' : 'var(--danger)'}">${l.delta >= 0 ? '+' : ''}${n2(l.delta)}</td>
        <td class="num">${n2(l.balance)}</td><td style="font-size:12px">${esc(l.reason)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">暂无流水</td></tr>'}</table></div>
      <div id="mpg">${pagerHTML(ledger.length, page)}</div>`)}
    ${sec('04', 'API 密 钥', 'KEYS', `
      ${me.keys.map(k => `<div class="keycard">
        <div class="keycard-top"><span class="mono">${esc(k.key)}</span>${stChip(k.status)}</div>
        <div class="keycard-meta">
          <span class="tag">${esc(k.name)}</span>
          <span class="muted">签发 ${fmtT(k.createdAt)}</span>
          <span class="muted">消费 ${n2(k.spent || 0)} 积分</span>
          <span class="keybtns">
            <button class="btn mini" data-kc="${esc(k.key)}">复制</button>
            <button class="btn mini" data-tk="${esc(k.key)}" data-to="${k.status === 'active' ? 'disabled' : 'active'}">${k.status === 'active' ? '停用' : '启用'}</button>
            <button class="btn mini" data-kd="${esc(k.key)}" style="color:var(--danger);border-color:var(--danger)">删除</button>
          </span>
        </div>
      </div>`).join('') || '<div class="empty">还没有密钥</div>'}
      <div class="row" style="margin-top:16px">
        <div class="field"><label>新密钥名称</label><input id="kn" placeholder="prod-server"></div>
        <button class="btn pri" id="ka" style="margin-bottom:6px">签发密钥</button>
      </div>`)}
    ${sec('05', '接 入 文 档', 'API DOCS', `
      <div class="doc-toolbar">
        <span class="muted">Bearer 密钥认证 · 生图同步 / 生视频异步轮询 · 成功才扣积分</span>
        <button class="btn mini" id="dcopyall">复制全部文档</button>
      </div>
      ${DOCS.map(d => docCard(d.t, d.c, d.h)).join('')}
      <p class="muted" style="font-family:var(--sans);font-size:11px;margin-top:6px">
        计费：任务成功才扣积分（见定价表）；failed 不扣。纯中文 prompt 会被上游拒绝，系统已自动加英文前缀。</p>`)}
    ${sec('06', '账 号 设 置', 'PROFILE', `
      <form id="pf" class="card" style="max-width:420px">
        <div class="field"><label>用户名</label><input name="name" value="${esc(me.name)}" required></div>
        <div class="field" style="margin-top:10px"><label>旧密码（验证身份）</label><input name="old" type="password" required></div>
        <div class="field" style="margin-top:10px"><label>新密码（留空 = 只改用户名）</label><input name="neu" type="password" placeholder="≥6 位"></div>
        <button class="btn pri" type="submit" style="margin-top:14px">更 新</button><div class="err" id="perr"></div>
      </form>`)}`);

  bindPager($('#mpg'), p => { mePg = p; viewMe(); });
  const doRedeem = async () => {
    const code = $('#rdc').value.trim();
    if (!code) return toast('先粘贴兑换码');
    try {
      const r = await api('POST', '/api/redeem', { code });
      ME = await api('GET', '/api/me');
      toast(`充值成功：+${n2(r.credits)} 积分 · 余额 ${n2(r.balance)}`, 3600);
      viewMe(); // 余额卡 / 流水 / 侧边栏一起刷新
    } catch (e) { toast(e.message, 3200); }
  };
  $('#rdgo').onclick = doRedeem;
  $('#rdc').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doRedeem(); } };
  $('#ka').onclick = async () => {
    const r = await api('POST', '/api/me/keys', { name: $('#kn').value || 'key' });
    const k = r.keys[r.keys.length - 1];
    toast('密钥已签发：' + k.key, 6000); viewMe();
  };
  app.querySelectorAll('[data-tk]').forEach(b => b.onclick = async () => {
    await api('POST', '/api/me/keys/status', { key: b.dataset.tk, status: b.dataset.to }); viewMe();
  });
  app.querySelectorAll('[data-kc]').forEach(b => b.onclick = () => copyText(b.dataset.kc));
  app.querySelectorAll('[data-kd]').forEach(b => b.onclick = async () => {
    if (!confirm(`确认删除密钥 ${b.dataset.kd.slice(0, 11)}…？删除后立即失效且不可恢复。`)) return;
    try { await api('POST', '/api/me/keys/del', { key: b.dataset.kd }); toast('密钥已删除'); viewMe(); }
    catch (e) { toast(e.message); }
  });
  app.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
    const card = b.closest('.doc-card');
    const pre = card && card.querySelector('pre');
    if (pre) copyText(pre.textContent);
  });
  $('#dcopyall').onclick = () => copyText(
    `# WaLineN API 接入文档\n# 认证：Authorization: Bearer <你的密钥>（示例密钥 ${demoKey}）\n`
    + DOCS.map(d => `\n## ${d.t}${d.h ? `\n（${d.h}）` : ''}\n${d.c}`).join('\n')
    + `\n\n计费：任务成功才扣积分；failed 不扣。纯中文 prompt 系统已自动加英文前缀。\n`);
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      ME = await api('POST', '/api/profile', { name: f.get('name'), old: f.get('old'), password: f.get('neu') || undefined });
      toast('账号信息已更新'); viewMe(); // 侧边栏用户名跟着刷新
    } catch (err) { $('#perr').textContent = err.message; }
  };
}

/* ---------- 创作台 ---------- */
const ST = { kind: 'image', model: '', models: [], vmodels: [], refs: [], vrefs: [], arefs: [], timer: null, jobs: [] };
const RATIOS = ['', '1:1', '4:3', '3:4', '16:9', '9:16', '21:9'];

async function viewStudio() {
  if (ST.timer) clearInterval(ST.timer);
  try {
    const [ms, vs, hist] = await Promise.all([
      api('GET', '/api/models'), api('GET', '/api/models?video=1'), api('GET', '/api/jobs?limit=12&full=1')]);
    ST.models = ms.models; ST.vmodels = vs.models; ST.jobs = hist.slice().reverse();
  } catch (e) { ST.models = []; ST.vmodels = []; ST.jobs = []; }
  renderStudio();
  ST.timer = setInterval(pollStudio, 3500);
}

function stRes() { // 当前选中的分辨率（无分辨率档的模型返回 undefined）
  const f = $('#strf'), s = $('#str');
  return f && s && f.style.display !== 'none' ? s.value : undefined;
}
function stPrice() { // 组合计价：选中的分辨率有专属价用它，没有回落默认价（与服务端 priceOf 同口径）
  const res = stRes();
  if (ST.kind === 'image') {
    const m = ST.models.find(x => x.id === ST.model);
    const s = +($('#sts')?.value || 1);
    const base = (m && res && m.priceRes && m.priceRes[res] != null) ? m.priceRes[res] : (m ? (m.price ?? 1) : 1);
    return base * s;
  }
  const m = ST.vmodels.find(x => x.id === ST.model);
  const r = (res && m && m.priceRes && m.priceRes[res]) || {};
  const flat = r.flat != null ? r.flat : (m ? m.priceFlat : null);
  if (flat != null) return flat;                                  // 一口价（按条计费）
  return (r.perSec != null ? r.perSec : (m ? (m.pricePerSec ?? 2) : 2)) * (+($('#std')?.value || 5));
}
function stSyncPrice() { const el = $('#stp'); if (el) el.innerHTML = `预计 <b>${n2(stPrice())}</b> 积分 · 余额 <span id="balv">${n2(ME.balance)}</span>`; }

// 垫图上限按模型算（渠道模型表 maxRef；缺省 6，生图平台全局上限 6；0=该模型不支持垫图）
function stCapOf(m, kind) {
  const cap = m && m.maxRef != null ? m.maxRef : 6;
  return kind === 'image' ? Math.min(cap, 6) : cap;
}
function stMaxRef() {
  return stCapOf((ST.kind === 'image' ? ST.models : ST.vmodels).find(x => x.id === ST.model), ST.kind);
}
// ---------- 视频/音频参考（2026-09-18 自 souls 移植）：模型清单 maxVideo/maxAudio 开槽才显示 ----------
// 媒体没法像图片那样瘦身转码（本机 2 核）——只做单文件封顶，超了让用户自行压缩；生图模式恒无槽
function stMediaCaps() {
  const m = ST.kind === 'video' ? ST.vmodels.find(x => x.id === ST.model) : null;
  return { v: m ? (m.maxVideo ?? 0) : 0, a: m ? (m.maxAudio ?? 0) : 0, aSec: m ? (m.maxAudioSec ?? 0) : 0 };
}
const MEDIA_FILE_MAX = { video: 40 * 1024 * 1024, audio: 10 * 1024 * 1024 }; // 与服务端 saveMedia 同口径
function renderMediaThumbs() { // 视频/音频素材条（模型切换截断/删除时局部重渲，base64 不进 DOM）
  const mk = (arr, kind, icon) => arr.map((r, i) => `<span class="chip-ref mono">${icon} ${esc(r.name || '')} <span class="muted">${(r.bytes / 1048576).toFixed(1)}MB</span> <i class="x" data-i="${i}" data-k="${kind}" style="font-style:normal;cursor:pointer">×</i></span>`).join('');
  const vt = $('#stvt'), at = $('#stat');
  if (vt) vt.innerHTML = mk(ST.vrefs, 'video', '🎬');
  if (at) at.innerHTML = mk(ST.arefs, 'audio', '🎵');
  app.querySelectorAll('#stvt .x, #stat .x').forEach(x => x.onclick = () => {
    (x.dataset.k === 'video' ? ST.vrefs : ST.arefs).splice(+x.dataset.i, 1); renderMediaThumbs(); });
}
// ---------- 垫图前端瘦身：累计 ≤20MB（与 API 口径一致）+ 单图 ≤2MB（2026-09-21 用户定档） ----------
// 单图超 2MB 前端压完再传（2048px/0.85 生成参考肉眼无差）——原图直传弱网要传几分钟，任务全卡上传上；
// 超档的图缩边长 + JPEG 重编码逐档压；URL/photo id 引用不占本地上传量，不计入
const REF_BUDGET = 20 * 1024 * 1024;
const REF_SINGLE_MAX = 2 * 1024 * 1024;
const refBytes = () => ST.refs.reduce((n, r) => n + (r.bytes || 0), 0);
async function slimRef(file, budget) {
  const cap = Math.min(budget, REF_SINGLE_MAX); // 累计余量与单图硬顶取小，作为本图压缩目标
  if (file.size <= cap) return file; // 档内原样收（PNG 等格式不动）
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } // EXIF 方向先摆正
  catch (e) { bmp = await createImageBitmap(file); }
  const ladder = [[2048, .85], [1600, .75], [1280, .6], [960, .45]]; // 边长上限 + JPEG 质量，逐档降
  let best = null;
  for (const [dim, q] of ladder) {
    const s = Math.min(1, dim / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(bmp.width * s)); cv.height = Math.max(1, Math.round(bmp.height * s));
    const cx = cv.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); // JPEG 无透明通道，白底垫上
    cx.drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', q));
    if (!blob) continue;
    best = blob;
    if (blob.size <= cap) return blob;
  }
  return best || file; // 都压不进档就用最小档——尽力压缩，绝不拒收（2026-09-07 用户明确）
}
function renderThumbs() { // 垫图缩略图（模型切换截断/删除单张时局部重渲，不动整个表单）
  const t = $('#stt'); if (!t) return;
  t.innerHTML = ST.refs.map((r, i) => r.dataURL
    ? `<span class="thumb"><img src="${r.dataURL}" class="thumb" style="width:62px;height:62px"><i class="x" data-i="${i}">×</i></span>`
    : `<span class="chip-ref mono">${esc(r.value)} <i class="x" data-i="${i}" style="font-style:normal;cursor:pointer">×</i></span>`).join('');
  app.querySelectorAll('#stt .x').forEach(x => x.onclick = () => { ST.refs.splice(+x.dataset.i, 1); renderThumbs(); });
}
function syncRefUI() { // 模型切换后：垫图/媒体区文案/可见性/数量上限跟着变
  const h = $('#strefh'), z = $('#strefzone'); if (!h || !z) return;
  const cap = stMaxRef();
  if (cap <= 0) { h.textContent = '垫图 / 参考图：该模型不支持'; z.style.display = 'none'; atClose(); }
  else {
    const vm = ST.vmodels.find(x => x.id === ST.model);
    const urlOk = ST.kind === 'image' || !(vm && vm.refUploadOnly); // refUploadOnly 模型垫图只认上传/base64
    h.textContent = `垫图 / 参考图（最多 ${cap}${urlOk ? '：本地图片 · photo id · URL' : '：本地图片 · photo id（此模型不支持裸 URL 垫图）'}）`;
    z.style.display = '';
  }
  if (ST.refs.length > cap && cap >= 0) { ST.refs.length = cap; toast(`该模型最多 ${cap} 张垫图，已截断`); }
  const caps = stMediaCaps();
  const vh = $('#stvh'), vz = $('#stvzone'), ah = $('#stah'), az = $('#stazone');
  if (vh && vz) { vh.textContent = `参考视频（最多 ${caps.v} 段 · MP4/MOV/WebM，单文件 ≤40MB）`; vh.style.display = vz.style.display = caps.v > 0 ? '' : 'none'; }
  if (ah && az) { ah.textContent = `参考音频（最多 ${caps.a} 段 · MP3/WAV/M4A，单文件 ≤10MB${caps.aSec ? ` · 单段 ≤${caps.aSec}s` : ''}）`; ah.style.display = az.style.display = caps.a > 0 ? '' : 'none'; }
  if (ST.vrefs.length > caps.v) { ST.vrefs.length = caps.v; toast(`该模型最多 ${caps.v} 段参考视频，已截断`); }
  if (ST.arefs.length > caps.a) { ST.arefs.length = caps.a; toast(`该模型最多 ${caps.a} 段参考音频，已截断`); }
  renderThumbs(); renderMediaThumbs();
}

// ---------- @ 引用素材：textarea 输入 @ 呼出菜单，点选/回车插入 {{N}}/{{vN}}/{{aN}} ----------
const AT = { open: false, idx: 0, start: -1, items: [] };
function atClose() { AT.open = false; const m = $('#stmenu'); if (m) m.classList.remove('on'); }
const refTag = (k, i) => k === 'vid' ? `{{v${i + 1}}}` : k === 'aud' ? `{{a${i + 1}}}` : `{{${i + 1}}}`;
const refLabel = (k, i) => k === 'vid' ? `视频${i + 1}` : k === 'aud' ? `音频${i + 1}` : `图${i + 1}`;
function atRender(ta) {
  const m = $('#stmenu'); if (!m) return;
  const all = [...ST.refs.map((r, i) => ({ k: 'img', i, r })), ...ST.vrefs.map((r, i) => ({ k: 'vid', i, r })), ...ST.arefs.map((r, i) => ({ k: 'aud', i, r }))];
  if (!all.length) m.innerHTML = `<div class="at-item muted" id="atEmpty">还没有垫图 —— 点击选择文件上传</div>`;
  else if (!AT.items.length) m.innerHTML = `<div class="at-item muted">没有匹配的素材</div>`;
  else m.innerHTML = AT.items.map((it, k) => `
    <div class="at-item ${k === AT.idx ? 'on' : ''}" data-i="${it.i}" data-k="${it.k}">
      ${it.r.dataURL ? `<img src="${it.r.dataURL}">` : it.k === 'img'
        ? `<span class="mono" style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.r.value)}</span>`
        : `<span class="mono">${it.k === 'vid' ? '🎬' : '🎵'} ${esc(it.r.name || '')}</span>`}
      <b>${refLabel(it.k, it.i)}</b><span class="muted">→ ${refTag(it.k, it.i)}</span></div>`).join('');
  m.querySelectorAll('.at-item[data-i]').forEach(el => el.onclick = () => atPick(ta, el.dataset.k, +el.dataset.i));
  const emp = $('#atEmpty'); if (emp) emp.onclick = () => { atClose(); if ($('#stf')) $('#stf').click(); };
  m.classList.add('on'); AT.open = true;
  const on = m.querySelector('.at-item.on'); if (on) on.scrollIntoView({ block: 'nearest' }); // 长列表键盘导航跟随
}
function atPick(ta, k, i) {
  const tag = refTag(k, i);
  const end = Math.max(ta.selectionStart, AT.start); // 菜单开着时用户又动过光标，别切出乱序文本
  ta.value = ta.value.slice(0, AT.start) + tag + ta.value.slice(end);
  const pos = AT.start + tag.length;
  ta.setSelectionRange(pos, pos); ST.prompt = ta.value; ta.focus(); atClose();
}
function atInput(ta) {
  const caps = stMediaCaps();
  if (stMaxRef() <= 0 && !ST.refs.length && !caps.v && !caps.a) return atClose(); // 没有任何参考素材的模型不呼出
  const m = ta.value.slice(0, ta.selectionStart).match(/@([0-9a-zA-Z一-龥]{0,12})$/);
  if (!m) return atClose();
  AT.start = m.index; AT.idx = 0;
  const items = [
    ...ST.refs.map((r, i) => ({ k: 'img', i, r, txt: '图' + (i + 1) + ' ' + String(r.value || '') })),
    ...ST.vrefs.map((r, i) => ({ k: 'vid', i, r, txt: '视频' + (i + 1) + ' ' + String(r.name || '') })),
    ...ST.arefs.map((r, i) => ({ k: 'aud', i, r, txt: '音频' + (i + 1) + ' ' + String(r.name || '') })),
  ];
  AT.items = items.filter(({ k, txt }) => {
    if (k === 'vid' && !caps.v) return false;
    if (k === 'aud' && !caps.a) return false;
    return !m[1] || txt.toLowerCase().includes(m[1].toLowerCase());
  });
  atRender(ta);
}
function atKeys(ta, e) {
  if (!AT.open) return false;
  const n = AT.items.length; // 全量可导航（菜单滚动，不再按 9 截断）
  if (e.key === 'ArrowDown' && n) { AT.idx = (AT.idx + 1) % n; atRender(ta); return true; }
  if (e.key === 'ArrowUp' && n) { AT.idx = (AT.idx - 1 + n) % n; atRender(ta); return true; }
  if (e.key === 'Enter') { if (AT.items.length) { const it = AT.items[Math.min(AT.idx, AT.items.length - 1)]; atPick(ta, it.k, it.i); return true; } atClose(); return false; }
  if (e.key === 'Escape') { atClose(); return true; }
  return false;
}

function renderStudio() {
  const isImg = ST.kind === 'image';
  const models = isImg ? ST.models : ST.vmodels;
  if (!models.some(m => m.id === ST.model)) ST.model = models[0] ? models[0].id : ''; // 换池/失效后回落首个
  const vmod = ST.vmodels.find(x => x.id === ST.model) || ST.vmodels[0];
  const imod = ST.models.find(x => x.id === ST.model) || ST.models[0];
  const resOf = (m) => (m && m.resolutions && m.resolutions.length) ? m.resolutions : [];
  const strField = (m) => { // 分辨率选择（模型有分辨率档才显示；无档模型隐藏）
    const rs = resOf(m);
    return `<div class="field" id="strf" style="${rs.length ? '' : 'display:none'}"><label>分辨率</label>
      <select id="str">${rs.map(r => `<option>${esc(r)}</option>`).join('')}</select></div>`;
  };
  shell('studio', sec('01', isImg ? '创 作 · 生 图' : '创 作 · 生 视 频', 'THE STUDIO', `
    <div class="pill-tabs">
      <button class="btn ${isImg ? 'on' : ''}" data-k="image">生图</button>
      <button class="btn ${!isImg ? 'on' : ''}" data-k="video">生视频</button>
    </div>
    <div class="studio-grid">
      <div class="studio-form">
        <div class="field" style="position:relative"><label>提示词 / Prompt（中文亦可，自动加前缀；输入 @ 引用垫图）</label>
          <textarea id="stp2" rows="4" placeholder="例：@图1 里的猫在月球上，电影感">${esc(ST.prompt || '')}</textarea>
          <div class="at-menu" id="stmenu"></div></div>
        <div class="row" style="margin-top:12px">
          <div class="field" style="flex:1;min-width:170px;position:relative"><label id="stmlab">模型</label>
            <input id="stm" autocomplete="off" placeholder="🔍 输入即搜模型，或点击选模型">
            <div class="at-menu" id="stmmenu"></div></div>
          ${isImg
            ? `<div class="field"><label>画幅</label><select id="stra">${RATIOS.map(r => `<option value="${r}">${r || '默认'}</option>`).join('')}</select></div>
               ${strField(imod)}
               <div class="field"><label>张数</label><select id="sts">${[1, 2, 3, 4].map(n => `<option>${n}</option>`).join('')}</select></div>`
            : `<div class="field"><label>画幅</label><select id="stra">${(vmod ? vmod.aspect_ratio : ['16:9', '9:16']).map(r => `<option>${esc(r)}</option>`).join('')}</select></div>
               ${strField(vmod)}
               <div class="field"><label>时长/秒</label><select id="std">${(vmod ? vmod.duration : [5, 10]).map(d => `<option>${d}</option>`).join('')}</select></div>
               ${vmod && vmod.audio ? `<div class="field" style="justify-content:flex-end"><label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="sta" checked style="width:auto"> 配音</label></div>` : ''}`}
        </div>
        <h3 class="mini" id="strefh">垫图 / 参考图</h3>
        <div id="strefzone">
          <input type="file" id="stf" accept="image/png,image/jpeg,image/webp" multiple style="font-family:var(--sans);font-size:12px">
          <div class="row" style="margin-top:8px">
            <div class="field" style="flex:1"><input id="stri" placeholder="粘贴 photo id 或图片 URL 后回车"></div>
          </div>
          <div class="thumbs" id="stt"></div>
        </div>
        ${!isImg ? `
        <h3 class="mini" id="stvh" style="display:none">参考视频</h3>
        <div id="stvzone" style="display:none">
          <input type="file" id="stvf" accept="video/mp4,video/quicktime,video/webm" multiple style="font-family:var(--sans);font-size:12px">
          <div class="thumbs" id="stvt"></div>
        </div>
        <h3 class="mini" id="stah" style="display:none">参考音频</h3>
        <div id="stazone" style="display:none">
          <input type="file" id="staf" accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/ogg,audio/flac" multiple style="font-family:var(--sans);font-size:12px">
          <div class="thumbs" id="stat"></div>
        </div>` : ''}
        <div class="price-line" id="stp"></div>
        <button class="btn pri" id="stg" style="width:100%;padding:11px">生 成</button>
      </div>
      <div id="works"></div>
    </div>`, 'studio'));
  const ta = $('#stp2');
  ta.oninput = (e) => { ST.prompt = e.target.value; atInput(e.target); };
  ta.onkeydown = (e) => { if (atKeys(e.target, e)) e.preventDefault(); };
  ta.onblur = () => setTimeout(atClose, 150); // 延迟关，让菜单点击先落地
  app.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { ST.kind = b.dataset.k; atClose(); viewStudio(); });
  const syncModel = () => { // 模型切换后时长/画幅/分辨率集合可能不同
    const m = (ST.kind === 'video' ? ST.vmodels : ST.models).find(x => x.id === ST.model);
    if (ST.kind === 'video' && m) {
      $('#std').innerHTML = m.duration.map(d => `<option>${d}</option>`).join('');
      $('#stra').innerHTML = m.aspect_ratio.map(r => `<option>${esc(r)}</option>`).join('');
    }
    const rs = (m && m.resolutions) || [], sf = $('#strf');
    if (sf) { sf.style.display = rs.length ? '' : 'none';
      if (rs.length) $('#str').innerHTML = rs.map(r => `<option>${esc(r)}</option>`).join(''); }
    stSyncPrice(); syncRefUI(); };
  // —— 模型可搜索下拉：输入框常态留空（已选项挂在标签行），输入即筛名称/ID，↑↓ 选、回车/点选确认 ——
  const stPriceTxt = (m) => isImg ? `${n2(m.price ?? 1)}分/张` : (m.priceFlat != null ? `${n2(m.priceFlat)}分/条` : `${n2(m.pricePerSec ?? 2)}分/秒`);
  // 各模型垫图/媒体槽位不同（0=不支持），选模型前就能在菜单里看清
  const stRefTxt = (m, short) => {
    if (!m) return short ? '' : '不支持垫图';
    const c = stCapOf(m, ST.kind), v = m.maxVideo || 0, a = m.maxAudio || 0;
    const media = !isImg && (v || a) ? `${v ? `视≤${v}` : ''}${v && a ? '·' : ''}${a ? `音≤${a}` : ''}` : '';
    if (c <= 0 && !media) return short ? '无参考' : '不支持垫图';
    return [c > 0 ? `垫图≤${c}` : '', media].filter(Boolean).join(' · ');
  };
  // 可选秒数：连续段折叠（4-15s），断档列全（5s · 10s），太多档显示 区间（N 档）
  const stDurTxt = (m) => {
    const d = (m.duration || []).slice().sort((a, b) => a - b); if (!d.length) return '';
    const parts = []; let s = d[0], p = d[0];
    for (const x of d.slice(1)) { if (x === p + 1) { p = x; continue; } parts.push(s === p ? `${s}s` : `${s}-${p}s`); s = p = x; }
    parts.push(s === p ? `${s}s` : `${s}-${p}s`);
    return parts.length <= 4 ? parts.join(' · ') : `${d[0]}-${d[d.length - 1]}s（${d.length} 档）`;
  };
  const mInp = $('#stm'), mMenu = $('#stmmenu');
  const MC = { open: false, idx: 0, hits: [] };
  const mClose = () => { MC.open = false; mMenu.classList.remove('on'); };
  const mShow = () => { const m = models.find(x => x.id === ST.model); // 已选模型显示在标签行，输入框始终是空搜索位
    const dur = m && !isImg ? ` · ${stDurTxt(m)}` : '';
    $('#stmlab').innerHTML = `模型 · 已选 ${m ? `<b>${esc(m.name)}</b> <span class="mono" style="font-size:10px">${esc(m.id)}</span>（${stPriceTxt(m)} · ${stRefTxt(m)}${dur}）` : '—'}`; };
  const mPick = (id) => {
    const m = models.find(x => x.id === id); if (!m) return;
    ST.model = id; mShow(); mInp.value = ''; mClose();
    syncModel();
  };
  const mPaint = () => {
    mMenu.innerHTML = MC.hits.length ? MC.hits.map((m, i) => `
      <div class="at-item ${i === MC.idx ? 'on' : ''}" data-id="${esc(m.id)}"><b>${esc(m.name)}</b>
        <span class="muted mono">${esc(m.id)}</span><span style="flex:1"></span>
        ${!isImg && stDurTxt(m) ? `<span class="muted mono" style="font-size:10.5px">${esc(stDurTxt(m))}</span>` : ''}
        <span class="muted">${stRefTxt(m, 1)}</span><span class="muted">${stPriceTxt(m)}</span></div>`).join('')
      : '<div class="at-item muted">没有匹配的模型</div>';
    mMenu.querySelectorAll('.at-item[data-id]').forEach(el => {
      el.onmousedown = (e) => { e.preventDefault(); mPick(el.dataset.id); }; // mousedown 先于 blur，保住焦点
      el.onmouseenter = () => { MC.idx = MC.hits.findIndex(m => m.id === el.dataset.id); };
    });
    mMenu.classList.add('on'); MC.open = true;
  };
  const mOpen = (q) => {
    const s = (q || '').trim().toLowerCase();
    MC.hits = models.filter(m => !s || `${m.name} ${m.id}`.toLowerCase().includes(s)).slice(0, 30);
    MC.idx = Math.max(0, MC.hits.findIndex(m => m.id === ST.model)); // 当前已选项优先高亮
    mPaint();
  };
  mShow();
  mInp.onfocus = () => { mInp.select(); mOpen(''); }; // 输入框常态为空：聚焦直接就是空搜索位
  mInp.oninput = () => mOpen(mInp.value);
  mInp.onblur = () => setTimeout(() => { mClose(); mInp.value = ''; }, 120); // 延迟关，让菜单点击先落地；离开即清空搜索词
  mInp.onkeydown = (e) => {
    if (!MC.open && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) mOpen('');
    if (!MC.open) return;
    const n = MC.hits.length;
    if (e.key === 'ArrowDown' && n) { MC.idx = (MC.idx + 1) % n; e.preventDefault(); mPaint(); }
    else if (e.key === 'ArrowUp' && n) { MC.idx = (MC.idx - 1 + n) % n; e.preventDefault(); mPaint(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (n) mPick(MC.hits[Math.min(MC.idx, n - 1)].id); else mClose(); }
    else if (e.key === 'Escape') { mClose(); mInp.value = ''; }
  };
  ['sts', 'std', 'stra', 'str'].forEach(id => { const el = $('#' + id); if (el) el.onchange = stSyncPrice; });
  $('#stf').onchange = async (e) => {
    const cap = stMaxRef();
    if (cap <= 0) { e.target.value = ''; return toast('该模型不支持垫图'); }
    let used = refBytes();
    for (const f of e.target.files) {
      if (ST.refs.length >= cap) { toast(`该模型最多 ${cap} 张垫图`); break; }
      try {
        const blob = await slimRef(f, REF_BUDGET - used); // 静默瘦身，不打扰用户（2026-09-21 用户明确：压缩过程不弹提示）
        const dataURL = await new Promise((ok, no) => { const rd = new FileReader(); rd.onload = () => ok(rd.result); rd.onerror = no; rd.readAsDataURL(blob); });
        ST.refs.push({ dataURL, bytes: blob.size }); used += blob.size;
        renderThumbs();
      } catch (err) { toast(`${f.name}: 读取失败`); }
    }
    e.target.value = '';
  };
  $('#stri').onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = e.target.value.trim(), cap = stMaxRef();
    if (v && cap > 0 && ST.refs.length < cap) { ST.refs.push({ value: v }); e.target.value = ''; renderThumbs(); }
    else if (cap <= 0) toast('该模型不支持垫图');
    else if (ST.refs.length >= cap) toast(`该模型最多 ${cap} 张垫图`);
  };
  // 媒体参考：本地文件读成 base64（不转码——压不动，超封顶直接让用户自行压缩）；prompt 用 {{vN}}/{{aN}} 引用
  const readMedia = async (files, kind) => {
    const caps = stMediaCaps();
    const arr = kind === 'video' ? ST.vrefs : ST.arefs;
    const cap = kind === 'video' ? caps.v : caps.a, label = kind === 'video' ? '视频' : '音频';
    if (ST.kind !== 'video' || cap <= 0) return toast(`该模型不支持参考${label}`);
    for (const f of files) {
      if (arr.length >= cap) { toast(`最多 ${cap} 段参考${label}`); break; }
      if (f.size > MEDIA_FILE_MAX[kind]) { toast(`${f.name}: 超 ${Math.round(MEDIA_FILE_MAX[kind] / 1048576)}MB 单文件上限，请先自行压缩`); continue; }
      try {
        const dataURL = await new Promise((ok, no) => { const rd = new FileReader(); rd.onload = () => ok(rd.result); rd.onerror = no; rd.readAsDataURL(f); });
        arr.push({ dataURL, name: f.name, bytes: f.size });
        renderMediaThumbs();
      } catch { toast(`${f.name}: 读取失败`); }
    }
  };
  const stvf = $('#stvf'), staf = $('#staf');
  if (stvf) stvf.onchange = (e) => { readMedia([...e.target.files], 'video'); e.target.value = ''; };
  if (staf) staf.onchange = (e) => { readMedia([...e.target.files], 'audio'); e.target.value = ''; };
  $('#stg').onclick = submitStudio;
  syncModel(); stSyncPrice();
  renderWorks();
}

async function submitStudio() {
  const prompt = $('#stp2').value.trim();
  if (!prompt) return toast('先写提示词');
  const body = { kind: ST.kind, prompt, model: ST.model };
  if (ST.kind === 'image') {
    body.aspect_ratio = $('#stra').value || undefined;
    body.samples = +$('#sts').value;
    body.res = stRes();
    body.ref = ST.refs.map(r => r.dataURL || r.value);
  } else {
    body.ar = $('#stra').value; body.dur = +$('#std').value; body.audio = !!($('#sta') && $('#sta').checked);
    body.res = stRes();
    const vm = ST.vmodels.find(x => x.id === body.model);
    body.ref = ST.refs.map(r => r.dataURL || r.value)
      .filter(v => !/^https?:/i.test(v) || !(vm && vm.refUploadOnly)); // refUploadOnly 模型垫图只认 photo id/base64
    body.refVideos = ST.vrefs.map(r => r.dataURL); // 服务端开槽校验+落盘+转公网 URL
    body.refAudios = ST.arefs.map(r => r.dataURL);
  }
  // 提交前粗算打包体积（dataURL 长度≈base64 字节数）：超 60MB 服务端必 413——提前拦下并点名大头，
  // 别让用户传完几分钟才吃一个网络错误（曾有大素材提交无任何反馈即此）
  const sz = (a) => a.reduce((n, v) => n + (v ? v.length : 0), 0);
  const vidMB = sz(body.refVideos || []) / 1048576, etcMB = (sz(body.ref.filter(v => !/^https?:/.test(v))) + sz(body.refAudios || [])) / 1048576;
  if (vidMB + etcMB > 60)
    return toast(`素材过大：参考视频 ${vidMB.toFixed(0)}MB + 垫图/音频 ${etcMB.toFixed(0)}MB，打包后 ${(vidMB + etcMB).toFixed(0)}MB 超单次 60MB 上限——请删减垫图或压缩参考视频`, 6000);
  const stg = $('#stg'), stgTxt = stg.textContent;
  stg.disabled = true; stg.textContent = '提交中…';
  try {
    const r = await api('POST', '/api/studio/generate', body);
    ST.jobs.unshift({ id: r.id, kind: ST.kind, status: 'queued', model: body.model, prompt,
      refs: body.ref.length + (body.refVideos || []).length + (body.refAudios || []).length,
      images: [], billing: { price: stPrice(), billed: false }, createdAt: Date.now() });
    ST.refs = []; ST.vrefs = []; ST.arefs = []; renderThumbs(); renderMediaThumbs(); // 素材随单提交完毕，清空待下一单
    renderWorks();
  } catch (e) { toast(e.message, 5000); }
  stg.disabled = false; stg.textContent = stgTxt;
}

async function pollStudio() {
  const pend = ST.jobs.filter(j => j.status === 'queued' || j.status === 'running');
  if (!pend.length) return;
  for (const j of pend) {
    try { const fresh = await api('GET', '/api/job/' + j.id); Object.assign(j, fresh); } catch { /* 视图切走 */ }
  }
  renderWorks();
  if (pend.some(j => j.status === 'done' || j.status === 'failed')) {
    ME = await api('GET', '/api/me');
    const b = $('#balv'); if (b) b.textContent = n2(ME.balance);
    const sb = $('#sbal'); if (sb) sb.textContent = n2(ME.balance); // 侧边栏余额同步
  }
}

function renderWorks() {
  const el = $('#works'); if (!el) return;
  el.innerHTML = ST.jobs.length ? ST.jobs.map(j => `
    <div class="work">
      <div class="meta">
        ${stChip(j.status)}
        <span class="tag ${j.kind === 'video' ? 'acc' : ''}">${esc(j.kind)}</span>
        <span class="mono">${esc(j.model)}</span>
        ${j.note ? `<span class="tag gd">${esc(j.note)}</span>` : ''}
        <span class="sp"></span>
        ${(j.status === 'failed' || j.status === 'cancelled') ? '<button class="btn mini" data-wretry>重试</button>' : ''}
        ${pvItemsOf(j).length ? `<span class="racts"><button class="btn mini" data-wpv>预览</button><button class="btn mini" data-wdl>下载</button></span>` : ''}
        <span class="muted">${j.refs ? `垫图×${j.refs} · ` : ''}${fmtT(j.createdAt)}</span>
        <span class="tag ${j.billing && j.billing.billed ? 'gd' : ''}">${j.billing ? (j.billing.billed ? `已扣 ${n2(j.billing.price)}` : `${n2(j.billing.price)} 积分${j.status === 'failed' ? '（未扣）' : '*'}`) : ''}</span>
      </div>
      <div style="margin-top:6px">${esc(j.prompt || '')}</div>
      ${j.error ? `<div class="st-failed" style="font-family:var(--sans);font-size:12px;margin-top:8px">✕ ${esc(j.error)}</div>` : ''}
      ${(j.images || []).map(u => `<img class="art" src="${esc(u)}" loading="lazy" data-pvw="${esc(u)}">`).join('')}
      ${j.url ? `<video controls preload="metadata" src="${esc(j.url)}" data-pvw="${esc(j.url)}"></video>` : ''}
    </div>`).join('') : '<div class="empty">尚无作品 —— 左侧开始第一次生成</div>';
  // 作品媒体点开灯箱（视频点击原图即灯箱——video 本体保留控件，只挂 dblclick 兜底）
  el.querySelectorAll('.work').forEach((div, i) => {
    const j = ST.jobs[i]; if (!j) return;
    const items = pvItemsOf(j);
    div.querySelectorAll('[data-pvw]').forEach(m => m.onclick = (e) => {
      if (m.tagName === 'VIDEO') return; // 视频元素本身带控件可播；预览走按钮
      const k = items.findIndex(x => x.url === m.dataset.pvw);
      pvOpen(items, k < 0 ? 0 : k);
    });
    const pb = div.querySelector('[data-wpv]');
    if (pb) pb.onclick = () => pvOpen(items, 0);
    const rb = div.querySelector('[data-wretry]');
    if (rb) rb.onclick = async () => { // 失败一键重试：新单插到列表顶，轮询自己接管
      rb.disabled = true;
      try {
        const r = await api('POST', `/api/job/${j.id}/retry`);
        ST.jobs.unshift({ id: r.id, kind: j.kind, status: 'queued', model: j.model, prompt: j.prompt,
          refs: j.refs, images: [], url: null, billing: { price: j.billing && j.billing.price, billed: false }, createdAt: Date.now() });
        renderWorks(); pollStudio();
        toast('已重新提交排队');
      } catch (e) { rb.disabled = false; toast(e.message); }
    };
    const dl = div.querySelector('[data-wdl]');
    if (dl) dl.onclick = () => items.forEach((it, k) => setTimeout(() => { // 多文件逐个触发，隔 400ms 免浏览器拦
      const a = document.createElement('a'); a.href = it.url; a.download = ''; a.target = '_blank'; a.rel = 'noopener'; a.click();
    }, k * 400));
  });
}

/* ---------- 路由 ---------- */
async function render() {
  if (!ME) { try { ME = await api('GET', '/api/me'); } catch { return viewLogin(); } }
  const v = (location.hash || '#/').slice(2) || (ME.role === 'admin' ? 'overview' : 'studio');
  if (v !== 'studio' && ST.timer) { clearInterval(ST.timer); ST.timer = null; }
  try {
    if (v === 'overview' && ME.role === 'admin') return await viewOverview();
    if (v === 'channel' && ME.role === 'admin') return await viewChannel();
    if (v === 'pricing' && ME.role === 'admin') return await viewPricing();
    if (v === 'topup' && ME.role === 'admin') return await viewTopup();
    const umm = v.match(/^user-models\/([a-z0-9_]+)$/);
    if (umm && ME.role !== 'user') return await viewUserModels(umm[1]);
    if (v === 'users' && ME.role !== 'user') return await viewUsers();
    if (v === 'jobs') return await viewJobs();
    const lg = v.match(/^logs(\/(act|credit))?$/); // 日志下拉：#/logs(=act) | #/logs/act | #/logs/credit
    if (lg && ME.role === 'admin') return await viewLogs(lg[2] === 'credit' ? 'credit' : 'act');
    if (v === 'studio') return await viewStudio();
    if (v === 'me') return await viewMe();
    location.hash = ME.role === 'admin' ? '#/overview' : '#/studio';
  } catch (e) { if (String(e.message).includes('未登录')) { ME = null; return viewLogin(); } shell('me', `<div class="sec"><div class="empty">${esc(e.message)}</div></div>`); }
}
window.addEventListener('hashchange', render);
render();
