<link rel="component" href="../minefield-view.vue">
<link rel="component" href="../components/board-utilities.vue">
<link rel="component" href="../scratch-pad.vue">
<link rel="component" href="../scratch-notes.vue.js">
<link rel="component" href="../storage.vue.js">
<link rel="component" href="../minefield.vue.js">
<link rel="component" href="../minetacs.vue.js">

<script>
import { PlayField } from './minefield.js';
import { feedbackEffects } from './feedback.js';
import { gameSounds } from './sounds.js';

/** @param {PlayField} field @param {number} index @param {'playing' | 'cleared' | 'failed'} result */
function presentMineFieldCell(field, index, result = 'playing') {
	let x = index % field.width;
	let y = Math.floor(index / field.width);
	let revealed = field.isState(x, y, PlayField.REVEALED);
	let mine = field.isState(x, y, PlayField.MINE);

	if (revealed && mine) return CellState.DETONATED_MINE;
	if (revealed) return CellState[`CLUE_${field.getClue(x, y)}`];
	if (result === 'failed' && field.isState(x, y, PlayField.FORCED_SAFE)) return CellState.MARKED_SAFE;
	if (field.isState(x, y, PlayField.FLAG)) return CellState.FLAGGED;
	return CellState.COVERED;
}

/** @param {PlayField} field @param {'playing' | 'cleared' | 'failed'} result */
function presentMineField(field, result = 'playing') {
	return Array.from(field.state, (_, index) => presentMineFieldCell(field, index, result));
}

const TRADITIONAL_BOARD_SIZE = 8;
const TRADITIONAL_RULES_VERSION = 2;
const TRADITIONAL_INTERACTIVE_STATES = new Set([
	CellState.COVERED,
	CellState.FLAGGED,
	CellState.CLUE_0,
	CellState.CLUE_1,
	CellState.CLUE_2,
	CellState.CLUE_3,
	CellState.CLUE_4,
	CellState.CLUE_5,
	CellState.CLUE_6,
	CellState.CLUE_7,
	CellState.CLUE_8,
]);

function randomTraditionalSeed() {
	let entropy = new Uint32Array(2);
	crypto.getRandomValues(entropy);
	return BigInt(entropy[0]) | BigInt(entropy[1]) << 32n;
}

/** @param {bigint} seed */
function nextTraditionalSeed(seed) {
	return BigInt.asUintN(64, seed + 0x9e3779b97f4a7c15n);
}

/** @param {PlayField} field @param {bigint} mines */
function fieldWithMineLayout(field, mines) {
	let state = Uint8Array.from(field.state, (cell, index) => {
		let visible = cell & (PlayField.REVEALED | PlayField.FLAG);
		return visible | ((mines & (1n << BigInt(index))) !== 0n ? PlayField.MINE : 0);
	});
	return new PlayField(field.width, field.height, state);
}

class TraditionalMinefieldController {
	constructor() {
		let saved = MinesightStorage.get('traditional', undefined);
		this.field = Vue.markRaw(new PlayField(TRADITIONAL_BOARD_SIZE, TRADITIONAL_BOARD_SIZE));
		this.seed = randomTraditionalSeed();
		this.result = 'playing';
		this.busy = false;
		this.error = '';
		this.revision = 0;
		this.moveId = 0;

		try {
			if (saved?.rulesVersion === TRADITIONAL_RULES_VERSION
				&& Array.isArray(saved.cells)
				&& saved.cells.length === TRADITIONAL_BOARD_SIZE * TRADITIONAL_BOARD_SIZE) {
				this.field = Vue.markRaw(new PlayField(
					TRADITIONAL_BOARD_SIZE,
					TRADITIONAL_BOARD_SIZE,
					Uint8Array.from(saved.cells),
				));
				this.seed = BigInt(saved.seed);
				if (['playing', 'cleared', 'failed'].includes(saved.result)) this.result = saved.result;
			}
		}
		catch {}
	}

	get cells() {
		this.revision;
		return presentMineField(this.field, this.result);
	}

	get disabled() {
		return this.busy || this.result !== 'playing';
	}

	get statusTitle() {
		if (this.result === 'cleared') return 'Field cleared';
		if (this.result === 'failed') return 'Game over';
		return 'Traditional Minesweeper';
	}

	get statusMessage() {
		if (this.result === 'cleared') return 'You cleared the minefield without guessing.';
		if (this.result === 'failed') return 'That move was not logically safe. The provably safe choices are highlighted.';
		return 'Reveal safe squares, flag mines, and use the numbered clues. You never need to guess.';
	}

	save() {
		MinesightStorage.set('traditional', {
			rulesVersion: TRADITIONAL_RULES_VERSION,
			cells: Array.from(this.field.state),
			seed: String(this.seed),
			result: this.result,
		});
	}

	destroy() {
		this.moveId += 1;
		this.busy = false;
		this.save();
	}

