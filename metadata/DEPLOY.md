# 部署到 GitHub Pages + Cloudflare Worker（全 7 路实时）

本终端分两部分：

| 部分 | 托管在哪 | 负责什么 |
|------|----------|----------|
| 静态前端（index.html / js / css / data） | **GitHub Pages** | 页面、个股行情(gtimg)、指数(push2)、基金估算(fundgz)、贵金属 直连 |
| 云端代理（worker.js） | **Cloudflare Worker** | 基金净值 / 基金档案(夏普α) / 自动选基 / 健康探针（服务端爬取，绕开 CORS） |

> 为什么需要 Worker：GitHub Pages 是纯静态托管，跑不了 `proxy.py` 这种服务器代码。
> 而基金净值/档案/自动选基本质是「服务端去天天基金爬数据」，浏览器直连会被 CORS + 反爬拦死。
> 把这块逻辑搬成 Worker（无服务），前端照常放 Pages，7 路数据全保住。

---

## 步骤一：部署 Worker（5 分钟，免费）

1. 安装并登录 wrangler（Cloudflare 的部署工具）：
   ```bash
   npm i -g wrangler
   wrangler login          # 弹浏览器授权你的 Cloudflare 账号
   ```
2. 在本目录部署：
   ```bash
   wrangler deploy
   ```
   成功会输出类似：
   ```
   https://a-share-terminal-proxy.<你的子域>.workers.dev
   ```
   记下这个地址。

## 步骤二：把 Worker 地址填进前端

打开 `js/api.js`，找到顶部这段：
```js
// ★ 静态部署（GitHub Pages / Vercel 等）必改：填你的 Cloudflare Worker 地址
const STATIC_PROXY_URL = "https://YOUR-WORKER-SUBDOMAIN.workers.dev";
```
把占位的 `https://YOUR-WORKER-SUBDOMAIN.workers.dev` 换成步骤一拿到的真实地址。

> 本地开发（`localhost:8000` 走 `proxy.py`）无需改这里——代码会自动判断：
> `location.hostname === "localhost"` 时 `PROXY_BASE` 为空，走同域代理；否则走上面这个 Worker 地址。

## 步骤三：把前端推上 GitHub Pages

1. 把整个项目目录推到 GitHub 仓库。
2. 仓库 Settings → Pages → Source 选 `main` 分支（或你用的分支）→ 根目录 → Save。
3. 等 1~2 分钟，访问 `https://<你的用户名>.github.io/<仓库名>/`。

打开后：
- 顶栏右侧「数据」徽章应为绿色 **数据：正常**；
- 基金区会变成 **16 只真实、带实时估算、带主题 chip** 的自动选基结果；
- 若 Worker 没起 / 地址填错，顶部会弹**红色横幅**写清原因（详见下方排错）。

---

## 排错

| 现象 | 横幅提示 | 解决 |
|------|----------|------|
| Worker 没部署 / 没填地址 | 云端代理(Cloudflare Worker)：代理不可达 → ① 确认已 `wrangler deploy` ② 在 js/api.js 填对 STATIC_PROXY_URL | 回步骤一、二 |
| Worker 在跑但天天基金被封 | 云端代理：代理在运行，但上游（天天基金）连通失败 | 改 worker.js 抓取逻辑（换接口/UA），重新 `wrangler deploy` |
| 自动选基长期为空 | 自动选基(代理)：返回为空（可能上游无匹配主题基金） | 检查 worker.js `screenRank` 关键词 |
| 个股/指数/基金估算/贵金属不更新 | 对应直连源报错 | 这些走浏览器直连，与 Worker 无关；检查网络或被封 |

---

## 本地开发模式（不改代码）

```bash
python proxy.py        # 启动本地代理（端口 8000）
# 浏览器打开 http://localhost:8000/
```
`PROXY_BASE` 会自动识别 localhost，走 `proxy.py`，与 Worker 逻辑完全一致（同一套抓取规则）。

## 换电脑 / 重装

1. 装 Python 3.8+（勾 Add to PATH）。
2. 拷整个项目目录，双击 `start.bat`（自动定位 python 并起代理）。
3. 前端改地址 / 部署 Pages 同上。

---

## 备注

- Worker 免费额度（2024 档）：每日 10 万次请求、每请求最多 50 个子请求、单次 30s 超时。
  自动选基每刷一次对上游最多 20 个子请求（20 页分批 4×5，批间 sleep 1s），远低于上限；且有 5 分钟内存缓存，正常刷新不会频繁击穿。
- 若担心 Cloudflare 数据中心 IP 被天天基金限流，可改用 **Vercel Function** 或 **小 VPS** 跑同一套逻辑——接口契约不变，前端只换 `STATIC_PROXY_URL`。
