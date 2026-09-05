// @ts-check
// npm run test:minefield

import { PlayField, PuzzleField } from './minefield.js';

/**
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
function assert(condition, message) {
	if (condition) return;
	throw new Error(message);
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} message
 */
function assertEqual(actual, expected, message) {
	if (Object.is(actual, expected)) return;
	throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
}

function testPlayFieldCalculatesCluesAndRequiresOneStateEntryPerCell() {
	let field = new PlayField(3, 3, new Uint8Array([
		PlayField.MINE, 0, 0,
		0, 0, 0,
		0, 0, PlayField.MINE,
	]));

	assertEqual(field.getClue(0, 0), 0, 'a mine should not count itself as a neighbour');
	assertEqual(field.getClue(1, 1), 2, 'the center should count both corner mines');
	assertEqual(field.isState(2, 2, PlayField.MINE), true, 'state lookup should use the requested coordinates');
	assertThrows(() => new PlayField(2, 2, new Uint8Array(3)), 'state must contain one entry per cell');
}

function testRandomPlayFieldCreatesTheRequestedNumberOfMines() {
	let field = PlayField.createRandom(8, 8, 0.25, () => 0);
	let mineCount = Array.from(field.state).filter((cell) => (cell & PlayField.MINE) !== 0).length;

	assertEqual(mineCount, 16, 'a random field should contain the requested proportion of mines');
}

function testFlagActionTogglesCoveredCellsAndChordsRevealedCells() {
	let field = new PlayField(3, 2, new Uint8Array([
		PlayField.MINE | PlayField.FLAG, 0, 0,
		0, PlayField.REVEALED, 0,
	]));

	field.actionFlag(1, 1);
	assertEqual(field.isState(0, 0, PlayField.REVEALED), false, 'chording should leave a flagged mine covered');
	assertEqual(field.isState(1, 0, PlayField.REVEALED), true, 'chording should reveal an unflagged neighbour');
	assertEqual(field.isState(2, 1, PlayField.REVEALED), true, 'chording should reveal every unflagged neighbour');

	let covered = new PlayField(1, 1);
	covered.actionFlag(0, 0);
	assertEqual(covered.isState(0, 0, PlayField.FLAG), true, 'flagging a covered cell should set its flag');
	covered.actionFlag(0, 0);
	assertEqual(covered.isState(0, 0, PlayField.FLAG), false, 'flagging it again should clear its flag');
}

function testChordRevealsEmptyAreasButNotFlags() {
	let field = new PlayField(4, 1, new Uint8Array([0, 0, 0, PlayField.MINE | PlayField.FLAG]));
	field.actionChord(0, 0);

	assertEqual(field.isState(0, 0, PlayField.REVEALED), true, 'the selected empty cell should be revealed');
	assertEqual(field.isState(2, 0, PlayField.REVEALED), true, 'expansion should include the clue bordering an empty area');
	assertEqual(field.isState(3, 0, PlayField.REVEALED), false, 'expansion should not reveal a flagged mine');
}

function testChordFlagsEveryRemainingMine() {
	let field = new PlayField(3, 2, new Uint8Array([
		PlayField.MINE, PlayField.MINE, PlayField.REVEALED,
		PlayField.REVEALED, PlayField.REVEALED, PlayField.REVEALED,
	]));
	field.actionChord(1, 1);

	assertEqual(field.isState(0, 0, PlayField.FLAG), true, 'a clue should flag its first forced covered mine');
	assertEqual(field.isState(1, 0, PlayField.FLAG), true, 'a clue should flag every forced covered mine');
	assertEqual(field.isState(2, 0, PlayField.FLAG), false, 'a revealed neighbour should never be flagged');
}

function testChordActionDescribesDirectDeductions() {
	let flagsMine = new PlayField(3, 1, new Uint8Array([
		PlayField.MINE,
		PlayField.REVEALED,
		PlayField.REVEALED,
	]));
	assertEqual(flagsMine.getChordAction(1, 0), 'flag', 'a clue whose covered neighbours are all mines should offer flagging');

	let revealsSafe = new PlayField(3, 1, new Uint8Array([
		PlayField.MINE | PlayField.FLAG,
		PlayField.REVEALED,
		0,
	]));
	assertEqual(revealsSafe.getChordAction(1, 0), 'reveal', 'a clue with all mines flagged should offer revealing');
	revealsSafe.actionChord(1, 0);
	assertEqual(revealsSafe.getChordAction(1, 0), undefined, 'a clue with no covered neighbours should have no chord action');
	assertEqual(flagsMine.getChordAction(0, 0), undefined, 'a covered cell should never report a chord action');
}

