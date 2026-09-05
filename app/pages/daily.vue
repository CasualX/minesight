<link rel="component" href="../play-page.vue.css">
<link rel="component" href="../components/hold-button.vue">
<link rel="component" href="../puzzle-view.vue">
<link rel="component" href="../puzzle.vue.js">
<link rel="component" href="../storage.vue.js">

<script>
const DailyPage = Vue.defineComponent({
	template: '#daily-page',
	components: { PuzzleView, HoldButton },
	props: { route: { type: Object, required: true } },
	data() {
		let date = puzzleLocalDate();
		let stored = MinesightStorage.get('daily', {}) ?? {};
		if (stored.date !== date) stored = {};
		let difficultyKey = puzzleDifficulty(this.route.difficultyKey ?? stored.difficultyKey, PUZZLE_DAILY_DIFFICULTIES).key;
		return {
			difficulties: PUZZLE_DAILY_DIFFICULTIES,
			date,
			difficultyKey,
			states: stored.states ?? {},
			puzzle: new PuzzleController(undefined, { validation: 'deferred', hints: false }),
			preparing: false,
			error: '',
			checkMessage: '',
			shareMessage: '',
			generationId: 0,
			boardDifficultyKey: /** @type {string | undefined} */ (undefined),
			dateTimer: /** @type {number | undefined} */ (undefined),
		};
	},
	computed: {
		difficulty() { return puzzleDifficulty(this.difficultyKey, PUZZLE_DAILY_DIFFICULTIES); },
		solvedCount() { return PUZZLE_DAILY_DIFFICULTIES.filter(({ key }) => this.states[key]?.completed).length; },
		allSolved() { return this.solvedCount === PUZZLE_DAILY_DIFFICULTIES.length; },
		statusTitle() {
			if (this.error) return 'Puzzle unavailable';
			if (this.puzzle.result === 'cleared') return 'Daily solved';
			return this.checkMessage ? 'Solution checked' : 'What can you prove?';
		},
		statusMessage() {
			if (this.error) return this.error;
			if (this.puzzle.result === 'cleared') return this.allSolved ? 'Today’s set is complete. Come back tomorrow.' : `${this.solvedCount} of ${PUZZLE_DAILY_DIFFICULTIES.length} complete today.`;
			return this.checkMessage || 'Mark the squares, then check your solution when you are ready.';
		},
	},
	watch: {
		'route.difficultyKey'(key) { if (key && key !== this.difficultyKey) this.openDifficulty(key, false); },
	},
	methods: {
		refreshDate() {
			let date = puzzleLocalDate();
			if (date === this.date) return;
			this.generationId += 1;
			this.date = date;
			this.states = {};
			this.boardDifficultyKey = undefined;
			this.checkMessage = '';
			this.shareMessage = '';
			this.puzzle.setField();
			void this.prepare();
		},
		bindPuzzle() {
			this.puzzle.onChange = () => { this.checkMessage = ''; this.save(); };
			this.puzzle.onSolved = () => {
				this.states[this.difficultyKey] = { ...this.puzzle.snapshot(), completed: true };
				this.save();
				if (this.allSolved) { feedbackEffects.success({ grand: true }); feedbackEffects.fireworks(); }
			};
		},
		snapshotCurrent() {
			if (this.boardDifficultyKey !== this.difficultyKey || !this.puzzle.ready) return;
			let completed = Boolean(this.states[this.difficultyKey]?.completed || this.puzzle.result === 'cleared');
			this.states[this.difficultyKey] = { ...this.puzzle.snapshot(), completed };
		},
		save() {
			this.snapshotCurrent();
			MinesightStorage.set('daily', { date: this.date, difficultyKey: this.difficultyKey, states: this.states });
		},
		restore() {
			let restored = restorePuzzleController(this.states[this.difficultyKey], { validation: 'deferred', hints: false });
			if (!restored) return false;
			this.puzzle.destroy();
			this.puzzle = restored;
			this.boardDifficultyKey = this.difficultyKey;
			this.preparing = false;
			this.error = '';
			this.shareMessage = '';
			this.$refs.puzzleView?.resetScratch();
			this.bindPuzzle();
			return true;
		},
		async prepare() {
			let id = ++this.generationId;
			this.preparing = true;
			this.puzzle.busy = true;
			this.error = '';
			try {
				let generated = await generatePuzzleField(this.difficulty, {
					seed: puzzleDailySeed(this.date),
					cancelled: () => id !== this.generationId,
				});
				if (!generated || id !== this.generationId) return;
				this.puzzle.setField(generated.field);
				this.boardDifficultyKey = this.difficultyKey;
				this.$refs.puzzleView?.resetScratch();
				this.save();
			}
			catch (error) { if (id === this.generationId) this.error = error instanceof Error ? error.message : String(error); }
			finally { if (id === this.generationId) { this.preparing = false; this.puzzle.busy = Boolean(this.error); } }
		},
		openDifficulty(key, navigate = true) {
			if (!PUZZLE_DAILY_DIFFICULTIES.some((difficulty) => difficulty.key === key) || key === this.difficultyKey) return;
			this.save();
			this.generationId += 1;
			this.checkMessage = '';
			this.difficultyKey = key;
			this.boardDifficultyKey = undefined;
			this.puzzle.setField();
			if (navigate) window.location.hash = `/daily/${key}`;
			if (!this.restore()) void this.prepare();
		},
		check() {
			let checked = this.puzzle.check();
			if (checked.result === 'contradiction') {
				this.checkMessage = 'There are too many marked mines around a visible clue.';
				gameSounds.play('incorrect');
				for (let index of checked.indices) feedbackEffects.failure({ cellIndex: index, terminal: false });
			}
			else if (checked.result === 'incomplete') this.checkMessage = 'Not complete yet. Keep going.';
			this.save();
		},
		clear() { this.checkMessage = ''; this.puzzle.clearMarks(); },
		async share() {
			this.shareMessage = '';
			if (this.preparing || !this.puzzle.ready) return;
			let url = new URL(window.location.href);
			url.hash = `/daily/${this.difficultyKey}`;
			let data = { title: 'Minesight Daily', text: `Play today’s ${this.difficulty.label} Minesight puzzle.`, url: url.href };
			try {
				if (navigator.share) {
					try {
						await navigator.share(data);
						this.shareMessage = 'Daily puzzle shared';
						return;
					}
					catch (error) {
						if (error instanceof Error && error.name === 'AbortError') {
							return;
						}
					}
				}
				await navigator.clipboard.writeText(url.href);
				this.shareMessage = 'Daily puzzle link copied';
			}
			catch {
				this.shareMessage = 'The daily link could not be copied.';
			}
		},
	},
	mounted() {
		window.addEventListener('focus', this.refreshDate);
		this.dateTimer = setInterval(this.refreshDate, 30_000);
		this.bindPuzzle();
		if (!this.restore()) {
			void this.prepare();
		}
	},
	beforeUnmount() {
		window.removeEventListener('focus', this.refreshDate);
		clearInterval(this.dateTimer);
		this.generationId += 1;
		this.save();
		this.puzzle.destroy();
	},
});
</script>

