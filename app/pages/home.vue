<link rel="component" href="../storage.vue.js">

<script>
const HomePage = Vue.defineComponent({
	template: '#home-page',
	emits: ['open-page'],
	data() {
		let daily = MinesightStorage.get('daily', {}) ?? {};
		let now = new Date();
		let today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
		let solved = daily.date === today
			? Object.values(daily.states ?? {}).filter((state) => state?.completed).length : 0;
		return { dailyProgress: `${solved}/5 complete today` };
	},
});
</script>

<template id="home-page">
	<main class="home-page" aria-labelledby="home-page-title">
		<div class="home-page__intro">
			<h1 id="home-page-title">Minesweeper logic puzzles</h1>
			<p>Study each position and find the squares that must be safe or mined.</p>
		</div>

		<div class="home-page__options" aria-label="Choose a mode">
			<button type="button" class="control-feedback home-page__option" @click="$emit('open-page', 'tutorial')">
				<span class="home-page__option-number" aria-hidden="true">?</span>
				<span class="home-page__option-copy"><strong>How to play</strong><small>Learn how Minesight differs from regular Minesweeper.</small></span>
				<span class="home-page__option-arrow" aria-hidden="true">→</span>
			</button>
			<button type="button" class="control-feedback home-page__option" @click="$emit('open-page', 'daily')">
				<span class="home-page__option-number" aria-hidden="true">01</span>
				<span class="home-page__option-copy"><strong>Daily</strong><small>One puzzle at every difficulty. A fresh set returns every day.</small><em>{{ dailyProgress }}</em></span>
				<span class="home-page__option-arrow" aria-hidden="true">→</span>
			</button>
			<button type="button" class="control-feedback home-page__option" @click="$emit('open-page', 'study')">
				<span class="home-page__option-number" aria-hidden="true">02</span>
				<span class="home-page__option-copy"><strong>Study</strong><small>Practice one puzzle at a time, use hints, and build a streak.</small></span>
				<span class="home-page__option-arrow" aria-hidden="true">→</span>
			</button>
			<button type="button" class="control-feedback home-page__option" @click="$emit('open-page', 'challenge')">
				<span class="home-page__option-number" aria-hidden="true">03</span>
				<span class="home-page__option-copy"><strong>Challenge</strong><small>Race through a fixed set, then invite someone to beat your time.</small></span>
				<span class="home-page__option-arrow" aria-hidden="true">→</span>
			</button>
			<button type="button" class="control-feedback home-page__option" @click="$emit('open-page', 'traditional')">
				<span class="home-page__option-number" aria-hidden="true">04</span>
				<span class="home-page__option-copy">
					<strong>Traditional</strong>
					<small>Play a game of no-guess Minesweeper.</small>
				</span>
				<span class="home-page__option-arrow" aria-hidden="true">→</span>
			</button>
			<button type="button" class="control-feedback home-page__option" @click="$emit('open-page', 'editor')">
				<span class="home-page__option-number" aria-hidden="true">05</span>
				<span class="home-page__option-copy">
					<strong>Board Lab</strong>
					<small>Create a position, test its clues, and find every forced cell.</small>
				</span>
				<span class="home-page__option-arrow" aria-hidden="true">→</span>
			</button>
		</div>
	</main>
</template>

<style>
.home-page {
	width: min(26.25rem, calc(100% - 1.25rem));
	flex: 1;
	margin: 0 auto;
	padding: 0.625rem 0 calc(1.75rem + env(safe-area-inset-bottom));
}

.home-page__intro {
	max-width: 23.125rem;
	margin-bottom: 1.75rem;
}

.home-page__intro h1 {
	margin: 0;
	font-family: Georgia, "Times New Roman", serif;
	font-size: clamp(1.4375rem, 7vw, 1.75rem);
	letter-spacing: -0.035em;
	line-height: 0.98;
	white-space: nowrap;
}

.home-page__intro p {
	margin: 0.8125rem 0 0;
	color: var(--muted);
	font: 0.875rem/1.45 ui-sans-serif, system-ui, sans-serif;
}

.home-page__options {
	display: grid;
	border-top: 1px solid var(--ink);
}

.home-page__option {
	--home-title-line-height: 1.44375rem;
	display: grid;
	grid-template-columns: 1.75rem minmax(0, 1fr) 1.5rem;
	align-items: start;
	gap: 0.625rem;
	min-height: 5.75rem;
	padding: 0.9375rem 0.375rem 0.9375rem 0.125rem;
	border: 0;
	border-bottom: 1px solid var(--line);
	background: transparent;
	color: inherit;
	font-family: ui-sans-serif, system-ui, sans-serif;
	text-align: left;
	cursor: pointer;
}

.home-page__option:hover {
	background: color-mix(in srgb, var(--covered) 38%, transparent);
}

.home-page__option:focus-visible {
	outline: 2px solid var(--focus);
	outline-offset: 2px;
}

.home-page__option-number {
	width: 1.75rem;
	color: var(--muted);
	font: 0.625rem/var(--home-title-line-height) ui-monospace, SFMono-Regular, Menlo, monospace;
	font-variant-numeric: tabular-nums;
	text-align: center;
}

.home-page__option-copy strong,
.home-page__option-copy small {
	display: block;
}

.home-page__option-copy em {
	display: inline-block;
	margin-top: .4375rem;
	padding: .1875rem .375rem;
	background: var(--ink);
	color: var(--paper);
	font: normal 700 .5625rem/1.2 ui-sans-serif, system-ui, sans-serif;
	letter-spacing: .06em;
	text-transform: uppercase;
}

.home-page__option-copy strong {
	font: 700 1.3125rem/var(--home-title-line-height) Georgia, "Times New Roman", serif;
}

.home-page__option-copy small {
	margin-top: 0.3125rem;
	color: var(--muted);
	font-size: 0.6875rem;
	line-height: 1.4;
}

.home-page__option-arrow {
	align-self: center;
	font-size: 1.3125rem;
	transition: transform 120ms ease;
}

.home-page__option:hover .home-page__option-arrow {
	transform: translateX(0.1875rem);
}

</style>
