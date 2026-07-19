# -*- coding: utf-8 -*-
"""
本地静态服务器 + 基金数据代理
- 静态文件：同 python -m http.server
- /api/fund_nav?code=020639        -> 代理天天基金 lsjz 取最新官方收盘净值/涨跌
- /api/fund_profile?code=020639  -> 代理计算：基金经理(含任职/是否近期变更) + 夏普比率 + 阿尔法系数
   * 夏普：近1年/半年/3月(可按窗口切换)单位净值序列年化(rf=2%) 本地计算
   * 阿尔法：CAPM 詹森α，市场基准=沪深300ETF(510300) 历史净值序列 本地计算
   * 经理：天天基金 pingzhongdata.js 的 Data_currentFundManager
   说明：公开接口(pingzhongdata/f10风险页)不提供夏普/阿尔法字段，故用历史净值本地真实计算，绝不编造。
"""
import http.server
import socketserver
import urllib.request
import urllib.parse
import json
import os
import re
import time
import threading
import concurrent.futures as cf
from concurrent.futures import ThreadPoolExecutor

PORT = 8000
ROOT = os.path.dirname(os.path.abspath(__file__))

RF = 0.02                 # 无风险年化利率
TRADING_DAYS = 252
WINDOWS = {"1y": 13, "6m": 7, "3m": 4}   # 页 × 20 ≈ 交易日（近1年/半年/3月）
WINDOW_LABEL = {"1y": "近1年", "6m": "近半年", "3m": "近3月"}
BENCH_CODE = "510300"      # 沪深300ETF 作 CAPM 市场基准
_bench_cache = {}           # 按窗口页数缓存基准序列
_bench_lock = threading.Lock()


def _fetch_text(url, ref="https://fundf10.eastmoney.com/"):
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0", "Referer": ref}
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.read().decode("utf-8", "ignore")


def _fetch_json(url, ref="https://fundf10.eastmoney.com/"):
    return json.loads(_fetch_text(url, ref))


def _extract_manager(text):
    m = re.search(r"Data_currentFundManager\s*=\s*(\[.*?\]);", text, re.S)
    if not m:
        return None, None
    seg = m.group(1)
    nm = re.search(r'"name"\s*:\s*"([^"]*)"', seg)
    wt = re.search(r'"workTime"\s*:\s*"([^"]*)"', seg)
    return (nm.group(1) if nm else None), (wt.group(1) if wt else None)


def _parse_worktime(s):
    if not s:
        return None
    y = re.search(r"(\d+)年", s)
    d = re.search(r"(\d+)天", s)
    yy = int(y.group(1)) if y else 0
    dd = int(d.group(1)) if d else 0
    return yy * 365 + dd


def _nav_history(code, pages=WINDOWS["1y"]):
    """分页拉取单位净值(DWJZ)，返回 oldest->newest 升序 float 列表"""
    out = []

    def one(pg):
        u = (
            "https://api.fund.eastmoney.com/f10/lsjz?fundCode=%s"
            "&pageIndex=%d&pageSize=20&startDate=&endDate=&_=%d"
            % (code, pg, int(time.time() * 1000))
        )
        try:
            j = _fetch_json(u, ref="https://fundf10.eastmoney.com/")
            return (j.get("Data") or {}).get("LSJZList") or []
        except Exception:
            return []

    with ThreadPoolExecutor(max_workers=6) as ex:
        lists = list(ex.map(one, range(1, pages + 1)))
    for lst in lists:
        for it in lst:
            v = it.get("DWJZ")
            try:
                out.append(float(v))
            except Exception:
                pass
    # page1=最新...pageN=最早(降序) -> 反转成升序
    out.reverse()
    return out


def _bench_navs(pages):
    global _bench_cache
    with _bench_lock:
        if pages in _bench_cache:
            return _bench_cache[pages]
    out = _nav_history(BENCH_CODE, pages)
    with _bench_lock:
        _bench_cache[pages] = out
    return out


def _daily_rets(navs):
    return [navs[i] / navs[i - 1] - 1 for i in range(1, len(navs))]


