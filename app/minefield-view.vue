<link rel="component" href="minefield.vue.js">
<link rel="component" href="polyfill/context-menu.vue.js">

<script>
const MINEFIELD_FOCUS_MOVES = Object.freeze({
	ArrowLeft: Object.freeze([-1, 0]),
	ArrowRight: Object.freeze([1, 0]),
	ArrowUp: Object.freeze([0, -1]),
	ArrowDown: Object.freeze([0, 1]),
});

function inputAction(shifted, action) {
	if (!shifted) return action;
	return action === 'primary' ? 'alternate' : 'primary';
}

const MinefieldView = Vue.defineComponent({
	template: '#minefield-view',
	expose: ['getCellRect'],
	props: {
		width: {
			type: Number,
			required: true,
			validator: (value) => Number.isInteger(value) && value > 0,
		},
		height: {
			type: Number,
			required: true,
			validator: (value) => Number.isInteger(value) && value > 0,
		},
		cells: {
			type: Array,
			required: true,
			validator: (cells) => Array.from(cells).every(isCellState),
		},
		interactive: {
			type: Set,
			required: true,
			validator: (states) => Array.from(states).every(isCellState),
		},
		disabled: Boolean,
	},
	emits: ['cell-action'],
	data() {
		return {
			focusIndex: 0,
			removeContextMenuPolyfill: /** @type {(() => void) | undefined} */ (undefined),
		};
	},
	computed: {
		viewCells() {
			return Array.from({ length: this.width * this.height }, (_, index) => {
				let state = this.cells[index];
				return isCellState(state) ? state : INVALID_CELL_STATE;
			});
		},
		viewRows() {
			return Array.from({ length: this.height }, (_, row) => {
				let start = row * this.width;
				return this.viewCells.slice(start, start + this.width);
			});
		},
	},
	watch: {
		viewCells() {
			this.ensureFocusableCell();
		},
		disabled() {
			this.ensureFocusableCell();
		},
		interactive: {
			handler() {
				this.ensureFocusableCell();
			},
			deep: true,
		},
	},
	mounted() {
		this.ensureFocusableCell();
		this.removeContextMenuPolyfill = installLongPressContextMenuPolyfill(this.$el, {
			selector: '.minefield-view__cell',
		});
	},
	beforeUnmount() {
		this.removeContextMenuPolyfill?.();
	},
	methods: {
		isInteractive(index) {
			return !this.disabled
				&& this.interactive.has(this.viewCells[index]);
		},
		cellClass(state) {
			return `minefield-view__cell--${state}`;
		},
		cellMetadata(state) {
			return getCellStateMetadata(state);
		},
		cellLabel(state, index) {
			let position = `Row ${Math.floor(index / this.width) + 1}, column ${(index % this.width) + 1}`;
			return `${position}, ${getCellStateMetadata(state).description}`;
		},
		tabIndex(index) {
			return this.isInteractive(index) && index === this.focusIndex ? 0 : -1;
		},
		ensureFocusableCell() {
			if (this.isInteractive(this.focusIndex)) return;
			let first = this.viewCells.findIndex((_, index) => this.isInteractive(index));
			this.focusIndex = first < 0 ? 0 : first;
		},
		focusCell(index) {
			if (!this.isInteractive(index)) return;
			this.focusIndex = index;
			this.$nextTick(() => this.$el.querySelector(`[data-cell-index="${index}"]`)?.focus());
		},
		getCellRect(index, relativeTo) {
			relativeTo ??= this.$el;
			let cell = this.$el.querySelector(`[data-cell-index="${index}"]`);
			if (!cell) return undefined;

			let cellRect = cell.getBoundingClientRect();
			let originRect = relativeTo?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
			let left = cellRect.left - originRect.left;
			let top = cellRect.top - originRect.top;
			return {
				left,
				top,
				right: left + cellRect.width,
				bottom: top + cellRect.height,
				width: cellRect.width,
				height: cellRect.height,
				centerX: left + cellRect.width / 2,
				centerY: top + cellRect.height / 2,
			};
		},
		moveFocus(index, columnDelta, rowDelta) {
			let column = index % this.width;
			let row = Math.floor(index / this.width);
			let nextColumn = column + columnDelta;
			let nextRow = row + rowDelta;

			while (nextColumn >= 0 && nextColumn < this.width && nextRow >= 0 && nextRow < this.height) {
				let nextIndex = nextRow * this.width + nextColumn;
				if (this.isInteractive(nextIndex)) {
					this.focusCell(nextIndex);
					return;
				}
				nextColumn += columnDelta;
				nextRow += rowDelta;
			}
		},
		focusEdge(fromEnd) {
			let index = fromEnd ? this.viewCells.length - 1 : 0;
			let step = fromEnd ? -1 : 1;
			while (index >= 0 && index < this.viewCells.length) {
				if (this.isInteractive(index)) {
					this.focusCell(index);
					return;
				}
				index += step;
			}
		},
		emitAction(action, index, source) {
			if (!this.isInteractive(index)) return;
			this.$emit('cell-action', {
				action,
				index,
				row: Math.floor(index / this.width),
				column: index % this.width,
				source,
			});
		},
		handleClick(event, index) {
			this.emitAction(inputAction(event.shiftKey, 'primary'), index, 'pointer');
		},
		handleContextMenu(event, index) {
			this.emitAction(
				inputAction(event.shiftKey, 'alternate'),
				index,
				event.minefieldInputSource ?? 'pointer',
			);
		},
		handleKeydown(event, index) {
			if (MINEFIELD_FOCUS_MOVES[event.key]) {
				event.preventDefault();
				this.moveFocus(index, ...MINEFIELD_FOCUS_MOVES[event.key]);
			} else if (event.key === 'Home' || event.key === 'End') {
				event.preventDefault();
				this.focusEdge(event.key === 'End');
			} else if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				if (!event.repeat) this.emitAction(inputAction(event.shiftKey, 'primary'), index, 'keyboard');
			} else if (event.key.toLowerCase() === 'f') {
				event.preventDefault();
				if (!event.repeat) this.emitAction(inputAction(event.shiftKey, 'alternate'), index, 'keyboard');
			}
		},
	},
});
</script>

