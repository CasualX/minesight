// @ts-check

import { MineField } from './mines.js';
import { feedbackEffects } from './feedback.js';
import { gameSounds } from './sounds.js';

const BOARD_SIZE = 8;
const PUZZLE_ATTEMPTS = 1000;
const GIVE_UP_HOLD_MS = 900;
const SCRATCH_TAP_DISTANCE = .01;
const SCRATCH_ERASER_RADIUS = .025;
const SCRATCH_MARK_SIZE = .04125;
const SCRATCH_MARK_ANIMATION_MS = 220;
const MINESIGHT_STORAGE_KEY = 'minesight';
const SHARED_PUZZLE_PARAMETER = 'p';
const TUTORIAL_PARAMETER = 'tutorial';
const CHALLENGE_MODE_PARAMETER = 'challenge';
const CHALLENGE_SEED_PARAMETER = 'seed';
const CHALLENGE_TIME_PARAMETER = 'time';
const MAX_CHALLENGE_SEED = 0xffff_ffff_ffff_ffffn;
/** @type {Record<string, [number, number]>} */
const CELL_FOCUS_DIRECTIONS = {
	ArrowUp: [0, -1],
	ArrowDown: [0, 1],
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
};

/** @param {number} elapsedMs */
function formatElapsedTime(elapsedMs) {
	let totalHundredths = Math.floor(elapsedMs / 10);
	let totalHours = Math.floor(totalHundredths / 360000);
	let days = Math.floor(totalHours / 24);
	let hours = totalHours % 24;
	let minutes = Math.floor(totalHundredths / 6000) % 60;
	let seconds = Math.floor(totalHundredths / 100) % 60;
	let hundredths = totalHundredths % 100;
	let time = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;

	if (hours > 0) time = `${String(hours).padStart(2, '0')}:${time}`;
	if (days > 0) time = `${days}d ${time}`;
	return time;
}

/**
 * @param {{ x: number, y: number }} point
 * @param {{ x: number, y: number }} start
 * @param {{ x: number, y: number }} end
 */
function pointSegmentDistance(point, start, end) {
	let dx = end.x - start.x;
	let dy = end.y - start.y;
	let lengthSquared = dx * dx + dy * dy;
	if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
	let progress = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
	return Math.hypot(point.x - (start.x + dx * progress), point.y - (start.y + dy * progress));
}

/**
 * @param {{ x: number, y: number }} firstStart
 * @param {{ x: number, y: number }} firstEnd
 * @param {{ x: number, y: number }} secondStart
 * @param {{ x: number, y: number }} secondEnd
 */
