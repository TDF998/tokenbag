/* A股主题个股·基金监控终端 — Service Worker
 * 作用：缓存「静态外壳」（html/css/js/本地兜底数据），二次打开秒开、弱网/离线可见骨架。
 * 关键：所有 7 路实时数据源（腾讯 gtimg / push2 / fundgz / 贵金属 / Cloudflare Worker 代理）
 *        均为「跨域」请求，本 SW 一律放行走网络、绝不缓存，保证数据始终实时。
 */

const CACHE = 'ashare-shell-v1';

// 同源静态资源清单（相对 SW 所在目录解析，兼容 localhost 根路径与 GitHub Pages /repo/ 子路径）
const SHELL = [
  './',
  'index.html',
  'styles.min.css',
  'js/api.min.js',
  'js/app.min.js',
  'js/data.min.js',
  'js/charts.min.js',
  'data/funds.json',
  'data/metals.json'
];

self.addEventListener('install', (event) => {
  // 跳过等待，新 SW 立即激活（便于推送更新后用户下次刷新即生效）
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {/* 任一资源 404 不阻断安装 */})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 跨域请求（7 路数据源 / 代理）→ 直接走默认网络，不 intercept、不缓存
  if (url.origin !== self.location.origin) return;

  // 文档（index.html）：network-first，回退缓存（保证部署更新能推到用户）
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        const cached = (await caches.match(req)) || (await caches.match('index.html')) || (await caches.match('./'));
        return cached || Response.error();
      }
    })());
    return;
  }

  // 其余同源静态资源：stale-while-revalidate（先返缓存秒开，后台更新缓存）
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req)
      .then((fresh) => {
        if (fresh && fresh.status === 200) cache.put(req, fresh.clone());
        return fresh;
      })
      .catch(() => null);
    return cached || network;
  })());
});
