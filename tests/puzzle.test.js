import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { PuzzleField } from '../public/minefield.js';

// Exercise the authored Vue-Script helpers and Options API methods without a bundler.
// Rendering and Vue reactivity are checked separately in the mounted browser app.
let now = 100;
let timerId = 0;
const timers = new Map();
const storage = new Map();
const context = vm.createContext({
	PuzzleField, Uint8Array, Uint32Array, TextEncoder, URL, URLSearchParams,
	crypto: globalThis.crypto,
	Vue: { markRaw: value => value, defineComponent: value => value },
	MinefieldView: {}, PuzzleView: {}, BoardUtilities: {}, NotificationToast: {}, ScratchPad: {},
	gameSounds: { play() {} },
	feedbackEffects: { mark() {}, failure() {}, success() {}, fireworks() {}, streakLost() {} },
	MinesightStorage: { get: (key, fallback) => storage.get(key) ?? fallback, set: (key, value) => storage.set(key, structuredClone(value)) },
	performance: { now: () => now },
	setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
	clearTimeout: id => timers.delete(id),
	setInterval: callback => { timers.set(++timerId, callback); return timerId; },
	clearInterval: id => timers.delete(id),
	window: { location: { hash: '' } },
});
function load(path, names, component = false) {
	let source = readFileSync(new URL(path, import.meta.url), 'utf8');
	if (component) source = source.match(/<script>([\s\S]*?)<\/script>/)[1];
	source = source.replace(/^import .*$/gm, '');
	vm.runInContext(`${source}\nObject.assign(globalThis, { ${names.join(', ')} });`, context);
}
load('../app/minefield.vue.js', ['CellState']);
load('../app/editor-solver.vue.js', ['analyzeEditorBoard', 'createEditorPuzzle']);
load('../app/scratch-notes.vue.js', ['ScratchNotes']);
load('../app/puzzle.vue.js', ['PuzzleController', 'restorePuzzleController']);
load('../app/pages/tutorial.vue', ['createTutorialPuzzleField', 'TutorialPuzzleController'], true);
load('../app/components/hold-button.vue', ['HoldButton'], true);
load('../app/pages/study.vue', ['StudyPage'], true);
load('../app/pages/daily.vue', ['DailyPage'], true);
load('../app/pages/challenge.vue', ['ChallengePage'], true);
load('../app/pages/editor.vue', ['EditorPage'], true);
function page(component, route = {}) {
	const instance = { route, $refs: {}, $emit() {}, $nextTick: callback => callback() };
	Object.assign(instance, component.data.call(instance));
	for (const [name, method] of Object.entries(component.methods)) instance[name] = method.bind(instance);
	for (const [name, getter] of Object.entries(component.computed ?? {})) Object.defineProperty(instance, name, { get: getter.bind(instance) });
	return instance;
}
function input(index, action = 'primary') { return { index, row: Math.floor(index / 8), column: index % 8, action }; }
// Keep the two-mark controller fixture independent of the tutorial layout.
function field() {
	let state = new Uint8Array(64);
	let set = (x, y, flags) => { state[y * 8 + x] = flags; };
	set(0, 0, PuzzleField.ACTIVE | PuzzleField.FORCED_SAFE);
	set(1, 0, PuzzleField.MINE | PuzzleField.ACTIVE | PuzzleField.FORCED_MINE);
	for (let y = 0; y < 4; y += 1) for (let x = 0; x < 5; x += 1) {
		if (state[y * 8 + x] === 0) set(x, y, PuzzleField.REVEALED);
	}
	set(5, 3, PuzzleField.ACTIVE);
	set(6, 3, PuzzleField.ACTIVE);
	set(7, 3, PuzzleField.ACTIVE);
	set(5, 4, PuzzleField.ACTIVE);
	set(6, 4, PuzzleField.REVEALED);
	set(7, 4, PuzzleField.REVEALED);
	set(5, 5, PuzzleField.ACTIVE);
	set(6, 5, PuzzleField.ACTIVE);
	set(7, 5, PuzzleField.MINE | PuzzleField.ACTIVE);
	return new PuzzleField(8, 8, state);
}

