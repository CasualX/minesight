// @ts-check

import { MineField } from './mines.js';
import { feedbackEffects } from './feedback.js';
import { gameSounds } from './sounds.js';

const CHALLENGES_PER_DIFFICULTY = 4;
const BOARD_SIZE = 8;
const MAX_PUZZLES_PER_SEARCH = 1000;
const PUZZLE_SEARCH_SLICE_MS = 8;
const GIVE_UP_HOLD_MS = 900;
const NO_MATCHING_PUZZLE_ERROR = 'no puzzle matching requirements was found';
const MINESIGHT_STORAGE_KEY = 'minesight';
const SHARED_PUZZLE_PARAMETER = 'p';
const TUTORIAL_PARAMETER = 'tutorial';

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

const TUTORIAL_STEPS = [
	{
		x: 1, y: 0, action: 'mine',
		title: 'Mark a mine',
		message: 'The right-hand 1 touches only one covered square. Long-press or right-click that square to mark the mine.',
	},
	{
		x: 0, y: 0, action: 'safe',
		title: 'Mark a square safe',
		message: 'That mine accounts for the 1 below the left square, so its other covered neighbour must be safe. Tap it.',
	},
	{
		x: 6, y: 5, action: 'ambiguous',
		title: 'Do not guess',
		message: 'At the bottom, the two 1s share several covered squares. More than one mine placement fits the clues. Tap the highlighted square to try a guess.',
	},
];

function createTutorialField() {
	let width = BOARD_SIZE;
	let height = BOARD_SIZE;
	let state = new Uint8Array(width * height);
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
	minForced: 4,
	maxForced: BOARD_SIZE * BOARD_SIZE,
	minAmbiguous: 2,
	maxAmbiguous: BOARD_SIZE * BOARD_SIZE,
	minActive: 0,
	description: 'Start with the nearby clues. Each safe square or mine takes only a short chain of reasoning to find.',
};
const MEDIUM_DIFFICULTY = {
	key: 'medium',
	label: 'Medium',
	generator: 'randomMediumPuzzle',
	minForced: 4,
	maxForced: BOARD_SIZE * BOARD_SIZE,
	minAmbiguous: 3,
	maxAmbiguous: BOARD_SIZE * BOARD_SIZE,
	minActive: 0,
	description: 'Compare clues across more of the board. You may need to connect several deductions before a square is certain.',
};
const HARD_DIFFICULTY = {
	key: 'hard',
	label: 'Hard',
	generator: 'randomHardPuzzle',
	minForced: 3,
	maxForced: BOARD_SIZE * BOARD_SIZE,
	minAmbiguous: 0,
	maxAmbiguous: BOARD_SIZE * BOARD_SIZE,
	minActive: 8,
	description: 'The clues overlap across a larger, messier area. Keep track of several possible mine layouts at once.',
};
const PRACTICE_DIFFICULTIES = [
	EASY_DIFFICULTY,
	MEDIUM_DIFFICULTY,
	HARD_DIFFICULTY,
];
const CHALLENGE_DIFFICULTIES = [
	EASY_DIFFICULTY,
	MEDIUM_DIFFICULTY,
	HARD_DIFFICULTY,
];

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

/** @type {WebAssembly.Exports | undefined} */
let wasm;
/** @type {{ cells: Uint8Array, seed: bigint } | undefined} */
let generatedPuzzle;
/** @type {Promise<void> | undefined} */
let generatorLoadPromise;