<template id="daily-page">
	<main class="play-page" aria-labelledby="daily-title">
		<section class="daily-page__picker" aria-label="Daily puzzles">
			<header class="daily-page__heading">
				<div><span id="daily-title">Today’s set</span><time :datetime="date">{{ date }}</time></div>
				<strong>{{ solvedCount }} / {{ difficulties.length }} complete</strong>
			</header>
			<div class="daily-page__tabs" role="group" aria-label="Daily difficulties">
				<button class="control-feedback"
					v-for="option in difficulties" :key="option.key" type="button"
					:class="{ active: option.key === difficultyKey, solved: states[option.key]?.completed }"
					:aria-pressed="option.key === difficultyKey"
					:aria-label="`${option.label}, ${states[option.key]?.completed ? 'solved' : 'not solved'}`"
					@click="openDifficulty(option.key)"
				>
					<span>{{ option.label }}</span>
					<b aria-hidden="true">{{ states[option.key]?.completed ? '✓' : '·' }}</b>
				</button>
			</div>
			<p class="daily-page__description">{{ difficulty.description }}</p>
		</section>
		<puzzle-view ref="puzzleView" :puzzle="puzzle" :loading="preparing" :status-title="statusTitle" :status-message="statusMessage" :share-available="true" share-label="Share today’s daily puzzle" :share-message="shareMessage" @share="share">
			<button v-if="error" type="button" class="control-feedback primary" @click="prepare">Try again</button>
			<hold-button label="Clear marks" :disabled="preparing || puzzle.disabled" @confirm="clear"></hold-button>
			<button type="button" class="control-feedback primary" :disabled="preparing || puzzle.disabled" @click="check">Check solution</button>
		</puzzle-view>
	</main>
</template>

<style>
.daily-page__picker { font-family: ui-sans-serif, system-ui, sans-serif; }
.daily-page__heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: .5rem; }
.daily-page__heading div { display: grid; gap: .1875rem; }
.daily-page__heading span { color: var(--muted); font-size: .625rem; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; }
.daily-page__heading time { color: var(--muted); font-size: .625rem; font-variant-numeric: tabular-nums; }
.daily-page__heading strong { font-size: .875rem; font-weight: 700; }
.daily-page__tabs { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
.daily-page__tabs button { display: grid; justify-items: center; align-content: center; gap: .1875rem; min-width: 0; min-height: 2.75rem; padding: .5rem .1875rem .375rem; border: 0; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); border-radius: 0; background: var(--paper); color: var(--muted); cursor: pointer; }
.daily-page__tabs button:hover { background: color-mix(in srgb, var(--paper) 82%, var(--covered)); }
.daily-page__tabs button:focus-visible { position: relative; outline: 2px solid var(--focus); outline-offset: -2px; }
.daily-page__tabs button.active { box-shadow: inset 0 -2px var(--ink); color: var(--ink); }
.daily-page__tabs button.solved b { color: var(--success); }
.daily-page__tabs span { font: 700 .625rem/1.2 ui-sans-serif, system-ui, sans-serif; }
.daily-page__tabs b { font-size: .8125rem; line-height: 1; }
.daily-page__description { min-height: 2.8em; margin: .4375rem .0625rem 0; color: var(--muted); font: .6875rem/1.4 ui-sans-serif, system-ui, sans-serif; }
</style>