const tests = [];
function test(name, run) { tests.push({ name, run }); }

test('tutorial revealed cells have a complete covered frontier', () => {
	const field = context.createTutorialPuzzleField();
	for (let y = 0; y < field.height; y++) for (let x = 0; x < field.width; x++) {
		if (!field.isState(x, y, PuzzleField.REVEALED)) continue;
		for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
			const nx = x + dx, ny = y + dy;
			if (nx < 0 || ny < 0 || nx >= field.width || ny >= field.height) continue;
			assert.ok(field.isState(nx, ny, PuzzleField.REVEALED) || field.isState(nx, ny, PuzzleField.ACTIVE), `inactive neighbor at ${nx},${ny}`);
		}
	}
});

test('tutorial rejects unexpected input and accepts both gestures for the uncertainty step', () => {
	for (const action of ['primary', 'alternate']) {
		const puzzle = new context.TutorialPuzzleController();
		const initial = Array.from(puzzle.field.state);
		puzzle.handleAction(input(0)); // A provably safe cell, but not the current step.
		assert.equal(puzzle.step, 0);
		assert.equal(puzzle.incorrectIndices[0], 0);
		assert.match(puzzle.feedbackMessage, /highlighted square/);
		assert.deepEqual(Array.from(puzzle.field.state), initial);
		puzzle.handleAction(input(1)); // Correct cell, wrong gesture.
		assert.equal(puzzle.step, 0);
		assert.equal(puzzle.incorrectIndices[0], 1);
		assert.deepEqual(Array.from(puzzle.field.state), initial);
		puzzle.handleAction(input(1, 'alternate'));
		assert.equal(puzzle.step, 1);
		puzzle.handleAction(input(0));
		assert.equal(puzzle.step, 2);
		puzzle.handleAction(input(45)); // A different uncertain cell must not advance.
		assert.equal(puzzle.step, 2);
		puzzle.handleAction(input(46, action));
		assert.equal(puzzle.finished, true);
		assert.equal(puzzle.disabled, true);
		assert.equal(puzzle.incorrectIndices[0], 46);
		assert.match(puzzle.feedbackMessage, /not forced/);
		puzzle.handleAction(input(1));
		assert.equal(puzzle.step, 3);
		puzzle.destroy();
	}
});

test('immediate validation rejects guesses, preserves marks, and completes only once', () => {
	let solved = 0, rejected = 0;
	let puzzle = new context.PuzzleController(field(), { onSolved: () => solved++, onRejected: () => rejected++ });
	puzzle.handleAction(input(46));
	assert.equal(rejected, 1);
	assert.match(puzzle.feedbackMessage, /not prove/);
	assert.equal(puzzle.field.isState(6, 5, PuzzleField.MARKED_SAFE), false);
	puzzle.handleAction(input(1, 'alternate'));
	puzzle.handleAction(input(0));
	assert.equal(puzzle.result, 'cleared');
	assert.equal(puzzle.feedbackMessage, '');
	puzzle.check();
	assert.equal(solved, 1);
	assert.equal(puzzle.clearMarks(), false);
	puzzle.destroy();
});

test('deferred validation allows editing, distinguishes contradiction and incomplete, and waits for Check', () => {
	let puzzle = new context.PuzzleController(field(), { validation: 'deferred' });
	puzzle.handleAction(input(1));
	assert.equal(puzzle.check().result, 'incomplete'); // Safe marks do not trigger checkFlags.
	puzzle.clearMarks();
	puzzle.handleAction(input(0, 'alternate'));
	puzzle.handleAction(input(1, 'alternate'));
	assert.equal(puzzle.check().result, 'contradiction');
	puzzle.clearMarks();
	assert.equal(puzzle.check().result, 'incomplete');
	puzzle.handleAction(input(1, 'alternate'));
	puzzle.handleAction(input(0));
	assert.equal(puzzle.result, 'playing');
	assert.equal(puzzle.check().result, 'cleared');
});

