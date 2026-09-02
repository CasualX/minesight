// @ts-check

const MAX_BOARD_SIZE = 8;
const MAX_U32 = 0xffff_ffff;
const MAX_U64 = 0xffff_ffff_ffff_ffffn;

/** @typedef {{ x: number, y: number, mine: boolean }} Deduction */
/** @typedef {{ cells: Uint8Array, seed: bigint, attempts: number }} GeneratedPuzzle */
/** @typedef {{ mines: bigint, forcedSafe: bigint }} TraditionalMove */
/**
 * @typedef {Object} Minetacs
 * @property {(width: number, height: number, cells: ArrayLike<number>) => Deduction[]} solveBoard
 * @property {(cells: ArrayLike<number>, clickedIndex: number, seed: bigint) => TraditionalMove} resolveTraditionalMove
 * @property {(seed: bigint, attempts: number) => GeneratedPuzzle | undefined} generateBeginnerPuzzle
 * @property {(seed: bigint, attempts: number) => GeneratedPuzzle | undefined} generateEasyPuzzle
 * @property {(seed: bigint, attempts: number) => GeneratedPuzzle | undefined} generateMediumPuzzle
 * @property {(seed: bigint, attempts: number) => GeneratedPuzzle | undefined} generateHardPuzzle
 * @property {(seed: bigint, attempts: number) => GeneratedPuzzle | undefined} generateExpertPuzzle
 * @property {(seed: bigint, attempts: number) => GeneratedPuzzle | undefined} generateMitPuzzle
 */

/** @param {number} low @param {number} high */
function joinU64(low, high) {
	return BigInt(low >>> 0) | BigInt(high >>> 0) << 32n;
}

/** @param {bigint} value @param {string} name */
function checkU64(value, name) {
	if (typeof value !== 'bigint' || value < 0n || value > MAX_U64) {
		throw new Error(`${name} must be an unsigned 64-bit integer`);
	}
}

/**
 * Loads the Minetacs WebAssembly module and returns its JavaScript API.
 * The raw instance and its callback-based ABI remain private to this wrapper.
 *
 * @param {string | URL} [wasmUrl]
 * @returns {Promise<Minetacs>}
 */
