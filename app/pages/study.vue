<link rel="component" href="../play-page.vue.css">
<link rel="component" href="../components/hold-button.vue">
<link rel="component" href="../puzzle-view.vue">
<link rel="component" href="../puzzle.vue.js">
<link rel="component" href="../storage.vue.js">

<script>
const StudyPage = Vue.defineComponent({
	template: '#study-page',
	components: { PuzzleView, HoldButton },
	props: { route: { type: Object, required: true } },
	data() {
		let stored = MinesightStorage.get('study', {}) ?? {};
		let selected = puzzleDifficulty(this.route.difficultyKey ?? stored.difficultyKey).key;
		let streaks = Object.fromEntries(PUZZLE_DIFFICULTIES.map(({ key }) => [key, Math.max(0, Number(stored.difficulties?.[key]?.streak) || 0)]));
		return {
			difficulties: PUZZLE_DIFFICULTIES,
			puzzle: new PuzzleController(),
			difficultyKey: selected,
			streaks,
			storedBoards: stored.difficulties ?? {},
			preparing: false,
			error: '',
			shareMessage: '',
			generationId: 0,
			boardDifficultyKey: /** @type {string | undefined} */ (undefined),
			boardSeed: 0n,
		};
	},
	computed: {
		difficulty() { return puzzleDifficulty(this.difficultyKey); },
		streak() { return this.streaks[this.difficultyKey]; },
		statusTitle() {
			if (this.error) return 'Puzzle unavailable';
			return this.puzzle.result === 'cleared' ? 'Puzzle solved' : 'What can you prove?';
		},
		statusMessage() {
			if (this.error) return this.error;
			return this.puzzle.result === 'cleared' ? 'Good solve. Keep the streak going.' : 'Mark every covered square that must be safe or mined.';
		},
	},
	watch: {
		'route.difficultyKey'(key) {
			if (key && key !== this.difficultyKey) this.selectDifficulty(key, false);
		},
	},
	methods: {
		bindPuzzle() {
			this.puzzle.onChange = () => this.save();
			this.puzzle.onRejected = () => {
				if (this.streak > 0) feedbackEffects.streakLost(this.streak);
				this.streaks[this.difficultyKey] = 0;
				this.save();
			};
			this.puzzle.onSolved = () => {
				this.streaks[this.difficultyKey] += 1;
				this.save();
			};
		},
		boardSnapshot() {
			return this.puzzle.ready ? this.puzzle.snapshot({ seed: String(this.boardSeed ?? 0n) }) : undefined;
		},
		save() {
			if (this.boardDifficultyKey === this.difficultyKey && this.puzzle.ready) this.storedBoards[this.difficultyKey] = { ...this.boardSnapshot(), streak: this.streak };
			let difficulties = Object.fromEntries(PUZZLE_DIFFICULTIES.map(({ key }) => [key, {
				...(this.storedBoards[key] ?? {}), streak: this.streaks[key],
			}]));
			MinesightStorage.set('study', { difficultyKey: this.difficultyKey, difficulties });
		},
		restore() {
			let saved = this.storedBoards[this.difficultyKey];
			let restored = restorePuzzleController(saved, { hints: true });
			if (!restored) return false;
			this.puzzle.destroy();
			this.puzzle = restored;
			this.boardDifficultyKey = this.difficultyKey;
			this.preparing = false;
			this.error = '';
			this.shareMessage = '';
			this.$refs.puzzleView?.resetScratch();
			try { this.boardSeed = BigInt(saved.seed); } catch { this.boardSeed = 0n; }
			this.bindPuzzle();
			return true;
		},
		async newPuzzle() {
			let id = ++this.generationId;
			this.preparing = true;
			this.puzzle.busy = true;
			this.error = '';
			this.shareMessage = '';
			try {
				let generated = await generatePuzzleField(this.difficulty, { cancelled: () => id !== this.generationId });
				if (!generated || id !== this.generationId) return;
				this.puzzle.setField(generated.field);
				this.boardDifficultyKey = this.difficultyKey;
				this.boardSeed = generated.seed;
				this.$refs.puzzleView?.resetScratch();
				this.save();
			}
			catch (error) { if (id === this.generationId) this.error = error instanceof Error ? error.message : String(error); }
			finally { if (id === this.generationId) { this.preparing = false; this.puzzle.busy = Boolean(this.error); } }
		},
		selectDifficulty(key, navigate = true) {
			if (!PUZZLE_DIFFICULTIES.some((difficulty) => difficulty.key === key) || key === this.difficultyKey) return;
			this.save();
			this.generationId += 1;
			this.difficultyKey = key;
			this.boardDifficultyKey = undefined;
			this.puzzle.setField();
			if (navigate) window.location.hash = `/study/${key}`;
			if (!this.restore()) void this.newPuzzle();
		},
		async share() {
			this.shareMessage = '';
			if (this.preparing || !this.puzzle.ready) return;
			try { this.shareMessage = await sharePuzzleLink(this.puzzle.field); }
			catch { this.shareMessage = 'The share link could not be copied.'; }
		},
	},
	mounted() {
		this.bindPuzzle();
		if (!this.restore()) void this.newPuzzle();
	},
	beforeUnmount() {
		this.generationId += 1;
		this.save();
		this.puzzle.destroy();
	},
});
</script>