	newGame() {
		if (this.result === 'playing' && !window.confirm('Start a new game?\n\nYour current game is not finished.')) return;
		this.moveId += 1;
		this.field = Vue.markRaw(new PlayField(TRADITIONAL_BOARD_SIZE, TRADITIONAL_BOARD_SIZE));
		this.seed = randomTraditionalSeed();
		this.result = 'playing';
		this.busy = false;
		this.error = '';
		this.revision += 1;
		this.save();
	}

	/** @param {{ action: 'primary' | 'alternate', index: number, row: number, column: number }} input */
	handleAction(input) {
		if (this.disabled) return;
		let { action, index, row: y, column: x } = input;
		let revealed = this.field.isState(x, y, PlayField.REVEALED);

		if (action === 'alternate' && !revealed) {
			this.field.actionFlag(x, y);
			let flagged = this.field.isState(x, y, PlayField.FLAG);
			gameSounds.play(flagged ? 'mark' : 'unmark');
			if (flagged) feedbackEffects.mark({ cellIndex: index, mine: true });
			this.revision += 1;
			this.save();
			return;
		}

		if (revealed && this.field.getChordAction(x, y) === 'flag') {
			let previousState = this.field.state.slice();
			this.field.actionChord(x, y);
			gameSounds.play('mark');
			for (let [cellIndex, cell] of this.field.state.entries()) {
				if ((previousState[cellIndex] & PlayField.FLAG) === 0 && (cell & PlayField.FLAG) !== 0) {
					feedbackEffects.mark({ cellIndex, mine: true });
				}
			}
			this.revision += 1;
			this.save();
			return;
		}

		if (revealed && this.field.getChordAction(x, y) !== 'reveal') return;
		void this.reveal(x, y);
	}

	/** @param {number} x @param {number} y */
	async reveal(x, y) {
		if (this.disabled || this.field.isState(x, y, PlayField.FLAG)) return;
		let moveId = ++this.moveId;
		this.busy = true;
		this.error = '';
		try {
			let previousState = this.field.state.slice();
			let clickedIndex = this.field.getIndex(x, y);
			let move = await (await getMinetacs()).resolveTraditionalMove(this.field.state, clickedIndex, this.seed);
			if (moveId !== this.moveId) return;

			this.seed = nextTraditionalSeed(this.seed);
			this.field = Vue.markRaw(fieldWithMineLayout(this.field, move.mines));
			this.field.actionChord(x, y);
			let reason = this.field.gameOverReason();
			this.result = reason === PlayField.GAME_OVER_CLEARED ? 'cleared'
				: reason === PlayField.GAME_OVER_DETONATION ? 'failed' : 'playing';

			if (this.result === 'failed') {
				for (let index = 0; index < this.field.state.length; index += 1) {
					if ((move.forcedSafe & (1n << BigInt(index))) !== 0n) this.field.state[index] |= PlayField.FORCED_SAFE;
				}
				let failedIndex = this.field.state.findIndex(cell => (
					cell & (PlayField.MINE | PlayField.REVEALED)
				) === (PlayField.MINE | PlayField.REVEALED));
				gameSounds.play('failure');
				feedbackEffects.failure({ cellIndex: failedIndex, terminal: true });
			}
			else if (this.result === 'cleared') {
				gameSounds.play('success');
				feedbackEffects.success({ grand: true });
			}
			else {
				gameSounds.play('mark');
				for (let [cellIndex, cell] of this.field.state.entries()) {
					if ((previousState[cellIndex] & PlayField.REVEALED) === 0 && (cell & PlayField.REVEALED) !== 0) {
						feedbackEffects.mark({ cellIndex, mine: false });
					}
				}
			}
			this.revision += 1;
			this.save();
		}
		catch (error) {
			if (moveId === this.moveId) this.error = error instanceof Error ? error.message : String(error);
		}
		finally {
			if (moveId === this.moveId) this.busy = false;
		}
	}
}

const TraditionalPage = Vue.defineComponent({
	template: '#traditional-page',
	components: { MinefieldView, BoardUtilities, ScratchPad },
	data() {
		return {
			game: new TraditionalMinefieldController(),
			notes: new ScratchNotes(),
			interactiveStates: TRADITIONAL_INTERACTIVE_STATES,
		};
	},
	watch: {
		'game.field'(field, previous) { if (field !== previous && !field.state.some(cell => cell & PlayField.REVEALED)) this.resetScratch(); },
	},
	methods: {
		resetScratch() { this.notes.reset(); this.$refs.scratchPad?.reset(); },
		handleCellAction(input) {
			this.game.handleAction(input);
		},
	},
	beforeUnmount() {
		this.game.destroy();
	},
});
</script>

