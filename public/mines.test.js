// @ts-check
// node --experimental-default-type=module public/mines.test.js

import { MineField } from './mines.js';

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

function testMineFieldCalculatesCluesAtEdgesAndCorners() {
	let field = new MineField(3, 3, new Uint8Array([
		MineField.MINE, 0, 0,
		0, 0, 0,
		0, 0, MineField.MINE,
	]));

	assertEqual(field.getClue(0, 0), 0, 'a corner mine should not count itself');
	assertEqual(field.getClue(1, 0), 1, 'a cell beside the corner mine should have one neighbouring mine');
	assertEqual(field.getClue(1, 1), 2, 'the center should count both corner mines');
	assertEqual(field.getClue(2, 1), 1, 'an edge cell should count its neighbouring mine');
	assertEqual(field.isMine(2, 2), true, 'mine lookup should use the requested coordinates');
	assertEqual(field.isMine(1, 1), false, 'safe-cell lookup should use the requested coordinates');
}

function testMineFieldRequiresOneStateEntryPerCell() {
	let threw = false;
	try {
		new MineField(2, 2, new Uint8Array(3));
	}
	catch (error) {
		threw = error instanceof Error && error.message.includes('2x2');
	}
	assert(threw, 'a field with the wrong state length should throw a useful error');
}

function testRandomMineFieldCreatesTheRequestedDensity() {
	let field = MineField.createRandom(8, 8, 0.25, () => 0);
	let mines = Array.from(field.state).filter((cell) => (cell & MineField.MINE) !== 0);

	assertEqual(field.width, 8, 'a random field should keep the requested width');
	assertEqual(field.height, 8, 'a random field should keep the requested height');
	assertEqual(mines.length, 16, 'a random field should contain the requested proportion of mines');
}

function testFlagActionTogglesOnlyCoveredCells() {
	let field = new MineField(2, 1);
	field.actionFlag(0, 0);
	assertEqual(field.isFlagged(0, 0), true, 'flagging a covered cell should set its flag');
	field.actionFlag(0, 0);
	assertEqual(field.isFlagged(0, 0), false, 'flagging it again should clear its flag');
	field.actionReveal(1, 0);
	field.actionFlag(1, 0);
	assertEqual(field.isFlagged(1, 0), false, 'revealed cells should not become flagged');
}

function testRevealDoesNotOpenFlaggedCells() {
	let field = new MineField(2, 1, new Uint8Array([MineField.FLAG, 0]));
	field.actionReveal(0, 0);
	field.actionReveal(1, 0);
	assertEqual(field.isRevealed(0, 0), false, 'revealing a flagged cell should leave it covered');
	assertEqual(field.isRevealed(1, 0), true, 'revealing an unflagged cell should open it');
}

function testRevealExpandsEmptyAreasUpToTheirClues() {
	let field = new MineField(4, 1, new Uint8Array([0, 0, 0, MineField.MINE]));
	field.actionReveal(0, 0);

	assertEqual(field.isRevealed(0, 0), true, 'the selected empty cell should be revealed');
	assertEqual(field.isRevealed(1, 0), true, 'connected empty cells should be revealed');
	assertEqual(field.isRevealed(2, 0), true, 'the clue bordering an empty area should be revealed');
	assertEqual(field.isRevealed(3, 0), false, 'empty-area expansion should not reveal a mine');
}

function testChordRevealsNeighboursOnlyWhenFlagCountMatches() {
	let field = new MineField(3, 2, new Uint8Array([
		MineField.MINE | MineField.FLAG, 0, 0,
		0, MineField.REVEALED, 0,
	]));
	field.actionChord(1, 1);
	assertEqual(field.isRevealed(0, 0), false, 'chording should not reveal a flagged neighbour');
	assertEqual(field.isRevealed(1, 0), true, 'chording should reveal an unflagged neighbour');
	assertEqual(field.isRevealed(2, 1), true, 'chording should reveal all unflagged neighbours');

	let unmatched = new MineField(3, 2, new Uint8Array([
		MineField.MINE, 0, 0,
		0, MineField.REVEALED, 0,
	]));
	unmatched.actionChord(1, 1);
	assertEqual(unmatched.isRevealed(1, 0), false, 'chording should do nothing when the flag count does not match');
}

function testGameOverReasonReportsEachBoardState() {
	let inProgress = new MineField(2, 2, new Uint8Array([
		MineField.MINE, 0,
		0, MineField.REVEALED,
	]));
	assertEqual(inProgress.gameOverReason(), MineField.GAME_OVER_FALSE, 'a partly revealed board should remain in progress');

	let cleared = new MineField(2, 2, new Uint8Array([
		MineField.MINE, MineField.REVEALED,
		MineField.REVEALED, MineField.REVEALED,
	]));
	assertEqual(cleared.gameOverReason(), MineField.GAME_OVER_CLEARED, 'revealing every safe cell should clear the board');

	let detonated = new MineField(2, 2, new Uint8Array([
		MineField.MINE | MineField.REVEALED, MineField.REVEALED,
		MineField.REVEALED, MineField.REVEALED,
	]));
	assertEqual(detonated.gameOverReason(), MineField.GAME_OVER_DETONATION, 'a revealed mine should take precedence over clearing');
}

