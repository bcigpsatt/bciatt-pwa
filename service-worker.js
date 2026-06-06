/**
 * BCI Att — Service Worker
 * ============================================================
 * PURPOSE:
 *   Makes the Apps Script web app feel instant on repeat visits.
 *   The HTML/CSS/JS is served by Google Apps Script (slow cold
 *   start). On first load we let it through normally, then cache
 *   the shell. On subsequent loads we serve the cached shell
 *   instantly while quietly checking for updates in background.
 *
 * IMPORTANT — we ONLY cache the app shell (the HTML/CSS/JS).
 *   We NEVER cache:
 *     • google.script.run calls (punch in/out, dashboards)
 *     • Any POST/PUT/DELETE requests
 *   Punch data ALWAYS goes live to the server. Safety first.
 *
 * Author: BCI Att
 * Version: v1.0.0  (bump this to force-refresh cache on all phones)
 * ============================================================
 */

const CACHE_VERSION = 'bciatt-v1.0.0';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;

// We do NOT pre-cache anything during install — the HTML lives on
// script.googleusercontent.com which redirects each visit, so we
// cache opportunistically on first GET instead.

// ─────────────────────────────────────────────────────────────
// INSTALL: take over immediately
// ─────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  self.skipWaiting(); // activate this new SW right away on update
});

// ─────────────────────────────────────────────────────────────
// ACTIVATE: clean up old cache versions
// ─────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// ─────────────────────────────────────────────────────────────
// FETCH: stale-while-revalidate for the app shell only
// ─────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Skip non-GET requests entirely (POSTs go straight to server)
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // CRITICAL: never intercept google.script.run RPC calls or any
  // dynamic Apps Script execution. Those must always be live.
  // Apps Script RPCs use /macros/echo & /scripts.run endpoints.
  if (url.hostname.indexOf('googleusercontent.com') === -1 &&
      url.hostname.indexOf('script.google.com')      === -1 &&
      url.hostname !== self.location.hostname) {
    // Third-party request (e.g. Google Maps, CDN) — let it through
    return;
  }
  if (url.pathname.includes('/scripts.run') ||
      url.pathname.includes('/echo')        ||
      url.search.includes('userCodeAppPanel')) {
    return; // don't touch RPC traffic
  }

  // Only cache the main app shell document (text/html navigations)
  const isNavigation =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (!isNavigation) {
    // Static assets (icons etc.) — cache-first
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((resp) => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, clone));
        }
        return resp;
      }).catch(() => cached))
    );
    return;
  }

  // App shell — stale-while-revalidate
  event.respondWith(
    caches.open(SHELL_CACHE).then((cache) => {
      return cache.match(req).then((cached) => {
        const networkFetch = fetch(req).then((response) => {
          if (response && response.status === 200) {
            cache.put(req, response.clone());
          }
          return response;
        }).catch(() => cached); // offline fallback

        // Serve cached version INSTANTLY if available, refresh in background
        return cached || networkFetch;
      });
    })
  );
});

// ─────────────────────────────────────────────────────────────
// MESSAGE: allow page to ask us to skip waiting / clear cache
// ─────────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
  }
});
