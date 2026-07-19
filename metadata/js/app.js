/* ============================================================
   app.js — 仪表盘渲染与编排
   依赖：data.js / api.js / charts.js
   ============================================================ */

(function () {
  "use strict";
  const CFG = window.DASHBOARD_CONFIG;
  const $ = (id) => document.getElementById(id);
  // 是否有「服务端代理」可用：
  //   - 本地（http://localhost:8000）走 proxy.py（同域） → true
  //   - 静态托管（GitHub Pages）+ Cloudflare Worker → true
  //   - 仅 file:// 直开（无服务器）时为 false（自动选基/净值/档案静默回退，不报代理错）
  const PROXY_MODE = !(location.protocol === "file:");

  let STATE = null; // 当前数据集
  let CUR_WIN = "1y"; // 风险指标（夏普/阿尔法）计算窗口：1y/6m/3m

  /* 主题交叉筛选状态：点击「主题个股分组」→ 过滤基金(fundTheme)；点击「基金主题标签」→ 过滤个股(stockTheme) */
  let FILTER = { fundTheme: null, stockTheme: null };
  /* 主题标签中文名（分组 theme 键 ↔ 卡片展示标签） */
  const THEME_LABEL = {
    core: "基础层", semi: "半导体", storage: "存储", robot: "机器人",
    ai: "AI", tech: "科技制造", terminal: "AI终端", newenergy: "新能源",
    consume: "消费", medical: "医药", metal: "有色金属",
    broad: "宽基", us: "美股", bond: "债券", active: "主动混合"
  };
  const themeLabel = (k) => THEME_LABEL[k] || k;

  /* ---------- 工具函数 ---------- */
  const fmtPct = (v) =>
    (v > 0 ? "+" : "") + (v >= 0 && v < 0.005 ? "0.00" : v.toFixed(2)) + "%";
  const fmtNet = (v) => (v > 0 ? "+" : "") + v.toFixed(1);
  const cls = (v) => (v > 0.001 ? "up" : v < -0.001 ? "down" : "flat");

  /* 热力配色：scale = 满色边界（正负对称），alpha 控制不透明度（个股卡用半透明保留深色底） */
  function heatColor(pct, scale = 4, alpha = 1) {
    const s = scale > 0 ? scale : 4;
    const v = Math.max(-s, Math.min(s, Number(pct) || 0));
    const t = Math.abs(v) / s;
    const rgba = (r, g, b) => `rgba(${r},${g},${b},${alpha})`;
    if (v >= 0) {
      const r = Math.round(26 + t * (246 - 26));
      const g = Math.round(32 + t * (70 - 32));
      const b = Math.round(48 + t * (93 - 48));
      return rgba(r, g, b);
    } else {
      const r = Math.round(26 + t * (22 - 26));
      const g = Math.round(32 + t * (199 - 32));
      const b = Math.round(48 + t * (132 - 48));
      return rgba(r, g, b);
    }
  }

  /* 动态缩放比例：取当前这批实时涨跌幅的最强绝对值，下限 floor% 防极平静日噪声放大，
     ceil 到 0.5 便于图例读数。无实时数据回退 4%。
     注意：上游 closeChg 可能是字符串，先 Number() 兜底，避免被当 0 导致比例恒为 floor */
  function computeHeatScale(values, floor = 2) {
    if (!values || !values.length) return 4;
    let m = 0;
    values.forEach((raw) => {
      const v = Number(raw);
      const a = Math.abs(isFinite(v) ? v : 0);
      if (a > m) m = a;
    });
    const raw = Math.max(floor, m);
    return Math.ceil(raw * 2) / 2;
  }

  /* 把某面板的图例左右百分比改成动态区间 */
  function setHeatLegend(panelId, scale) {
    const p = document.getElementById(panelId);
    if (!p) return;
    const down = p.querySelector(".heat-legend .lg-down");
    const up = p.querySelector(".heat-legend .lg-up");
    if (down) down.textContent = fmtPct(-scale);
    if (up) up.textContent = fmtPct(scale);
  }

  function srcFlag(source) {
    return source === "实时"
      ? '<span class="src live">实时</span>'
      : '<span class="src demo">示例</span>';
  }

  /* ---------- 大盘概览 ---------- */
  function renderIndexes(data) {
    const grid = $("indexGrid");
    grid.innerHTML = "";
    CFG.indexes.forEach((ix) => {
      const d = data.indexes[ix.key];
      const c = cls(d.chg);
      const card = document.createElement("div");
      card.className = "index-card idx-" + ix.key;
      card.innerHTML =
        `<div class="index-name">${ix.name}</div>` +
        `<div class="index-val ${c}">${d.price.toFixed(2)}</div>` +
        `<div class="index-chg ${c}">${fmtPct(d.chg)}</div>`;
      grid.appendChild(card);
    });
  }

  /* ---------- 主题强弱速览（基于主题个股实时涨跌，重做自原「今日资金主线」） ---------- */
  function renderTheme(data) {
    const groups = (data.themeStocks || []).map((g) => {
      const live = g.stocks.filter(
        (s) => s.source === "实时" && typeof s.chg === "number"
      );
      const n = live.length;
      const avg = n ? live.reduce((a, s) => a + s.chg, 0) / n : null;
      const up = live.filter((s) => s.chg > 0.001).length;
      return { name: g.group, n, avg, up, total: g.stocks.length };
    });
    const valid = groups.filter((g) => g.avg != null).sort((a, b) => b.avg - a.avg);
    const body = $("themeBody");
    if (!valid.length) {
      body.innerHTML = '<div class="theme-desc">主题个股实时行情加载中…</div>';
      return;
    }
    const strong = valid.slice(0, 3);
    const weak = valid.slice(-2).reverse();
    const tag = (g) => {
      const c = cls(g.avg);
      return `<span class="theme-tag ${c === "down" ? "weak" : ""}">${g.name} ${fmtPct(g.avg)} · ${g.up}/${g.n}↑</span>`;
    };
    const strongNames = strong.map((g) => g.name).join("、");
    const weakNames = weak.map((g) => g.name).join("、");
    body.innerHTML =
      `<div class="theme-tags">${strong.map(tag).join("")}</div>` +
      `<div class="theme-desc">今日强势主题集中于 <b>${strongNames}</b>；` +
      `弱势主题 <b>${weakNames || "—"}</b>。</div>` +
      `<div class="theme-tags">${weak.map(tag).join("")}</div>` +
      `<div class="theme-meta">由「主题个股」实时涨跌自动汇总 · 实时</div>`;
  }

  /* ---------- 基金概况 · 涨跌热力 ---------- */
  function renderFunds(data) {
    // 特色 3 只：单独一行，含「估算 vs 收盘」对比
    const fg = $("fundFeaturedGrid");
    fg.innerHTML = "";
    (data.featuredFunds || []).forEach((f) => {
      fg.appendChild(buildFeaturedCard(f));
    });

    // 其他 16 只：按「收盘涨跌幅」(closeChg) 降序排列；主显收盘、副显估算，加实时/示例角标
    const grid = $("fundGrid");
    grid.innerHTML = "";
    const cmp = (a, b) =>
      (b.closeChg !== undefined ? b.closeChg : b.chg) -
      (a.closeChg !== undefined ? a.closeChg : a.chg);
    const sorted = (data.funds || []).slice().sort(cmp);
    // AUM 门槛（<2亿迷你基剔除）+ 主题联动过滤（点击主题个股分组触发）
    const pass = sorted.filter((f) => {
      if (f.aum != null && f.aum < 2) return false;
      if (FILTER.fundTheme && !(f.themes || []).includes(FILTER.fundTheme)) return false;
      return true;
    });
    // 日内动态区间：按当前这批实时基金涨跌幅算缩放比例（图例+配色一起变）
    const fundLiveChg = pass
      .filter((f) => f.source === "实时")
      .map((f) => (f.closeChg !== undefined ? f.closeChg : f.chg))
      .filter((v) => typeof v === "number" && isFinite(v));
    const fundScale = computeHeatScale(fundLiveChg);
    pass.forEach((f, i) => {
      const isLive = f.source === "实时";
      // 主显「收盘涨跌幅」，与排序口径一致（代理不可达回落估算）
      const chgShow = f.closeChg !== undefined ? f.closeChg : f.chg;
      const c = isLive ? cls(chgShow) : "flat";
      const cell = document.createElement("div");
      cell.className = "fund-cell" + (isLive ? "" : " demo");
      cell.style.background = isLive ? heatColor(chgShow, fundScale) : "rgba(44,52,68,0.45)";
      const estTxt = typeof f.gsz === "number" ? f.gsz.toFixed(4) : "--";
      const closeTxt = typeof f.closeNav === "number" ? f.closeNav.toFixed(4)
                     : (typeof f.jjjz === "number" ? f.jjjz.toFixed(4) : "--");
      const badge = `<span class="fund-badge ${isLive ? "live" : "sample"}">${isLive ? "实时" : "示例"}</span>`;
      const sp = f.sharpe != null ? f.sharpe.toFixed(2) : "--";
      const al = f.alpha != null ? f.alpha.toFixed(2) : "--";
      const pct = f.alphaTopPct != null ? `前${f.alphaTopPct}%` : "--";
      const metrics = `<span class="fund-metrics"><span class="fm-i">夏普<b>${sp}</b></span><span class="fm-i">α<b>${al}</b></span><span class="fm-i">α分位<b>${pct}</b></span></span>`;
      const themeKey = (f.themes || [])[0];
      const themeChip = themeKey
        ? `<span class="fund-theme" data-theme="${themeKey}">${themeLabel(themeKey)}</span>`
        : "";
      cell.dataset.tip = isLive
        ? `${f.name}\n收盘净值 ${closeTxt}（${fmtPct(chgShow)}）\n估算净值 ${estTxt}（${fmtPct(f.chg)}）\n夏普 ${sp} · 阿尔法 ${al} · α分位 ${pct}${f.aum != null ? "\n规模 " + f.aum + "亿" : ""}${f.manager ? "\n经理 " + f.manager : ""}${f.mom1m != null ? "\n近1月 " + (f.mom1m * 100).toFixed(1) + "%" : ""}\n主题 ${(f.themes || []).map(themeLabel).join(" / ")}\n${f.time || "盘中估算"}`
        : `实时估算加载中（当前为示例占位）`;
      cell.innerHTML =
        `<div class="fund-head">` +
          badge +
          `<span class="fund-name">${isLive ? f.name : "数据正在加载中，请稍等。"}</span>` +
          themeChip +
        `</div>` +
        (isLive
          ? `<span class="fund-chg ${c}">${fmtPct(chgShow)}</span>`
          : `<span class="fund-chg demo">示例</span>`) +
        (isLive
          ? `<div class="fund-bottom"><span class="fund-nav">收净 ${closeTxt} · 估 ${estTxt}</span>${metrics}</div>`
          : `<div class="fund-bottom"><span class="fund-nav">实时估算加载中…</span></div>`);
      grid.appendChild(cell);
    });
    setHeatLegend("fundPanel", fundScale);
    // 筛选状态条（点击主题个股分组触发 fundTheme 时显示）
    const fb = $("fundFilterBar");
    if (fb) fb.innerHTML = FILTER.fundTheme
      ? `筛选：${themeLabel(FILTER.fundTheme)} <span class="filter-clear" data-clear="fundTheme">✕ 清除</span>`
      : "";
  }

  /* 特色基金卡片：估算净值 vs 官方收盘净值 */
  function buildFeaturedCard(f) {
    const c = f.source === "实时" ? cls(f.chg) : "flat";
    const est = typeof f.gsz === "number" ? f.gsz.toFixed(4) : "--";
    // 收盘基线：优先官方最新收盘(closeNav)，代理不可达时回落 dwjz(jjjz 昨收)
    const close = typeof f.closeNav === "number" ? f.closeNav
                : (typeof f.jjjz === "number" ? f.jjjz : NaN);
    const closeChg = typeof f.closeChg === "number" ? f.closeChg : null;
    const closeTxt = isNaN(close) ? "--" : close.toFixed(4);
    let devHtml = "";
    if (!isNaN(close) && close > 0 && typeof f.gsz === "number") {
      const dev = (f.gsz - close) / close * 100; // 估算较官方收盘偏差
      const dc = cls(dev);
      const w = (Math.min(Math.abs(dev), 4) / 4) * 50;
      devHtml =
        `<div class="ff-dev"><span class="ff-dev-baseline"></span>` +
        `<span class="ff-dev-bar ${dev >= 0 ? "pos" : "neg"}" style="${dev >= 0 ? "left:50%;" : "right:50%;"}width:${w.toFixed(1)}%"></span></div>` +
        `<div class="ff-dev-label ${dc}">估算较收盘 ${dev > 0 ? "+" : ""}${dev.toFixed(2)}%</div>`;
    }
    const ccCls = closeChg !== null ? cls(closeChg) : "";
    const ccTxt = closeChg !== null ? fmtPct(closeChg) : "昨收";
    const closeSrc = f.closeLive ? "官方收盘" : (isNaN(close) ? "" : "昨收兜底");
    const badge = `<span class="ff-badge ${f.source === "实时" ? "live" : "sample"}">${f.source === "实时" ? "实时" : "示例"}</span>`;
    const chgTag = f.manager
      ? `<span class="ff-change ${f.managerChanged ? "changed" : "stable"}">${f.managerChanged ? "近期变更" : "任职稳定"}</span>`
      : "";
    const sp = f.sharpe != null ? f.sharpe.toFixed(2) : "--";
    const al = f.alpha != null ? f.alpha.toFixed(2) : "--";
    const bt = f.beta != null ? f.beta.toFixed(2) : "--";
    const pct = f.alphaTopPct != null ? `前${f.alphaTopPct}%` : "--";
    const cell = document.createElement("div");
    cell.className = "ff-card";
    cell.dataset.tip = f.source === "实时"
      ? `${f.name}（${f.code}）\n估算净值 ${est}（${fmtPct(f.chg)}）\n收盘净值 ${closeTxt}（${ccTxt}）\n夏普 ${sp} · 阿尔法 ${al} · β ${bt} · α分位 ${pct}${f.manager ? "\n经理 " + f.manager : ""}${f.time ? "\n" + f.time : ""}`
      : `${f.name}（${f.code}）\n实时估算加载中（当前为示例占位）`;
    cell.innerHTML =
      `<div class="ff-head">` +
        badge +
        `<span class="ff-name">${f.name}</span>` +
        `<span class="ff-code">${f.code}</span>` +
      `</div>` +
      (f.manager
        ? `<div class="ff-mgr"><span class="ff-mgr-name">${f.manager}</span>` +
          `<span class="ff-mgr-time">${f.workTime || ""}</span>${chgTag}</div>`
        : "") +
      `<div class="ff-row">` +
        `<div class="ff-metric"><span class="ff-label">估算净值</span>` +
          `<span class="ff-val ${c}">${est}</span>` +
          `<span class="ff-sub ${c}">${fmtPct(f.chg)}</span></div>` +
        `<div class="ff-vs">VS</div>` +
        `<div class="ff-metric"><span class="ff-label">收盘净值</span>` +
          `<span class="ff-val">${closeTxt}</span>` +
          `<span class="ff-sub ${ccCls}">${ccTxt}</span></div>` +
      `</div>` +
      devHtml +
      `<div class="ff-metrics"><span class="fm-i">夏普<b>${sp}</b></span>` +
        `<span class="fm-i">阿尔法<b>${al}</b></span>` +
        `<span class="fm-i">β<b>${bt}</b></span>` +
        `<span class="fm-i">α分位<b>${pct}</b></span></div>` +
      `<div class="ff-foot">${f.source === "实时" ? "实时" : "示例"} · 收盘:${closeSrc}${f.closeDate ? " " + f.closeDate : ""}${f.time ? " · 估算" + f.time : ""}</div>`;
    return cell;
  }

  /* ---------- 主题个股监控：按主题分组渲染 ---------- */
  function renderThemeStocks(data) {
    const wrap = $("themeStockGrid");
    if (!wrap) return;
    wrap.innerHTML = "";
    // 日内动态区间：汇总全部主题个股的实时涨跌幅，算全局缩放比例（图例+配色一起变）
    const tsLive = [];
    (data.themeStocks || []).forEach((g) =>
      (g.stocks || []).forEach((s) => {
        if (s.source === "实时" && typeof s.chg === "number" && isFinite(s.chg))
          tsLive.push(s.chg);
      })
    );
    const tsScale = computeHeatScale(tsLive);
    // 个股主题过滤：点击基金主题标签(stockTheme) → 仅显示同主题分组
    const groups = (data.themeStocks || []).filter(
      (g) => !FILTER.stockTheme || g.theme === FILTER.stockTheme
    );
    groups.forEach((g) => {
      const sec = document.createElement("div");
      sec.className = "ts-group";
      const head = document.createElement("div");
      head.className = "ts-group-head clickable";
      head.dataset.theme = g.theme || "";
      head.innerHTML =
        `<span class="ts-group-name">${g.group}</span>` +
        `<span class="ts-group-count">${g.stocks.length} 只</span>` +
        `<span class="ts-group-filter">点击筛选基金</span>`;
      sec.appendChild(head);
      const list = document.createElement("div");
      list.className = "ts-list";
      g.stocks.forEach((s) => {
        const isLive = s.source === "实时";
        const c = isLive ? cls(s.chg) : "flat";
        const cell = document.createElement("div");
        cell.className = "ts-cell" + (isLive ? "" : " demo");
        // 实时个股按日内动态比例上色（半透明，保留深色底与文字可读性）；示例态留空由 CSS 强制灰底
        cell.style.background = isLive ? heatColor(s.chg, tsScale, 0.32) : "";
        const isHK = /^\d{5}$/.test(s.code); // 5位代码 = 港股
        const priceTxt =
          isLive && typeof s.price === "number" ? s.price.toFixed(2) : "--";
        const chgTxt =
          isLive && typeof s.chg === "number"
            ? fmtPct(s.chg)
            : isLive ? "--" : "示例";
        let netTxt = "—";
        if (isLive && typeof s.mainNet === "number") {
          const a = Math.abs(s.mainNet);
          const v = a >= 1e8 ? (s.mainNet / 1e8).toFixed(2) + "亿"
                    : (s.mainNet / 1e4).toFixed(0) + "万";
          netTxt = (s.mainNet >= 0 ? "+" : "") + v;
        }
        cell.dataset.tip = isLive
          ? `${s.name}(${s.code})${isHK ? " · 港股" : ""}\n现价 ${priceTxt}　涨跌幅 ${chgTxt}\n主力净流入 ${netTxt}` +
            (typeof s.turnover === "number" ? `\n换手率 ${s.turnover.toFixed(2)}%` : "")
          : `${s.name} · 实时行情加载中（当前为示例占位）`;
        cell.innerHTML =
          `<div class="ts-top"><span class="ts-name">${s.name}</span>` +
          `<span class="ts-code">${s.code}${isHK ? " HK" : ""}</span></div>` +
          `<div class="ts-bot"><span class="ts-price ${c}">${priceTxt}</span>` +
          `<span class="ts-chg ${c}">${chgTxt}</span></div>`;
        list.appendChild(cell);
      });
      sec.appendChild(list);
      wrap.appendChild(sec);
    });
    // 筛选状态条（点击基金主题标签触发 stockTheme 时显示）
    const sb = $("stockFilterBar");
    if (sb) sb.innerHTML = FILTER.stockTheme
      ? `筛选：${themeLabel(FILTER.stockTheme)} <span class="filter-clear" data-clear="stockTheme">✕ 清除</span>`
      : "";
    setHeatLegend("themeStockPanel", tsScale);
    renderMetals(data);
  }

  /* 有色金属（贵金属）双卡片：国际金银现货价 + 人民币每克 + 涨跌% */
  function renderMetals(data) {
    const wrap = $("themeStockGrid");
    if (!wrap || !data.metals) return;
    const row = document.createElement("div");
    row.className = "metal-row";
    const head = document.createElement("div");
    head.className = "ts-group-head";
    head.innerHTML =
      `<span class="ts-group-name">有色金属</span>` +
      `<span class="ts-group-count">贵金属 · 国际金银价</span>`;
    row.appendChild(head);
    const list = document.createElement("div");
    list.className = "metal-list";
    [["gold", "黄金"], ["silver", "白银"]].forEach(([k, label]) => {
      const m = data.metals[k];
      if (!m) return;
      const isLive = m.source === "实时";
      const c = isLive ? cls(m.chg) : "flat";
      const card = document.createElement("div");
      card.className = "metal-card" + (isLive ? "" : " demo");
      const intlTxt =
        typeof m.intlUsd === "number"
          ? m.intlUsd.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
          : "--";
      const rmbTxt = typeof m.rmbPerG === "number" ? m.rmbPerG.toFixed(1) : "--";
      const chgTxt =
        isLive && typeof m.chg === "number"
          ? fmtPct(m.chg)
          : isLive ? "--" : "示例";
      const badge = isLive
        ? '<span class="metal-badge live">实时</span>'
        : '<span class="metal-badge sample">示例</span>';
      const unit = label === "黄金" ? "金" : "银";
      card.innerHTML =
        badge +
        `<div class="metal-name">${label}</div>` +
        `<div class="metal-line"><span class="metal-k">国际${unit}价</span>` +
          `<span class="metal-v ${c}">${intlTxt}</span><span class="metal-u">美元/盎司</span></div>` +
        `<div class="metal-line"><span class="metal-k">每克单价</span>` +
          `<span class="metal-v ${c}">${rmbTxt}</span><span class="metal-u">元/克（人民币）</span></div>` +
        `<div class="metal-line"><span class="metal-k">涨跌比例</span>` +
          `<span class="metal-v ${c}">${chgTxt}</span></div>`;
      list.appendChild(card);
    });
    row.appendChild(list);
    wrap.appendChild(row);
  }

  /* 主题个股 · 涨跌榜（仅实时） */
  function renderThemeRank(data) {
    const box = $("themeRank");
    if (!box) return;
    const all = [];
    (data.themeStocks || []).forEach((g) =>
      g.stocks.forEach((s) => {
        if (s.source === "实时" && typeof s.chg === "number")
          all.push({ name: s.name, code: s.code, chg: s.chg });
      })
    );
    if (!all.length) {
      box.innerHTML = '<div class="rank-empty">实时行情加载中…</div>';
      return;
    }
    all.sort((a, b) => b.chg - a.chg);
    const top = all.slice(0, 5);
    const bottom = all.slice(-5).reverse();
    const row = (arr, clsName) =>
      arr
        .map((x, i) => {
          const c = cls(x.chg);
          return `<div class="rank-row"><span class="rank-idx">${i + 1}</span>` +
            `<span class="rank-name">${x.name}</span>` +
            `<span class="rank-chg ${c}">${fmtPct(x.chg)}</span></div>`;
        })
        .join("");
    box.innerHTML =
      `<div class="rank-col"><div class="rank-title up">领涨 TOP5</div>${row(top)}</div>` +
      `<div class="rank-col"><div class="rank-title down">领跌 TOP5</div>${row(bottom)}</div>`;
  }

  /* 基金实时 · 涨跌榜（仅实时，按收盘涨跌幅口径） */
  function renderFundRank(data) {
    const box = $("fundRank");
    if (!box) return;
    const all = [];
    const push = (f) => {
      const v = f.closeChg != null ? f.closeChg : f.chg;
      if (f.source === "实时" && typeof v === "number")
        all.push({ name: f.name, code: f.code, chg: v });
    };
    (data.funds || []).forEach(push);
    (data.featuredFunds || []).forEach(push);
    if (!all.length) {
      box.innerHTML = '<div class="rank-empty">实时行情加载中…</div>';
      return;
    }
    all.sort((a, b) => b.chg - a.chg);
    const top = all.slice(0, 5);
    const bottom = all.slice(-5).reverse();
    const row = (arr) =>
      arr
        .map((x, i) => {
          const c = cls(x.chg);
          return `<div class="rank-row"><span class="rank-idx">${i + 1}</span>` +
            `<span class="rank-name">${x.name}</span>` +
            `<span class="rank-chg ${c}">${fmtPct(x.chg)}</span></div>`;
        })
        .join("");
    box.innerHTML =
      `<div class="rank-col"><div class="rank-title up">领涨 TOP5</div>${row(top)}</div>` +
      `<div class="rank-col"><div class="rank-title down">领跌 TOP5</div>${row(bottom)}</div>`;
  }

  /* ---------- 风格轮动 ---------- */
  function renderStyle(data) {
    const bars = $("styleBars");
    bars.innerHTML = "";
    const maxAbs = Math.max(...data.styles.map((s) => Math.abs(s.score))) || 1;
    data.styles.forEach((s) => {
      const w = (Math.abs(s.score) / maxAbs) * 50;
      const fillCls = s.score >= 0 ? "pos" : "neg";
      const row = document.createElement("div");
      row.className = "style-bar-row";
      row.innerHTML =
        `<span class="style-bar-name">${s.name}</span>` +
        `<span class="style-bar-track"><span class="style-bar-baseline"></span>` +
        `<span class="style-bar-fill ${fillCls}" style="${s.score >= 0 ? "left:50%;" : "right:50%;"}width:${w.toFixed(1)}%"></span></span>` +
        `<span class="style-bar-val ${s.score >= 0 ? "up" : "down"}">${s.score >= 0 ? "+" : ""}${s.score.toFixed(1)}</span>`;
      bars.appendChild(row);
    });

    // 罗盘坐标
    const get = (names) => {
      const arr = data.styles.filter((s) => names.includes(s.name));
      return arr.reduce((a, b) => a + b.score, 0) / (arr.length || 1);
    };
    const value = get(["大盘价值", "小盘价值", "红利低波"]);
    const grow = get(["大盘成长", "小盘成长", "成长"]);
    const large = get(["大盘价值", "大盘成长"]);
    const small = get(["小盘价值", "小盘成长"]);
    let x = (small - large) / 3;
    let y = (value - grow) / 3;
    x = Math.max(-1, Math.min(1, x));
    y = Math.max(-1, Math.min(1, y));
    drawCompass(x, y);

    // 风格风向
    const top = data.styles.slice().sort((a, b) => b.score - a.score)[0];
    const wind = $("styleWind");
    wind.innerHTML =
      `<span class="wind-chip">价值 ↔ 成长：<b>${value >= grow ? "价值占优" : "成长占优"}</b></span>` +
      `<span class="wind-chip">大盘 ↔ 小盘：<b>${small >= large ? "小盘占优" : "大盘占优"}</b></span>` +
      `<span class="wind-chip">当前最强：<b>${top.name}</b>（${top.score >= 0 ? "+" : ""}${top.score.toFixed(1)}）</span>`;
  }

  function drawCompass(x, y) {
    const cx = 100, cy = 100, R = 78;
    const px = cx + x * R;
    const py = cy - y * R;
    const svg = `
      <svg viewBox="0 0 200 200" width="100%" height="100%" style="max-width:200px">
        <defs>
          <radialGradient id="cg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="rgba(47,129,247,0.18)"/>
            <stop offset="100%" stop-color="rgba(10,15,24,0)"/>
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="90" fill="url(#cg)" stroke="rgba(120,150,200,0.18)"/>
        <line x1="12" y1="100" x2="188" y2="100" stroke="rgba(200,210,230,0.18)"/>
        <line x1="100" y1="12" x2="100" y2="188" stroke="rgba(200,210,230,0.18)"/>
        <circle cx="100" cy="100" r="48" fill="none" stroke="rgba(120,150,200,0.10)"/>
        <text x="100" y="20" fill="#9fb0c8" font-size="14" text-anchor="middle">价值</text>
        <text x="100" y="190" fill="#9fb0c8" font-size="14" text-anchor="middle">成长</text>
        <text x="8" y="104" fill="#9fb0c8" font-size="14" text-anchor="start">大盘</text>
        <text x="192" y="104" fill="#9fb0c8" font-size="14" text-anchor="end">小盘</text>
        <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="13" fill="rgba(240,185,11,0.18)"/>
        <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="6" fill="#f0b90b"/>
      </svg>`;
    $("styleCompass").innerHTML = svg;
  }

  /* ---------- 头部状态 ---------- */
  function renderHeader(data) {
    const m = data.meta;
    const badge = $("dataBadge");
    if (m.live) {
      badge.textContent = `数据：实时（${m.liveCount}/${m.total}）`;
      badge.classList.add("live");
    } else {
      badge.textContent = "数据：示例（接口不可达）";
      badge.classList.remove("live");
    }
    const t = m.updated;
    $("updated").textContent =
      "最后更新：" +
      [t.getHours(), t.getMinutes(), t.getSeconds()]
        .map((n) => String(n).padStart(2, "0"))
        .join(":");
  }

  /* ---------- 时钟 + 市场状态 ---------- */
  function tickClock() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    $("clock").textContent = `${hh}:${mm}:${ss}`;
    const dow = now.getDay();
    const min = now.getHours() * 60 + now.getMinutes();
    const st = $("marketState");
    let state = "休市", open = false;
    if (dow >= 1 && dow <= 5) {
      if (min >= 570 && min < 690) { state = "盘中"; open = true; }
      else if (min >= 690 && min < 780) { state = "午间休市"; }
      else if (min >= 780 && min < 900) { state = "盘中"; open = true; }
    }
    st.textContent = state;
    st.className = "market-state " + (open ? "open" : "closed");
  }

  /* ---------- 总渲染 ---------- */
  function renderAll(data) {
    STATE = data;
    renderHeader(data);
    renderIndexes(data);
    renderTheme(data);
    renderFunds(data);
    renderThemeStocks(data);
    renderThemeRank(data);
    renderFundRank(data);
  }

  /* 基线加载（仅一次）：构建示意基线 + 实时行情 + 实时基金，随后整体渲染 */
  async function loadBaseline() {
    try {
      const data = await window.DataAPI.load();
      STATE = data;
      renderAll(data);              // 立即出中性灰「示例」占位，不显示伪造红绿
      if (PROXY_MODE) checkProxyHealth();   // 异步探测代理/上游，不阻塞首屏
      await loadFunds();           // 后台补齐实时基金数据
      await loadQuotes();           // 后台补齐主题个股实时行情
      await loadMetals();           // 后台补齐有色金属（贵金属）实时价
      data.meta.updated = new Date();
      renderAll(STATE);            // 实时数据到位后整体重绘（真实色）
      await screenFunds();         // 自动选基：覆盖 CFG.funds 为近1月涨幅 Top16 并重拉实时
      renderHealth();
    } catch (e) {
      // 极端情况下退回内置示意
      console.error("基线加载异常：", e);
      if (!STATE) renderAll(JSON.parse(JSON.stringify(window.ILLUSTRATIVE)));
    }
  }

  /* 周期刷新（每 60 秒）：原地更新行情与基金，绝不回退示意，避免卡片闪烁 */
  async function refresh() {
    if (!STATE) return;
    try {
      await window.DataAPI.refreshMarkets(STATE);  // 只更新指数/行业/北向，不动基金
      await loadFunds();                           // 基金原地重拉，保持真实色
      await loadQuotes();                           // 主题个股原地重拉
      await loadMetals();                           // 有色金属（贵金属）原地重拉
      STATE.meta.updated = new Date();
      renderAll(STATE);
      if (PROXY_MODE) checkProxyHealth();
      renderHealth();
    } catch (e) {
      console.error("刷新异常：", e);
    }
  }

  /* 仅重算档案（窗口切换时调用）：静态 JSON 优先读预计算值，否则本地代理重算 */
  async function reProfile() {
    if (!STATE) return;
    const fj = await window.DataAPI.fetchFundsJson().catch(() => null);
    if (fj) {
      window.DataAPI.applyFundsJson(STATE, fj, CUR_WIN);
    } else {
      const allCfg = (CFG.funds || []).concat(CFG.featuredFunds || []);
      await loadProfilesBatch(allCfg, CUR_WIN);
    }
    computeAlphaPct(STATE);
    const note = $("windowNote");
    if (note) note.textContent = "夏普/阿尔法按「" + (CUR_WIN === "1y" ? "近1年" : CUR_WIN === "6m" ? "近半年" : "近3月") + "」" + (fj ? "窗口（静态预计算）" : "窗口本地计算");
    renderFunds(STATE);
  }

  /* 基金：原地回填，不回退示意、不触发渲染
     1) 估算净值（fundgz）：始终客户端实时
     2) 官方收盘净值 + 经理 + 夏普/阿尔法：优先静态 data/funds.json（GitHub Pages 用，无需代理）；
        本地无该文件时回落本地代理 proxy.py（开发用） */
  async function loadFunds() {
    if (!STATE) return;
    const allCfg = (CFG.funds || []).concat(CFG.featuredFunds || []);
    // 1) 基金估算净值（天天基金 fundgz，客户端实时）
    const results = await window.DataAPI.fetchAllFunds(allCfg).catch(() => []);
    window.DataAPI.applyFunds(STATE, results, allCfg);
    // 2) 官方收盘 + 档案：静态 JSON 优先（部署用，无需代理），否则回落代理
    const fj = await window.DataAPI.fetchFundsJson().catch(() => null);
    if (fj) {
      window.DataAPI.applyFundsJson(STATE, fj, CUR_WIN);
    } else {
      // 补「官方最新收盘」净值/涨跌幅（同源代理，绕开 Referer 校验）
      const navPs = allCfg.map((f) =>
        window.DataAPI.fetchFundNav(f.code).then((n) => [f.code, n])
      );
      const navPairs = await Promise.all(navPs);
      const navMap = {};
      navPairs.forEach(([code, n]) => { if (n) navMap[code] = n; });
      window.DataAPI.applyNav(STATE, navMap);
    }
    // 3) 风险指标（夏普/阿尔法/β）若仍为空 → 典型为本地种子 data/funds.json（风险字段占位 null）
    //    经同源代理本地真实计算补齐（开发环境）；部署后若 Action 已生成真值则跳过、不调代理
    const byCode = (code) =>
      (STATE.funds || []).find((x) => x.code === code) ||
      (STATE.featuredFunds || []).find((x) => x.code === code);
    const needCalc = allCfg.some((f) => {
      const st = byCode(f.code);
      return st && st.sharpe == null;
    });
    if (needCalc) {
      await loadProfilesBatch(allCfg, CUR_WIN);
    }
    computeAlphaPct(STATE);          // 重算 α 样本分位
    window.DataAPI.recomputeMeta(STATE);
  }

  /* 自动选基：对 fundUniverse 调代理按「近1月净值涨幅」降序取 Top16，
     覆盖 CFG.funds（后续 loadFunds 以此为准灌实时），并保留 themes 联动 chip。
     失败（无代理/超时/空结果）则回落静态 funds，不破坏页面。每 5 分钟由 init 定时器重筛。 */
  async function screenFunds() {
    if (!STATE) return;
    const uni = (CFG.fundUniverse || []);
    if (!uni.length) return;                 // 无候选池 → 维持静态 funds
    try {
      if (!PROXY_MODE) return;   // 静态部署无代理 → 维持内置 funds，不报代理类错误
      const top = await window.DataAPI.fetchFundScreen(uni, 16, "1m").catch(() => []);
      if (!top || !top.length) return;        // 空结果 → 回落静态 funds
      const meta = {};
      uni.forEach((f) => { meta[f.code] = f; });
      const picked = top.map((t) => {
        const m = meta[t.code] || {};
        return {
          code: t.code,
          // 真·自动选基：名称/主题由代理按基金名实时打标，不再依赖手工候选池
          name: (t.name && t.name.trim()) || m.name || t.code,
          aum: null,                            // 自动选基无规模数据；renderFunds 对 aum==null 直接通过
          themes: (t.themes && t.themes.length)
                    ? t.themes
                    : (m.themes || []),
          mom1m: typeof t.mom1m === "number" ? t.mom1m : null,
          source: "示例",                       // 实时由下方 loadFunds 覆盖
        };
      });
      CFG.funds = picked;                       // 自动选基核心：覆盖配置
      STATE.funds = picked;                      // 同步 STATE，供 loadFunds 回填
      await loadFunds();                          // 拉这 16 只的实时估算/收盘/夏普α
      renderFunds(STATE);
      const note = $("fundAutoNote");
      if (note) {
        const best = picked.find((f) => f.mom1m != null);
        note.textContent =
          "自动选基 · 全市场实时筛选「AI/半导体/科技产业链」近1月动量 Top16" +
          (best ? " · 榜首 " + best.name + " " + (best.mom1m * 100).toFixed(1) + "%" : "");
        note.className = "panel-sub auto";
      }
    } catch (e) {
      console.error("自动选基异常：", e);
    }
  }

  /* 主题个股实时行情：按 CFG.themeStocks 顺序拼 secids 逐只拉取，原地回填，不回退示意 */
  async function loadQuotes() {
    if (!STATE || !STATE.themeStocks) return;
    const order = [];
    (CFG.themeStocks || []).forEach((g) =>
      g.stocks.forEach((s) => order.push(s.secid))
    );
    if (!order.length) return;
    try {
      const res = await window.DataAPI.fetchQuotes(order).catch(() => ({ quotes: [], debug: {} }));
      const quotes = res.quotes || [];
      window.DataAPI.applyQuotes(STATE, quotes);
      window.DataAPI.recomputeMeta(STATE);
      // 面板头显示实时命中数，便于一眼验证
      const cnt = $("themeStockCount");
      let live = 0, total = 0;
      STATE.themeStocks.forEach((g) =>
        g.stocks.forEach((s) => { total++; if (s.source === "实时") live++; })
      );
      if (cnt) {
        cnt.textContent =
          "实时 " + live + "/" + total + (live < total ? "（其余为示例占位）" : "（全部实时）");
        cnt.className = "panel-sub" + (live === 0 ? " warn" : "");
      }
      // 诊断：实时 0 时把探针报文打到面板，方便定位（复制给我即可）
      const dbg = $("tsDebug");
      if (dbg) {
        if (live === 0 && res.debug) {
          const d = res.debug;
          const txt = ((d.gtimgStatus || "") + " " + (d.error || "")).trim().slice(0, 240);
          dbg.textContent =
            "诊断 · gtimg=" + (d.gtimgStatus || "无") +
            " 错误=" + (d.error || "无") +
            " 返回=" + (txt || "（空）");
          dbg.style.display = "block";
        } else {
          dbg.style.display = "none";
        }
      }
    } catch (e) {
      console.error("个股行情异常：", e);
    }
  }

  /* 有色金属（贵金属）：浏览器直拉实时价（gold-api + 汇率，CORS 开放）优先；
     涨跌% 来自静态 data/metals.json（Action 日环比真值 / 本地真实快照）。
     直拉失败则整体回落静态文件（仍为真实数据，非示例）。 */
  async function loadMetals() {
    if (!STATE) return;
    const fj = await window.DataAPI.fetchMetalsJson().catch(() => null);   // 静态（含 chg 当日基准）
    const live = await window.DataAPI.fetchMetalsLive().catch(() => null); // 浏览器直拉现价
    const build = (sym) => {
      const f = fj && fj[sym];
      const l = live && live[sym];
      if (!l && !f) return null;
      return {
        intlUsd: l && typeof l.intlUsd === "number" ? l.intlUsd : (f && f.intlUsd),
        rmbPerG: l && typeof l.rmbPerG === "number" ? l.rmbPerG : (f && f.rmbPerG),
        chg: f && typeof f.chg === "number" ? f.chg : null, // 涨跌% 仅静态源提供
      };
    };
    const j = {
      gold: build("gold"),
      silver: build("silver"),
      generatedAt: live ? "浏览器直拉·实时" : (fj && fj.generatedAt) || "",
    };
    if (j.gold || j.silver) window.DataAPI.applyMetals(STATE, j, "实时");
    renderMetals(STATE);
  }

  /* α 分位：在本终端跟踪的 19 只基金样本中计算排位（居样本前 X%）
     说明：公开接口无同类分类字段，故以「本终端样本」为可比集合，诚实标注「样本」而非「同类」。 */
  function computeAlphaPct(data) {
    const all = ((data.funds || []).concat(data.featuredFunds || []))
      .filter((f) => f.alpha != null)
      .map((f) => f.alpha);
    const setPct = (f) => {
      if (f.alpha == null) { f.alphaTopPct = null; return; }
      const rank = desc.indexOf(f.alpha) + 1; // 1-based，从最高 α 起
      f.alphaTopPct = Math.round((rank / all.length) * 100);
    };
    if (all.length < 2) {
      ((data.funds || []).concat(data.featuredFunds || [])).forEach((f) => (f.alphaTopPct = null));
      return;
    }
    const desc = all.slice().sort((a, b) => b - a);
    ((data.funds || []).concat(data.featuredFunds || [])).forEach(setPct);
  }

  /* 分批拉取基金档案（经理/夏普/阿尔法），每批 4 只，按当前窗口 win 计算 */
  async function loadProfilesBatch(allCfg, win) {
    const B = 4;
    for (let i = 0; i < allCfg.length; i += B) {
      const batch = allCfg.slice(i, i + B);
      await Promise.all(
        batch.map((f) =>
          window.DataAPI.fetchFundProfile(f.code, win)
            .then((p) => { if (p && !p.error) window.DataAPI.applyProfile(STATE, p); })
            .catch(() => {})
        )
      );
    }
  }

  /* ---------- 数据源健康：代理探针 + 头部横幅 ---------- */
  // 探测本地代理与上游（天天基金）连通性：区分「代理没启动」与「代理在跑但上游被封」
  async function checkProxyHealth() {
    if (!window.DataHealth) return;
    const isLocal = (location.hostname === "localhost" || location.hostname === "127.0.0.1");
    const proxyName = isLocal ? "本地代理(proxy.py)" : "云端代理(Cloudflare Worker)";
    const runHint = isLocal
      ? "本地代理未启动 → 运行 `python proxy.py`（默认端口 8000）"
      : "云端代理不可达 → ① 确认已 `wrangler deploy` ② 在 js/api.js 填对 STATIC_PROXY_URL";
    try {
      const j = await window.DataAPI.fetchJson(window.DataAPI.apiUrl("/api/health"), 8000);
      if (!j || j.proxy !== "ok") {
        DataHealth.mark(proxyName, "err", "代理未返回正常状态", runHint);
        return;
      }
      if (!j.upstream_ok) {
        DataHealth.mark(proxyName, "err",
          "代理在运行，但上游（天天基金）连通失败：" + (j.upstream_err || "未知"),
          "天天基金接口可能被封 / IP 受限 → 更新代理抓取逻辑（worker.js / proxy.py 换接口或换 UA）");
      } else {
        DataHealth.mark(proxyName, "ok");
      }
    } catch (e) {
      DataHealth.mark(proxyName, "err", "代理不可达：" + (e && e.message ? e.message : e), runHint);
    }
  }

  // 把 DataHealth 状态渲染到头部：状态点（#dataBadge）+ 异常红色横幅（#dataAlert）
  function renderHealth() {
    if (!window.DataHealth) return;
    const s = window.DataHealth.summary();
    const badge = $("dataBadge");
    const alert = $("dataAlert");
    if (badge) {
      badge.className = "data-badge " + (s.level === "ok" ? "ok" : s.level === "warn" ? "warn" : "err");
      badge.textContent = s.level === "ok" ? "数据：正常" : s.level === "warn" ? "数据：部分异常" : "数据：异常";
    }
    if (alert) {
      if (s.level === "ok") { alert.style.display = "none"; return; }
      alert.style.display = "flex";
      const items = s.fail.map((f) =>
        '<div class="da-item"><b>' + f.name + '</b>：' + (f.msg || "异常") +
        (f.hint ? '<span class="da-hint">→ ' + f.hint + '</span>' : '') + '</div>'
      ).join("");
      alert.innerHTML =
        '<div class="da-icon">⚠</div>' +
        '<div class="da-body"><div class="da-title">数据源异常，请检查 / 更换抓取脚本</div>' + items + '</div>' +
        '<button class="da-close" id="daClose" title="关闭提示">×</button>';
      const c = $("daClose");
      if (c) c.onclick = () => { alert.style.display = "none"; };
    }
  }

  /* ---------- 初始化 ---------- */
  function init() {
    tickClock();
    setInterval(tickClock, 1000);
    if (window.DataHealth) window.DataHealth.on(renderHealth);
    loadBaseline();                                  // 首次构建基线（含实时基金）→ 末尾自动选基
    // 反爬：打破精确 60s 节拍，加随机抖动 55~75s
    const jitterRefresh = () => {
      setTimeout(() => { refresh(); jitterRefresh(); }, 55000 + Math.random() * 20000);
    };
    const jitterScreen = () => {
      setTimeout(() => { screenFunds(); jitterScreen(); }, 270000 + Math.random() * 60000); // 4.5~5.5 分钟
    };
    jitterRefresh();
    jitterScreen();

    // 顶栏固定：测量实际高度写入 --tb-h，供 body padding-top 撑开内容（固定定位不占流）
    const pinTopbar = () => {
      const tb = document.querySelector(".topbar");
      if (tb) document.documentElement.style.setProperty("--tb-h", tb.offsetHeight + "px");
    };
    pinTopbar();
    window.addEventListener("resize", pinTopbar);

    $("refreshBtn").addEventListener("click", refresh);

    // 风险指标窗口切换（近1年/半年/3月）：重算夏普/阿尔法 + α分位
    const seg = $("windowSeg");
    if (seg) {
      seg.addEventListener("click", (e) => {
        const btn = e.target.closest(".seg-btn");
        if (!btn) return;
        const w = btn.dataset.w;
        if (!w || w === CUR_WIN) return;
        CUR_WIN = w;
        seg.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
        const note = $("windowNote");
        if (note) note.textContent = "夏普/阿尔法按「" + btn.textContent + "」窗口本地重新计算…";
        reProfile();
      });
    }

    // 自定义悬停提示（替代原生 title）：委托在容器上，重渲染不丢绑定
    const tsTip = $("tsTip");
    const tipGrids = ["themeStockGrid", "fundGrid", "fundFeaturedGrid"]
      .map((id) => $(id)).filter(Boolean);
    function positionTip(e) {
      if (!tsTip) return;
      const pad = 14;
      const r = tsTip.getBoundingClientRect();
      let x = e.clientX + pad;
      let y = e.clientY + pad;
      if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
      if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
      if (x < 8) x = 8;
      if (y < 8) y = 8;
      tsTip.style.left = x + "px";
      tsTip.style.top = y + "px";
    }
    if (tsTip && tipGrids.length) {
      tipGrids.forEach((g) => {
        g.addEventListener("mouseover", (e) => {
          const cell = e.target.closest("[data-tip]");
          if (!cell || !cell.dataset.tip) return;
          tsTip.textContent = cell.dataset.tip;   // \n + white-space:pre-line 保留换行
          tsTip.classList.add("show");
          positionTip(e);
        });
        g.addEventListener("mousemove", (e) => {
          if (tsTip.classList.contains("show")) positionTip(e);
        });
        g.addEventListener("mouseout", (e) => {
          const to = e.relatedTarget;
          if (!to || !to.closest || !to.closest("[data-tip]")) tsTip.classList.remove("show");
        });
      });
    }

    // 主题交叉筛选：点击主题个股分组头 → 过滤基金；点击基金主题标签 → 过滤个股
    const applyCrossFilter = () => { if (STATE) { renderFunds(STATE); renderThemeStocks(STATE); } };
    const themeStockGrid = $("themeStockGrid");
    if (themeStockGrid) {
      themeStockGrid.addEventListener("click", (e) => {
        const h = e.target.closest(".ts-group-head.clickable");
        if (!h) return;
        const t = h.dataset.theme;
        FILTER.fundTheme = (FILTER.fundTheme === t) ? null : t;  // 再点取消
        applyCrossFilter();
      });
    }
    const fundGridEl = $("fundGrid");
    if (fundGridEl) {
      fundGridEl.addEventListener("click", (e) => {
        const chip = e.target.closest(".fund-theme");
        if (!chip) return;
        const t = chip.dataset.theme;
        FILTER.stockTheme = (FILTER.stockTheme === t) ? null : t;
        applyCrossFilter();
      });
    }
    document.addEventListener("click", (e) => {
      const cl = e.target.closest(".filter-clear");
      if (!cl) return;
      if (cl.dataset.clear === "fundTheme") FILTER.fundTheme = null;
      if (cl.dataset.clear === "stockTheme") FILTER.stockTheme = null;
      applyCrossFilter();
    });

  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