function testPuzzleFlagsDescribeCoveredFrontierMoves() {
	assertEqual(MineField.ACTIVE, 0x08, 'the active flag must match the Rust wasm layout');
	assertEqual(MineField.FORCED_MINE, 0x10, 'the forced-mine flag must match the Rust wasm layout');
	assertEqual(MineField.FORCED_SAFE, 0x20, 'the forced-safe flag must match the Rust wasm layout');
	assertEqual(MineField.MARKED_MINE, 0x40, 'mine annotations should have their own JavaScript state bit');
	assertEqual(MineField.MARKED_SAFE, 0x80, 'safe annotations should have their own JavaScript state bit');

	let field = new MineField(2, 1, new Uint8Array([
		MineField.MINE | MineField.ACTIVE | MineField.FORCED_MINE,
		MineField.ACTIVE | MineField.FORCED_SAFE,
	]));

	assertEqual(field.isActive(0, 0), true, 'a generated frontier cell should be active');
	assertEqual(field.isForcedMine(0, 0), true, 'a forced mine should retain its hidden answer bit');
	assertEqual(field.isForcedSafe(1, 0), true, 'a forced safe cell should retain its hidden answer bit');
	assertEqual(field.isRevealed(1, 0), false, 'the generator must not reveal a forced-safe move');
	assertEqual(field.gameOverReason(), MineField.GAME_OVER_FALSE, 'a fresh puzzle should remain unsolved');

	field.actionMarkSafe(1, 0);
	assertEqual(field.isMarkedSafe(1, 0), true, 'a safe answer should use the safe annotation bit');
	assertEqual(field.isRevealed(1, 0), false, 'marking a safe answer must not reveal it');
	assertEqual(field.gameOverReason(), MineField.GAME_OVER_FALSE, 'one remaining forced move should keep the puzzle open');
	field.actionMarkMine(0, 0);
	assertEqual(field.isMarkedMine(0, 0), true, 'a mine answer should use the mine annotation bit');
	assertEqual(field.isFlagged(0, 0), false, 'marking a mine answer must not flag it');
	assertEqual(field.gameOverReason(), MineField.GAME_OVER_CLEARED, 'making every forced move should solve the frontier puzzle');
}

function testPuzzleRejectsUnforcedAndInactiveMoves() {
	let field = new MineField(3, 1, new Uint8Array([
		MineField.ACTIVE,
		MineField.ACTIVE | MineField.FORCED_SAFE,
		0,
	]));

	field.actionMarkSafe(2, 0);
	field.actionMarkMine(2, 0);
	assertEqual(field.isMarkedSafe(2, 0), false, 'cells outside a puzzle frontier should reject safe annotations');
	assertEqual(field.isMarkedMine(2, 0), false, 'cells outside a puzzle frontier should reject mine annotations');

	field.actionMarkSafe(0, 0);
	assertEqual(field.isIncorrect(0, 0), true, 'marking an ambiguous cell should be an incorrect tactics move');
	assertEqual(field.isMarkedSafe(0, 0), false, 'an incorrect safe annotation should not be stored');
	assertEqual(field.gameOverReason(), MineField.GAME_OVER_DETONATION, 'an unforced move should fail the puzzle even when it happens to be safe');
	assertEqual(field.consumeIncorrect(), 0, 'study mode should be able to consume the incorrect cell for feedback');
	assertEqual(field.gameOverReason(), MineField.GAME_OVER_FALSE, 'consuming study feedback should let the puzzle continue');
	field.actionMarkSafe(1, 0);
	assertEqual(field.gameOverReason(), MineField.GAME_OVER_CLEARED, 'the puzzle should remain solvable after an incorrect study guess');
}

function testPuzzleAnnotationsAreDistinctFromNormalBoardActions() {
	let field = new MineField(2, 1, new Uint8Array([
		MineField.ACTIVE | MineField.FORCED_SAFE,
		MineField.MINE | MineField.ACTIVE | MineField.FORCED_MINE,
	]));

	field.actionReveal(0, 0);
	field.actionFlag(1, 0);
	field.actionChord(0, 0);
	assertEqual(field.isRevealed(0, 0), false, 'ordinary reveal and chord actions should be inert in puzzle mode');
	assertEqual(field.isFlagged(1, 0), false, 'ordinary flag actions should be inert in puzzle mode');

	field.actionMarkSafe(0, 0);
	assertEqual(field.isMarkedSafe(0, 0), true, 'the safe annotation should be applied explicitly');
	field.actionMarkMine(0, 0);
	assertEqual(field.isMarkedSafe(0, 0), true, 'an incorrect replacement should preserve the existing correct annotation');
	assertEqual(field.isMarkedMine(0, 0), false, 'an incorrect replacement should not apply the requested annotation');
	assertEqual(field.consumeIncorrect(), -1, 'an opposite input on an already marked cell should be ignored');
	field.actionMarkSafe(0, 0);
	assertEqual(field.isMarkedSafe(0, 0), false, 'selecting the same annotation again should remove it');
}

