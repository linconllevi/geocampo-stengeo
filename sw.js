/* Service worker: app offline + cache dos blocos do mapa */
const VERSAO = 'geocampo-v1.0.3';
const SHELL = [
  './', 'index.html', 'config.js', 'manifest.webmanifest', 'css/app.css',
  'js/db.js', 'js/geo.js', 'js/api.js', 'js/mapa.js', 'js/app.js',
  'lib/leaflet.js', 'lib/leaflet.css', 'lib/leaflet-geoman.min.js', 'lib/leaflet-geoman.css', 'lib/proj4.js',
  'lib/togeojson.umd.js', 'lib/jszip.min.js', 'lib/shp.min.js',
  'lib/georaster.browser.bundle.min.js', 'lib/georaster-layer-for-leaflet.min.js',
  'lib/images/marker-icon.png', 'lib/images/marker-icon-2x.png', 'lib/images/marker-shadow.png', 'lib/images/layers.png',
  'img/logo.png', 'img/icon-192.png', 'img/icon-512.png'
];
const TILES = /(mt\d?\.google\.com\/vt|arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery|tile\.openstreetmap\.org)/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('geocampo-') && k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (e.request.method !== 'GET') return;
  if (/script\.google(usercontent)?\.com|generativelanguage\.googleapis\.com/.test(url)) return; // API: sempre rede
  if (TILES.test(url)) {
    // blocos do mapa: cache primeiro, guarda o que for visto
    e.respondWith(caches.open('gc-tiles').then(async c => {
      const hit = await c.match(url);
      if (hit) return hit;
      try { const r = await fetch(e.request); if (r && (r.ok || r.type === 'opaque')) c.put(url, r.clone()); return r; }
      catch (err) { return new Response('', { status: 504 }); }
    }));
    return;
  }
  if (new URL(url).origin === location.origin) {
    // app: rede primeiro (para pegar atualizações), cache se offline
    e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(VERSAO).then(c => c.put(e.request, cp)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  }
});