test('chording reports every rejected cell and still publishes successful marks', () => {
	const F = PuzzleField;
	const cells = new Uint8Array(64);
	cells[0] = F.MINE | F.ACTIVE | F.MARKED_MINE;
	cells[1] = F.ACTIVE | F.FORCED_SAFE;
	cells[2] = F.ACTIVE;
	cells[8] = F.ACTIVE;
	cells[9] = F.REVEALED;
	let changed, rejected;
	const puzzle = new context.PuzzleController(new F(8, 8, cells), {
		onChange: event => { changed = event; },
		onRejected: event => { rejected = event; },
	});
	puzzle.handleAction(input(9));
	assert.deepEqual(Array.from(rejected.indices), [2, 8]);
	assert.equal(changed.moves.length, 1);
	assert.equal(changed.moves[0].index, 1);
	assert.equal(puzzle.cells[1], context.CellState.MARKED_SAFE);
	assert.equal(puzzle.cells[2], context.CellState.MISFLAGGED);
	assert.equal(puzzle.cells[8], context.CellState.MISFLAGGED);
	puzzle.destroy();
});

test('Daily checks only obvious flag errors and animates all affected clues', () => {
	const instance = page(context.DailyPage, { difficultyKey: 'easy' });
	instance.puzzle.setField(field());
	instance.puzzle.handleAction(input(1));
	instance.check();
	assert.equal(instance.checkMessage, 'Not complete yet. Keep going.');
	instance.puzzle.clearMarks();
	instance.puzzle.handleAction(input(0, 'alternate'));
	instance.puzzle.handleAction(input(1, 'alternate'));
	const indices = instance.puzzle.field.checkFlags().map(([x, y]) => y * 8 + x);
	const animated = [];
	const original = context.feedbackEffects.failure;
	context.feedbackEffects.failure = event => animated.push(event.cellIndex);
	try { instance.check(); }
	finally { context.feedbackEffects.failure = original; }
	assert(indices.length > 1);
	assert.deepEqual(animated, indices);
	assert.match(instance.checkMessage, /too many marked mines/);
});

test('empty fields and damaged snapshots cannot become playable completed puzzles', () => {
	let puzzle = new context.PuzzleController();
	assert.equal(puzzle.disabled, true);
	assert.equal(puzzle.check().result, 'unavailable');
	assert.equal(context.restorePuzzleController({ cells: Array(64).fill(999) }), undefined);
	assert.equal(context.restorePuzzleController({ cells: Array(64).fill(0) }), undefined);
	let saved = new context.PuzzleController(field()).snapshot();
	saved.result = 'cleared';
	assert.equal(context.restorePuzzleController(saved).result, 'playing');
});