async function loadPuzzleGenerator() {
	const imports = {
		env: {
			/**
			 * @param {number} seedLow
			 * @param {number} seedHigh
			 * @param {number} pointer
			 * @param {number} length
			 */
			resultPuzzle(seedLow, seedHigh, pointer, length) {
				if (!wasm || !(wasm.memory instanceof WebAssembly.Memory)) {
					throw new Error('wasm returned a puzzle before exposing its memory');
				}
				let cells = new Uint8Array(wasm.memory.buffer, pointer, length).slice();
				let seed = BigInt(seedLow >>> 0) | BigInt(seedHigh >>> 0) << 32n;
				generatedPuzzle = { cells, seed };
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
 * @param {{ generator: string, minForced: number, maxForced: number, minAmbiguous: number, maxAmbiguous: number, minActive: number }} difficulty
 * @param {() => boolean} shouldContinue
 */
async function generateField(difficulty, shouldContinue) {
	await ensurePuzzleGenerator();
	let generatePuzzle = wasm?.[difficulty.generator];
	if (typeof generatePuzzle !== 'function') {
		throw new Error('the Rust puzzle generator is not loaded');
	}

	let entropy = new Uint32Array(2);
	crypto.getRandomValues(entropy);
	let seed = BigInt(entropy[0]) | BigInt(entropy[1]) << 32n;
	let searched = 0;

	// Always leave the current frame before starting CPU-heavy puzzle search.
	await yieldToBrowser();
	while (shouldContinue() && searched < MAX_PUZZLES_PER_SEARCH) {
		let sliceStarted = window.performance.now();
		do {
			generatedPuzzle = undefined;
			let found = Boolean(generatePuzzle(
				difficulty.minForced,
				difficulty.maxForced,
				difficulty.minAmbiguous,
				difficulty.maxAmbiguous,
				difficulty.minActive,
				Number(seed & 0xffff_ffffn),
				Number(seed >> 32n),
				1,
			));
			let puzzle = takeGeneratedPuzzle();
			if (found) {
				if (!puzzle) throw new Error('wasm reported success without returning a puzzle');
				if (puzzle.cells.length !== BOARD_SIZE * BOARD_SIZE) {
					throw new Error(`wasm returned ${puzzle.cells.length} cells instead of 64`);
				}
				return {
					field: new MineField(BOARD_SIZE, BOARD_SIZE, puzzle.cells),
					seed: puzzle.seed,
				};
			}
			if (puzzle) throw new Error('wasm returned a puzzle while reporting failure');

			searched += 1;
			seed = BigInt.asUintN(64, seed + 1n);
		}
		while (
			shouldContinue() &&
			searched < MAX_PUZZLES_PER_SEARCH &&
			window.performance.now() - sliceStarted < PUZZLE_SEARCH_SLICE_MS
		);
		if (searched < MAX_PUZZLES_PER_SEARCH) await yieldToBrowser();
	}
	if (!shouldContinue()) return undefined;
	throw new Error(NO_MATCHING_PUZZLE_ERROR);
}

/** Lets the browser paint before another puzzle-generation attempt. */
function yieldToBrowser() {
	return new Promise((resolve) => {
		// Alpine's $nextTick is a microtask: it flushes reactive DOM changes, but
		// does not give the browser a chance to paint before synchronous Wasm runs.
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

/** @param {Array<{ field: MineField, seed: bigint }>} puzzles */
function sortChallengeTiers(puzzles) {
	for (let start = 0; start < puzzles.length; start += CHALLENGES_PER_DIFFICULTY) {
		let tier = puzzles.slice(start, start + CHALLENGES_PER_DIFFICULTY);
		tier.sort((left, right) => challengePuzzleSquareCount(left) - challengePuzzleSquareCount(right));
		puzzles.splice(start, tier.length, ...tier);
	}
}

/** @typedef {'tutorial' | 'practice' | 'challenge' | 'shared'} GameMode */
/** @typedef {'playing' | 'cleared' | 'failed' | 'complete'} GameResult */
/** @typedef {{ field: MineField, seed: bigint, result: GameResult, hintUsed: boolean, streak: number, ready: boolean }} PracticeState */

function createMinesight() {
	let stored = loadMinesightData();
	/** @type {MineField | undefined} */
	let sharedPuzzle;
	let sharedPuzzleError = '';
	let initialUrl = new URL(window.location.href);
	let sharedPayload = initialUrl.searchParams.get(SHARED_PUZZLE_PARAMETER);
	let tutorialRequested = initialUrl.searchParams.has(TUTORIAL_PARAMETER);
	if (sharedPayload !== null) {
		try {
			sharedPuzzle = MineField.decode(sharedPayload);
		}
		catch {
			sharedPuzzleError = 'This shared puzzle link is invalid.';
		}
	}
	gameSounds.setEnabled(stored.soundEnabled !== false);
	let storedPractice = stored?.practice ?? {};
	let difficultyKey = PRACTICE_DIFFICULTIES.some(({ key }) => key === storedPractice.difficultyKey)
		? storedPractice.difficultyKey
		: 'easy';
	let practiceStreaks = Object.fromEntries(PRACTICE_DIFFICULTIES.map(({ key }) => {
		let streak = storedPractice.difficulties?.[key]?.streak;
		return [key, Math.max(0, Number.parseInt(streak) || 0)];
	}));
	let storedMode = ['practice', 'challenge'].includes(stored.mode) ? stored.mode : 'tutorial';
	/** @type {Record<string, PracticeState | undefined>} */
	let practiceStates = Object.fromEntries(PRACTICE_DIFFICULTIES.map(({ key }) => {
		let saved = storedPractice.difficulties?.[key];
		if (!Array.isArray(saved?.board?.cells)) return [key, undefined];
		if (saved.board.difficultyKey !== key) return [key, undefined];
		try {
			return [key, {
				field: new MineField(BOARD_SIZE, BOARD_SIZE, Uint8Array.from(saved.board.cells)),
				seed: BigInt(saved.board.seed),
				result: saved.board.result === 'cleared' ? 'cleared' : 'playing',
				hintUsed: Boolean(saved.board.hintUsed),
				streak: practiceStreaks[key],
				ready: true,
			}];
		}
		catch {
			return [key, undefined];
		}
	}));
	return {
		/** @type {GameMode} */
		mode: sharedPayload !== null ? 'shared' : tutorialRequested ? 'tutorial' : storedMode,
		soundEnabled: gameSounds.enabled,
		actionsInverted: false,
		/** @type {GameResult} */
		result: 'playing',
		difficultyKey,
		difficulties: PRACTICE_DIFFICULTIES,
		challengeIndex: 0,
		challengeStarted: false,
		challengePreparing: false,
		challengePreparationId: 0,
		practicePreparationId: 0,
		boardPreparing: false,
		practiceSearchingVisible: false,
		practiceBoardReady: false,
		/** @type {Record<string, PracticeState | undefined>} */
		practiceStates,
		/** @type {Array<{ field: MineField, seed: bigint }>} */
		challengePuzzles: [],
		elapsedMs: 0,
		practiceStreaks,
		practiceStreak: practiceStreaks[difficultyKey],
		hintUsed: false,
		tutorialStep: 0,
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
		practiceSearchingTimerId: undefined,
		/** @type {number | undefined} */
		shareFeedbackTimerId: undefined,
		/** @type {number | undefined} */
		giveUpTimerId: undefined,
		giveUpHolding: false,
		giveUpHoldDuration: GIVE_UP_HOLD_MS,
		init() {
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
			if (!this.restorePracticeState() && !this.engineError) this.newPracticeBoard();
		},

		destroy() {
			this.challengePreparationId += 1;
			this.practicePreparationId += 1;
			this.boardPreparing = false;
			this.stopTimer();
			this.clearIncorrectFeedback();
			this.clearPracticeSearchingDelay();
			if (this.shareFeedbackTimerId !== undefined) window.clearTimeout(this.shareFeedbackTimerId);
			this.cancelGiveUpGesture();
		},

		get currentDifficulty() {
			if (this.mode === 'challenge') {
				return CHALLENGE_DIFFICULTIES[Math.floor(this.challengeIndex / CHALLENGES_PER_DIFFICULTY)];
			}
			return PRACTICE_DIFFICULTIES.find((difficulty) => difficulty.key === this.difficultyKey) ?? PRACTICE_DIFFICULTIES[0];
		},

		get practiceModeTitle() {
			return this.challengeRunActive ? 'End your challenge before switching to Practice' : '';
		},

		get soundToggleClass() {
			return this.soundEnabled ? '' : 'muted';
		},

		get soundToggleText() {
			return this.soundEnabled ? 'Mute sound effects' : 'Enable sound effects';
		},

		get headingTitle() {
			if (this.mode === 'tutorial') return 'Introduction';
			if (this.mode === 'practice') return 'Practice';
			if (this.mode === 'challenge') return 'Challenge';
			return 'Shared puzzle';
		},

		get headingSubtitle() {
			if (this.mode === 'tutorial') {
				return 'Welcome to Minesight, a Minesweeper tactics game where you identify which covered squares must be safe and which must contain mines. Follow the instructions below to get started.';
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

		get engineErrorMessage() {
			return `Could not build a puzzle. Try again, or reload if the problem continues. Error: ${this.engineError}`;
		},

		get practiceStreakLabel() {
			return `${this.currentDifficulty.label} practice streak: ${this.practiceStreak}`;
		},

		get showChallengeIntro() {
			return this.mode === 'challenge' && !this.challengeStarted;
		},

		get challengeRouteLabel() {
			return `${this.challengesPerDifficulty} puzzles at each of ${this.challengeGroups.length} difficulty levels`;
		},

		get challengeStartLabel() {
			if (this.challengePreparing) return `Building puzzles ${this.challengePuzzles.length} / ${this.challengeTotal}…`;
			return this.challengeReady ? 'Start challenge' : 'Try again';
		},

		get showChallengeFinish() {
			return this.mode === 'challenge' && this.result === 'complete';
		},

		get challengeCompleteMessage() {
			return `You cleared all ${this.challengeTotal} challenges.`;
		},

		get showChallengePath() {
			return this.mode === 'challenge' && this.challengeStarted && this.result !== 'complete';
		},

		get showBoard() {
			if (this.mode === 'shared' && this.sharedPuzzleError) return false;
			if (this.mode === 'practice') return this.practiceBoardReady || this.boardPreparing;
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
			return !this.practiceBoardReady || this.boardPreparing;
		},

		get showPuzzleStatus() {
			return this.mode === 'practice' || this.mode === 'shared';
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
			return this.result === 'failed' ? 'Restart run' : 'Next challenge';
		},

		get hintButtonClass() {
			return this.hintUsed ? 'active' : '';
		},

		get hintButtonDisabled() {
			return this.boardPreparing || this.result !== 'playing' || (
				this.mode === 'practice' && !this.practiceBoardReady
			);
		},

		get practiceActionsClass() {
			return this.practiceSearchingVisible ? 'is-searching' : '';
		},

		get practiceBoardActionClass() {
			return this.result === 'playing' && this.practiceBoardReady ? 'skip' : 'primary';
		},

		get practiceBoardActionLabel() {
			if (this.practiceSearchingVisible) return 'Searching…';
			if (this.boardPreparing) return 'Building…';
			if (!this.practiceBoardReady) return 'Try again';
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
			return CHALLENGE_DIFFICULTIES.length * CHALLENGES_PER_DIFFICULTY;
		},

		get challengesPerDifficulty() {
			return CHALLENGES_PER_DIFFICULTY;
		},

		get challengeReady() {
			return !this.challengePreparing && this.challengePuzzles.length === this.challengeTotal;
		},

		get challengeRunActive() {
			return this.mode === 'challenge' && this.challengeStarted && !['failed', 'complete'].includes(this.result);
		},

		get tapActionLabel() {
			return this.actionsInverted ? 'Mine' : 'Safe';
		},

		get tapActionSymbol() {
			return this.actionsInverted ? '⚑' : '✓';
		},

		get holdActionLabel() {
			return this.actionsInverted ? 'Safe' : 'Mine';
		},

		get holdActionSymbol() {
			return this.actionsInverted ? '✓' : '⚑';
		},

		get actionSwitchLabel() {
			return `Tap to mark ${this.tapActionLabel.toLowerCase()}. Long-press or right-click to mark ${this.holdActionLabel.toLowerCase()}. Activate this control to swap the actions.`;
		},

		get inputHelp() {
			return `Tap or left-click to mark ${this.tapActionLabel}. Long-press or right-click to mark ${this.holdActionLabel}.`;
		},

		get formattedTime() {
			return formatElapsedTime(this.elapsedMs);
		},

		get challengeGroups() {
			return CHALLENGE_DIFFICULTIES.map((difficulty, difficultyIndex) => ({
				key: difficulty.key,
				label: difficulty.label,
				steps: Array.from(
					{ length: CHALLENGES_PER_DIFFICULTY },
					(_, index) => difficultyIndex * CHALLENGES_PER_DIFFICULTY + index,
				),
			}));
		},

		get cells() {
			this.revision;
			let cells = [];
			let showHints = ['practice', 'shared'].includes(this.mode) && this.hintUsed && this.result === 'playing';
			let showSolution = this.mode === 'challenge' && this.result === 'failed';
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

					let practiceBoardUnavailable = this.mode === 'practice' && !this.practiceBoardReady;
					let disabled = this.boardPreparing || practiceBoardUnavailable ||
						this.result !== 'playing' || !active || revealed ||
						(this.mode === 'tutorial' && this.tutorialComplete);
					let key = `${this.boardNumber}-${index}`;
					cells.push({ key, index, x, y, text, label, className: classNames.join(' '), disabled });
				}
			}
			return cells;
		},

		get resultTitle() {
			if (this.result === 'cleared') return this.mode === 'shared' ? 'Shared puzzle solved' : 'Puzzle solved';
			if (this.result === 'complete') return 'Challenge complete';
			return this.mode === 'challenge' ? 'Run ended' : 'Incorrect move';
		},

		get resultMessage() {
			if (this.result === 'cleared' && this.mode === 'challenge') return 'Good solve. Ready for the next one?';
			if (this.result === 'cleared' && this.mode === 'shared') return 'Nice solve. Open the link again for a fresh board.';
			if (this.result === 'cleared') return 'Good solve. Keep the streak going.';
			if (this.result === 'complete') return `All ${this.challengeTotal} cleared in ${this.formattedTime}.`;
			if (this.mode === 'challenge') return `You reached puzzle ${this.challengeIndex + 1} of ${this.challengeTotal}.`;
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

		activateChallengeResultAction() {
			if (this.result === 'cleared') this.advanceChallenge();
			else if (this.result === 'failed') void this.restartChallenge();
		},

		activatePracticeBoardAction() {
			if (this.boardPreparing) return;
			if (this.result === 'playing' && this.practiceBoardReady) this.skipPracticeBoard();
			else void this.newPracticeBoard();
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
			saveMinesightData('mode', 'practice');
			this.mode = 'practice';
			if (!this.restorePracticeState()) void this.newPracticeBoard();
		},

		removeTutorialFromUrl() {
			let url = new URL(window.location.href);
			if (!url.searchParams.has(TUTORIAL_PARAMETER)) return;
			url.searchParams.delete(TUTORIAL_PARAMETER);
			window.history.replaceState(null, '', url);
		},

		/** @param {GameMode} nextMode */
		switchMode(nextMode) {
			if (this.mode === nextMode) return;
			if (nextMode === 'practice' && this.challengeRunActive) return;
			this.removeTutorialFromUrl();
			if (nextMode === 'challenge') {
				if (this.mode === 'practice') {
					this.snapshotPracticeState();
					this.savePracticeData();
				}
				this.removeSharedPuzzleFromUrl();
				this.practicePreparationId += 1;
				this.boardPreparing = false;
				this.clearPracticeSearchingDelay();
				this.mode = nextMode;
				saveMinesightData('mode', nextMode);
				void this.prepareChallenge();
			}
			else {
				this.removeSharedPuzzleFromUrl();
				this.challengePreparationId += 1;
				this.challengePreparing = false;
				this.challengeStarted = false;
				this.challengePuzzles = [];
				this.stopTimer();
				this.mode = nextMode;
				saveMinesightData('mode', nextMode);
				if (!this.restorePracticeState()) void this.newPracticeBoard();
			}
		},

		removeSharedPuzzleFromUrl() {
			this.sharedPuzzleError = '';
			let url = new URL(window.location.href);
			if (!url.searchParams.has(SHARED_PUZZLE_PARAMETER)) return;
			url.searchParams.delete(SHARED_PUZZLE_PARAMETER);
			window.history.replaceState(null, '', url);
		},

		async sharePracticePuzzle() {
			if (this.mode !== 'practice' || !this.practiceBoardReady || this.boardPreparing) return;
			let url = new URL(window.location.href);
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
			if (!PRACTICE_DIFFICULTIES.some((difficulty) => difficulty.key === key)) return;
			this.snapshotPracticeState();
			this.practicePreparationId += 1;
			this.boardPreparing = false;
			this.clearPracticeSearchingDelay();
			this.difficultyKey = key;
			let restored = this.restorePracticeState();
			this.savePracticeData();
			if (!restored) void this.newPracticeBoard();
		},

		snapshotPracticeState() {
			this.practiceStates[this.difficultyKey] = {
				field: this.field,
				seed: this.boardSeed,
				result: this.result,
				hintUsed: this.hintUsed,
				streak: this.practiceStreak,
				ready: this.practiceBoardReady,
			};
		},

		restorePracticeState() {
			let state = this.practiceStates[this.difficultyKey];
			if (!state) {
				this.practiceStreak = this.practiceStreaks[this.difficultyKey];
				this.practiceBoardReady = false;
				return false;
			}
			this.practiceStreak = state.streak;
			if (!state.ready) {
				this.practiceBoardReady = false;
				return false;
			}
			this.clearIncorrectFeedback();
			this.field = state.field;
			this.boardSeed = state.seed;
			this.result = state.result;
			this.hintUsed = state.hintUsed;
			this.practiceBoardReady = true;
			this.engineError = '';
			this.boardNumber += 1;
			this.revision += 1;
			return true;
		},

		/** @param {number} streak */
		setPracticeStreak(streak) {
			this.practiceStreak = streak;
			this.practiceStreaks[this.difficultyKey] = streak;
		},

		savePracticeData() {
			let difficulties = Object.fromEntries(PRACTICE_DIFFICULTIES.map(({ key }) => {
				let state = this.practiceStates[key];
				/** @type {{ streak: number, board?: { difficultyKey: string, cells: number[], seed: string, result: GameResult, hintUsed: boolean } }} */
				let saved = { streak: this.practiceStreaks[key] };
				if (state?.ready) saved.board = {
					difficultyKey: key,
					cells: Array.from(state.field.state),
					seed: String(state.seed),
					result: state.result,
					hintUsed: state.hintUsed,
				};
				return [key, saved];
			}));
			saveMinesightData('practice', {
				difficultyKey: this.difficultyKey,
				difficulties,
			});
		},

		async newPracticeBoard() {
			this.result = 'playing';
			this.hintUsed = false;
			this.practiceBoardReady = false;
			this.snapshotPracticeState();
			this.savePracticeData();
			await this.replaceField();
		},

		skipPracticeBoard() {
			if (this.mode !== 'practice' || this.result !== 'playing') return;
			void this.newPracticeBoard();
		},

		async prepareChallenge() {
			this.stopTimer();
			this.clearIncorrectFeedback();
			let preparationId = this.challengePreparationId + 1;
			this.challengePreparationId = preparationId;
			this.challengeStarted = false;
			this.challengePreparing = true;
			this.challengePuzzles = [];
			this.challengeIndex = 0;
			this.elapsedMs = 0;
			this.result = 'playing';
			this.hintUsed = false;
			this.engineError = '';

			try {
				for (let difficulty of CHALLENGE_DIFFICULTIES) {
					for (let index = 0; index < CHALLENGES_PER_DIFFICULTY; index += 1) {
						if (this.mode !== 'challenge' || preparationId !== this.challengePreparationId) return;
						let puzzle = await generateField(difficulty, () => (
							this.mode === 'challenge' && preparationId === this.challengePreparationId
						));
						if (!puzzle) return;
						this.challengePuzzles.push(puzzle);
					}
				}
				sortChallengeTiers(this.challengePuzzles);
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
			this.stopTimer();
			this.challengeStarted = true;
			this.challengeIndex = 0;
			this.elapsedMs = 0;
			this.result = 'playing';
			this.hintUsed = false;
			if (!this.loadChallengeField()) return;
			gameSounds.play('start');
			this.startTimer();
		},

		async restartChallenge() {
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
			this.failChallenge();
		},

		/** @param {number} [cellIndex] */
		failChallenge(cellIndex = -1) {
			if (!this.challengeRunActive) return;
			this.cancelGiveUpGesture();
			this.stopTimer();
			this.result = 'failed';
			gameSounds.play('failure');
			feedbackEffects.failure({ cellIndex, terminal: true });
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
			let preparationId = this.practicePreparationId + 1;
			this.practicePreparationId = preparationId;
			this.boardPreparing = true;
			this.clearPracticeSearchingDelay();
			this.practiceSearchingTimerId = window.setTimeout(() => {
				if (
					this.mode === 'practice' &&
					this.boardPreparing &&
					preparationId === this.practicePreparationId
				) this.practiceSearchingVisible = true;
			}, 200);
			this.engineError = '';
			try {
				let difficulty = this.currentDifficulty;
				let difficultyKey = this.difficultyKey;
				let puzzle = await generateField(difficulty, () => (
					this.mode === 'practice' &&
					difficultyKey === this.difficultyKey &&
					preparationId === this.practicePreparationId
				));
				if (
					!puzzle ||
					this.mode !== 'practice' ||
					difficultyKey !== this.difficultyKey ||
					preparationId !== this.practicePreparationId
				) return;
				this.field = puzzle.field;
				this.boardSeed = puzzle.seed;
				this.practiceBoardReady = true;
				this.engineError = '';
				this.boardNumber += 1;
				this.revision += 1;
				this.snapshotPracticeState();
				this.savePracticeData();
			}
			catch (error) {
				if (preparationId !== this.practicePreparationId) return;
				this.engineError = error instanceof Error ? error.message : String(error);
			}
			finally {
				if (preparationId === this.practicePreparationId) {
					this.boardPreparing = false;
					this.clearPracticeSearchingDelay();
				}
			}
		},

		clearPracticeSearchingDelay() {
			if (this.practiceSearchingTimerId !== undefined) {
				window.clearTimeout(this.practiceSearchingTimerId);
			}
			this.practiceSearchingTimerId = undefined;
			this.practiceSearchingVisible = false;
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
			if (!['practice', 'shared'].includes(this.mode) || this.result !== 'playing') return;
			if (this.mode === 'practice' && !this.practiceBoardReady) return;
			this.hintUsed = !this.hintUsed;
			gameSounds.play(this.hintUsed ? 'hint' : 'unmark');
			this.revision += 1;
			if (this.mode === 'practice') {
				this.snapshotPracticeState();
				this.savePracticeData();
			}
		},

		/**
		 * @param {number} x
		 * @param {number} y
		 * @param {boolean} secondary
		 */
		applyCellInput(x, y, secondary) {
			if (this.result !== 'playing') return;
			if (this.mode === 'tutorial') {
				this.applyTutorialInput(x, y, secondary);
				return;
			}
			if (this.mode === 'challenge' && !this.challengeStarted) return;
			if (!this.field.isActive(x, y)) return;
			let cellIndex = this.field.getIndex(x, y);
			let markMine = secondary !== this.actionsInverted;
			let removing = markMine ? this.field.isMarkedMine(x, y) : this.field.isMarkedSafe(x, y);
			if (markMine) this.field.actionMarkMine(x, y);
			else this.field.actionMarkSafe(x, y);
			this.afterMove({ removing, cellIndex, markMine });
		},

		/**
		 * @param {number} x
		 * @param {number} y
		 * @param {boolean} secondary
		 */
		applyTutorialInput(x, y, secondary) {
			if (this.tutorialComplete) return;
			let step = TUTORIAL_STEPS[this.tutorialStep];
			let correctCell = x === step.x && y === step.y;
			let correctGesture = step.action === 'ambiguous' || (step.action === 'mine') === secondary;
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

		/**
		 * @param {number} x
		 * @param {number} y
		 */
		tapCell(x, y) {
			this.applyCellInput(x, y, false);
		},

		/**
		 * @param {number} x
		 * @param {number} y
		 */
		contextMenuCell(x, y) {
			this.applyCellInput(x, y, true);
		},

		/** @param {{ removing: boolean, cellIndex: number, markMine: boolean }} move */
		afterMove(move) {
			let gameOver = this.field.gameOverReason();
			if (gameOver === MineField.GAME_OVER_DETONATION) {
				let feedbackCellIndex = this.field.incorrectIndex;
				if (this.mode === 'challenge') {
					this.failChallenge(feedbackCellIndex);
					return;
				}
				if (this.mode === 'practice') {
					feedbackEffects.streakLost(this.practiceStreak);
					this.setPracticeStreak(0);
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
				if (this.mode === 'challenge') this.stopTimer();
				if (challengeComplete) {
					this.result = 'complete';
					gameSounds.play('complete');
				}
				else {
					this.result = 'cleared';
					if (this.mode === 'practice') this.setPracticeStreak(this.practiceStreak + 1);
					gameSounds.play('success');
				}
				feedbackEffects.success({ grand: challengeComplete });
				feedbackEffects.correctMark({ cellIndex: move.cellIndex, mine: move.markMine });
			}
			else if (move.removing) {
				gameSounds.play('unmark');
			}
			else {
				gameSounds.play('mark');
				feedbackEffects.correctMark({ cellIndex: move.cellIndex, mine: move.markMine });
			}
			this.revision += 1;
			if (this.mode === 'practice') {
				this.snapshotPracticeState();
				this.savePracticeData();
			}
		},

		/** @param {number} step */
		challengeStepClass(step) {
			if (step < this.challengeIndex || (step === this.challengeIndex && ['cleared', 'complete'].includes(this.result))) return 'complete';
			if (step === this.challengeIndex && this.result === 'failed') return 'failed';
			if (step === this.challengeIndex) return 'current';
			return '';
		},

		/** @param {number} step */
		challengeStepLabel(step) {
			let difficulty = CHALLENGE_DIFFICULTIES[Math.floor(step / CHALLENGES_PER_DIFFICULTY)];
			let state = this.challengeStepClass(step) || 'upcoming';
			return `${difficulty.label} challenge ${(step % CHALLENGES_PER_DIFFICULTY) + 1}, ${state}`;
		},
	};
}

// Preload the generator without keeping the tutorial or a shared puzzle behind
// a blank, x-cloaked page. A failed preload is retried when a board is requested.
void ensurePuzzleGenerator().catch(() => {});

Object.assign(window, { minesight: createMinesight });
// @ts-expect-error Alpine is a bundled side-effect script without module typings.
await import('./alpine.min.js');