<template id="minefield-view">
	<div
		class="minefield-view"
		:class="{ 'minefield-view--disabled': disabled }"
		:style="{ '--minefield-columns': width }"
		role="grid"
		aria-label="Minefield"
		:aria-rowcount="height"
		:aria-colcount="width"
		data-feedback-minefield
	>
		<div
			v-for="(row, rowIndex) in viewRows"
			:key="rowIndex"
			class="minefield-view__row"
			role="row"
			:aria-rowindex="rowIndex + 1"
		>
			<div
				v-for="(state, columnIndex) in row"
				:key="columnIndex"
				class="minefield-view__gridcell"
				role="gridcell"
				:aria-colindex="columnIndex + 1"
			>
				<button
					type="button"
					class="minefield-view__cell"
					:class="[cellClass(state), { 'minefield-view__cell--interactive': isInteractive(rowIndex * width + columnIndex) }]"
					:data-cell-index="rowIndex * width + columnIndex"
					:aria-label="cellLabel(state, rowIndex * width + columnIndex)"
					:disabled="!isInteractive(rowIndex * width + columnIndex)"
					:tabindex="tabIndex(rowIndex * width + columnIndex)"
					@focus="focusIndex = rowIndex * width + columnIndex"
					@click="handleClick($event, rowIndex * width + columnIndex)"
					@contextmenu.prevent="handleContextMenu($event, rowIndex * width + columnIndex)"
					@keydown="handleKeydown($event, rowIndex * width + columnIndex)"
				>
					<span class="minefield-view__symbol" aria-hidden="true">{{ cellMetadata(state).symbol }}</span>
				</button>
			</div>
		</div>
	</div>
</template>