for (const [name, component, select, generate] of [
	['Study', context.StudyPage, 'selectDifficulty', 'newPuzzle'],
	['Daily', context.DailyPage, 'openDifficulty', 'prepare'],
]) {
	test(`${name} restores a saved difficulty while cancelling pending generation without corrupting boards`, async () => {
		storage.clear();
		let resolve;
		context.generatePuzzleField = () => new Promise(done => { resolve = done; });
		let instance = page(component, { difficultyKey: 'easy' });
		instance.bindPuzzle();
		instance.puzzle.setField(field());
		instance.boardDifficultyKey = 'easy';
		instance.puzzle.handleAction(input(1, 'alternate'));
		instance.save();
		const original = instance.puzzle.snapshot().cells;
		instance[select]('hard', false);
		assert.equal(instance.preparing, true);
		instance.save();
		let saved = storage.get(name.toLowerCase());
		assert.equal((saved.states ?? saved.difficulties).hard?.cells, undefined);
		instance[select]('easy', false);
		assert.equal(instance.preparing, false);
		assert.deepEqual(instance.puzzle.snapshot().cells, original);
		resolve({ field: field(), seed: 1n });
		await Promise.resolve();
		assert.equal(instance.difficultyKey, 'easy');
		assert.deepEqual(instance.puzzle.snapshot().cells, original);
		instance.puzzle.destroy();
	});
	test(`${name} can retry generation after an engine failure`, async () => {
		storage.clear();
		const instance = page(component, { difficultyKey: 'easy' });
		instance.bindPuzzle();
		context.generatePuzzleField = async () => { throw new Error('Unavailable'); };
		await instance[generate]();
		assert.equal(instance.preparing, false);
		assert.equal(instance.puzzle.disabled, true);
		context.generatePuzzleField = async () => ({ field: field(), seed: 1n });
		await instance[generate]();
		assert.equal(instance.error, '');
		assert.equal(instance.puzzle.disabled, false);
	});
}

test('Daily rolls over to a new local day without carrying old completion forward', async () => {
	storage.clear();
	const instance = page(context.DailyPage, { difficultyKey: 'easy' });
	instance.bindPuzzle();
	instance.date = '2000-01-01';
	instance.states = { easy: { completed: true } };
	context.generatePuzzleField = async () => ({ field: field(), seed: 1n });
	instance.refreshDate();
	await new Promise(setImmediate);
	assert.notEqual(instance.date, '2000-01-01');
	assert.equal(instance.solvedCount, 0);
	assert.equal(instance.puzzle.disabled, false);
});

test('shared known mines remain visible outside the interactive frontier', () => {
	const cells = field().state.slice();
	cells[63] = PuzzleField.FLAG | PuzzleField.MINE;
	const puzzle = new context.PuzzleController(new PuzzleField(8, 8, cells));
	assert.equal(puzzle.cells[63], context.CellState.FLAGGED);
});

test('Challenge prepares before Start and retries without starting the clock', async () => {
	const instance = page(context.ChallengePage, { seed: 5n });
	context.generatePuzzleField = async () => { throw new Error('Unavailable'); };
	await instance.prepare();
	assert.equal(instance.ready, false);
	assert.equal(instance.startLabel, 'Try again');
	assert.equal(instance.timerId, undefined);
	context.generatePuzzleField = async (_difficulty, { seed }) => ({ field: field(), seed });
	await instance.prepare();
	assert.equal(instance.ready, true);
	assert.equal(instance.phase, 'intro');
	assert.equal(instance.puzzles.length, 12);
	assert.equal(instance.timerId, undefined);
	instance.activateStart();
	assert.equal(instance.phase, 'playing');
	assert.notEqual(instance.timerId, undefined);
	instance.stopTimer();
});

test('Challenge continues after each generated puzzle seed', async () => {
	const requestedSeeds = [];
	const instance = page(context.ChallengePage, { seed: 5n });
	context.generatePuzzleField = async (_difficulty, { seed }) => {
		requestedSeeds.push(seed);
		return { field: field(), seed: seed + 10n };
	};
	await instance.prepare();
	assert.deepEqual(requestedSeeds, Array.from({ length: instance.total }, (_, index) => 5n + BigInt(index) * 11n));
});

test('Challenge mode changes discard stale preparation', async () => {
	const pending = [];
	context.generatePuzzleField = () => new Promise(resolve => pending.push(resolve));
	const instance = page(context.ChallengePage, { modeKey: 'hard', seed: 5n });
	const original = instance.prepare();
	const replacement = instance.selectMode('expert');
	assert.equal(instance.phase, 'preparing');
	assert.equal(instance.modeKey, 'expert');
	pending[0]({ field: field() });
	await original;
	assert.equal(instance.puzzles.length, 0);
	assert.equal(instance.phase, 'preparing');
	context.generatePuzzleField = async (_difficulty, { seed }) => ({ field: field(), seed });
	pending[1]({ field: field(), seed: instance.seed });
	await replacement;
	assert.equal(instance.ready, true);
	assert.equal(instance.puzzles.length, 12);
	assert.equal(instance.timerId, undefined);
});

