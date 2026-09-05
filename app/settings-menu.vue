<link rel="component" href="storage.vue.js">

<script>
function formatStorageSize(bytes) {
	if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';
	if (bytes < 1024) return `${Math.round(bytes)} B`;
	let units = ['KiB', 'MiB', 'GiB', 'TiB'];
	let value = bytes;
	let unit = 'B';
	for (let nextUnit of units) {
		value /= 1024;
		unit = nextUnit;
		if (value < 1024) break;
	}
	return `${value.toFixed(value < 10 ? 1 : 0)} ${unit}`;
}

function settingsInstallInstructions() {
	let userAgent = navigator.userAgent;
	let appleMobile = /iPad|iPhone|iPod/.test(userAgent)
		|| (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	if (appleMobile) return 'In Safari, tap Share, then Add to Home Screen.';
	let safari = /Safari/.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(userAgent);
	if (safari) return 'In Safari, choose File, then Add to Dock.';
	return 'Open your browser menu and choose Install app or Add to Home screen.';
}

function settingsAppInstalled() {
	return window.matchMedia('(display-mode: standalone)').matches || Reflect.get(navigator, 'standalone') === true;
}

const SettingsMenu = Vue.defineComponent({
	template: '#settings-menu',
	props: {
		open: Boolean,
		colorScheme: { type: String, default: 'system' },
		soundEnabled: { type: Boolean, default: true },
	},
	emits: ['close', 'color-scheme-change', 'sound-change'],
	data() {
		return {
			appInstalled: settingsAppInstalled(),
			installPrompt: /** @type {{ prompt(): Promise<void>, userChoice: Promise<unknown> } | null} */ (null),
			storageUsageText: 'Checking storage usage…',
			storagePersisted: false,
			storagePersistenceBusy: false,
			storageMessage: '',
			wipeStorageBusy: false,
		};
	},
	computed: {
		canInstallApp() {
			return !this.appInstalled && this.installPrompt !== null;
		},
		appInstallMessage() {
			if (this.appInstalled) return 'Minesight is installed and opens as its own app.';
			if (this.canInstallApp) return 'Play in its own window and keep it close at hand.';
			return settingsInstallInstructions();
		},
		storagePersistenceSupported() {
			return typeof navigator.storage?.persisted === 'function'
				&& typeof navigator.storage?.persist === 'function';
		},
		storagePersistenceDisabled() {
			return !this.storagePersistenceSupported || this.storagePersisted || this.storagePersistenceBusy;
		},
		storagePersistenceMessage() {
			if (this.storageMessage) return this.storageMessage;
			if (!this.storagePersistenceSupported) return 'Persistent storage is not supported by this browser.';
			if (this.storagePersisted) return 'Enabled. Turn it off from your browser\'s site settings.';
			return 'Ask the browser to keep progress and offline files when storage runs low.';
		},
	},
	watch: {
		open(isOpen) {
			document.body.classList.toggle('settings-open', isOpen);
			if (isOpen) {
				void this.refreshStorageInfo();
				this.$nextTick(() => this.$refs.closeButton?.focus());
			}
		},
	},
	methods: {
		captureInstallPrompt(event) {
			event.preventDefault();
			this.installPrompt = event;
		},
		markInstalled() {
			this.installPrompt = null;
			this.appInstalled = true;
		},
		requestClose() {
			this.$emit('close');
		},
		handleKeydown(event) {
			if (this.open && event.key === 'Escape') this.requestClose();
		},
		async installApp() {
			if (!this.canInstallApp) {
				return;
			}
			let prompt = this.installPrompt;
			this.installPrompt = null;
			if (!prompt) {
				return;
			}
			await prompt.prompt();
			await prompt.userChoice;
		},
		async refreshStorageInfo() {
			this.storageMessage = '';
			try {
				let usage = await MinesightStorage.usage();
				let quota;
				if (typeof navigator.storage?.estimate === 'function') {
					({ quota } = await navigator.storage.estimate());
				}
				this.storageUsageText = `${formatStorageSize(usage)} used${typeof quota === 'number' ? ` out of ${formatStorageSize(quota)}` : ''}.`;
			}
			catch {
				this.storageUsageText = 'Storage usage is unavailable.';
			}
			if (this.storagePersistenceSupported) {
				try {
					this.storagePersisted = await navigator.storage.persisted();
				}
				catch {
					this.storageMessage = 'Persistent storage status is unavailable.';
				}
			}
		},
		async enablePersistentStorage() {
			if (this.storagePersistenceDisabled) {
				return;
			}
			this.storagePersistenceBusy = true;
			this.storageMessage = 'Requesting persistent storage…';
			try {
				this.storagePersisted = await navigator.storage.persist();
				this.storageMessage = this.storagePersisted
					? 'Enabled. Turn it off from your browser\'s site settings.'
					: 'The browser did not grant persistent storage.';
			}
			catch {
				this.storageMessage = 'Persistent storage could not be enabled.';
			}
			finally {
				this.storagePersistenceBusy = false;
			}
		},
		async wipeMinesightData() {
			const WIPE_MESSAGE = 'Wipe all Minesight data?\n\nThis permanently deletes saved progress, preferences, and offline files on this device.';
			if (this.wipeStorageBusy || !window.confirm(WIPE_MESSAGE)) {
				return;
			}
			this.wipeStorageBusy = true;
			try {
				await MinesightStorage.clear();
				window.location.reload();
			}
			catch {
				this.wipeStorageBusy = false;
				this.storageMessage = 'Minesight data could not be completely removed.';
				void this.refreshStorageInfo();
			}
		},
	},
	mounted() {
		window.addEventListener('keydown', this.handleKeydown);
		window.addEventListener('beforeinstallprompt', this.captureInstallPrompt);
		window.addEventListener('appinstalled', this.markInstalled);
	},
	beforeUnmount() {
		document.body.classList.remove('settings-open');
		window.removeEventListener('keydown', this.handleKeydown);
		window.removeEventListener('beforeinstallprompt', this.captureInstallPrompt);
		window.removeEventListener('appinstalled', this.markInstalled);
	},
});
</script>

<template id="settings-menu">
	<transition name="settings-fade">
		<div v-show="open" class="settings-menu__backdrop" @click.self="requestClose">
			<transition name="settings-slide">
				<section v-show="open" id="settings-dialog" class="settings-menu__sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" @click.stop>
					<header class="settings-menu__heading">
						<h2 id="settings-title">Settings</h2>
						<button ref="closeButton" type="button" class="control-feedback settings-menu__close" aria-label="Close settings" @click="requestClose">×</button>
					</header>

					<fieldset class="settings-menu__group">
						<legend class="sr-only">Color scheme</legend>
						<strong>Color scheme</strong>
						<div class="settings-menu__schemes">
							<label v-for="scheme in ['system', 'light', 'dark']" :key="scheme">
								<input type="radio" name="color-scheme" :value="scheme" :checked="colorScheme === scheme" @change="$emit('color-scheme-change', scheme)">
								<span>{{ scheme[0].toUpperCase() + scheme.slice(1) }}</span>
							</label>
						</div>
					</fieldset>

					<div class="settings-menu__group settings-menu__sound">
						<strong>Sound effects</strong>
						<label class="settings-menu__switch">
							<span class="sr-only">Sound effects</span>
							<input type="checkbox" :checked="soundEnabled" @change="$emit('sound-change', $event.target.checked)">
							<span class="settings-menu__switch-track" aria-hidden="true"></span>
						</label>
					</div>

					<div class="settings-menu__group settings-menu__install">
						<div class="settings-menu__copy"><strong>Install Minesight</strong><p role="status">{{ appInstallMessage }}</p></div>
						<button class="control-feedback" v-if="canInstallApp" type="button" @click="installApp">Install</button>
					</div>

					<div class="settings-menu__group settings-menu__storage">
						<div class="settings-menu__row">
							<div class="settings-menu__copy">
								<strong>Persistent storage <a class="settings-menu__help" href="https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria" target="_blank" rel="noopener noreferrer" aria-label="Learn about persistent storage on MDN" title="What is persistent storage?"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 1 1 5.83 1c0 2-3 3-3 3"></path><path d="M12 17h.01"></path></svg></a></strong>
								<p role="status" aria-live="polite">{{ storagePersistenceMessage }}</p>
							</div>
							<label class="settings-menu__switch" :class="{ 'settings-menu__switch--disabled': storagePersistenceDisabled }">
								<span class="sr-only">Persistent storage</span>
								<input type="checkbox" :checked="storagePersisted" :disabled="storagePersistenceDisabled" @change="enablePersistentStorage">
								<span class="settings-menu__switch-track" aria-hidden="true"></span>
							</label>
						</div>
						<div class="settings-menu__row settings-menu__wipe">
							<div class="settings-menu__copy"><strong>Storage used</strong><p role="status">{{ storageUsageText }}</p></div>
							<button type="button" class="control-feedback settings-menu__danger" :disabled="wipeStorageBusy" @click="wipeMinesightData">{{ wipeStorageBusy ? 'Wiping…' : 'Wipe data' }}</button>
						</div>
					</div>

					<footer class="settings-menu__about">
						<p>Minesight is free and open source.</p>
						<a href="./review.html">Read the totally unbiased review <span aria-hidden="true">→</span></a>
						<a href="https://github.com/CasualX/minesight" target="_blank" rel="noopener noreferrer">CasualX/minesight on GitHub <span aria-hidden="true">↗</span></a>
					</footer>
				</section>
			</transition>
		</div>
	</transition>
</template>

<style>
.sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
}
body.settings-open {
	overflow: hidden;
}
.settings-menu__backdrop {
	position: fixed;
	inset: 0;
	z-index: 30;
	display: flex;
	align-items: flex-end;
	justify-content: center;
	padding: 20px 10px 0;
	background: rgb(0 0 0 / 48%);
}
.settings-menu__sheet {
	width: min(460px, 100%);
	max-height: calc(100dvh - 20px);
	overflow-y: auto;
	padding: 22px 22px calc(22px + env(safe-area-inset-bottom));
	border: 1px solid var(--line);
	border-bottom: 0;
	border-radius: 18px 18px 0 0;
	background: var(--paper);
	box-shadow: 0 -12px 40px rgb(0 0 0 / 22%);
}
.settings-fade-enter-active,
.settings-fade-leave-active {
	transition: opacity 180ms ease;
}
.settings-fade-enter-from,
.settings-fade-leave-to {
	opacity: 0;
}
.settings-slide-enter-active {
	transition: transform 260ms cubic-bezier(.2, .8, .2, 1);
}
.settings-slide-leave-active {
	transition: transform 180ms ease-in;
}
.settings-slide-enter-from,
.settings-slide-leave-to {
	transform: translateY(100%);
}
.settings-menu__heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 20px;
	padding: 0 2px 10px;
}
.settings-menu__heading h2 {
	margin: 0;
	font: 700 30px/1 Georgia, "Times New Roman", serif;
	letter-spacing: -.035em;
}
.settings-menu__close {
	display: grid;
	place-items: center;
	width: 32px;
	height: 32px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: transparent;
	color: var(--muted);
	font-size: 24px;
	line-height: 1;
}
.settings-menu__close:hover:not(:disabled) {
	background: var(--covered);
	color: var(--ink);
}
.settings-menu__group {
	margin: 0;
	padding: 19px 2px;
	border: 0;
	border-bottom: 1px solid var(--line);
	font-family: ui-sans-serif, system-ui, sans-serif;
}
.settings-menu__heading + .settings-menu__group {
	border-top: 1px solid var(--line);
}
.settings-menu__group strong {
	padding: 0;
	font-size: 14px;
	font-weight: 750;
}
.settings-menu__schemes {
	position: relative;
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 5px;
	isolation: isolate;
	margin-top: 12px;
	padding: 4px;
	border: 1px solid var(--line);
	border-radius: 10px;
	background: var(--background);
	user-select: none;
}
.settings-menu__schemes::before {
	position: absolute;
	inset: 4px auto 4px 4px;
	z-index: 0;
	width: calc((100% - 18px) / 3);
	border-radius: 7px;
	background: var(--ink);
	box-shadow: 0 1px 3px rgb(0 0 0 / 16%);
	content: '';
	transition: transform 190ms cubic-bezier(.2, .8, .2, 1);
}
.settings-menu__schemes:has(label:nth-child(2) input:checked)::before {
	transform: translateX(calc(100% + 5px));
}
.settings-menu__schemes:has(label:nth-child(3) input:checked)::before {
	transform: translateX(calc(200% + 10px));
}
.settings-menu__schemes label {
	position: relative;
	cursor: pointer;
}
.settings-menu__schemes input {
	position: absolute;
	opacity: 0;
}
.settings-menu__schemes span {
	position: relative;
	z-index: 1;
	display: block;
	padding: 7px 8px;
	border-radius: 6px;
	text-align: center;
	font-size: 12px;
	font-weight: 650;
	transition: background 120ms ease, color 120ms ease;
}
.settings-menu__schemes input:checked + span {
	color: var(--paper);
}
.settings-menu__schemes label:hover input:not(:checked) + span {
	background: var(--covered);
}
.settings-menu__schemes input:focus-visible + span {
	outline: 2px solid var(--focus);
	outline-offset: 2px;
}
.settings-menu__sound,
.settings-menu__install,
.settings-menu__row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 20px;
}
.settings-menu__copy {
	display: grid;
	gap: 5px;
}
.settings-menu__copy p {
	max-width: 280px;
	margin: 0;
	color: var(--muted);
	font-size: 12px;
	line-height: 1.45;
}
.settings-menu__install button {
	flex: none;
	min-width: 78px;
	padding: 9px 14px;
	border: 1px solid var(--ink);
	border-radius: 8px;
	background: var(--ink);
	color: var(--paper);
	font-weight: 750;
}
.settings-menu__storage {
	display: grid;
	gap: 17px;
}
.settings-menu__wipe {
	padding-top: 17px;
	border-top: 1px solid var(--line);
}
.settings-menu__help {
	display: inline-grid;
	place-items: center;
	width: 17px;
	height: 17px;
	margin-left: 3px;
	color: var(--focus);
	text-decoration: none;
	vertical-align: -3px;
}
.settings-menu__help svg {
	width: 100%;
	height: 100%;
	fill: none;
	stroke: currentColor;
	stroke-linecap: round;
	stroke-linejoin: round;
	stroke-width: 2;
}
.settings-menu__danger {
	flex: none;
	padding: 8px 11px;
	border: 1px solid var(--danger);
	background: var(--danger-soft);
	color: var(--danger-ink);
	font-weight: 750;
}
.settings-menu__danger:hover:not(:disabled) {
	background: var(--danger);
	color: var(--on-danger);
}
.settings-menu__switch {
	position: relative;
	display: block;
	flex: none;
	width: 42px;
	height: 24px;
	cursor: pointer;
}
.settings-menu__switch input {
	position: absolute;
	opacity: 0;
}
.settings-menu__switch-track {
	position: absolute;
	inset: 0;
	border: 1px solid var(--revealed-line);
	border-radius: 20px;
	background: var(--covered);
	transition: background 140ms ease, border-color 140ms ease;
}
.settings-menu__switch-track::after {
	position: absolute;
	top: 3px;
	left: 3px;
	width: 16px;
	height: 16px;
	border-radius: 50%;
	background: var(--paper);
	box-shadow: 0 1px 3px rgb(0 0 0 / 28%);
	content: '';
	transition: transform 160ms ease;
}
.settings-menu__switch input:checked + .settings-menu__switch-track {
	border-color: var(--success);
	background: var(--success);
}
.settings-menu__switch input:checked + .settings-menu__switch-track::after {
	transform: translateX(18px);
}
.settings-menu__switch input:focus-visible + .settings-menu__switch-track {
	outline: 2px solid var(--focus);
	outline-offset: 2px;
}
.settings-menu__switch:hover .settings-menu__switch-track {
	border-color: var(--ink);
	filter: brightness(.94);
}
.settings-menu__switch--disabled {
	cursor: default;
	opacity: .7;
}
.settings-menu__about {
	display: grid;
	gap: 4px;
	padding: 18px 4px 0;
	font: 12px/1.4 ui-sans-serif, system-ui, sans-serif;
}
.settings-menu__about p {
	margin: 0;
	color: var(--muted);
}
.settings-menu__about a {
	width: fit-content;
	color: var(--focus);
	font-weight: 650;
	text-underline-offset: 3px;
	transition: color 120ms ease, text-decoration-thickness 120ms ease;
}
.settings-menu__about a:hover {
	color: var(--ink);
	text-decoration-thickness: 2px;
}
@media (min-width: 600px) {
	.settings-menu__backdrop {
		align-items: center;
		padding: 24px;
	}
	.settings-menu__sheet {
		width: min(400px, 100%);
		max-height: calc(100dvh - 48px);
		padding: 24px;
		border-bottom: 1px solid var(--line);
		border-radius: 18px;
		box-shadow: 0 16px 50px rgb(0 0 0 / 26%);
	}
	.settings-slide-enter-active,
	.settings-slide-leave-active {
		transition: opacity 160ms ease, transform 180ms cubic-bezier(.2, .8, .2, 1);
	}
	.settings-slide-enter-from,
	.settings-slide-leave-to {
		opacity: 0;
		transform: translateY(10px) scale(.98);
	}
}
</style>
