<link rel="component" href="../minefield-view.vue">
<link rel="component" href="../scratch-pad.vue">
<link rel="component" href="../minefield.vue.js">

<script>
const TEST_CELL_STATES = CELL_STATES;
const TEST_SCRATCH_COLORS = Object.freeze([
	Object.freeze({ key: 'graphite', label: 'Graphite' }),
	Object.freeze({ key: 'blue', label: 'Blue' }),
	Object.freeze({ key: 'red', label: 'Red' }),
]);

const TestPage = Vue.defineComponent({
	template: '#test-page',
	components: {
		MinefieldView,
		ScratchPad,
	},
	data() {
		return {
			cells: Array(64).fill(CellState.COVERED),
			interactiveStates: new Set(CELL_STATES),
			scratchActive: false,
			scratchTool: 'pencil',
			scratchColor: TEST_SCRATCH_COLORS[0].key,
			scratchColors: TEST_SCRATCH_COLORS,
			scratchStrokeCount: 0,
		};
	},
	methods: {
		cycleCell({ action, index }) {
			let current = TEST_CELL_STATES.indexOf(this.cells[index]);
			let direction = action === 'alternate' ? -1 : 1;
			let next = (current + direction + TEST_CELL_STATES.length) % TEST_CELL_STATES.length;
			this.cells[index] = TEST_CELL_STATES[next];
		},
		toggleScratchPad() {
			this.scratchActive = !this.scratchActive;
			if (this.scratchActive && this.scratchTool === 'eraser') {
				this.selectScratchColor(TEST_SCRATCH_COLORS[0].key);
			}
		},
		selectScratchColor(color) {
			this.scratchColor = color;
			this.scratchTool = 'pencil';
		},
		clearScratchPad() {
			this.$refs.scratchPad?.clear();
		},
		updateScratchState({ strokeCount }) {
			this.scratchStrokeCount = strokeCount;
		},
	},
});
</script>

<template id="test-page">
	<main class="test-page" aria-labelledby="test-page-title">
		<div class="test-page__heading">
			<h1 id="test-page-title">Scratch pad overlay</h1>
			<p v-if="scratchActive">Draw over the board. A tap leaves a check, right-click leaves a flag, and the eraser removes whole strokes.</p>
			<p v-else>Select cells normally, or open Notes to draw on the separate scratch-pad overlay.</p>
		</div>

		<div class="test-page__board" :class="{ 'test-page__board--scratch-active': scratchActive }">
			<minefield-view
				class="test-page__minefield"
				:width="8"
				:height="8"
				:cells="cells"
				:interactive="interactiveStates"
				:disabled="scratchActive"
				label="Minefield state test"
				@cell-action="cycleCell"
			></minefield-view>
			<scratch-pad
				id="test-scratch-pad"
				ref="scratchPad"
				:active="scratchActive"
				v-model:tool="scratchTool"
				v-model:color="scratchColor"
				@change="updateScratchState"
			></scratch-pad>
		</div>

		<div
			class="test-page__scratch-tools"
			:class="{ 'test-page__scratch-tools--active': scratchActive }"
			role="toolbar"
			aria-label="Scratch pad controls"
		>
			<button
				type="button"
				class="control-feedback test-page__scratch-toggle"
				:class="{ 'test-page__scratch-toggle--active': scratchActive }"
				:aria-pressed="scratchActive"
				aria-controls="test-scratch-pad"
				:title="scratchActive ? 'Finish drawing' : 'Draw notes over the board'"
				@click="toggleScratchPad"
			>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.7-10.7a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z"></path><path d="m14.8 6.5 3 3M8.2 19l-3-3"></path></svg>
				<span>{{ scratchActive ? 'Done' : 'Notes' }}</span>
			</button>

			<div v-show="scratchActive" class="test-page__scratch-options">
				<button
					v-for="color in scratchColors"
					:key="color.key"
					type="button"
					class="control-feedback test-page__scratch-color"
					:class="`test-page__scratch-color--${color.key}`"
					:aria-label="`${color.label} pencil`"
					:aria-pressed="scratchTool === 'pencil' && scratchColor === color.key"
					:title="color.label"
					@click="selectScratchColor(color.key)"
				></button>

				<button
					type="button"
					class="control-feedback test-page__scratch-eraser"
					:class="{ 'test-page__scratch-eraser--active': scratchTool === 'eraser' }"
					:aria-pressed="scratchTool === 'eraser'"
					aria-label="Erase whole strokes"
					title="Erase whole strokes"
					@click="scratchTool = 'eraser'"
				>
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4.5 15.5 8.8-8.8a2.4 2.4 0 0 1 3.4 0l1.6 1.6a2.4 2.4 0 0 1 0 3.4L10 20H7.8l-3.3-3.3a.9.9 0 0 1 0-1.2Z"></path><path d="m11 9 6 6M10 20h9"></path></svg>
				</button>

				<button
					type="button"
					class="control-feedback test-page__scratch-clear"
					:disabled="scratchStrokeCount === 0"
					aria-label="Clear scratch pad"
					title="Clear scratch pad"
					@click="clearScratchPad"
				>
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 21q-.825 0-1.412-.587Q5 19.825 5 19V6H4V4h5V3h6v1h5v2h-1v13q0 .825-.587 1.413Q17.825 21 17 21Zm10-15H7v13h10V6ZM9 17h2V8H9v9Zm4 0h2V8h-2v9Z"></path></svg>
				</button>
			</div>
		</div>
	</main>