test('Challenge excludes time between puzzles and result viewing', () => {
	const instance = page(context.ChallengePage, { modeKey: 'hard', seed: 1n });
	now = 100;
	instance.startTimer();
	now = 1100;
	instance.stopTimer();
	now = 9000;
	instance.stopTimer();
	assert.equal(instance.elapsedMs, 1000);
	instance.startTimer();
	now = 9500;
	instance.stopTimer();
	assert.equal(instance.elapsedMs, 1500);
});

test('Hold button confirms once, ignores key repeat, and cancels pending gestures', () => {
	const instance = page(context.HoldButton);
	instance.duration = 900;
	let confirmed = 0;
	instance.$emit = event => { assert.equal(event, 'confirm'); confirmed++; };
	timers.clear();
	instance.begin({ repeat: true });
	assert.equal(timers.size, 0);
	instance.begin();
	instance.begin();
	assert.equal(timers.size, 1);
	instance.cancel();
	assert.equal(timers.size, 0);
	assert.equal(confirmed, 0);
	instance.begin();
	timers.get(instance.timerId)();
	assert.equal(confirmed, 1);
	assert.equal(instance.holding, false);
	instance.begin({ repeat: true });
	assert.equal(timers.size, 0);
	instance.begin();
	instance.disabled = true;
	context.HoldButton.watch.disabled.call(instance, true);
	assert.equal(timers.size, 0);
	instance.begin();
	assert.equal(timers.size, 0);
});

test('Challenge give up keeps the solution visible until restarting the run', () => {
	const instance = page(context.ChallengePage, { seed: 5n, time: 12345 });
	const puzzle = new context.PuzzleController(field());
	instance.puzzle = puzzle;
	instance.phase = 'playing';
	instance.startTimer();
	let sound, effect, lock;
	const originalPlay = context.gameSounds.play, originalFailure = context.feedbackEffects.failure;
	context.gameSounds.play = value => { sound = value; };
	context.feedbackEffects.failure = value => { effect = value; };
	instance.$emit = (event, value) => { if (event === 'navigation-lock') lock = value; };
	try {
		instance.giveUp();
		assert.equal(instance.phase, 'gave-up');
		assert.equal(instance.gaveUp, true);
		assert.equal(instance.puzzle, puzzle);
		assert.equal(instance.puzzle.solutionVisible, true);
		assert.equal(instance.puzzle.disabled, true);
		assert.equal(instance.timerId, undefined);
		assert.equal(instance.statusTitle, 'Run ended');
		assert.equal(sound, 'failure');
		assert.equal(effect.terminal, true);
		assert.equal(lock, false);
		const cells = instance.puzzle.snapshot().cells;
		instance.puzzle.handleAction(input(0));
		assert.deepEqual(instance.puzzle.snapshot().cells, cells);
		instance.replay();
		assert.notEqual(instance.seed, 5n);
		assert.equal(instance.targetMs, undefined);
		assert.equal(instance.received, false);
		assert.equal(instance.phase, 'preparing');
	}
	finally { context.gameSounds.play = originalPlay; context.feedbackEffects.failure = originalFailure; }
});

test('Challenge final solve opens results and compares displayed hundredths', () => {
	const instance = page(context.ChallengePage, { seed: 5n, time: 60000 });
	instance.puzzles = Array.from({ length: 12 }, field);
	instance.index = 11;
	instance.results = Array(11).fill('cleared');
	instance.elapsedMs = 60009;
	instance.loadPuzzle();
	instance.puzzle.onSolved();
	assert.equal(instance.phase, 'result');
	assert.equal(instance.finishTitle, 'Perfect run');
	assert.equal(instance.timeResultMessage, 'A perfect tie!');
	instance.elapsedMs = 50000;
	assert.equal(instance.timeBeaten, true);
	assert.equal(instance.timeResultMessage, 'Left them in the dust!');
	instance.elapsedMs = 60100;
	assert.equal(instance.timeBeaten, false);
	assert.equal(instance.timeResultMessage, 'So close!');
});