function segmentDistance(firstStart, firstEnd, secondStart, secondEnd) {
	let cross = (start, end, point) =>
		(end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
	let boundsOverlap = Math.max(firstStart.x, firstEnd.x) >= Math.min(secondStart.x, secondEnd.x)
		&& Math.max(secondStart.x, secondEnd.x) >= Math.min(firstStart.x, firstEnd.x)
		&& Math.max(firstStart.y, firstEnd.y) >= Math.min(secondStart.y, secondEnd.y)
		&& Math.max(secondStart.y, secondEnd.y) >= Math.min(firstStart.y, firstEnd.y);
	let intersects = boundsOverlap
		&& cross(firstStart, firstEnd, secondStart) * cross(firstStart, firstEnd, secondEnd) <= 0
		&& cross(secondStart, secondEnd, firstStart) * cross(secondStart, secondEnd, firstEnd) <= 0;
	if (intersects) return 0;
	return Math.min(
		pointSegmentDistance(firstStart, secondStart, secondEnd),
		pointSegmentDistance(firstEnd, secondStart, secondEnd),
		pointSegmentDistance(secondStart, firstStart, firstEnd),
		pointSegmentDistance(secondEnd, firstStart, firstEnd),
	);
}

const TUTORIAL_STEPS = [
	{
		x: 1, y: 0, action: 'mine',
		bubble: 'right',
		title: 'Mark a mine',
		message: 'The 1 on the right touches only one covered square. Long-press or right-click that square to mark it as a mine.',
	},
	{
		x: 0, y: 0, action: 'safe',
		bubble: 'below',
		title: 'Mark a square safe',
		message: 'The mine you marked already satisfies the 1 below it. That proves the other covered square is safe. Tap it.',
	},
	{
		x: 6, y: 5, action: 'ambiguous',
		bubble: 'left',
		title: 'Leave uncertain squares alone',
		message: 'The mine could be in several places around these two 1s, so the highlighted square could be safe or mined. Tap it to try a guess.',
	},
];

function createTutorialField() {
	let width = BOARD_SIZE;
	let height = BOARD_SIZE;
	let state = new Uint8Array(width * height);
	/** @type {(x: number, y: number, flags: number) => void} */
	let set = (x, y, flags) => { state[y * width + x] = flags; };

	// The upper revealed region has a normal one-cell frontier. Its top-right 0
	// leaves the 1 with a single possible mine, which then proves the left cell safe.
	set(0, 0, MineField.ACTIVE | MineField.FORCED_SAFE);
	set(1, 0, MineField.MINE | MineField.ACTIVE | MineField.FORCED_MINE);
	set(2, 0, MineField.REVEALED);
	set(3, 0, MineField.REVEALED);
	set(4, 0, MineField.ACTIVE | MineField.FORCED_SAFE);
	set(0, 1, MineField.REVEALED);
	set(1, 1, MineField.REVEALED);
	set(2, 1, MineField.REVEALED);
	set(3, 1, MineField.REVEALED);
	set(4, 1, MineField.ACTIVE | MineField.FORCED_SAFE);
	set(0, 2, MineField.REVEALED);
	set(1, 2, MineField.REVEALED);
	set(2, 2, MineField.REVEALED);
	set(3, 2, MineField.REVEALED);
	set(4, 2, MineField.ACTIVE | MineField.FORCED_SAFE);
	set(0, 3, MineField.ACTIVE | MineField.FORCED_SAFE);
	set(1, 3, MineField.ACTIVE | MineField.FORCED_SAFE);
	set(2, 3, MineField.ACTIVE | MineField.FORCED_SAFE);
	set(3, 3, MineField.ACTIVE | MineField.FORCED_SAFE);
	set(4, 3, MineField.ACTIVE | MineField.FORCED_SAFE);

	// The lower revealed pair also has a complete frontier. Four cells are shared
	// by both 1s, so the mine can occupy any one of them. The bottom rows stay inactive.
	set(5, 3, MineField.ACTIVE | MineField.FORCED_SAFE);
	set(6, 3, MineField.ACTIVE);
	set(7, 3, MineField.ACTIVE);
	set(5, 4, MineField.ACTIVE | MineField.FORCED_SAFE);
	set(6, 4, MineField.REVEALED);
	set(7, 4, MineField.REVEALED);
	set(5, 5, MineField.ACTIVE | MineField.FORCED_SAFE);
	set(6, 5, MineField.ACTIVE);
	set(7, 5, MineField.MINE | MineField.ACTIVE);
	return new MineField(width, height, state);
}

const EASY_DIFFICULTY = {
	key: 'easy',
	label: 'Easy',
	generator: 'randomEasyPuzzle',
	description: 'Start with a wide-open board and use the nearby clues. Each safe square or mine takes only a short chain of reasoning to find.',
};
const MEDIUM_DIFFICULTY = {
	key: 'medium',
	label: 'Medium',
	generator: 'randomMediumPuzzle',
	description: 'Compare clues across more of the board. You may need to connect several deductions before a square is certain.',
};
const HARD_DIFFICULTY = {
	key: 'hard',
	label: 'Hard',
	generator: 'randomHardPuzzle',
	description: 'Use basic deductions on a denser board where the answers may be farther apart and require more scanning.',
};
const EXPERT_DIFFICULTY = {
	key: 'expert',
	label: 'Expert',
	generator: 'randomExpertPuzzle',
	description: 'The clues overlap across a larger, messier area. Keep track of several possible mine layouts at once.',
};
const STUDY_DIFFICULTIES = [
	EASY_DIFFICULTY,
	MEDIUM_DIFFICULTY,
	HARD_DIFFICULTY,
	EXPERT_DIFFICULTY,
];
const CHALLENGE_MODES = [
	{
		key: 'hard',
		label: 'Hard Challenge',
		route: [
			{ difficulty: EASY_DIFFICULTY, puzzleCount: 4 },
			{ difficulty: MEDIUM_DIFFICULTY, puzzleCount: 4 },
			{ difficulty: HARD_DIFFICULTY, puzzleCount: 4 },
		],
	},
	{
		key: 'expert',
		label: 'Expert Challenge',
		route: [
			{ difficulty: EASY_DIFFICULTY, puzzleCount: 3 },
			{ difficulty: MEDIUM_DIFFICULTY, puzzleCount: 3 },
			{ difficulty: HARD_DIFFICULTY, puzzleCount: 3 },
			{ difficulty: EXPERT_DIFFICULTY, puzzleCount: 3 },
		],
	},
];

/** @param {unknown} value */
function parseChallengeSeed(value) {
	if (typeof value !== 'string' || !/^\s*[0-9a-f]+\s*$/i.test(value)) return undefined;
	try {
		let seed = BigInt(`0x${value.trim()}`);
		return seed <= MAX_CHALLENGE_SEED ? seed : undefined;
	}
	catch {
		return undefined;
	}
}

/** @param {unknown} value */
function parseChallengeTime(value) {
	if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
	let elapsedMs = Number(value);
	return Number.isSafeInteger(elapsedMs) ? elapsedMs : undefined;
}

/** @param {URL} url */
function resolveUrlGame(url) {
	if (url.searchParams.has(SHARED_PUZZLE_PARAMETER)) return { mode: 'shared' };

	let modeKey = url.searchParams.get(CHALLENGE_MODE_PARAMETER);
	if (modeKey !== null && CHALLENGE_MODES.some(({ key }) => key === modeKey)) {
		let seedText = url.searchParams.get(CHALLENGE_SEED_PARAMETER);
		let timeText = url.searchParams.get(CHALLENGE_TIME_PARAMETER);
		return {
			mode: 'challenge',
			modeKey,
			seed: seedText === null ? undefined : parseChallengeSeed(seedText),
			time: timeText === null ? undefined : parseChallengeTime(timeText),
		};
	}

	if (url.searchParams.has(TUTORIAL_PARAMETER)) return { mode: 'tutorial' };
	return { mode: 'stored' };
}

/**
 * @param {string | URL} source
 * @param {string} modeKey
 * @param {bigint} seed
 * @param {number | undefined} elapsedMs
 */
function createChallengeShareUrl(source, modeKey, seed, elapsedMs) {
	let url = new URL(source);
	url.searchParams.delete(SHARED_PUZZLE_PARAMETER);
	url.searchParams.delete(TUTORIAL_PARAMETER);
	url.searchParams.set(CHALLENGE_MODE_PARAMETER, modeKey);
	url.searchParams.set(CHALLENGE_SEED_PARAMETER, seed.toString(16));
	if (elapsedMs === undefined) url.searchParams.delete(CHALLENGE_TIME_PARAMETER);
	else url.searchParams.set(CHALLENGE_TIME_PARAMETER, String(elapsedMs));
	return url;
}

function loadMinesightData() {
	try {
		let data = JSON.parse(window.localStorage.getItem(MINESIGHT_STORAGE_KEY) || '{}');
		return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
	}
	catch {
		return {};
	}
}

/**
 * @param {string} key
 * @param {unknown} value
 */
function saveMinesightData(key, value) {
	try {
		let data = loadMinesightData();
		data[key] = value;
		window.localStorage.setItem(MINESIGHT_STORAGE_KEY, JSON.stringify(data));
	}
	catch {}
}

function isLocalDevelopment() {
	return ['', 'localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
}

/** @type {WebAssembly.Exports | undefined} */
let wasm;
/** @type {{ cells: Uint8Array, seed: bigint, attempts: number } | undefined} */
let generatedPuzzle;
/** @type {Promise<void> | undefined} */
let generatorLoadPromise;

async function loadPuzzleGenerator() {
	const imports = {
		env: {
			/**
			 * @param {number} seedLow
			 * @param {number} seedHigh
			 * @param {number} attempts
			 * @param {number} pointer
			 * @param {number} length
			 */
			resultPuzzle(seedLow, seedHigh, attempts, pointer, length) {
				if (!wasm || !(wasm.memory instanceof WebAssembly.Memory)) {
					throw new Error('wasm returned a puzzle before exposing its memory');
				}
				let cells = new Uint8Array(wasm.memory.buffer, pointer, length).slice();
				let seed = BigInt(seedLow >>> 0) | BigInt(seedHigh >>> 0) << 32n;
				generatedPuzzle = { cells, seed, attempts };
			},
		},
	};

	let response = await fetch('./minetacs.wasm');
	if (!response.ok) throw new Error(`wasm request failed (${response.status})`);
	let result;
	try {
		result = await WebAssembly.instantiateStreaming(response.clone(), imports);
	}
	catch {
		result = await WebAssembly.instantiate(await response.arrayBuffer(), imports);
	}
	wasm = result.instance.exports;
}

async function ensurePuzzleGenerator() {
	if (wasm) return;
	if (!generatorLoadPromise) {
		generatorLoadPromise = loadPuzzleGenerator().finally(() => {
			generatorLoadPromise = undefined;
		});
	}
	await generatorLoadPromise;
}

function takeGeneratedPuzzle() {
	let puzzle = generatedPuzzle;
	generatedPuzzle = undefined;
	return puzzle;
}

/**
 * Invokes the raw WASM search ABI once for a complete jump-separated attempt series.
 * The imported result callback must make the generated result available through
 * `takeResult` before the exported function returns.
 *
 * @template T
 * @param {(seedLow: number, seedHigh: number, attempts: number) => unknown} search
 * @param {bigint} seed
 * @param {number} attempts
 * @param {() => T | undefined} takeResult
 * @returns {T | undefined}
 */
export function invokePuzzleSearch(search, seed, attempts, takeResult) {
	if (seed < 0n || seed > 0xffff_ffff_ffff_ffffn) {
		throw new Error('puzzle seed must be an unsigned 64-bit integer');
	}
	if (!Number.isInteger(attempts) || attempts < 0 || attempts > 0xffff_ffff) {
		throw new Error('attempts must be an unsigned 32-bit integer');
	}

	let found = Boolean(search(
		Number(seed & 0xffff_ffffn),
		Number(seed >> 32n),
		attempts,
	));
	let result = takeResult();
	if (found && !result) throw new Error('wasm reported success without returning a puzzle');
	if (!found && result) throw new Error('wasm returned a puzzle while reporting failure');
	return result;
}

/**
 * @param {{ generator: string }} difficulty
 * @param {() => boolean} shouldContinue
 */
async function generateField(difficulty, shouldContinue) {
	await ensurePuzzleGenerator();
	if (!shouldContinue()) return undefined;
	let generatePuzzle = wasm?.[difficulty.generator];
	if (typeof generatePuzzle !== 'function') {
		throw new Error('the Rust puzzle generator is not loaded');
	}
	let search = /** @type {(seedLow: number, seedHigh: number, attempts: number) => unknown} */ (generatePuzzle);

	while (shouldContinue()) {
		let entropy = new Uint32Array(2);
		crypto.getRandomValues(entropy);
		let seed = BigInt(entropy[0]) | BigInt(entropy[1]) << 32n;

		generatedPuzzle = undefined;
		let puzzle = invokePuzzleSearch(search, seed, PUZZLE_ATTEMPTS, takeGeneratedPuzzle);
		if (puzzle) {
			if (puzzle.cells.length !== BOARD_SIZE * BOARD_SIZE) {
				throw new Error(`wasm returned ${puzzle.cells.length} cells instead of 64`);
			}
			if (!shouldContinue()) return undefined;
			return {
				field: new MineField(BOARD_SIZE, BOARD_SIZE, puzzle.cells),
				seed: puzzle.seed,
				attempts: puzzle.attempts,
			};
		}

		// Give Alpine's state changes a chance to paint before trying a fresh seed.
		await yieldToBrowser();
	}
	return undefined;
}

/** Returns a uniformly distributed unsigned 64-bit seed. */
function randomChallengeSeed() {
	let entropy = new Uint32Array(2);
	crypto.getRandomValues(entropy);
	return BigInt(entropy[0]) | BigInt(entropy[1]) << 32n;
}

/**
 * Generates a puzzle from a deterministic sequence beginning at `seed`.
 *
 * @param {{ generator: string }} difficulty
 * @param {bigint} seed
 * @param {() => boolean} shouldContinue
 */
async function generateSeededField(difficulty, seed, shouldContinue) {
	await ensurePuzzleGenerator();
	if (!shouldContinue()) return undefined;
	let generatePuzzle = wasm?.[difficulty.generator];
	if (typeof generatePuzzle !== 'function') {
		throw new Error('the Rust puzzle generator is not loaded');
	}
	let search = /** @type {(seedLow: number, seedHigh: number, attempts: number) => unknown} */ (generatePuzzle);
	let candidateSeed = seed;

	while (shouldContinue()) {
		generatedPuzzle = undefined;
		let puzzle = invokePuzzleSearch(search, candidateSeed, PUZZLE_ATTEMPTS, takeGeneratedPuzzle);
		if (puzzle) {
			if (puzzle.cells.length !== BOARD_SIZE * BOARD_SIZE) {
				throw new Error(`wasm returned ${puzzle.cells.length} cells instead of 64`);
			}
			if (!shouldContinue()) return undefined;
			return {
				field: new MineField(BOARD_SIZE, BOARD_SIZE, puzzle.cells),
				seed: puzzle.seed,
				attempts: puzzle.attempts,
			};
		}
		candidateSeed = candidateSeed === MAX_CHALLENGE_SEED ? 0n : candidateSeed + 1n;
		await yieldToBrowser();
	}
	return undefined;
}

/** Lets the browser paint before another synchronous puzzle-generation attempt. */
function yieldToBrowser() {
	return new Promise((resolve) => {
		if (document.visibilityState === 'visible') {
			window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
		}
		else {
			window.setTimeout(resolve, 0);
		}
	});
}

/** @param {{ field: MineField }} puzzle */
function challengePuzzleSquareCount(puzzle) {
	let forced = 0;
	let ambiguous = 0;
	for (let cell of puzzle.field.state) {
		if ((cell & (MineField.FORCED_MINE | MineField.FORCED_SAFE)) !== 0) forced += 1;
		else if ((cell & MineField.ACTIVE) !== 0) ambiguous += 1;
	}
	return forced;// + ambiguous;
}

/**
 * @param {Array<{ field: MineField, seed: bigint, attempts: number }>} puzzles
 * @param {Array<{ puzzleCount: number }>} route
 */
function sortChallengeTiers(puzzles, route) {
	let start = 0;
	for (let { puzzleCount } of route) {
		let tier = puzzles.slice(start, start + puzzleCount);
		tier.sort((left, right) => challengePuzzleSquareCount(left) - challengePuzzleSquareCount(right));
		puzzles.splice(start, tier.length, ...tier);
		start += puzzleCount;
	}
}

/** @typedef {'tutorial' | 'study' | 'challenge' | 'shared'} GameMode */
/** @typedef {'playing' | 'cleared' | 'failed' | 'gave-up' | 'complete'} GameResult */
/** @typedef {'cleared' | 'failed'} ChallengeResult */
/** @typedef {{ field: MineField, seed: bigint, result: GameResult, hintUsed: boolean, streak: number, ready: boolean }} StudyState */

function createMinesight() {
	let stored = loadMinesightData();
	/** @type {ResizeObserver | undefined} */
	let scratchResizeObserver;
	/** @type {MineField | undefined} */
	let sharedPuzzle;
	let sharedPuzzleError = '';
	let initialUrl = new URL(window.location.href);
	let sharedPayload = initialUrl.searchParams.get(SHARED_PUZZLE_PARAMETER);
	let urlGame = resolveUrlGame(initialUrl);
	if (sharedPayload !== null) {
		try {
			sharedPuzzle = MineField.decode(sharedPayload);
		}
		catch {
			sharedPuzzleError = 'This shared puzzle link is invalid.';
		}
	}
	gameSounds.setEnabled(stored.soundEnabled !== false);
	let storedStudy = stored?.study ?? {};
	let difficultyKey = STUDY_DIFFICULTIES.some(({ key }) => key === storedStudy.difficultyKey) ? storedStudy.difficultyKey : 'easy';
	let studyStreaks = Object.fromEntries(STUDY_DIFFICULTIES.map(({ key }) => {
		let streak = storedStudy.difficulties?.[key]?.streak;
		return [key, Math.max(0, Number.parseInt(streak) || 0)];
	}));
	let storedMode = ['study', 'challenge'].includes(stored.mode) ? stored.mode : 'tutorial';
	let savedChallengeModeKey = stored.challengeModeKey ?? 'expert';
	let challengeModeKey = CHALLENGE_MODES.some(({ key }) => key === savedChallengeModeKey) ? savedChallengeModeKey : CHALLENGE_MODES[0].key;
	if (urlGame.mode === 'challenge') challengeModeKey = urlGame.modeKey;
	let challengeSeed = urlGame.mode === 'challenge' && urlGame.seed !== undefined ? urlGame.seed : randomChallengeSeed();
	/** @type {Record<string, StudyState | undefined>} */
	let studyStates = Object.fromEntries(STUDY_DIFFICULTIES.map(({ key }) => {
		let saved = storedStudy.difficulties?.[key];
		if (!Array.isArray(saved?.board?.cells)) return [key, undefined];
		if (saved.board.difficultyKey !== key) return [key, undefined];
		try {
			return [key, {
				field: new MineField(BOARD_SIZE, BOARD_SIZE, Uint8Array.from(saved.board.cells)),
				seed: BigInt(saved.board.seed),
				result: saved.board.result === 'cleared' ? 'cleared' : 'playing',
				hintUsed: Boolean(saved.board.hintUsed),
				streak: studyStreaks[key],
				ready: true,
			}];
		}
		catch {
			return [key, undefined];
		}
	}));
	return {
		/** @type {GameMode} */
		mode: urlGame.mode === 'shared' ? 'shared'
			: urlGame.mode === 'challenge' ? 'challenge'
				: urlGame.mode === 'tutorial' ? 'tutorial' : storedMode,
		soundEnabled: gameSounds.enabled,
		actionsInverted: false,
		/** @type {GameResult} */
		result: 'playing',
		difficultyKey,
		difficulties: STUDY_DIFFICULTIES,
		challengeModes: CHALLENGE_MODES,
		challengeModeKey,
		challengeSeed,
		challengeReceived: urlGame.mode === 'challenge',
		challengeTargetMs: urlGame.mode === 'challenge' ? urlGame.time : undefined,
		challengeIndex: 0,
		challengeStarted: false,
		challengePreparing: false,
		challengePreparationId: 0,
		studyPreparationId: 0,
		boardPreparing: false,
		studySearchingVisible: false,
		studyBoardReady: false,
		/** @type {Record<string, StudyState | undefined>} */
		studyStates,
		/** @type {Array<{ field: MineField, seed: bigint, attempts: number }>} */
		challengePuzzles: [],
		/** @type {ChallengeResult[]} */
		challengeResults: [],
		elapsedMs: 0,
		studyStreaks,
		studyStreak: studyStreaks[difficultyKey],
		hintUsed: false,
		tutorialStep: 0,
		keyboardFocusIndex: -1,
		boardNumber: 0,
		boardSeed: 0n,
		revision: 0,
		incorrectCellIndex: -1,
		incorrectFeedbackMessage: '',
		shareFeedback: '',
		sharedPuzzleError,
		engineError: '',
		/** @type {MineField} */
		field: new MineField(BOARD_SIZE, BOARD_SIZE),
		/** @type {number | undefined} */
		timerId: undefined,
		/** @type {number | undefined} */
		timerLastTick: undefined,
		/** @type {number | undefined} */
		incorrectFeedbackTimerId: undefined,
		/** @type {number | undefined} */
		studySearchingTimerId: undefined,
		/** @type {number | undefined} */
		shareFeedbackTimerId: undefined,
		/** @type {number | undefined} */
		giveUpTimerId: undefined,
		giveUpHolding: false,
		giveUpHoldDuration: GIVE_UP_HOLD_MS,
		scratchActive: false,
		scratchTool: 'pencil',
		scratchColor: 'graphite',
		scratchColors: [
			{ key: 'graphite', label: 'Graphite' },
			{ key: 'blue', label: 'Blue' },
			{ key: 'red', label: 'Red' },
		],
		/** @type {Array<{ color: string, points: Array<{ x: number, y: number }> }>} */
		scratchStrokes: [],
		/** @type {{ color: string, points: Array<{ x: number, y: number }> } | undefined} */
		scratchStroke: undefined,
		/** @type {{ x: number, y: number } | undefined} */
		scratchEraserPoint: undefined,
		init() {
			if (isLocalDevelopment()) {
				Object.assign(window, {
					minesightTestChallengeEnd: (failedCount = 0) => this.showChallengeTestEnd(failedCount),
				});
			}
			this.$watch('boardNumber', () => this.resetScratchPad());
			this.$nextTick(() => this.setupScratchPad());
			if (sharedPuzzleError) return;
			if (sharedPuzzle) {
				this.field = sharedPuzzle;
				this.engineError = '';
				this.boardNumber += 1;
				this.revision += 1;
				return;
			}
			if (this.mode === 'tutorial') {
				this.startTutorial();
				return;
			}
			if (this.mode === 'challenge') {
				void this.prepareChallenge();
				return;
			}
			if (!this.restoreStudyState() && !this.engineError) this.newStudyBoard();
		},

		destroy() {
			this.challengePreparationId += 1;
			this.studyPreparationId += 1;
			this.boardPreparing = false;
			this.stopTimer();
			this.clearIncorrectFeedback();
			this.clearStudySearchingDelay();
			if (this.shareFeedbackTimerId !== undefined) window.clearTimeout(this.shareFeedbackTimerId);
			this.cancelGiveUpGesture();
			scratchResizeObserver?.disconnect();
		},

		get currentDifficulty() {
			if (this.mode === 'challenge') {
				return this.challengeGroups.find(({ start, puzzleCount }) => (
					this.challengeIndex >= start && this.challengeIndex < start + puzzleCount
				))?.difficulty ?? this.challengeGroups[0].difficulty;
			}
			return STUDY_DIFFICULTIES.find((difficulty) => difficulty.key === this.difficultyKey) ?? STUDY_DIFFICULTIES[0];
		},

		get studyModeTitle() {
			return this.challengeRunActive ? 'End your challenge before switching to Study' : '';
		},

		get soundToggleClass() {
			return this.soundEnabled ? '' : 'muted';
		},

		get soundToggleText() {
			return this.soundEnabled ? 'Mute sound effects' : 'Enable sound effects';
		},

		get headingTitle() {
			if (this.mode === 'tutorial') return 'Introduction';
			if (this.mode === 'study') return 'Study';
			if (this.mode === 'challenge') return 'Challenge';
			return 'Shared puzzle';
		},

		get headingSubtitle() {
			if (this.mode === 'tutorial') {
				return 'Welcome to Minesight, a Minesweeper tactics game where you identify which covered squares must be safe and which must contain mines. ' +
					'Minesight uses Minesweeper clues, but you are not trying to clear the board. Find every covered square that must be safe or must contain a mine. Leave any square that could be either alone.';
			}
			if (this.mode === 'shared') return 'A puzzle sent to you';
			if (this.mode === 'challenge' && this.challengeStarted) {
				return `${this.currentDifficulty.label} · ${this.challengeIndex + 1} / ${this.challengeTotal}`;
			}
			return '';
		},

		get showChallengeTimer() {
			return this.showChallengePath;
		},

		get tutorialComplete() {
			return this.tutorialStep >= TUTORIAL_STEPS.length;
		},

		get tutorialProgress() {
			return this.tutorialComplete ? 'Introduction complete' : `Step ${this.tutorialStep + 1} of ${TUTORIAL_STEPS.length}`;
		},

		get tutorialTitle() {
			return this.tutorialComplete ? 'That is Minesight' : TUTORIAL_STEPS[this.tutorialStep].title;
		},

		get tutorialMessage() {
			if (this.tutorialComplete) {
				return 'Mark only squares the clues prove safe or mined. If a square is ambiguous, leave it alone.';
			}
			return TUTORIAL_STEPS[this.tutorialStep].message;
		},

		get tutorialBubbleClass() {
			if (this.tutorialComplete) return '';
			return `tutorial-bubble-${TUTORIAL_STEPS[this.tutorialStep].bubble}`;
		},

		get tutorialBubbleStyle() {
			if (this.tutorialComplete) return '';
			let { x, y } = TUTORIAL_STEPS[this.tutorialStep];
			let rightEdge = (x + 1) / this.field.width * 100;
			let top = y / this.field.height * 100;
			let spaceRight = (this.field.width - x) / this.field.width * 100;
			let spaceBelow = (this.field.height - y - 1) / this.field.height * 100;
			let bottomEdge = (y + 1) / this.field.height * 100;
			let targetCenter = (x + .5) / this.field.width * 100;
			return `--tutorial-right-edge: ${rightEdge}%; --tutorial-top: ${top}%; --tutorial-space-right: ${spaceRight}%; --tutorial-space-below: ${spaceBelow}%; --tutorial-bottom-edge: ${bottomEdge}%; --tutorial-target-center: ${targetCenter}%`;
		},

		get engineErrorMessage() {
			return `Puzzle generator error: ${this.engineError}`;
		},

		get studyStreakLabel() {
			return `${this.currentDifficulty.label} study streak: ${this.studyStreak}`;
		},

		get showChallengeIntro() {
			return this.mode === 'challenge' && !this.challengeStarted;
		},

		get challengeStartLabel() {
			if (this.challengePreparing) return `Building puzzles ${this.challengePuzzles.length} / ${this.challengeTotal}…`;
			return this.challengeReady ? 'Start challenge' : 'Try again';
		},

		get challengeInvitationDifficulties() {
			return this.challengeMode.route.map(({ difficulty, puzzleCount }) => ({
				key: difficulty.key,
				label: difficulty.label,
				puzzleCount,
			}));
		},

		get challengeShareDisabled() {
			return false;
		},

		get shareButtonLabel() {
			return this.mode === 'challenge' ? 'Share this challenge' : 'Share this puzzle';
		},

		get showChallengeFinish() {
			return this.mode === 'challenge' && this.result === 'complete';
		},

		get challengeCompleteMessage() {
			if (this.challengeFailedCount === 0) return `You cleared all ${this.challengeTotal} challenges.`;
			return `${this.challengeClearedCount} completed · ${this.challengeFailedCount} failed`;
		},

		get challengeFinishTitle() {
			return this.challengeFailedCount === 0 ? 'Perfect run' : 'Run complete';
		},

		get challengeTargetTime() {
			return this.challengeTargetMs === undefined ? '' : formatElapsedTime(this.challengeTargetMs);
		},

		get challengeTimeDifference() {
			if (this.challengeTargetMs === undefined) return undefined;
			return Math.floor(this.elapsedMs / 10) * 10 - this.challengeTargetMs;
		},

		get challengeTimeBeaten() {
			return this.challengeTimeDifference !== undefined && this.challengeTimeDifference < 0;
		},

		get challengeTimeResultMessage() {
			let difference = this.challengeTimeDifference;
			if (difference === undefined) return '';
			if (difference === 0) return 'A perfect tie!';
			let ratio = Math.abs(difference) / this.challengeTargetMs;
			if (difference < 0) {
				if (ratio >= .15) return 'Left them in the dust!';
				if (ratio >= .05) return 'A commanding win!';
				return 'You beat their time!';
			}
			if (ratio <= .01) return 'So close!';
			if (ratio <= .05) return 'Right on their heels!';
			if (ratio <= .15) return 'A spirited chase.';
			return 'Better luck next time!';
		},

		get showChallengePath() {
			return this.mode === 'challenge' && this.challengeStarted && this.result !== 'complete';
		},

		get showBoard() {
			if (this.mode === 'shared' && this.sharedPuzzleError) return false;
			if (this.mode === 'study') return this.studyBoardReady || this.boardPreparing;
			return this.mode !== 'challenge' || (this.challengeStarted && this.result !== 'complete');
		},

		get boardResultClass() {
			return `result-${this.result}`;
		},

		get boardAriaLabel() {
			if (this.mode === 'tutorial') return 'Introduction minefield';
			return this.mode === 'shared' ? 'Shared minefield' : `${this.currentDifficulty.label} minefield`;
		},

		get minefieldStyle() {
			return `--columns: ${this.field.width}`;
		},

		get sharePuzzleDisabled() {
			if (this.mode === 'challenge') return this.challengeShareDisabled;
			return this.boardPreparing || (this.mode === 'study' && !this.studyBoardReady);
		},

		get showPuzzleStatus() {
			return this.mode === 'study' || this.mode === 'shared';
		},

		get statusTitle() {
			return this.result === 'playing' ? 'What can you prove?' : this.resultTitle;
		},

		get statusMessage() {
			return this.result === 'playing'
				? 'Mark every covered square that must be safe or mined.'
				: this.resultMessage;
		},

		get challengeResultActionDisabled() {
			return this.result === 'playing';
		},

		get challengeResultActionLabel() {
			if (this.result === 'gave-up') return 'Restart run';
			return 'Next challenge';
		},

		get hintButtonClass() {
			return this.hintUsed ? 'active' : '';
		},

		get hintButtonDisabled() {
			return this.boardPreparing || this.result !== 'playing' || (
				this.mode === 'study' && !this.studyBoardReady
			);
		},

		get studyActionsClass() {
			return this.studySearchingVisible ? 'is-searching' : '';
		},

		get studyBoardActionClass() {
			return this.result === 'playing' && this.studyBoardReady ? 'skip' : 'primary';
		},

		get studyBoardActionLabel() {
			if (this.studySearchingVisible) return 'Searching…';
			if (this.boardPreparing) return 'Building…';
			if (!this.studyBoardReady) return 'Try again';
			return this.result === 'playing' ? 'Skip' : 'Next';
		},

		get showChallengeControls() {
			return this.showChallengePath;
		},

		get giveUpButtonClass() {
			return this.giveUpHolding ? 'is-holding' : '';
		},

		get giveUpButtonStyle() {
			return `--give-up-duration: ${this.giveUpHoldDuration}ms`;
		},

		get giveUpButtonLabel() {
			return this.giveUpHolding ? 'Giving up. Release to cancel.' : 'Hold to give up';
		},

		get challengeTotal() {
			return this.challengeModeTotal(this.challengeMode);
		},

		get challengeMode() {
			return CHALLENGE_MODES.find(({ key }) => key === this.challengeModeKey) ?? CHALLENGE_MODES[0];
		},

		/** @param {{ route: Array<{ puzzleCount: number }> }} challengeMode */
		challengeModeTotal(challengeMode) {
			return challengeMode.route.reduce((total, { puzzleCount }) => total + puzzleCount, 0);
		},

		/** @param {{ route: Array<{ difficulty: { label: string }, puzzleCount: number }> }} challengeMode */
		challengeModeRouteLabel(challengeMode) {
			return challengeMode.route.map(({ difficulty, puzzleCount }) => (
				`${puzzleCount} ${difficulty.label}`
			)).join(' · ');
		},

		get challengeReady() {
			return !this.challengePreparing && this.challengePuzzles.length === this.challengeTotal;
		},

		get challengeRunActive() {
			return this.mode === 'challenge' && this.challengeStarted && !['gave-up', 'complete'].includes(this.result);
		},

		get challengeClearedCount() {
			return this.challengeResults.filter((result) => result === 'cleared').length;
		},

		get challengeFailedCount() {
			return this.challengeResults.filter((result) => result === 'failed').length;
		},

		get tapActionLabel() {
			return this.actionsInverted ? 'Mine' : 'Safe';
		},

		get holdActionLabel() {
			return this.actionsInverted ? 'Safe' : 'Mine';
		},

		get inputHelp() {
			if (this.scratchActive && this.scratchTool === 'eraser') return 'Swipe over a line to erase that whole stroke. Select a color to draw again.';
			if (this.scratchActive) return 'Draw freely over the board. Select Done to mark squares again.';
			return `Tap or left-click to mark ${this.tapActionLabel}. Long-press or right-click to mark ${this.holdActionLabel}.`;
		},

		/** @param {number} failedCount */
		showChallengeTestEnd(failedCount) {
			if (!isLocalDevelopment() || this.mode !== 'challenge') return false;
			let failures = Math.min(this.challengeTotal, Math.max(0, Math.trunc(Number(failedCount) || 0)));
			this.cancelGiveUpGesture();
			this.stopTimer();
			this.challengePreparationId += 1;
			this.challengePreparing = false;
			this.challengeStarted = true;
			this.challengeIndex = this.challengeTotal - 1;
			this.challengeResults = Array.from(
				{ length: this.challengeTotal },
				(_, index) => index < this.challengeTotal - failures ? 'cleared' : 'failed',
			);
			this.result = 'complete';
			this.playChallengeFanfare();
			if (this.challengeTimeBeaten) feedbackEffects.fireworks();
			this.revision += 1;
			return true;
		},

		playChallengeFanfare() {
			if (this.challengeFailedCount === 0) gameSounds.play('perfectComplete');
			else gameSounds.play('failedComplete');
		},

		toggleScratchPad() {
			this.scratchActive = !this.scratchActive;
			this.scratchStroke = undefined;
			this.scratchEraserPoint = undefined;
		},

		setupScratchPad() {
			let canvas = this.$refs.scratchCanvas;
			if (!(canvas instanceof HTMLCanvasElement)) return;
			scratchResizeObserver?.disconnect();
			scratchResizeObserver = new ResizeObserver(() => this.resizeScratchPad());
			scratchResizeObserver.observe(canvas.parentElement ?? canvas);
			this.resizeScratchPad();
		},

		resizeScratchPad() {
			let canvas = this.$refs.scratchCanvas;
			if (!(canvas instanceof HTMLCanvasElement)) return;
			let rect = canvas.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return;
			let scale = Math.min(window.devicePixelRatio || 1, 3);
			let width = Math.round(rect.width * scale);
			let height = Math.round(rect.height * scale);
			if (canvas.width !== width || canvas.height !== height) {
				canvas.width = width;
				canvas.height = height;
			}
			this.renderScratchPad();
		},

		renderScratchPad() {
			let canvas = this.$refs.scratchCanvas;
			if (!(canvas instanceof HTMLCanvasElement)) return;
			let context = canvas.getContext('2d');
			if (!context) return;
			let rect = canvas.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return;
			let scale = canvas.width / rect.width;
			let styles = getComputedStyle(document.documentElement);
			/** @type {Record<string, string>} */
			let colors = {
				graphite: styles.getPropertyValue('--scratch-graphite').trim(),
				blue: styles.getPropertyValue('--scratch-blue').trim(),
				red: styles.getPropertyValue('--scratch-red').trim(),
			};
			context.setTransform(1, 0, 0, 1, 0, 0);
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.setTransform(scale, 0, 0, scale, 0, 0);
			context.lineCap = 'round';
			context.lineJoin = 'round';
			context.lineWidth = 2.4;
			for (let stroke of this.scratchStrokes) {
				let first = stroke.points[0];
				if (!first) continue;
				let progress = Math.max(0, Math.min(1, stroke.drawProgress ?? 1));
				if (progress === 0) continue;
				context.beginPath();
				context.strokeStyle = colors[stroke.color] || colors.graphite;
				context.moveTo(first.x * rect.width, first.y * rect.height);
				let segments = stroke.points.slice(1).map((point, index) => {
					let previous = stroke.points[index];
					return {
						point,
						previous,
						length: Math.hypot(
							(point.x - previous.x) * rect.width,
							(point.y - previous.y) * rect.height,
						),
					};
				});
				let remaining = segments.reduce((total, segment) => total + segment.length, 0) * progress;
				for (let segment of segments) {
					if (remaining >= segment.length) {
						context.lineTo(segment.point.x * rect.width, segment.point.y * rect.height);
						remaining -= segment.length;
						continue;
					}
					let amount = segment.length === 0 ? 1 : remaining / segment.length;
					context.lineTo(
						(segment.previous.x + (segment.point.x - segment.previous.x) * amount) * rect.width,
						(segment.previous.y + (segment.point.y - segment.previous.y) * amount) * rect.height,
					);
					break;
				}
				if (stroke.points.length === 1) {
					context.lineTo(first.x * rect.width + .01, first.y * rect.height + .01);
				}
				context.stroke();
			}
		},

		/**
		 * @param {{ x: number, y: number }} point
		 * @param {boolean} invert
		 */
		drawScratchMark(point, invert) {
			let markMine = invert !== this.actionsInverted;
			let jitter = () => (Math.random() - .5) * SCRATCH_MARK_SIZE * .12;
			let rotate = (x, y, angle) => ({
				x: point.x + x * Math.cos(angle) - y * Math.sin(angle) + jitter(),
				y: point.y + x * Math.sin(angle) + y * Math.cos(angle) + jitter(),
			});
			let angle = (Math.random() - .5) * .14;
			let paths = markMine
				? [
					[[-.32, .9], [-.32, -.9]],
					[[-.3, -.82], [.72, -.48], [-.3, -.08]],
				]
				: [[[-.8, -.02], [-.22, .62], [.86, -.72]]];
			let strokes = paths.map((path) => ({
					color: this.scratchColor,
					points: path.map(([x, y]) => rotate(x * SCRATCH_MARK_SIZE, y * SCRATCH_MARK_SIZE, angle)),
					drawProgress: 0,
				}));
			this.scratchStrokes.push(...strokes);
			this.animateScratchMark(strokes);
		},

		/** @param {Array<{ drawProgress: number }>} strokes */
		animateScratchMark(strokes) {
			let startTime;
			let drawFrame = (time) => {
				startTime ??= time;
				let progress = Math.min(1, (time - startTime) / SCRATCH_MARK_ANIMATION_MS);
				for (let [index, stroke] of strokes.entries()) {
					stroke.drawProgress = Math.max(0, Math.min(1, progress * strokes.length - index));
				}
				this.renderScratchPad();
				if (progress < 1) requestAnimationFrame(drawFrame);
			};
			requestAnimationFrame(drawFrame);
		},

		/** @param {{ points: Array<{ x: number, y: number }> }} stroke @param {{ x: number, y: number }} [endPoint] */
		isScratchTap(stroke, endPoint) {
			let first = stroke.points[0];
			if (!first) return false;
			return [...stroke.points, ...(endPoint ? [endPoint] : [])]
				.every((point) => Math.hypot(point.x - first.x, point.y - first.y) < SCRATCH_TAP_DISTANCE);
		},

		/** @param {{ color: string, points: Array<{ x: number, y: number }> }} stroke */
		removeScratchStroke(stroke) {
			let index = this.scratchStrokes.indexOf(stroke);
			if (index >= 0) this.scratchStrokes.splice(index, 1);
		},

		/**
		 * @param {{ x: number, y: number }} start
		 * @param {{ x: number, y: number }} end
		 */
		eraseScratchStrokes(start, end) {
			this.scratchStrokes = this.scratchStrokes.filter((stroke) => {
				if (stroke === this.scratchStroke || stroke.points.length === 0) return true;
				if (stroke.points.length === 1) {
					return pointSegmentDistance(stroke.points[0], start, end) > SCRATCH_ERASER_RADIUS;
				}
				return !stroke.points.slice(1).some((point, index) =>
					segmentDistance(stroke.points[index], point, start, end) <= SCRATCH_ERASER_RADIUS,
				);
			});
		},

		/** @param {PointerEvent} event */
		startScratchStroke(event) {
			if (!this.scratchActive || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			let point = this.scratchPoint(event);
			if (this.scratchTool === 'eraser') {
				this.scratchEraserPoint = point;
				this.eraseScratchStrokes(point, point);
				this.renderScratchPad();
				return;
			}
			let stroke = { color: this.scratchColor, points: [point] };
			this.scratchStroke = stroke;
			this.scratchStrokes.push(stroke);
			this.renderScratchPad();
		},

		/** @param {PointerEvent} event */
		continueScratchStroke(event) {
			let stroke = this.scratchStroke;
			if ((!stroke && !this.scratchEraserPoint) || !event.isPrimary || event.buttons === 0) return;
			event.preventDefault();
			let point = this.scratchPoint(event);
			if (this.scratchEraserPoint) {
				this.eraseScratchStrokes(this.scratchEraserPoint, point);
				this.scratchEraserPoint = point;
				this.renderScratchPad();
				return;
			}
			if (!stroke) return;
			let previous = stroke.points.at(-1);
			if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < .0015) return;
			stroke.points.push(point);
			this.renderScratchPad();
		},

		/** @param {PointerEvent} event */
		endScratchStroke(event) {
			if (!event.isPrimary) return;
			if (this.scratchEraserPoint) {
				this.scratchEraserPoint = undefined;
				return;
			}
			let stroke = this.scratchStroke;
			this.scratchStroke = undefined;
			if (!stroke) return;
			if (event.type === 'pointercancel') {
				if (this.isScratchTap(stroke)) this.removeScratchStroke(stroke);
				this.renderScratchPad();
				return;
			}
			let point = this.scratchPoint(event);
			if (!this.isScratchTap(stroke, point)) return;
			this.removeScratchStroke(stroke);
			this.drawScratchMark(point, false);
			this.renderScratchPad();
		},

		/** @param {MouseEvent} event */
		contextMenuScratch(event) {
			if (!this.scratchActive) return;
			let point = this.scratchPoint(event);
			if (this.scratchTool === 'eraser') {
				this.eraseScratchStrokes(point, point);
				this.renderScratchPad();
				return;
			}
			if (this.scratchStroke && this.isScratchTap(this.scratchStroke, point)) {
				this.removeScratchStroke(this.scratchStroke);
				this.scratchStroke = undefined;
			}
			this.drawScratchMark(point, true);
			this.renderScratchPad();
		},

		/** @param {MouseEvent | PointerEvent} event */
		scratchPoint(event) {
			let rect = event.currentTarget.getBoundingClientRect();
			return {
				x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
				y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
			};
		},

		clearScratchPad() {
			this.scratchStrokes = [];
			this.scratchStroke = undefined;
			this.scratchEraserPoint = undefined;
			this.renderScratchPad();
		},

		resetScratchPad() {
			this.scratchActive = false;
			this.scratchTool = 'pencil';
			this.clearScratchPad();
			this.$nextTick(() => this.resizeScratchPad());
		},

		get formattedTime() {
			return formatElapsedTime(this.elapsedMs);
		},

		get challengeTimerTime() {
			return this.formattedTime.replace(/\.\d{2}$/, '');
		},

		get challengeGroups() {
			let start = 0;
			return this.challengeMode.route.map(({ difficulty, puzzleCount }) => {
				let group = {
					key: difficulty.key,
					label: difficulty.label,
					difficulty,
					puzzleCount,
					start,
					steps: Array.from({ length: puzzleCount }, (_, index) => start + index),
				};
				start += puzzleCount;
				return group;
			});
		},

		get cells() {
			this.revision;
			let cells = [];
			let showHints = ['study', 'shared'].includes(this.mode) && this.hintUsed && this.result === 'playing';
			let showSolution = this.mode === 'challenge' && this.result === 'gave-up';
			for (let y = 0; y < this.field.height; y += 1) {
				for (let x = 0; x < this.field.width; x += 1) {
					let index = this.field.getIndex(x, y);
					let mine = this.field.isMine(x, y);
					let revealed = this.field.isRevealed(x, y);
					let flagged = this.field.isFlagged(x, y);
					let markedMine = this.field.isMarkedMine(x, y);
					let markedSafe = this.field.isMarkedSafe(x, y);
					let active = this.field.isActive(x, y);
					let incorrect = this.field.isIncorrect(x, y) || index === this.incorrectCellIndex;
					let solutionMine = showSolution && this.field.isForcedMine(x, y);
					let solutionSafe = showSolution && this.field.isForcedSafe(x, y);
					let clue = this.field.getClue(x, y);
					let showMine = !this.field.isPuzzle && mine && (revealed || this.result === 'failed');
					let hinted = showHints && (
						(this.field.isForcedSafe(x, y) && !markedSafe) ||
						(this.field.isForcedMine(x, y) && !markedMine)
					);
					let classNames = [];
					if (revealed) classNames.push('revealed');
					if (flagged) classNames.push('flagged');
					if (markedMine || solutionMine) classNames.push('marked-mine');
					if (markedSafe || solutionSafe) classNames.push('marked-safe');
					if (!active && !revealed && !flagged) classNames.push('inactive');
					if (hinted) classNames.push('hinted');
					if (showMine) classNames.push('mine');
					if (incorrect) classNames.push('incorrect-guess');
					let tutorialTarget = false;
					if (this.mode === 'tutorial' && !this.tutorialComplete) {
						let step = TUTORIAL_STEPS[this.tutorialStep];
						tutorialTarget = x === step.x && y === step.y;
						if (tutorialTarget) classNames.push('tutorial-target');
					}
					if (mine && revealed) classNames.push('detonated');
					if (revealed && !mine && clue > 0) classNames.push(`clue-${clue}`);

					let text = '';
					if (incorrect) text = '!';
					else if (markedSafe || solutionSafe) text = '✓';
					else if (markedMine || solutionMine) text = '⚑';
					else if (flagged) text = '⚑';
					else if (showMine) text = '✹';
					else if (hinted) text = '?';
					else if (revealed && clue > 0) text = String(clue);

					let label = `Row ${y + 1}, column ${x + 1}`;
					if (incorrect) label += ', incorrect choice';
					else if (solutionSafe) label += ', solution: safe';
					else if (solutionMine) label += ', solution: mine';
					else if (markedSafe) label += ', marked safe';
					else if (markedMine) label += ', marked mine';
					else if (flagged) label += ', flagged';
					else if (showMine) label += ', mine';
					else if (hinted) label += ', hint';
					else if (revealed) label += clue > 0 ? `, clue ${clue}` : ', empty';
					else if (active) label += ', covered square';
					else label += ', outside this puzzle';
					if (tutorialTarget) label += ', current tutorial target';

					let studyBoardUnavailable = this.mode === 'study' && !this.studyBoardReady;
					let chordable = this.mode !== 'tutorial' && revealed && !mine;
					let disabled = this.boardPreparing || studyBoardUnavailable ||
						this.result !== 'playing' || (!active && !chordable) ||
						(this.mode === 'tutorial' && this.tutorialComplete);
					let key = `${this.boardNumber}-${index}`;
					cells.push({ key, index, x, y, text, label, className: classNames.join(' '), disabled, tabIndex: -1 });
				}
			}
			let keyboardTarget = cells.find((cell) => cell.index === this.keyboardFocusIndex && !cell.disabled)
				?? cells.find((cell) => !cell.disabled);
			for (let cell of cells) cell.tabIndex = cell === keyboardTarget ? 0 : -1;
			return cells;
		},

		get resultTitle() {
			if (this.result === 'cleared') {
				if (this.mode === 'shared') return 'Shared puzzle solved';
				if (this.mode === 'challenge' && this.challengeResults[this.challengeIndex] === 'failed') {
					return 'Puzzle completed';
				}
				return 'Puzzle solved';
			}
			if (this.result === 'complete') return 'Challenge complete';
			return this.result === 'gave-up' ? 'Run ended' : 'Incorrect move';
		},

		get resultMessage() {
			if (this.result === 'cleared' && this.mode === 'challenge') {
				if (this.challengeResults[this.challengeIndex] === 'failed') {
					return 'You finished it, but this puzzle counts as failed. Ready for the next one?';
				}
				return 'Good solve. Ready for the next one?';
			}
			if (this.result === 'cleared' && this.mode === 'shared') return 'Nice solve. Open the link again for a fresh board.';
			if (this.result === 'cleared') return 'Good solve. Keep the streak going.';
			if (this.result === 'complete') return `${this.challengeClearedCount} completed cleanly and ${this.challengeFailedCount} failed in ${this.formattedTime}.`;
			if (this.result === 'gave-up') return `You gave up on puzzle ${this.challengeIndex + 1} of ${this.challengeTotal}.`;
			return "The clues don't support that mark.";
		},

		toggleSound() {
			this.soundEnabled = gameSounds.toggle();
			saveMinesightData('soundEnabled', this.soundEnabled);
		},

		activateChallengeStart() {
			if (this.challengeReady) this.startChallenge();
			else if (!this.challengePreparing) void this.prepareChallenge();
		},

		/** @param {string} modeKey */
		selectChallengeMode(modeKey) {
			if (this.challengeStarted || modeKey === this.challengeModeKey) return;
			if (!CHALLENGE_MODES.some(({ key }) => key === modeKey)) return;
			this.challengeTargetMs = undefined;
			this.challengeModeKey = modeKey;
			this.challengeSeed = randomChallengeSeed();
			saveMinesightData('challengeModeKey', modeKey);
			void this.prepareChallenge();
		},

		activateChallengeResultAction() {
			if (this.result === 'cleared') this.advanceChallenge();
			else if (this.result === 'gave-up') void this.restartChallenge();
		},

		activateStudyBoardAction() {
			if (this.boardPreparing) return;
			if (this.result === 'playing' && this.studyBoardReady) this.skipStudyBoard();
			else void this.newStudyBoard();
		},

		startTutorial() {
			this.clearIncorrectFeedback();
			this.mode = 'tutorial';
			this.tutorialStep = 0;
			this.result = 'playing';
			this.engineError = '';
			this.field = createTutorialField();
			this.boardNumber += 1;
			this.revision += 1;
		},

		finishTutorial() {
			if (this.mode !== 'tutorial') return;
			this.removeTutorialFromUrl();
			saveMinesightData('mode', 'study');
			this.mode = 'study';
			if (!this.restoreStudyState()) void this.newStudyBoard();
		},

		removeTutorialFromUrl() {
			let url = new URL(window.location.href);
			if (!url.searchParams.has(TUTORIAL_PARAMETER)) return;
			url.searchParams.delete(TUTORIAL_PARAMETER);
			window.history.replaceState(null, '', url);
		},

		removeChallengeFromUrl() {
			this.challengeReceived = false;
			let url = new URL(window.location.href);
			if (
				!url.searchParams.has(CHALLENGE_MODE_PARAMETER) &&
				!url.searchParams.has(CHALLENGE_SEED_PARAMETER) &&
				!url.searchParams.has(CHALLENGE_TIME_PARAMETER)
			) return;
			url.searchParams.delete(CHALLENGE_MODE_PARAMETER);
			url.searchParams.delete(CHALLENGE_SEED_PARAMETER);
			url.searchParams.delete(CHALLENGE_TIME_PARAMETER);
			window.history.replaceState(null, '', url);
		},

		/** @param {GameMode} nextMode */
		switchMode(nextMode) {
			if (this.mode === nextMode) return;
			if (nextMode === 'study' && this.challengeRunActive) return;
			this.removeTutorialFromUrl();
			if (nextMode === 'challenge') {
				if (this.mode === 'study') {
					this.snapshotStudyState();
					this.saveStudyData();
				}
				this.removeSharedPuzzleFromUrl();
				this.studyPreparationId += 1;
				this.boardPreparing = false;
				this.clearStudySearchingDelay();
				this.mode = nextMode;
				this.challengeTargetMs = undefined;
				this.challengeSeed = randomChallengeSeed();
				saveMinesightData('mode', nextMode);
				void this.prepareChallenge();
			}
			else {
				this.removeSharedPuzzleFromUrl();
				this.removeChallengeFromUrl();
				this.challengePreparationId += 1;
				this.challengePreparing = false;
				this.challengeStarted = false;
				this.challengePuzzles = [];
				this.challengeResults = [];
				this.stopTimer();
				this.mode = nextMode;
				saveMinesightData('mode', nextMode);
				if (!this.restoreStudyState()) void this.newStudyBoard();
			}
		},

		removeSharedPuzzleFromUrl() {
			this.sharedPuzzleError = '';
			let url = new URL(window.location.href);
			if (!url.searchParams.has(SHARED_PUZZLE_PARAMETER)) return;
			url.searchParams.delete(SHARED_PUZZLE_PARAMETER);
			window.history.replaceState(null, '', url);
		},

		async sharePuzzle() {
			if (this.mode === 'challenge') {
				await this.shareChallenge();
				return;
			}
			if (this.sharePuzzleDisabled || !this.showBoard) return;
			let url = new URL(window.location.href);
			url.searchParams.delete(TUTORIAL_PARAMETER);
			url.searchParams.delete(CHALLENGE_MODE_PARAMETER);
			url.searchParams.delete(CHALLENGE_SEED_PARAMETER);
			url.searchParams.delete(CHALLENGE_TIME_PARAMETER);
			url.searchParams.set(SHARED_PUZZLE_PARAMETER, this.field.encode());
			let shareData = {
				title: 'Minesight puzzle',
				text: 'Can you solve this Minesight puzzle?',
				url: url.href,
			};

			if (typeof navigator.share === 'function') {
				try {
					await navigator.share(shareData);
					this.showShareFeedback('Puzzle shared');
					return;
				}
				catch (error) {
					if (error instanceof DOMException && error.name === 'AbortError') return;
				}
			}

			try {
				await this.copyShareUrl(url.href);
				this.showShareFeedback('Share link copied');
			}
			catch {
				this.showShareFeedback('Could not copy the link');
			}
		},

		async shareChallenge() {
			if (this.challengeShareDisabled) return;
			let completedTime = Math.floor(this.elapsedMs / 10) * 10;
			let targetTime = this.result === 'complete' ? completedTime : this.challengeTargetMs;
			let url = createChallengeShareUrl(window.location.href, this.challengeModeKey, this.challengeSeed, targetTime);
			let text = this.result === 'complete'
				? `I completed Minesight ${this.challengeMode.label} in ${this.formattedTime}. Can you beat my time?`
				: `You have been challenged to Minesight ${this.challengeMode.label}!`;
			let shareData = {
				title: 'Minesight Challenge',
				text: text,
				url: url.href,
			};

			if (typeof navigator.share === 'function') {
				try {
					await navigator.share(shareData);
					this.showShareFeedback('Challenge shared');
					return;
				}
				catch (error) {
					if (error instanceof DOMException && error.name === 'AbortError') return;
				}
			}

			try {
				await this.copyShareUrl(url.href);
				this.showShareFeedback('Challenge link copied');
			}
			catch {
				this.showShareFeedback('Could not copy the link');
			}
		},

		/** @param {string} url */
		async copyShareUrl(url) {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(url);
				return;
			}
			let input = document.createElement('textarea');
			input.value = url;
			input.setAttribute('readonly', '');
			input.style.position = 'fixed';
			input.style.opacity = '0';
			document.body.append(input);
			input.select();
			let copied = document.execCommand('copy');
			input.remove();
			if (!copied) throw new Error('copy command failed');
		},

		/** @param {string} message */
		showShareFeedback(message) {
			if (this.shareFeedbackTimerId !== undefined) window.clearTimeout(this.shareFeedbackTimerId);
			this.shareFeedback = message;
			this.shareFeedbackTimerId = window.setTimeout(() => {
				this.shareFeedback = '';
				this.shareFeedbackTimerId = undefined;
			}, 2200);
		},

		/** @param {string} key */
		selectDifficulty(key) {
			if (this.difficultyKey === key) return;
			if (!STUDY_DIFFICULTIES.some((difficulty) => difficulty.key === key)) return;
			this.snapshotStudyState();
			this.studyPreparationId += 1;
			this.boardPreparing = false;
			this.clearStudySearchingDelay();
			this.difficultyKey = key;
			let restored = this.restoreStudyState();
			this.saveStudyData();
			if (!restored) void this.newStudyBoard();
		},

		snapshotStudyState() {
			this.studyStates[this.difficultyKey] = {
				field: this.field,
				seed: this.boardSeed,
				result: this.result,
				hintUsed: this.hintUsed,
				streak: this.studyStreak,
				ready: this.studyBoardReady,
			};
		},

		restoreStudyState() {
			let state = this.studyStates[this.difficultyKey];
			if (!state) {
				this.studyStreak = this.studyStreaks[this.difficultyKey];
				this.studyBoardReady = false;
				return false;
			}
			this.studyStreak = state.streak;
			if (!state.ready) {
				this.studyBoardReady = false;
				return false;
			}
			this.clearIncorrectFeedback();
			this.field = state.field;
			this.boardSeed = state.seed;
			this.result = state.result;
			this.hintUsed = state.hintUsed;
			this.studyBoardReady = true;
			this.engineError = '';
			this.boardNumber += 1;
			this.revision += 1;
			return true;
		},

		/** @param {number} streak */
		setStudyStreak(streak) {
			this.studyStreak = streak;
			this.studyStreaks[this.difficultyKey] = streak;
		},

		saveStudyData() {
			let difficulties = Object.fromEntries(STUDY_DIFFICULTIES.map(({ key }) => {
				let state = this.studyStates[key];
				/** @type {{ streak: number, board?: { difficultyKey: string, cells: number[], seed: string, result: GameResult, hintUsed: boolean } }} */
				let saved = { streak: this.studyStreaks[key] };
				if (state?.ready) saved.board = {
					difficultyKey: key,
					cells: Array.from(state.field.state),
					seed: String(state.seed),
					result: state.result,
					hintUsed: state.hintUsed,
				};
				return [key, saved];
			}));
			saveMinesightData('study', {
				difficultyKey: this.difficultyKey,
				difficulties,
			});
		},

		async newStudyBoard() {
			this.result = 'playing';
			this.hintUsed = false;
			this.studyBoardReady = false;
			this.snapshotStudyState();
			this.saveStudyData();
			await this.replaceField();
		},

		skipStudyBoard() {
			if (this.mode !== 'study' || this.result !== 'playing') return;
			void this.newStudyBoard();
		},

		async prepareChallenge() {
			this.stopTimer();
			this.clearIncorrectFeedback();
			let preparationId = this.challengePreparationId + 1;
			this.challengePreparationId = preparationId;
			this.challengeStarted = false;
			this.challengePreparing = true;
			this.challengePuzzles = [];
			this.challengeResults = [];
			this.challengeIndex = 0;
			this.elapsedMs = 0;
			this.result = 'playing';
			this.hintUsed = false;
			this.engineError = '';

			try {
				// Paint the initial 0 / total state, then give each completed puzzle its
				// own frame so progress remains visible and mode changes stay responsive.
				await yieldToBrowser();
				let nextSeed = this.challengeSeed;
				for (let { difficulty, puzzleCount } of this.challengeMode.route) {
					for (let index = 0; index < puzzleCount; index += 1) {
						if (this.mode !== 'challenge' || preparationId !== this.challengePreparationId) return;
						let puzzle = await generateSeededField(difficulty, nextSeed, () => (
							this.mode === 'challenge' && preparationId === this.challengePreparationId
						));
						if (!puzzle) return;
						this.challengePuzzles.push(puzzle);
						nextSeed = puzzle.seed === MAX_CHALLENGE_SEED ? 0n : puzzle.seed + 1n;
						await yieldToBrowser();
					}
				}
				sortChallengeTiers(this.challengePuzzles, this.challengeMode.route);
			}
			catch (error) {
				if (preparationId !== this.challengePreparationId) return;
				this.challengePuzzles = [];
				this.engineError = error instanceof Error ? error.message : String(error);
			}
			finally {
				if (preparationId === this.challengePreparationId) this.challengePreparing = false;
			}
		},

		startChallenge() {
			if (!this.challengeReady) return;
			this.removeChallengeFromUrl();
			this.stopTimer();
			this.challengeStarted = true;
			this.challengeIndex = 0;
			this.challengeResults = [];
			this.elapsedMs = 0;
			this.result = 'playing';
			this.hintUsed = false;
			if (!this.loadChallengeField()) return;
			gameSounds.play('start');
			this.startTimer();
		},

		async restartChallenge() {
			this.challengeTargetMs = undefined;
			this.challengeSeed = randomChallengeSeed();
			await this.prepareChallenge();
		},

		beginGiveUpGesture() {
			if (!this.challengeRunActive || this.giveUpTimerId !== undefined) return;
			this.giveUpHolding = true;
			this.giveUpTimerId = window.setTimeout(() => {
				this.giveUpTimerId = undefined;
				this.giveUpHolding = false;
				this.giveUpChallenge();
			}, GIVE_UP_HOLD_MS);
		},

		cancelGiveUpGesture() {
			if (this.giveUpTimerId !== undefined) window.clearTimeout(this.giveUpTimerId);
			this.giveUpTimerId = undefined;
			this.giveUpHolding = false;
		},

		giveUpChallenge() {
			if (!this.challengeRunActive) return;
			this.cancelGiveUpGesture();
			this.stopTimer();
			this.result = 'gave-up';
			gameSounds.play('failure');
			feedbackEffects.failure({ terminal: true });
			this.revision += 1;
		},

		/** @param {number} cellIndex */
		markChallengeFailed(cellIndex) {
			if (!this.challengeRunActive || this.result !== 'playing') return;
			this.challengeResults[this.challengeIndex] = 'failed';
			let incorrectIndex = this.field.consumeIncorrect();
			this.showIncorrectFeedback(incorrectIndex >= 0 ? incorrectIndex : cellIndex);
			gameSounds.play('incorrect');
			feedbackEffects.failure({ cellIndex, terminal: false });
			this.revision += 1;
		},

		advanceChallenge() {
			if (this.result !== 'cleared') return;
			this.challengeIndex += 1;
			this.result = 'playing';
			if (this.loadChallengeField()) this.startTimer();
		},

		loadChallengeField() {
			this.clearIncorrectFeedback();
			let puzzle = this.challengePuzzles[this.challengeIndex];
			if (!puzzle) {
				this.challengeStarted = false;
				this.engineError = `challenge ${this.challengeIndex + 1} was not prepared`;
				return false;
			}
			this.field = puzzle.field;
			this.boardSeed = puzzle.seed;
			this.engineError = '';
			this.boardNumber += 1;
			this.revision += 1;
			return true;
		},

		async replaceField() {
			this.clearIncorrectFeedback();
			let preparationId = this.studyPreparationId + 1;
			this.studyPreparationId = preparationId;
			this.boardPreparing = true;
			this.clearStudySearchingDelay();
			this.studySearchingTimerId = window.setTimeout(() => {
				if (
					this.mode === 'study' &&
					this.boardPreparing &&
					preparationId === this.studyPreparationId
				) this.studySearchingVisible = true;
			}, 200);
			this.engineError = '';
			try {
				let difficulty = this.currentDifficulty;
				let difficultyKey = this.difficultyKey;
				let puzzle = await generateField(difficulty, () => (
					this.mode === 'study' &&
					difficultyKey === this.difficultyKey &&
					preparationId === this.studyPreparationId
				));
				if (
					!puzzle ||
					this.mode !== 'study' ||
					difficultyKey !== this.difficultyKey ||
					preparationId !== this.studyPreparationId
				) return;
				this.field = puzzle.field;
				this.boardSeed = puzzle.seed;
				this.studyBoardReady = true;
				this.engineError = '';
				this.boardNumber += 1;
				this.revision += 1;
				this.snapshotStudyState();
				this.saveStudyData();
			}
			catch (error) {
				if (preparationId !== this.studyPreparationId) return;
				this.engineError = error instanceof Error ? error.message : String(error);
			}
			finally {
				if (preparationId === this.studyPreparationId) {
					this.boardPreparing = false;
					this.clearStudySearchingDelay();
				}
			}
		},

		clearStudySearchingDelay() {
			if (this.studySearchingTimerId !== undefined) {
				window.clearTimeout(this.studySearchingTimerId);
			}
			this.studySearchingTimerId = undefined;
			this.studySearchingVisible = false;
		},

		stopTimer() {
			if (this.timerId !== undefined) {
				this.updateTimer();
				window.clearInterval(this.timerId);
			}
			this.timerId = undefined;
			this.timerLastTick = undefined;
		},

		startTimer() {
			this.stopTimer();
			this.timerLastTick = window.performance.now();
			this.timerId = window.setInterval(() => {
				this.updateTimer();
			}, 10);
		},

		updateTimer() {
			if (this.timerLastTick === undefined) return;
			let now = window.performance.now();
			this.elapsedMs += Math.max(0, now - this.timerLastTick);
			this.timerLastTick = now;
		},

		clearIncorrectFeedback() {
			if (this.incorrectFeedbackTimerId !== undefined) {
				window.clearTimeout(this.incorrectFeedbackTimerId);
			}
			this.incorrectFeedbackTimerId = undefined;
			this.incorrectCellIndex = -1;
			this.incorrectFeedbackMessage = '';
		},

		/** @param {number} index @param {string} [message] */
		showIncorrectFeedback(index, message = "The clues don't support that mark. Try again.") {
			this.clearIncorrectFeedback();
			this.incorrectCellIndex = index;
			this.incorrectFeedbackMessage = message;
			this.incorrectFeedbackTimerId = window.setTimeout(() => {
				this.incorrectCellIndex = -1;
				this.incorrectFeedbackMessage = '';
				this.incorrectFeedbackTimerId = undefined;
			}, 650);
		},

		useHint() {
			if (!['study', 'shared'].includes(this.mode) || this.result !== 'playing') return;
			if (this.mode === 'study' && !this.studyBoardReady) return;
			this.hintUsed = !this.hintUsed;
			this.revision += 1;
			if (this.mode === 'study') {
				this.snapshotStudyState();
				this.saveStudyData();
			}
		},

		/**
		 * @param {number} x
		 * @param {number} y
		 * @param {boolean} invert
		 */
		applyCellInput(x, y, invert) {
			if (this.result !== 'playing') return;
			if (this.mode === 'tutorial') {
				this.applyTutorialInput(x, y, invert);
				return;
			}
			if (this.mode === 'challenge' && !this.challengeStarted) return;
			if (this.field.isRevealed(x, y)) {
				let marks = this.field.actionChordMarks(x, y);
				if (marks.length === 0) return;
				let [first, ...additionalMarks] = marks;
				this.afterMove({
					removing: false,
					cellIndex: first.index,
					markMine: first.mine,
					additionalMarks,
				});
				return;
			}
			if (!this.field.isActive(x, y)) return;
			let cellIndex = this.field.getIndex(x, y);
			let markMine = invert !== this.actionsInverted;
			let oppositeMarked = markMine ? this.field.isMarkedSafe(x, y) : this.field.isMarkedMine(x, y);
			if (oppositeMarked) return;
			let removing = markMine ? this.field.isMarkedMine(x, y) : this.field.isMarkedSafe(x, y);
			if (markMine) this.field.actionMarkMine(x, y);
			else this.field.actionMarkSafe(x, y);
			this.afterMove({ removing, cellIndex, markMine });
		},

		/**
		 * @param {number} x
		 * @param {number} y
		 * @param {boolean} invert
		 */
		applyTutorialInput(x, y, invert) {
			if (this.tutorialComplete) return;
			let step = TUTORIAL_STEPS[this.tutorialStep];
			let correctCell = x === step.x && y === step.y;
			let markMine = invert !== this.actionsInverted;
			let correctGesture = step.action === 'ambiguous' || (step.action === 'mine') === markMine;
			if (!correctCell || !correctGesture) {
				this.rejectTutorialInput(x, y);
				return;
			}

			if (step.action === 'safe') this.field.actionMarkSafe(x, y);
			else if (step.action === 'mine') this.field.actionMarkMine(x, y);
			else {
				this.field.actionMarkSafe(x, y);
				this.field.consumeIncorrect();
				let index = this.field.getIndex(x, y);
				this.showIncorrectFeedback(index, 'That square is not forced. Minesight rejects guesses.');
				gameSounds.play('incorrect');
				feedbackEffects.failure({ cellIndex: index, terminal: false });
			}
			if (step.action !== 'ambiguous') {
				gameSounds.play('mark');
				feedbackEffects.correctMark({
					cellIndex: this.field.getIndex(x, y),
					mine: step.action === 'mine',
				});
			}
			this.tutorialStep += 1;
			this.revision += 1;
		},

		/** @param {number} x @param {number} y */
		rejectTutorialInput(x, y) {
			let index = this.field.getIndex(x, y);
			this.showIncorrectFeedback(index, 'Try the highlighted square using the instructed action.');
			gameSounds.play('incorrect');
			feedbackEffects.failure({ cellIndex: index, terminal: false });
		},

		/** @param {number} index */
		focusCell(index) {
			this.keyboardFocusIndex = index;
		},

		/**
		 * @param {MouseEvent} event
		 * @param {number} x
		 * @param {number} y
		 */
		clickCell(event, x, y) {
			this.applyCellInput(x, y, event.shiftKey);
		},

		/**
		 * @param {KeyboardEvent} event
		 * @param {number} x
		 * @param {number} y
		 */
		keydownCell(event, x, y) {
			let direction = CELL_FOCUS_DIRECTIONS[event.key];
			if (direction) {
				event.preventDefault();
				this.moveCellFocus(x, y, direction[0], direction[1]);
				return;
			}
			if (![' ', 'Enter'].includes(event.key)) return;
			event.preventDefault();
			if (!event.repeat) this.applyCellInput(x, y, event.shiftKey);
		},

		/**
		 * @param {number} x
		 * @param {number} y
		 * @param {number} deltaX
		 * @param {number} deltaY
		 */
		moveCellFocus(x, y, deltaX, deltaY) {
			let candidates = this.cells
				.filter((cell) => {
					if (cell.disabled) return false;
					return (cell.x - x) * deltaX + (cell.y - y) * deltaY > 0;
				})
				.map((cell) => {
					let horizontalDistance = cell.x - x;
					let verticalDistance = cell.y - y;
					let forwardDistance = Math.abs(horizontalDistance * deltaX + verticalDistance * deltaY);
					let sidewaysDistance = Math.abs(horizontalDistance * deltaY + verticalDistance * deltaX);
					return {
						cell,
						score: Math.hypot(horizontalDistance, verticalDistance) + sidewaysDistance * 0.25,
						forwardDistance,
						sidewaysDistance,
					};
				})
				.sort((left, right) => left.score - right.score
					|| left.sidewaysDistance - right.sidewaysDistance
					|| left.forwardDistance - right.forwardDistance
					|| left.cell.index - right.cell.index);
			let index = candidates[0]?.cell.index;
			if (index === undefined) return;
			this.keyboardFocusIndex = index;
			this.$nextTick(() => {
				document.querySelector(`.minefield .cell[data-cell-index="${index}"]`)?.focus();
			});
		},

		/**
		 * @param {number} x
		 * @param {number} y
		 */
		contextMenuCell(x, y) {
			this.applyCellInput(x, y, true);
		},

		/** @param {{ removing: boolean, cellIndex: number, markMine: boolean, additionalMarks?: Array<{ index: number, mine: boolean }> }} move */
		afterMove(move) {
			let showMarkEffects = () => {
				feedbackEffects.correctMark({ cellIndex: move.cellIndex, mine: move.markMine });
				for (let mark of move.additionalMarks ?? []) {
					feedbackEffects.correctMark({ cellIndex: mark.index, mine: mark.mine });
				}
			};
			let gameOver = this.field.gameOverReason();
			if (gameOver === MineField.GAME_OVER_DETONATION) {
				let feedbackCellIndex = this.field.incorrectIndex;
				if (this.mode === 'challenge') {
					this.markChallengeFailed(feedbackCellIndex);
					return;
				}
				if (this.mode === 'study') {
					feedbackEffects.streakLost(this.studyStreak);
					this.setStudyStreak(0);
				}
				let incorrectIndex = this.field.consumeIncorrect();
				if (incorrectIndex >= 0) this.showIncorrectFeedback(incorrectIndex);
				else this.result = 'failed';
				gameSounds.play('incorrect');
				feedbackEffects.failure({
					cellIndex: feedbackCellIndex,
					terminal: false,
				});
			}
			else if (gameOver === MineField.GAME_OVER_CLEARED) {
				this.clearIncorrectFeedback();
				let challengeComplete = this.mode === 'challenge' && this.challengeIndex === this.challengeTotal - 1;
				if (this.mode === 'challenge') {
					this.stopTimer();
					if (this.challengeResults[this.challengeIndex] !== 'failed') {
						this.challengeResults[this.challengeIndex] = 'cleared';
					}
				}
				if (challengeComplete) {
					this.result = 'complete';
					this.playChallengeFanfare();
					if (this.challengeTimeBeaten) feedbackEffects.fireworks();
				}
				else {
					this.result = 'cleared';
					if (this.mode === 'study') this.setStudyStreak(this.studyStreak + 1);
					gameSounds.play('success');
				}
				feedbackEffects.success({ grand: challengeComplete });
				showMarkEffects();
			}
			else if (move.removing) {
				gameSounds.play('unmark');
			}
			else {
				gameSounds.play('mark');
				showMarkEffects();
			}
			this.revision += 1;
			if (this.mode === 'study') {
				this.snapshotStudyState();
				this.saveStudyData();
			}
		},

		/** @param {number} step */
		challengeStepClass(step) {
			let outcome = this.challengeResults[step];
			if (outcome === 'cleared') return 'complete';
			if (outcome === 'failed') return 'failed';
			if (step === this.challengeIndex && this.result !== 'complete') return 'current';
			return '';
		},

		/** @param {number} step */
		challengeStepLabel(step) {
			let group = this.challengeGroups.find(({ start, puzzleCount }) => (
				step >= start && step < start + puzzleCount
			)) ?? this.challengeGroups[0];
			let state = this.challengeStepClass(step) || 'upcoming';
			return `${group.label} challenge ${step - group.start + 1}, ${state}`;
		},
	};
}

// Preload the generator without keeping the tutorial or a shared puzzle behind
// a blank, x-cloaked page. A failed preload is retried when a board is requested.
void ensurePuzzleGenerator().catch(() => {});

Object.assign(window, { minesight: createMinesight });