<template id="traditional-page">
	<main class="traditional-page" aria-labelledby="traditional-page-title">
		<div class="traditional-page__heading">
			<h1 id="traditional-page-title">Traditional Minesweeper</h1>
			<p>Select a revealed clue to complete a direct deduction.</p>
		</div>

		<div class="traditional-page__board" data-feedback-board :aria-busy="game.busy">
			<minefield-view
				:inert="notes.active"
				:width="game.field.width"
				:height="game.field.height"
				:cells="game.cells"
				:interactive="interactiveStates"
				:disabled="game.disabled"
				@cell-action="handleCellAction"
			></minefield-view>
			<div v-if="game.busy" class="traditional-page__loading" role="status" aria-live="polite">
				<span class="traditional-page__spinner" aria-hidden="true"></span>
				<span>Resolving a no-guess layout…</span>
			</div>
			<scratch-pad ref="scratchPad" :active="notes.active" v-model:tool="notes.tool" v-model:color="notes.color" @change="notes.strokeCount = $event.strokeCount"></scratch-pad>
		</div>
		<board-utilities class="traditional-page__utilities"
			:notes-active="notes.active" :notes-tool="notes.tool" :notes-color="notes.color" :stroke-count="notes.strokeCount"
			help="Tap or left-click to reveal. Long-press, right-click, or press F to flag."
			@toggle-notes="notes.toggle()" @select-pencil="notes.selectPencil($event)" @select-eraser="notes.tool = 'eraser'"
			@clear-notes="$refs.scratchPad?.clear()"
		></board-utilities>

		<p v-if="game.error" class="traditional-page__error" role="alert">{{ game.error }}</p>

		<div class="traditional-page__status" role="status" aria-live="polite">
			<strong>{{ game.statusTitle }}</strong>
			<span>{{ game.statusMessage }}</span>
		</div>

		<div class="traditional-page__actions">
			<button class="control-feedback" type="button" :disabled="game.busy" @click="game.newGame()">New game</button>
		</div>
	</main>
</template>

<style>
.traditional-page__utilities {
	margin-top: -.25rem;
}
.traditional-page {
	display: flex;
	width: min(26.25rem, calc(100% - 1.25rem));
	flex: 1;
	flex-direction: column;
	gap: 0.75rem;
	margin: 0 auto;
	padding: 0.625rem 0 calc(1.75rem + env(safe-area-inset-bottom));
}

.traditional-page__heading h1 {
	margin: 0 0 0.25rem;
	font: 700 1.5625rem/1.1 Georgia, "Times New Roman", serif;
	letter-spacing: -0.025em;
}

.traditional-page__heading p,
.traditional-page__status span {
	color: var(--muted);
	font: 0.75rem/1.45 ui-sans-serif, system-ui, sans-serif;
}

.traditional-page__heading p {
	margin: 0;
}

.traditional-page__board {
	position: relative;
	width: 100%;
}

.traditional-page__board[aria-busy="true"] .minefield-view {
	filter: saturate(0.65);
}

.traditional-page__loading {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 0.5rem;
	background: color-mix(in srgb, var(--paper) 72%, transparent);
	color: var(--ink);
	font: 700 .875rem ui-sans-serif, system-ui, sans-serif;
	pointer-events: none;
}

.traditional-page__spinner {
	width: 1rem;
	height: 1rem;
	border: 2px solid var(--line);
	border-top-color: var(--focus);
	border-radius: 50%;
	animation: traditional-page-spin 700ms linear infinite;
}

.traditional-page__status {
	min-height: 3.25rem;
	padding-top: .625rem;
	border-top: 1px solid var(--line);
}
.traditional-page__status strong {
	display: block;
	font: 700 .875rem/1.35 ui-sans-serif, system-ui, sans-serif;
}
.traditional-page__status span {
	display: block;
	margin-top: 2px;
	font: .6875rem/1.35 ui-sans-serif, system-ui, sans-serif;
}

.traditional-page__error {
	margin: 0;
	padding: 0.625rem;
	border: 1px solid var(--danger);
	color: var(--danger);
	font: 0.75rem/1.4 ui-sans-serif, system-ui, sans-serif;
}

.traditional-page__actions {
	display: flex;
	justify-content: flex-end;
}

.traditional-page__actions button {
	width: 100%;
	min-height: 2.75rem;
	padding: 0.625rem 0.875rem;
	border: 1px solid var(--ink);
	background: var(--ink);
	color: var(--paper);
	font: 700 .875rem ui-sans-serif, system-ui, sans-serif;
	cursor: pointer;
}

.traditional-page__actions button:hover:not(:disabled) {
	background: color-mix(in srgb, var(--ink) 85%, var(--paper));
}

.traditional-page__actions button:disabled {
	cursor: default;
	opacity: 0.45;
}

.traditional-page__actions button:focus-visible {
	outline: 2px solid var(--focus);
	outline-offset: 2px;
}

@keyframes traditional-page-spin {
	to {
		transform: rotate(1turn);
	}
}

@media (prefers-reduced-motion: reduce) {
	.traditional-page__spinner { animation-duration: 1400ms; }
}
</style>
