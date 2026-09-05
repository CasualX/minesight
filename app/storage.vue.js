const MINESIGHT_STORAGE_KEY = 'minesight';
const MINESIGHT_CACHE_PREFIX = 'minesight';

const MinesightStorage = Object.freeze({
	load() {
		try {
			let data = JSON.parse(window.localStorage.getItem(MINESIGHT_STORAGE_KEY) || '{}');
			return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
		}
		catch {
			return {};
		}
	},

	get(key, fallback) {
		let data = this.load();
		return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback;
	},

	set(key, value) {
		try {
			let data = this.load();
			data[key] = value;
			window.localStorage.setItem(MINESIGHT_STORAGE_KEY, JSON.stringify(data));
			return true;
		}
		catch {
			return false;
		}
	},

	async usage() {
		let bytes = 0;
		try {
			let stored = window.localStorage.getItem(MINESIGHT_STORAGE_KEY);
			if (stored !== null) {
				bytes += new TextEncoder().encode(MINESIGHT_STORAGE_KEY).byteLength;
				bytes += new TextEncoder().encode(stored).byteLength;
			}
		}
		catch {}

		try {
			if ('caches' in window) {
				let names = (await window.caches.keys()).filter(name => (
					name === MINESIGHT_CACHE_PREFIX || name.startsWith(`${MINESIGHT_CACHE_PREFIX}-`)
				));
				for (let name of names) {
					let responses = await (await window.caches.open(name)).matchAll();
					for (let response of responses) {
						let header = response.headers.get('content-length');
						let contentLength = Number(header);
						bytes += header !== null && Number.isFinite(contentLength) && contentLength >= 0
							? contentLength
							: (await response.blob()).size;
					}
				}
			}
		}
		catch {}
		return bytes;
	},

	async clear() {
		window.localStorage.removeItem(MINESIGHT_STORAGE_KEY);
		if (!('caches' in window)) return;
		let names = (await window.caches.keys()).filter(name => (
			name === MINESIGHT_CACHE_PREFIX || name.startsWith(`${MINESIGHT_CACHE_PREFIX}-`)
		));
		await Promise.all(names.map(name => window.caches.delete(name)));
	},
});