def _mean(x):
    return sum(x) / len(x) if x else 0.0


def _std(x):
    n = len(x)
    if n < 2:
        return 0.0
    m = _mean(x)
    return (sum((v - m) ** 2 for v in x) / (n - 1)) ** 0.5


def _sharpe(navs, rf=RF):
    if len(navs) < 40:
        return None
    r = _daily_rets(navs)
    mr, sd = _mean(r), _std(r)
    if sd == 0:
        return None
    ann_r = mr * TRADING_DAYS
    ann_v = sd * (TRADING_DAYS ** 0.5)
    return (ann_r - rf) / ann_v


def _alpha(navs, bnavs, rf=RF):
    if len(navs) < 40 or len(bnavs) < 40:
        return None, None
    rf_d = rf / TRADING_DAYS
    r, b = _daily_rets(navs), _daily_rets(bnavs)
    n = min(len(r), len(b))
    if n < 40:
        return None, None
    r, b = r[-n:], b[-n:]
    mr, mb = _mean(r), _mean(b)
    cov = sum((r[i] - mr) * (b[i] - mb) for i in range(n)) / (n - 1)
    varb = sum((x - mb) ** 2 for x in b) / (n - 1)
    beta = cov / varb if varb else 0.0
    a_d = _mean([(r[i] - rf_d) - beta * (b[i] - rf_d) for i in range(n)])
    return a_d * TRADING_DAYS * 100.0, beta


def _mom1m(code):
    """近 1 个月净值涨幅（动量）：抓近 ~40 日净值(pages=2)，
       末值 / 约 21 个交易日前  - 1；样本不足则回退 首值。"""
    navs = _nav_history(code, 2)
    if len(navs) < 2:
        return None
    base = navs[0] if len(navs) < 22 else navs[-22]
    return navs[-1] / base - 1.0


_SCREEN_TTL = 300          # 筛选结果内存缓存时长（秒），避免每次刷新重轰接口
_screen_cache = {}        # {(codes_hash, metric, top): (ts, result)}


# 主题关键词 -> 主题键（与 data.js 主题个股 7 分组对齐：core/semi/storage/robot/ai/tech/terminal）
# 仅用这 7 个键，确保点击基金 theme chip 必命中某个主题个股分组。
_THEME_RULES = [
    ("半导体", ["semi", "core"]),
    ("芯片", ["semi", "storage", "core"]),
    ("集成电路", ["semi", "core"]),
    ("算力", ["semi", "core", "ai"]),
    ("光模块", ["semi", "core", "ai"]),
    ("CPO", ["semi", "core", "ai"]),
    ("存储", ["storage", "semi"]),
    ("内存", ["storage", "semi"]),
    ("电子", ["semi", "terminal", "tech"]),
    ("消费电子", ["terminal", "semi", "tech"]),
    ("5G", ["semi", "storage", "ai", "tech", "terminal"]),
    ("通信", ["semi", "storage", "ai", "tech", "terminal"]),
    ("通讯", ["semi", "storage", "ai", "tech", "terminal"]),
    ("人工智能", ["ai", "tech", "core"]),
    ("AI", ["ai", "tech", "core"]),
    ("智能", ["ai", "tech"]),
    ("机器人", ["robot", "ai", "tech", "core"]),
    ("机器视觉", ["robot", "ai", "tech", "core"]),
    ("工业自动化", ["robot", "ai", "tech", "core"]),
    ("具身", ["robot", "ai", "tech", "core"]),
    ("软件", ["tech", "ai", "terminal"]),
    ("计算机", ["tech", "ai", "terminal"]),
    ("信息", ["tech", "ai", "terminal"]),
    ("云计算", ["tech", "ai", "terminal"]),
    ("大数据", ["tech", "ai", "terminal"]),
    ("数字经济", ["tech", "ai", "terminal"]),
    ("互联网", ["tech", "ai", "terminal"]),
    ("物联网", ["tech", "ai", "terminal"]),
    ("网络安全", ["tech", "ai", "terminal"]),
    ("游戏", ["tech", "ai"]),
    ("动漫", ["tech", "ai"]),
    ("文化", ["tech", "ai"]),
    ("传媒", ["tech", "ai"]),
    ("科创", ["tech", "core", "semi"]),
    ("创业板", ["tech", "core"]),
    ("新能源", ["ai", "tech"]),
    ("电池", ["ai", "tech"]),
    ("光伏", ["ai", "tech"]),
    ("汽车", ["ai", "tech"]),
    ("科技", ["tech", "ai", "core"]),
]

