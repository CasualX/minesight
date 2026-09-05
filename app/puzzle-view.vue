<link rel="component" href="minefield-view.vue">
<link rel="component" href="components/board-utilities.vue">
<link rel="component" href="components/notification-toast.vue">
<link rel="component" href="scratch-pad.vue">
<link rel="component" href="scratch-notes.vue.js">
<link rel="component" href="puzzle.vue.js">
<link rel="component" href="minetacs.vue.js">

<script>
const PuzzleView = Vue.defineComponent({
	template: '#puzzle-view',
	components: { MinefieldView, BoardUtilities, NotificationToast, ScratchPad },
	props: {
		puzzle: { type: PuzzleController, required: true },
		statusTitle: { type: String, default: 'What can you prove?' },
		statusMessage: { type: String, default: 'Mark every covered square that must be safe or mined.' },
		loading: Boolean,
		shareAvailable: Boolean,
		shareMessage: { type: String, default: '' },
		shareLabel: { type: String, default: 'Share this puzzle' },
		loadingMessage: { type: String, default: 'Building puzzle…' },
		scratchAvailable: { type: Boolean, default: true },
	},
	emits: ['cell-action', 'share'],
	data() { return { notes: new ScratchNotes(), interactiveStates: PUZZLE_INTERACTIVE_STATES }; },
	methods: {
		handleAction(input) {
			if (this.loading) return;
			this.puzzle.handleAction(input);
			this.$emit('cell-action', input);
		},
		resetScratch() { this.notes.reset(); this.$refs.scratchPad?.reset(); },
	},
});
</script>

<template id="puzzle-view">
	<div class="puzzle-view">
		<div class="puzzle-view__board" data-feedback-board :aria-busy="loading">
			<minefield-view
				:inert="notes.active"
				:width="puzzle.field.width"
				:height="puzzle.field.height"
				:cells="puzzle.cells"
				:interactive="interactiveStates"
				:disabled="puzzle.disabled || loading"
				@cell-action="handleAction"
			></minefield-view>
			<div v-if="loading" class="puzzle-view__loading" role="status">
				<span class="puzzle-view__spinner" aria-hidden="true"></span>{{ loadingMessage }}
			</div>
			<scratch-pad v-if="scratchAvailable" ref="scratchPad" :active="notes.active" v-model:tool="notes.tool" v-model:color="notes.color" @change="notes.strokeCount = $event.strokeCount"></scratch-pad>
		</div>
		<board-utilities
			:notes-active="notes.active" :notes-tool="notes.tool" :notes-color="notes.color" :stroke-count="notes.strokeCount"
			:notes-available="scratchAvailable" :share-available="shareAvailable" :share-disabled="loading || !puzzle.ready" :share-label="shareLabel"
			help="Tap or left-click to mark safe. Long-press, right-click, or press F to mark mined."
			@toggle-notes="notes.toggle()" @select-pencil="notes.selectPencil($event)" @select-eraser="notes.tool = 'eraser'"
			@clear-notes="$refs.scratchPad?.clear()" @share="$emit('share')"
		></board-utilities>
		<notification-toast :message="shareMessage"></notification-toast>

		<div class="puzzle-view__status" role="status" aria-live="polite">
			<strong>{{ statusTitle }}</strong>
			<span>{{ puzzle.feedbackMessage || statusMessage }}</span>
		</div>
		<div class="puzzle-view__actions"><slot></slot></div>
	</div>
</template>

<style>
.puzzle-view {
	display: block;
}
.puzzle-view__actions button:focus-visible {
	outline: 2px solid var(--focus);
	outline-offset: 2px;
}
.puzzle-view__board {
	position: relative;
	width: 100%;
}
.puzzle-view__loading {
	position: absolute;
	z-index: 4;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: .5rem;
	background: color-mix(in srgb, var(--paper) 78%, transparent);
	font: 700 .75rem ui-sans-serif, system-ui, sans-serif;
}
.puzzle-view__spinner {
	width: 1rem;
	height: 1rem;
	border: 2px solid var(--line);
	border-top-color: var(--focus);
	border-radius: 50%;
	animation: puzzle-view-spin 700ms linear infinite;
}
.puzzle-view__status {
	min-height: 3.25rem;
	margin-top: .625rem;
	padding-top: .625rem;
	border-top: 1px solid var(--line);
}
.puzzle-view__status strong {
	display: block;
	font: 700 .875rem/1.35 ui-sans-serif, system-ui, sans-serif;
}
.puzzle-view__status span {
	display: block;
	margin-top: 2px;
	color: var(--muted);
	font: .6875rem/1.35 ui-sans-serif, system-ui, sans-serif;
}
.puzzle-view__actions {
	display: grid;
	grid-auto-flow: column;
	grid-auto-columns: minmax(0, 1fr);
	gap: .5rem;
	margin-top: .75rem;
}
.puzzle-view__actions:empty {
	display: none;
}
.puzzle-view__actions button {
	width: 100%;
	min-width: 0;
	min-height: 2.75rem;
	padding: .5rem 1rem;
	border: 1px solid var(--line);
	border-radius: 0;
	background: var(--paper);
	color: var(--ink);
	font: 700 .875rem/1.2 ui-sans-serif, system-ui, sans-serif;
	cursor: pointer;
}
.puzzle-view__actions button:hover:not(:disabled) {
	border-color: color-mix(in srgb, var(--ink) 45%, var(--line));
	background: color-mix(in srgb, var(--paper) 82%, var(--covered));
}
.puzzle-view__actions button.primary {
	border-color: var(--ink);
	background: var(--ink);
	color: var(--paper);
}
.puzzle-view__actions button.primary:hover:not(:disabled) {
	background: color-mix(in srgb, var(--ink) 85%, var(--paper));
}
.puzzle-view__actions button[aria-pressed="true"] {
	border-color: var(--hint-line);
	background: var(--hint);
	box-shadow: inset 0 0 0 1px var(--hint-line);
}
.puzzle-view__actions button[aria-pressed="true"]:hover:not(:disabled) {
	background: var(--hint-hover);
}
.puzzle-view__actions button:disabled {
	border-color: var(--line);
	background: var(--covered);
	color: var(--muted);
	box-shadow: none;
	opacity: .65;
	cursor: default;
}
@keyframes puzzle-view-spin {
	to {
		transform: rotate(1turn);
	}
}
@media (prefers-reduced-motion: reduce) {
	.puzzle-view__spinner {
		animation-duration: 1400ms;
	}
}
</style>
