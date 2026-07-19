// =====================================================================
//  worker.js — Cloudflare Worker 版基金数据代理
//  移植自本地 proxy.py；GitHub Pages 只托管静态前端，
//  此 Worker 负责 /api/* 四个服务端端点（绕开浏览器 CORS + 反爬）。
//
//  端点：
//    /api/fund_nav      -> 天天基金 lsjz 最新官方收盘净值/涨跌
//    /api/fund_profile  -> 基金经理 + 夏普比率 + 詹森α（历史净值本地实算）
//    /api/fund_screen   -> 真·自动选基：爬天天基金排行榜，过滤 AI/半导体/科技 主题，Top N
//    /api/health        -> 健康探针：区分「Worker 没起」与「上游被封」
//
//  部署：wrangler login && wrangler deploy（见 wrangler.toml）
//  前端 js/api.js 的 STATIC_PROXY_URL 须指向本 Worker 地址。
// =====================================================================

// ---------- 常量（与 proxy.py 对齐） ----------
const RF = 0.02;                 // 无风险年化利率
const TRADING_DAYS = 252;
const WINDOWS = { "1y": 13, "6m": 7, "3m": 4 };   // 页 × 20 ≈ 交易日
const WINDOW_LABEL = { "1y": "近1年", "6m": "近半年", "3m": "近3月" };
const BENCH_CODE = "510300";     // 沪深300ETF 作 CAPM 市场基准

const SCREEN_TTL = 300;         // 筛选结果内存缓存（秒），避免每次刷新重轰接口

// 主题关键词 -> 主题键（与 data.js 主题个股 7 分组对齐：core/semi/storage/robot/ai/tech/terminal）
const THEME_RULES = [
  ["半导体", ["semi", "core"]], ["芯片", ["semi", "storage", "core"]],
  ["集成电路", ["semi", "core"]], ["算力", ["semi", "core", "ai"]],
  ["光模块", ["semi", "core", "ai"]], ["CPO", ["semi", "core", "ai"]],
  ["存储", ["storage", "semi"]], ["内存", ["storage", "semi"]],
  ["电子", ["semi", "terminal", "tech"]], ["消费电子", ["terminal", "semi", "tech"]],
  ["5G", ["semi", "storage", "ai", "tech", "terminal"]],
  ["通信", ["semi", "storage", "ai", "tech", "terminal"]],
  ["通讯", ["semi", "storage", "ai", "tech", "terminal"]],
  ["人工智能", ["ai", "tech", "core"]], ["AI", ["ai", "tech", "core"]],
  ["智能", ["ai", "tech"]], ["机器人", ["robot", "ai", "tech", "core"]],
  ["机器视觉", ["robot", "ai", "tech", "core"]], ["工业自动化", ["robot", "ai", "tech", "core"]],
  ["具身", ["robot", "ai", "tech", "core"]],
  ["软件", ["tech", "ai", "terminal"]], ["计算机", ["tech", "ai", "terminal"]],
  ["信息", ["tech", "ai", "terminal"]], ["云计算", ["tech", "ai", "terminal"]],
  ["大数据", ["tech", "ai", "terminal"]], ["数字经济", ["tech", "ai", "terminal"]],
  ["互联网", ["tech", "ai", "terminal"]], ["物联网", ["tech", "ai", "terminal"]],
  ["网络安全", ["tech", "ai", "terminal"]], ["游戏", ["tech", "ai"]],
  ["动漫", ["tech", "ai"]], ["文化", ["tech", "ai"]], ["传媒", ["tech", "ai"]],
  ["科创", ["tech", "core", "semi"]], ["创业板", ["tech", "core"]],
  ["新能源", ["ai", "tech"]], ["电池", ["ai", "tech"]], ["光伏", ["ai", "tech"]],
  ["汽车", ["ai", "tech"]], ["科技", ["tech", "ai", "core"]],
];

// 否定词：含以下任一则非本主题（剔除生物/消费/金融/债/QDII/港股通/海外）
const DENY_THEME = [
  "生物", "医药", "医疗", "健康", "养老", "疫苗", "中药", "创新药", "医疗器械",
  "消费", "食品", "饮料", "白酒", "农业", "畜牧", "猪肉",
  "银行", "证券", "保险", "地产", "房地产", "煤炭", "钢铁", "石油", "化工",
  "军工", "国防", "债券", "债", "货币",
  "QDII", "港股", "恒生", "海外", "全球", "中美", "纳斯达克", "纳指",
  "中概", "中国互联网", "境外", "国际",
];