# 否定词：名称含以下任一则视为「非本主题」（主要剔除生物医药/消费/金融地产等噪声，
# 避免「生物科技」被 "科技" 误命中；并剔除 QDII/港股通/海外基金——本终端为 A 股主题，
# 且该类基金无盘中实时估算（jsonpgz 为空），保留会导致面板出现大量「加载中」卡片）。
_DENY_THEME = [
    "生物", "医药", "医疗", "健康", "养老", "疫苗", "中药", "创新药", "医疗器械",
    "消费", "食品", "饮料", "白酒", "农业", "畜牧", "猪肉",
    "银行", "证券", "保险", "地产", "房地产", "煤炭", "钢铁", "石油", "化工",
    "军工", "国防", "债券", "债", "货币",
    "QDII", "港股", "恒生", "海外", "全球", "中美", "纳斯达克", "纳指",
    "中概", "中国互联网", "境外", "国际",
]


def _themes_of(name):
    n = name or ""
    for d in _DENY_THEME:
        if d in n:
            return []
    out = []
    for kw, keys in _THEME_RULES:
        if kw in n:
            for k in keys:
                if k not in out:
                    out.append(k)
    return out


def _fund_family(name):
    """归一化基金族名：去括号(QDII/LOF)、去份额后缀(联接/ETF联接/指数/混合/…)、
       去末尾份额字母 A/B/C，使同一基金的 A/C 份额归并为同一族。"""
    n = name or ""
    n = re.sub(r"[（(][^）)]*[)）]", "", n)   # 去括号内容 (QDII)/(LOF)
    for suf in ["ETF联接", "联接", "指数", "混合", "股票", "债券", "货币",
                "发起式", "发起", "精选", "LOF", "QDII", "分级"]:
        n = n.replace(suf, "")
    n = re.sub(r"[\s]*[A-Fa-f]$", "", n)        # 去末尾份额字母 A/B/C…
    return n.strip()


# 指标 -> rankhandler 字段下标（已在 live 响应中核对：
#   idx7=近1周, idx8=近1月, idx9=近3月, idx10=近6月）
_METRIC_IDX = {"1w": 7, "1m": 8, "3m": 9, "6m": 10}


