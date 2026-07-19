// 端到端验证 worker.js 的抓取逻辑（直接对真实天天基金跑，确认移植正确）
import { screenRank, navHistory, sharpe, themesOf, fundFamily } from './worker.js';

async function main() {
  console.log('=== screenRank(16,"1m") 对真实天天基金 ===');
  const t0 = Date.now();
  const rows = await screenRank(16, '1m');
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('耗时', dt + 's   count =', rows.length);

  const denies = rows.filter((r) => /生物|医药|债|QDII|港股|海外|货币/.test(r.name));
  const empty = rows.filter((r) => !r.themes.length);
  console.log('否定词泄漏 =', denies.length, ' 空主题 =', empty.length);

  for (const r of rows) {
    console.log(`  ${r.code} ${r.name}  ${(r.mom1m * 100).toFixed(2)}%  ${r.themes.join('/')}`);
  }

  console.log('\n=== 净值历史 + 夏普（沪深300ETF 基准）===');
  const navs = await navHistory('510300', 13);
  console.log('bench navs =', navs.length, ' sharpe =', sharpe(navs)?.toFixed(3));

  console.log('\n=== 单元：themesOf / fundFamily ===');
  console.log('  "国泰半导体制造精选混合发起A" ->', JSON.stringify(themesOf('国泰半导体制造精选混合发起A')));
  console.log('  "易方达中证海外互联网50ETF联接(QDII)C" ->', JSON.stringify(themesOf('易方达中证海外互联网50ETF联接(QDII)C')));
  console.log('  family("银华集成电路混合A") ->', fundFamily('银华集成电路混合A'));
  console.log('  family("银华集成电路混合C") ->', fundFamily('银华集成电路混合C'));
}

main().catch((e) => { console.error(e); process.exit(1); });