// 指标 -> rankhandler 字段下标（已核对：idx7=近1周 idx8=近1月 idx9=近3月 idx10=近6月）
const METRIC_IDX = { "1w": 7, "1m": 8, "3m": 9, "6m": 10 };

// ---------- 内存缓存（isolate 生命周期内，足够覆盖 5 分钟刷新节奏） ----------
const _screenCache = new Map();
const _benchCache = new Map();

// ---------- 工具 ----------
function fmtDate(ts) {
  return new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD（UTC，对 32 天窗口无影响）
}

async function fetchText(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://fundf10.eastmoney.com/" },
  });
  return await r.text();
}
async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function themesOf(name) {
  const n = name || "";
  for (const d of DENY_THEME) if (n.indexOf(d) >= 0) return [];
  const out = [];
  for (const [kw, keys] of THEME_RULES) {
    if (n.indexOf(kw) >= 0) {
      for (const k of keys) if (out.indexOf(k) < 0) out.push(k);
    }
  }
  return out;
}

function fundFamily(name) {
  let n = name || "";
  n = n.replace(/[（(][^）)]*[)）]/g, "");             // 去括号 (QDII)/(LOF)
  for (const suf of ["ETF联接", "联接", "指数", "混合", "股票", "债券", "货币",
    "发起式", "发起", "精选", "LOF", "QDII", "分级"]) n = n.split(suf).join("");
  n = n.replace(/\s*[A-Fa-f]$/, "");                  // 去末尾份额字母 A/B/C…
  return n.trim();
}

// ---------- 净值历史 / 收益统计 ----------
async function navHistory(code, pages) {
  const out = [];
  const reqs = [];
  for (let pg = 1; pg <= pages; pg++) {
    const u = "https://api.fund.eastmoney.com/f10/lsjz?fundCode=" + code +
      "&pageIndex=" + pg + "&pageSize=20&startDate=&endDate=&_=" + Date.now();
    reqs.push(
      fetch(u, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://fundf10.eastmoney.com/" } })
        .then((r) => r.json())
        .then((j) => ((j.Data || {}).LSJZList) || [])
        .catch(() => [])
    );
  }
  const lists = await Promise.all(reqs);
  for (const lst of lists) {
    for (const it of lst) {
      const v = it.DWJZ;
      const f = parseFloat(v);
      if (!isNaN(f)) out.push(f);
    }
  }
  out.reverse(); // page1=最新…pageN=最早 -> 升序
  return out;
}

function extractManager(text) {
  const m = text.match(/Data_currentFundManager\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) return [null, null];
  const seg = m[1];
  const nm = seg.match(/"name"\s*:\s*"([^"]*)"/);
  const wt = seg.match(/"workTime"\s*:\s*"([^"]*)"/);
  return [nm ? nm[1] : null, wt ? wt[1] : null];
}
function parseWorkTime(s) {
  if (!s) return null;
  const y = s.match(/(\d+)年/), d = s.match(/(\d+)天/);
  return (y ? parseInt(y[1], 10) : 0) * 365 + (d ? parseInt(d[1], 10) : 0);
}

function dailyRets(navs) {
  const o = [];
  for (let i = 1; i < navs.length; i++) o.push(navs[i] / navs[i - 1] - 1);
  return o;
}
function mean(x) { return x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0; }
function std(x) {
  const n = x.length;
  if (n < 2) return 0;
  const m = mean(x);
  return Math.sqrt(x.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1));
}
function sharpe(navs, rf = RF) {
  if (navs.length < 40) return null;
  const r = dailyRets(navs);
  const mr = mean(r), sd = std(r);
  if (sd === 0) return null;
  return (mr * TRADING_DAYS - rf) / (sd * Math.sqrt(TRADING_DAYS));
}
function alpha(navs, bnavs, rf = RF) {
  if (navs.length < 40 || bnavs.length < 40) return [null, null];
  const rfd = rf / TRADING_DAYS;
  let r = dailyRets(navs), b = dailyRets(bnavs);
  const n = Math.min(r.length, b.length);
  if (n < 40) return [null, null];
  r = r.slice(-n); b = b.slice(-n);
  const mr = mean(r), mb = mean(b);
  const cov = r.reduce((a, _, i) => a + (r[i] - mr) * (b[i] - mb), 0) / (n - 1);
  const varb = b.reduce((a, v) => a + (v - mb) ** 2, 0) / (n - 1);
  const beta = varb ? cov / varb : 0;
  const ad = mean(r.map((ri, i) => (ri - rfd) - beta * (b[i] - rfd)));
  return [ad * TRADING_DAYS * 100, beta];
}
async function benchNavs(pages) {
  if (_benchCache.has(pages)) return _benchCache.get(pages);
  const o = await navHistory(BENCH_CODE, pages);
  _benchCache.set(pages, o);
  return o;
}