def _screen_rank(top=16, metric="1m"):
    """真·自动选基：拉天天基金真实排行榜（全市场开放式基金，按指定指标降序），
       过滤出 AI/半导体/科技产业链 主题基金（名称关键词 + 否定词剔除生物/消费/金融等噪声），
       按指标降序返回 Top N 真实代码+名称+动量+主题标签。
       不再依赖手工标注候选池（避免错码 -> 示例 / 主题错位）。"""
    idx = _METRIC_IDX.get(metric, 8)
    sd = time.strftime("%Y-%m-%d", time.localtime(time.time() - 32 * 86400))
    ed = time.strftime("%Y-%m-%d", time.localtime())
    # 并行翻 20 页（每页 500，共 10000 只）以覆盖完整主题基金宇宙，
    # 取近1月动量 Top16（含少数负动量者，如实反映当前轮动格局）。
    # 并发请求把墙钟时延压到 ~6-8s（顺序则 ~30s+）。
    PAGES = 20

    def _fetch_page(pi):
        url = (
            "https://fund.eastmoney.com/data/rankhandler.aspx"
            "?op=ph&dt=kf&ft=all&rs=&gs=0&sc=1yzf&st=desc"
            "&sd=%s&ed=%s&qdii=&tabSubtype=,,,,,&pi=%d&pn=500&dx=1" % (sd, ed, pi)
        )
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0", "Referer": "http://fund.eastmoney.com/"},
            )
            with urllib.request.urlopen(req, timeout=15) as r:
                txt = r.read().decode("utf-8", "ignore")
        except Exception:
            return []
        i = txt.find("datas:[")
        if i < 0:
            return []
        j = txt.rfind("]")
        if j <= i:
            return []
        seg = txt[i + 7:j]
        out = []
        for s in re.findall(r'"([^"]*)"', seg):
            p = s.split(",")
            if len(p) <= idx:
                continue
            code = re.sub(r"\D", "", p[0])
            name = p[1]
            if not code:
                continue
            try:
                mom = float(p[idx].replace("%", "")) / 100.0
            except Exception:
                continue
            themes = _themes_of(name)
            if not themes:
                continue
            out.append({
                "code": code,
                "name": name,
                "mom1m": round(mom, 6),
                "themes": themes,
            })
        return out

    seen = {}
    # 反爬：20 页不瞬间全并发，改为 4 页 × 5 批，批间间隔 1s，
    # 把"瞬间洪峰"拆成"5 波渐进"，降低上游并发限流风险
    BATCH = 4
    for batch_start in range(1, PAGES + 1, BATCH):
        batch_pages = list(range(batch_start, min(batch_start + BATCH, PAGES + 1)))
        with cf.ThreadPoolExecutor(max_workers=len(batch_pages)) as ex:
            for rows in ex.map(_fetch_page, batch_pages):
                for row in rows:
                    if row["code"] not in seen:
                        seen[row["code"]] = row
        if batch_start + BATCH <= PAGES:
            time.sleep(1)
    # 按「基金族」去重（A/C 份额合并，保留动量最高的一只），保证 Top N 为不同基金
    fam_map = {}
    for row in seen.values():
        fam = _fund_family(row["name"])
        cur = fam_map.get(fam)
        if cur is None or row["mom1m"] > cur["mom1m"]:
            fam_map[fam] = row
    rows = list(fam_map.values())
    rows.sort(key=lambda x: x["mom1m"], reverse=True)
    return rows[:top]


