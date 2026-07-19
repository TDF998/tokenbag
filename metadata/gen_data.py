# -*- coding: utf-8 -*-
"""
gen_data.py — 生成 data/funds.json（静态，供 GitHub Pages 部署使用）
逻辑与本地代理 proxy.py 一致，但输出为提交到仓库的静态 JSON，
从而上线后无需任何服务器：

  - 官方最新收盘净值 / 涨跌幅 / 日期（天天基金 lsjz 净值历史）
  - 基金经理 + 任职起始（东方财富 Data_currentFundManager）
  - 夏普 / 阿尔法(詹森α) / β：本地 CAPM 计算，3 个窗口（近1年/半年/3月）

由 .github/workflows/deploy.yml 每日（工作日 15:30 北京时间）调用并提交；
本地也可 `python gen_data.py` 生成用于预览。
"""
import json
import math
import os
import re
import urllib.request
from datetime import datetime

# 19 只基金（与 js/data.js 的 CFG.funds + featuredFunds 保持一致）
FUNDS = [
    "020639", "018815", "018344",          # 特色 3 只
    "161725", "005827", "003095", "320007", "002190", "008086",
    "161005", "163417", "110022", "005669", "000051", "160119",
    "110026", "160213", "000307", "217022"
]
BENCH = "510300"   # 沪深300ETF，作为 CAPM 基准
WINDOWS = {"1y": 13, "6m": 7, "3m": 4}   # 页数 × 每页 20 条 ≈ 窗口长度
UA = "Mozilla/5.0"
REFERER_FUND = "https://fundf10.eastmoney.com/"
REFERER_PZ = "https://fundgz.1234567.com.cn/"


def _fetch_text(url, ref):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": ref})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read().decode("utf-8", "ignore")


def _fetch_json(url, ref):
    return json.loads(_fetch_text(url, ref))


def _nav_history(code, pages):
    """取净值历史 pages 页（每页20，新→旧），返回 [{date, nav}]"""
    out = []
    for p in range(1, pages + 1):
        url = (
            "https://api.fund.eastmoney.com/f10/lsjz?fundCode=%s"
            "&pageIndex=%d&pageSize=20" % (code, p)
        )
        try:
            j = _fetch_json(url, REFERER_FUND)
        except Exception:
            break
        rows = (j.get("Data") or {}).get("LSJZList") or []
        if not rows:
            break
        for r in rows:
            d = (r.get("FSRQ") or "").strip()
            nv = (r.get("DWJZ") or "").strip()
            if d and nv:
                try:
                    out.append({"date": d, "nav": float(nv)})
                except Exception:
                    pass
        if len(out) >= pages * 20:
            break
    # 按日期升序（旧→新）
    out.sort(key=lambda x: x["date"])
    return out


def _bench_navs(pages):
    """沪深300ETF(510300) 净值历史，升序"""
    out = []
    for p in range(1, pages + 1):
        url = (
            "https://push2his.eastmoney.com/api/qt/stock/kline/get"
            "?secid=1.510300&fields1=f1,f2,f3&fields2=f51,f53"
            "&klt=101&fqt=0&end=20500101&lmt=%d&_=%d"
            % (pages * 20, int(datetime.now().timestamp() * 1000))
        )
        try:
            j = _fetch_json(url, "https://quote.eastmoney.com/")
        except Exception:
            break
        kl = (j.get("data") or {}).get("klines") or []
        if not kl:
            break
        for line in kl:
            parts = line.split(",")
            if len(parts) >= 2:
                try:
                    out.append({"date": parts[0], "nav": float(parts[1])})
                except Exception:
                    pass
    out.sort(key=lambda x: x["date"])
    return out


def _extract_manager(code):
    """返回 (name, workTime)；失败返回 (None, None)"""
    url = "https://fundgz.1234567.com.cn/js/%s.js?rt=%d" % (
        code,
        int(datetime.now().timestamp() * 1000),
    )
    try:
        txt = _fetch_text(url, REFERER_PZ)
    except Exception:
        return None, None
    m = re.search(r'"fund_manes":"([^"]*)"', txt)
    if not m:
        return None, None
    names = re.findall(r"0\|([^|]+)\|(\d{4}-\d{2}-\d{2})", m.group(1))
    if not names:
        return None, None
    name, wt = names[0]
    return name.strip(), wt.strip()


def _daily_rets(navs):
    out = []
    for i in range(1, len(navs)):
        a, b = navs[i - 1]["nav"], navs[i]["nav"]
        if a and b:
            out.append(b / a - 1)
    return out


def _mean(x):
    return sum(x) / len(x) if x else 0.0


def _std(x):
    if len(x) < 2:
        return 0.0
    m = _mean(x)
    return math.sqrt(sum((v - m) ** 2 for v in x) / (len(x) - 1))


def _sharpe(rets, rf=0.02):
    if len(rets) < 5:
        return None
    rf_d = rf / 242.0
    ex = [r - rf_d for r in rets]
    sd = _std(ex)
    if sd == 0:
        return None
    return round(_mean(ex) / sd * math.sqrt(242), 2)


def _beta(rets, brets):
    n = min(len(rets), len(brets))
    if n < 5:
        return None
    r = rets[-n:]
    br = brets[-n:]
    rm, brm = _mean(r), _mean(br)
    cov = _mean([(r[i] - rm) * (br[i] - brm) for i in range(n)])
    var = _mean([(v - brm) ** 2 for v in br])
    if var == 0:
        return None
    return round(cov / var, 2)


