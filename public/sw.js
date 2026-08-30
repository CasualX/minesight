const CACHE_PREFIX = 'minesight';
const CACHE_NAME = `${CACHE_PREFIX}-v20260830beginner4`;
const APP_ROOT_URL = new URL('./', self.registration.scope);
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
	'./manifest.webmanifest',
	'./icon/icon.svg',
	'./icon/icon-192.png',
	'./icon/icon-512.png',
	'./icon/icon-maskable-512.png',
	'./icon/icon-monochrome-512.png',
];

self.addEventListener('install', event => {
	let requests = APP_ASSETS.map(asset => new Request(
		new URL(asset, self.registration.scope),
		{ cache: 'reload' },
	));
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then(cache => cache.addAll(requests))
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
		let requestUrl = new URL(event.request.url);
		let isAppNavigation = requestUrl.origin === APP_ROOT_URL.origin && (
			requestUrl.pathname === APP_ROOT_URL.pathname ||
			requestUrl.pathname === new URL(APP_SHELL_URL).pathname
		);
		if (isAppNavigation) {
			event.respondWith(
				caches.open(CACHE_NAME).then(cache =>
					cache.match(APP_SHELL_URL).then(cachedShell => cachedShell || fetch(event.request))
				)
			);
			return;
		}
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
