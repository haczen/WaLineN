# WaLineN — 通用渠道分发网关

> 多上游聚合 · 账号池调度 · 积分计费 · 代理分销 · 统一 API
> **零依赖**（Node ≥ 18，无 npm install），单文件核心 + 插件式渠道适配器，开箱自带可跑通的演示渠道。

## 这是什么

只要你手里有**多个上游服务**（AI 生图/生视频、翻译、识别、任何「提交任务 → 等待 → 出结果」形态的服务），
WaLineN 就能把它们聚合成**一个统一入口**，并补齐商用需要的一整套东西：

| 你的问题 | WaLineN 给的答案 |
|---|---|
| 上游 A/B/C 接口各不相同 | **渠道适配器**插件：每个上游一个小文件，差异全部关在适配器里；下游只见统一 API |
| 每个上游买了好几个账号 | **账号池**：挂多个账号自动轮转，按账号限并发、挑最闲的派发，坏号一键停用 |
| 想按次收钱 / 内部结算 | **积分计费**：模型级定价（按张/按条/按秒/分辨率档），成功才扣费，失败不扣 |
| 想发展代理帮我卖 | **两级分销**：代理从自己余额给下级划拨，只能管自己的下级，越权一律 403 |
| 想对接发卡平台卖积分 | **兑换码**：批量生成 → 贴到任意发卡平台当库存 → 买家自助兑换到账 |
| API 密钥要能停能删 | **sk- 密钥**：面板签发/停用/删除，明细流水全记录 |

**任何场景、任何行业**都能套：AI 内容生成、电商出图、营销物料、设计工具后端、
教育/政务/企业内部的能力中台、多供应商比价调度……只要上游是「提交任务 → 出结果」的服务，
照抄 [`channels/_template.js`](channels/_template.js) 的形状写个适配器就能接进来。
内置演示渠道（`channels/demo.js`）不连任何上游、本地即时出占位图，
**5 分钟就能跑通 安装 → 挂账号 → 计费 → 分发 → 出结果 全流程**，再动手接真实上游。

## 架构

```
                      ┌──────────────────────────────────┐
  管理员 ── 面板 ──▶   │   WaLineN (server.js :8792)      │
  代理   ── 面板 ──▶   │   认证 / 计费 / 兑换码 / 任务分发  │
  用户   ── sk- ───▶   │   /v1/* 统一 OpenAI 风格 API     │
                      └───────┬──────────────────┬───────┘
                              │  渠道适配器（统一六件套契约）
                 ┌────────────▼───┐      ┌────────▼───────┐
                 │ channels/demo  │      │ channels/你的渠道 │
                 │ 内置演示渠道     │      │ 照抄 _template  │
                 └────────────────┘      └────────────────┘
```

- **服务端**：`server.js` 单文件（会话/计费/分发/面板 API/对外 API/静态托管），数据全部落
  `data/walinen.json`，零外部依赖。
- **渠道适配器**：`channels/*.js` 每文件一个上游，统一契约 `DEFAULTS / probe / models /
  videoModels / image / video`；上游细节（异步轮询、垫图形态、退款、转码）**全部在适配器内消化**。
  适配器还自描述元数据（名称/说明/密钥类型/设置表单字段/能力位），经 API 下发后
  **前端零改动**渲染——加渠道不用碰任何前端代码。
- **前端**：`web/` 玻璃拟态单页应用（零框架，纯 hash 路由），管理员/代理/用户三种角色一个面板。

## 5 分钟跑起来

```bash
git clone https://github.com/haczen/WaLineN.git && cd WaLineN
node server.js            # 默认 8792 端口；PORT=xxx 可改
```

首启会打印管理员引导密码（也在 `data/.bootstrap-admin`）：

```
bootstrap admin: admin / waline-xxxx  (登录后请改密)
```

打开 <http://localhost:8792>：

1. `admin / waline-xxxx` 登录 → 个人中心**改密**；
2. **渠道**页 → 添加账号 → 选「Demo 演示渠道」→ 密钥随便粘一段 ≥20 位的字符串 → 体检入库；
3. **用户**页 → 建号（给初始积分）→ 给用户**发密钥**（`sk-…` 只回显一次）；
4. **创作台（#/studio）**直接生图/生视频体验；或拿 `sk-` 密钥调 API（见下）。

演示渠道会返回本地生成的 SVG 占位图——计费、排队、并发、流水全部真实走一遍。

## 接入你的第一个真实上游

