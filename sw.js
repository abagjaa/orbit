/* ═══════════════════════════════════════════════════════
   ABAGJA ORBIT — Service Worker
   Cache-first untuk asset statis, network-first untuk API
═══════════════════════════════════════════════════════ */

const CACHE_NAME = 'orbit-v1';
const CACHE_VERSION = 1;

// Asset yang di-cache saat install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/clock.html',
  '/currency.html',
  '/calculator.html',
  '/notes.html',
  '/app.js',
  '/style.css',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// URL yang tidak di-cache (API calls)
const NETWORK_ONLY = [
  'api.exchangerate',
  'open.er-api',
  'googleapis.com/css'
];

/* ── INSTALL: pre-cache semua static assets ── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching static assets...');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        // Jangan gagal install kalau ada 1 asset yang miss
        console.warn('[SW] Some assets failed to cache:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

/* ── ACTIVATE: hapus cache lama ── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim())
  );
});

/* ── FETCH: strategi per tipe request ── */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET dan chrome-extension
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // Network-only untuk API calls (kurs dll)
  const isNetworkOnly = NETWORK_ONLY.some((pattern) =>
    request.url.includes(pattern)
  );
  if (isNetworkOnly) {
    event.respondWith(
      fetch(request).catch(() => {
        // Kalau offline dan API gagal, return JSON kosong
        return new Response(JSON.stringify({ offline: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Stale-while-revalidate untuk Google Fonts
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Cache-first untuk semua asset lokal (HTML, CSS, JS, icons)
  event.respondWith(cacheFirst(request));
});

/* ── STRATEGIES ── */

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline fallback
    return new Response(
      `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8">
      <title>Offline — Abagja Orbit</title>
      <style>
        body{font-family:'Sora',sans-serif;background:#0a0908;color:#f0ead8;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          min-height:100vh;gap:1rem;text-align:center;padding:2rem}
        h1{font-size:3rem;color:#e8b84b;font-family:serif;letter-spacing:-.02em}
        p{color:#6a5e48;font-size:.85rem;max-width:300px;line-height:1.7}
        .dot{width:8px;height:8px;border-radius:50%;background:#d9534a;
          display:inline-block;margin-right:6px}
      </style></head>
      <body>
        <h1>Orbit</h1>
        <p><span class="dot"></span>Tidak ada koneksi internet.<br>
        Fitur yang memerlukan data live (kurs, dll) tidak tersedia.<br>
        Halaman akan otomatis aktif kembali saat online.</p>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });

  return cached || fetchPromise;
}

/* ── BACKGROUND SYNC untuk notes (opsional) ── */
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-notes') {
    event.waitUntil(syncNotes());
  }
});

async function syncNotes() {
  // Notes tersimpan di localStorage — tidak perlu sync ke server
  // Placeholder untuk future Firebase sync
  console.log('[SW] Notes sync triggered');
}

/* ── PUSH NOTIFICATIONS (untuk alarm dari clock.html) ── */
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = {};
  try { data = event.data.json(); } catch {}

  const title = data.title || 'Abagja Orbit';
  const options = {
    body: data.body || 'Notifikasi dari Orbit',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/' },
    actions: [
      { action: 'open', title: 'Buka' },
      { action: 'dismiss', title: 'Tutup' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
