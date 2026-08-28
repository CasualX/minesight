const CACHE_PREFIX = 'minesight';
const CACHE_NAME = `${CACHE_PREFIX}-v20260828icons11`;
const APP_SHELL_URL = new URL('./index.html', self.registration.scope).href;
const APP_ASSETS = [
	'./',
	'./index.html',
	'./index.css',
	'./feedback.css',
	'./index.js',
	'./feedback.js',
	'./sounds.js',
	'./mines.js',
	'./minetacs.wasm',
	'./alpine.min.js',
	'./header-icon.svg',
	'./favicon.svg',
	'./manifest.webmanifest?v=20260828pwa5',
	'./icon/icon.svg?v=20260828icons5',
	'./icon/icon-192.png?v=20260828icons5',
	'./icon/icon-512.png?v=20260828icons5',
	'./icon/icon-maskable-512.png?v=20260828icons5',
	'./icon/icon-monochrome-512.png?v=20260828icons5',
];

self.addEventListener('install', event => {
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then(cache => cache.addAll(APP_ASSETS))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', event => {
	event.waitUntil(
		caches.keys().then(keys => Promise.all(
			keys
				.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
				.map(key => caches.delete(key))
		)).then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', event => {
	if (event.request.method !== 'GET') return;

	if (event.request.mode === 'navigate') {
		event.respondWith(
			caches.open(CACHE_NAME).then(cache =>
				cache.match(APP_SHELL_URL).then(cachedShell => cachedShell || fetch(event.request))
			)
		);
		return;
	}

	event.respondWith(
		caches.open(CACHE_NAME).then(cache => cache.match(event.request).then(cachedResponse => {
			if (cachedResponse) return cachedResponse;

			return fetch(event.request).then(networkResponse => {
				if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
					return networkResponse;
				}

				event.waitUntil(cache.put(event.request, networkResponse.clone()));
				return networkResponse;
			});
		}))
	);
});