function testGameOverReasonReportsProgressClearingAndDetonation() {
	let field = new PlayField(2, 1, new Uint8Array([PlayField.MINE, 0]));
	assertEqual(field.gameOverReason(), PlayField.GAME_OVER_FALSE, 'a covered safe cell should keep the game in progress');
	field.actionChord(1, 0);
	assertEqual(field.gameOverReason(), PlayField.GAME_OVER_CLEARED, 'revealing every safe cell should clear the field');
	field.actionChord(0, 0);
	assertEqual(field.gameOverReason(), PlayField.GAME_OVER_DETONATION, 'revealing a mine should take precedence over clearing');
}

function testCheckFlagsReportsOverFlaggedClues() {
	let field = new PuzzleField(3, 2, new Uint8Array([
		PuzzleField.MINE | PuzzleField.FLAG, PuzzleField.MARKED_MINE, 0,
		0, PuzzleField.REVEALED, 0,
	]));

	assertEqual(JSON.stringify(field.checkFlags()), JSON.stringify([[1, 1]]), 'a clue with too many flags should be reported by coordinate');
	field.state[1] &= ~PuzzleField.MARKED_MINE;
	assertEqual(field.checkFlags().length, 0, 'a clue with the correct flag count should not be reported');
}

function testPuzzleMarksValidateAndToggle() {
	let field = new PuzzleField(4, 1, new Uint8Array([
		PuzzleField.ACTIVE | PuzzleField.FORCED_SAFE,
		PuzzleField.MINE | PuzzleField.ACTIVE | PuzzleField.FORCED_MINE,
		PuzzleField.ACTIVE,
		0,
	]));

	assertEqual(field.actionMarkSafe(0, 0, true), true, 'a forced safe move should pass validation');
	assertEqual(field.actionMarkMine(1, 0, true), true, 'a forced mine move should pass validation');
	assertEqual(field.actionMarkSafe(2, 0, true), false, 'an unforced safe move should fail validation');
	assertEqual(field.actionMarkMine(2, 0, true), false, 'an unforced mine move should fail validation');
	assertEqual(field.actionMarkMine(3, 0, true), undefined, 'a cell outside the active frontier should ignore marks');
	assertEqual(field.isPuzzleSolved(), true, 'marking exactly the forced answers should solve the puzzle');

	assertEqual(field.actionMarkMine(1, 0, true), true, 'selecting the same mark should remove it');
	assertEqual(field.isPuzzleSolved(), false, 'removing a forced answer should make the puzzle incomplete');
	assertEqual(field.actionMarkSafe(0, 0, true), true, 'safe marks should toggle off in the same way');
}

function testUncheckedPuzzleMarksStillAffectCompletion() {
	let field = new PuzzleField(3, 1, new Uint8Array([
		PuzzleField.ACTIVE | PuzzleField.FORCED_SAFE,
		PuzzleField.MINE | PuzzleField.ACTIVE | PuzzleField.FORCED_MINE,
		PuzzleField.ACTIVE,
	]));
	field.actionMarkSafe(0, 0, false);
	field.actionMarkMine(1, 0, false);
	field.actionMarkMine(2, 0, false);
	assertEqual(field.isPuzzleSolved(), false, 'an extra unchecked annotation should keep the puzzle unsolved');
	field.actionMarkMine(2, 0, false);
	assertEqual(field.isPuzzleSolved(), true, 'removing the extra annotation should restore the solved state');
}

