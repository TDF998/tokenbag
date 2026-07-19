/* ============================================================
   api.js — 实时数据获取层（东方财富 push2）
   成功则覆盖示意数据并标注「实时」，失败/不可达则回退「示例」。
   所有网络请求均带超时与异常保护，绝不因接口异常中断页面。
   ============================================================ */

/* ============================================================
   DataHealth — 数据源健康监控
   每路数据（个股行情/基金估算/基金净值/基金档案/自动选基/贵金属/本地代理）
   单独打点：成功标 ok，失败标 err/warn 并附「原因 + 该换哪个脚本」提示。
   由 app.js 的 renderHealth() 在顶栏渲染状态点 + 异常红色横幅，
   任一数据源被拦截/屏蔽即显式提示，方便及时更换抓取脚本。
   ============================================================ */
window.DataHealth = (function () {
  const channels = {};          // name -> {state, msg, hint, ts}
  const listeners = [];
  function mark(name, state, msg, hint) {
    const prev = channels[name];
    const changed = !prev || prev.state !== state || prev.msg !== (msg || "");
    channels[name] = { state: state, msg: msg || "", hint: hint || "", ts: Date.now() };
    if (changed) emit();
  }
  function emit() {
    const s = summary();
    listeners.slice().forEach((cb) => { try { cb(s); } catch (e) {} });
  }
  function on(cb) { listeners.push(cb); }
  function summary() {
    const fail = Object.keys(channels)
      .filter((n) => channels[n].state !== "ok")
      .map((n) => ({ name: n, state: channels[n].state, msg: channels[n].msg, hint: channels[n].hint }));
    let level = "ok";
    if (fail.length) level = fail.some((f) => f.state === "err") ? "err" : "warn";
    return { level: level, fail: fail };
  }
  function reset() { Object.keys(channels).forEach((k) => delete channels[k]); }
  return { mark: mark, on: on, summary: summary, reset: reset, _ch: channels };
})();

