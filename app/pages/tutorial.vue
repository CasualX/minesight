<link rel="component" href="../play-page.vue.css">
<link rel="component" href="../minefield-view.vue">
<link rel="component" href="../components/board-utilities.vue">
<link rel="component" href="../puzzle.vue.js">

<script>
const TUTORIAL_GUIDE = [
	{
		index: 1, x: 1, y: 0, action: 'alternate',
		bubble: 'right',
		title: 'Mark a mine',
		message: 'The 1 on the right touches only one covered square. Long-press or right-click that square to mark it as a mine.',
	},
	{
		index: 0, x: 0, y: 0, action: 'primary',
		bubble: 'below',
		title: 'Mark a square safe',
		message: 'The mine you marked already satisfies the 1 below it. That proves the other covered square is safe. Tap it.',
	},
	{
		index: 46, x: 6, y: 5, action: 'either',
		bubble: 'left',
		title: 'Leave uncertain squares alone',
		message: 'The mine could be in several places around these two 1s, so the highlighted square could be safe or mined. Tap it to try a guess.',
	},
];

function createTutorialPuzzleField() {
	let state = new Uint8Array(64);
	let set = (x, y, flags) => { state[y * 8 + x] = flags; };
	set(0, 0, PuzzleField.ACTIVE | PuzzleField.FORCED_SAFE);
	set(1, 0, PuzzleField.MINE | PuzzleField.ACTIVE | PuzzleField.FORCED_MINE);
	for (let y = 0; y < 4; y += 1) for (let x = 0; x < 5; x += 1) {
		if (state[y * 8 + x] === 0) set(x, y, x === 4 || y === 3
			? PuzzleField.ACTIVE | PuzzleField.FORCED_SAFE
			: PuzzleField.REVEALED);
	}
	set(5, 3, PuzzleField.ACTIVE | PuzzleField.FORCED_SAFE);
	set(6, 3, PuzzleField.ACTIVE);
	set(7, 3, PuzzleField.ACTIVE);
	set(5, 4, PuzzleField.ACTIVE | PuzzleField.FORCED_SAFE);
	set(6, 4, PuzzleField.REVEALED);
	set(7, 4, PuzzleField.REVEALED);
	set(5, 5, PuzzleField.ACTIVE | PuzzleField.FORCED_SAFE);
	set(6, 5, PuzzleField.ACTIVE);
	set(7, 5, PuzzleField.MINE | PuzzleField.ACTIVE);
	return new PuzzleField(8, 8, state);
}

class TutorialPuzzleController extends PuzzleController {
	constructor() {
		super(createTutorialPuzzleField(), { autoComplete: false });
		this.step = 0;
	}

	get finished() { return this.step >= TUTORIAL_GUIDE.length; }
	get disabled() { return this.finished || super.disabled; }

	handleAction(input) {
		if (this.disabled) return;
		let expected = TUTORIAL_GUIDE[this.step];
		// The uncertainty step accepts either mark, as in the original tutorial.
		if (input.index !== expected.index || (expected.action !== 'either' && input.action !== expected.action)) {
			this.reject(input.index, 'Try the highlighted square using the instructed action.');
			return;
		}
		if (expected.action === 'either') this.reject(input.index, 'That square is not forced. Minesight rejects guesses.');
		else super.handleAction(input);
		this.step += 1;
	}
}

const TutorialPage = Vue.defineComponent({
	template: '#tutorial-page',
	components: { MinefieldView, BoardUtilities },
	emits: ['open-page'],
	data() {
		return {
			puzzle: new TutorialPuzzleController(),
			interactiveStates: PUZZLE_INTERACTIVE_STATES,
		};
	},
	computed: {
		step() { return this.puzzle.step; },
		finished() { return this.puzzle.finished; },
		guide() { return TUTORIAL_GUIDE[this.step]; },
		bubbleStyle() {
			if (!this.guide) return {};
			let { x, y } = this.guide;
			let { width, height } = this.puzzle.field;
			return {
				'--tutorial-right-edge': `${(x + 1) / width * 100}%`,
				'--tutorial-top': `${y / height * 100}%`,
				'--tutorial-space-right': `${(width - x) / width * 100}%`,
				'--tutorial-space-below': `${(height - y - 1) / height * 100}%`,
				'--tutorial-bottom-edge': `${(y + 1) / height * 100}%`,
				'--tutorial-target-center': `${(x + .5) / width * 100}%`,
			};
		},
	},
	beforeUnmount() { this.puzzle.destroy(); },
});
</script>