1. 复制模板：`cp channels/_template.js channels/myapi.js`（文件名 = 渠道 id，小写英文）；
2. 照文件里的 ✏️ 注释改：Base URL、鉴权头、建单/查询路径、字段映射（通常 30–100 行）；
3. 重启服务 → 面板「渠道」页自动出现新渠道 → 设置里填 Base URL → 粘账号密钥体检入库。

模型目录里每个模型带 `upstream_cost`（上游成本），首次入库自动按 **成本×10** 播种默认售价，
之后在面板「定价」页随便改（按张/按条一口价/按秒/分辨率档差异化价）。

想只保留自己要的渠道？删掉不用的 `channels/*.js` 即可——对应渠道自动停用，数据不丢。

## 角色与分销

- **管理员 admin**：铸积分（不扣自己）、建号/建代理、给任何用户分配可用模型与专属价、
  管渠道、定全局价、看全平台审计日志。
- **代理 agent**：从自身余额给**下级用户**划拨积分；只能看见和操作自己的下级；
  可给下级分配模型——但只能授自己被授过的模型。
- **用户 user**：面板创作台生图/生视频；个人中心发 `sk-` 密钥、看自己的流水、兑换充值码。
- **模型授权**：不设限制 = 全部模型·全局价；设了就只列被授权的模型，可加用户级专属价
  （一口价优先于按秒价）。未授权模型提交即 403。
- **充值**：管理员批量生成兑换码（面值=积分）→ 贴到任意发卡平台做库存 → 买家付款拿码 →
  面板「个人中心 · 充值」自助兑换，即时到账。想在面板上放购买入口，改 `web/app.js` 顶部的
  `BUY_LINKS` 登记你自己的商品链接即可（留空则按钮自动隐藏）。

## 对外 API（Bearer sk-xxx）

调用形状与渠道无关：模型跑在哪个渠道、上游接口长什么样，下游完全不感知。

```bash
# 模型清单（只列这把 key 被授权的模型；生图默认，?video=1 列视频）
curl http://host:8792/v1/models -H "Authorization: Bearer sk-xxx"
# 生图模型: {id, name, price(分/张), reference(能否垫图), aspect_ratio?, resolutions?, sizes?}
# 视频模型: {id, name, duration[], aspect_ratio[], audio, maxRef, maxVideo, maxAudio,
#            priceFlat(分/条), pricePerSec(分/秒)}

# 生图（同步；去掉 ?wait=1 则异步 202 {id} + GET /v1/images/{id} 轮询）
curl -X POST "http://host:8792/v1/images/generations?wait=1" \
  -H "Authorization: Bearer sk-xxx" -H "Content-Type: application/json" \
  -d '{"model":"demo-canvas","prompt":"a cat on the moon","aspect_ratio":"16:9","samples":2}'

# 生视频（异步 → GET /v1/videos/{id} 轮询到 done，返回体含 url）
curl -X POST "http://host:8792/v1/videos/generations" \
  -H "Authorization: Bearer sk-xxx" -H "Content-Type: application/json" \
  -d '{"model":"demo-clip","prompt":"{{1}} walks through snow","ref":["https://cdn.example.com/hero.jpg"],"ar":"16:9","dur":6}'
```

**参数速查**

- 生图：`model` · `aspect_ratio`/`ar` · `resolution`（模型有档位时）· `samples`（1–4 张，按张计费）
  · `ref` 垫图（`[URL | base64 | 数字id]`，最多 6 张，能力位 `reference:true` 才支持）· `negative`
- 生视频：`model` · `ar` · `dur`（自动吸附到该模型支持的档位，见清单 `duration[]`）· `audio`
  （默认随模型能力）· `ref` 垫图 · `refVideos`/`refAudios` 参考视频/音频（槽位见 `maxVideo`/`maxAudio`，
  未开槽的模型传了 400）
- **素材三形态**：公网 URL / base64 dataURL（服务端自动落盘 `data/uploads/`，任务终结自动清理）/
  服务器文件路径。垫图在 prompt 里用 `{{1}}`、`{{2}}` 按序指代（`@image1` 写法等效，自动归一）；
  参考视频/音频用 `{{v1}}`、`{{a1}}`。

**计费与错误**

- 成功才扣费：生图 = 单价 × samples；视频 = 一口价（有 `priceFlat` 时）或 每秒 × 时长；
  余额不足提交时 402，失败任务不动账。
- `402` 积分不足 · `403` 模型未授权（或密钥停用）· `503` 模型所属渠道暂无可用账号 ·
  `400` 参数/垫图不支持 · `413` 上传素材超限。
- 面板「日志」页有全平台操作审计 + 积分流水（铸分/划拨/任务扣费，带余额与任务号）。