window.DataAPI = (function () {
  const BASE = "https://push2.eastmoney.com";
  const CFG = window.DASHBOARD_CONFIG;
  const ILL = window.ILLUSTRATIVE;

  // ★ 静态部署（GitHub Pages / Vercel 等）必改：填你的 Cloudflare Worker 地址
  //   本地（localhost:8000 走 proxy.py）无需改，下面会自动走同域。
  const STATIC_PROXY_URL = "https://a-share-terminal-proxy.907488570.workers.dev";
  // 代理基地址：本地 → 空串（同域 /api 由 proxy.py 处理）；静态 → Worker 绝对地址。
  const PROXY_BASE = (function () {
    const h = location.hostname;
    if (h === "localhost" || h === "127.0.0.1") return "";
    return STATIC_PROXY_URL;
  })();
  // 把 /api/* 路径拼成最终请求地址（本地同域 or 云端 Worker）
  function apiUrl(p) {
    return PROXY_BASE ? (PROXY_BASE.replace(/\/+$/, "") + p) : p;
  }

  function toFloat(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (s === "" || s === "--" || s === "-") return null;
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  function withTimeout(promise, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))
    ]).finally(() => clearTimeout(t));
  }

  async function fetchJson(url, ms = 8000) {
    const res = await withTimeout(
      fetch(url, { mode: "cors", cache: "no-store", signal: null }),
      ms
    );
    let body = null;
    try { body = await res.json(); } catch (e) { /* 可能返回 HTML 拦截页而非 JSON */ }
    if (!res.ok) {
      const up = body && body.error ? " · 上游:" + body.error : "";
      throw new Error("HTTP " + res.status + up);
    }
    if (body && body.error) throw new Error("上游错误:" + body.error);
    return body;
  }

  /* 单个指数行情：主用 gtimg（无 CORS 限制），回退 push2 stock/get */
  async function fetchIndex(secid) {
    try {
      const gc = secidToGtimg(secid);
      const raw = await fetchGtimg([gc]);
      const v = raw[gc];
      if (v) {
        const p = parseGtimg(v);
        if (p.price != null && !isNaN(p.chg)) return { price: p.price, chg: p.chg };
      }
    } catch (e) { /* 落 push2 */ }
    try {
      const url =
        BASE +
        "/api/qt/stock/get?secid=" +
        secid +
        "&fields=f43,f57,f58,f170&fltt=2";
      const j = await fetchJson(url);
      if (!j || !j.data) return null;
      const price = parseFloat(j.data.f43);
      const chg = parseFloat(j.data.f170);
      if (isNaN(price) || isNaN(chg)) return null;
      return { price, chg };
    } catch (e) {
      return null;
    }
  }

  /* 主题个股实时行情：主用腾讯 gtimg JSONP（qt.gtimg.cn）。
     该接口经 <script> 注入，无 CORS 限制，浏览器直连可用；
     且纯静态托管（GitHub Pages + 自定义域名）亦可用，覆盖 A 股 + 港股。
     回退：push2 stock/get（已知本机浏览器被 CORS 拦截，仅作兜底）。
     返回 { quotes, debug }；quotes 每项含 secid 用于精确回填，避免港股前导零错位。 */

  /* secid(市场.代码) → gtimg 代码：1=sh / 0=sz / 116=hk(5位补零) */
  function secidToGtimg(secid) {
    const parts = String(secid).split(".");
    const m = parts[0];
    const code = parts[1] || "";
    if (m === "1") return "sh" + code;
    if (m === "0") return "sz" + code;
    if (m === "116") return "hk" + code.padStart(5, "0");
    if (m === "105") return "us" + code.toUpperCase();   // 美股：gtimg 前缀 us + ticker
    return "sh" + code;
  }

  /* gtimg JSONP：注入 <script>，响应为 v_xxx="..."; 全局赋值，onload 后读取。
     支持逗号批量（一次最多 ~100 只），天然跨域、无需 CORS。 */
  function fetchGtimg(codes) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      let done = false;
      const to = setTimeout(() => {
        if (!done) { done = true; cleanup(); reject(new Error("timeout")); }
      }, 9000);
      function cleanup() {
        clearTimeout(to);
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      s.onerror = () => { if (!done) { done = true; cleanup(); reject(new Error("neterr")); } };
      s.onload = () => {
        if (done) return;
        done = true; cleanup();
        const out = {};
        codes.forEach((c) => { const v = window["v_" + c]; if (v) out[c] = v; });
        resolve(out);
      };
      s.src = "https://qt.gtimg.cn/q=" + codes.join(",");
      document.head.appendChild(s);
    });
  }

  /* 解析 gtimg 单只 CSV（~ 分隔）：[1]名 [2]代码 [3]现价 [4]昨收
     [31]涨跌额 [32]涨跌% [33]换手%。涨跌% 缺失时由现价/昨收反算兜底。 */
  function parseGtimg(v) {
    const f = String(v).split("~");
    const price = toFloat(f[3]);
    const prevClose = toFloat(f[4]);
    let chg = toFloat(f[32]);
    if (chg == null && price != null && prevClose && prevClose !== 0) {
      chg = ((price - prevClose) / prevClose) * 100;
    }
    return {
      name: f[1] || "",
      code: (f[2] || "").replace(/^0+/, ""),
      price,
      chgAmt: toFloat(f[31]),
      chg,
      turnover: toFloat(f[33])
    };
  }

  async function fetchQuotes(secids) {
    const debug = { gtimgStatus: "", probe: "", error: "" };
    // 主路径：gtimg JSONP（一次请求批量拉全部）
    try {
      const codes = secids.map(secidToGtimg);
      const raw = await fetchGtimg(codes);
      const out = [];
      for (let i = 0; i < secids.length; i++) {
        const v = raw[codes[i]];
        if (!v) continue;
        const p = parseGtimg(v);
        if (p.price == null || isNaN(p.chg)) continue;
        out.push({
          secid: secids[i],
          code: p.code,
          name: p.name,
          price: p.price,
          chg: p.chg,
          chgAmt: p.chgAmt,
          mainNet: null,   // gtimg 免费接口不含主力净流入
          turnover: p.turnover,
          ts: ""
        });
      }
      if (out.length) {
        debug.gtimgStatus = "OK " + out.length + "/" + secids.length;
        if (window.DataHealth) DataHealth.mark("主题个股行情(gtimg)", "ok");
        return { quotes: out, debug };
      }
      debug.gtimgStatus = "empty";
    } catch (e) {
      debug.error = "gtimg:" + String((e && e.message) || e);
    }
    // 兜底：push2 stock/get 逐只（已知本机 CORS 拦截，大概率失败）
    try {
      const out = [];
      const B = 8;
      for (let i = 0; i < secids.length; i += B) {
        const batch = secids.slice(i, i + B);
        const rs = await Promise.all(
          batch.map((sid) => fetchQuoteOne(sid).catch(() => null))
        );
        rs.forEach((r) => { if (r && r.secid) out.push(r); });
      }
      if (out.length) {
        debug.probe = "push2 fallback " + out.length + "/" + secids.length;
        if (window.DataHealth) DataHealth.mark("主题个股行情(gtimg)", "ok");
      }
      return { quotes: out, debug };
    } catch (e) {
      debug.error += " | push2:" + String((e && e.message) || e);
      if (window.DataHealth) DataHealth.mark("主题个股行情(gtimg)", "err",
        "腾讯 gtimg 行情源不可达/被拦截" + (debug.error ? "（" + debug.error + "）" : ""),
        "腾讯 qt.gtimg.cn 行情接口不可达/被封 → 需更换行情脚本（secid 前缀 sh/sz/hk 或接口地址）");
      return { quotes: [], debug };
    }
  }

  /* 个股回退：qt/stock/get，仅取已验证可用的四字段（f43价 f57码 f58名 f170涨跌幅%）。
     注意：绝不带 f171/f62/f168 —— 实测会让个股 stock/get 返回 data:null。 */
  async function fetchQuoteOne(secid) {
    const url =
      BASE +
      "/api/qt/stock/get?secid=" +
      secid +
      "&fields=f43,f57,f58,f170&fltt=2";
    const j = await fetchJson(url, 6000);
    if (!j || !j.data) return null;
    const d = j.data;
    const price = toFloat(d.f43);
    const chg = toFloat(d.f170);
    if (price == null || chg == null) return null;
    return {
      secid,
      code: (d.f57 || "").replace(/^0+/, ""),
      name: d.f58 || "",
      price,
      chg,
      chgAmt: null,
      mainNet: null,
      turnover: null,
      ts: ""
    };
  }

  /* 把实时行情按「secid」精确回填到 themeStocks；未命中者保持「示例」。
     用 secid 而非 code，避免港股代码前导零（09880 vs 009880）错位。 */
  function applyQuotes(data, quotes) {
    if (!quotes || !quotes.length) return 0;
    const bySecid = {};
    quotes.forEach((q) => { if (q && q.secid) bySecid[q.secid] = q; });
    let live = 0;
    (data.themeStocks || []).forEach((g) =>
      g.stocks.forEach((s) => {
        const q = bySecid[s.secid];
        if (q && q.price != null && !isNaN(q.chg)) {
          s.price = q.price;
          s.chg = q.chg;
          s.chgAmt = q.chgAmt;
          s.mainNet = q.mainNet; // 元（gtimg 为 null）
          s.turnover = q.turnover;
          s.ts = q.ts;
          s.source = "实时";
          live++;
        }
      })
    );
    return live;
  }

  /* ---------- 基金实时估算净值（天天基金 fundgz 接口） ---------- */
  // 路径A：并发 fetch 文本 + 正则提取（不走全局回调，避免并发碰撞）
  async function fetchFundText(code) {
    const url = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
    const res = await withTimeout(
      fetch(url, { mode: "cors", cache: "no-store" }),
      7000
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    const txt = await res.text();
    const m = txt.match(/jsonpgz\(\{[\s\S]*\}\)/);
    if (!m) throw new Error("parse");
    return JSON.parse(m[1]);
  }

  // 路径B：JSONP 回退（顺序执行，避免 jsonpgz 全局回调碰撞）
  function fetchFundJsonp(code) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      const prev = window.jsonpgz;
      let done = false;
      const to = setTimeout(() => {
        if (!done) { done = true; cleanup(); reject(new Error("timeout")); }
      }, 7000);
      window.jsonpgz = function (d) {
        if (done) return;
        done = true; cleanup(); resolve(d);
      };
      function cleanup() {
        clearTimeout(to);
        if (s.parentNode) s.parentNode.removeChild(s);
        window.jsonpgz = prev;
      }
      s.onerror = () => { if (!done) { done = true; cleanup(); reject(new Error("err")); } };
      s.src = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
      document.head.appendChild(s);
    });
  }

  async function fetchAllFunds(cfg) {
    // 反爬：不再 Promise.all 同时轰 16 只，改为逐个间隔 200ms 发出，避免瞬间并发被识别
    const textR = [];
    for (let i = 0; i < cfg.length; i++) {
      const r = await fetchFundText(cfg[i].code).catch(() => null);
      textR.push(r);
      if (i < cfg.length - 1) await new Promise((r) => setTimeout(r, 180 + Math.random() * 60));
    }
    const out = [];
    let ok = 0;
    for (let i = 0; i < cfg.length; i++) {
      if (textR[i]) { out.push(textR[i]); ok++; }
      else { try { out.push(await fetchFundJsonp(cfg[i].code)); ok++; } catch (e) { out.push(null); } }
    }
    if (window.DataHealth) {
      if (ok === 0)
        DataHealth.mark("基金实时估算(fundgz)", "err", "天天基金 fundgz 全部失败",
          "天天基金 fundgz.1234567.com.cn 不可达/浏览器跨域被拦 → 需更换实时净值脚本（换接口或加 JSONP 兼容）");
      else if (ok < cfg.length)
        DataHealth.mark("基金实时估算(fundgz)", "warn", "部分基金估算失败（" + ok + "/" + cfg.length + "）", "同上");
      else
        DataHealth.mark("基金实时估算(fundgz)", "ok");
    }
    return out;
  }

  function applyFunds(data, results, cfg) {
    const byCode = {};
    cfg.forEach((f, i) => { const r = results[i]; if (r) byCode[f.code] = r; });
    let live = 0;
    const apply = (fund) => {
      const r = byCode[fund.code];
      if (r && r.gszzl !== undefined) {
        const chg = parseFloat(r.gszzl);
        const gsz = parseFloat(r.gsz);
        const jjjz = parseFloat(r.dwjz); // 单位净值（昨收，收盘口径）
        if (!isNaN(chg)) fund.chg = chg;
        if (!isNaN(gsz)) fund.gsz = gsz;
        if (!isNaN(jjjz)) fund.jjjz = jjjz; // 昨收净值（收盘口径，兜底用）
        if (r.name) fund.name = r.name;
        fund.source = "实时";
        fund.time = r.gztime || "";
        live++;
      }
    };
    data.funds.forEach(apply);
    (data.featuredFunds || []).forEach(apply);
    return live;
  }

  /* 官方「最新收盘」净值（天天基金净值历史 lsjz，经本地代理 /api/fund_nav 同源取，绕开 Referer 校验） */
  async function fetchFundNav(code) {
    try {
      const res = await withTimeout(
        fetch(apiUrl(`/api/fund_nav?code=${encodeURIComponent(code)}`), { cache: "no-store" }),
        8000
      );
      if (!res.ok) {
        if (window.DataHealth) DataHealth.mark("基金收盘净值(代理)", "err", "/api/fund_nav 返回 HTTP " + res.status);
        return null;
      }
      const j = await res.json();
      if (!j || j.error || j.nav === undefined) {
        if (window.DataHealth) DataHealth.mark("基金收盘净值(代理)", "err",
          j && j.error ? "上游:" + j.error : "空响应",
          "本地代理 /api/fund_nav 失败（上游天天基金 lsjz 被封）→ 运行 python proxy.py 或更新代理抓取逻辑");
        return null;
      }
      if (window.DataHealth) DataHealth.mark("基金收盘净值(代理)", "ok");
      return { nav: parseFloat(j.nav), chg: parseFloat(j.chg), date: j.date || "" };
    } catch (e) {
      if (window.DataHealth) DataHealth.mark("基金收盘净值(代理)", "err", "代理不可达:" + (e && e.message ? e.message : e),
        "本地代理未启动 → 运行 `python proxy.py`（默认端口 8000）");
      return null;
    }
  }

  /* 用官方收盘净值补全所有基金（特色 + 其他） */
  function applyNav(data, navMap) {
    const apply = (fund) => {
      const n = navMap[fund.code];
      if (n) {
        fund.closeNav = Number(n.nav);   // 官方最新收盘净值（代理返回字符串，转数字）
        fund.closeChg = Number(n.chg);  // 官方最新收盘涨跌幅（同上）
        fund.closeDate = n.date;        // 收盘日期
        fund.closeLive = true;
      }
    };
    (data.funds || []).forEach(apply);
    (data.featuredFunds || []).forEach(apply);
  }

  /* 基金档案：经理 + 夏普 + 阿尔法（本地计算，走同源代理） */
  async function fetchFundProfile(code, win) {
    try {
      const res = await withTimeout(
        fetch(apiUrl(`/api/fund_profile?code=${encodeURIComponent(code)}&window=${encodeURIComponent(win || "1y")}`), { cache: "no-store" }),
        18000
      );
      if (!res.ok) {
        if (window.DataHealth) DataHealth.mark("基金档案(代理)", "err", "/api/fund_profile 返回 HTTP " + res.status);
        return null;
      }
      const j = await res.json();
      if (!j || j.error) {
        if (window.DataHealth) DataHealth.mark("基金档案(代理)", "err",
          j && j.error ? "上游:" + j.error : "空响应",
          "本地代理 /api/fund_profile 失败（上游天天基金被封）→ 运行 python proxy.py 或更新代理抓取逻辑");
        return null;
      }
      if (window.DataHealth) DataHealth.mark("基金档案(代理)", "ok");
      return j;
    } catch (e) {
      if (window.DataHealth) DataHealth.mark("基金档案(代理)", "err", "代理不可达:" + (e && e.message ? e.message : e),
        "本地代理未启动 → 运行 `python proxy.py`（默认端口 8000）");
      return null;
    }
  }

  function applyProfile(data, p) {
    const find = (arr) => (arr || []).find((x) => x.code === p.code);
    const f = find(data.funds) || find(data.featuredFunds);
    if (!f) return;
    f.manager = p.manager || null;
    f.workTime = p.workTime || null;
    f.workDays = p.workDays != null ? p.workDays : null;
    f.managerChanged = !!p.managerChanged;
    f.sharpe = p.sharpe != null ? p.sharpe : null;
    f.alpha = p.alpha != null ? p.alpha : null;
    f.beta = p.beta != null ? p.beta : null;
    f.profileNote = p.note || "";
    f.window = p.window || null;
    f.windowLabel = p.windowLabel || "";
    f.profileLive = true;
  }

  /* 静态提交数据（GitHub Pages 部署用，无需本地代理）：data/funds.json
     结构：{ generatedAt, funds: { code: {
       closeNav, closeChg, closeDate, manager, workTime, managerChanged,
       windows: { "1y":{sharpe,alpha,beta}, "6m":{...}, "3m":{...} } } } }
     由 gen_data.py（GitHub Actions 每日生成）写入仓库；本地无该文件时回落代理。 */
  async function fetchFundsJson() {
    try {
      const res = await withTimeout(
        fetch("data/funds.json", { cache: "no-store" }),
        6000
      );
      if (!res.ok) return null;
      const j = await res.json();
      if (!j || !j.funds) return null;
      return j;
    } catch (e) {
      return null; // 本地无该文件 / 部署未生成 → 回落代理
    }
  }
  function applyFundsJson(data, j, win) {
    const fnd = j.funds || {};
    const apply = (fund) => {
      const rec = fnd[fund.code];
      if (!rec) return;
      if (rec.closeNav != null) { fund.closeNav = Number(rec.closeNav); fund.closeLive = true; }
      if (rec.closeChg != null) fund.closeChg = Number(rec.closeChg);
      if (rec.closeDate) fund.closeDate = rec.closeDate;
      if (rec.manager) fund.manager = rec.manager;
      if (rec.workTime) fund.workTime = rec.workTime;
      fund.managerChanged = !!rec.managerChanged;
      // 取当前窗口；缺失则回落 1y / 任意可用窗口
      const w =
        (rec.windows && (rec.windows[win] || rec.windows["1y"])) ||
        (rec.windows && Object.values(rec.windows)[0]) ||
        null;
      if (w) {
        fund.sharpe = w.sharpe != null ? w.sharpe : null;
        fund.alpha = w.alpha != null ? w.alpha : null;
        fund.beta = w.beta != null ? w.beta : null;
      }
      fund.window = win;
      fund.profileLive = true;
    };
    (data.funds || []).forEach(apply);
    (data.featuredFunds || []).forEach(apply);
  }

  /* 有色金属（贵金属）静态数据：data/metals.json
     由 GitHub Action（gen_data.py 服务端）每日生成，含国际金银现货价 + 人民币每克 + 涨跌%；
     页面静态读取（同源、纯静态托管可用）；本地无该文件时回退 CFG.metalCards / ILLUSTRATIVE.metals 示例。 */
  async function fetchMetalsJson() {
    try {
      const res = await withTimeout(
        fetch("data/metals.json", { cache: "no-store" }),
        6000
      );
      if (!res.ok) return null;
      const j = await res.json();
      if (!j || !j.gold) return null;
      return j;
    } catch (e) {
      return null; // 本地无该文件 / 部署未生成 → 回退示例
    }
  }
  function applyMetals(data, j, srcOverride) {
    if (!data.metals) data.metals = {};
    ["gold", "silver"].forEach((k) => {
      const r = j[k];
      if (!r) return;
      if (!data.metals[k]) data.metals[k] = {};
      if (typeof r.intlUsd === "number") data.metals[k].intlUsd = r.intlUsd;
      if (typeof r.rmbPerG === "number") data.metals[k].rmbPerG = r.rmbPerG;
      if (typeof r.chg === "number") data.metals[k].chg = r.chg;
      data.metals[k].source = srcOverride || "实时";
      data.metals[k].updated = j.generatedAt || "";
    });
  }

  /* 浏览器直拉实时金银价：CORS 开放源 api.gold-api.com（无需 key）+ open.er-api.com（汇率）
     返回 { gold:{intlUsd,rmbPerG}, silver:{intlUsd,rmbPerG} } 或 null。
     说明：gold-api 只返现价（无涨跌%），涨跌% 由静态 data/metals.json 的当日基准提供。 */
  async function fetchMetalsLive() {
    try {
      const [gx, sx, fx] = await Promise.all([
        withTimeout(fetch("https://api.gold-api.com/price/XAU", { cache: "no-store" }), 9000),
        withTimeout(fetch("https://api.gold-api.com/price/XAG", { cache: "no-store" }), 9000),
        withTimeout(fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" }), 9000),
      ]);
      if (!gx.ok || !sx.ok || !fx.ok) {
        if (window.DataHealth) DataHealth.mark("贵金属实时(gold-api)", "err", "行情接口返回非 200");
        return null;
      }
      const gj = await gx.json();
      const sj = await sx.json();
      const fj = await fx.json();
      const cny = fj.rates && fj.rates.CNY ? parseFloat(fj.rates.CNY) : null;
      if (!gj.price || !sj.price || !cny) return null;
      const toRmbG = (usd) => Math.round((usd * cny / 31.1035) * 100) / 100;
      if (window.DataHealth) DataHealth.mark("贵金属实时(gold-api)", "ok");
      return {
        gold:   { intlUsd: gj.price, rmbPerG: toRmbG(gj.price) },
        silver: { intlUsd: sj.price, rmbPerG: toRmbG(sj.price) },
      };
    } catch (e) {
      if (window.DataHealth) DataHealth.mark("贵金属实时(gold-api)", "err", "国际金银行情源不可达:" + (e && e.message ? e.message : e),
        "api.gold-api.com 不可达/被封 → 需更换贵金属实时脚本（换行情源）");
      return null; // 直拉失败（网络/CORS）→ 回退静态 data/metals.json
    }
  }

  /* 根据当前数据状态重算实时计数与比例（load / refresh 共用，避免增量累加出错） */
  function recomputeMeta(data) {
    let live = 0;
    Object.keys(data.indexes).forEach((k) => { if (data.indexes[k].source === "实时") live++; });
    if (data.northbound.source === "实时") live++;
    (data.funds || []).forEach((f) => { if (f.source === "实时") live++; });
    (data.featuredFunds || []).forEach((f) => { if (f.source === "实时") live++; });
    let themeN = 0;
    (data.themeStocks || []).forEach((g) =>
      g.stocks.forEach((s) => { if (s.source === "实时") live++; themeN++; })
    );
    data.meta.liveCount = live;
    data.meta.total =
      Object.keys(data.indexes).length +
      1 +
      (data.funds ? data.funds.length : 0) +
      (data.featuredFunds ? data.featuredFunds.length : 0) +
      themeN;
    data.meta.live = live > 0;
  }

  /* 原地刷新行情（仅指数，不触碰基金），避免回退示意造成卡片闪烁 */
  async function refreshMarkets(data) {
    const indexPs = CFG.indexes.map((ix) =>
      fetchIndex(ix.secid)
        .then((r) => ({ key: ix.key, r }))
        .catch(() => ({ key: ix.key, r: null }))
    );
    const indexResults = await Promise.all(indexPs);
    indexResults.forEach(({ key, r }) => {
      if (r) {
        data.indexes[key].price = r.price;
        data.indexes[key].chg = r.chg;
        data.indexes[key].source = "实时";
      }
    });
    recomputeMeta(data);
    return data;
  }

  /* 主入口：返回合并后的数据对象 */
  async function load() {
    // 深拷贝示意数据作为基线
    const data = JSON.parse(JSON.stringify(ILL));
    const meta = { live: false, liveCount: 0, total: 0, updated: new Date(), northLive: false };

    // 指数基线标记（板块/北向已移除，页面聚焦主题个股+基金）
    Object.keys(data.indexes).forEach((k) => (data.indexes[k].source = "示例"));
    data.northbound.source = "示例";

    // 主题个股：基线取自 CFG（含示例兜底价/涨幅），实时由 app 层 loadQuotes 覆盖
    data.themeStocks = JSON.parse(JSON.stringify(CFG.themeStocks || []));
    (data.themeStocks || []).forEach((g) =>
      g.stocks.forEach((s) => { if (s.source === undefined) s.source = "示例"; })
    );

    // 有色金属（贵金属）：基线取自 ILLUSTRATIVE.metals（示例兜底），实时由 loadMetals 覆盖
    data.metals = {};
    Object.keys(ILL.metals || {}).forEach((k) => {
      data.metals[k] = Object.assign({}, ILL.metals[k], { source: "示例" });
    });

    // 并行拉取：各指数（板块/北向已移除，页面聚焦主题个股+基金）
    const indexPs = CFG.indexes.map((ix) =>
      fetchIndex(ix.secid)
        .then((r) => ({ key: ix.key, r }))
        .catch(() => ({ key: ix.key, r: null }))
    );

    const indexResults = await Promise.all(indexPs);

    // 覆盖指数
    let liveIndex = 0;
    indexResults.forEach(({ key, r }) => {
      if (r) {
        data.indexes[key].price = r.price;
        data.indexes[key].chg = r.chg;
        data.indexes[key].source = "实时";
        liveIndex++;
      }
    });

    // 基金：基线来自示意，实时部分由 app 层非阻塞后台回填（避免阻塞首屏渲染）
    data.funds.forEach((f) => { if (f.source === undefined) f.source = "示例"; });
    (data.featuredFunds || []).forEach((f) => { if (f.source === undefined) f.source = "示例"; });

    data.meta = meta;
    recomputeMeta(data);
    return data;
  }

  /* 自动选基：调本地代理 /api/fund_screen，对候选池按指标排序取 Top N
     返回 [{code, mom1m}]（已按降序）；异常/空池返回 []，由调用方回落静态 funds */
  async function fetchFundScreen(uni, top = 16, metric = "1m") {
    const codes = (uni || []).map((f) => f.code).filter(Boolean);
    if (!codes.length) return [];
    const url =
      apiUrl(`/api/fund_screen?codes=${encodeURIComponent(codes.join(","))}`) +
      `&metric=${encodeURIComponent(metric)}&top=${top}`;
    try {
      const j = await fetchJson(url, 20000);
      if (j && j.result && j.result.length) {
        if (window.DataHealth) DataHealth.mark("自动选基(代理)", "ok");
        return j.result;
      }
      if (window.DataHealth) DataHealth.mark("自动选基(代理)", "warn", "返回为空（可能上游无匹配主题基金）",
        "若长期为空且非预期 → 检查 proxy.py _screen_rank 抓取逻辑");
      return [];
    } catch (e) {
      if (window.DataHealth) DataHealth.mark("自动选基(代理)", "err", "代理调用失败:" + (e && e.message ? e.message : e),
        "本地代理 /api/fund_screen 失败（天天基金排行榜被封/超时）→ 运行 python proxy.py 或更新 _screen_rank 抓取逻辑");
      return [];
    }
  }

  return { load, fetchAllFunds, applyFunds, fetchFundNav, applyNav, fetchFundProfile, applyProfile, fetchQuotes, applyQuotes, fetchFundsJson, applyFundsJson, fetchMetalsJson, applyMetals, fetchMetalsLive, refreshMarkets, recomputeMeta, fetchFundScreen, fetchJson, apiUrl, PROXY_BASE };
})();
