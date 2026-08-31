// @ts-check

import { MineField, analyzeEditorBoard, createEditorPuzzle } from './mines.js';
import { feedbackEffects } from './feedback.js';
import { gameSounds } from './sounds.js';

const BOARD_SIZE = 8;
const TRADITIONAL_RULES_VERSION = 2;
const PUZZLE_ATTEMPTS = 1000;
const CELL_HOLD_MS = 450;
const CELL_GESTURE_MOVE_TOLERANCE = 10;
const CELL_CONTEXT_MENU_DEDUP_MS = 1000;
const GIVE_UP_HOLD_MS = 900;
const SCRATCH_TAP_DISTANCE = .01;
const SCRATCH_ERASER_RADIUS = .025;
const SCRATCH_MARK_SIZE = .04125;
const SCRATCH_MARK_ANIMATION_MS = 220;
const MINESIGHT_STORAGE_KEY = 'minesight';
const MINESIGHT_CACHE_PREFIX = 'minesight';
const LEGACY_PUZZLE_PARAMETER = 'p';
const TUTORIAL_PARAMETER = 'tutorial';
const CHALLENGE_MODE_PARAMETER = 'challenge';
const CHALLENGE_SEED_PARAMETER = 'seed';
const CHALLENGE_TIME_PARAMETER = 'time';
const MAX_CHALLENGE_SEED = 0xffff_ffff_ffff_ffffn;
const DAILY_SEED_OFFSET = 0xcbf29ce484222325n;
const DAILY_SEED_PRIME = 0x100000001b3n;
/** @type {Record<string, [number, number]>} */
const CELL_FOCUS_DIRECTIONS = {
	ArrowUp: [0, -1],
	ArrowDown: [0, 1],
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
};

/** @typedef {Event & { prompt: () => Promise<void>, userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }} BeforeInstallPromptEvent */

function isAppInstalled() {
	let standaloneNavigator = /** @type {Navigator & { standalone?: boolean }} */ (navigator);
	return window.matchMedia('(display-mode: standalone)').matches || standaloneNavigator.standalone === true;
}

