/* ============================================================
   data.js — 仪表盘配置 + 示意数据
   说明：以下数值为「示意」数据，用于在无实时接口时呈现完整界面。
   实时获取失败时回退到此；实时获取成功时由 api.js 覆盖并标注来源。
   ============================================================ */

/* 16 个一级行业配置：name 为展示名，kw 为匹配东方财富行业板块名的关键词 */
window.DASHBOARD_CONFIG = {
  sectors: [
    { name: "银行",       kw: ["银行"] },
    { name: "食品饮料",   kw: ["酿酒", "食品"] },
    { name: "医药生物",   kw: ["医药"] },
    { name: "电子",       kw: ["电子"] },
    { name: "计算机",     kw: ["软件", "计算机", "互联网"] },
    { name: "电力设备",   kw: ["电池", "电源", "电网", "电气", "电力"] },
    { name: "汽车",       kw: ["汽车"] },
    { name: "家用电器",   kw: ["家电"] },
    { name: "有色金属",   kw: ["有色"] },
    { name: "基础化工",   kw: ["化工"] },
    { name: "机械设备",   kw: ["机械"] },
    { name: "房地产",     kw: ["房地产", "地产"] },
    { name: "建筑材料",   kw: ["建材", "水泥"] },
    { name: "非银金融",   kw: ["证券", "保险", "多元金融"] },
    { name: "国防军工",   kw: ["军工", "航天", "船舶", "国防"] },
    { name: "通信",       kw: ["通信", "通讯", "5G"] }
  ],

  /* 大盘指数配置：secid = 市场.代码（1=上交所，0=深交所） */
  indexes: [
    { key: "sh",    name: "上证指数", secid: "1.000001" },
    { key: "sz",    name: "深证成指", secid: "0.399001" },
    { key: "cyb",   name: "创业板指", secid: "0.399006" },
    { key: "hs300", name: "沪深300",  secid: "1.000300" },
    { key: "kc50",  name: "科创50",   secid: "1.000688" }
  ],

  /* 16 只「AI / 半导体产业链」主题公募基金：与上方 themeStocks 7 个分组一一对应，
     code 基金代码（天天基金实时估算净值）；aum = 规模（亿元，手工标注近似公开值，作 <2亿 剔除门槛）
     themes = 主题标签，严格只用 7 个分组键 [core/semi/storage/robot/ai/tech/terminal]，
              确保点击卡片 chip 必能命中某个主题个股分组（不再出现「点 chip 清空面板」的脱节）。
     排序已由 app.js 按收盘涨跌幅降序，涨势高的自然排前。 */
  funds: [
    { name: "诺安成长混合",        code: "320007", aum: 200, themes: ["semi", "storage", "ai", "robot", "tech", "terminal", "core"] },
    { name: "华夏中证5G通信联接A", code: "008086", aum: 30,  themes: ["semi", "storage", "ai", "robot", "tech", "terminal", "core"] },
    { name: "国联安中证半导体联接A", code: "007300", aum: 40,  themes: ["semi", "core"] },
    { name: "银河创新成长混合",    code: "519674", aum: 80,  themes: ["semi", "ai", "tech", "core"] },
    { name: "易方达人工智能联接A",  code: "012733", aum: 15,  themes: ["ai", "tech", "core"] },
    { name: "华富人工智能产业联接A", code: "008020", aum: 8,   themes: ["ai", "tech"] },
    { name: "天弘中证机器人联接A",  code: "014880", aum: 10,  themes: ["robot", "ai", "tech", "core"] },
    { name: "天弘中证电子联接A",    code: "001618", aum: 6,   themes: ["semi", "tech", "terminal"] },
    { name: "农银新能源主题",      code: "002190", aum: 120, themes: ["ai", "tech"] },
    { name: "东方新能源汽车混合",  code: "400015", aum: 100, themes: ["ai", "tech"] },
    { name: "前海开源公用事业",    code: "005669", aum: 90,  themes: ["tech", "ai"] },
    { name: "易方达创业板联接A",   code: "110026", aum: 60,  themes: ["tech", "core"] },
    { name: "华夏科创50联接A",     code: "011612", aum: 25,  themes: ["tech", "core", "semi"] },
    { name: "国泰纳斯达克100指数",  code: "160213", aum: 110, themes: ["ai", "tech"] },
    { name: "易方达信息产业混合",  code: "001513", aum: 40,  themes: ["tech", "ai", "terminal"] },
    { name: "华夏中证动漫游戏联接A", code: "012768", aum: 20,  themes: ["tech", "ai"] }
  ],

  /* 自动选基候选池（仅主题池：AI/半导体/科技/机器人/新能源，与上方 themeStocks 分组对应）。
     app.js 的 screenFunds() 调代理 /api/fund_screen 对全池按「近1月净值涨幅」降序，
     取 Top16 覆盖 CFG.funds（再走原有 loadFunds 灌实时），实现真·自动选基。
     code = 天天基金代码（近似可信，个别不准会优雅降级：净值取不到→动量沉底，不破坏联动）；
     aum = 规模（亿元，近似公开值，<2亿剔除门槛用）；themes 严格只用 7 分组键。 */
  fundUniverse: [
    /* —— 半导体 / 芯片 —— */
    { name: "诺安成长混合",        code: "320007", aum: 200, themes: ["semi", "storage", "ai", "robot", "tech", "terminal", "core"] },
    { name: "华夏中证5G通信联接A", code: "008086", aum: 30,  themes: ["semi", "storage", "ai", "robot", "tech", "terminal", "core"] },
    { name: "国联安中证半导体联接A", code: "007300", aum: 40,  themes: ["semi", "storage", "core"] },
    { name: "银河创新成长混合",    code: "519674", aum: 80,  themes: ["semi", "storage", "ai", "tech", "core"] },
    { name: "天弘中证电子联接A",    code: "001618", aum: 6,   themes: ["semi", "storage", "tech", "terminal"] },
    { name: "华夏国证半导体芯片联接A", code: "008888", aum: 25, themes: ["semi", "storage", "core"] },
    { name: "国联安中证半导体联接C", code: "007301", aum: 18,  themes: ["semi", "storage", "core"] },
    { name: "华夏国证半导体芯片联接C", code: "008887", aum: 22, themes: ["semi", "storage", "core"] },
    { name: "华夏中证5G通信联接C", code: "008087", aum: 12,  themes: ["semi", "storage", "ai", "tech", "terminal"] },

    /* —— 人工智能 / 计算机 —— */
    { name: "易方达中证人工智能联接A",  code: "012733", aum: 15, themes: ["ai", "tech", "core"] },
    { name: "华富中证人工智能产业联接A", code: "008020", aum: 8,  themes: ["ai", "tech", "terminal"] },
    { name: "易方达信息产业混合",  code: "001513", aum: 40,  themes: ["tech", "ai", "terminal"] },
    { name: "东财中证人工智能A",    code: "012321", aum: 10,  themes: ["ai", "tech"] },
    { name: "东财中证人工智能C",    code: "012322", aum: 8,   themes: ["ai", "tech"] },
    { name: "平安中证人工智能ETF联接A", code: "007817", aum: 14, themes: ["ai", "tech"] },
    { name: "天弘中证计算机联接A",  code: "001630", aum: 9,  themes: ["tech", "ai", "terminal"] },
    { name: "国泰中证计算机联接A",   code: "011832", aum: 11, themes: ["tech", "ai", "terminal"] },

    /* —— 机器人 / 具身智能 —— */
    { name: "天弘中证机器人联接A",  code: "014880", aum: 10,  themes: ["robot", "ai", "tech", "core"] },
    { name: "天弘中证机器人联接C",  code: "014881", aum: 7,   themes: ["robot", "ai", "tech"] },
    { name: "华夏中证机器人联接A",  code: "012919", aum: 13,  themes: ["robot", "ai", "tech", "core"] },
    { name: "华夏中证机器人联接C",  code: "013360", aum: 9,   themes: ["robot", "ai", "tech"] },
    { name: "万家人工智能A",      code: "014355", aum: 6,   themes: ["ai", "robot", "tech"] },

    /* —— 新能源 / 清洁能源 —— */
    { name: "农银新能源主题",      code: "002190", aum: 120, themes: ["ai", "tech"] },
    { name: "东方新能源汽车混合",  code: "400015", aum: 100, themes: ["ai", "tech"] },
    { name: "申万菱信新能源汽车", code: "001156", aum: 30,  themes: ["ai", "tech"] },
    { name: "创金合信新能源汽车A", code: "005928", aum: 25,  themes: ["ai", "tech"] },
    { name: "嘉实新能源新材料A",  code: "003984", aum: 20,  themes: ["ai", "tech"] },
    { name: "富国中证新能源汽车",  code: "161028", aum: 28,  themes: ["ai", "tech"] },

    /* —— 科技制造 / 创业板 / 科创50 / 纳斯达克100 / 动漫游戏 —— */
    { name: "前海开源公用事业",    code: "005669", aum: 90,  themes: ["tech", "ai"] },
    { name: "易方达创业板联接A",   code: "110026", aum: 60,  themes: ["tech", "core"] },
    { name: "华夏科创50联接A",     code: "011612", aum: 25,  themes: ["tech", "core", "semi"] },
    { name: "华夏科创50联接C",     code: "013305", aum: 18,  themes: ["tech", "core", "semi"] },
    { name: "南方科创板50联接A",   code: "011609", aum: 16,  themes: ["tech", "core", "semi"] },
    { name: "国泰纳斯达克100指数", code: "160213", aum: 110, themes: ["ai", "tech"] },
    { name: "华夏中证动漫游戏联接A", code: "012768", aum: 20, themes: ["tech", "ai"] },
    { name: "华夏中证动漫游戏联接C", code: "010685", aum: 14, themes: ["tech", "ai"] },
    { name: "华宝中证科技龙头ETF联接A", code: "007937", aum: 35, themes: ["tech", "ai", "core"] },
    { name: "富国中证科技50ETF联接A",  code: "008749", aum: 22, themes: ["tech", "ai", "core"] },
    { name: "申万菱信中证电子联接A", code: "012818", aum: 12, themes: ["semi", "tech", "terminal"] },
    { name: "招商中证物联网联接A",  code: "017846", aum: 8,  themes: ["tech", "ai", "terminal"] },
    { name: "天弘中证芯片产业联接A", code: "012552", aum: 10, themes: ["semi", "storage", "core"] },
    { name: "鹏华国证半导体芯片联接A", code: "012952", aum: 26, themes: ["semi", "storage", "core"] },
    { name: "银华中证5G通信联接A",  code: "008889", aum: 9,  themes: ["semi", "storage", "ai", "tech", "terminal"] }
  ],

  /* 特色基金（置顶单独一行，含「估算 vs 收盘」对比）：code 基金代码 */
  featuredFunds: [
    { name: "半导体联接A",  code: "020639" },
    { name: "核心优势A",    code: "018815" },
    { name: "机器人联接A",  code: "018344" }
  ],

  /* 主题个股监控（方案 A：按主题取「市值/流动性居前」龙头，非全量，非随手挑）。
     secid = 市场.代码（1=上交所，0=深交所，116=港股/补5位，105=美股/代码即 ticker，如 NVDA/AMD/TSM）。
     行情引擎 gtimg 已支持 105. 美股分支（us + ticker），与 A/港一致解析。
     price/chg 为「示例」兜底（实时不可达时显示），实时获取成功由 api.js 覆盖并标注「实时」。
     港股：小米集团为锚，另含 AI（商汤）、机器人（优必选）等领域代表。
     结构：最前「基础层·核心标的」含 AI 产业链基础层①②③全部股票；
           末尾「有色金属」为贵金属双卡（国际金银价 / 人民币每克 / 涨跌%），见 CFG.metalCards。
           增删直接改此处。 */
  themeStocks: [
    { group: "基础层·核心标的", theme: "core", stocks: [
      /* ① AI 芯片 + 算力服务器（美股 + A 股龙头；与半导体 / AI·人工智能重复者已移出本组） */
      { name: "英伟达",   code: "NVDA",  secid: "105.NVDA",  price: 0, chg: 0 },
      { name: "AMD",      code: "AMD",   secid: "105.AMD",   price: 0, chg: 0 },
      { name: "台积电",   code: "TSM",   secid: "105.TSM",   price: 0, chg: 0 },
      { name: "工业富联", code: "601138", secid: "1.601138", price: 0, chg: 0 },
      /* ② 先进封装 */
      { name: "长电科技", code: "600584", secid: "1.600584", price: 0, chg: 0 },
      { name: "通富微电", code: "002156", secid: "0.002156", price: 0, chg: 0 },
      { name: "华天科技", code: "002185", secid: "0.002185", price: 0, chg: 0 },
      { name: "晶方科技", code: "603005", secid: "1.603005", price: 0, chg: 0 },
      { name: "甬矽电子", code: "688362", secid: "1.688362", price: 0, chg: 0 },
      { name: "兴森科技", code: "002436", secid: "0.002436", price: 0, chg: 0 },
      /* ③ 纯光模块 */
      { name: "中际旭创", code: "300308", secid: "0.300308", price: 0, chg: 0 },
      { name: "新易盛",   code: "300502", secid: "0.300502", price: 0, chg: 0 },
      { name: "天孚通信", code: "300394", secid: "0.300394", price: 0, chg: 0 },
      { name: "光迅科技", code: "002281", secid: "0.002281", price: 0, chg: 0 },
      { name: "华工科技", code: "000988", secid: "0.000988", price: 0, chg: 0 },
      { name: "太辰光",   code: "300570", secid: "0.300570", price: 0, chg: 0 }
    ]},
    { group: "半导体", theme: "semi", stocks: [
      { name: "中芯国际", code: "688981", secid: "1.688981", price: 0, chg: 0 },
      { name: "北方华创", code: "002371", secid: "0.002371", price: 0, chg: 0 },
      { name: "韦尔股份", code: "603501", secid: "1.603501", price: 0, chg: 0 },
      { name: "海光信息", code: "688041", secid: "1.688041", price: 0, chg: 0 },
      { name: "寒武纪",   code: "688256", secid: "1.688256", price: 0, chg: 0 },
      { name: "中微公司", code: "688012", secid: "1.688012", price: 0, chg: 0 }
    ]},
    { group: "存储", theme: "storage", stocks: [
      { name: "兆易创新", code: "603986", secid: "1.603986", price: 0, chg: 0 },
      { name: "北京君正", code: "300223", secid: "0.300223", price: 0, chg: 0 },
      { name: "佰维存储", code: "688525", secid: "1.688525", price: 0, chg: 0 },
      { name: "江波龙",   code: "301308", secid: "0.301308", price: 0, chg: 0 },
      { name: "深科技",   code: "000021", secid: "0.000021", price: 0, chg: 0 },
      { name: "澜起科技", code: "688008", secid: "1.688008", price: 0, chg: 0 }
    ]},
    { group: "具身智能·机器人", theme: "robot", stocks: [
      { name: "汇川技术", code: "300124", secid: "0.300124", price: 0, chg: 0 },
      { name: "拓普集团", code: "601689", secid: "1.601689", price: 0, chg: 0 },
      { name: "三花智控", code: "002050", secid: "0.002050", price: 0, chg: 0 },
      { name: "鸣志电器", code: "603728", secid: "1.603728", price: 0, chg: 0 },
      { name: "绿的谐波", code: "688017", secid: "1.688017", price: 0, chg: 0 },
      { name: "埃斯顿",   code: "002747", secid: "0.002747", price: 0, chg: 0 },
      { name: "优必选",   code: "09880",  secid: "116.09880", price: 0, chg: 0 }
    ]},
    { group: "AI·人工智能", theme: "ai", stocks: [
      { name: "科大讯飞", code: "002230", secid: "0.002230", price: 0, chg: 0 },
      { name: "海康威视", code: "002415", secid: "0.002415", price: 0, chg: 0 },
      { name: "金山办公", code: "688111", secid: "1.688111", price: 0, chg: 0 },
      { name: "中科曙光", code: "603019", secid: "1.603019", price: 0, chg: 0 },
      { name: "浪潮信息", code: "000977", secid: "0.000977", price: 0, chg: 0 },
      { name: "三六零",   code: "601360", secid: "1.601360", price: 0, chg: 0 },
      { name: "小米集团", code: "01810",  secid: "116.01810", price: 0, chg: 0 },
      { name: "商汤",     code: "00020",  secid: "116.00020", price: 0, chg: 0 }
    ]},
    { group: "科技·制造", theme: "tech", stocks: [
      { name: "宁德时代", code: "300750", secid: "0.300750", price: 0, chg: 0 },
      { name: "比亚迪",   code: "002594", secid: "0.002594", price: 0, chg: 0 },
      { name: "立讯精密", code: "002475", secid: "0.002475", price: 0, chg: 0 },
      { name: "工业富联", code: "601138", secid: "1.601138", price: 0, chg: 0 },
      { name: "京东方A", code: "000725", secid: "0.000725", price: 0, chg: 0 },
      { name: "中际旭创", code: "300308", secid: "0.300308", price: 0, chg: 0 }
    ]},
    { group: "AI终端链", theme: "terminal", stocks: [
      { name: "立讯精密", code: "002475", secid: "0.002475", price: 0, chg: 0 },
      { name: "蓝思科技", code: "300433", secid: "0.300433", price: 0, chg: 0 },
      { name: "歌尔股份", code: "002241", secid: "0.002241", price: 0, chg: 0 },
      { name: "韦尔股份", code: "603501", secid: "1.603501", price: 0, chg: 0 },
      { name: "传音控股", code: "688036", secid: "1.688036", price: 0, chg: 0 },
      { name: "水晶光电", code: "002273", secid: "0.002273", price: 0, chg: 0 }
    ]}
  ],

  /* 有色金属（贵金属）双卡片：国际金银现货价 + 人民币每克 + 涨跌%
     数据由 GitHub Action（gen_data.py 服务端）抓取国际现货 + 汇率 → 算人民币每克 → 写 data/metals.json，
     页面静态读取；本地无该文件时回退 CFG.metalCards 内置「示例」占位（标注示例）。 */
  metalCards: [
    { metal: "gold",   name: "黄金", unit: "元/克",
      intlUsd: 2380.5, rmbPerG: 549.4, chg: 0.85,  src: "示例" },
    { metal: "silver", name: "白银", unit: "元/克",
      intlUsd: 28.4,   rmbPerG: 6.55,  chg: 1.20,  src: "示例" }
  ],

  /* 风格定义：name 为风格名；group 用于罗盘分组 */
  styleDefs: [
    { name: "大盘价值", group: "dv" },
    { name: "大盘成长", group: "dg" },
    { name: "小盘价值", group: "sv" },
    { name: "小盘成长", group: "sg" },
    { name: "红利低波", group: "div" },
    { name: "周期",     group: "cycl" },
    { name: "成长",     group: "grow" }
  ]
};