def _handle_screen(self):
    q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
    metric = q.get("metric", ["1m"])[0]
    try:
        top = int(q.get("top", ["16"])[0])
    except Exception:
        top = 16
    if top < 1 or top > 60:
        top = 16
    key = (metric, top)
    now = time.time()
    cached = _screen_cache.get(key)
    if cached and now - cached[0] < _SCREEN_TTL:
        self._send_json(200, {"cached": True, "metric": metric, "top": top,
                             "count": len(cached[1]), "result": cached[1]})
        return
    try:
        rows = _screen_rank(top, metric)
    except Exception as e:
        self._send_json(502, {"error": str(e)})
        return
    _screen_cache[key] = (now, rows)
    self._send_json(
        200,
        {
            "cached": False,
            "metric": metric,
            "top": top,
            "count": len(rows),
            "result": rows,
        },
    )


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        p = self.path
        if p.startswith("/api/fund_nav"):
            self._handle_nav()
            return
        if p.startswith("/api/fund_profile"):
            self._handle_profile()
            return
        if p.startswith("/api/fund_screen"):
            _handle_screen(self)
            return
        if p.startswith("/api/health"):
            self._handle_health()
            return
        super().do_GET()

    def _handle_nav(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        code = re.sub(r"\D", "", q.get("code", [""])[0])
        if not code:
            self._send_json(400, {"error": "missing code"})
            return
        url = (
            "https://api.fund.eastmoney.com/f10/lsjz?fundCode=%s"
            "&pageIndex=1&pageSize=1&startDate=&endDate=&_=%d"
            % (code, int(time.time() * 1000))
        )
        req = urllib.request.Request(
            url,
            headers={
                "Referer": "https://fundf10.eastmoney.com/",
                "User-Agent": "Mozilla/5.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=8) as r:
                data = json.loads(r.read().decode("utf-8"))
            lst = (data.get("Data") or {}).get("LSJZList") or []
            if lst:
                row = lst[0]
                self._send_json(
                    200,
                    {
                        "code": code,
                        "date": row.get("FSRQ"),
                        "nav": row.get("DWJZ"),
                        "chg": row.get("JZZZL"),
                    },
                )
            else:
                self._send_json(200, {"code": code, "error": "empty",
                                      "raw": data.get("ErrCode")})
        except Exception as e:
            self._send_json(502, {"error": str(e)})

    def _handle_profile(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        code = re.sub(r"\D", "", q.get("code", [""])[0])
        if not code:
            self._send_json(400, {"error": "missing code"})
            return
        win = q.get("window", ["1y"])[0]
        if win not in WINDOWS:
            win = "1y"
        pages = WINDOWS[win]
        try:
            with ThreadPoolExecutor(max_workers=2) as ex:
                f1 = ex.submit(
                    lambda: _fetch_text(
                        "https://fund.eastmoney.com/pingzhongdata/%s.js" % code
                    )
                )
                f2 = ex.submit(lambda: _nav_history(code, pages))
                txt = f1.result()
                navs = f2.result()
            mgr, wt = _extract_manager(txt)
            wd = _parse_worktime(wt)
            changed = wd is not None and wd < 365
            bnavs = _bench_navs(pages)
            sharpe = _sharpe(navs)
            alpha, beta = (None, None) if sharpe is None else _alpha(navs, bnavs)
            self._send_json(
                200,
                {
                    "code": code,
                    "window": win,
                    "windowLabel": WINDOW_LABEL[win],
                    "manager": mgr,
                    "workTime": wt,
                    "workDays": wd,
                    "managerChanged": changed,
                    "benchmark": BENCH_CODE,
                    "sharpe": round(sharpe, 3) if sharpe is not None else None,
                    "alpha": round(alpha, 2) if alpha is not None else None,
                    "beta": round(beta, 3) if beta is not None else None,
                    "navCount": len(navs),
                    "benchCount": len(bnavs),
                    "note": "夏普=%s净值年化(rf=2%%)；阿尔法=CAPM(基准%s)" % (WINDOW_LABEL[win], BENCH_CODE),
                },
            )
        except Exception as e:
            self._send_json(502, {"error": str(e)})

    def _handle_health(self):
        """健康探针：返回 {proxy, upstream_ok, upstream_err}。
           代理进程在跑 + 能连通天天基金上游 → upstream_ok=True；
           上游被封/超时 → upstream_ok=False 且带错误，前端据此区分
           「代理没启动」与「代理在跑但天天基金上游被封」。"""
        up_ok = False
        up_err = ""
        try:
            sd = time.strftime("%Y-%m-%d", time.localtime(time.time() - 32 * 86400))
            ed = time.strftime("%Y-%m-%d", time.localtime())
            url = (
                "https://fund.eastmoney.com/data/rankhandler.aspx"
                "?op=ph&dt=kf&ft=all&rs=&gs=0&sc=1yzf&st=desc"
                "&sd=%s&ed=%s&qdii=&tabSubtype=,,,,,&pi=1&pn=1&dx=1" % (sd, ed)
            )
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0", "Referer": "http://fund.eastmoney.com/"},
            )
            with urllib.request.urlopen(req, timeout=8) as r:
                txt = r.read().decode("utf-8", "ignore")
            up_ok = "datas:[" in txt
            if not up_ok:
                up_err = "上游响应异常（无 datas 段）"
        except Exception as e:
            up_err = str(e)
        self._send_json(200, {
            "proxy": "ok",
            "upstream_ok": up_ok,
            "upstream_err": up_err,
            "ts": int(time.time()),
        })

    def _send_json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # 静默


if __name__ == "__main__":
    os.chdir(ROOT)
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("", PORT), Handler) as httpd:
        print("serving %s on port %d (nav+profile proxy, threaded)" % (ROOT, PORT))
        httpd.serve_forever()
