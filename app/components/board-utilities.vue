<script>
const BOARD_NOTE_COLORS = Object.freeze([
	Object.freeze({ key: 'graphite', label: 'Graphite' }),
	Object.freeze({ key: 'blue', label: 'Blue' }),
	Object.freeze({ key: 'red', label: 'Red' }),
]);

// Presentation only: owners handle these requests and pass the resulting state back.
const BoardUtilities = Vue.defineComponent({
	template: '#board-utilities',
	props: {
		notesAvailable: { type: Boolean, default: true },
		notesActive: Boolean,
		notesTool: { type: String, default: 'pencil' },
		notesColor: { type: String, default: 'graphite' },
		strokeCount: { type: Number, default: 0 },
		help: { type: String, default: '' },
		shareAvailable: Boolean,
		shareDisabled: Boolean,
		shareLabel: { type: String, default: 'Share this puzzle' },
	},
	emits: ['toggle-notes', 'select-pencil', 'select-eraser', 'clear-notes', 'share'],
	data() {
		return {
			noteColors: BOARD_NOTE_COLORS,
		};
	},
});
</script>

<template id="board-utilities">
	<div class="board-utilities">
		<div class="board-utilities__utility-row" :class="{ 'board-utilities__utility-row--drawing': notesActive }">
			<p v-if="notesActive || help" class="board-utilities__help">{{ notesActive ? 'Draw freely over the board. Select Done to resume play.' : help }}</p>
			<div class="board-utilities__utilities">
				<div v-if="notesAvailable" class="board-utilities__notes" :class="{ 'board-utilities__notes--active': notesActive }" role="toolbar" aria-label="Scratch notes">
					<button type="button" class="control-feedback board-utilities__notes-toggle" :aria-pressed="notesActive" :title="notesActive ? 'Finish drawing' : 'Draw notes over the board'" @click="$emit('toggle-notes')">
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.7-10.7a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z"></path><path d="m14.8 6.5 3 3M8.2 19l-3-3"></path></svg>
						<span>{{ notesActive ? 'Done' : 'Notes' }}</span>
					</button>
					<div v-if="notesActive" class="board-utilities__note-options">
						<button v-for="color in noteColors" :key="color.key" type="button" class="control-feedback board-utilities__color" :class="`board-utilities__color--${color.key}`" :aria-label="`${color.label} pencil`" :title="`${color.label} pencil`" :aria-pressed="notesTool === 'pencil' && notesColor === color.key" @click="$emit('select-pencil', color.key)"></button>
						<button type="button" class="control-feedback board-utilities__eraser" :aria-pressed="notesTool === 'eraser'" aria-label="Erase whole strokes" title="Erase whole strokes" @click="$emit('select-eraser')">
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4.5 15.5 8.8-8.8a2.4 2.4 0 0 1 3.4 0l1.6 1.6a2.4 2.4 0 0 1 0 3.4L10 20H7.8l-3.3-3.3a.9.9 0 0 1 0-1.2Z"></path><path d="m11 9 6 6M10 20h9"></path></svg>
						</button>
						<button class="control-feedback" type="button" :disabled="strokeCount === 0" aria-label="Clear scratch notes" title="Clear scratch notes" @click="$emit('clear-notes')">
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6v14h12V6M10 10v6M14 10v6"></path></svg>
						</button>
					</div>
				</div>
				<button v-if="shareAvailable && !notesActive" type="button" class="control-feedback board-utilities__share" :disabled="shareDisabled" :aria-label="shareLabel" :title="shareLabel" @click="$emit('share')">
					<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"></circle><circle cx="6" cy="12" r="2.5"></circle><circle cx="18" cy="19" r="2.5"></circle><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"></path></svg>
				</button>
			</div>
		</div>
	</div>
</template>

<style>
.board-utilities {
	margin-top: .5rem;
}
.board-utilities__utility-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: .625rem;
	min-height: 2.5rem;
}
.board-utilities__help {
	min-width: 0;
	margin: 0;
	color: var(--muted);
	font: .6875rem/1.35 ui-sans-serif, system-ui, sans-serif;
}
.board-utilities__utilities {
	display: flex;
	flex: none;
	align-items: center;
	gap: 3px;
	margin-left: auto;
}
.board-utilities__notes,
.board-utilities__note-options {
	display: flex;
	align-items: center;
}
.board-utilities__notes {
	min-height: 2.5rem;
	border: 1px solid transparent;
	color: var(--muted);
}
.board-utilities__notes--active {
	border-color: var(--line);
	background: var(--paper);
}
.board-utilities__note-options {
	gap: 2px;
	padding-right: 3px;
}
.board-utilities__utilities button {
	display: inline-grid;
	flex: none;
	place-items: center;
	min-width: 1.75rem;
	height: 1.75rem;
	padding: 4px;
	border: 0;
	background: transparent;
	color: var(--muted);
	cursor: pointer;
}
.board-utilities__utilities button:hover:not(:disabled) {
	color: var(--ink);
	background: color-mix(in srgb, var(--covered) 45%, transparent);
}
.board-utilities__utilities button:focus-visible {
	outline: 2px solid var(--focus);
	outline-offset: 2px;
}
.board-utilities__utilities button:disabled {
	opacity: .3;
	cursor: default;
}
.board-utilities__utilities svg {
	width: 1rem;
	height: 1rem;
	fill: none;
	stroke: currentColor;
	stroke-linecap: round;
	stroke-linejoin: round;
	stroke-width: 1.7;
}
.board-utilities__utilities .board-utilities__notes-toggle {
	grid-template-columns: 1rem auto;
	gap: 4px;
	padding-inline: 5px 7px;
	font: 700 .6875rem ui-sans-serif, system-ui, sans-serif;
}
.board-utilities__notes-toggle[aria-pressed="true"] {
	color: var(--ink);
}
.board-utilities__utilities .board-utilities__eraser svg {
	width: 1.25rem;
	height: 1.25rem;
}
.board-utilities__utilities .board-utilities__share svg {
	width: 1.125rem;
	height: 1.125rem;
	fill: var(--paper);
}
.board-utilities__color {
	width: 1.75rem;
	border-radius: 4px;
}
.board-utilities__color::after {
	width: .875rem;
	height: .875rem;
	border-radius: 50%;
	background: var(--scratch-color);
	content: '';
	transition: width 120ms ease, height 120ms ease;
}
.board-utilities__utilities .board-utilities__color[aria-pressed="true"],
.board-utilities__utilities .board-utilities__eraser[aria-pressed="true"] {
	background: var(--covered);
	color: var(--ink);
	box-shadow: inset 0 0 0 1px var(--line);
}
.board-utilities__color[aria-pressed="true"]::after {
	width: 1.25rem;
	height: 1.25rem;
}
.board-utilities__color--graphite {
	--scratch-color: var(--scratch-graphite);
}
.board-utilities__color--blue {
	--scratch-color: var(--scratch-blue);
}
.board-utilities__color--red {
	--scratch-color: var(--scratch-red);
}
@media (max-width: 480px) {
	.board-utilities__utility-row--drawing {
		flex-wrap: wrap;
		gap: .375rem;
	}
	.board-utilities__utility-row--drawing .board-utilities__help {
		flex-basis: 100%;
	}
}
@media (prefers-reduced-motion: reduce) {
	.board-utilities__color::after {
		transition: none;
	}
}
</style>