function testMarkChordDeductionsAndValidation() {
	const F = PuzzleField;
	let field = new F(3, 2, Uint8Array.of(
		F.MINE | F.FLAG, F.ACTIVE | F.FORCED_SAFE, F.ACTIVE | F.FORCED_SAFE,
		F.ACTIVE | F.MARKED_SAFE, F.REVEALED, 0,
	));
	assertEqual(field.actionMarkChord(1, 1, true).length, 0, 'known flags should allow safe deductions');
	assert(field.isState(1, 0, F.MARKED_SAFE) && field.isState(2, 0, F.MARKED_SAFE), 'all forced safe neighbours should be marked');
	const marked = field.state.slice();
	field.actionMarkChord(1, 1, true);
	assert(field.state.every((cell, i) => cell === marked[i]), 'repeated chords must preserve existing marks and board bits');

	field = new F(3, 1, Uint8Array.of(F.MINE | F.ACTIVE | F.FORCED_MINE, F.REVEALED, F.ACTIVE | F.MARKED_SAFE));
	field.actionMarkChord(1, 0, true);
	assert(field.isState(0, 0, F.MARKED_MINE), 'safe marks should allow deduction of remaining mines');

	field = new F(3, 2, Uint8Array.of(
		F.MINE | F.ACTIVE | F.MARKED_MINE, F.ACTIVE | F.FORCED_SAFE, F.ACTIVE,
		F.ACTIVE, F.REVEALED, 0,
	));
	assertEqual(JSON.stringify(field.actionMarkChord(1, 1, true)), '[2,3]', 'report every rejected cell while applying valid deductions');
	assert(field.isState(1, 0, F.MARKED_SAFE), 'mine annotations must count as known mines');
	assert(!field.isState(2, 0, F.MARKED_SAFE), 'rejected cells must remain unchanged');
	assertEqual(field.actionMarkChord(1, 1, false).length, 0, 'deferred chording must not reject unforced answers');
	assert(field.isState(2, 0, F.MARKED_SAFE) && field.isState(0, 1, F.MARKED_SAFE), 'deferred chording should apply all deductions');

	field = new F(3, 1, Uint8Array.of(F.MINE | F.ACTIVE, F.REVEALED, F.ACTIVE));
	const uncertain = field.state.slice();
	field.actionMarkChord(1, 0, false);
	field.actionMarkChord(0, 0, false);
	assert(field.state.every((cell, i) => cell === uncertain[i]), 'uncertain clues and covered cells should do nothing');
}

function testMarkGesturesChordRevealedClues() {
	const F = PuzzleField;
	for (const action of ['actionMarkSafe', 'actionMarkMine']) {
		let field = new F(3, 2, Uint8Array.of(
			F.MINE | F.FLAG, F.ACTIVE | F.FORCED_SAFE, F.ACTIVE,
			F.ACTIVE, F.REVEALED, 0,
		));
		assertEqual(JSON.stringify(field[action](1, 1, true)), '[2,3]', 'either gesture should return every rejected chord index');
		assert(field.isState(1, 0, F.MARKED_SAFE), 'either gesture should apply valid safe deductions');
		assertEqual(JSON.stringify(field[action](1, 1, false)), '[]', 'either gesture should forward deferred validation');
		assert(field.isState(2, 0, F.MARKED_SAFE) && field.isState(0, 1, F.MARKED_SAFE), 'unchecked chords should apply all deductions');
		const marked = field.state.slice();
		field[action](1, 1, false);
		assert(field.state.every((cell, i) => cell === marked[i]), 'repeated gestures on a clue must not remove marks');

		field = new F(3, 1, Uint8Array.of(F.MINE | F.ACTIVE | F.FORCED_MINE, F.REVEALED, F.ACTIVE | F.MARKED_SAFE));
		field[action](1, 0, true);
		assert(field.isState(0, 0, F.MARKED_MINE), 'either gesture should apply mine deductions');
	}
}

function testClearMarksPreservesBoard() {
	const F = PuzzleField;
	let field = new F(3, 1, Uint8Array.of(
		F.MINE | F.ACTIVE | F.FORCED_MINE | F.MARKED_MINE,
		F.ACTIVE | F.FORCED_SAFE | F.MARKED_SAFE,
		F.REVEALED | F.FLAG,
	));
	const before = field.state.slice();
	const clues = field.clues.slice();
	assertEqual(field.actionClearMarks(), true, 'clearing should report removed marks');
	assert(field.state.every((cell, i) => cell === (before[i] & 0x3f)), 'only annotation bits should change');
	assert(field.clues.every((clue, i) => clue === clues[i]), 'clearing must preserve clues');
	assertEqual(field.actionClearMarks(), false, 'clearing an unmarked field should report no change');
}