// ---------- 自动选基 ----------
function parseRankRows(txt, idx) {
  const i = txt.indexOf("datas:[");
  if (i < 0) return [];
  const j = txt.lastIndexOf("]");
  if (j <= i) return [];
  const seg = txt.slice(i + 7, j);
  const quoted = seg.match(/"([^"]*)"/g) || [];
  const out = [];
  for (const q of quoted) {
    const p = q.slice(1, -1).split(",");
    if (p.length <= idx) continue;
    const code = p[0].replace(/\D/g, "");
    const name = p[1];
    if (!code) continue;
    const mom = parseFloat(p[idx].replace("%", "")) / 100;
    if (isNaN(mom)) continue;
    const themes = themesOf(name);
    if (!themes.length) continue;
    out.push({ code, name, mom1m: Math.round(mom * 1e6) / 1e6, themes });
  }
  return out;
}

async function screenRank(top = 16, metric = "1m") {
  const idx = METRIC_IDX[metric] || 8;
  const sd = fmtDate(Date.now() - 32 * 86400 * 1000);
  const ed = fmtDate(Date.now());
  const PAGES = 20, BATCH = 4;
  const seen = {};
  for (let bs = 1; bs <= PAGES; bs += BATCH) {
    const pages = [];
    for (let p = bs; p < Math.min(bs + BATCH, PAGES + 1); p++) pages.push(p);
    const reqs = pages.map((pi) => {
      const u = "https://fund.eastmoney.com/data/rankhandler.aspx" +
        "?op=ph&dt=kf&ft=all&rs=&gs=0&sc=1yzf&st=desc" +
        "&sd=" + sd + "&ed=" + ed + "&qdii=&tabSubtype=,,,,,&pi=" + pi + "&pn=500&dx=1";
      return fetch(u, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "http://fund.eastmoney.com/" } })
        .then((r) => r.text())
        .then((t) => parseRankRows(t, idx))
        .catch(() => []);
    });
    const batchRows = await Promise.all(reqs);
    for (const rows of batchRows) for (const row of rows) if (!(row.code in seen)) seen[row.code] = row;
    if (bs + BATCH <= PAGES) await new Promise((r) => setTimeout(r, 1000));
  }
  // 按基金族去重（A/C 份额合并，保留动量最高）
  const famMap = {};
  for (const row of Object.keys(seen).map((k) => seen[k])) {
    const fam = fundFamily(row.name);
    const cur = famMap[fam];
    if (!cur || row.mom1m > cur.mom1m) famMap[fam] = row;
  }
  const rows = Object.keys(famMap).map((k) => famMap[k]);
  rows.sort((a, b) => b.mom1m - a.mom1m);
  return rows.slice(0, top);
}

// ---------- 端点处理 ----------
async function handleNav(url, request) {
  const code = (url.searchParams.get("code") || "").replace(/\D/g, "");
  if (!code) return jsonResponse({ error: "missing code" }, 400, request);
  const u = "https://api.fund.eastmoney.com/f10/lsjz?fundCode=" + code +
    "&pageIndex=1&pageSize=1&startDate=&endDate=&_=" + Date.now();
  try {
    const data = await fetchJson(u + "");
    const lst = ((data.Data || {}).LSJZList) || [];
    if (lst.length) {
      const row = lst[0];
      return jsonResponse({ code, date: row.FSRQ, nav: row.DWJZ, chg: row.JZZZL }, 200, request);
    }
    return jsonResponse({ code, error: "empty", raw: data.ErrCode }, 200, request);
  } catch (e) {
    return jsonResponse({ error: String((e && e.message) || e) }, 502, request);
  }
}