function appInstallInstructions() {
	let userAgent = navigator.userAgent;
	let isAppleMobile = /iPad|iPhone|iPod/.test(userAgent)
		|| (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	if (isAppleMobile) return 'In Safari, tap Share, then Add to Home Screen.';
	let isSafari = /Safari/.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(userAgent);
	if (isSafari) return 'In Safari, choose File, then Add to Dock.';
	return 'Open your browser menu and choose Install app or Add to Home screen.';
}

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

const BEGINNER_DIFFICULTY = {
	key: 'beginner',
	label: 'Beginner',
	generator: 'randomBeginnerPuzzle',
	description: 'Use one clue at a time to find squares that are immediately safe or mined.',
};
const EASY_DIFFICULTY = {
	key: 'easy',
	label: 'Easy',
	generator: 'randomEasyPuzzle',
	description: 'Recognize familiar patterns on a mostly open board.',
};
const MEDIUM_DIFFICULTY = {
	key: 'medium',
	label: 'Medium',
	generator: 'randomMediumPuzzle',
	description: 'Recognize familiar patterns on a dense board.',
};
const HARD_DIFFICULTY = {
	key: 'hard',
	label: 'Hard',
	generator: 'randomHardPuzzle',
	description: 'Follow deeper chains of logic before a square is certain.',
};
const EXPERT_DIFFICULTY = {
	key: 'expert',
	label: 'Expert',
	generator: 'randomExpertPuzzle',
	description: 'Common patterns have been removed. Use contradiction to rule out possible mine layouts and find the forced squares.',
};
const MIT_DIFFICULTY = {
	key: 'mit',
	label: 'MIT-style',
	generator: 'randomMitPuzzle',
	description: 'Solve the whole board from a minimal set of clues. Each puzzle has a unique mine layout.',
};
const DAILY_DIFFICULTIES = [
	EASY_DIFFICULTY,
	MEDIUM_DIFFICULTY,
	HARD_DIFFICULTY,
	EXPERT_DIFFICULTY,
	MIT_DIFFICULTY,
];
const STUDY_DIFFICULTIES = [
	BEGINNER_DIFFICULTY,
	EASY_DIFFICULTY,
	MEDIUM_DIFFICULTY,
	HARD_DIFFICULTY,
	EXPERT_DIFFICULTY,
	MIT_DIFFICULTY,
];

/** Returns YYYY-MM-DD using the user's local calendar, not UTC. */
function localDateKey(date = new Date()) {
	let year = date.getFullYear();
	let month = String(date.getMonth() + 1).padStart(2, '0');
	let day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/** Stable 64-bit seed for one local calendar day. Rust applies a difficulty-specific XOR salt. */
function dailyPuzzleSeed(dateKey) {
	let seed = DAILY_SEED_OFFSET;
	for (let byte of new TextEncoder().encode(`minesight-daily\0${dateKey}`)) {
		seed ^= BigInt(byte);
		seed = BigInt.asUintN(64, seed * DAILY_SEED_PRIME);
	}
	return seed;
}
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
	let [path, query = ''] = url.hash.slice(1).split('?');
	let routeSearchParams = new URLSearchParams(query);
	if (path.startsWith('/puzzle/')) return { mode: 'puzzle', payload: path.slice('/puzzle/'.length) };

	let dailyMatch = path.match(/^\/daily(?:\/([^/]+))?$/);
	if (dailyMatch) {
		let difficultyKey = dailyMatch[1];
		if (difficultyKey === undefined || DAILY_DIFFICULTIES.some(({ key }) => key === difficultyKey)) {
			return { mode: 'daily', difficultyKey };
		}
	}

	let studyMatch = path.match(/^\/study(?:\/([^/]+))?$/);
	if (studyMatch) {
		let difficultyKey = studyMatch[1];
		if (difficultyKey === undefined || STUDY_DIFFICULTIES.some(({ key }) => key === difficultyKey)) {
			return { mode: 'study', difficultyKey };
		}
	}

	let challengeMatch = path.match(/^\/challenge\/([^/]+)$/);
	let modeKey = challengeMatch?.[1];
	if (modeKey !== undefined && CHALLENGE_MODES.some(({ key }) => key === modeKey)) {
		let seedText = routeSearchParams.get(CHALLENGE_SEED_PARAMETER);
		let timeText = routeSearchParams.get(CHALLENGE_TIME_PARAMETER);
		return {
			mode: 'challenge',
			modeKey,
			received: seedText !== null || timeText !== null,
			seed: seedText === null ? undefined : parseChallengeSeed(seedText),
			time: timeText === null ? undefined : parseChallengeTime(timeText),
		};
	}

	if (path === '/tutorial') return { mode: 'tutorial' };
	if (path === '/editor') return { mode: 'editor' };
	if (path === '/traditional') return { mode: 'traditional' };
	return { mode: 'home' };
}

/** @param {URL} url */
function redirectLegacyUrl(url) {
	let hasLegacyRoute = [LEGACY_PUZZLE_PARAMETER, TUTORIAL_PARAMETER, CHALLENGE_MODE_PARAMETER]
		.some((parameter) => url.searchParams.has(parameter));
	if (!hasLegacyRoute) return url;

	let route = '/';
	let puzzlePayload = url.searchParams.get(LEGACY_PUZZLE_PARAMETER);
	let modeKey = url.searchParams.get(CHALLENGE_MODE_PARAMETER);
	if (puzzlePayload !== null) route = `/puzzle/${puzzlePayload}`;
	else if (modeKey !== null && CHALLENGE_MODES.some(({ key }) => key === modeKey)) {
		let routeSearchParams = new URLSearchParams();
		let seed = url.searchParams.get(CHALLENGE_SEED_PARAMETER);
		let time = url.searchParams.get(CHALLENGE_TIME_PARAMETER);
		if (seed !== null) routeSearchParams.set(CHALLENGE_SEED_PARAMETER, seed);
		if (time !== null) routeSearchParams.set(CHALLENGE_TIME_PARAMETER, time);
		route = `/challenge/${modeKey}${routeSearchParams.size > 0 ? `?${routeSearchParams}` : ''}`;
	}
	else if (url.searchParams.has(TUTORIAL_PARAMETER)) route = '/tutorial';

	for (let parameter of [LEGACY_PUZZLE_PARAMETER, TUTORIAL_PARAMETER, CHALLENGE_MODE_PARAMETER, CHALLENGE_SEED_PARAMETER, CHALLENGE_TIME_PARAMETER]) {
		url.searchParams.delete(parameter);
	}
	url.hash = route;
	window.history.replaceState(null, '', url);
	return url;
}

/**
 * @param {string | URL} source
 * @param {string} route
 */
function createRouteUrl(source, route) {
	let url = new URL(source);
	for (let parameter of [LEGACY_PUZZLE_PARAMETER, TUTORIAL_PARAMETER, CHALLENGE_MODE_PARAMETER, CHALLENGE_SEED_PARAMETER, CHALLENGE_TIME_PARAMETER]) {
		url.searchParams.delete(parameter);
	}
	url.hash = route;
	return url;
}

/**
 * @param {string | URL} source
 * @param {string} modeKey
 * @param {bigint} seed
 * @param {number | undefined} elapsedMs
 */
function createChallengeShareUrl(source, modeKey, seed, elapsedMs) {
	let routeSearchParams = new URLSearchParams({ [CHALLENGE_SEED_PARAMETER]: seed.toString(16) });
	if (elapsedMs !== undefined) routeSearchParams.set(CHALLENGE_TIME_PARAMETER, String(elapsedMs));
	return createRouteUrl(source, `/challenge/${modeKey}?${routeSearchParams}`);
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

/** @param {number} bytes */
function formatStorageSize(bytes) {
	if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';
	if (bytes < 1024) return `${Math.round(bytes)} B`;
	let units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes;
	let unit = 'B';
	for (let nextUnit of units) {
		value /= 1024;
		unit = nextUnit;
		if (value < 1024) break;
	}
	let digits = value < 10 ? 1 : 0;
	return `${value.toFixed(digits)} ${unit}`;
}

async function measureMinesightStorageUsage() {
	let bytes = 0;
	try {
		let stored = window.localStorage.getItem(MINESIGHT_STORAGE_KEY);
		if (stored !== null) {
			bytes += new TextEncoder().encode(MINESIGHT_STORAGE_KEY).byteLength;
			bytes += new TextEncoder().encode(stored).byteLength;
		}
	}
	catch {}

	try {
		if ('caches' in window) {
			let cacheNames = await window.caches.keys();
			let mineSightCacheNames = cacheNames.filter(name => (
				name === MINESIGHT_CACHE_PREFIX || name.startsWith(`${MINESIGHT_CACHE_PREFIX}-`)
			));
			let cacheSizes = await Promise.all(mineSightCacheNames.map(async name => {
				let cache = await window.caches.open(name);
				let responses = await cache.matchAll();
				let responseSizes = await Promise.all(responses.map(async response => {
					let contentLengthHeader = response.headers.get('content-length');
					let contentLength = Number(contentLengthHeader);
					if (contentLengthHeader !== null && Number.isFinite(contentLength) && contentLength >= 0) return contentLength;
					return (await response.blob()).size;
				}));
				return responseSizes.reduce((total, size) => total + size, 0);
			}));
			bytes += cacheSizes.reduce((total, size) => total + size, 0);
		}
	}
	catch {}
	return bytes;
}

/** @param {'system' | 'light' | 'dark'} colorScheme */
function applyColorScheme(colorScheme) {
	let dark = colorScheme === 'dark' || (colorScheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
	let resolvedColorScheme = dark ? 'dark' : 'light';
	document.documentElement.dataset.colorScheme = resolvedColorScheme;
	document.documentElement.style.colorScheme = resolvedColorScheme;
}

function isLocalDevelopment() {
	return ['', 'localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
}

/** @type {WebAssembly.Exports | undefined} */
let wasm;
/** @type {{ cells: Uint8Array, seed: bigint, attempts: number } | undefined} */
let generatedPuzzle;
/** @type {{ x: number, y: number, mine: boolean }[] | undefined} */
let solveResult;
/** @type {{ mines: bigint, forcedSafe: bigint } | undefined} */
let traditionalMoveResult;
/** @type {Error | undefined} */
let wasmError;
/** @type {Promise<void> | undefined} */
let generatorLoadPromise;

async function loadPuzzleGenerator() {
	const imports = {
		env: {
			/** @param {number} pointer @param {number} length */
			resultError(pointer, length) {
				if (!wasm || !(wasm.memory instanceof WebAssembly.Memory)) {
					throw new Error('wasm returned an error before exposing its memory');
				}
				let bytes = new Uint8Array(wasm.memory.buffer, pointer, length);
				wasmError = new Error(new TextDecoder().decode(bytes));
			},
			/** @param {number} pointer @param {number} length */
			resultSolve(pointer, length) {
				if (!wasm || !(wasm.memory instanceof WebAssembly.Memory)) {
					throw new Error('wasm returned solver results before exposing its memory');
				}
				let entries = new Uint8Array(wasm.memory.buffer, pointer, length * 3);
				solveResult = Array.from({ length }, (_, index) => ({
					x: entries[index * 3],
					y: entries[index * 3 + 1],
					mine: entries[index * 3 + 2] !== 0,
				}));
			},
			/** @param {number} minesLow @param {number} minesHigh @param {number} forcedSafeLow @param {number} forcedSafeHigh */
			resultTraditionalMove(minesLow, minesHigh, forcedSafeLow, forcedSafeHigh) {
				/** @param {number} low @param {number} high */
				let mask = (low, high) => BigInt(low >>> 0) | BigInt(high >>> 0) << 32n;
				traditionalMoveResult = {
					mines: mask(minesLow, minesHigh),
					forcedSafe: mask(forcedSafeLow, forcedSafeHigh),
				};
			},
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

/**
 * Computes every covered cell forced by the visible Minesweeper clues.
 * Cell values are 0..8 for clues, 9 for a revealed masked clue, 10 for a
 * covered cell, and 11 for a flagged covered cell.
 *
 * @param {number} width
 * @param {number} height
 * @param {ArrayLike<number>} cells row-major cells
 * @returns {Promise<{ x: number, y: number, mine: boolean }[]>}
 */
export async function solveBoard(width, height, cells) {
	if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0 || width > 8 || height > 8) {
		throw new Error('board width and height must be integers from 0 through 8');
	}
	if (cells.length !== width * height) {
		throw new Error(`board has ${cells.length} cells instead of ${width * height}`);
	}
	for (let index = 0; index < cells.length; index += 1) {
		if (!Number.isInteger(cells[index]) || cells[index] < 0 || cells[index] > 11) {
			throw new Error(`board cell ${index} has invalid value ${cells[index]}`);
		}
	}

	await ensurePuzzleGenerator();
	let allocate = wasm?.allocate;
	let free = wasm?.free;
	let solve = wasm?.solve;
	if (typeof allocate !== 'function' || typeof free !== 'function' || typeof solve !== 'function' || !(wasm?.memory instanceof WebAssembly.Memory)) {
		throw new Error('the Rust SAT solver is not loaded');
	}

	wasmError = undefined;
	solveResult = undefined;
	let allocationSize = 2 + cells.length;
	let allocationAlign = 1;
	let pointer = Number(allocate(allocationSize, allocationAlign));
	if (wasmError) throw wasmError;
	if (pointer === 0) throw new Error('wasm failed to allocate a solver board');

	let solved;
	try {
		let board = new Uint8Array(wasm.memory.buffer, pointer, allocationSize);
		board[0] = width;
		board[1] = height;
		board.set(cells, 2);
		solved = Boolean(solve(pointer));
	}
	finally {
		free(pointer, allocationSize, allocationAlign);
	}
	if (wasmError) throw wasmError;
	if (!solved) throw new Error('wasm SAT solver failed without returning an error');
	if (!solveResult) throw new Error('wasm SAT solver returned without a result');
	return solveResult;
}

/**
 * Sends the visible JavaScript-held game state through the Rust SAT engine and
 * returns a compatible hidden layout and the safe cells proved before one
 * traditional-mode click.
 * @param {MineField} field
 * @param {number} clickedIndex
 * @param {bigint} seed
 */
export async function resolveTraditionalMove(field, clickedIndex, seed) {
	if (field.width !== BOARD_SIZE || field.height !== BOARD_SIZE) throw new Error('traditional mode requires an 8 by 8 board');
	if (!Number.isInteger(clickedIndex) || clickedIndex < 0 || clickedIndex >= BOARD_SIZE * BOARD_SIZE) {
		throw new Error('clicked cell is outside the traditional board');
	}
	if (seed < 0n || seed > MAX_CHALLENGE_SEED) throw new Error('traditional seed must be an unsigned 64-bit integer');

	await ensurePuzzleGenerator();
	let allocate = wasm?.allocate;
	let free = wasm?.free;
	let traditionalMove = wasm?.traditionalMove;
	if (typeof allocate !== 'function' || typeof free !== 'function' || typeof traditionalMove !== 'function' || !(wasm?.memory instanceof WebAssembly.Memory)) {
		throw new Error('the Rust traditional solver is not loaded');
	}

	let cells = field.state;
	wasmError = undefined;
	traditionalMoveResult = undefined;
	let pointer = Number(allocate(cells.length, 1));
	if (wasmError) throw wasmError;
	if (pointer === 0) throw new Error('wasm failed to allocate a traditional board');
	let resolved;
	try {
		new Uint8Array(wasm.memory.buffer, pointer, cells.length).set(cells);
		resolved = Boolean(traditionalMove(
			pointer,
			clickedIndex,
			Number(seed & 0xffff_ffffn),
			Number(seed >> 32n),
		));
	}
	finally {
		free(pointer, cells.length, 1);
	}
	if (wasmError) throw wasmError;
	if (!resolved || traditionalMoveResult === undefined) throw new Error('Rust could not reshape this board');
	return traditionalMoveResult;
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

/** @param {bigint} seed */
function nextTraditionalSeed(seed) {
	return BigInt.asUintN(64, seed + 0x9e3779b97f4a7c15n);
}

/** @param {MineField} field @param {bigint} mines */
function fieldWithMineLayout(field, mines) {
	let state = Uint8Array.from(field.state, (cell, index) => {
		let visible = cell & (MineField.REVEALED | MineField.FLAG);
		return visible | ((mines & (1n << BigInt(index))) !== 0n ? MineField.MINE : 0);
	});
	return new MineField(field.width, field.height, state);
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

/** @typedef {'home' | 'tutorial' | 'study' | 'daily' | 'challenge' | 'puzzle' | 'editor' | 'traditional'} GameMode */
/** @typedef {'playing' | 'cleared' | 'failed' | 'gave-up' | 'complete'} GameResult */
/** @typedef {'cleared' | 'failed'} ChallengeResult */
/** @typedef {{ field: MineField, seed: bigint, result: GameResult, hintUsed: boolean, streak: number, ready: boolean }} StudyState */
/** @typedef {{ field: MineField, seed: bigint, result: GameResult, completed: boolean, ready: boolean }} DailyState */

/** @param {unknown} value @returns {GameMode} */
function parseGameMode(value) {
	if (value === 'tutorial' || value === 'study' || value === 'daily'
		|| value === 'challenge' || value === 'puzzle' || value === 'editor' || value === 'traditional') return value;
	return 'home';
}

/** Wait for Alpine to apply pending reactive DOM updates. */
function nextAlpineRender() {
	let alpine = /** @type {Window & { Alpine: { nextTick: () => Promise<void> } }} */ (window).Alpine;
	return alpine.nextTick();
}

/**
 * Owns the presentation state for one rendered minefield. The parent controller
 * handles input and the page applies game rules by updating this view.
 *
 * @param {MineField} field
 */
function createMineField(field) {
	/** @type {ResizeObserver | undefined} */
	let scratchResizeObserver;
	/** @type {HTMLCanvasElement | undefined} */
	let scratchCanvas;
	return {
		field,
		/** @type {GameResult} */
		result: 'playing',
		hintsVisible: false,
		solutionVisible: false,
		traditionalRules: false,
		tutorialRules: false,
		ready: true,
		busy: false,
		actionsInverted: false,
		revision: 0,
		boardNumber: 0,
		incorrectCellIndex: -1,
		keyboardFocusIndex: -1,
		/** @type {number | undefined} */
		cellHoldTimerId: undefined,
		/** @type {number | undefined} */
		cellGesturePointerId: undefined,
		cellGestureStartX: 0,
		cellGestureStartY: 0,
		lastCellHoldX: -1,
		lastCellHoldY: -1,
		lastCellHoldTime: 0,
		scratchActive: false,
		scratchTool: 'pencil',
		scratchColor: 'graphite',
		scratchColors: [
			{ key: 'graphite', label: 'Graphite' },
			{ key: 'blue', label: 'Blue' },
			{ key: 'red', label: 'Red' },
		],
		/** @type {Array<{ color: string, points: Array<{ x: number, y: number }>, drawProgress?: number }>} */
		scratchStrokes: [],
		/** @type {{ color: string, points: Array<{ x: number, y: number }> } | undefined} */
		scratchStroke: undefined,
		/** @type {{ x: number, y: number } | undefined} */
		scratchEraserPoint: undefined,

		get boardResultClass() { return `result-${this.result}`; },
		get minefieldStyle() { return `--columns: ${this.field.width}`; },
		get tapActionLabel() { return this.actionsInverted ? 'Mine' : 'Safe'; },
		get holdActionLabel() { return this.actionsInverted ? 'Safe' : 'Mine'; },

		destroy() {
			if (this.cellHoldTimerId !== undefined) window.clearTimeout(this.cellHoldTimerId);
			this.cellHoldTimerId = undefined;
			this.cellGesturePointerId = undefined;
			scratchResizeObserver?.disconnect();
			scratchCanvas = undefined;
		},
		reset() {
			this.keyboardFocusIndex = -1;
			this.resetScratchPad();
		},

		get cells() {
			this.revision;
			let field = this.field;
			let result = this.result;
			let cells = [];
			let showHints = this.hintsVisible && result === 'playing';
			let showSolution = this.solutionVisible;
			for (let y = 0; y < field.height; y += 1) for (let x = 0; x < field.width; x += 1) {
				let index = field.getIndex(x, y);
				let mine = field.isMine(x, y);
				let revealed = field.isRevealed(x, y);
				let flagged = field.isFlagged(x, y);
				let markedMine = field.isMarkedMine(x, y);
				let markedSafe = field.isMarkedSafe(x, y);
				let active = this.traditionalRules ? !revealed : field.isActive(x, y);
				let incorrect = field.isIncorrect(x, y) || index === this.incorrectCellIndex
					|| (this.traditionalRules && result === 'failed' && mine && revealed);
				let solutionMine = showSolution && field.isForcedMine(x, y);
				let solutionSafe = (showSolution || (this.traditionalRules && result === 'failed')) && field.isForcedSafe(x, y);
				let clue = field.getClue(x, y);
				let showMine = !this.traditionalRules && !field.isPuzzle && mine && (revealed || result === 'failed');
				let hinted = showHints && ((field.isForcedSafe(x, y) && !markedSafe) || (field.isForcedMine(x, y) && !markedMine));
				let classNames = [];
				if (revealed) classNames.push('revealed');
				if (flagged) classNames.push('flagged');
				if (markedMine || solutionMine || (this.traditionalRules && flagged)) classNames.push('marked-mine');
				if (markedSafe || solutionSafe) classNames.push('marked-safe');
				if (!active && !revealed && !flagged) classNames.push('inactive');
				if (hinted) classNames.push('hinted');
				if (showMine) classNames.push('mine');
				if (incorrect) classNames.push('incorrect-guess');
				if (mine && revealed) classNames.push('detonated');
				if (revealed && !mine && clue > 0) classNames.push(`clue-${clue}`);
				let text = incorrect ? '!' : markedSafe || solutionSafe ? '✓' : markedMine || solutionMine || flagged ? '⚑'
					: showMine ? '✹' : hinted ? '?' : revealed && clue > 0 ? String(clue) : '';
				let description = incorrect ? 'incorrect choice' : solutionSafe ? 'solution: safe' : solutionMine ? 'solution: mine'
					: markedSafe ? 'marked safe' : markedMine ? 'marked mine' : flagged ? 'flagged' : showMine ? 'mine'
					: hinted ? 'hint' : revealed ? clue > 0 ? `clue ${clue}` : 'empty' : active ? 'covered square' : 'outside this puzzle';
				let chordable = !this.tutorialRules && revealed && !mine;
				let disabled = this.busy || !this.ready || result !== 'playing' || (!active && !chordable);
				cells.push({ key: `${this.boardNumber}-${index}`, index, x, y, text, className: classNames.join(' '),
					label: `Row ${y + 1}, column ${x + 1}, ${description}`, disabled, tabIndex: -1 });
			}
			let keyboardTarget = cells.find(cell => cell.index === this.keyboardFocusIndex && !cell.disabled) ?? cells.find(cell => !cell.disabled);
			for (let cell of cells) cell.tabIndex = cell === keyboardTarget ? 0 : -1;
			return cells;
		},

		toggleScratchPad() {
			this.scratchActive = !this.scratchActive;
			if (this.scratchActive && this.scratchTool === 'eraser') {
				this.scratchTool = 'pencil';
				this.scratchColor = this.scratchColors[0].key;
			}
			this.scratchStroke = undefined;
			this.scratchEraserPoint = undefined;
		},
		/** @param {unknown} canvas */
		setupScratchPad(canvas) {
			if (!(canvas instanceof HTMLCanvasElement)) return;
			scratchCanvas = canvas;
			scratchResizeObserver?.disconnect();
			scratchResizeObserver = new ResizeObserver(() => this.resizeScratchPad());
			scratchResizeObserver.observe(canvas.parentElement ?? canvas);
			this.resizeScratchPad();
		},
		resizeScratchPad() {
			let canvas = scratchCanvas;
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
			let canvas = scratchCanvas;
			if (!(canvas instanceof HTMLCanvasElement)) return;
			let context = canvas.getContext('2d');
			let rect = canvas.getBoundingClientRect();
			if (!context || rect.width <= 0 || rect.height <= 0) return;
			let styles = getComputedStyle(document.documentElement);
			let colors = Object.fromEntries(this.scratchColors.map(color => [color.key, styles.getPropertyValue(`--scratch-${color.key}`).trim()]));
			context.setTransform(1, 0, 0, 1, 0, 0);
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.setTransform(canvas.width / rect.width, 0, 0, canvas.width / rect.width, 0, 0);
			context.lineCap = 'round'; context.lineJoin = 'round'; context.lineWidth = 2.4;
			for (let stroke of this.scratchStrokes) {
				let first = stroke.points[0];
				if (!first) continue;
				let progress = Math.max(0, Math.min(1, stroke.drawProgress ?? 1));
				if (progress === 0) continue;
				context.beginPath(); context.strokeStyle = colors[stroke.color] || colors.graphite;
				context.moveTo(first.x * rect.width, first.y * rect.height);
				let segments = stroke.points.slice(1).map((point, index) => {
					let previous = stroke.points[index];
					return { point, previous, length: Math.hypot((point.x - previous.x) * rect.width, (point.y - previous.y) * rect.height) };
				});
				let remaining = segments.reduce((total, segment) => total + segment.length, 0) * progress;
				for (let segment of segments) {
					if (remaining >= segment.length) {
						context.lineTo(segment.point.x * rect.width, segment.point.y * rect.height);
						remaining -= segment.length;
						continue;
					}
					let amount = segment.length === 0 ? 1 : remaining / segment.length;
					context.lineTo((segment.previous.x + (segment.point.x - segment.previous.x) * amount) * rect.width,
						(segment.previous.y + (segment.point.y - segment.previous.y) * amount) * rect.height);
					break;
				}
				if (stroke.points.length === 1) context.lineTo(first.x * rect.width + .01, first.y * rect.height + .01);
				context.stroke();
			}
		},
		scratchPoint(event) {
			let rect = event.currentTarget.getBoundingClientRect();
			return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
		},
		isScratchTap(stroke, endPoint) {
			let first = stroke.points[0];
			return Boolean(first) && [...stroke.points, ...(endPoint ? [endPoint] : [])].every(point => Math.hypot(point.x - first.x, point.y - first.y) < SCRATCH_TAP_DISTANCE);
		},
		eraseScratchStrokes(start, end) {
			this.scratchStrokes = this.scratchStrokes.filter(stroke => {
				if (stroke === this.scratchStroke || stroke.points.length === 0) return true;
				if (stroke.points.length === 1) return pointSegmentDistance(stroke.points[0], start, end) > SCRATCH_ERASER_RADIUS;
				return !stroke.points.slice(1).some((point, index) => segmentDistance(stroke.points[index], point, start, end) <= SCRATCH_ERASER_RADIUS);
			});
		},
		startScratchStroke(event) {
			if (!this.scratchActive || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
			event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
			let point = this.scratchPoint(event);
			if (this.scratchTool === 'eraser') { this.scratchEraserPoint = point; this.eraseScratchStrokes(point, point); }
			else { this.scratchStroke = { color: this.scratchColor, points: [point] }; this.scratchStrokes.push(this.scratchStroke); }
			this.renderScratchPad();
		},
		continueScratchStroke(event) {
			if ((!this.scratchStroke && !this.scratchEraserPoint) || !event.isPrimary || event.buttons === 0) return;
			event.preventDefault(); let point = this.scratchPoint(event);
			if (this.scratchEraserPoint) { this.eraseScratchStrokes(this.scratchEraserPoint, point); this.scratchEraserPoint = point; }
			else {
				let previous = this.scratchStroke?.points.at(-1);
				if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= .0015) this.scratchStroke?.points.push(point);
			}
			this.renderScratchPad();
		},
		endScratchStroke(event) {
			if (!event.isPrimary) return;
			if (this.scratchEraserPoint) { this.scratchEraserPoint = undefined; return; }
			let stroke = this.scratchStroke; this.scratchStroke = undefined;
			if (!stroke) return;
			if (event.type === 'pointercancel') {
				if (this.isScratchTap(stroke)) this.scratchStrokes.splice(this.scratchStrokes.indexOf(stroke), 1);
				this.renderScratchPad();
				return;
			}
			let point = this.scratchPoint(event);
			if (!this.isScratchTap(stroke, point)) return;
			this.scratchStrokes.splice(this.scratchStrokes.indexOf(stroke), 1);
			this.drawScratchMark(point, this.flagForInput(false));
		},
		drawScratchMark(point, flag) {
			let jitter = () => (Math.random() - .5) * SCRATCH_MARK_SIZE * .12;
			let angle = (Math.random() - .5) * .14;
			let rotate = (x, y) => ({ x: point.x + x * Math.cos(angle) - y * Math.sin(angle) + jitter(), y: point.y + x * Math.sin(angle) + y * Math.cos(angle) + jitter() });
			let path = flag ? [[-.32, .9], [-.32, -.9], [-.3, -.82], [.72, -.48], [-.3, -.08]] : [[-.8, -.02], [-.22, .62], [.86, -.72]];
			let stroke = { color: this.scratchColor, points: path.map(([x, y]) => rotate(x * SCRATCH_MARK_SIZE, y * SCRATCH_MARK_SIZE)), drawProgress: 0 };
			this.scratchStrokes.push(stroke);
			let startTime;
			let drawFrame = time => {
				startTime ??= time;
				stroke.drawProgress = Math.min(1, (time - startTime) / SCRATCH_MARK_ANIMATION_MS);
				this.renderScratchPad();
				if (stroke.drawProgress < 1) requestAnimationFrame(drawFrame);
			};
			requestAnimationFrame(drawFrame);
		},
		contextMenuScratch(event) {
			if (!this.scratchActive) return;
			let point = this.scratchPoint(event);
			if (this.scratchTool === 'eraser') this.eraseScratchStrokes(point, point);
			else {
				if (this.scratchStroke && this.isScratchTap(this.scratchStroke, point)) {
					this.scratchStrokes.splice(this.scratchStrokes.indexOf(this.scratchStroke), 1);
					this.scratchStroke = undefined;
				}
				this.drawScratchMark(point, this.flagForInput(true));
			}
			this.renderScratchPad();
		},
		cycleScratchTool(event) {
			if (!this.scratchActive) return;
			let delta = event.deltaY || event.deltaX;
			if (delta === 0) return;
			let tools = [...this.scratchColors.map(color => color.key), 'eraser'];
			let current = this.scratchTool === 'eraser' ? tools.length - 1 : tools.indexOf(this.scratchColor);
			let next = tools[(current + (delta > 0 ? 1 : -1) + tools.length) % tools.length];
			if (next === 'eraser') this.scratchTool = 'eraser';
			else { this.scratchTool = 'pencil'; this.scratchColor = next; }
		},
		clearScratchPad() { this.scratchStrokes = []; this.scratchStroke = undefined; this.scratchEraserPoint = undefined; this.renderScratchPad(); },
		async resetScratchPad() {
			this.scratchActive = false;
			this.scratchTool = 'pencil';
			this.clearScratchPad();
			await nextAlpineRender();
			this.resizeScratchPad();
		},
	};
}

function createHomePage() {
	return {
		kind: 'home',
		title: '',
		field: new MineField(BOARD_SIZE, BOARD_SIZE),
		result: 'playing',
		markValidation: 'immediate',
		hints: false,
		traditionalRules: false,
		tutorialRules: false,
		requiresReadyBoard: false,
		showSolution: () => false,
		currentDifficulty: () => STUDY_DIFFICULTIES[0],
		showBoard: () => false,
		open() {
			this.refreshDailyProgress();
		},
		close() {},
		inputHelp: () => '',
		applyCellInput() {},
		share() {},
		shareButtonLabel: () => '',
		shareDisabled: () => true,
		showPuzzleStatus: false,
		statusTitle: () => '',
		statusMessage: () => '',
		resultTitle: () => '',
		resultMessage: () => '',
		hintDisabled: () => true,
		toggleHint() {},
		beforeMove() {},
		handleIncorrect: () => false,
		handleCleared: () => false,
		saveMove() {},
		dailyProgress: '',
		refreshDailyProgress() {
			let stored = loadMinesightData()?.daily;
			let completed = stored?.lastSeenDate === localDateKey()
				? DAILY_DIFFICULTIES.filter(({ key }) => stored.difficulties?.[key]?.completed).length
				: 0;
			this.dailyProgress = `${completed}/${DAILY_DIFFICULTIES.length} complete today`;
		},
	};
}

function createTutorialPage() {
	return {
		kind: 'tutorial',
		title: 'How to play',
		field: new MineField(BOARD_SIZE, BOARD_SIZE),
		result: 'playing',
		markValidation: 'immediate',
		hints: false,
		traditionalRules: false,
		tutorialRules: true,
		requiresReadyBoard: false,
		showSolution: () => false,
		tutorialStep: 0,
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
		currentDifficulty: () => STUDY_DIFFICULTIES[0],
		showBoard: () => true,
		open(app) {
			app.clearIncorrectFeedback();
			this.result = 'playing';
			app.engineError = '';
			this.field = createTutorialField();
			app.boardNumber += 1;
			app.revision += 1;
		},
		close() {},
		inputHelp(app) {
			return `Tap or left-click to mark ${app.tapActionLabel}. Long-press or right-click to mark ${app.holdActionLabel}.`;
		},
		applyCellInput(app, x, y, flag) {
			this.applyInput(app, x, y, flag);
		},
		share(app) {
			return app.sharePuzzle();
		},
		shareButtonLabel: () => 'Share this puzzle',
		shareDisabled: () => true,
		showPuzzleStatus: false,
		statusTitle: () => '',
		statusMessage: () => '',
		resultTitle: () => '',
		resultMessage: () => '',
		hintDisabled: () => true,
		toggleHint() {},
		beforeMove() {},
		handleIncorrect: () => false,
		handleCleared: () => false,
		saveMove() {},
		/** @param {any} app @param {number} x @param {number} y @param {boolean} flag */
		applyInput(app, x, y, flag) {
			if (this.tutorialComplete) return;
			let step = TUTORIAL_STEPS[this.tutorialStep];
			let correctCell = x === step.x && y === step.y;
			let correctGesture = step.action === 'ambiguous' || (step.action === 'mine') === flag;
			if (!correctCell || !correctGesture) {
				this.rejectInput(app, x, y);
				return;
			}

			if (step.action === 'safe') this.field.actionMarkSafe(x, y);
			else if (step.action === 'mine') this.field.actionMarkMine(x, y);
			else {
				this.field.actionMarkSafe(x, y);
				this.field.consumeIncorrect();
				let index = this.field.getIndex(x, y);
				app.showIncorrectFeedback(index, 'That square is not forced. Minesight rejects guesses.');
				gameSounds.play('incorrect');
				feedbackEffects.failure({ cellIndex: index, terminal: false });
			}
			if (step.action !== 'ambiguous') {
				gameSounds.play('mark');
				feedbackEffects.mark({
					cellIndex: this.field.getIndex(x, y),
					mine: step.action === 'mine',
				});
			}
			this.tutorialStep += 1;
			app.revision += 1;
		},
		/** @param {any} app @param {number} x @param {number} y */
		rejectInput(app, x, y) {
			let index = this.field.getIndex(x, y);
			app.showIncorrectFeedback(index, 'Try the highlighted square using the instructed action.');
			gameSounds.play('incorrect');
			feedbackEffects.failure({ cellIndex: index, terminal: false });
		},
		/** @param {any} app */
		finish(app) {
			if (app.page !== this) return;
			app.navigate(`/study/${BEGINNER_DIFFICULTY.key}`);
		},
		/** @param {any} app */
		skip(app) {
			if (app.page === this) app.switchMode('home');
		},
	};
}

function createStudyPage() {
	let stored = loadMinesightData()?.study ?? {};
	let difficultyKey = STUDY_DIFFICULTIES.some(({ key }) => key === stored.difficultyKey)
		? stored.difficultyKey
		: STUDY_DIFFICULTIES[0].key;
	let streaks = Object.fromEntries(STUDY_DIFFICULTIES.map(({ key }) => {
		let streak = stored.difficulties?.[key]?.streak;
		return [key, Math.max(0, Number.parseInt(streak) || 0)];
	}));
	/** @type {Record<string, StudyState | undefined>} */
	let states = Object.fromEntries(STUDY_DIFFICULTIES.map(({ key }) => {
		let saved = stored.difficulties?.[key];
		if (!Array.isArray(saved?.board?.cells) || saved.board.difficultyKey !== key) return [key, undefined];
		try {
			return [key, {
				field: new MineField(BOARD_SIZE, BOARD_SIZE, Uint8Array.from(saved.board.cells)),
				seed: BigInt(saved.board.seed),
				result: saved.board.result === 'cleared' ? 'cleared' : 'playing',
				hintUsed: Boolean(saved.board.hintUsed),
				streak: streaks[key],
				ready: true,
			}];
		}
		catch {
			return [key, undefined];
		}
	}));
	return {
		kind: 'study',
		title: 'Study',
		field: new MineField(BOARD_SIZE, BOARD_SIZE),
		result: 'playing',
		markValidation: 'immediate',
		hints: true,
		hintUsed: false,
		traditionalRules: false,
		tutorialRules: false,
		requiresReadyBoard: true,
		showSolution: () => false,
		difficulties: STUDY_DIFFICULTIES,
		difficultyKey,
		states,
		streaks,
		streak: streaks[difficultyKey],
		ready: false,
		preparing: false,
		preparationId: 0,
		searchingVisible: false,
		/** @type {number | undefined} */
		searchingTimerId: undefined,
		currentDifficulty() {
			return STUDY_DIFFICULTIES.find(({ key }) => key === this.difficultyKey) ?? STUDY_DIFFICULTIES[0];
		},
		close(app) {
			this.cancelPreparation(app);
			this.snapshotState(app);
			this.saveData();
		},
		open(app, route) {
			if (route.difficultyKey !== undefined) this.difficultyKey = route.difficultyKey;
			else {
				window.history.replaceState(null, '', createRouteUrl(window.location.href, `/study/${this.difficultyKey}`));
				app.activeRouteUrl = window.location.href;
			}
			this.streak = this.streaks[this.difficultyKey];
			if (!this.restoreState(app)) void this.newBoard(app);
		},
		showBoard() {
			return this.ready || this.preparing;
		},
		inputHelp(app) {
			if (app.scratchActive) return 'Draw freely over the board. Select Done to mark squares again.';
			return `Tap or left-click to mark ${app.tapActionLabel}. Long-press or right-click to mark ${app.holdActionLabel}.`;
		},
		applyCellInput(app, x, y, flag) {
			this.applyInput(app, x, y, flag);
		},
		async share(app) {
			if (this.shareDisabled() || !this.showBoard()) return;
			let url = createRouteUrl(window.location.href, `/puzzle/${this.field.encode()}`);
			let shareData = {
				title: 'Minesight Puzzle',
				text: 'Can you solve this Minesight puzzle?',
				url: url.href,
			};
			await app.shareLink(shareData, 'Puzzle shared', 'Share link copied');
		},
		shareButtonLabel: () => 'Share this puzzle',
		shareDisabled() {
			return this.preparing || !this.ready;
		},
		showPuzzleStatus: true,
		statusTitle() {
			return this.result === 'playing' ? 'What can you prove?' : this.resultTitle();
		},
		statusMessage() {
			return this.result === 'playing'
				? 'Mark every covered square that must be safe or mined.'
				: this.resultMessage();
		},
		resultTitle() {
			return this.result === 'cleared' ? 'Puzzle solved' : 'Incorrect move';
		},
		resultMessage() {
			return this.result === 'cleared' ? 'Good solve. Keep the streak going.' : "The clues don't support that mark.";
		},
		hintDisabled() {
			return this.preparing || this.result !== 'playing' || !this.ready;
		},
		toggleHint(app) {
			if (this.result !== 'playing' || !this.ready) return;
			this.hintUsed = !this.hintUsed;
			app.revision += 1;
			this.snapshotState(app);
			this.saveData();
		},
		beforeMove() {},
		handleIncorrect() {
			feedbackEffects.streakLost(this.streak);
			this.setStreak(0);
			return false;
		},
		handleCleared() {
			this.result = 'cleared';
			this.setStreak(this.streak + 1);
			return false;
		},
		saveMove(app) {
			this.snapshotState(app);
			this.saveData();
		},
		get streakLabel() {
			return `${this.currentDifficulty().label} study streak: ${this.streak}`;
		},
		get actionsClass() {
			return this.searchingVisible ? 'is-searching' : '';
		},
		get boardActionClass() {
			return this.result === 'playing' && this.ready ? 'skip' : 'primary';
		},
		get boardActionLabel() {
			if (this.searchingVisible) return 'Searching…';
			if (this.preparing) return 'Building…';
			if (!this.ready) return 'Try again';
			return this.result === 'playing' ? 'Skip' : 'Next';
		},
		activateBoardAction(app) {
			if (this.preparing) return;
			if (this.result === 'playing' && this.ready) this.skipBoard(app);
			else void this.newBoard(app);
		},
		/** @param {any} app @param {string} key */
		selectDifficulty(app, key) {
			if (this.difficultyKey === key) return;
			if (!STUDY_DIFFICULTIES.some((difficulty) => difficulty.key === key)) return;
			this.snapshotState(app);
			this.cancelPreparation(app);
			this.difficultyKey = key;
			this.streak = this.streaks[key];
			window.history.pushState(null, '', createRouteUrl(window.location.href, `/study/${key}`));
			app.activeRouteUrl = window.location.href;
			let restored = this.restoreState(app);
			this.saveData();
			if (!restored) void this.newBoard(app);
		},
		snapshotState(app) {
			this.states[this.difficultyKey] = {
				field: this.field,
				seed: app.boardSeed,
				result: this.result,
				hintUsed: this.hintUsed,
				streak: this.streak,
				ready: this.ready,
			};
		},
		restoreState(app) {
			let state = this.states[this.difficultyKey];
			if (!state) {
				this.streak = this.streaks[this.difficultyKey];
				this.ready = false;
				return false;
			}
			this.streak = state.streak;
			if (!state.ready) {
				this.ready = false;
				return false;
			}
			app.clearIncorrectFeedback();
			this.field = state.field;
			app.boardSeed = state.seed;
			this.result = state.result;
			this.hintUsed = state.hintUsed;
			this.ready = true;
			app.engineError = '';
			app.boardNumber += 1;
			app.revision += 1;
			return true;
		},
		/** @param {number} streak */
		setStreak(streak) {
			this.streak = streak;
			this.streaks[this.difficultyKey] = streak;
		},
		saveData() {
			let difficulties = Object.fromEntries(STUDY_DIFFICULTIES.map(({ key }) => {
				let state = this.states[key];
				/** @type {{ streak: number, board?: { difficultyKey: string, cells: number[], seed: string, result: GameResult, hintUsed: boolean } }} */
				let saved = { streak: this.streaks[key] };
				if (state?.ready) saved.board = {
					difficultyKey: key,
					cells: Array.from(state.field.state),
					seed: String(state.seed),
					result: state.result,
					hintUsed: state.hintUsed,
				};
				return [key, saved];
			}));
			saveMinesightData('study', { difficultyKey: this.difficultyKey, difficulties });
		},
		async newBoard(app) {
			this.result = 'playing';
			this.hintUsed = false;
			this.ready = false;
			this.snapshotState(app);
			this.saveData();
			await this.replaceField(app);
		},
		skipBoard(app) {
			if (app.page !== this || this.result !== 'playing') return;
			void this.newBoard(app);
		},
		async replaceField(app) {
			app.clearIncorrectFeedback();
			let preparationId = this.preparationId + 1;
			this.preparationId = preparationId;
			this.preparing = true;
			app.boardPreparing = true;
			this.clearSearchingDelay();
			this.searchingTimerId = window.setTimeout(() => {
				if (app.page === this && app.boardPreparing && preparationId === this.preparationId) {
					this.searchingVisible = true;
				}
			}, 200);
			app.engineError = '';
			try {
				let difficulty = this.currentDifficulty();
				let difficultyKey = this.difficultyKey;
				let puzzle = await generateField(difficulty, () => (
					app.page === this && difficultyKey === this.difficultyKey && preparationId === this.preparationId
				));
				if (!puzzle || app.page !== this || difficultyKey !== this.difficultyKey || preparationId !== this.preparationId) return;
				this.field = puzzle.field;
				app.boardSeed = puzzle.seed;
				this.ready = true;
				app.engineError = '';
				app.boardNumber += 1;
				app.revision += 1;
				this.snapshotState(app);
				this.saveData();
			}
			catch (error) {
				if (preparationId !== this.preparationId) return;
				app.engineError = error instanceof Error ? error.message : String(error);
			}
			finally {
				if (preparationId === this.preparationId) {
					this.preparing = false;
					app.boardPreparing = false;
					this.clearSearchingDelay();
				}
			}
		},
		cancelPreparation(app) {
			this.preparationId += 1;
			this.preparing = false;
			if (app) app.boardPreparing = false;
			this.clearSearchingDelay();
		},
		clearSearchingDelay() {
			if (this.searchingTimerId !== undefined) window.clearTimeout(this.searchingTimerId);
			this.searchingTimerId = undefined;
			this.searchingVisible = false;
		},
		/** @param {any} app @param {number} x @param {number} y @param {boolean} flag */
		applyInput(app, x, y, flag) {
			if (this.result !== 'playing') return;
			let validate = this.markValidation === 'immediate';
			if (this.field.isRevealed(x, y)) {
				let chord = this.field.actionChordMarks(x, y, { validate });
				if (chord.marks.length === 0 && chord.rejectedIndex < 0) return;
				let [first, ...additionalMarks] = chord.marks;
				app.afterMove({
					removing: false,
					cellIndex: first?.index ?? chord.rejectedIndex,
					markMine: first?.mine ?? false,
					additionalMarks,
					rejectedIndex: chord.rejectedIndex,
				});
				return;
			}
			if (!this.field.isActive(x, y)) return;
			let cellIndex = this.field.getIndex(x, y);
			let action = flag
				? this.field.actionMarkMine(x, y, { validate })
				: this.field.actionMarkSafe(x, y, { validate });
			if (action.change === 'ignored') return;
			app.afterMove({
				removing: action.change === 'removed',
				cellIndex,
				markMine: flag,
				rejectedIndex: action.change === 'rejected' ? cellIndex : -1,
			});
		},
	};
}

function createDailyPage() {
	let today = localDateKey();
	let savedDaily = loadMinesightData()?.daily;
	let stored = savedDaily?.lastSeenDate === today ? savedDaily : { lastSeenDate: today };
	let difficultyKey = DAILY_DIFFICULTIES.some(({ key }) => key === stored.difficultyKey)
		? stored.difficultyKey
		: DAILY_DIFFICULTIES[0].key;
	/** @type {Record<string, DailyState | undefined>} */
	let states = Object.fromEntries(DAILY_DIFFICULTIES.map(({ key }) => {
		let saved = stored.difficulties?.[key];
		if (!Array.isArray(saved?.cells) || saved.difficultyKey !== key) return [key, undefined];
		try {
			return [key, {
				field: new MineField(BOARD_SIZE, BOARD_SIZE, Uint8Array.from(saved.cells)),
				seed: BigInt(saved.seed),
				result: saved.result === 'cleared' ? 'cleared' : 'playing',
				completed: Boolean(saved.completed || saved.result === 'cleared'),
				ready: true,
			}];
		}
		catch {
			return [key, undefined];
		}
	}));
	if (savedDaily?.lastSeenDate !== today) saveMinesightData('daily', stored);
	return {
		kind: 'daily',
		title: 'Daily',
		field: new MineField(BOARD_SIZE, BOARD_SIZE),
		result: 'playing',
		hints: false,
		traditionalRules: false,
		tutorialRules: false,
		requiresReadyBoard: false,
		showSolution: () => false,
		date: today,
		difficulties: DAILY_DIFFICULTIES,
		difficultyKey,
		states,
		checkMessage: '',
		ready: false,
		preparing: false,
		preparationId: 0,
		close(app) {
			this.cancelPreparation(app);
			this.snapshotState(app);
			this.saveData();
			this.ready = false;
		},
		markValidation: 'deferred',
		currentDifficulty() {
			return DAILY_DIFFICULTIES.find(({ key }) => key === this.difficultyKey) ?? DAILY_DIFFICULTIES[0];
		},
		showBoard() {
			return this.ready || this.preparing;
		},
		open(app, route) {
			this.refreshDate(app);
			this.openDifficulty(app, route.difficultyKey ?? this.difficultyKey, false);
			if (route.difficultyKey === undefined) {
				window.history.replaceState(null, '', createRouteUrl(window.location.href, `/daily/${this.difficultyKey}`));
				app.activeRouteUrl = window.location.href;
			}
		},
		inputHelp(app) {
			if (app.scratchActive) return 'Draw freely over the board. Select Done to mark squares again.';
			return `Tap or left-click to mark ${app.tapActionLabel}. Long-press or right-click to mark ${app.holdActionLabel}.`;
		},
		applyCellInput(app, x, y, flag) {
			this.applyInput(app, x, y, flag);
		},
		async share(app) {
			if (this.shareDisabled() || !this.showBoard()) return;
			let difficulty = this.currentDifficulty().label;
			let url = createRouteUrl(window.location.href, `/daily/${this.difficultyKey}`);
			let shareData = {
				title: 'Minesight Daily',
				text: `Play today's Minesight ${difficulty} daily puzzle!`,
				url: url.href,
			};
			await app.shareLink(shareData, 'Daily puzzle shared', 'Daily puzzle link copied');
		},
		shareButtonLabel() {
			return `Share today's ${this.currentDifficulty().label} daily puzzle`;
		},
		shareDisabled() {
			return this.preparing || !this.ready;
		},
		showPuzzleStatus: true,
		hintDisabled: () => true,
		toggleHint() {},
		statusTitle() {
			if (this.result === 'playing' && this.checkMessage) return 'Solution checked';
			return this.result === 'playing' ? 'What can you prove?' : this.resultTitle();
		},
		statusMessage() {
			if (this.result === 'playing') {
				return this.checkMessage || 'Mark the squares, then check your solution when you are ready.';
			}
			return this.resultMessage();
		},
		resultTitle() {
			return this.result === 'cleared' ? 'Daily solved' : 'Incorrect move';
		},
		resultMessage() {
			if (this.result !== 'cleared') return "The clues don't support that mark.";
			return this.allSolved
				? 'Today\'s set is complete. Come back tomorrow.'
				: `${this.solvedCount} of ${this.total} complete today.`;
		},
		beforeMove() {
			this.checkMessage = '';
		},
		handleIncorrect: () => false,
		handleCleared() {
			this.result = 'cleared';
			return false;
		},
		saveMove(app) {
			this.snapshotState(app);
			this.saveData();
		},
		get solvedCount() {
			return DAILY_DIFFICULTIES.filter(({ key }) => this.states[key]?.completed).length;
		},
		get total() {
			return DAILY_DIFFICULTIES.length;
		},
		get allSolved() {
			return this.solvedCount === this.total;
		},
		refreshDate(app) {
			let today = localDateKey();
			if (today === this.date) return false;
			this.date = today;
			this.states = Object.fromEntries(DAILY_DIFFICULTIES.map(({ key }) => [key, undefined]));
			this.difficultyKey = DAILY_DIFFICULTIES[0].key;
			this.ready = false;
			this.checkMessage = '';
			this.cancelPreparation(app);
			this.saveData();
			if (app.page === this) this.openDifficulty(app, this.difficultyKey, true);
			return true;
		},
		/** @param {any} app @param {string} key @param {boolean} [navigate] */
		openDifficulty(app, key, navigate = true) {
			if (!DAILY_DIFFICULTIES.some((difficulty) => difficulty.key === key)) return;
			if (this.ready) this.snapshotState(app);
			this.cancelPreparation(app);
			this.difficultyKey = key;
			this.checkMessage = '';
			if (navigate) {
				window.history.pushState(null, '', createRouteUrl(window.location.href, `/daily/${key}`));
				app.activeRouteUrl = window.location.href;
			}
			if (!this.restoreState(app)) void this.prepareBoard(app);
			this.saveData();
		},
		snapshotState(app) {
			if (!this.ready) return;
			let completed = Boolean(this.states[this.difficultyKey]?.completed || this.result === 'cleared');
			this.states[this.difficultyKey] = {
				field: this.field,
				seed: app.boardSeed,
				result: this.result,
				completed,
				ready: true,
			};
		},
		restoreState(app) {
			let state = this.states[this.difficultyKey];
			if (!state?.ready) {
				this.ready = false;
				return false;
			}
			app.clearIncorrectFeedback();
			this.field = state.field;
			app.boardSeed = state.seed;
			this.result = state.result;
			this.ready = true;
			app.engineError = '';
			app.boardNumber += 1;
			app.revision += 1;
			return true;
		},
		saveData() {
			let difficulties = Object.fromEntries(DAILY_DIFFICULTIES.flatMap(({ key }) => {
				let state = this.states[key];
				if (!state?.ready) return [];
				return [[key, {
					difficultyKey: key,
					cells: Array.from(state.field.state),
					seed: String(state.seed),
					result: state.result,
					completed: state.completed,
				}]];
			}));
			saveMinesightData('daily', { lastSeenDate: this.date, difficultyKey: this.difficultyKey, difficulties });
		},
		async prepareBoard(app) {
			let preparationId = this.preparationId + 1;
			this.preparationId = preparationId;
			this.ready = false;
			this.preparing = true;
			app.boardPreparing = true;
			this.result = 'playing';
			app.engineError = '';
			let difficultyKey = this.difficultyKey;
			let difficulty = this.currentDifficulty();
			try {
				let puzzle = await generateSeededField(
					difficulty,
					dailyPuzzleSeed(this.date),
					() => app.page === this && this.difficultyKey === difficultyKey && preparationId === this.preparationId,
				);
				if (!puzzle || app.page !== this || this.difficultyKey !== difficultyKey || preparationId !== this.preparationId) return;
				this.field = puzzle.field;
				app.boardSeed = puzzle.seed;
				this.ready = true;
				app.boardNumber += 1;
				app.revision += 1;
				this.snapshotState(app);
				this.saveData();
			}
			catch (error) {
				if (preparationId === this.preparationId) app.engineError = error instanceof Error ? error.message : String(error);
			}
			finally {
				if (preparationId === this.preparationId) {
					this.preparing = false;
					app.boardPreparing = false;
				}
			}
		},
		clearBoard(app) {
			if (app.page !== this || !this.ready || this.preparing) return;
			let changed = this.field.clearPuzzleMarks();
			app.clearIncorrectFeedback();
			this.checkMessage = '';
			this.result = 'playing';
			app.boardNumber += 1;
			app.revision += 1;
			this.snapshotState(app);
			this.saveData();
			if (changed) gameSounds.play('unmark');
		},
		checkSolution(app) {
			if (app.page !== this || !this.ready || this.result !== 'playing') return;
			let contradictionIndex = this.field.puzzleContradictionIndex();
			if (contradictionIndex >= 0) {
				this.checkMessage = 'There is a contradiction: the marked mines and safe squares cannot satisfy a clue.';
				gameSounds.play('incorrect');
				feedbackEffects.failure({ cellIndex: contradictionIndex, terminal: false });
				app.revision += 1;
				return;
			}
			if (!this.field.isPuzzleSolved()) {
				this.checkMessage = 'Not complete yet. Keep going.';
				app.revision += 1;
				return;
			}
			this.checkMessage = '';
			this.result = 'cleared';
			this.snapshotState(app);
			this.saveData();
			gameSounds.play('success');
			feedbackEffects.success({ grand: this.allSolved });
			if (this.allSolved) feedbackEffects.fireworks();
			app.revision += 1;
		},
		cancelPreparation(app) {
			this.preparationId += 1;
			this.preparing = false;
			if (app) app.boardPreparing = false;
		},
		/** @param {any} app @param {number} x @param {number} y @param {boolean} flag */
		applyInput(app, x, y, flag) {
			if (this.result !== 'playing') return;
			let validate = this.markValidation === 'immediate';
			if (this.field.isRevealed(x, y)) {
				let chord = this.field.actionChordMarks(x, y, { validate });
				if (chord.marks.length === 0 && chord.rejectedIndex < 0) return;
				let [first, ...additionalMarks] = chord.marks;
				app.afterMove({
					removing: false,
					cellIndex: first?.index ?? chord.rejectedIndex,
					markMine: first?.mine ?? false,
					additionalMarks,
					rejectedIndex: chord.rejectedIndex,
				});
				return;
			}
			if (!this.field.isActive(x, y)) return;
			let cellIndex = this.field.getIndex(x, y);
			let action = flag
				? this.field.actionMarkMine(x, y, { validate })
				: this.field.actionMarkSafe(x, y, { validate });
			if (action.change === 'ignored') return;
			app.afterMove({
				removing: action.change === 'removed',
				cellIndex,
				markMine: flag,
				rejectedIndex: action.change === 'rejected' ? cellIndex : -1,
			});
		},
	};
}

function createChallengePage() {
	let storedModeKey = loadMinesightData().challengeModeKey ?? 'expert';
	let modeKey = CHALLENGE_MODES.some(({ key }) => key === storedModeKey) ? storedModeKey : CHALLENGE_MODES[0].key;
	return {
		kind: 'challenge',
		title: 'Challenge',
		field: new MineField(BOARD_SIZE, BOARD_SIZE),
		result: 'playing',
		markValidation: 'immediate',
		hints: false,
		traditionalRules: false,
		tutorialRules: false,
		requiresReadyBoard: false,
		modes: CHALLENGE_MODES,
		modeKey,
		seed: randomChallengeSeed(),
		received: false,
		/** @type {number | undefined} */
		targetMs: undefined,
		index: 0,
		started: false,
		preparing: false,
		preparationId: 0,
		/** @type {Array<{ field: MineField, seed: bigint, attempts: number }>} */
		puzzles: [],
		/** @type {ChallengeResult[]} */
		results: [],
		elapsedMs: 0,
		/** @type {number | undefined} */
		timerId: undefined,
		/** @type {number | undefined} */
		timerLastTick: undefined,
		/** @type {number | undefined} */
		giveUpTimerId: undefined,
		giveUpHolding: false,
		giveUpHoldDuration: GIVE_UP_HOLD_MS,
		showSolution() {
			return this.result === 'gave-up';
		},
		open(app, route) {
			this.modeKey = route.modeKey;
			this.received = route.received;
			this.targetMs = route.time;
			this.seed = route.seed ?? randomChallengeSeed();
			void this.prepare(app);
		},
		close() {
			this.cancelPreparation();
			this.cancelGiveUpGesture();
			this.stopTimer();
		},
		currentDifficulty() {
			return this.groups.find(({ start, puzzleCount }) => (
				this.index >= start && this.index < start + puzzleCount
			))?.difficulty ?? this.groups[0].difficulty;
		},
		showBoard() {
			return this.started && this.result !== 'complete';
		},
		inputHelp(app) {
			if (app.scratchActive) return 'Draw freely over the board. Select Done to mark squares again.';
			return `Tap or left-click to mark ${app.tapActionLabel}. Long-press or right-click to mark ${app.holdActionLabel}.`;
		},
		async share(app) {
			let completedTime = Math.floor(this.elapsedMs / 10) * 10;
			let targetTime = this.result === 'complete' ? completedTime : this.targetMs;
			let url = createChallengeShareUrl(window.location.href, this.modeKey, this.seed, targetTime);
			let text = this.result === 'complete'
				? `I completed Minesight ${this.mode.label} in ${this.formattedTime}. Can you beat my time?`
				: `You have been challenged to Minesight ${this.mode.label}!`;
			await app.shareLink({ title: 'Minesight Challenge', text, url: url.href }, 'Challenge shared', 'Challenge link copied');
		},
		shareButtonLabel() {
			return 'Share this challenge';
		},
		shareDisabled: () => false,
		showPuzzleStatus: false,
		statusTitle() {
			return this.result === 'playing' ? 'What can you prove?' : this.resultTitle();
		},
		statusMessage() {
			return this.result === 'playing'
				? 'Mark every covered square that must be safe or mined.'
				: this.resultMessage();
		},
		applyCellInput(app, x, y, flag) {
			if (this.started) this.applyInput(app, x, y, flag);
		},
		resultTitle() {
			if (this.result === 'cleared') {
				return this.results[this.index] === 'failed' ? 'Puzzle completed' : 'Puzzle solved';
			}
			if (this.result === 'complete') return 'Challenge complete';
			return this.result === 'gave-up' ? 'Run ended' : 'Incorrect move';
		},
		resultMessage() {
			if (this.result === 'cleared') {
				return this.results[this.index] === 'failed'
					? 'You finished it, but this puzzle counts as failed. Ready for the next one?'
					: 'Good solve. Ready for the next one?';
			}
			if (this.result === 'complete') return `${this.clearedCount} completed cleanly and ${this.failedCount} failed in ${this.formattedTime}.`;
			if (this.result === 'gave-up') return `You gave up on puzzle ${this.index + 1} of ${this.total}.`;
			return "The clues don't support that mark.";
		},
		hintDisabled: () => true,
		toggleHint() {},
		beforeMove() {},
		handleIncorrect(app, cellIndex) {
			this.markFailed(app, cellIndex);
			return true;
		},
		handleCleared() {
			this.stopTimer();
			if (this.results[this.index] !== 'failed') {
				this.results[this.index] = 'cleared';
			}
			let complete = this.index === this.total - 1;
			this.result = complete ? 'complete' : 'cleared';
			if (complete) {
				this.playFanfare();
				if (this.timeBeaten) feedbackEffects.fireworks();
			}
			return complete;
		},
		saveMove() {},
		get showIntro() {
			return !this.started;
		},
		get startLabel() {
			if (this.preparing) return `Building puzzles ${this.puzzles.length} / ${this.total}…`;
			return this.ready ? 'Start challenge' : 'Try again';
		},
		get invitationDifficulties() {
			return this.mode.route.map(({ difficulty, puzzleCount }) => ({
				key: difficulty.key,
				label: difficulty.label,
				puzzleCount,
			}));
		},
		get showFinish() {
			return this.result === 'complete';
		},
		get completeMessage() {
			if (this.failedCount === 0) return `You cleared all ${this.total} challenges.`;
			return `${this.clearedCount} completed · ${this.failedCount} failed`;
		},
		get finishTitle() {
			return this.failedCount === 0 ? 'Perfect run' : 'Run complete';
		},
		get targetTime() {
			return this.targetMs === undefined ? '' : formatElapsedTime(this.targetMs);
		},
		get timeDifference() {
			if (this.targetMs === undefined) return undefined;
			return Math.floor(this.elapsedMs / 10) * 10 - this.targetMs;
		},
		get timeBeaten() {
			return this.timeDifference !== undefined && this.timeDifference < 0;
		},
		get timeResultMessage() {
			let difference = this.timeDifference;
			if (difference === undefined) return '';
			if (difference === 0) return 'A perfect tie!';
			let ratio = Math.abs(difference) / this.targetMs;
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
		get showPath() {
			return this.started && this.result !== 'complete';
		},
		get resultActionDisabled() {
			return this.result === 'playing';
		},
		get resultActionLabel() {
			return this.result === 'gave-up' ? 'Restart run' : 'Next challenge';
		},
		get showControls() {
			return this.showPath;
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
		get total() {
			return this.modeTotal(this.mode);
		},
		get mode() {
			return CHALLENGE_MODES.find(({ key }) => key === this.modeKey) ?? CHALLENGE_MODES[0];
		},
		/** @param {{ route: Array<{ puzzleCount: number }> }} mode */
		modeTotal(mode) {
			return mode.route.reduce((total, { puzzleCount }) => total + puzzleCount, 0);
		},
		/** @param {{ route: Array<{ difficulty: { label: string }, puzzleCount: number }> }} mode */
		modeRouteLabel(mode) {
			return mode.route.map(({ difficulty, puzzleCount }) => `${puzzleCount} ${difficulty.label}`).join(' · ');
		},
		get ready() {
			return !this.preparing && this.puzzles.length === this.total;
		},
		get runActive() {
			return this.started && !['gave-up', 'complete'].includes(this.result);
		},
		get clearedCount() {
			return this.results.filter((result) => result === 'cleared').length;
		},
		get failedCount() {
			return this.results.filter((result) => result === 'failed').length;
		},
		get formattedTime() {
			return formatElapsedTime(this.elapsedMs);
		},
		get timerTime() {
			return this.formattedTime.replace(/\.\d{2}$/, '');
		},
		get groups() {
			let start = 0;
			return this.mode.route.map(({ difficulty, puzzleCount }) => {
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
		protectNavigation(event) {
			if (!this.runActive) return;
			event.preventDefault();
			event.returnValue = '';
		},
		/** @param {number} failedCount */
		showTestEnd(failedCount) {
			if (!isLocalDevelopment()) return false;
			let failures = Math.min(this.total, Math.max(0, Math.trunc(Number(failedCount) || 0)));
			this.cancelGiveUpGesture();
			this.stopTimer();
			this.cancelPreparation();
			this.started = true;
			this.index = this.total - 1;
			this.results = Array.from(
				{ length: this.total },
				(_, index) => index < this.total - failures ? 'cleared' : 'failed',
			);
			this.result = 'complete';
			this.playFanfare();
			if (this.timeBeaten) feedbackEffects.fireworks();
			return true;
		},
		playFanfare() {
			gameSounds.play(this.failedCount === 0 ? 'perfectComplete' : 'failedComplete');
		},
		activateStart(app) {
			if (this.ready) this.start(app);
			else if (!this.preparing) void this.prepare(app);
		},
		/** @param {any} app @param {string} modeKey */
		selectMode(app, modeKey) {
			if (this.started || modeKey === this.modeKey) return;
			if (!CHALLENGE_MODES.some(({ key }) => key === modeKey)) return;
			this.targetMs = undefined;
			this.modeKey = modeKey;
			this.seed = randomChallengeSeed();
			saveMinesightData('challengeModeKey', modeKey);
			window.history.pushState(null, '', createRouteUrl(window.location.href, `/challenge/${modeKey}`));
			app.activeRouteUrl = window.location.href;
			void this.prepare(app);
		},
		activateResultAction(app) {
			if (this.result === 'cleared') this.advance(app);
			else if (this.result === 'gave-up') void this.restart(app);
		},
		async prepare(app) {
			this.stopTimer();
			app.clearIncorrectFeedback();
			let preparationId = this.preparationId + 1;
			this.preparationId = preparationId;
			this.started = false;
			this.preparing = true;
			this.puzzles = [];
			this.results = [];
			this.index = 0;
			this.elapsedMs = 0;
			this.result = 'playing';
			app.engineError = '';

			try {
				// Paint the initial 0 / total state, then give each completed puzzle its
				// own frame so progress remains visible and mode changes stay responsive.
				await yieldToBrowser();
				let nextSeed = this.seed;
				for (let { difficulty, puzzleCount } of this.mode.route) {
					for (let index = 0; index < puzzleCount; index += 1) {
						if (app.page !== this || preparationId !== this.preparationId) return;
						let puzzle = await generateSeededField(difficulty, nextSeed, () => (
							app.page === this && preparationId === this.preparationId
						));
						if (!puzzle) return;
						this.puzzles.push(puzzle);
						nextSeed = puzzle.seed === MAX_CHALLENGE_SEED ? 0n : puzzle.seed + 1n;
						await yieldToBrowser();
					}
				}
				sortChallengeTiers(this.puzzles, this.mode.route);
			}
			catch (error) {
				if (preparationId !== this.preparationId) return;
				this.puzzles = [];
				app.engineError = error instanceof Error ? error.message : String(error);
			}
			finally {
				if (preparationId === this.preparationId) this.preparing = false;
			}
		},
		cancelPreparation() {
			this.preparationId += 1;
			this.preparing = false;
		},
		start(app) {
			if (!this.ready) return;
			this.received = false;
			window.history.replaceState(null, '', createRouteUrl(window.location.href, `/challenge/${this.modeKey}`));
			app.activeRouteUrl = window.location.href;
			this.stopTimer();
			this.started = true;
			this.index = 0;
			this.results = [];
			this.elapsedMs = 0;
			this.result = 'playing';
			if (!this.loadField(app)) return;
			gameSounds.play('start');
			this.startTimer();
		},
		async restart(app) {
			this.targetMs = undefined;
			this.seed = randomChallengeSeed();
			await this.prepare(app);
		},
		beginGiveUpGesture(app) {
			if (!this.runActive || this.giveUpTimerId !== undefined) return;
			this.giveUpHolding = true;
			this.giveUpTimerId = window.setTimeout(() => {
				this.giveUpTimerId = undefined;
				this.giveUpHolding = false;
				this.giveUp(app);
			}, GIVE_UP_HOLD_MS);
		},
		cancelGiveUpGesture() {
			if (this.giveUpTimerId !== undefined) window.clearTimeout(this.giveUpTimerId);
			this.giveUpTimerId = undefined;
			this.giveUpHolding = false;
		},
		giveUp(app) {
			if (!this.runActive) return;
			this.cancelGiveUpGesture();
			this.stopTimer();
			this.result = 'gave-up';
			gameSounds.play('failure');
			feedbackEffects.failure({ terminal: true });
			app.revision += 1;
		},
		/** @param {any} app @param {number} cellIndex */
		markFailed(app, cellIndex) {
			if (!this.runActive || this.result !== 'playing') return;
			this.results[this.index] = 'failed';
			let incorrectIndex = this.field.consumeIncorrect();
			app.showIncorrectFeedback(incorrectIndex >= 0 ? incorrectIndex : cellIndex);
			gameSounds.play('incorrect');
			feedbackEffects.failure({ cellIndex, terminal: false });
			app.revision += 1;
		},
		advance(app) {
			if (this.result !== 'cleared') return;
			this.index += 1;
			this.result = 'playing';
			if (this.loadField(app)) this.startTimer();
		},
		loadField(app) {
			app.clearIncorrectFeedback();
			let puzzle = this.puzzles[this.index];
			if (!puzzle) {
				this.started = false;
				app.engineError = `challenge ${this.index + 1} was not prepared`;
				return false;
			}
			this.field = puzzle.field;
			app.boardSeed = puzzle.seed;
			app.engineError = '';
			app.boardNumber += 1;
			app.revision += 1;
			return true;
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
			this.timerId = window.setInterval(() => this.updateTimer(), 10);
		},
		updateTimer() {
			if (this.timerLastTick === undefined) return;
			let now = window.performance.now();
			this.elapsedMs += Math.max(0, now - this.timerLastTick);
			this.timerLastTick = now;
		},
		/** @param {number} step */
		stepClass(step) {
			let outcome = this.results[step];
			if (outcome === 'cleared') return 'complete';
			if (outcome === 'failed') return 'failed';
			if (step === this.index && this.result !== 'complete') return 'current';
			return '';
		},
		/** @param {number} step */
		stepLabel(step) {
			let group = this.groups.find(({ start, puzzleCount }) => step >= start && step < start + puzzleCount)
				?? this.groups[0];
			let state = this.stepClass(step) || 'upcoming';
			return `${group.label} challenge ${step - group.start + 1}, ${state}`;
		},
		/** @param {any} app @param {number} x @param {number} y @param {boolean} flag */
		applyInput(app, x, y, flag) {
			if (this.result !== 'playing') return;
			let validate = this.markValidation === 'immediate';
			if (this.field.isRevealed(x, y)) {
				let chord = this.field.actionChordMarks(x, y, { validate });
				if (chord.marks.length === 0 && chord.rejectedIndex < 0) return;
				let [first, ...additionalMarks] = chord.marks;
				app.afterMove({
					removing: false,
					cellIndex: first?.index ?? chord.rejectedIndex,
					markMine: first?.mine ?? false,
					additionalMarks,
					rejectedIndex: chord.rejectedIndex,
				});
				return;
			}
			if (!this.field.isActive(x, y)) return;
			let cellIndex = this.field.getIndex(x, y);
			let action = flag
				? this.field.actionMarkMine(x, y, { validate })
				: this.field.actionMarkSafe(x, y, { validate });
			if (action.change === 'ignored') return;
			app.afterMove({
				removing: action.change === 'removed',
				cellIndex,
				markMine: flag,
				rejectedIndex: action.change === 'rejected' ? cellIndex : -1,
			});
		},
	};
}

function createPuzzlePage() {
	/** @type {any} */
	let appContext;
	let page = {
		kind: 'puzzle',
		title: 'Puzzle',
		result: 'playing',
		markValidation: 'immediate',
		hints: true,
		hintUsed: false,
		error: '',
		traditionalRules: false,
		tutorialRules: false,
		requiresReadyBoard: false,
		showSolution: () => false,
		currentDifficulty: () => STUDY_DIFFICULTIES[0],
		open(app, route) {
			appContext = app;
			this.result = 'playing';
			this.hintUsed = false;
			this.error = '';
			try {
				this.minefield.field = MineField.decode(route.payload);
				this.minefield.result = this.result;
				this.minefield.hintsVisible = false;
				this.minefield.solutionVisible = false;
				this.minefield.ready = true;
				this.minefield.busy = false;
				this.minefield.actionsInverted = app.actionsInverted;
				this.minefield.incorrectCellIndex = -1;
				this.minefield.boardNumber += 1;
				this.minefield.revision += 1;
				app.engineError = '';
				app.boardNumber += 1;
				app.revision += 1;
				this.minefield.reset();
			}
			catch {
				this.error = 'This puzzle link is invalid.';
			}
		},
		close() {},
		showBoard() {
			return !this.error;
		},
		get inputHelp() {
			if (this.minefield.scratchActive) return 'Draw freely over the board. Select Done to mark squares again.';
			return `Tap or left-click to mark ${this.minefield.tapActionLabel}. Long-press or right-click to mark ${this.minefield.holdActionLabel}.`;
		},
		applyCellInput(app, x, y, flag) {
			this.applyInput(app, x, y, flag);
		},
		async share(app) {
			if (this.shareDisabled() || !this.showBoard()) return;
			let url = createRouteUrl(window.location.href, `/puzzle/${this.minefield.field.encode()}`);
			let shareData = {
				title: 'Minesight Puzzle',
				text: 'Can you solve this Minesight puzzle?',
				url: url.href,
			};
			await app.shareLink(shareData, 'Puzzle shared', 'Share link copied');
		},
		shareButtonLabel: () => 'Share this puzzle',
		shareDisabled: () => false,
		showPuzzleStatus: true,
		statusTitle() {
			return this.result === 'playing' ? 'What can you prove?' : this.resultTitle();
		},
		statusMessage() {
			return this.result === 'playing'
				? 'Mark every covered square that must be safe or mined.'
				: this.resultMessage();
		},
		resultTitle() {
			return this.result === 'cleared' ? 'Puzzle solved' : 'Incorrect move';
		},
		hintDisabled() {
			return this.result !== 'playing';
		},
		toggleHint(app) {
			if (this.result !== 'playing') return;
			this.hintUsed = !this.hintUsed;
			this.minefield.hintsVisible = this.hints && this.hintUsed;
			this.minefield.revision += 1;
			app.revision += 1;
		},
		resultMessage() {
			if (this.result === 'cleared') return 'Nice solve. Open the link again for a fresh board.';
			return "The clues don't support that mark.";
		},
		beforeMove() {},
		handleIncorrect: () => false,
		handleCleared() {
			this.result = 'cleared';
			this.minefield.result = this.result;
			return false;
		},
		saveMove() {},
		/** @param {any} app @param {number} x @param {number} y @param {boolean} flag */
		applyInput(app, x, y, flag) {
			if (this.result !== 'playing') return;
			let field = this.minefield.field;
			let validate = this.markValidation === 'immediate';
			if (field.isRevealed(x, y)) {
				let chord = field.actionChordMarks(x, y, { validate });
				if (chord.marks.length === 0 && chord.rejectedIndex < 0) return;
				let [first, ...additionalMarks] = chord.marks;
				app.afterMove({
					removing: false,
					cellIndex: first?.index ?? chord.rejectedIndex,
					markMine: first?.mine ?? false,
					additionalMarks,
					rejectedIndex: chord.rejectedIndex,
				});
				return;
			}
			if (!field.isActive(x, y)) return;
			let cellIndex = field.getIndex(x, y);
			let action = flag
				? field.actionMarkMine(x, y, { validate })
				: field.actionMarkSafe(x, y, { validate });
			if (action.change === 'ignored') return;
			app.afterMove({
				removing: action.change === 'removed',
				cellIndex,
				markMine: flag,
				rejectedIndex: action.change === 'rejected' ? cellIndex : -1,
			});
		},
	};
	page.minefield = createMineField(new MineField(BOARD_SIZE, BOARD_SIZE));
	page.minefield.traditionalRules = page.traditionalRules;
	page.minefield.tutorialRules = page.tutorialRules;
	page.minefield.ready = !page.requiresReadyBoard;
	return page;
}

function createEditorPage() {
	return {
		kind: 'editor',
		title: 'Board lab',
		field: new MineField(BOARD_SIZE, BOARD_SIZE),
		result: 'playing',
		markValidation: 'immediate',
		hints: false,
		traditionalRules: false,
		tutorialRules: false,
		requiresReadyBoard: false,
		showSolution: () => false,
		currentDifficulty: () => STUDY_DIFFICULTIES[0],
		showBoard: () => false,
		open() {},
		close() {},
		inputHelp: () => '',
		applyCellInput() {},
		share() {},
		shareButtonLabel: () => '',
		shareDisabled: () => true,
		showPuzzleStatus: false,
		statusTitle: () => '',
		statusMessage: () => '',
		resultTitle: () => '',
		resultMessage: () => '',
		hintDisabled: () => true,
		toggleHint() {},
		beforeMove() {},
		handleIncorrect: () => false,
		handleCleared: () => false,
		saveMove() {},
		tool: '1',
		board: Array(BOARD_SIZE * BOARD_SIZE).fill('covered'),
		revision: 0,
		focusIndex: 0,
		hoverIndex: -1,
		painting: false,
		pointerId: undefined,
		history: [],
		analysis: undefined,
		showEditorSolution: false,
		get tools() {
			return [
				{ value: 'covered', text: '□', label: 'Covered' },
				{ value: 'masked', text: '×', label: 'Masked' },
				{ value: 'flag', text: '⚑', label: 'Flag' },
				...Array.from({ length: 9 }, (_, clue) => ({ value: String(clue), text: String(clue), label: `Clue ${clue}` })),
			];
		},
		get editorCells() {
			this.revision;
			let forcedMine = new Set(this.analysis?.forcedMine ?? []);
			let forcedSafe = new Set(this.analysis?.forcedSafe ?? []);
			return this.board.map((state, index) => {
				let x = index % BOARD_SIZE;
				let y = Math.floor(index / BOARD_SIZE);
				let clue = /^\d$/.test(state);
				let classes = ['editor-cell'];
				let text = clue ? state : state === 'flag' ? '⚑' : '';
				let description = clue ? `clue ${state}` : state === 'flag' ? 'flagged mine' : 'covered';
				if (clue) classes.push('revealed', `clue-${state}`);
				if (state === 'masked') {
					classes.push('inactive', 'editor-masked');
					description = 'masked, outside the puzzle';
				}
				if (state === 'flag') classes.push('flagged');
				if (forcedMine.has(index)) {
					classes.push('marked-mine', 'editor-forced');
					text = '⚑';
					description += ', forced mine';
				}
				else if (forcedSafe.has(index)) {
					classes.push('marked-safe', 'editor-forced');
					text = '✓';
					description += ', forced safe';
				}
				else if (this.showEditorSolution && state === 'covered' && this.analysis && !this.analysis.contradiction) {
					let mine = this.analysis.solution[index] === 1;
					classes.push(mine ? 'editor-solution-mine' : 'editor-solution-safe');
					text = mine ? '✹' : '·';
					description += mine ? ', mine in shown solution' : ', safe in shown solution';
				}
				return {
					index, x, y, text,
					className: classes.join(' '),
					label: `Row ${y + 1}, column ${x + 1}, ${description}`,
					tabIndex: index === this.focusIndex ? 0 : -1,
				};
			});
		},
		get editorStatusTitle() {
			if (!this.analysis) return 'Ready to analyze';
			if (this.analysis.contradiction) return 'Contradiction';
			if (this.analysis.coveredCount === 0) return 'Nothing to solve';
			if (this.analysis.unique) return 'Unique solution';
			let count = this.analysis.forcedMine.length + this.analysis.forcedSafe.length;
			return count > 0 ? `${count} forced ${count === 1 ? 'cell' : 'cells'}` : 'No forced cells';
		},
		get editorStatusMessage() {
			if (!this.analysis) return 'Add clues or flags, then check the board.';
			if (this.analysis.contradiction) return 'No mine layout can satisfy every clue and flag.';
			if (this.analysis.coveredCount === 0) return 'Add at least one covered cell to create a puzzle.';
			let mines = this.analysis.forcedMine.length;
			let safe = this.analysis.forcedSafe.length;
			if (this.analysis.unique) return `Every covered cell is determined: ${mines} mined and ${safe} safe.`;
			if (mines + safe > 0) return `${mines} must be mined and ${safe} must be safe. Other covered cells remain ambiguous.`;
			return 'The clues are consistent, but no covered cell is forced. Add more information before sharing.';
		},
		get canShare() {
			return this.analysis !== undefined
				&& !this.analysis.contradiction
				&& this.analysis.forcedMine.length + this.analysis.forcedSafe.length > 0;
		},
		get primaryActionLabel() {
			return this.canShare ? 'Share puzzle' : 'Analyze board';
		},
		/** @param {string} tool */
		selectTool(tool) {
			if (this.tools.some(({ value }) => value === tool)) this.tool = tool;
		},
		/** @param {number} index @param {string} [state] */
		setCell(index, state = this.tool) {
			if (index < 0 || index >= this.board.length || this.board[index] === state) return;
			this.history.push(this.board.slice());
			if (this.history.length > 100) this.history.shift();
			this.board[index] = state;
			this.analysis = undefined;
			this.showEditorSolution = false;
			this.revision += 1;
		},
		/** @param {PointerEvent} event @param {number} index */
		beginPaint(event, index) {
			if (event.button !== 0) return;
			this.painting = true;
			this.pointerId = event.pointerId;
			this.setCell(index);
		},
		/** @param {PointerEvent} event */
		movePaint(event) {
			let element = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.editor-cell');
			let index = Number(element?.getAttribute('data-editor-index'));
			if (event.pointerType === 'mouse') this.hoverIndex = Number.isInteger(index) ? index : -1;
			if (!this.painting || event.pointerId !== this.pointerId) return;
			if (Number.isInteger(index)) this.setCell(index);
		},
		/** @param {PointerEvent} event */
		leaveBoard(event) {
			if (event.pointerType === 'mouse') this.hoverIndex = -1;
		},
		/** @param {PointerEvent} event */
		endPaint(event) {
			if (event.pointerId !== this.pointerId) return;
			this.painting = false;
			this.pointerId = undefined;
		},
		/** @param {unknown} app @param {KeyboardEvent} event @param {number} index */
		keydownCell(app, event, index) {
			let direction = CELL_FOCUS_DIRECTIONS[event.key];
			if (direction) {
				event.preventDefault();
				let x = index % BOARD_SIZE;
				let y = Math.floor(index / BOARD_SIZE);
				let nextX = Math.max(0, Math.min(BOARD_SIZE - 1, x + direction[0]));
				let nextY = Math.max(0, Math.min(BOARD_SIZE - 1, y + direction[1]));
				this.focusIndex = nextY * BOARD_SIZE + nextX;
				this.revision += 1;
				app.$nextTick(() => document.querySelector(`[data-editor-index="${this.focusIndex}"]`)?.focus());
				return;
			}
			let state;
			if (/^[0-8]$/.test(event.key)) state = event.key;
			else if (event.key.toLowerCase() === 'f') state = 'flag';
			else if (event.key.toLowerCase() === 'm') state = 'masked';
			else if (['u', 'Delete', 'Backspace'].includes(event.key)) state = 'covered';
			else if (event.key === ' ' || event.key === 'Enter') state = this.tool;
			if (state !== undefined) {
				event.preventDefault();
				this.setCell(index, state);
			}
		},
		/** @param {KeyboardEvent} event */
		keydownAtPointer(event) {
			if (event.defaultPrevented || !/^[0-8]$/.test(event.key) || this.hoverIndex < 0) return;
			event.preventDefault();
			this.setCell(this.hoverIndex, event.key);
		},
		analyze() {
			this.analysis = analyzeEditorBoard(this.board, BOARD_SIZE, BOARD_SIZE);
			this.showEditorSolution = false;
			this.revision += 1;
		},
		/** @param {unknown} app */
		async activatePrimaryAction(app) {
			if (!this.canShare) {
				this.analyze();
				return;
			}
			let puzzle = createEditorPuzzle(this.board, this.analysis, BOARD_SIZE, BOARD_SIZE);
			let url = createRouteUrl(window.location.href, `/puzzle/${puzzle.encode()}`);
			let shareData = {
				title: 'Minesight puzzle',
				text: 'Can you solve this Minesight puzzle?',
				url: url.href,
			};
			await app.shareLink(shareData, 'Puzzle shared', 'Share link copied');
		},
		undo() {
			let previous = this.history.pop();
			if (!previous) return;
			this.board = previous;
			this.analysis = undefined;
			this.showEditorSolution = false;
			this.revision += 1;
		},
		clear() {
			if (this.board.every((cell) => cell === 'covered')) return;
			this.history.push(this.board.slice());
			this.board = Array(BOARD_SIZE * BOARD_SIZE).fill('covered');
			this.analysis = undefined;
			this.showEditorSolution = false;
			this.revision += 1;
		},
	};
}

function createTraditionalPage() {
	let stored = loadMinesightData().traditional;
	let field = new MineField(BOARD_SIZE, BOARD_SIZE);
	let seed = randomChallengeSeed();
	/** @type {GameResult} */
	let result = 'playing';
	try {
		if (stored?.rulesVersion === TRADITIONAL_RULES_VERSION
			&& Array.isArray(stored.cells)
			&& stored.cells.length === BOARD_SIZE * BOARD_SIZE) {
			field = new MineField(BOARD_SIZE, BOARD_SIZE, Uint8Array.from(stored.cells));
			seed = BigInt(stored.seed);
			if (['playing', 'cleared', 'failed'].includes(stored.result)) result = stored.result;
		}
	}
	catch {}
	return {
		kind: 'traditional',
		title: 'Traditional',
		field,
		result,
		seed,
		busy: false,
		moveId: 0,
		markValidation: 'immediate',
		hints: false,
		traditionalRules: true,
		tutorialRules: false,
		requiresReadyBoard: false,
		showSolution: () => false,
		currentDifficulty: () => STUDY_DIFFICULTIES[0],
		close(app) {
			this.moveId += 1;
			this.busy = false;
			this.save();
		},
		open(app) {
			app.engineError = '';
			app.boardNumber += 1;
			app.revision += 1;
		},
		showBoard: () => true,
		inputHelp(app) {
			if (app.scratchActive) return 'Draw freely over the board. Select Done to mark squares again.';
			return 'Tap or left-click to reveal. Long-press or right-click to flag. Select a revealed clue to reveal safe neighbours or flag mines.';
		},
		applyCellInput(app, x, y, flag) {
			this.applyInput(app, x, y, flag);
		},
		share(app) {
			return app.sharePuzzle();
		},
		shareButtonLabel: () => 'Share this puzzle',
		shareDisabled: () => true,
		showPuzzleStatus: true,
		statusTitle(app) {
			return app.page.result === 'playing' ? 'Traditional Minesweeper' : app.resultTitle;
		},
		statusMessage(app) {
			if (app.page.result === 'playing') {
				return 'Reveal safe squares, flag mines, and use the numbered clues. You never need to guess.';
			}
			return app.resultMessage;
		},
		resultTitle(app) {
			return app.page.result === 'cleared' ? 'Field cleared' : 'Game over';
		},
		resultMessage(app) {
			if (app.page.result === 'cleared') return 'You cleared the minefield without guessing.';
			return 'That move was not logically safe. The provably safe choices are highlighted.';
		},
		hintDisabled: () => true,
		toggleHint() {},
		beforeMove() {},
		handleIncorrect: () => false,
		handleCleared(app) {
			app.page.result = 'cleared';
			return false;
		},
		saveMove() {},
		save() {
			saveMinesightData('traditional', {
				rulesVersion: TRADITIONAL_RULES_VERSION,
				cells: Array.from(this.field.state),
				seed: String(this.seed),
				result: this.result,
			});
		},
		/** @param {any} app */
		newGame(app) {
			if (this.result === 'playing' && !window.confirm('Start a new game?\n\nYour current game is not finished.')) return;
			this.moveId += 1;
			this.busy = false;
			app.clearIncorrectFeedback();
			this.field = new MineField(BOARD_SIZE, BOARD_SIZE);
			this.seed = randomChallengeSeed();
			this.result = 'playing';
			app.engineError = '';
			app.boardNumber += 1;
			app.revision += 1;
			this.save();
		},
		/** @param {any} app @param {number} x @param {number} y @param {boolean} flag */
		applyInput(app, x, y, flag) {
			if (this.result !== 'playing' || this.busy) return;
			if (flag) {
				if (this.field.isRevealed(x, y)) {
					void this.revealCell(app, x, y);
					return;
				}
				this.field.actionFlag(x, y);
				let flagged = this.field.isFlagged(x, y);
				gameSounds.play(flagged ? 'mark' : 'unmark');
				if (flagged) feedbackEffects.mark({ cellIndex: this.field.getIndex(x, y), mine: true });
				app.revision += 1;
				this.save();
			}
			else void this.revealCell(app, x, y);
		},
		/** @param {any} app @param {number} x @param {number} y */
		async revealCell(app, x, y) {
			if (app.page !== this || this.result !== 'playing' || this.busy || this.field.isFlagged(x, y)) return;
			let chord = this.field.isRevealed(x, y);
			if (chord) {
				let flags = 0;
				/** @type {number[]} */
				let covered = [];
				for (let neighbourY = Math.max(0, y - 1); neighbourY <= Math.min(BOARD_SIZE - 1, y + 1); neighbourY += 1) {
					for (let neighbourX = Math.max(0, x - 1); neighbourX <= Math.min(BOARD_SIZE - 1, x + 1); neighbourX += 1) {
						if (neighbourX === x && neighbourY === y) continue;
						if (this.field.isFlagged(neighbourX, neighbourY)) flags += 1;
						else if (!this.field.isRevealed(neighbourX, neighbourY)) covered.push(this.field.getIndex(neighbourX, neighbourY));
					}
				}
				let clue = this.field.getClue(x, y);
				if (covered.length === 0) return;
				if (flags !== clue) {
					if (flags + covered.length !== clue) return;
					for (let cellIndex of covered) {
						this.field.actionFlag(cellIndex % BOARD_SIZE, Math.floor(cellIndex / BOARD_SIZE));
						feedbackEffects.mark({ cellIndex, mine: true });
					}
					gameSounds.play('mark');
					app.revision += 1;
					this.save();
					return;
				}
			}
			let moveId = this.moveId + 1;
			this.moveId = moveId;
			this.busy = true;
			app.engineError = '';
			try {
				let previousState = this.field.state.slice();
				let move = await resolveTraditionalMove(this.field, this.field.getIndex(x, y), this.seed);
				if (app.page !== this || moveId !== this.moveId) return;
				this.seed = nextTraditionalSeed(this.seed);
				this.field = fieldWithMineLayout(this.field, move.mines);
				if (chord) this.field.actionChord(x, y);
				else this.field.actionReveal(x, y);
				let gameOver = this.field.gameOverReason();
				this.result = gameOver === MineField.GAME_OVER_CLEARED ? 'cleared'
					: gameOver === MineField.GAME_OVER_DETONATION ? 'failed' : 'playing';
				if (this.result === 'failed') {
					for (let index = 0; index < this.field.state.length; index += 1) {
						if ((move.forcedSafe & (1n << BigInt(index))) !== 0n) this.field.state[index] |= MineField.FORCED_SAFE;
					}
					let failedIndex = this.field.state.findIndex(cell => (cell & (MineField.MINE | MineField.REVEALED)) === (MineField.MINE | MineField.REVEALED));
					gameSounds.play('failure');
					feedbackEffects.failure({ cellIndex: failedIndex, terminal: true });
				}
				else if (this.result === 'cleared') {
					gameSounds.play('success');
					feedbackEffects.success({ grand: true });
				}
				else {
					gameSounds.play('mark');
					for (let [cellIndex, cell] of this.field.state.entries()) {
						if ((previousState[cellIndex] & MineField.REVEALED) === 0 && (cell & MineField.REVEALED) !== 0) {
							feedbackEffects.mark({ cellIndex, mine: false });
						}
					}
				}
				app.revision += 1;
				this.save();
			}
			catch (error) {
				if (moveId === this.moveId) app.engineError = error instanceof Error ? error.message : String(error);
			}
			finally {
				if (moveId === this.moveId) this.busy = false;
			}
		},
	};
}

const PAGE_FACTORIES = {
	home: createHomePage,
	tutorial: createTutorialPage,
	study: createStudyPage,
	daily: createDailyPage,
	challenge: createChallengePage,
	puzzle: createPuzzlePage,
	editor: createEditorPage,
	traditional: createTraditionalPage,
};

/** @param {GameMode} kind */
function createPage(kind) {
	return PAGE_FACTORIES[kind]();
}

function createMinesight() {
	let stored = loadMinesightData();
	let colorScheme = ['system', 'light', 'dark'].includes(stored.colorScheme) ? stored.colorScheme : 'system';
	applyColorScheme(colorScheme);
	/** @type {ResizeObserver | undefined} */
	let scratchResizeObserver;
	/** @type {BeforeInstallPromptEvent | undefined} */
	let installPrompt;
	let initialUrl = redirectLegacyUrl(new URL(window.location.href));
	if (initialUrl.hash === '') {
		initialUrl.hash = '/';
		window.history.replaceState(null, '', initialUrl);
	}
	let urlGame = resolveUrlGame(initialUrl);
	gameSounds.setEnabled(stored.soundEnabled !== false);
	return {
		page: createPage(parseGameMode(urlGame.mode)),
		soundEnabled: gameSounds.enabled,
		settingsOpen: false,
		appInstalled: isAppInstalled(),
		installPromptAvailable: false,
		colorScheme,
		storageUsageText: 'Checking storage usage…',
		storagePersisted: false,
		storagePersistenceBusy: false,
		storageMessage: '',
		wipeStorageBusy: false,
		actionsInverted: false,
		boardPreparing: false,
		get hintUsed() {
			return Boolean(this.page.hintUsed);
		},
		set hintUsed(value) {
			this.page.hintUsed = Boolean(value);
		},
		keyboardFocusIndex: -1,
		boardNumber: 0,
		boardSeed: 0n,
		revision: 0,
		incorrectCellIndex: -1,
		incorrectFeedbackMessage: '',
		shareFeedback: '',
		engineError: '',
		/** @type {number | undefined} */
		incorrectFeedbackTimerId: undefined,
		/** @type {number | undefined} */
		shareFeedbackTimerId: undefined,
		/** @type {number | undefined} */
		cellHoldTimerId: undefined,
		/** @type {number | undefined} */
		cellGesturePointerId: undefined,
		cellGestureStartX: 0,
		cellGestureStartY: 0,
		lastCellHoldX: -1,
		lastCellHoldY: -1,
		lastCellHoldTime: 0,
		activeRouteUrl: window.location.href,
		/** @type {(() => void) | undefined} */
		routeListener: undefined,
		/** @type {(() => void) | undefined} */
		themeMediaListener: undefined,
		/** @type {((event: Event) => void) | undefined} */
		installPromptListener: undefined,
		/** @type {(() => void) | undefined} */
		appInstalledListener: undefined,
		/** @type {(() => void) | undefined} */
		dailyDateListener: undefined,
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
		/** @param {GameMode} kind */
		openPage(kind) {
			this.page = createPage(kind);
		},
		init() {
			if (isLocalDevelopment()) {
				Object.assign(window, {
					minesightTestChallengeEnd: (failedCount = 0) => (
						this.page.kind === 'challenge' && this.page.showTestEnd(failedCount)
					),
				});
			}
			this.$watch('boardNumber', () => this.minefieldView.resetScratchPad());
			this.themeMediaListener = () => {
				if (this.colorScheme === 'system') applyColorScheme('system');
			};
			window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', this.themeMediaListener);
			this.installPromptListener = event => {
				event.preventDefault();
				installPrompt = /** @type {BeforeInstallPromptEvent} */ (event);
				this.installPromptAvailable = true;
			};
			this.appInstalledListener = () => {
				installPrompt = undefined;
				this.installPromptAvailable = false;
				this.appInstalled = true;
			};
			window.addEventListener('beforeinstallprompt', this.installPromptListener);
			window.addEventListener('appinstalled', this.appInstalledListener);
			this.dailyDateListener = () => {
				if (this.page.kind === 'daily') this.page.refreshDate(this);
				else if (this.page.kind === 'home') this.page.refreshDailyProgress();
			};
			window.addEventListener('focus', this.dailyDateListener);
			document.addEventListener('visibilitychange', this.dailyDateListener);
			this.$nextTick(() => this.minefieldView.setupScratchPad(this.$refs.scratchCanvas));
			this.routeListener = () => {
				if (this.activeRouteUrl === window.location.href) return;
				this.applyCurrentRoute();
			};
			window.addEventListener('popstate', this.routeListener);
			window.addEventListener('hashchange', this.routeListener);
			this.page.open(this, urlGame);
		},

		destroy() {
			this.clearIncorrectFeedback();
			this.page.close(this);
			if (this.shareFeedbackTimerId !== undefined) window.clearTimeout(this.shareFeedbackTimerId);
			this.page.minefield?.destroy();
			this.cancelCellGesture();
			scratchResizeObserver?.disconnect();
			if (this.routeListener) window.removeEventListener('popstate', this.routeListener);
			if (this.routeListener) window.removeEventListener('hashchange', this.routeListener);
			if (this.themeMediaListener) window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', this.themeMediaListener);
			if (this.installPromptListener) window.removeEventListener('beforeinstallprompt', this.installPromptListener);
			if (this.appInstalledListener) window.removeEventListener('appinstalled', this.appInstalledListener);
			if (this.dailyDateListener) window.removeEventListener('focus', this.dailyDateListener);
			if (this.dailyDateListener) document.removeEventListener('visibilitychange', this.dailyDateListener);
			document.body.classList.remove('settings-open');
		},

		get currentDifficulty() {
			return this.page.currentDifficulty(this);
		},

		// Pages are migrated to owning this view model one at a time. Until the
		// remaining pages move, the root object is their compatibility view.
		get minefieldView() {
			return this.page.minefield ?? this;
		},

		get currentField() {
			return this.page.minefield?.field ?? this.page.field;
		},

		get canInstallApp() {
			return !this.appInstalled && this.installPromptAvailable;
		},

		get appInstallMessage() {
			if (this.appInstalled) return 'Minesight is installed and opens as its own app.';
			if (this.canInstallApp) return 'Play in its own window and keep it close at hand.';
			return appInstallInstructions();
		},

		get storagePersistenceSupported() {
			return typeof navigator.storage?.persisted === 'function'
				&& typeof navigator.storage?.persist === 'function';
		},

		get storagePersistenceDisabled() {
			return !this.storagePersistenceSupported || this.storagePersisted || this.storagePersistenceBusy;
		},

		get storagePersistenceMessage() {
			if (this.storageMessage) return this.storageMessage;
			if (!this.storagePersistenceSupported) return 'Persistent storage is not supported by this browser.';
			if (this.storagePersisted) return 'Enabled. Turn it off from your browser\'s site settings.';
			return 'Ask the browser to keep progress and offline files when storage runs low.';
		},

		get engineErrorMessage() {
			return `Puzzle generator error: ${this.engineError}`;
		},

		get shareButtonLabel() {
			return this.page.shareButtonLabel(this);
		},


		get showBoard() {
			return this.page.showBoard(this);
		},

		get boardResultClass() {
			return `result-${this.page.result}`;
		},

		get minefieldStyle() {
			return `--columns: ${this.currentField.width}`;
		},

		get sharePuzzleDisabled() {
			return this.page.shareDisabled(this);
		},

		get showPuzzleStatus() {
			return this.page.showPuzzleStatus;
		},

		get statusTitle() {
			return this.page.statusTitle(this);
		},

		get statusMessage() {
			return this.page.statusMessage(this);
		},

		get hintButtonClass() {
			return this.page.hintUsed ? 'active' : '';
		},

		get hintButtonDisabled() {
			return this.page.hintDisabled(this);
		},

		get markValidation() {
			return this.page.markValidation;
		},


		get tapActionLabel() {
			return this.actionsInverted ? 'Mine' : 'Safe';
		},

		get holdActionLabel() {
			return this.actionsInverted ? 'Safe' : 'Mine';
		},

		get inputHelp() {
			return this.page.inputHelp(this);
		},

		toggleScratchPad() {
			let opening = !this.scratchActive;
			this.scratchActive = opening;
			if (opening && this.scratchTool === 'eraser') {
				this.scratchTool = 'pencil';
				this.scratchColor = this.scratchColors[0].key;
			}
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
		 * @param {boolean} flag
		 */
		drawScratchMark(point, flag) {
			let jitter = () => (Math.random() - .5) * SCRATCH_MARK_SIZE * .12;
			let rotate = (x, y, angle) => ({
				x: point.x + x * Math.cos(angle) - y * Math.sin(angle) + jitter(),
				y: point.y + x * Math.sin(angle) + y * Math.cos(angle) + jitter(),
			});
			let angle = (Math.random() - .5) * .14;
			let path = flag
				? [[-.32, .9], [-.32, -.9], [-.3, -.82], [.72, -.48], [-.3, -.08]]
				: [[-.8, -.02], [-.22, .62], [.86, -.72]];
			let stroke = {
				color: this.scratchColor,
				points: path.map(([x, y]) => rotate(x * SCRATCH_MARK_SIZE, y * SCRATCH_MARK_SIZE, angle)),
				drawProgress: 0,
			};
			this.scratchStrokes.push(stroke);
			this.animateScratchMark(stroke);
		},

		/** @param {{ drawProgress: number }} stroke */
		animateScratchMark(stroke) {
			let startTime;
			let drawFrame = (time) => {
				startTime ??= time;
				stroke.drawProgress = Math.min(1, (time - startTime) / SCRATCH_MARK_ANIMATION_MS);
				this.renderScratchPad();
				if (stroke.drawProgress < 1) requestAnimationFrame(drawFrame);
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
			this.drawScratchMark(point, this.flagForInput(false));
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
			this.drawScratchMark(point, this.flagForInput(true));
			this.renderScratchPad();
		},

		/** @param {WheelEvent} event */
		cycleScratchTool(event) {
			if (!this.scratchActive) return;
			let delta = event.deltaY || event.deltaX;
			if (delta === 0) return;
			let tools = [...this.scratchColors.map((color) => color.key), 'eraser'];
			let current = this.scratchTool === 'eraser' ? tools.length - 1 : tools.indexOf(this.scratchColor);
			let next = (current + (delta > 0 ? 1 : -1) + tools.length) % tools.length;
			if (tools[next] === 'eraser') {
				this.scratchTool = 'eraser';
			}
			else {
				this.scratchTool = 'pencil';
				this.scratchColor = tools[next];
			}
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

		get cells() {
			this.revision;
			let cells = [];
			let showHints = this.page.hints && this.page.hintUsed && this.page.result === 'playing';
			let showSolution = this.page.showSolution(this);
			let field = this.currentField;
			for (let y = 0; y < field.height; y += 1) {
				for (let x = 0; x < field.width; x += 1) {
					let index = field.getIndex(x, y);
					let mine = field.isMine(x, y);
					let revealed = field.isRevealed(x, y);
					let flagged = field.isFlagged(x, y);
					let markedMine = field.isMarkedMine(x, y);
					let markedSafe = field.isMarkedSafe(x, y);
					let active = this.page.traditionalRules ? !revealed : field.isActive(x, y);
					let incorrect = field.isIncorrect(x, y) || index === this.incorrectCellIndex
						|| (this.page.traditionalRules && this.page.result === 'failed' && mine && revealed);
					let solutionMine = showSolution && field.isForcedMine(x, y);
					let solutionSafe = (showSolution || (this.page.traditionalRules && this.page.result === 'failed'))
						&& field.isForcedSafe(x, y);
					let clue = field.getClue(x, y);
					let showMine = !this.page.traditionalRules && !field.isPuzzle && mine
						&& (revealed || this.page.result === 'failed');
					let hinted = showHints && (
						(field.isForcedSafe(x, y) && !markedSafe) ||
						(field.isForcedMine(x, y) && !markedMine)
					);
					let classNames = [];
					if (revealed) classNames.push('revealed');
					if (flagged) classNames.push('flagged');
					if (markedMine || solutionMine || (this.page.traditionalRules && flagged)) classNames.push('marked-mine');
					if (markedSafe || solutionSafe) classNames.push('marked-safe');
					if (!active && !revealed && !flagged) classNames.push('inactive');
					if (hinted) classNames.push('hinted');
					if (showMine) classNames.push('mine');
					if (incorrect) classNames.push('incorrect-guess');
					let tutorialTarget = false;
					if (this.page.tutorialRules && !this.page.tutorialComplete) {
						let step = TUTORIAL_STEPS[this.page.tutorialStep];
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

					let pageBoardUnavailable = this.page.requiresReadyBoard && !this.page.ready;
					let chordable = !this.page.tutorialRules && revealed && !mine;
					let disabled = this.boardPreparing || Boolean(this.page.busy) || pageBoardUnavailable ||
						this.page.result !== 'playing' || (!active && !chordable) ||
						(this.page.tutorialRules && this.page.tutorialComplete);
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
			return this.page.resultTitle(this);
		},

		get resultMessage() {
			return this.page.resultMessage(this);
		},

		toggleSound() {
			this.soundEnabled = gameSounds.toggle();
			saveMinesightData('soundEnabled', this.soundEnabled);
		},

		async installApp() {
			if (!installPrompt || this.appInstalled) return;
			let prompt = installPrompt;
			installPrompt = undefined;
			this.installPromptAvailable = false;
			await prompt.prompt();
			await prompt.userChoice;
		},

		openSettings() {
			this.settingsOpen = true;
			document.body.classList.add('settings-open');
			void this.refreshStorageInfo();
			this.$nextTick(() => this.$refs.settingsClose?.focus());
		},

		closeSettings() {
			if (!this.settingsOpen) return;
			this.settingsOpen = false;
			document.body.classList.remove('settings-open');
			this.$nextTick(() => this.$refs.settingsButton?.focus());
		},

		/** @param {'system' | 'light' | 'dark'} colorScheme */
		setColorScheme(colorScheme) {
			this.colorScheme = colorScheme;
			applyColorScheme(colorScheme);
			saveMinesightData('colorScheme', colorScheme);
		},

		async refreshStorageInfo() {
			this.storageMessage = '';
			try {
				let usage = await measureMinesightStorageUsage();
				if (typeof navigator.storage?.estimate === 'function') {
					let { quota } = await navigator.storage.estimate();
					this.storageUsageText = `${formatStorageSize(usage)} used${typeof quota === 'number' ? ` out of ${formatStorageSize(quota)}` : ''}.`;
				}
				else this.storageUsageText = `${formatStorageSize(usage)} used.`;
			}
			catch {
				this.storageUsageText = 'Storage usage is unavailable.';
			}
			if (this.storagePersistenceSupported) {
				try {
					this.storagePersisted = await navigator.storage.persisted();
				}
				catch {
					this.storageMessage = 'Persistent storage status is unavailable.';
				}
			}
		},

		async enablePersistentStorage() {
			if (this.storagePersistenceDisabled) return;
			this.storagePersistenceBusy = true;
			this.storageMessage = 'Requesting persistent storage…';
			try {
				this.storagePersisted = await navigator.storage.persist();
				this.storageMessage = this.storagePersisted ? 'Enabled. Turn it off from your browser\'s site settings.' : 'The browser did not grant persistent storage.';
			}
			catch {
				this.storageMessage = 'Persistent storage could not be enabled.';
			}
			finally {
				this.storagePersistenceBusy = false;
			}
		},

		async wipeMinesightData() {
			if (this.wipeStorageBusy) return;
			let confirmed = window.confirm('Wipe all Minesight data?\n\nThis permanently deletes saved progress, preferences, and offline files on this device.');
			if (!confirmed) return;
			this.wipeStorageBusy = true;
			try {
				window.localStorage.removeItem(MINESIGHT_STORAGE_KEY);
				if ('caches' in window) {
					let cacheNames = await window.caches.keys();
					await Promise.all(cacheNames
						.filter(name => name === MINESIGHT_CACHE_PREFIX || name.startsWith(`${MINESIGHT_CACHE_PREFIX}-`))
						.map(name => window.caches.delete(name)));
				}
				window.location.reload();
			}
			catch {
				this.wipeStorageBusy = false;
				this.storageMessage = 'MineSight data could not be completely removed.';
				void this.refreshStorageInfo();
			}
		},

		/** @param {string} route */
		navigate(route) {
			let url = createRouteUrl(window.location.href, route);
			if (url.href === window.location.href) return;
			window.history.pushState(null, '', url);
			this.applyCurrentRoute();
		},

		applyCurrentRoute() {
			this.activeRouteUrl = window.location.href;
			let route = resolveUrlGame(new URL(window.location.href));
			this.page.minefield?.destroy();
			this.page.close(this);
			this.boardPreparing = false;

			this.openPage(route.mode);
			this.page.open(this, route);
			this.$nextTick(() => this.minefieldView.setupScratchPad(this.$refs.scratchCanvas));
		},

		/** @param {GameMode} nextMode */
		switchMode(nextMode) {
			if (nextMode === 'home') this.navigate('/');
			else if (nextMode === 'tutorial') this.navigate('/tutorial');
			else if (nextMode === 'study') this.navigate(this.page.kind === 'study' ? `/study/${this.page.difficultyKey}` : '/study');
			else if (nextMode === 'daily') this.navigate(this.page.kind === 'daily' ? `/daily/${this.page.difficultyKey}` : '/daily');
			else if (nextMode === 'challenge') {
				let storedModeKey = loadMinesightData().challengeModeKey ?? 'expert';
				let modeKey = CHALLENGE_MODES.some(({ key }) => key === storedModeKey) ? storedModeKey : CHALLENGE_MODES[0].key;
				this.navigate(`/challenge/${modeKey}`);
			}
			else if (nextMode === 'editor') this.navigate('/editor');
			else if (nextMode === 'traditional') this.navigate('/traditional');
		},

		goHome() {
			if (this.page.kind === 'challenge' && this.page.runActive) return;
			this.switchMode('home');
		},

		async share() {
			await this.page.share(this);
		},

		async sharePuzzle() {
			if (this.sharePuzzleDisabled || !this.showBoard) return;
			let url = createRouteUrl(window.location.href, `/puzzle/${this.currentField.encode()}`);
			let shareData = {
				title: 'Minesight Puzzle',
				text: 'Can you solve this Minesight puzzle?',
				url: url.href,
			};
			await this.shareLink(shareData, 'Puzzle shared', 'Share link copied');
		},

		/**
		 * @param {{ title: string, text: string, url: string }} shareData
		 * @param {string} sharedMessage
		 * @param {string} copiedMessage
		 */
		async shareLink(shareData, sharedMessage, copiedMessage) {
			if (typeof navigator.share === 'function') {
				try {
					await navigator.share(shareData);
					this.showShareFeedback(sharedMessage);
					return;
				}
				catch (error) {
					if (error instanceof DOMException && error.name === 'AbortError') return;
				}
			}

			try {
				await this.copyShareUrl(shareData.url);
				this.showShareFeedback(copiedMessage);
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

		clearIncorrectFeedback() {
			if (this.incorrectFeedbackTimerId !== undefined) {
				window.clearTimeout(this.incorrectFeedbackTimerId);
			}
			this.incorrectFeedbackTimerId = undefined;
			this.incorrectCellIndex = -1;
			if (this.page.minefield) this.page.minefield.incorrectCellIndex = -1;
			this.incorrectFeedbackMessage = '';
		},

		/** @param {number} index @param {string} [message] */
		showIncorrectFeedback(index, message = "The clues don't support that mark. Try again.") {
			this.clearIncorrectFeedback();
			this.incorrectCellIndex = index;
			if (this.page.minefield) this.page.minefield.incorrectCellIndex = index;
			this.incorrectFeedbackMessage = message;
			this.incorrectFeedbackTimerId = window.setTimeout(() => {
				this.incorrectCellIndex = -1;
				if (this.page.minefield) this.page.minefield.incorrectCellIndex = -1;
				this.incorrectFeedbackMessage = '';
				this.incorrectFeedbackTimerId = undefined;
			}, 650);
		},

		useHint() {
			this.page.toggleHint(this);
		},

		/**
		 * Resolves the physical primary/secondary input into its game action.
		 * @param {boolean} invert
		 */
		flagForInput(invert) {
			return invert !== this.minefieldView.actionsInverted;
		},

		/**
		 * @param {number} x
		 * @param {number} y
		 * @param {boolean} invert
		 */
		applyCellInput(x, y, invert) {
			let flag = this.flagForInput(invert);
			this.page.applyCellInput(this, x, y, flag);
		},

		/** @param {number} index */
		focusCell(index) {
			this.minefieldView.keyboardFocusIndex = index;
		},

		/**
		 * @param {PointerEvent} event
		 * @param {number} x
		 * @param {number} y
		 */
		beginCellGesture(event, x, y) {
			let view = this.minefieldView;
			if (!event.isPrimary || event.button !== 0 || view.cellGesturePointerId !== undefined) return;
			event.currentTarget.setPointerCapture(event.pointerId);
			view.cellGesturePointerId = event.pointerId;
			view.cellGestureStartX = event.clientX;
			view.cellGestureStartY = event.clientY;
			view.cellHoldTimerId = window.setTimeout(() => {
				view.cellHoldTimerId = undefined;
				if (view.cellGesturePointerId !== event.pointerId) return;
				view.cellGesturePointerId = undefined;
				view.lastCellHoldX = x;
				view.lastCellHoldY = y;
				view.lastCellHoldTime = performance.now();
				this.applyCellInput(x, y, true);
			}, CELL_HOLD_MS);
		},

		/** @param {PointerEvent} event */
		moveCellGesture(event) {
			let view = this.minefieldView;
			if (event.pointerId !== view.cellGesturePointerId) return;
			let distance = Math.hypot(
				event.clientX - view.cellGestureStartX,
				event.clientY - view.cellGestureStartY,
			);
			if (distance > CELL_GESTURE_MOVE_TOLERANCE) this.cancelCellGesture(event);
		},

		/**
		 * @param {PointerEvent} event
		 * @param {number} x
		 * @param {number} y
		 */
		endCellGesture(event, x, y) {
			if (event.pointerId !== this.minefieldView.cellGesturePointerId) return;
			this.cancelCellGesture(event);
			this.applyCellInput(x, y, false);
		},

		/**
		 * Preserve button activation from assistive technology without handling
		 * the synthetic click that follows a pointer gesture.
		 * @param {MouseEvent} event
		 * @param {number} x
		 * @param {number} y
		 */
		clickCell(event, x, y) {
			if (event.detail === 0) this.applyCellInput(x, y, event.shiftKey);
		},

		/** @param {PointerEvent} [event] */
		cancelCellGesture(event) {
			let view = this.minefieldView;
			if (event && event.pointerId !== view.cellGesturePointerId) return;
			if (view.cellHoldTimerId !== undefined) window.clearTimeout(view.cellHoldTimerId);
			view.cellHoldTimerId = undefined;
			view.cellGesturePointerId = undefined;
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
		async moveCellFocus(x, y, deltaX, deltaY) {
			let view = this.minefieldView;
			let candidates = view.cells
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
			view.keyboardFocusIndex = index;
			await nextAlpineRender();
			document.querySelector(`.board-card .minefield .cell[data-cell-index="${index}"]`)?.focus();
		},

		/**
		 * Keep right-click support and use contextmenu as a fallback on browsers
		 * that emit it for touch. A timer-recognized hold must not run twice.
		 * @param {MouseEvent | PointerEvent} event
		 * @param {number} x
		 * @param {number} y
		 */
		contextMenuCell(event, x, y) {
			let view = this.minefieldView;
			let repeatsTimedHold = x === view.lastCellHoldX && y === view.lastCellHoldY
				&& performance.now() - view.lastCellHoldTime < CELL_CONTEXT_MENU_DEDUP_MS;
			if (repeatsTimedHold) return;
			let pointerType = 'pointerType' in event ? event.pointerType : '';
			if (pointerType === 'mouse') {
				this.applyCellInput(x, y, true);
				return;
			}
			this.cancelCellGesture();
			view.lastCellHoldX = x;
			view.lastCellHoldY = y;
			view.lastCellHoldTime = performance.now();
			this.applyCellInput(x, y, true);
		},

		/** @param {{ removing: boolean, cellIndex: number, markMine: boolean, additionalMarks?: Array<{ index: number, mine: boolean }>, rejectedIndex?: number }} move */
		afterMove(move) {
			let showMarkEffects = () => {
				feedbackEffects.mark({ cellIndex: move.cellIndex, mine: move.markMine });
				for (let mark of move.additionalMarks ?? []) {
					feedbackEffects.mark({ cellIndex: mark.index, mine: mark.mine });
				}
			};
			this.page.beforeMove(this);
			let rejectedIndex = move.rejectedIndex ?? -1;
			let gameOver = this.markValidation === 'deferred'
				? MineField.GAME_OVER_FALSE
				: rejectedIndex >= 0 ? MineField.GAME_OVER_DETONATION : this.currentField.gameOverReason();
			if (gameOver === MineField.GAME_OVER_DETONATION) {
				let feedbackCellIndex = rejectedIndex >= 0 ? rejectedIndex : this.currentField.incorrectIndex;
				if (this.page.handleIncorrect(this, feedbackCellIndex)) return;
				let incorrectIndex = this.currentField.consumeIncorrect();
				if (incorrectIndex >= 0) this.showIncorrectFeedback(incorrectIndex);
				else this.page.result = 'failed';
				gameSounds.play('incorrect');
				feedbackEffects.failure({
					cellIndex: feedbackCellIndex,
					terminal: false,
				});
			}
			else if (gameOver === MineField.GAME_OVER_CLEARED) {
				this.clearIncorrectFeedback();
				let challengeComplete = this.page.handleCleared(this);
				if (!challengeComplete) gameSounds.play('success');
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
			if (this.page.minefield) {
				this.page.minefield.result = this.page.result;
				this.page.minefield.revision += 1;
			}
			this.page.saveMove(this);
		},

	};
}

// Preload the generator without keeping the home screen, tutorial, or a puzzle behind
// a blank, x-cloaked page. A failed preload is retried when a board is requested.
void ensurePuzzleGenerator().catch(() => {});

Object.assign(window, { minesight: createMinesight });
await import('./alpine.min.js');