## 适配器契约（`channels/*.js`）

六件套必须导出；元数据可选：

```js
module.exports = {
  // 六件套
  DEFAULTS:     { },        // 渠道设置默认值（面板表单按键名渲染）
  probe:        async (settings, token) => ({ plan, credits?, unlimited?, tokenExpires?, note? }),
  models:       async (settings, accounts) => [{ id, name, sizes?, resolutions?, reference?, upstream_cost, upstream_res_price? }],
  videoModels:  async (settings, accounts) => [{ id, name, duration[], aspect_ratio[], audio?, maxRef?, perSec?, upstream_cost }],
  image:        async (settings, acc, opts, prompt) => ({ images: [url, ...] }),
  video:        async (settings, acc, opts, prompt) => ({ url }),
  // 元数据（面板零硬编码渲染）
  NAME: '渠道名', DESC: '一句话说明', KEY_LABEL: '密钥类型',
  SETTINGS_FIELDS: { baseUrl: ['Base URL', 'text'], pollMs: ['轮询间隔 ms', 'number'] },
  CAPS: { dualMode?, autoProbe?, publicCatalog?, videoRefUploadOnly?, needsImageSize? },
  resetCache: () => {},   // 「刷新模型目录」按钮回调（可选）
};
```

能力位 `CAPS` 声明后平台自动给出对应行为，无需改服务端代码：

| 能力位 | 平台行为 |
|---|---|
| `dualMode` | 账号有 包量(unlimited)/积分(credits) 双模式调度 + credits 兜底开关 |
| `autoProbe` | 每 10 分钟自动向上游刷新账号余额/权益 |
| `publicCatalog` | 不挂账号也能拉公开模型目录（面板提前展示、播种定价） |
| `videoRefUploadOnly` | 视频垫图只认上传/base64，提交时对裸 URL 直接 400 提示 |
| `needsImageSize` | 生图要 WxH 尺寸串（平台按画幅+分辨率档自动算好 `opts.size`） |

约定：生图统一返回 `{images:[url]}`、生视频统一返回 `{url}`；「建单前」失败的报错给
`err.stage = 'submit'`，平台会按管理员配置的**模型兜底表**自动换道重提并计入可自动重试类。
完整带注释的实现在 [`channels/_template.js`](channels/_template.js)，最小可运行参考是
[`channels/demo.js`](channels/demo.js)。

## 生产部署

```bash
# Linux + systemd
cp walinen.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now walinen
journalctl -u walinen -n 5        # 看首启引导密码
```

- 端口默认 8792（`PORT` 环境变量可改）；对外请套 Nginx/Caddy 反代 + HTTPS。
- `waline.service` 里 `ExecStart` 的 node 路径按实际安装位置改（nvm / 系统包各不同）。
- **全部状态在 `data/waline.json`**（含渠道账号密钥**明文**、用户、积分、任务、日志），
  备份/迁移 = 停服务 + 拷整个目录 + 起新服务。
- 服务重启时运行中的任务会标记 failed（上游可能已完成，可面板一键重试）；失败任务自动
  重试次数默认 5（面板概览可调 0–10）。
- 建议用独立机器/容器运行，`data/` 目录 600 权限，仓库保持 **data/ 不入库**（已写进 .gitignore）。

## 目录结构

```
WaLineN/
├── server.js              # 全部核心：会话/计费/分发/面板API/对外API/静态托管（零依赖）
├── channels/              # 渠道适配器（六件套契约）
│   ├── demo.js            #   内置演示渠道（最小参考实现，本地出占位图）
│   └── _template.js       #   真实上游适配器模板（带 ✏️ 标注的脚手架）
├── web/                   # 玻璃拟态 SPA（index.html + style.css + app.js，零框架）
├── data/                  # 运行时状态（自动创建；含明文密钥，绝不入库/外发）
│   └── .bootstrap-admin   #   首启管理员引导密码
├── walinen.service        # systemd 单元
├── LICENSE                # GPL-3.0
└── README.md
```

## 已知边界

- 任务无跨重启恢复：服务重启时运行中任务标记 failed（上游可能已生成，可重试）
- 单实例架构：状态单文件载入内存，不适合超大规模多副本部署（多副本需自行改造状态层）
- `data/waline.json` 明文存密钥——机器与目录权限就是你的保险箱

## License

[GPL-3.0](LICENSE) — 任何人可自由使用/修改/分发本项目；衍生作品必须以相同协议开源并保留署名
（Copyright © 2026 haczen），不得闭源商用。