test('Challenge finish preview is local-only and cancels preparation', () => {
	const instance = page(context.ChallengePage, { seed: 5n });
	context.window.location.hostname = 'example.com';
	assert.equal(instance.showTestEnd(), false);
	assert.equal(instance.phase, 'intro');
	context.window.location.hostname = 'localhost';
	assert.equal(instance.showTestEnd(3), true);
	assert.equal(instance.failedCount, 3);
	assert.equal(instance.cleanCount, 9);
	assert.equal(instance.phase, 'result');
	assert.equal(instance.preparationId, 1);
	assert.equal(instance.showTestEnd(99), true);
	assert.equal(instance.failedCount, 12);
	assert.equal(instance.showTestEnd(), true);
	assert.equal(instance.finishTitle, 'Perfect run');
});

test('Challenge sharing preserves invitations and matches the displayed final time', async () => {
	let copied;
	context.navigator = { clipboard: { writeText: async value => { copied = value; } } };
	context.window.location.href = 'http://localhost/public/index.html?p=old&seed=old&time=1&challenge=hard&keep=yes';
	const instance = page(context.ChallengePage, { modeKey: 'expert', seed: 0xabcn });
	await instance.share();
	assert.equal(new URL(copied).hash, '#/challenge/expert?seed=abc');
	assert.equal(new URL(copied).search, '?keep=yes');
	instance.targetMs = 120000;
	await instance.share();
	assert.equal(new URL(copied).hash, '#/challenge/expert?seed=abc&time=120000');
	instance.phase = 'result';
	instance.elapsedMs = 65329;
	await instance.share();
	assert.equal(instance.timerText, '01:05.32');
	assert.equal(new URL(copied).hash, '#/challenge/expert?seed=abc&time=65320');
	instance.gaveUp = true;
	await instance.share();
	assert.equal(new URL(copied).hash, '#/challenge/expert?seed=abc&time=120000');
});

test('Board Lab uses shared cell states for its board and analysis', () => {
	storage.delete('editor');
	const instance = page(context.EditorPage);
	assert.deepEqual(Array.from(instance.tools), [
		'covered', 'masked', 'flagged',
		...Array.from({ length: 9 }, (_, index) => `clue-${index}`),
	]);
	assert.equal(instance.toolText.covered, '□');
	assert.equal(instance.toolText['clue-0'], '0');
	instance.board = ['masked', 'flagged', ...Array.from({ length: 9 }, (_, index) => `clue-${index}`), 'covered', 'covered', 'covered', 'covered'];
	assert.deepEqual(Array.from(instance.cells), instance.board);
	instance.analysis = { forcedMine: [11], forcedSafe: [12], solution: Array(15).fill(false) };
	instance.analysis.solution[13] = true;
	assert.equal(instance.cells[11], 'marked-mine');
	assert.equal(instance.cells[12], 'marked-safe');
	assert.equal(instance.cells[13], 'covered');
	instance.showSolution = true;
	assert.equal(instance.cells[13], 'exposed-mine');
	assert.equal(instance.cells[14], 'covered');
	assert.ok(instance.cells.every(state => instance.interactiveStates.has(state)));
	instance.showSolution = false;
	assert.equal(instance.cells[13], 'covered');
});