function testPuzzleCodecRoundTripsWithoutPlayerMarks() {
	let state = new Uint8Array(64);
	state[0] = PuzzleField.REVEALED;
	state[1] = PuzzleField.MINE | PuzzleField.ACTIVE | PuzzleField.FORCED_MINE | PuzzleField.MARKED_MINE;
	state[2] = PuzzleField.ACTIVE | PuzzleField.FORCED_SAFE | PuzzleField.MARKED_SAFE;

	let encoded = new PuzzleField(8, 8, state).encode();
	assert(/^2\.[A-Za-z0-9_-]{64}$/.test(encoded), 'a shared field should use the masked base64url format');
	let decoded = PuzzleField.decode(encoded);
	assert(decoded.state.every((cell, index) => cell === (state[index] & 0x3f)), 'a round trip should retain puzzle state but omit player annotations');
	assertThrows(() => PuzzleField.decode(`1.${'A'.repeat(64)}`), 'a field without active puzzle cells should be rejected');
}

function testBothFieldsCalculateCluesAndValidateCoordinates() {
	for (let Field of [PlayField, PuzzleField]) {
		let field = new Field(2, 2, Uint8Array.of(Field.MINE, 0, 0, 0));
		assertEqual(field.getClue(1, 1), 1, 'both field types should calculate diagonal clues');
		assertThrows(() => field.getIndex(-1, 0), 'negative coordinates should be rejected');
		assertThrows(() => field.getIndex(0, 2), 'coordinates outside the field should be rejected');
		assertThrows(() => new Field(2, 2, new Uint8Array(3)), 'both field types require one state entry per cell');
	}
}

function testPlayFlagsIgnorePuzzleAnnotations() {
	let field = new PlayField(3, 1, Uint8Array.of(
		PlayField.MINE | PlayField.FLAG, PlayField.REVEALED, PuzzleField.MARKED_MINE,
	));
	assertEqual(field.checkFlags().length, 0, 'puzzle annotations must not count as play flags');
	field.actionFlag(2, 0);
	assertEqual(JSON.stringify(field.checkFlags()), '[[1,0]]', 'actual excess flags should be reported');
}

function testLegacyPuzzleLinksStillDecode() {
	let cells = new Uint8Array(64);
	cells[0] = PuzzleField.ACTIVE | PuzzleField.FORCED_SAFE;
	let alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
	let field = PuzzleField.decode('1.' + Array.from(cells, cell => alphabet[cell]).join(''));
	assert(field instanceof PuzzleField, 'decoding must create a puzzle field');
	assert(field.state.every((cell, index) => cell === cells[index]), 'legacy links must preserve their board');
}

/** @param {() => unknown} callback @param {string} message */
function assertThrows(callback, message) {
	let threw = false;
	try {
		callback();
	}
	catch {
		threw = true;
	}
	assert(threw, message);
}

/** @param {Array<() => void | Promise<void>>} testFunctions */
async function runTests(testFunctions) {
	let failures = 0;
	for (let testFn of testFunctions) {
		try {
			await testFn();
			console.log(`PASS ${testFn.name}`);
		}
		catch (error) {
			failures += 1;
			console.error(`FAIL ${testFn.name}`);
			console.error(error instanceof Error ? error.stack ?? error.message : String(error));
		}
	}
	if (failures > 0) {
		console.error(`\n${failures} test${failures === 1 ? '' : 's'} failed.`);
		throw new Error(`Test run failed with ${failures} failing test${failures === 1 ? '' : 's'}.`);
	}
	console.log(`\n${testFunctions.length} tests passed.`);
}

await runTests([
	testBothFieldsCalculateCluesAndValidateCoordinates,
	testPlayFlagsIgnorePuzzleAnnotations,
	testLegacyPuzzleLinksStillDecode,
	testPlayFieldCalculatesCluesAndRequiresOneStateEntryPerCell,
	testRandomPlayFieldCreatesTheRequestedNumberOfMines,
	testFlagActionTogglesCoveredCellsAndChordsRevealedCells,
	testChordRevealsEmptyAreasButNotFlags,
	testChordFlagsEveryRemainingMine,
	testChordActionDescribesDirectDeductions,
	testGameOverReasonReportsProgressClearingAndDetonation,
	testCheckFlagsReportsOverFlaggedClues,
	testPuzzleMarksValidateAndToggle,
	testUncheckedPuzzleMarksStillAffectCompletion,
	testMarkChordDeductionsAndValidation,
	testMarkGesturesChordRevealedClues,
	testClearMarksPreservesBoard,
	testPuzzleCodecRoundTripsWithoutPlayerMarks,
]);