</template>

<style>
.test-page {
	display: flex;
	width: min(26.25rem, calc(100% - 1.25rem));
	flex: 1;
	flex-direction: column;
	gap: 0.75rem;
	margin: 0 auto;
	padding: 0.625rem 0 calc(1.75rem + env(safe-area-inset-bottom));
}

.test-page__heading {
	width: 100%;
}

.test-page__heading h1 {
	margin: 0 0 0.25rem;
	font: 700 1.5625rem/1.1 Georgia, "Times New Roman", serif;
	letter-spacing: -0.025em;
}

.test-page__heading p {
	margin: 0;
	color: var(--muted);
	font: 0.75rem/1.45 ui-sans-serif, system-ui, sans-serif;
}

.test-page__board {
	position: relative;
	width: 100%;
}

.test-page__board--scratch-active {
	box-shadow: 0 0 0 2px var(--focus);
}

.test-page__minefield {
	width: 100%;
}

.test-page__scratch-tools,
.test-page__scratch-options {
	display: flex;
	align-items: center;
}

.test-page__scratch-tools {
	align-self: flex-end;
	min-height: 2.5rem;
	margin-top: -0.25rem;
	border: 1px solid transparent;
	color: var(--muted);
}

.test-page__scratch-tools--active {
	border-color: var(--line);
	background: var(--paper);
}

.test-page__scratch-options {
	gap: 2px;
	padding-right: 3px;
}

.test-page__scratch-tools button {
	display: inline-grid;
	min-width: 1.75rem;
	height: 1.75rem;
	place-items: center;
	padding: 0.25rem;
	border: 0;
	background: transparent;
	color: inherit;
	cursor: pointer;
}

.test-page__scratch-tools button:hover:not(:disabled) {
	color: var(--ink);
}

.test-page__scratch-tools button:focus-visible {
	outline: 2px solid var(--focus);
	outline-offset: 1px;
}

.test-page__scratch-tools button:disabled {
	cursor: default;
	opacity: 0.3;
}

.test-page__scratch-tools .test-page__scratch-toggle {
	grid-template-columns: 1rem auto;
	gap: 0.25rem;
	padding-inline: 0.3125rem 0.4375rem;
	font-size: 0.6875rem;
	font-weight: 700;
}

.test-page__scratch-tools .test-page__scratch-toggle--active {
	color: var(--ink);
}

.test-page__scratch-tools svg {
	width: 1rem;
	height: 1rem;
	fill: none;
	stroke: currentColor;
	stroke-linecap: round;
	stroke-linejoin: round;
	stroke-width: 1.7;
}

.test-page__scratch-color {
	position: relative;
	width: 1.75rem;
	border-radius: 0.25rem;
}

.test-page__scratch-color::before {
	width: 0.875rem;
	height: 0.875rem;
	border-radius: 50%;
	background: var(--test-scratch-color);
	content: '';
	transition: width 120ms ease, height 120ms ease;
}

.test-page__scratch-color--graphite { --test-scratch-color: var(--scratch-graphite); }
.test-page__scratch-color--blue { --test-scratch-color: var(--scratch-blue); }
.test-page__scratch-color--red { --test-scratch-color: var(--scratch-red); }

.test-page__scratch-tools .test-page__scratch-color[aria-pressed="true"],
.test-page__scratch-tools .test-page__scratch-eraser--active {
	background: var(--covered);
	color: var(--ink);
	box-shadow: inset 0 0 0 1px var(--line);
}

.test-page__scratch-color[aria-pressed="true"]::before {
	width: 1.25rem;
	height: 1.25rem;
}

.test-page__scratch-eraser svg {
	width: 1.25rem;
	height: 1.25rem;
}

.test-page__scratch-clear svg {
	fill: currentColor;
	stroke: none;
}

</style>