<style>
.minefield-view {
	--minefield-revealed: var(--revealed, #eceee9);
	--minefield-ink: var(--ink, #111);
	--minefield-revealed-line: var(--revealed-line, #a5a8a1);
	--minefield-focus: var(--focus, #2457a6);
	--minefield-covered: var(--covered, #d4d5d0);
	--minefield-covered-hover: var(--covered-hover, #c9cbc5);
	--minefield-raised-light: var(--covered-raised-light, rgb(255 255 255 / 58%));
	--minefield-raised-shadow: var(--covered-raised-shadow, rgb(0 0 0 / 28%));
	--minefield-masked: var(--inactive, #aaaca6);
	--minefield-hint: var(--hint, #dfd39f);
	--minefield-hint-hover: var(--hint-hover, #d5c88f);
	--minefield-hint-ink: var(--hint-ink, #5b522b);
	--minefield-hint-line: var(--hint-line, #9b8c52);
	--minefield-danger: var(--danger, #d7574f);
	--minefield-on-danger: var(--on-danger, #fff);
	--minefield-incorrect: var(--incorrect, #c77e78);
	--minefield-incorrect-line: var(--incorrect-line, #8f4944);
	--minefield-invalid: #d6007f;
	--minefield-marked-safe: var(--marked-safe, #dce9de);
	--minefield-marked-safe-hover: var(--marked-safe-hover, #d1e0d4);
	--minefield-marked-safe-ink: var(--marked-safe-ink, #23472c);
	--minefield-marked-safe-line: var(--marked-safe-line, #879f8c);
	--minefield-marked-mine: var(--marked-mine, #d2a4a0);
	--minefield-marked-mine-hover: var(--marked-mine-hover, #c99590);
	--minefield-marked-mine-ink: var(--marked-mine-ink, #5d2925);
	--minefield-marked-mine-line: var(--marked-mine-line, #9d6762);
	--minefield-mine: var(--mine, #f3d5d2);
	--minefield-mine-ink: var(--mine-ink, #8f302b);
	--minefield-flag-ink: var(--flag-ink, #8a361f);
	--minefield-clue-1: var(--clue-1, #2055a5);
	--minefield-clue-2: var(--clue-2, #317441);
	--minefield-clue-3: var(--clue-3, #a33c32);
	--minefield-clue-4: var(--clue-4, #6941a5);
	--minefield-clue-5: var(--clue-5, #7a2828);
	display: flex;
	width: 100%;
	container-type: inline-size;
	flex-direction: column;
	margin: 0;
	touch-action: manipulation;
	user-select: none;
	-webkit-user-select: none;
}

.minefield-view__row {
	display: grid;
	grid-template-columns: repeat(var(--minefield-columns), minmax(0, 1fr));
}

.minefield-view__gridcell {
	min-width: 0;
}

.minefield-view__cell {
	position: relative;
	display: grid;
	width: 100%;
	place-items: center;
	min-width: 0;
	aspect-ratio: 1;
	padding: 0;
	border: 0;
	border-radius: 0;
	background: var(--minefield-covered);
	color: var(--minefield-ink);
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: clamp(12px, calc(44vw / var(--minefield-columns)), 23px);
	font-size: clamp(10px, calc(44cqi / var(--minefield-columns)), 23px);
	font-weight: 800;
	line-height: 1;
	cursor: default;
	touch-action: manipulation;
	-webkit-touch-callout: none;
	transition: background-color 160ms ease, color 160ms ease, box-shadow 160ms ease;
}

.minefield-view__cell::after {
	position: absolute;
	inset: 0;
	box-shadow:
		inset 2px 2px 0 var(--minefield-raised-light),
		inset -2px -2px 0 var(--minefield-raised-shadow);
	content: '';
	pointer-events: none;
	transition: opacity 160ms ease;
}

.minefield-view__symbol {
	display: block;
	opacity: 1;
	transform: scale(1);
	transition: opacity 160ms ease, transform 160ms ease;
}

.minefield-view__cell--covered .minefield-view__symbol,
.minefield-view__cell--masked .minefield-view__symbol {
	opacity: 0;
	transform: scale(0.72);
}

.minefield-view__cell--masked {
	background: var(--minefield-masked);
	cursor: default;
}

.minefield-view__cell[class*="minefield-view__cell--clue-"]::after,
.minefield-view__cell--marked-safe::after,
.minefield-view__cell--detonated-mine::after,
.minefield-view__cell--invalid::after {
	opacity: 0;
}

.minefield-view__cell[class*="minefield-view__cell--clue-"] {
	border: 1px solid var(--minefield-revealed-line);
	background: var(--minefield-revealed);
	cursor: default;
}

.minefield-view__cell--clue-1 { color: var(--minefield-clue-1); }
.minefield-view__cell--clue-2 { color: var(--minefield-clue-2); }
.minefield-view__cell--clue-3 { color: var(--minefield-clue-3); }
.minefield-view__cell--clue-4 { color: var(--minefield-clue-4); }
.minefield-view__cell--clue-5 { color: var(--minefield-clue-5); }
.minefield-view__cell--clue-6 { color: var(--minefield-clue-5); }

.minefield-view__cell--flagged {
	color: var(--minefield-flag-ink);
}

.minefield-view__cell--marked-mine {
	background: var(--minefield-marked-mine);
	color: var(--minefield-marked-mine-ink);
	box-shadow: inset 0 0 0 1px var(--minefield-marked-mine-line);
}

.minefield-view__cell--marked-safe {
	border: 1px solid var(--minefield-marked-safe-line);
	background: var(--minefield-marked-safe);
	color: var(--minefield-marked-safe-ink);
	box-shadow: none;
}

.minefield-view__cell--hint {
	background: var(--minefield-hint);
	color: var(--minefield-hint-ink);
	box-shadow: inset 0 0 0 1px var(--minefield-hint-line);
	animation: minefield-hint-reveal 180ms ease-out;
}

.minefield-view__cell--misflagged {
	background: var(--minefield-incorrect);
	color: var(--minefield-on-danger);
	box-shadow: inset 0 0 0 2px var(--minefield-incorrect-line);
}

.minefield-view__cell--exposed-mine {
	background: var(--minefield-mine);
	color: var(--minefield-mine-ink);
}

.minefield-view__cell--detonated-mine {
	background: var(--minefield-danger);
	color: var(--minefield-on-danger);
	box-shadow: none;
}

.minefield-view__cell--invalid {
	background: repeating-linear-gradient(
		135deg,
		var(--minefield-invalid) 0 6px,
		#fff 6px 9px
	);
	color: #fff;
	text-shadow: 0 1px 2px #000;
}

.minefield-view__cell--interactive {
	cursor: pointer;
}

.minefield-view__cell--covered:hover:not(:disabled),
.minefield-view__cell--flagged:hover:not(:disabled) {
	background: var(--minefield-covered-hover);
}

.minefield-view__cell--marked-safe:hover:not(:disabled) {
	background: var(--minefield-marked-safe-hover);
}

.minefield-view__cell--marked-mine:hover:not(:disabled) {
	background: var(--minefield-marked-mine-hover);
}

.minefield-view__cell--hint:hover:not(:disabled) {
	background: var(--minefield-hint-hover);
}

.minefield-view__cell--covered:active:not(:disabled),
.minefield-view__cell--flagged:active:not(:disabled),
.minefield-view__cell--marked-safe:active:not(:disabled),
.minefield-view__cell--marked-mine:active:not(:disabled),
.minefield-view__cell--hint:active:not(:disabled) {
	filter: brightness(0.95);
}

.minefield-view__cell:focus-visible {
	z-index: 2;
	outline: 3px solid transparent;
	outline-offset: -3px;
}

.minefield-view__cell:focus-visible::after {
	opacity: 1;
	box-shadow: inset 0 0 0 3px var(--minefield-focus);
}

.minefield-view__cell:disabled {
	opacity: 1;
}

.minefield-view--disabled .minefield-view__cell {
	cursor: default;
}

@keyframes minefield-hint-reveal {
	from {
		background: var(--minefield-covered);
		color: transparent;
		box-shadow: inset 0 0 0 1px transparent;
	}
}

@media (prefers-reduced-motion: reduce) {
	.minefield-view__cell,
	.minefield-view__cell::after,
	.minefield-view__symbol {
		transition-duration: 0.01ms;
	}
}
</style>