function testPuzzleChordCompletesDirectClueDeductions() {
	let safeChord = new MineField(3, 2, new Uint8Array([
		MineField.MINE | MineField.FLAG, MineField.MINE | MineField.ACTIVE | MineField.FORCED_MINE, MineField.ACTIVE | MineField.FORCED_SAFE,
		MineField.REVEALED, MineField.REVEALED, MineField.ACTIVE | MineField.FORCED_SAFE,
	]));
	safeChord.actionMarkMine(1, 0);
	let safeMarks = safeChord.actionChordMarks(1, 1);
	assertEqual(safeMarks.length, 2, 'a satisfied clue should mark every remaining active neighbour safe');
	assertEqual(safeChord.isMarkedSafe(2, 0), true, 'safe chording should annotate the first remaining neighbour');
	assertEqual(safeChord.isMarkedSafe(2, 1), true, 'safe chording should annotate every remaining neighbour');

	let mineChord = new MineField(3, 2, new Uint8Array([
		MineField.MINE | MineField.ACTIVE | MineField.FORCED_MINE, MineField.MINE | MineField.ACTIVE | MineField.FORCED_MINE, MineField.ACTIVE | MineField.FORCED_SAFE,
		MineField.REVEALED, MineField.REVEALED, MineField.ACTIVE | MineField.FORCED_SAFE,
	]));
	mineChord.actionMarkSafe(2, 0);
	mineChord.actionMarkSafe(2, 1);
	let mineMarks = mineChord.actionChordMarks(1, 1);
	assertEqual(mineMarks.length, 2, 'a clue with only enough unknown cells for its mines should mark them all as mines');
	assertEqual(mineChord.isMarkedMine(0, 0), true, 'mine chording should annotate the first unknown neighbour');
	assertEqual(mineChord.isMarkedMine(1, 0), true, 'mine chording should annotate every unknown neighbour');
}

function testSharedPuzzleCodecUsesSixBitsPerCell() {
	let puzzle = new Uint8Array(64);
	puzzle[0] = MineField.MINE | MineField.REVEALED;
	puzzle[1] = MineField.MINE | MineField.ACTIVE | MineField.FORCED_MINE | MineField.MARKED_MINE;
	puzzle[2] = MineField.ACTIVE | MineField.FORCED_SAFE | MineField.MARKED_SAFE;

	let payload = new MineField(8, 8, puzzle).encode();
	assert(/^2\.[A-Za-z0-9_-]{64}$/.test(payload), 'each masked six-bit cell should encode to one base64url character');
	assert(payload !== `2.DZo${'A'.repeat(61)}`, 'the encoded data should not expose the raw cell pattern');
	let decoded = MineField.decode(payload);
	assert(decoded.state.every((cell, index) => cell === (puzzle[index] & 0x3f)), 'a shared puzzle round trip should preserve its six puzzle bits and remove player annotations');

	let legacy = MineField.decode(`1.DZo${'A'.repeat(61)}`);
	assert(legacy.state.every((cell, index) => cell === (puzzle[index] & 0x3f)), 'links created with the unmasked version 1 format should remain valid');
}

function testSharedPuzzleCodecRejectsInvalidPayloads() {
	let invalidPayloads = [
		'1.short',
		`3.${'A'.repeat(64)}`,
		`1.${'!'.repeat(64)}`,
		`2.${'!'.repeat(64)}`,
		`1.${'A'.repeat(64)}`,
		new MineField(8, 8, new Uint8Array(64)).encode(),
		`1.I${'A'.repeat(63)}`,
	];
	for (let payload of invalidPayloads) {
		let threw = false;
		try {
			MineField.decode(payload);
		}
		catch {
			threw = true;
		}
		assert(threw, `invalid shared puzzle payload should be rejected: ${payload.slice(0, 10)}`);
	}
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
	testMineFieldCalculatesCluesAtEdgesAndCorners,
	testMineFieldRequiresOneStateEntryPerCell,
	testRandomMineFieldCreatesTheRequestedDensity,
	testFlagActionTogglesOnlyCoveredCells,
	testRevealDoesNotOpenFlaggedCells,
	testRevealExpandsEmptyAreasUpToTheirClues,
	testChordRevealsNeighboursOnlyWhenFlagCountMatches,
	testGameOverReasonReportsEachBoardState,
	testPuzzleFlagsDescribeCoveredFrontierMoves,
	testPuzzleRejectsUnforcedAndInactiveMoves,
	testPuzzleAnnotationsAreDistinctFromNormalBoardActions,
	testPuzzleChordCompletesDirectClueDeductions,
	testSharedPuzzleCodecUsesSixBitsPerCell,
	testSharedPuzzleCodecRejectsInvalidPayloads,
]);