/* 示意数据（标注示意） */
window.ILLUSTRATIVE = {
  /* 指数：price 点位，chg 涨跌幅% */
  indexes: {
    sh:    { price: 3210.52, chg: -0.42 },
    sz:    { price: 10120.34, chg: -0.65 },
    cyb:   { price: 2015.81, chg: -0.88 },
    hs300: { price: 3780.20, chg: -0.35 },
    kc50:  { price: 885.43, chg: -1.05 }
  },

  /* 16 行业：chg 涨跌幅%，net 主力净流入（亿元，正=流入） */
  sectors: [
    { name: "银行",     chg:  1.25, net:  28.6 },
    { name: "食品饮料", chg:  0.42, net:   5.2 },
    { name: "医药生物", chg: -0.35, net:  -8.4 },
    { name: "电子",     chg:  2.15, net:  42.3 },
    { name: "计算机",   chg:  1.78, net:  31.0 },
    { name: "电力设备", chg: -1.20, net: -22.5 },
    { name: "汽车",     chg:  0.55, net:   6.8 },
    { name: "家用电器", chg:  0.30, net:   3.1 },
    { name: "有色金属", chg:  1.05, net:  18.9 },
    { name: "基础化工", chg: -0.20, net:  -4.2 },
    { name: "机械设备", chg:  0.65, net:   9.5 },
    { name: "房地产",   chg: -0.85, net: -12.3 },
    { name: "建筑材料", chg: -0.45, net:  -5.6 },
    { name: "非银金融", chg:  0.95, net:  15.4 },
    { name: "国防军工", chg:  1.55, net:  24.7 },
    { name: "通信",     chg:  1.10, net:  13.2 }
  ],

  /* 16 基金：chg 估算涨跌幅%，gsz 估算净值，code 用于实时匹配 */
  funds: [
    { name: "招商中证白酒",   code: "161725", chg:  0.62, gsz: 1.0234 },
    { name: "易方达蓝筹精选", code: "005827", chg:  0.85, gsz: 2.4130 },
    { name: "中欧医疗健康A",  code: "003095", chg: -0.35, gsz: 1.8765 },
    { name: "诺安成长混合",   code: "320007", chg:  2.05, gsz: 1.5620 },
    { name: "农银新能源主题", code: "002190", chg: -1.10, gsz: 2.9801 },
    { name: "华夏中证5G",    code: "008086", chg:  1.25, gsz: 1.1203 },
    { name: "富国天惠成长",   code: "161005", chg:  0.45, gsz: 3.5120 },
    { name: "兴全合宜混合",   code: "163417", chg:  0.30, gsz: 1.7840 },
    { name: "易方达消费行业", code: "110022", chg:  0.55, gsz: 3.2210 },
    { name: "前海开源公用事业", code: "005669", chg: -0.80, gsz: 2.6650 },
    { name: "华夏沪深300联接", code: "000051", chg: -0.30, gsz: 1.6820 },
    { name: "南方中证500联接", code: "160119", chg: -0.55, gsz: 1.5402 },
    { name: "易方达创业板联接", code: "110026", chg: -0.75, gsz: 2.1030 },
    { name: "国泰纳斯达克100", code: "160213", chg:  1.40, gsz: 5.4320 },
    { name: "易方达黄金联接",   code: "000307", chg:  0.65, gsz: 1.9820 },
    { name: "招商产业债券A",  code: "217022", chg:  0.02, gsz: 1.3560 }
  ],

  /* 特色基金示意：chg 估算涨跌幅%，gsz 估算净值，jjjz 昨收净值(兜底)，
     closeNav/closeChg 官方最新收盘净值/涨跌幅（经本地代理自净值历史取，file:// 兜底用真值） */
  featuredFunds: [
    { name: "半导体联接A",  code: "020639", chg: -6.13, gsz: 3.1931, jjjz: 3.4016, closeNav: 3.2011, closeChg: -5.89 },
    { name: "核心优势A",    code: "018815", chg: -10.74, gsz: 2.0736, jjjz: 2.3224, closeNav: 2.0388, closeChg: -12.24 },
    { name: "机器人联接A",  code: "018344", chg: -5.91, gsz: 1.1733, jjjz: 1.2470, closeNav: 1.1773, closeChg: -5.59 }
  ],

  /* 风格：score 轮动强度（-10~+10），chg5 近5日涨跌% */
  styles: [
    { name: "大盘价值", score:  0.8, chg5:  1.2 },
    { name: "大盘成长", score: -0.5, chg5: -0.8 },
    { name: "小盘价值", score:  1.5, chg5:  2.1 },
    { name: "小盘成长", score:  0.3, chg5:  0.5 },
    { name: "红利低波", score:  1.9, chg5:  2.5 },
    { name: "周期",     score:  0.6, chg5:  0.9 },
    { name: "成长",     score: -0.2, chg5: -0.3 }
  ],

  /* 有色金属（贵金属）示例兜底：国际现货 USD/盎司 + 人民币每克 + 涨跌%
     （本地 / 接口不可达时显示；GitHub Pages 上线后由 data/metals.json 覆盖并标注「实时」） */
  metals: {
    gold:   { intlUsd: 2380.5, rmbPerG: 549.4, chg: 0.85,  src: "示例" },
    silver: { intlUsd: 28.4,   rmbPerG: 6.55,  chg: 1.20,  src: "示例" }
  },

  /* 北向资金：today 当日净买入（亿元，示意/收盘口径）；series 近20交易日净买入（亿元） */
  northbound: {
    today: 12.4,
    series: [
       8.2, -15.6,  4.1, 22.3, -6.8, 11.5,  3.2, -9.4, 18.7,  5.0,
      -3.3, 14.9, -11.2,  7.8, 26.4, -4.5,  9.6, -2.1, 16.3, 12.4
    ]
  }
};
