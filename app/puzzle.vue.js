import { PuzzleField } from './minefield.js';
import { feedbackEffects } from './feedback.js';
import { gameSounds } from './sounds.js';

const PUZZLE_SIZE = 8;
const PUZZLE_ATTEMPTS = 1000;
const PUZZLE_MAX_SEED = 0xffff_ffff_ffff_ffffn;
const PUZZLE_DAILY_OFFSET = 0xcbf29ce484222325n;
const PUZZLE_DAILY_PRIME = 0x100000001b3n;

const PUZZLE_DIFFICULTIES = Object.freeze([
	Object.freeze({ key: 'beginner', label: 'Beginner', description: 'Use one clue at a time to find squares that are immediately safe or mined.' }),
	Object.freeze({ key: 'easy', label: 'Easy', description: 'Recognize familiar patterns on a mostly open board.' }),
	Object.freeze({ key: 'medium', label: 'Medium', description: 'Recognize familiar patterns in a denser position.' }),
	Object.freeze({ key: 'hard', label: 'Hard', description: 'Follow deeper chains of logic before a square is certain.' }),
	Object.freeze({ key: 'expert', label: 'Expert', description: 'Use contradiction to rule out possible mine layouts and find the forced squares.' }),
	Object.freeze({ key: 'mit', label: 'MIT-style', description: 'Solve the whole board from a minimal set of clues. The mine layout is unique.' }),
]);

const PUZZLE_DAILY_DIFFICULTIES = Object.freeze(PUZZLE_DIFFICULTIES.slice(1));
const PUZZLE_INTERACTIVE_STATES = new Set([
	CellState.COVERED,
	CellState.MARKED_MINE,
	CellState.MARKED_SAFE,
	CellState.HINT,
	...Array.from({ length: 9 }, (_, clue) => CellState[`CLUE_${clue}`]),
]);

function puzzleDifficulty(key, collection = PUZZLE_DIFFICULTIES) {
	return collection.find((difficulty) => difficulty.key === key) ?? collection[0];
}

function puzzleRandomSeed() {
	let entropy = new Uint32Array(2);
	crypto.getRandomValues(entropy);
	return BigInt(entropy[0]) | BigInt(entropy[1]) << 32n;
}

function puzzleLocalDate(date = new Date()) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function puzzleDailySeed(dateKey) {
	let seed = PUZZLE_DAILY_OFFSET;
	for (let byte of new TextEncoder().encode(`minesight-daily\0${dateKey}`)) {
		seed ^= BigInt(byte);
		seed = BigInt.asUintN(64, seed * PUZZLE_DAILY_PRIME);
	}
	return seed;
}

function puzzleYield() {
	return new Promise((resolve) => {
		if (document.visibilityState === 'visible') requestAnimationFrame(() => setTimeout(resolve, 0));
		else setTimeout(resolve, 0);
	});
}

function generatePuzzleWithApi(api, difficulty, seed) {
	let method = {
		beginner: 'generateBeginnerPuzzle',
		easy: 'generateEasyPuzzle',
		medium: 'generateMediumPuzzle',
		hard: 'generateHardPuzzle',
		expert: 'generateExpertPuzzle',
		mit: 'generateMitPuzzle',
	}[difficulty.key];
	return api[method](seed, PUZZLE_ATTEMPTS);
}

/**
 * Generates one puzzle. `cancelled` makes long searches safe to abandon on navigation.
 * @param {(typeof PUZZLE_DIFFICULTIES)[number]} difficulty
 * @param {{ seed?: bigint, cancelled?: () => boolean }} [options]
 */
async function generatePuzzleField(difficulty, options = {}) {
	let { seed, cancelled = () => false } = options;
	let api = await getMinetacs();
	let candidate = seed;
	for (let batch = 0; batch < 100 && !cancelled(); batch += 1) {
		await puzzleYield();
		if (cancelled()) return undefined;
		candidate ??= puzzleRandomSeed();
		let generated = generatePuzzleWithApi(api, difficulty, candidate);
		if (generated) {
			if (generated.cells.length !== PUZZLE_SIZE * PUZZLE_SIZE) throw new Error('The puzzle engine returned an invalid board.');
			return {
				field: new PuzzleField(PUZZLE_SIZE, PUZZLE_SIZE, generated.cells),
				seed: generated.seed,
				attempts: generated.attempts,
			};
		}
		candidate = seed === undefined ? undefined : candidate === PUZZLE_MAX_SEED ? 0n : candidate + 1n;
	}
	if (!cancelled()) throw new Error('A puzzle could not be prepared. Please try again.');
	return undefined;
}