test('Board Lab records an entire stroke even when it starts on an unchanged cell', () => {
	storage.delete('editor');
	const instance = page(context.EditorPage);
	instance.tool = 'covered';
	instance.board[1] = 'clue-1';
	instance.startPaint({ button: 0 }, 0);
	instance.paint(1);
	instance.stopPaint();
	assert.equal(instance.board[1], 'covered');
	assert.equal(instance.history.length, 1);
	instance.undo();
	assert.equal(instance.board[1], 'clue-1');
	instance.tool = 'clue-2';
	instance.cellAction({ action: 'primary', index: 0 });
	assert.equal(instance.board[0], 'clue-2');
});

test('Board Lab samples underlying states without changing the board or analysis', () => {
	storage.delete('editor');
	const instance = page(context.EditorPage);
	instance.analysis = { forcedMine: [0], forcedSafe: [], solution: [] };
	const analysis = instance.analysis;
	for (const state of instance.tools) {
		instance.board[0] = state;
		instance.cellAction({ action: 'alternate', index: 0 });
		assert.equal(instance.tool, state);
		assert.equal(instance.board[0], state);
		assert.equal(instance.analysis, analysis);
		assert.equal(instance.history.length, 0);
	}
});

test('Board Lab allows long-press sampling and distinguishes touch taps, drags, and cancellation', () => {
	storage.delete('editor');
	const instance = page(context.EditorPage);
	const cell = { dataset: { cellIndex: '0' }, focus() {} };
	const press = { button: 0, isPrimary: true, pointerType: 'touch', pointerId: 1, clientX: 0, clientY: 0, target: { closest: () => cell } };
	instance.startPaintAt(press);
	assert.equal(instance.board[0], 'covered');
	instance.cellAction({ action: 'alternate', index: 0, source: 'long-press' });
	instance.stopPaint({ type: 'pointerup', pointerId: 1 });
	assert.equal(instance.tool, 'covered');
	assert.equal(instance.history.length, 0);
	instance.tool = 'clue-2';
	instance.startPaintAt(press);
	instance.stopPaint({ type: 'pointercancel', pointerId: 1 });
	assert.equal(instance.board[0], 'covered');
	instance.startPaintAt(press);
	instance.stopPaint({ type: 'pointerup', pointerId: 1 });
	assert.equal(instance.board[0], 'clue-2');
	instance.undo();
	context.document = { elementFromPoint: () => ({ closest: () => ({ dataset: { cellIndex: '1' } }) }) };
	instance.$el = { contains: () => true };
	instance.startPaintAt(press);
	instance.paintAt({ pointerId: 1, clientX: 11, clientY: 0 });
	instance.stopPaint({ type: 'pointerup', pointerId: 1 });
	assert.equal(instance.board[0], 'clue-2');
	assert.equal(instance.board[1], 'clue-2');
	assert.equal(instance.history.length, 1);
	instance.undo();
	assert.equal(instance.board[0], 'covered');
	assert.equal(instance.board[1], 'covered');
	delete context.document;
});

test('Board Lab persists its dimensions and valid board state', () => {
	storage.delete('editor');
	let instance = page(context.EditorPage);
	instance.setCell(7, 'flagged');
	let saved = storage.get('editor');
	assert.equal(saved.width, 8);
	assert.equal(saved.height, 8);
	assert.deepEqual(Array.from(saved.board), Array.from(instance.board));

	instance = page(context.EditorPage);
	assert.equal(instance.board[7], 'flagged');
	assert.equal(instance.tool, 'clue-1');
	assert.equal(instance.history.length, 0);
	assert.equal(instance.analysis, undefined);

	storage.set('editor', { width: 9, height: 8, board: Array(72).fill('covered') });
	instance = page(context.EditorPage);
	assert.ok(instance.board.every(state => state === 'covered'));

	storage.set('editor', { width: 8, height: 8, board: Array(64).fill('not-a-cell-state') });
	instance = page(context.EditorPage);
	assert.ok(instance.board.every(state => state === 'covered'));
});

for (const { name, run } of tests) {
	await run();
	console.log(`PASS ${name}`);
}
console.log(`\n${tests.length} Vue controller tests passed.`);