<template id="study-page">
	<main class="play-page" aria-label="Study">
		<section class="study-page__picker">
			<div class="study-page__toolbar">
				<label class="study-page__sr-only" for="study-difficulty">Difficulty</label>
				<select id="study-difficulty" :value="difficultyKey" @change="selectDifficulty($event.target.value)">
					<option v-for="option in difficulties" :key="option.key" :value="option.key">{{ option.label }}</option>
				</select>
				<div class="study-page__streak" role="status" :aria-label="`${difficulty.label} streak: ${streak}`"><span>Streak</span><strong>{{ streak }}</strong></div>
			</div>
			<p class="study-page__description">{{ difficulty.description }}</p>
		</section>
		<puzzle-view ref="puzzleView" :puzzle="puzzle" :loading="preparing" :status-title="statusTitle" :status-message="statusMessage" :share-available="true" :share-message="shareMessage" @share="share">
			<button class="control-feedback" type="button" :disabled="preparing || puzzle.disabled" :aria-pressed="puzzle.hintsVisible" @click="puzzle.toggleHints()">Hint</button>
			<hold-button v-if="puzzle.result === 'playing' && !error" :key="difficultyKey" label="Skip" :disabled="preparing" @confirm="newPuzzle"></hold-button>
			<button v-else type="button" class="control-feedback primary" :disabled="preparing" @click="newPuzzle">{{ preparing ? 'Building…' : error ? 'Try again' : 'Next' }}</button>
		</puzzle-view>
	</main>
</template>

<style>
.study-page__picker { margin-bottom: -.125rem; }
.study-page__toolbar { display: grid; grid-template-columns: minmax(0, 1fr) 6.5rem; gap: .5rem; }
.study-page__toolbar select { width: 100%; height: 2.75rem; padding: 0 .625rem; border: 1px solid var(--line); border-radius: 0; background: var(--paper); color: var(--ink); }
.study-page__description { min-height: 2.8em; margin: .4375rem .0625rem 0; color: var(--muted); font: .6875rem/1.4 ui-sans-serif, system-ui, sans-serif; }
.study-page__streak { display: grid; align-content: center; justify-items: center; gap: .125rem; height: 2.75rem; padding: .3125rem .625rem; border: 1px solid var(--line); background: var(--paper); font-family: ui-sans-serif, system-ui, sans-serif; }
.study-page__streak span { color: var(--muted); font-size: .5625rem; font-weight: 700; letter-spacing: .08em; line-height: 1; text-transform: uppercase; }
.study-page__streak strong { width: 6ch; font-size: 1.125rem; font-variant-numeric: tabular-nums; line-height: 1; text-align: center; }
.study-page__sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
</style>