function presentPuzzleCell(field, index, { hintsVisible, incorrectIndices, solutionVisible }) {
	let x = index % field.width;
	let y = Math.floor(index / field.width);
	if (incorrectIndices.includes(index)) return CellState.MISFLAGGED;
	if (field.isState(x, y, PuzzleField.REVEALED)) return CellState[`CLUE_${field.getClue(x, y)}`];
	if (field.isState(x, y, PuzzleField.FLAG)) return CellState.FLAGGED;
	if (!field.isState(x, y, PuzzleField.ACTIVE)) return CellState.MASKED;
	if (field.isState(x, y, PuzzleField.MARKED_MINE) || (solutionVisible && field.isState(x, y, PuzzleField.FORCED_MINE))) return CellState.MARKED_MINE;
	if (field.isState(x, y, PuzzleField.MARKED_SAFE) || (solutionVisible && field.isState(x, y, PuzzleField.FORCED_SAFE))) return CellState.MARKED_SAFE;
	if (hintsVisible && (field.isState(x, y, PuzzleField.FORCED_MINE) || field.isState(x, y, PuzzleField.FORCED_SAFE))) return CellState.HINT;
	return CellState.COVERED;
}

/**
 * Shared state machine for static logic puzzles. Pages choose validation timing
 * and react to semantic events; input rules and board presentation live here.
 */
class PuzzleController {
	constructor(field, options = {}) {
		this.ready = field !== undefined;
		this.field = Vue.markRaw(field ?? new PuzzleField(PUZZLE_SIZE, PUZZLE_SIZE));
		this.validation = options.validation === 'deferred' ? 'deferred' : 'immediate';
		this.hintsAvailable = options.hints !== false;
		this.autoComplete = options.autoComplete !== false;
		this.hintsVisible = Boolean(options.hintsVisible);
		this.solutionVisible = false;
		this.result = options.result === 'cleared' ? 'cleared' : 'playing';
		this.busy = false;
		this.feedbackMessage = '';
		this.incorrectIndices = [];
		this.revision = 0;
		this.rejectTimer = undefined;
		this.onChange = options.onChange ?? (() => {});
		this.onRejected = options.onRejected ?? (() => {});
		this.onSolved = options.onSolved ?? (() => {});
	}

	get cells() {
		this.revision;
		return Array.from(this.field.state, (_, index) => presentPuzzleCell(this.field, index, this));
	}

	get disabled() { return this.busy || !this.ready || this.result !== 'playing'; }

	setField(field, options = {}) {
		this.ready = field !== undefined;
		this.field = Vue.markRaw(field ?? new PuzzleField(PUZZLE_SIZE, PUZZLE_SIZE));
		this.result = options.result === 'cleared' ? 'cleared' : 'playing';
		this.hintsVisible = Boolean(options.hintsVisible);
		this.solutionVisible = false;
		this.feedbackMessage = '';
		this.clearRejected();
		this.revision += 1;
	}

	toggleHints() {
		if (!this.hintsAvailable || this.disabled) return;
		this.hintsVisible = !this.hintsVisible;
		gameSounds.play(this.hintsVisible ? 'hint' : 'toggle');
		this.revision += 1;
		this.onChange({ kind: 'hint', visible: this.hintsVisible });
	}

	clearMarks() {
		if (this.disabled) return false;
		let changed = this.field.actionClearMarks();
		this.result = 'playing';
		this.clearRejected();
		this.revision += 1;
		if (changed) gameSounds.play('unmark');
		this.onChange({ kind: 'clear', changed });
		return changed;
	}

	check() {
		if (this.disabled) return { result: this.result === 'cleared' ? 'cleared' : 'unavailable', indices: [] };
		let indices = this.field.checkFlags().map(([x, y]) => this.field.getIndex(x, y));
		if (indices.length) return { result: 'contradiction', indices };
		if (!this.field.isPuzzleSolved()) return { result: 'incomplete', indices: [] };
		this.complete();
		return { result: 'cleared', indices: [] };
	}

