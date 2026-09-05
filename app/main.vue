<link rel="component" href="pages/home.vue" dynamic>
<link rel="component" href="pages/tutorial.vue" dynamic>
<link rel="component" href="pages/daily.vue" dynamic>
<link rel="component" href="pages/study.vue" dynamic>
<link rel="component" href="pages/challenge.vue" dynamic>
<link rel="component" href="pages/puzzle.vue" dynamic>
<link rel="component" href="pages/editor.vue" dynamic>
<link rel="component" href="pages/test.vue" dynamic>
<link rel="component" href="pages/traditional.vue" dynamic>
<link rel="component" href="settings-menu.vue">
<link rel="component" href="storage.vue.js">
<link rel="component" href="theme.vue.css">

<script>
import { gameSounds } from './sounds.js';
import { feedbackEffects } from './feedback.js';

function applyAppColorScheme(colorScheme) {
	let dark = colorScheme === 'dark' || (colorScheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
	let resolved = dark ? 'dark' : 'light';
	document.documentElement.dataset.colorScheme = resolved;
	document.documentElement.style.colorScheme = resolved;
}

const APP_PAGES = Object.freeze({
	home: Object.freeze({ page: 'home', path: '/', title: '', component: 'home-page' }),
	tutorial: Object.freeze({ page: 'tutorial', path: '/tutorial', title: 'How to play', component: 'tutorial-page' }),
	daily: Object.freeze({ page: 'daily', path: '/daily', title: 'Daily', component: 'daily-page' }),
	study: Object.freeze({ page: 'study', path: '/study', title: 'Study', component: 'study-page' }),
	challenge: Object.freeze({ page: 'challenge', path: '/challenge', title: 'Challenge', component: 'challenge-page' }),
	puzzle: Object.freeze({ page: 'puzzle', path: '/puzzle', title: 'Shared puzzle', component: 'shared-puzzle-page' }),
	editor: Object.freeze({ page: 'editor', path: '/editor', title: 'Board Lab', component: 'editor-page' }),
	traditional: Object.freeze({ page: 'traditional', path: '/traditional', title: 'Traditional', component: 'traditional-page' }),
	test: Object.freeze({ page: 'test', path: '/test', title: 'Test minefield', component: 'test-page' }),
});

function appRouteForPage(page) {
	return APP_PAGES[page] ?? APP_PAGES.home;
}

function appRouteForHash(hash) {
	let value = hash.startsWith('#') ? hash.slice(1) : hash;
	let [path = '/', query = ''] = value.split('?');
	if (!path) {
		path = '/';
	}
	let match;
	if (path === '/') {
		return APP_PAGES.home;
	}
	if (path === '/tutorial') {
		return APP_PAGES.tutorial;
	}
	if ((match = path.match(/^\/daily(?:\/([^/]+))?$/))) {
		return { ...APP_PAGES.daily, difficultyKey: match[1] };
	}
	if ((match = path.match(/^\/study(?:\/([^/]+))?$/))) {
		return { ...APP_PAGES.study, difficultyKey: match[1] };
	}
	if ((match = path.match(/^\/puzzle\/(.+)$/))) {
		return { ...APP_PAGES.puzzle, payload: match[1] };
	}
	if ((match = path.match(/^\/challenge\/([^/]+)$/))) {
		let parameters = new URLSearchParams(query);
		let seedText = parameters.get('seed');
		let timeText = parameters.get('time');
		let seed;
		try {
			if (/^[0-9a-f]{1,16}$/i.test(seedText ?? '')) {
				seed = BigInt(`0x${seedText}`);
			}
		}
		catch {}
		let time = /^\d+$/.test(timeText ?? '') ? Number(timeText) : undefined;
		return { ...APP_PAGES.challenge, modeKey: match[1], seed, time: Number.isSafeInteger(time) ? time : undefined };
	}
	return Object.values(APP_PAGES).find(route => route.path === path) ?? APP_PAGES.home;
}

const app = Vue.createApp({
	data() {
		let storedScheme = MinesightStorage.get('colorScheme', 'system');
		let colorScheme = ['system', 'light', 'dark'].includes(storedScheme) ? storedScheme : 'system';
		let soundEnabled = MinesightStorage.get('soundEnabled', true) !== false;
		return {
			currentRoute: Vue.markRaw(appRouteForHash(window.location.hash)),
			settingsOpen: false,
			navigationLocked: false,
			acceptedHash: window.location.hash,
			colorScheme,
			soundEnabled,
		};
	},
	computed: {
		pageTitle() {
			return this.currentRoute.title;
		},
		pageKey() {
			if (this.currentRoute.page === 'puzzle') {
				return `puzzle:${this.currentRoute.payload}`;
			}
			if (this.currentRoute.page === 'challenge') {
				return `challenge:${this.currentRoute.modeKey}:${this.currentRoute.seed ?? ''}:${this.currentRoute.time ?? ''}`;
			}
			return this.currentRoute.page;
		},
	},
	methods: {
		openPage(page, options = {}) {
			if (this.navigationLocked) {
				return;
			}
			let route = appRouteForPage(page);
			let path = route.path;
			if ((page === 'study' || page === 'daily') && options.difficultyKey) {
				path += `/${options.difficultyKey}`;
			}
			window.location.hash = path;
		},
		applyRoute() {
			if (this.navigationLocked && window.location.hash !== this.acceptedHash) {
				history.replaceState(null, '', `${window.location.pathname}${window.location.search}${this.acceptedHash}`);
				return;
			}
			this.acceptedHash = window.location.hash;
			feedbackEffects.clear();
			this.currentRoute = Vue.markRaw(appRouteForHash(window.location.hash));
			this.navigationLocked = false;
			document.title = this.pageTitle ? `Minesight / ${this.pageTitle}` : 'Minesight';
		},
		openSettings() {
			this.settingsOpen = true;
		},
		closeSettings() {
			if (!this.settingsOpen) {
				return;
			}
			this.settingsOpen = false;
			this.$nextTick(() => this.$refs.settingsButton?.focus());
		},
		setColorScheme(colorScheme) {
			this.colorScheme = colorScheme;
			applyAppColorScheme(colorScheme);
			MinesightStorage.set('colorScheme', colorScheme);
		},
		setSoundEnabled(enabled) {
			this.soundEnabled = enabled;
			if (!enabled) {
				gameSounds.play('toggle');
			}
			gameSounds.setEnabled(enabled);
			MinesightStorage.set('soundEnabled', enabled);
			if (enabled) {
				gameSounds.play('toggle');
			}
		},
	},
	mounted() {
		applyAppColorScheme(this.colorScheme);
		gameSounds.setEnabled(this.soundEnabled);
		this.colorSchemeListener = () => {
			if (this.colorScheme === 'system') {
				applyAppColorScheme('system');
			}
		};
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', this.colorSchemeListener);
		this.applyRoute();
		window.addEventListener('popstate', this.applyRoute);
		window.addEventListener('hashchange', this.applyRoute);
		if ('serviceWorker' in navigator && !['', 'localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
			window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}), { once: true });
		}
	},
	beforeUnmount() {
		window.removeEventListener('popstate', this.applyRoute);
		window.removeEventListener('hashchange', this.applyRoute);
		window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', this.colorSchemeListener);
	},
});