<template id="tutorial-page">
	<main class="play-page tutorial-page" :data-step="step" aria-label="How to play" aria-describedby="tutorial-goal">
		<header class="play-page__heading"><p id="tutorial-goal">Use the clues to mark every square you can prove safe or mined. Leave uncertain squares covered.</p></header>
		<div class="tutorial-page__board" data-feedback-board>
			<minefield-view
				:width="puzzle.field.width" :height="puzzle.field.height" :cells="puzzle.cells"
				:interactive="interactiveStates" :disabled="puzzle.disabled"
				:aria-describedby="finished ? undefined : 'tutorial-lesson-title'"
				@cell-action="puzzle.handleAction($event)"
			></minefield-view>
			<aside v-if="!finished" class="tutorial-page__bubble" :class="`tutorial-page__bubble--${guide.bubble}`" :style="bubbleStyle" aria-live="polite" aria-atomic="true">
				<span class="tutorial-page__progress">Step {{ step + 1 }} of 3</span>
				<h2 id="tutorial-lesson-title">{{ guide.title }}</h2>
				<p>{{ guide.message }}</p>
			</aside>
		</div>
		<board-utilities :notes-available="false"
			help="Tap or left-click to mark safe. Long-press, right-click, or press F to mark mined."
		></board-utilities>
		<p class="tutorial-page__feedback" role="status">{{ puzzle.feedbackMessage }}</p>
		<div class="tutorial-page__actions">
			<button v-if="finished" type="button" class="control-feedback tutorial-page__primary" @click="$emit('open-page', 'study', { difficultyKey: 'beginner' })">Start playing</button>
			<button class="control-feedback" v-else type="button" @click="$emit('open-page', 'home')">Skip introduction</button>
		</div>
	</main>
</template>

<style>
.tutorial-page { --tutorial: #d99019; --tutorial-ring: #fff2bd; }
:root[data-color-scheme="dark"] .tutorial-page { --tutorial: #f1b84d; --tutorial-ring: #5f481d; }
.tutorial-page__board { position: relative; }
.tutorial-page__bubble {
	position: absolute;
	z-index: 3;
	padding: 11px 12px 12px;
	border: 2px solid var(--tutorial);
	border-radius: 9px;
	background: var(--paper);
	box-shadow: 3px 4px 0 color-mix(in srgb, var(--tutorial-ring) 85%, transparent);
	user-select: none;
}

.tutorial-page__bubble::before {
	position: absolute;
	top: var(--tutorial-pointer-y);
	width: 0;
	height: 0;
	border-block: 9px solid transparent;
	content: '';
}

.tutorial-page__bubble--right {
	top: calc(var(--tutorial-top) + 4px);
	right: 8px;
	left: calc(var(--tutorial-right-edge) + 12px);
	--tutorial-pointer-y: 12px;
}

.tutorial-page__bubble--right::before {
	right: 100%;
	border-right: 12px solid var(--tutorial);
}

.tutorial-page__bubble--left {
	right: calc(var(--tutorial-space-right) + 12px);
	bottom: calc(var(--tutorial-space-below) + 4px);
	left: 8px;
	--tutorial-pointer-y: calc(100% - 30px);
}

.tutorial-page__bubble--left::before {
	left: 100%;
	border-left: 12px solid var(--tutorial);
}

.tutorial-page__bubble--below {
	top: calc(var(--tutorial-bottom-edge) + 12px);
	right: 8px;
	left: 8px;
}

.tutorial-page__bubble--below::before {
	bottom: 100%;
	left: calc(var(--tutorial-target-center) - 17px);
	border: 0;
	border-right: 9px solid transparent;
	border-bottom: 12px solid var(--tutorial);
	border-left: 9px solid transparent;
}

.tutorial-page__bubble h2 {
	margin: 4px 0 3px;
	font-size: clamp(14px, 4.5vw, 18px);
}

.tutorial-page__bubble p {
	margin: 0;
	color: var(--muted);
	font: 11px/1.4 ui-sans-serif, system-ui, sans-serif;
}

.tutorial-page__progress { color: var(--muted); font: 700 10px ui-sans-serif, system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
.tutorial-page[data-step="0"] [data-cell-index="1"],
.tutorial-page[data-step="1"] [data-cell-index="0"],
.tutorial-page[data-step="2"] [data-cell-index="46"] { position: relative; z-index: 1; box-shadow: inset 0 0 0 3px var(--tutorial), 0 0 0 3px var(--tutorial-ring); animation: tutorial-page-target 900ms ease-in-out infinite alternate; }
@keyframes tutorial-page-target { from { filter: brightness(1); } to { filter: brightness(1.12); } }
@media (prefers-reduced-motion: reduce) { .tutorial-page [data-cell-index] { animation: none; } }
.tutorial-page .minefield-view__cell:focus-visible { box-shadow: inset 0 0 0 2px var(--focus); }
.tutorial-page__feedback { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.tutorial-page__actions { display: flex; flex-direction: column; gap: .5rem; }
.tutorial-page__actions button { min-height: 2.75rem; padding: .625rem; border: 1px solid var(--line); background: var(--paper); color: var(--ink); font: 700 .8125rem ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
.tutorial-page__actions button:hover { border-color: var(--ink); }
.tutorial-page__actions button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.tutorial-page__actions .tutorial-page__primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
</style>