async function handleProfile(url, request) {
  const code = (url.searchParams.get("code") || "").replace(/\D/g, "");
  if (!code) return jsonResponse({ error: "missing code" }, 400, request);
  let win = url.searchParams.get("window") || "1y";
  if (!(win in WINDOWS)) win = "1y";
  const pages = WINDOWS[win];
  try {
    const [txt, navs] = await Promise.all([
      fetchText("https://fund.eastmoney.com/pingzhongdata/" + code + ".js")
        .catch(() => ""),
      navHistory(code, pages),
    ]);
    const [mgr, wt] = extractManager(txt);
    const wd = parseWorkTime(wt);
    const changed = wd !== null && wd < 365;
    const bnavs = await benchNavs(pages);
    const sh = sharpe(navs);
    const [al, be] = sh === null ? [null, null] : alpha(navs, bnavs);
    return jsonResponse({
      code, window: win, windowLabel: WINDOW_LABEL[win],
      manager: mgr, workTime: wt, workDays: wd, managerChanged: changed,
      benchmark: BENCH_CODE,
      sharpe: sh !== null ? Math.round(sh * 1000) / 1000 : null,
      alpha: al !== null ? Math.round(al * 100) / 100 : null,
      beta: be !== null ? Math.round(be * 1000) / 1000 : null,
      navCount: navs.length, benchCount: bnavs.length,
      note: "夏普=" + WINDOW_LABEL[win] + "净值年化(rf=2%)；阿尔法=CAPM(基准" + BENCH_CODE + ")",
    }, 200, request);
  } catch (e) {
    return jsonResponse({ error: String((e && e.message) || e) }, 502, request);
  }
}

async function handleScreen(url, request) {
  const metric = url.searchParams.get("metric") || "1m";
  let top = parseInt(url.searchParams.get("top") || "16", 10);
  if (!top || top < 1 || top > 60) top = 16;
  const key = metric + ":" + top;
  const now = Date.now() / 1000;
  const cached = _screenCache.get(key);
  if (cached && now - cached.t < SCREEN_TTL) {
    return jsonResponse({ cached: true, metric, top, count: cached.rows.length, result: cached.rows }, 200, request);
  }
  try {
    const rows = await screenRank(top, metric);
    _screenCache.set(key, { t: now, rows });
    return jsonResponse({ cached: false, metric, top, count: rows.length, result: rows }, 200, request);
  } catch (e) {
    return jsonResponse({ error: String((e && e.message) || e) }, 502, request);
  }
}

async function handleHealth(request) {
  let upOk = false, upErr = "";
  try {
    const sd = fmtDate(Date.now() - 32 * 86400 * 1000);
    const ed = fmtDate(Date.now());
    const u = "https://fund.eastmoney.com/data/rankhandler.aspx" +
      "?op=ph&dt=kf&ft=all&rs=&gs=0&sc=1yzf&st=desc" +
      "&sd=" + sd + "&ed=" + ed + "&qdii=&tabSubtype=,,,,,&pi=1&pn=1&dx=1";
    const txt = await fetchText(u);
    upOk = txt.indexOf("datas:[") >= 0;
    if (!upOk) upErr = "上游响应异常（无 datas 段）";
  } catch (e) {
    upErr = String((e && e.message) || e);
  }
  return jsonResponse({
    proxy: "ok", upstream_ok: upOk, upstream_err: upErr, ts: Math.floor(Date.now() / 1000),
  }, 200, request);
}

// ---------- CORS / 响应 ----------
function corsHeaders(request) {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Cache-Control": "no-store",
  };
}
function jsonResponse(obj, status = 200, request) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, corsHeaders(request)),
  });
}

// ---------- 入口 ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    try {
      if (p.startsWith("/api/fund_nav")) return await handleNav(url, request);
      if (p.startsWith("/api/fund_profile")) return await handleProfile(url, request);
      if (p.startsWith("/api/fund_screen")) return await handleScreen(url, request);
      if (p.startsWith("/api/health")) return await handleHealth(request);
      return jsonResponse({ error: "not found", note: "此 Worker 仅代理 /api/*，静态文件由 GitHub Pages 提供" }, 404, request);
    } catch (e) {
      return jsonResponse({ error: String((e && e.message) || e) }, 502, request);
    }
  },
};

// 导出供 Node 端到端测试（不影响 Cloudflare 运行）
export { screenRank, navHistory, benchNavs, sharpe, alpha, themesOf, fundFamily };