app.component('settings-menu', SettingsMenu);
app.component('home-page', HomePage);
app.component('tutorial-page', TutorialPage);
app.component('daily-page', DailyPage);
app.component('study-page', StudyPage);
app.component('challenge-page', ChallengePage);
app.component('shared-puzzle-page', SharedPuzzlePage);
app.component('editor-page', EditorPage);
app.component('traditional-page', TraditionalPage);
app.component('test-page', TestPage);
app.mount('#app');
</script>

<div id="app" class="app-root">
	<header class="site-header" :inert="settingsOpen">
		<div class="site-header__title">
			<a class="site-header__permalink" :href="acceptedHash || '#/'" aria-label="Permalink to this page" title="Permalink to this page">
				<img src="./header-icon.svg" alt="">
			</a>
			<span class="site-header__brand">Minesight</span>
			<span v-if="pageTitle" class="site-header__mode"><span aria-hidden="true">/</span> {{ pageTitle }}</span>
			<button
				v-if="currentRoute.path !== '/' && !navigationLocked"
				type="button"
				class="control-feedback site-header__back"
				aria-label="Back to main menu"
				title="Back to main menu"
				@click="openPage('home')"
			>↩</button>
		</div>
		<button
			ref="settingsButton"
			type="button"
			class="control-feedback site-header__settings"
			aria-label="Open settings"
			title="Settings"
			aria-controls="settings-dialog"
			:aria-expanded="settingsOpen"
			@click="openSettings"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h4m4 0h10M3 12h10m4 0h4M3 19h6m4 0h8M9 2v6M15 9v6M11 16v6"></path></svg>
		</button>
	</header>

	<div class="app-shell" :inert="settingsOpen">
		<component
			:is="currentRoute.component"
			:key="pageKey"
			:route="currentRoute"
			@open-page="openPage"
			@navigation-lock="navigationLocked = $event"
		></component>
	</div>

	<settings-menu
		:open="settingsOpen"
		:color-scheme="colorScheme"
		:sound-enabled="soundEnabled"
		@close="closeSettings"
		@color-scheme-change="setColorScheme"
		@sound-change="setSoundEnabled"
	></settings-menu>