def _alpha(rets, brets, rf=0.02):
    bt = _beta(rets, brets)
    if bt is None or len(rets) < 5:
        return None
    n = min(len(rets), len(brets))
    r = rets[-n:]
    br = brets[-n:]
    rf_d = rf / 242.0
    alphas = [r[i] - (rf_d + bt * (br[i] - rf_d)) for i in range(n)]
    return round(_mean(alphas) * 242 * 100, 2)


def _metal_price(symbol):
    """gold-api.com 现货（USD/盎司），服务端 urllib 抓取（无需 key、CORS 无关）。
    返回 price(float) 或 None。涨跌% 由调用方按旧文件日环比计算。"""
    try:
        j = _fetch_json("https://api.gold-api.com/price/%s" % symbol, "https://gold-api.com/")
        p = j.get("price")
        return float(p) if p is not None else None
    except Exception:
        return None


def _metal_chg(symbol, price, prev_map):
    """日环比涨跌%：相对上一次生成的 metals.json 中的价；无旧值则返回 None"""
    prev = prev_map.get(symbol)
    if prev and price:
        return round((price / prev - 1) * 100, 2)
    return None


def _usd_cny():
    """1 USD = ? CNY（keyless open.er-api.com）；失败返回 None"""
    try:
        j = _fetch_json("https://open.er-api.com/v6/latest/USD", "https://open.er-api.com/")
        return float(j["rates"]["CNY"])
    except Exception:
        return None


def _rmb_per_g(usd_per_oz, usd_cny):
    """USD/盎司 → 人民币/克（1 金衡盎司 = 31.1035 克）"""
    return round(usd_per_oz * usd_cny / 31.1035, 2)


def main():
    bench = _bench_navs(max(WINDOWS.values()))
    bench_rets = _daily_rets(bench)
    result = {"generatedAt": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"), "funds": {}}

    max_pages = max(WINDOWS.values())
    for code in FUNDS:
        hist = _nav_history(code, max_pages)
        if not hist or len(hist) < 5:
            result["funds"][code] = {}
            continue
        name, wt = _extract_manager(code)
        work_days = None
        if wt:
            try:
                work_days = (datetime.now() - datetime.strptime(wt, "%Y-%m-%d")).days
            except Exception:
                work_days = None
        rets = _daily_rets(hist)
        windows = {}
        for w, pages in WINDOWS.items():
            need = pages * 20
            w_hist = hist[-need:] if len(hist) >= need else hist
            w_rets = _daily_rets(w_hist)
            b_rets = bench_rets[-len(w_rets):] if bench_rets else []
            windows[w] = {
                "sharpe": _sharpe(w_rets),
                "alpha": _alpha(w_rets, b_rets) if b_rets else None,
                "beta": _beta(w_rets, b_rets) if b_rets else None,
            }
        latest = hist[-1]
        prev = hist[-2]["nav"] if len(hist) >= 2 else None
        close_chg = round((latest["nav"] / prev - 1) * 100, 2) if prev else None
        result["funds"][code] = {
            "closeNav": latest["nav"],
            "closeChg": close_chg,
            "closeDate": latest["date"],
            "manager": name,
            "workTime": wt,
            "managerChanged": bool(work_days is not None and work_days < 365),
            "windows": windows,
        }
        print("OK", code, name, "close", latest["nav"], latest["date"])

    os.makedirs("data", exist_ok=True)
    with open("data/funds.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print("written data/funds.json with", len(result["funds"]), "funds")

    # 贵金属：gold-api.com 现货 + open.er-api 汇率 → 人民币每克（服务端稳定源）
    # 涨跌% 用日环比：相对上一次生成的 metals.json 的价（无需额外数据源）
    g = _metal_price("XAU")
    s = _metal_price("XAG")
    cny = _usd_cny()
    prev_map = {}
    old_path = os.path.join("data", "metals.json")
    if os.path.exists(old_path):
        try:
            with open(old_path, encoding="utf-8") as f:
                old = json.load(f)
            prev_map = {
                "XAU": (old.get("gold") or {}).get("intlUsd"),
                "XAG": (old.get("silver") or {}).get("intlUsd"),
            }
        except Exception:
            prev_map = {}
    if g and s and cny:
        metals = {
            "generatedAt": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            "usdCny": round(cny, 4),
            "gold": {
                "intlUsd": round(g, 2),
                "rmbPerG": _rmb_per_g(g, cny),
                "chg": _metal_chg("XAU", g, prev_map),
            },
            "silver": {
                "intlUsd": round(s, 2),
                "rmbPerG": _rmb_per_g(s, cny),
                "chg": _metal_chg("XAG", s, prev_map),
            },
            "sourceNote": "gold-api.com(现货)+open.er-api(汇率)；涨跌%为日环比；浏览器端另直拉 gold-api 实时价",
        }
        with open(old_path, "w", encoding="utf-8") as f:
            json.dump(metals, f, ensure_ascii=False, indent=2)
        print("written data/metals.json gold", metals["gold"], "silver", metals["silver"])
    else:
        print("SKIP data/metals.json: spot/cny fetch failed", g, s, cny)


if __name__ == "__main__":
    main()