	handleAction({ action, index, row: y, column: x }) {
		if (this.disabled) return;
		this.clearRejected();
		let validate = this.validation === 'immediate';
		let before = this.field.state.slice();
		let result = action === 'alternate'
			? this.field.actionMarkMine(x, y, validate)
			: this.field.actionMarkSafe(x, y, validate);
		let rejected = Array.isArray(result) ? result : result === false ? [index] : [];

		let moves = [];
		for (let index = 0; index < before.length; index += 1) {
			let cell = this.field.state[index];
			if (cell === before[index]) continue;
			let added = (cell & (PuzzleField.MARKED_MINE | PuzzleField.MARKED_SAFE)) !== 0;
			moves.push({ index, change: added ? 'added' : 'removed', mine: ((added ? cell : before[index]) & PuzzleField.MARKED_MINE) !== 0 });
		}
		if (rejected.length) this.reject(rejected);
		if (moves.length === 0) return;
		if (!rejected.length) this.feedbackMessage = '';

		for (let move of moves) {
			gameSounds.play(move.change === 'removed' ? 'unmark' : 'mark');
			if (move.change === 'added') feedbackEffects.mark({ cellIndex: move.index, mine: move.mine });
		}
		this.revision += 1;
		this.onChange({ kind: 'move', moves });
		if (!rejected.length && this.autoComplete && this.validation === 'immediate' && this.field.isPuzzleSolved()) this.complete();
	}

	reject(indices, message = 'The clues do not prove that mark. Leave uncertain squares untouched; guesses are not accepted.') {
		this.clearRejected();
		this.feedbackMessage = message;
		this.incorrectIndices = Array.isArray(indices) ? indices : [indices];
		this.revision += 1;
		gameSounds.play('incorrect');
		for (let index of this.incorrectIndices) feedbackEffects.failure({ cellIndex: index, terminal: false });
		this.onRejected({ indices: this.incorrectIndices });
		this.rejectTimer = setTimeout(() => {
			this.incorrectIndices = [];
			this.revision += 1;
		}, 650);
	}

	complete() {
		if (this.result === 'cleared') return;
		this.result = 'cleared';
		this.hintsVisible = false;
		this.feedbackMessage = '';
		this.revision += 1;
		gameSounds.play('success');
		feedbackEffects.success();
		this.onSolved();
	}

	clearRejected() {
		if (this.rejectTimer !== undefined) clearTimeout(this.rejectTimer);
		this.rejectTimer = undefined;
		this.incorrectIndices = [];
	}

	destroy() { this.clearRejected(); }

	snapshot(extra = {}) {
		return {
			cells: Array.from(this.field.state),
			result: this.result,
			hintsVisible: this.hintsVisible,
			...extra,
		};
	}
}

function restorePuzzleController(snapshot, options = {}) {
	if (!Array.isArray(snapshot?.cells) || snapshot.cells.length !== PUZZLE_SIZE * PUZZLE_SIZE) return undefined;
	try {
		let field = new PuzzleField(PUZZLE_SIZE, PUZZLE_SIZE, Uint8Array.from(snapshot.cells));
		if (!snapshot.cells.every(cell => Number.isInteger(cell) && cell >= 0 && cell <= 255)) return undefined;
		PuzzleField.decode(field.encode());
		return new PuzzleController(field, {
			...options,
			result: snapshot.result === 'cleared' && field.isPuzzleSolved() ? 'cleared' : 'playing',
			hintsVisible: snapshot.hintsVisible,
		});
	}
	catch { return undefined; }
}

async function sharePuzzleLink(field, text = 'Can you solve this Minesight puzzle?') {
	let url = new URL(window.location.href);
	url.hash = `/puzzle/${field.encode()}`;
	let data = { title: 'Minesight Puzzle', text, url: url.href };
	if (navigator.share) {
		try { await navigator.share(data); return 'Puzzle shared'; }
		catch (error) { if (error instanceof Error && error.name === 'AbortError') return ''; }
	}
	await navigator.clipboard.writeText(url.href);
	return 'Puzzle link copied';
}