</div>

<style>
* {
	box-sizing: border-box;
}

body {
	margin: 0;
	min-width: 320px;
	min-height: 100vh;
	background: var(--background);
	color: var(--ink);
}

button,
input,
select,
textarea {
	font: inherit;
}

.app-root,
.app-shell {
	display: flex;
	min-height: 100vh;
	flex-direction: column;
}

.app-shell {
	flex: 1;
	min-height: 0;
}

.site-header {
	display: flex;
	flex-wrap: nowrap;
	width: min(26.25rem, calc(100% - 1.25rem));
	align-items: center;
	justify-content: space-between;
	gap: 0.625rem;
	margin: 0 auto 0.5rem;
	padding: 0.9375rem 0 0.5625rem;
	border-bottom: 2px solid var(--ink);
}

.site-header__title {
	display: flex;
	min-width: 0;
	align-items: center;
	font-family: ui-sans-serif, system-ui, sans-serif;
	white-space: nowrap;
}

.site-header__permalink {
	display: block;
	flex: none;
	width: 1.75rem;
	height: 1.75rem;
	margin-right: 0.4375rem;
	border-radius: 0.3125rem;
	color: inherit;
	text-decoration: none;
}

.site-header__permalink img {
	display: block;
	width: 100%;
	height: 100%;
}

.site-header__brand {
	flex: none;
	color: inherit;
	font-size: 1.4375rem;
	font-weight: 800;
	letter-spacing: -0.04em;
	line-height: 1;
}

.site-header__permalink:focus-visible,
.site-header__back:focus-visible,
.site-header__settings:focus-visible {
	outline: 2px solid var(--focus);
	outline-offset: 2px;
}

.site-header__mode {
	display: inline-flex;
	min-width: 0;
	gap: 0.35rem;
	margin-left: 0.4375rem;
	color: var(--muted);
	font-size: 1.4375rem;
	font-weight: 700;
	letter-spacing: -0.04em;
	line-height: 1;
	white-space: nowrap;
}

.site-header__back {
	display: grid;
	width: 1.5rem;
	height: 1.5rem;
	flex: none;
	place-items: center;
	margin-left: 0.3125rem;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--muted);
	font-size: 1.125rem;
	line-height: 1;
	cursor: pointer;
}

.site-header__back:hover {
	color: var(--ink);
}

.site-header__settings {
	display: grid;
	place-items: center;
	width: 2rem;
	height: 2rem;
	flex: none;
	padding: 0.3125rem;
	border: 0;
	background: transparent;
	color: var(--muted);
	cursor: pointer;
}
.site-header__settings:hover {
	color: var(--ink);
}
.site-header__settings svg {
	width: 1.5rem;
	height: 1.5rem;
	fill: none;
	stroke: currentColor;
	stroke-linecap: round;
	stroke-linejoin: round;
	stroke-width: 2;
}

@media (max-width: 360px) {
	.site-header__permalink {
		width: 1.5rem;
		height: 1.5rem;
		margin-right: 0.3125rem;
	}

	.site-header__brand,
	.site-header__mode {
		font-size: 1.125rem;
	}

	.site-header__mode {
		margin-left: 0.3125rem;
	}
}
</style>
