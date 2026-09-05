<link rel="component" href="../play-page.vue.css">
<link rel="component" href="../components/hold-button.vue">
<link rel="component" href="../puzzle-view.vue">
<link rel="component" href="../puzzle.vue.js">
<link rel="component" href="../storage.vue.js">

<script>
/** @type {readonly Readonly<{ key: string, label: string, route: readonly (readonly [string, number])[] }>[]} */
const CHALLENGE_ROUTES = Object.freeze([
	Object.freeze({ key: 'hard', label: 'Hard Challenge', route: Object.freeze([
		/** @type {[string, number]} */ (['easy', 4]),
		/** @type {[string, number]} */ (['medium', 4]),
		/** @type {[string, number]} */ (['hard', 4]),
	]) }),
	Object.freeze({ key: 'expert', label: 'Expert Challenge', route: Object.freeze([
		/** @type {[string, number]} */ (['easy', 3]),
		/** @type {[string, number]} */ (['medium', 3]),
		/** @type {[string, number]} */ (['hard', 3]),
		/** @type {[string, number]} */ (['expert', 3]),
	]) }),
]);

function challengeMode(key) {
	return CHALLENGE_ROUTES.find((mode) => mode.key === key) ?? CHALLENGE_ROUTES[0];
}
function challengeTime(milliseconds) {
	let hundredths = Math.floor(milliseconds / 10);
	let minutes = Math.floor(hundredths / 6000);
	let seconds = Math.floor(hundredths / 100) % 60;
	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths % 100).padStart(2, '0')}`;
}

const ChallengePage = Vue.defineComponent({
	template: '#challenge-page',
	components: { PuzzleView, HoldButton },
	props: {
		route: { type: Object, required: true },
	},
	emits: ['navigation-lock'],
	data() {
		let storedMode = MinesightStorage.get('challengeModeKey', 'hard');
		let modeKey = challengeMode(this.route.modeKey ?? storedMode).key;
		return {
			modes: CHALLENGE_ROUTES,
			modeKey,
			seed: typeof this.route.seed === 'bigint' ? this.route.seed : puzzleRandomSeed(),
			targetMs: typeof this.route.time === 'number' ? this.route.time : undefined,
			received: this.route.seed !== undefined,
			phase: 'intro',
			puzzles: /** @type {PuzzleField[]} */ ([]),
			index: 0,
			results: /** @type {string[]} */ ([]),
			elapsedMs: 0,
			startedAt: 0,
			timerId: /** @type {number | undefined} */ (undefined),
			puzzle: new PuzzleController(),
			error: '',
			preparationId: 0,
			gaveUp: false,
			shareMessage: '',
		};
	},
	computed: {
		mode() {
			return challengeMode(this.modeKey);
		},
		plan() {
			return this.mode.route.flatMap(([key, count]) => Array.from({ length: count }, () => puzzleDifficulty(key)));
		},
		total() {
			return this.plan.length;
		},
		progressGroups() {
			let start = 0;
			return this.mode.route.map(([key, count]) => {
				let label = puzzleDifficulty(key).label;
				let steps = Array.from({ length: count }, (_, offset) => start + offset);
				let group = { key, label, steps };
				start += count;
				return group;
			});
		},
		ready() {
			return this.phase === 'intro' && !this.error && this.puzzles.length === this.total;
		},
		startLabel() {
			if (this.phase === 'preparing') {
				return `Building puzzles ${this.puzzles.length} / ${this.total}…`;
			}
			if (this.ready) {
				return 'Start challenge';
			}
			return 'Try again';
		},
		currentDifficulty() {
			return this.plan[this.index] ?? this.plan[this.plan.length - 1];
		},
		timerText() {
			return challengeTime(this.elapsedMs);
		},
		failedCount() {
			return this.results.filter((result) => result === 'failed').length;
		},
		cleanCount() {
			return this.results.filter((result) => result === 'cleared').length;
		},
		finishTitle() {
			if (this.gaveUp) {
				return 'Run ended';
			}
			if (this.failedCount === 0) {
				return 'Perfect run';
			}
			return 'Run complete';
		},
		completeMessage() {
			if (this.gaveUp) {
				return `You gave up on puzzle ${this.index + 1} of ${this.total}.`;
			}
			if (this.failedCount === 0) {
				return `You cleared all ${this.total} challenges.`;
			}
			return `${this.cleanCount} completed · ${this.failedCount} failed`;
		},
		timeDifference() {
			if (this.gaveUp || this.targetMs === undefined) {
				return undefined;
			}
			return Math.floor(this.elapsedMs / 10) * 10 - this.targetMs;
		},
		timeBeaten() {
			return this.timeDifference !== undefined && this.timeDifference < 0;
		},
		timeResultMessage() {
			let difference = this.timeDifference;
			if (difference === undefined) return '';
			if (difference === 0) return 'A perfect tie!';
			let targetMs = this.targetMs;
			if (targetMs === undefined) return '';
			let ratio = Math.abs(difference) / targetMs;
			if (difference < 0) {
				if (ratio >= .15) return 'Left them in the dust!';
				if (ratio >= .05) return 'A commanding win!';
				return 'You beat their time!';
			}
			if (ratio <= .01) return 'So close!';
			if (ratio <= .05) return 'Right on their heels!';
			if (ratio <= .15) return 'A spirited chase.';
			return 'Better luck next time!';
		},
		statusTitle() {
			if (this.gaveUp) return 'Run ended';
			return this.puzzle.result === 'cleared' ? (this.results[this.index] === 'failed' ? 'Puzzle complete' : 'Clean solve') : this.results[this.index] === 'failed' ? 'Keep solving' : 'What can you prove?';
		},
		statusMessage() {
			if (this.gaveUp) return `You gave up on puzzle ${this.index + 1} of ${this.total}.`;
			return this.shareMessage || (this.results[this.index] === 'failed' ? 'That deduction was unsupported, so this segment is marked failed. Finish the puzzle to continue.' : 'One unsupported mark fails this segment, but the run continues.');
		},
	},
	methods: {
		selectMode(key) {
			if (!['intro', 'preparing'].includes(this.phase) || key === this.modeKey || !this.modes.some((mode) => mode.key === key)) {
				return;
			}
			this.modeKey = challengeMode(key).key;
			this.received = false;
			this.targetMs = undefined;
			MinesightStorage.set('challengeModeKey', this.modeKey);
			this.seed = puzzleRandomSeed();
			return this.prepare();
		},
		async prepare() {
			let id = ++this.preparationId;
			let nextSeed = this.seed;
			this.shareMessage = '';
			this.phase = 'preparing';
			this.error = '';
			this.puzzles = [];
			try {
				for (let difficulty of this.plan) {
					let generated = await generatePuzzleField(difficulty, { seed: nextSeed, cancelled: () => id !== this.preparationId });
					if (!generated || id !== this.preparationId) {
						return;
					}
					this.puzzles.push(Vue.markRaw(generated.field));
					nextSeed = generated.seed === PUZZLE_MAX_SEED ? 0n : generated.seed + 1n;
				}
				this.phase = 'intro';
			}
			catch (error) {
				if (id === this.preparationId) {
					this.error = error instanceof Error ? error.message : String(error);
					this.phase = 'intro';
				}
			}
		},
		activateStart() {
			if (this.ready) {
				this.begin();
			}
			else if (this.phase === 'intro') {
				void this.prepare();
			}
		},
		begin() {
			if (!this.ready) {
				return;
			}
			this.index = 0;
			this.results = [];
			this.elapsedMs = 0;
			this.phase = 'playing';
			this.loadPuzzle();
			this.startTimer();
			gameSounds.play('start');
			this.$emit('navigation-lock', true);
		},
		loadPuzzle() {
			this.puzzle.destroy();
			this.puzzle = new PuzzleController(this.puzzles[this.index]);
			this.puzzle.onRejected = () => { if (!this.results[this.index]) this.results[this.index] = 'failed'; };
			this.puzzle.onSolved = () => {
				if (!this.results[this.index]) {
					this.results[this.index] = 'cleared';
				}
				this.stopTimer();
				if (this.index + 1 === this.total) {
					this.finish();
				}
				else {
					this.phase = 'between';
				}
			};
			this.$refs.puzzleView?.resetScratch();
		},
		advance() {
			if (this.index + 1 >= this.total) {
				this.finish();
				return;
			}
			this.index += 1;
			this.phase = 'playing';
			this.loadPuzzle();
			this.startTimer();
		},
		startTimer() {
			this.startedAt = performance.now() - this.elapsedMs;
			this.timerId = setInterval(() => { this.elapsedMs = performance.now() - this.startedAt; }, 31);
		},
		stopTimer() {
			if (this.timerId === undefined) {
				return;
			}
			clearInterval(this.timerId);
			this.timerId = undefined;
			this.elapsedMs = performance.now() - this.startedAt;
		},
		finish() {
			this.stopTimer();
			this.phase = 'result';
			this.$emit('navigation-lock', false);
			let perfect = !this.gaveUp && this.failedCount === 0;
			gameSounds.play(perfect ? 'perfectComplete' : 'failedComplete');
			if (!this.gaveUp) {
				feedbackEffects.success({ grand: perfect });
			}
			if (!this.gaveUp && (perfect || this.timeBeaten)) {
				feedbackEffects.fireworks();
			}
		},
		giveUp() {
			if (this.phase !== 'playing') {
				return;
			}
			this.gaveUp = true;
			this.results[this.index] = 'failed';
			this.stopTimer();
			this.phase = 'gave-up';
			this.puzzle.clearRejected();
			this.puzzle.feedbackMessage = '';
			this.puzzle.result = 'gave-up';
			this.puzzle.solutionVisible = true;
			this.$refs.puzzleView?.resetScratch();
			this.$emit('navigation-lock', false);
			gameSounds.play('failure');
			feedbackEffects.failure({ terminal: true });
		},
		replay() {
			this.seed = puzzleRandomSeed();
			this.targetMs = undefined;
			this.received = false;
			this.puzzles = [];
			this.results = [];
			this.index = 0;
			this.elapsedMs = 0;
			this.gaveUp = false;
			this.phase = 'intro';
			this.shareMessage = '';
			void this.prepare();
		},
		async share() {
			let url = new URL(window.location.href);
			for (let key of ['p', 'tutorial', 'challenge', 'seed', 'time']) url.searchParams.delete(key);
			let completed = this.phase === 'result' && !this.gaveUp;
			let targetMs = completed ? Math.floor(this.elapsedMs / 10) * 10 : this.targetMs;
			let target = targetMs === undefined ? '' : `&time=${targetMs}`;
			url.hash = `/challenge/${this.modeKey}?seed=${this.seed.toString(16)}${target}`;
			let data = { title: 'Minesight Challenge', text: completed ? `I completed Minesight ${this.mode.label} in ${this.timerText}. Can you beat my time?` : `You have been challenged to Minesight ${this.mode.label}!`, url: url.href };
			try {
				if (navigator.share) {
					try {
						await navigator.share(data);
						this.shareMessage = 'Challenge shared';
						return;
					}
					catch (error) {
						if (error instanceof Error && error.name === 'AbortError') {
							return;
						}
					}
				}
				await navigator.clipboard.writeText(url.href);
				this.shareMessage = 'Challenge link copied';
			}
			catch {
				this.shareMessage = 'The challenge link could not be copied.';
			}
		},
		showTestEnd(failedCount = 0) {
			if (!['', 'localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
				return false;
			}
			let failures = Math.min(this.total, Math.max(0, Math.trunc(Number(failedCount) || 0)));
			this.preparationId += 1;
			this.gaveUp = false;
			this.index = this.total - 1;
			this.results = Array.from({ length: this.total }, (_, index) => index < this.total - failures ? 'cleared' : 'failed');
			this.finish();
			return true;
		},
		beforeUnload(event) {
			if (['playing', 'between'].includes(this.phase)) {
				event.preventDefault();
				event.returnValue = '';
			}
		},
		formatTime(value) {
			return challengeTime(value);
		},
		difficultyFor(key) {
			return puzzleDifficulty(key);
		},
	},
	mounted() {
		window.addEventListener('beforeunload', this.beforeUnload);
		if (['', 'localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
			Reflect.set(window, 'minesightTestChallengeEnd', this.showTestEnd);
		}
		void this.prepare();
	},
	beforeUnmount() {
		if (Reflect.get(window, 'minesightTestChallengeEnd') === this.showTestEnd) {
			Reflect.deleteProperty(window, 'minesightTestChallengeEnd');
		}
		this.preparationId += 1;
		this.stopTimer();
		this.puzzle.destroy();
		this.$emit('navigation-lock', false);
		window.removeEventListener('beforeunload', this.beforeUnload);
	},
});
</script>

<template id="challenge-page">
	<main class="play-page challenge-page" aria-label="Challenge">
		<section v-if="phase === 'intro' || phase === 'preparing'" class="challenge-page__intro" :aria-busy="phase === 'preparing'">
			<div v-if="received" class="challenge-page__invitation">
				<h2>{{ mode.label }}</h2>
				<p v-if="targetMs !== undefined">Time to beat: <strong>{{ formatTime(targetMs) }}</strong></p>
				<div class="challenge-page__difficulties" :style="{ '--challenge-tier-count': mode.route.length }" aria-label="Challenge difficulties">
					<div v-for="[key, count] in mode.route" :key="key"><strong>{{ difficultyFor(key).label }}</strong><span>{{ count }} puzzles</span></div>
				</div>
			</div>
			<div v-else class="challenge-page__modes" role="group" aria-label="Challenge route">
				<button class="control-feedback" v-for="option in modes" :key="option.key" type="button" :class="{ active: modeKey === option.key }" :aria-pressed="modeKey === option.key" @click="selectMode(option.key)">
					<span class="challenge-page__mode-heading"><strong>{{ option.label }}</strong><span>{{ option.route.reduce((total, [, count]) => total + count, 0) }} puzzles</span></span>
					<span class="challenge-page__mode-route">{{ option.route.map(([key, count]) => `${count} ${difficultyFor(key).label}`).join(' · ') }}</span>
				</button>
			</div>
			<p class="challenge-page__instructions">Race through the puzzles. Each mistake marks that puzzle failed, but you can keep solving it. Mark every covered square the clues prove safe or mined. The clock starts when you press Start.</p>
			<p v-if="error" class="challenge-page__error" role="alert">{{ error }}</p>
			<div class="challenge-page__intro-actions">
				<button type="button" class="control-feedback challenge-page__start" :disabled="phase === 'preparing'" @click="activateStart">{{ startLabel }}</button>
				<button type="button" class="control-feedback challenge-page__invite" @click="share">
					<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"></circle><circle cx="6" cy="12" r="2.5"></circle><circle cx="18" cy="19" r="2.5"></circle><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"></path></svg>
					<span>Invite a friend</span>
				</button>
			</div>
			<p v-if="shareMessage" class="challenge-page__share-message" role="status">{{ shareMessage }}</p>
		</section>
		<template v-else-if="phase === 'playing' || phase === 'between' || phase === 'gave-up'">
			<section class="challenge-page__progress" aria-label="Challenge progress">
				<header class="challenge-page__run">
					<span>{{ currentDifficulty.label }} · {{ index + 1 }} / {{ total }}</span>
					<div class="challenge-page__timer" aria-label="Elapsed time"><span>Time</span><strong>{{ timerText.slice(0, -3) }}</strong></div>
				</header>
				<div class="challenge-page__track" :style="{ '--challenge-tier-count': progressGroups.length }">
					<div v-for="group in progressGroups" :key="group.key" class="challenge-page__group" role="group" :aria-label="group.label">
						<span class="challenge-page__path-label">{{ group.label }}</span>
						<div class="challenge-page__steps" :style="{ '--challenge-step-count': group.steps.length }">
							<span
								v-for="(step, offset) in group.steps" :key="step" class="challenge-page__step" role="img"
								:aria-label="`${group.label} puzzle ${offset + 1}, ${results[step] || (step === index ? 'current' : 'upcoming')}`"
								:aria-current="step === index ? 'step' : undefined"
								:class="{ current: step === index && !results[step], cleared: results[step] === 'cleared', failed: results[step] === 'failed' }"
							></span>
						</div>
					</div>
				</div>
			</section>
			<puzzle-view ref="puzzleView" :puzzle="puzzle" :status-title="statusTitle" :status-message="statusMessage">
				<hold-button v-if="phase === 'playing'" label="Give up" @confirm="giveUp"></hold-button>
				<button v-else-if="phase === 'gave-up'" type="button" class="control-feedback primary" @click="replay">Restart run</button>
				<button v-else type="button" class="control-feedback primary" @click="advance">{{ index + 1 === total ? 'See result' : 'Next challenge' }}</button>
			</puzzle-view>
		</template>
		<section v-else class="challenge-page__result" role="status" aria-live="polite">
			<div class="challenge-page__medal" :class="{ failed: gaveUp || failedCount > 0 }" aria-hidden="true"><span>{{ gaveUp || failedCount > 0 ? '⚑' : '✓' }}</span></div>
			<h2>{{ finishTitle }}</h2>
			<p>{{ completeMessage }}</p>
			<div class="challenge-page__scorecard" :class="{ beaten: timeBeaten }">
				<div class="challenge-page__final-time" aria-label="Final time"><span>Final time</span><strong>{{ timerText }}</strong></div>
				<div v-if="timeDifference !== undefined" class="challenge-page__comparison">
					<strong class="challenge-page__time-result">{{ timeResultMessage }}</strong>
					<div class="challenge-page__their-time" aria-label="Their time"><span>Their time</span><strong>{{ formatTime(targetMs) }}</strong></div>
				</div>
			</div>
			<div class="challenge-page__intro-actions challenge-page__finish-actions">
				<button type="button" class="control-feedback challenge-page__start" @click="replay">Play again</button>
				<button type="button" class="control-feedback challenge-page__invite" @click="share">
					<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"></circle><circle cx="6" cy="12" r="2.5"></circle><circle cx="18" cy="19" r="2.5"></circle><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"></path></svg>
					<span>Challenge a friend</span>
				</button>
			</div>
			<p v-if="shareMessage" class="challenge-page__share-message" role="status">{{ shareMessage }}</p>
		</section>
	</main>
</template>

<style>
.challenge-page__intro {
	padding-bottom: .25rem;
}
.challenge-page__modes {
	display: grid;
	gap: .4375rem;
	margin-bottom: .75rem;
}
.challenge-page__modes button {
	display: grid;
	gap: .25rem;
	padding: .5625rem .625rem;
	border: 1px solid var(--line);
	border-radius: 0;
	outline: 2px solid transparent;
	outline-offset: 2px;
	background: var(--paper);
	color: var(--ink);
	font-family: ui-sans-serif, system-ui, sans-serif;
	text-align: left;
	cursor: pointer;
	transition: border-color 140ms ease-out, box-shadow 140ms ease-out;
}
.challenge-page__modes button:hover {
	border-color: color-mix(in srgb, var(--muted) 40%, var(--line));
}
.challenge-page__modes button.active {
	border-color: color-mix(in srgb, var(--muted) 72%, var(--line));
	box-shadow: inset 2px 0 color-mix(in srgb, var(--muted) 72%, var(--line));
}
.challenge-page__modes button:focus-visible,
.challenge-page__intro-actions button:focus-visible {
	outline: 2px solid var(--focus);
	outline-offset: 2px;
}
.challenge-page__mode-heading {
	display: flex;
	justify-content: space-between;
	gap: .75rem;
}
.challenge-page__mode-heading strong {
	font-size: .75rem;
}
.challenge-page__mode-heading > span,
.challenge-page__mode-route {
	color: var(--muted);
	font-size: .625rem;
}
.challenge-page__invitation {
	margin-bottom: .75rem;
}
.challenge-page__invitation h2 {
	margin: 0 0 .75rem;
	font: 700 1.5rem/1.1 Georgia, "Times New Roman", serif;
}
.challenge-page__invitation p {
	margin: -.125rem 0 .75rem;
	font: .8125rem/1.5 ui-sans-serif, system-ui, sans-serif;
}
.challenge-page__invitation p strong {
	font-variant-numeric: tabular-nums;
}
.challenge-page__difficulties {
	display: grid;
	grid-template-columns: repeat(var(--challenge-tier-count), minmax(0, 1fr));
	gap: .375rem;
}
.challenge-page__difficulties div {
	display: grid;
	gap: .1875rem;
	min-width: 0;
	padding: .625rem .375rem;
	border: 1px solid var(--line);
	background: var(--paper);
	font-family: ui-sans-serif, system-ui, sans-serif;
	text-align: center;
}
.challenge-page__difficulties strong {
	font-size: .6875rem;
}
.challenge-page__difficulties span {
	color: var(--muted);
	font-size: .5625rem;
}
.challenge-page__instructions {
	margin: 0;
	color: var(--muted);
	font: .8125rem/1.5 ui-sans-serif, system-ui, sans-serif;
}
.challenge-page__intro-actions {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: .5rem;
	margin-top: 1.125rem;
}
.challenge-page__intro-actions button {
	min-width: 0;
	min-height: 2.875rem;
	padding: .5rem .625rem;
	border: 1px solid var(--line);
	border-radius: 0;
	font: 700 .75rem/1.3 ui-sans-serif, system-ui, sans-serif;
	cursor: pointer;
}
.challenge-page__intro-actions .challenge-page__start {
	border-color: var(--ink);
	background: var(--ink);
	color: var(--paper);
}
.challenge-page__intro-actions .challenge-page__start:hover:not(:disabled) {
	background: color-mix(in srgb, var(--ink) 85%, var(--paper));
}
.challenge-page__intro-actions .challenge-page__start:disabled {
	border-color: var(--line);
	background: var(--covered);
	color: var(--muted);
	cursor: default;
}
.challenge-page__invite {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: .4375rem;
	background: var(--paper);
	color: var(--ink);
}
.challenge-page__invite:hover {
	background: color-mix(in srgb, var(--paper) 82%, var(--covered));
}
.challenge-page__invite svg {
	flex: 0 0 1.0625rem;
	width: 1.0625rem;
	height: 1.0625rem;
	fill: var(--paper);
	stroke: currentColor;
	stroke-linecap: round;
	stroke-linejoin: round;
	stroke-width: 1.7;
}
.challenge-page__share-message {
	margin: .4375rem 0 0;
	color: var(--muted);
	font: .6875rem/1.4 ui-sans-serif, system-ui, sans-serif;
}
.challenge-page__error {
	color: var(--danger-ink);
}
.challenge-page__progress {
	margin-bottom: -.125rem;
}
.challenge-page__run {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	margin-bottom: .625rem;
}
.challenge-page__run > span {
	color: var(--muted);
	font: .6875rem ui-sans-serif, system-ui, sans-serif;
}
.challenge-page__timer {
	flex-shrink: 0;
	text-align: right;
}
.challenge-page__timer span {
	display: block;
	color: var(--muted);
	font: .6875rem ui-sans-serif, system-ui, sans-serif;
}
.challenge-page__timer strong {
	display: block;
	font: 700 1.125rem/1.15 ui-sans-serif, system-ui, sans-serif;
	font-variant-numeric: tabular-nums;
}
.challenge-page__track {
	display: grid;
	grid-template-columns: repeat(var(--challenge-tier-count), minmax(0, 1fr));
	gap: .4375rem;
}
.challenge-page__path-label {
	display: block;
	margin-bottom: .25rem;
	color: var(--muted);
	font: .625rem ui-sans-serif, system-ui, sans-serif;
}
.challenge-page__steps {
	display: grid;
	grid-template-columns: repeat(var(--challenge-step-count), minmax(0, 1fr));
	gap: .1875rem;
}
.challenge-page__step {
	height: .3125rem;
	background: var(--path-pending);
}
.challenge-page__step.current {
	background: var(--path-current);
}
.challenge-page__step.cleared {
	background: var(--ink);
}
.challenge-page__step.failed {
	background: var(--danger);
}
.challenge-page__result {
	position: relative;
	isolation: isolate;
	padding: 24px 0 4px;
	text-align: center;
}

.challenge-page__result h2 {
	margin: 0 0 6px;
	font: 700 2rem/1 Georgia, "Times New Roman", serif;
}

.challenge-page__result > p {
	margin: 0;
	color: var(--muted);
	font: 13px ui-sans-serif, system-ui, sans-serif;
}

.challenge-page__medal {
	position: relative;
	display: grid;
	place-items: center;
	width: 92px;
	height: 92px;
	margin: 4px auto 22px;
	border: 2px solid var(--success);
	border-radius: 50%;
	background: var(--paper);
	color: var(--success);
	box-shadow: 0 0 0 8px var(--background), 0 0 0 9px var(--success-effect);
	animation: challenge-medal-pulse 1400ms ease-in-out infinite alternate;
	user-select: none;
}

.challenge-page__medal::before {
	position: absolute;
	inset: -28px;
	z-index: -1;
	background: repeating-conic-gradient(from 0deg, var(--success-effect) 0 2deg, transparent 2deg 18deg);
	content: '';
	-webkit-mask: radial-gradient(circle, transparent 0 54%, #000 55% 100%);
	mask: radial-gradient(circle, transparent 0 54%, #000 55% 100%);
	animation: challenge-medal-rays 14s linear infinite;
}

.challenge-page__medal span {
	font: 800 43px/1 ui-sans-serif, system-ui, sans-serif;
}

.challenge-page__medal.failed {
	border-color: var(--danger);
	color: var(--danger);
	box-shadow: 0 0 0 8px var(--background), 0 0 0 9px var(--danger);
}

.challenge-page__medal.failed::before {
	background: repeating-conic-gradient(from 0deg, var(--danger) 0 2deg, transparent 2deg 18deg);
}

.challenge-page__scorecard {
	max-width: 340px;
	margin: 22px auto 0;
	padding: 7px;
	border: 1px solid var(--line);
	background: var(--paper);
	box-shadow: 0 10px 30px rgb(0 0 0 / 6%);
}

.challenge-page__scorecard.beaten {
	border-color: color-mix(in srgb, var(--success) 55%, var(--line));
	box-shadow: inset 0 3px var(--success), 0 10px 30px rgb(0 0 0 / 7%);
}

.challenge-page__final-time {
	padding: 18px 14px 20px;
}

.challenge-page__final-time span {
	display: block;
	color: var(--muted);
	font: 700 10px ui-sans-serif, system-ui, sans-serif;
	letter-spacing: .09em;
	text-transform: uppercase;
}

.challenge-page__final-time strong {
	display: block;
	margin-top: 3px;
	font: 800 34px/1.15 ui-monospace, SFMono-Regular, Menlo, monospace;
	font-variant-numeric: tabular-nums;
}

.challenge-page__comparison {
	display: grid;
	gap: 10px;
	padding: 13px 15px 12px;
	background: color-mix(in srgb, var(--covered) 58%, var(--paper));
}

.challenge-page__time-result {
	display: block;
	font: 700 17px/1.2 Georgia, "Times New Roman", serif;
}

.challenge-page__their-time {
	display: flex;
	align-items: baseline;
	justify-content: center;
	gap: 8px;
	color: var(--muted);
	font-family: ui-sans-serif, system-ui, sans-serif;
}

.challenge-page__their-time span {
	font-size: 10px;
	font-weight: 700;
	letter-spacing: .08em;
	text-transform: uppercase;
}

.challenge-page__their-time strong {
	font: 700 16px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
	font-variant-numeric: tabular-nums;
}

.challenge-page__result .challenge-page__start {
	margin-top: 0;
}

.challenge-page__finish-actions {
	max-width: 340px;
	margin-inline: auto;
}

@keyframes challenge-medal-pulse {
	from { transform: scale(.97); }
	to { transform: scale(1.04); }
}

@keyframes challenge-medal-rays {
	to { transform: rotate(1turn); }
}

.challenge-page__result .challenge-page__share-message { margin-top: .4375rem; font-size: .6875rem; }
@media (prefers-reduced-motion: reduce) {
	.challenge-page__medal, .challenge-page__medal::before { animation: none; }
}
</style>