export default async function loadMinetacs(wasmUrl = new URL('./minetacs.wasm', import.meta.url)) {
	/** @type {WebAssembly.Exports | undefined} */
	let exports;
	/** @type {Error | undefined} */
	let resultError;
	/** @type {Deduction[] | undefined} */
	let solveResult;
	/** @type {TraditionalMove | undefined} */
	let traditionalMoveResult;
	/** @type {GeneratedPuzzle | undefined} */
	let puzzleResult;
	let textDecoder = new TextDecoder();

	function memory() {
		if (!exports || !(exports.memory instanceof WebAssembly.Memory)) {
			throw new Error('wasm returned a result before exposing its memory');
		}
		return exports.memory;
	}

	const imports = {
		env: {
			/** @param {number} pointer @param {number} length */
			resultError(pointer, length) {
				let bytes = new Uint8Array(memory().buffer, pointer, length);
				resultError = new Error(textDecoder.decode(bytes));
			},
			/** @param {number} pointer @param {number} length */
			resultSolve(pointer, length) {
				let entries = new Uint8Array(memory().buffer, pointer, length * 3);
				solveResult = Array.from({ length }, (_, index) => ({
					x: entries[index * 3],
					y: entries[index * 3 + 1],
					mine: entries[index * 3 + 2] !== 0,
				}));
			},
			/** @param {number} minesLow @param {number} minesHigh @param {number} forcedSafeLow @param {number} forcedSafeHigh */
			resultTraditionalMove(minesLow, minesHigh, forcedSafeLow, forcedSafeHigh) {
				traditionalMoveResult = {
					mines: joinU64(minesLow, minesHigh),
					forcedSafe: joinU64(forcedSafeLow, forcedSafeHigh),
				};
			},
			/** @param {number} seedLow @param {number} seedHigh @param {number} attempts @param {number} pointer @param {number} length */
			resultPuzzle(seedLow, seedHigh, attempts, pointer, length) {
				let cells = new Uint8Array(memory().buffer, pointer, length).slice();
				puzzleResult = { cells, seed: joinU64(seedLow, seedHigh), attempts };
			},
		},
	};

	let response = await fetch(wasmUrl);
	if (!response.ok) throw new Error(`wasm request failed (${response.status})`);
	/** @type {WebAssembly.WebAssemblyInstantiatedSource} */
	let loaded;
	try {
		loaded = await WebAssembly.instantiateStreaming(response.clone(), imports);
	}
	catch {
		loaded = await WebAssembly.instantiate(await response.arrayBuffer(), imports);
	}
	let loadedExports = loaded.instance.exports;
	let allocateExport = loadedExports.allocate;
	let freeExport = loadedExports.free;
	if (typeof allocateExport !== 'function' || typeof freeExport !== 'function' || !(loadedExports.memory instanceof WebAssembly.Memory)) {
		throw new Error('the Minetacs wasm module has an incompatible memory API');
	}
	exports = loadedExports;
	let allocate = /** @type {(size: number, align: number) => number} */ (allocateExport);
	let free = /** @type {(pointer: number, size: number, align: number) => boolean} */ (freeExport);

	/**
	 * Copies bytes into a temporary Rust allocation and always frees it afterward.
	 * @template T
	 * @param {ArrayLike<number>} bytes
	 * @param {(pointer: number) => T} callback
	 */
	function withBytes(bytes, callback) {
		resultError = undefined;
		let pointer = Number(allocate(bytes.length, 1));
		if (resultError) throw resultError;
		if (pointer === 0) throw new Error('wasm failed to allocate an input buffer');
		try {
			new Uint8Array(memory().buffer, pointer, bytes.length).set(bytes);
			return callback(pointer);
		}
		finally {
			free(pointer, bytes.length, 1);
		}
	}

	/**
	 * Invokes one puzzle export and consumes the result supplied through resultPuzzle.
	 * @param {string} difficulty
	 * @param {WebAssembly.ExportValue | undefined} generator
	 * @param {bigint} seed
	 * @param {number} attempts
	 */
	function generatePuzzle(difficulty, generator, seed, attempts) {
		checkU64(seed, 'puzzle seed');
		if (!Number.isInteger(attempts) || attempts < 0 || attempts > MAX_U32) {
			throw new Error('attempts must be an unsigned 32-bit integer');
		}
		if (typeof generator !== 'function') throw new Error(`the Rust ${difficulty} puzzle generator is not available`);

		resultError = undefined;
		puzzleResult = undefined;
		let found = Boolean(generator(
			Number(seed & 0xffff_ffffn),
			Number(seed >> 32n),
			attempts,
		));
		if (resultError) throw resultError;
		if (found && !puzzleResult) throw new Error('wasm reported success without returning a puzzle');
		if (!found && puzzleResult) throw new Error('wasm returned a puzzle while reporting failure');
		return puzzleResult;
	}

	return {
		solveBoard(width, height, cells) {
			if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0 || width > MAX_BOARD_SIZE || height > MAX_BOARD_SIZE) {
				throw new Error(`board width and height must be integers from 0 through ${MAX_BOARD_SIZE}`);
			}
			if (cells.length !== width * height) {
				throw new Error(`board has ${cells.length} cells instead of ${width * height}`);
			}
			for (let index = 0; index < cells.length; index += 1) {
				if (!Number.isInteger(cells[index]) || cells[index] < 0 || cells[index] > 11) {
					throw new Error(`board cell ${index} has invalid value ${cells[index]}`);
				}
			}

			let solve = exports?.solve;
			if (typeof solve !== 'function') throw new Error('the Rust SAT solver is not available');
			solveResult = undefined;
			let board = Uint8Array.from([width, height, ...Array.from(cells)]);
			let solved = withBytes(board, pointer => Boolean(solve(pointer)));
			if (resultError) throw resultError;
			if (!solved) throw new Error('wasm SAT solver failed without returning an error');
			if (!solveResult) throw new Error('wasm SAT solver returned without a result');
			return solveResult;
		},

		resolveTraditionalMove(cells, clickedIndex, seed) {
			if (cells.length !== 64) throw new Error('traditional mode requires an 8 by 8 board');
			if (!Number.isInteger(clickedIndex) || clickedIndex < 0 || clickedIndex >= 64) {
				throw new Error('clicked cell is outside the traditional board');
			}
			checkU64(seed, 'traditional seed');
			let traditionalMove = exports?.traditionalMove;
			if (typeof traditionalMove !== 'function') throw new Error('the Rust traditional solver is not available');

			traditionalMoveResult = undefined;
			let resolved = withBytes(cells, pointer => Boolean(traditionalMove(
				pointer,
				clickedIndex,
				Number(seed & 0xffff_ffffn),
				Number(seed >> 32n),
			)));
			if (resultError) throw resultError;
			if (!resolved || !traditionalMoveResult) throw new Error('Rust could not reshape this board');
			return traditionalMoveResult;
		},

		generateBeginnerPuzzle(seed, attempts) {
			return generatePuzzle('beginner', exports?.randomBeginnerPuzzle, seed, attempts);
		},

		generateEasyPuzzle(seed, attempts) {
			return generatePuzzle('easy', exports?.randomEasyPuzzle, seed, attempts);
		},

		generateMediumPuzzle(seed, attempts) {
			return generatePuzzle('medium', exports?.randomMediumPuzzle, seed, attempts);
		},

		generateHardPuzzle(seed, attempts) {
			return generatePuzzle('hard', exports?.randomHardPuzzle, seed, attempts);
		},

		generateExpertPuzzle(seed, attempts) {
			return generatePuzzle('expert', exports?.randomExpertPuzzle, seed, attempts);
		},

		generateMitPuzzle(seed, attempts) {
			return generatePuzzle('MIT-style', exports?.randomMitPuzzle, seed, attempts);
		},
	};
}
