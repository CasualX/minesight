<link rel="component" href="../play-page.vue.css">
<link rel="component" href="../minefield.vue.js">
<link rel="component" href="../editor-solver.vue.js">
<link rel="component" href="../minefield-view.vue">
<link rel="component" href="../components/notification-toast.vue">
<link rel="component" href="../components/hold-button.vue">
<link rel="component" href="../puzzle.vue.js">
<link rel="component" href="../storage.vue.js">

<script>
const EDITOR_TOOLS = Object.freeze([
	CellState.COVERED,
	CellState.MASKED,
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

const EDITOR_TOOL_TEXT = Object.freeze({
	[CellState.COVERED]: '□',
	[CellState.MASKED]: '×',
	[CellState.FLAGGED]: '⚑',
	[CellState.CLUE_0]: '0',
	[CellState.CLUE_1]: '1',
	[CellState.CLUE_2]: '2',
	[CellState.CLUE_3]: '3',
	[CellState.CLUE_4]: '4',
	[CellState.CLUE_5]: '5',
	[CellState.CLUE_6]: '6',
	[CellState.CLUE_7]: '7',
	[CellState.CLUE_8]: '8',
});

const EDITOR_KEY_STATES = Object.freeze({
	'0': CellState.CLUE_0,
	'1': CellState.CLUE_1,
	'2': CellState.CLUE_2,
	'3': CellState.CLUE_3,
	'4': CellState.CLUE_4,
	'5': CellState.CLUE_5,
	'6': CellState.CLUE_6,
	'7': CellState.CLUE_7,
	'8': CellState.CLUE_8,
	'f': CellState.FLAGGED,
	'm': CellState.MASKED,
	'u': CellState.COVERED,
	'delete': CellState.COVERED,
	'backspace': CellState.COVERED,
});

const EDITOR_STORAGE_KEY = 'editor';
const EDITOR_BOARD_WIDTH = 8;
const EDITOR_BOARD_HEIGHT = 8;
const EDITOR_BOARD_SIZE = EDITOR_BOARD_WIDTH * EDITOR_BOARD_HEIGHT;

function restoreEditorBoard() {
	let stored = MinesightStorage.get(EDITOR_STORAGE_KEY, undefined);
	let valid =
		stored?.width === EDITOR_BOARD_WIDTH &&
		stored?.height === EDITOR_BOARD_HEIGHT &&
		Array.isArray(stored.board) &&
		stored.board.length === EDITOR_BOARD_SIZE &&
		stored.board.every(state => EDITOR_TOOLS.includes(state));
	if (!valid) {
		return Array(EDITOR_BOARD_SIZE).fill(CellState.COVERED);
	}
	return stored.board.slice();
}

const EditorPage = Vue.defineComponent({
	template: '#editor-page',
	components: { MinefieldView, NotificationToast, HoldButton },
	data() {
		return {
			tools: EDITOR_TOOLS,
			toolText: EDITOR_TOOL_TEXT,
			interactiveStates: new Set(CELL_STATES),
			board: restoreEditorBoard(),
			tool: CellState.CLUE_1,
			history: /** @type {string[][]} */ ([]),
			analysis: /** @type {ReturnType<typeof analyzeEditorBoard> | undefined} */ (undefined),
			showSolution: false,
			painting: false,
			pendingPaint: /** @type {{ event: PointerEvent, index: number } | undefined} */ (undefined),
			paintSnapshot: /** @type {string[]} */ ([]),
			shareMessage: '',
		};
	},
	computed: {
		cells() {
			let forcedMine = new Set(this.analysis?.forcedMine ?? []);
			let forcedSafe = new Set(this.analysis?.forcedSafe ?? []);
			return this.board.map((state, index) => {
				if (forcedMine.has(index)) {
					return CellState.MARKED_MINE;
				}
				if (forcedSafe.has(index)) {
					return CellState.MARKED_SAFE;
				}
				if (this.showSolution && state === CellState.COVERED && this.analysis && !this.analysis.contradiction && this.analysis.solution[index]) {
					return CellState.EXPOSED_MINE;
				}
				return state;
			});
		},
		forcedCount() {
			return (this.analysis?.forcedMine.length ?? 0) + (this.analysis?.forcedSafe.length ?? 0);
		},
		canShare() {
			return Boolean(this.analysis && !this.analysis.contradiction && this.forcedCount > 0);
		},
		canClear() {
			return this.board.some((cell) => cell !== CellState.COVERED);
		},
		primaryActionLabel() {
			return this.canShare ? 'Share puzzle' : 'Analyze board';
		},
		statusTitle() {
			if (!this.analysis) {
				return 'Ready to analyze';
			}
			if (this.analysis.contradiction) {
				return 'Contradiction';
			}
			if (this.analysis.coveredCount === 0) {
				return 'Nothing to solve';
			}
			if (this.analysis.unique) {
				return 'Unique solution';
			}
			if (this.forcedCount) {
				return `${this.forcedCount} forced ${this.forcedCount === 1 ? 'cell' : 'cells'}`;
			}
			return 'No forced cells';
		},
		statusMessage() {
			if (!this.analysis) {
				return 'Add clues or flags, then analyze the board.';
			}
			if (this.analysis.contradiction) {
				return 'No mine layout can satisfy every clue and flag.';
			}
			if (this.analysis.coveredCount === 0) {
				return 'Add at least one covered cell to create a puzzle.';
			}
			let mines = this.analysis.forcedMine.length;
			let safe = this.analysis.forcedSafe.length;
			if (this.analysis.unique) {
				return `Every covered cell is determined: ${mines} mined and ${safe} safe.`;
			}
			if (this.forcedCount) {
				return `${mines} must be mined and ${safe} must be safe. Other cells remain ambiguous.`;
			}
			return 'The clues are consistent, but no covered cell is currently forced.';
		},
	},
	methods: {
		saveBoard() {
			MinesightStorage.set(EDITOR_STORAGE_KEY, {
				width: EDITOR_BOARD_WIDTH,
				height: EDITOR_BOARD_HEIGHT,
				board: this.board.slice(),
			});
		},
		setCell(index, state, record = true) {
			state ??= this.tool;
			if (this.board[index] === state) {
				return;
			}
			if (record) {
				this.history.push(this.board.slice());
				if (this.history.length > 100) {
					this.history.shift();
				}
			}
			this.board[index] = state;
			this.analysis = undefined;
			this.showSolution = false;
			this.shareMessage = '';
			this.saveBoard();
		},
		cellAction({ action, index }) {
			if (action === 'alternate') {
				this.pendingPaint = undefined;
				this.stopPaint();
				this.tool = this.board[index];
			}
			else {
				this.setCell(index);
			}
		},
		startPaintAt(event) {
			if (event.button !== 0 || !event.isPrimary) {
				return;
			}
			let cell = event.target.closest('[data-cell-index]');
			if (!cell) {
				return;
			}
			if (event.pointerType !== 'mouse') {
				this.pendingPaint = { event, index: Number(cell.dataset.cellIndex) };
				cell.focus();
				return;
			}
			// Mouse painting starts immediately.
			event.preventDefault();
			event.stopPropagation();
			cell.focus();
			this.startPaint(event, Number(cell.dataset.cellIndex));
		},
		handleBoardClick(event) {
			// Pointer presses already painted the stroke; allow assistive clicks through.
			if (event.detail > 0) {
				event.preventDefault();
				event.stopPropagation();
			}
		},
		startPaint(event, index) {
			if (event.button !== 0) {
				return;
			}
			this.painting = true;
			this.paintSnapshot = this.board.slice();
			this.setCell(index, this.tool, false);
		},
		paintAt(event) {
			if (this.pendingPaint) {
				let start = this.pendingPaint;
				if (event.pointerId !== start.event.pointerId || Math.hypot(event.clientX - start.event.clientX, event.clientY - start.event.clientY) <= 10) {
					return;
				}
				this.pendingPaint = undefined;
				this.startPaint(start.event, start.index);
			}
			if (!this.painting) {
				return;
			}
			let cell = /** @type {HTMLElement | null} */ (
				document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-cell-index]') ?? null
			);
			if (cell && this.$el.contains(cell)) {
				this.paint(Number(cell.dataset.cellIndex));
			}
		},
		paint(index) {
			if (this.painting) {
				this.setCell(index, this.tool, false);
			}
		},
		stopPaint(event) {
			if (this.pendingPaint) {
				if (event && event.pointerId !== this.pendingPaint.event.pointerId) {
					return;
				}
				let pending = this.pendingPaint;
				this.pendingPaint = undefined;
				if (event?.type === 'pointerup') {
					this.setCell(pending.index);
				}
			}
			if (this.painting && this.paintSnapshot.some((cell, index) => cell !== this.board[index])) {
				this.history.push(this.paintSnapshot);
				if (this.history.length > 100) this.history.shift();
			}
			this.painting = false;
		},
		keydown(event) {
			let cell = event.target.closest('[data-cell-index]');
			if (!cell) {
				return;
			}
			let state = EDITOR_KEY_STATES[event.key.toLowerCase()];
			if (state) {
				event.preventDefault();
				event.stopPropagation();
				this.setCell(Number(cell.dataset.cellIndex), state);
			}
		},
		analyze() {
			this.analysis = analyzeEditorBoard(this.board, 8, 8);
			this.showSolution = false;
		},
		primaryAction() {
			return this.canShare ? this.share() : this.analyze();
		},
		undo() {
			let previous = this.history.pop();
			if (previous) {
				this.board = previous;
				this.analysis = undefined;
				this.showSolution = false;
				this.shareMessage = '';
				this.saveBoard();
			}
		},
		clear() {
			if (this.board.every((cell) => cell === CellState.COVERED)) {
				return;
			}
			this.history.push(this.board.slice());
			this.board = Array(64).fill(CellState.COVERED);
			this.analysis = undefined;
			this.showSolution = false;
			this.shareMessage = '';
			this.saveBoard();
		},
		async share() {
			if (!this.canShare) {
				return;
			}
			let analysis = this.analysis;
			if (!analysis) {
				return;
			}
			this.shareMessage = '';
			try {
				this.shareMessage = await sharePuzzleLink(createEditorPuzzle(this.board, analysis, 8, 8));
			}
			catch {
				this.shareMessage = 'The puzzle link could not be shared.';
			}
		},
	},
	mounted() {
		window.addEventListener('pointerup', this.stopPaint);
		window.addEventListener('pointercancel', this.stopPaint);
	},
	beforeUnmount() {
		window.removeEventListener('pointerup', this.stopPaint);
		window.removeEventListener('pointercancel', this.stopPaint);
		this.saveBoard();
	},
});
</script>

<template id="editor-page">
	<main class="play-page editor-page" aria-labelledby="editor-title">
		<header class="play-page__heading editor-page__intro"><div><h1 id="editor-title">Build a position</h1><p>Choose a cell state, then tap or paint the board. Right-click or touch and hold to sample a cell. Flags are treated as known mines.</p></div></header>
		<div class="editor-page__palette" role="toolbar" aria-label="Cell state">
			<button class="control-feedback" v-for="choice in tools" :key="choice" type="button" :class="{ selected: tool === choice }" :data-state="choice" :aria-pressed="tool === choice" :title="choice" @click="tool = choice"><span aria-hidden="true">{{ toolText[choice] }}</span><small :data-number="toolText[choice]">{{ choice }}</small></button>
		</div>
		<div class="editor-page__board" data-feedback-board
			@pointerdown.capture="startPaintAt"
			@pointermove="paintAt"
			@click.capture="handleBoardClick"
			@keydown.capture="keydown"
		>
			<minefield-view :width="8" :height="8" :cells="cells" :interactive="interactiveStates" @cell-action="cellAction"></minefield-view>
		</div>
		<div class="editor-page__actions">
			<button class="control-feedback" type="button" :disabled="!history.length" @click="undo">Undo</button>
			<hold-button label="Clear" :disabled="!canClear" @confirm="clear"></hold-button>
			<button type="button" class="control-feedback editor-page__primary-action" @click="primaryAction">{{ primaryActionLabel }}</button>
		</div>
		<div class="editor-page__status" :class="{ 'editor-page__status--contradiction': analysis?.contradiction }" role="status" aria-live="polite">
			<div class="editor-page__status-copy"><strong>{{ statusTitle }}</strong><span>{{ statusMessage }}</span></div>
			<label v-if="analysis && !analysis.contradiction && !analysis.unique" class="editor-page__solution-toggle">
				<span>Example solution</span>
				<input type="checkbox" v-model="showSolution" aria-label="Show example solution">
				<span class="editor-page__switch-track" aria-hidden="true"></span>
			</label>
		</div>
		<notification-toast :message="shareMessage"></notification-toast>
	</main>
</template>

<style>
.editor-page__palette {
	display: grid;
	grid-template-columns: repeat(6, minmax(0, 1fr));
	gap: .3125rem;
}
.editor-page__palette button {
	display: grid;
	place-items: center;
	min-width: 0;
	min-height: 3rem;
	padding: .25rem .125rem;
	border: 1px solid var(--line);
	background: var(--paper);
	color: var(--ink);
	cursor: pointer;
}
.editor-page__palette button > span {
	font: 800 1.0625rem/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.editor-page__palette small {
	margin-top: .1875rem;
	color: var(--muted);
	font-size: .5rem;
	line-height: 1;
	text-transform: capitalize;
}
.editor-page__palette button[data-state^="clue-"] small,
.editor-page__palette button[data-state="flagged"] small {
	font-size: 0;
}
.editor-page__palette button[data-state^="clue-"] small::before {
	font-size: .5rem;
	content: 'Clue ';
}
.editor-page__palette button[data-state^="clue-"] small::after {
	font-size: .5rem;
	content: attr(data-number);
}
.editor-page__palette button[data-state="flagged"] small::after {
	font-size: .5rem;
	content: 'Flag';
}
.editor-page__palette button.selected {
	border-color: var(--focus);
	background: var(--solution);
	box-shadow: inset 0 0 0 1px var(--focus);
}
.editor-page__palette button.selected small {
	color: var(--solution-ink);
}
.editor-page__palette button[data-state="flagged"] {
	color: var(--flag-ink);
}
.editor-page__palette button[data-state="masked"] {
	color: var(--muted);
}
.editor-page__board {
	width: 100%;
	border: 1px solid var(--ink);
	touch-action: none;
}
.editor-page__board .minefield-view__cell--masked {
	cursor: pointer;
}
.editor-page__board .minefield-view__cell--exposed-mine {
	background: var(--solution);
	color: var(--solution-ink);
	box-shadow: inset 0 0 0 1px var(--solution-ink);
}
.editor-page__actions {
	display: grid;
	grid-template-columns: 1fr 1fr 2fr;
	gap: .4375rem;
}
.editor-page__actions button {
	min-height: 2.75rem;
	padding: 0 .625rem;
	border: 1px solid var(--line);
	background: var(--paper);
	color: var(--ink);
	font: 700 .72rem ui-sans-serif, system-ui, sans-serif;
}
.editor-page__actions .editor-page__primary-action {
	border-color: var(--ink);
	background: var(--ink);
	color: var(--paper);
}
.editor-page__actions button:disabled {
	opacity: .45;
}
.editor-page__status {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	align-items: center;
	gap: .625rem;
	min-height: 3.625rem;
	padding-top: .625rem;
	border-top: 1px solid var(--line);
	font-family: ui-sans-serif, system-ui, sans-serif;
}
.editor-page__status-copy strong,
.editor-page__status-copy span {
	display: block;
}
.editor-page__status-copy strong {
	font-size: .875rem;
}
.editor-page__status-copy span {
	margin-top: .125rem;
	color: var(--muted);
	font-size: .6875rem;
	line-height: 1.4;
}
.editor-page__status--contradiction strong {
	color: var(--danger-ink);
}
.editor-page__solution-toggle {
	position: relative;
	display: flex;
	align-items: center;
	gap: .5rem;
	font: .75rem ui-sans-serif, system-ui, sans-serif;
	cursor: pointer;
}
.editor-page__solution-toggle input {
	position: absolute;
	width: 1px;
	height: 1px;
	opacity: 0;
}
.editor-page__switch-track {
	position: relative;
	width: 2.25rem;
	height: 1.25rem;
	border: 1px solid var(--line);
	border-radius: 999px;
	background: var(--covered);
}
.editor-page__switch-track::after {
	position: absolute;
	top: .125rem;
	left: .125rem;
	width: .875rem;
	height: .875rem;
	border-radius: 50%;
	background: var(--ink);
	content: '';
	transition: transform 120ms ease;
}
.editor-page__solution-toggle input:checked + .editor-page__switch-track {
	background: var(--solution);
}
.editor-page__solution-toggle input:checked + .editor-page__switch-track::after {
	transform: translateX(1rem);
}
.editor-page__solution-toggle input:focus-visible + .editor-page__switch-track {
	outline: 2px solid var(--focus);
	outline-offset: 2px;
}
@media (max-width: 365px) {
	.editor-page__palette {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}
	.editor-page__actions {
		grid-template-columns: repeat(2, 1fr);
	}
	.editor-page__primary-action {
		grid-column: 1 / -1;
	}
	.editor-page__status {
		grid-template-columns: 1fr;
	}
}
@media (prefers-reduced-motion: reduce) {
	.editor-page__switch-track::after {
		transition: none;
	}
}
</style>
