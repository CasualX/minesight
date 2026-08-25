// @ts-check

/** @typedef {0 | 1 | 2} GameOverReason */

const MINE = 0x01;
const REVEALED = 0x02;
const FLAG = 0x04;
const ACTIVE = 0x08;
const FORCED_MINE = 0x10;
const FORCED_SAFE = 0x20;
const MARKED_MINE = 0x40;
const MARKED_SAFE = 0x80;

const GAME_OVER_FALSE = 0;
const GAME_OVER_CLEARED = 1;
const GAME_OVER_DETONATION = 2;

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// This is only meant to make shared puzzles less visually recognizable, not to
// provide encryption. Keep it stable so links using format version 2 remain valid.
const PUZZLE_MASK = (() => {
	let state = 0x6d2b79f5;
	return Uint8Array.from({ length: 64 }, () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return state & 0x3f;
	});
})();

/**
 * @param {number} value
 * @param {number} size
 * @returns {boolean}
 */
function inBounds(value, size) {
	return value >= 0 && value < size;
}

/**
 * Calls `callback` for each cell surrounding a coordinate.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {(x: number, y: number) => void} callback
 */
function forEachNeighbour(x, y, width, height, callback) {
	for (let neighbourY = Math.max(0, y - 1); neighbourY <= Math.min(height - 1, y + 1); neighbourY += 1) {
		for (let neighbourX = Math.max(0, x - 1); neighbourX <= Math.min(width - 1, x + 1); neighbourX += 1) {
			if (neighbourX !== x || neighbourY !== y) {
				callback(neighbourX, neighbourY);
			}
		}
	}
}

/** A rectangular Minesweeper board and its current play state. */
export class MineField {
	/** @returns {number} Cell contains a mine. */
	static get MINE() { return MINE; }
	/** @returns {number} Cell is revealed. */
	static get REVEALED() { return REVEALED; }
	/** @returns {number} Cell is flagged. */
	static get FLAG() { return FLAG; }
	/** @returns {number} Cell belongs to the playable puzzle frontier. */
	static get ACTIVE() { return ACTIVE; }
	/** @returns {number} Cell is a logically forced mine. */
	static get FORCED_MINE() { return FORCED_MINE; }
	/** @returns {number} Cell is logically forced safe. */
	static get FORCED_SAFE() { return FORCED_SAFE; }
	/** @returns {number} Player annotated the cell as a mine. */
	static get MARKED_MINE() { return MARKED_MINE; }
	/** @returns {number} Player annotated the cell as safe. */
	static get MARKED_SAFE() { return MARKED_SAFE; }

	/** @returns {0} The game is still in progress. */
	static get GAME_OVER_FALSE() { return GAME_OVER_FALSE; }
	/** @returns {1} Every non-mine cell has been revealed. */
	static get GAME_OVER_CLEARED() { return GAME_OVER_CLEARED; }
	/** @returns {2} A mine has been revealed. */
	static get GAME_OVER_DETONATION() { return GAME_OVER_DETONATION; }

	/**
	 * Decodes and validates a shared 8x8 puzzle.
	 * @param {string} payload
	 * @returns {MineField}
	 */
	static decode(payload) {
		let [version, encoded, extra] = payload.split('.');
		if (!['1', '2'].includes(version) || extra !== undefined || encoded?.length !== 64) {
			throw new Error('unsupported puzzle format');
		}

		let cells = Uint8Array.from(encoded, (character) => BASE64URL.indexOf(character));
		if (cells.some((cell) => cell === 255)) {
			throw new Error('invalid puzzle data');
		}
		if (version === '2') {
			cells = cells.map((cell, index) => cell ^ PUZZLE_MASK[index]);
		}
		if (!cells.some((cell) => (cell & ACTIVE) !== 0)) {
			throw new Error('invalid puzzle');
		}
		if (!cells.some((cell) => (cell & (FORCED_MINE | FORCED_SAFE)) !== 0)) {
			throw new Error('puzzle has no provable moves');
		}
		for (let cell of cells) {
			let forced = cell & (FORCED_MINE | FORCED_SAFE);
			if (forced !== 0 && (cell & ACTIVE) === 0) {
				throw new Error('puzzle has an invalid answer');
			}
			if (forced === (FORCED_MINE | FORCED_SAFE)) {
				throw new Error('puzzle has conflicting answers');
			}
			if ((cell & FORCED_MINE) !== 0 && (cell & MINE) === 0) {
				throw new Error('puzzle has an invalid mine answer');
			}
			if ((cell & FORCED_SAFE) !== 0 && (cell & MINE) !== 0) {
				throw new Error('puzzle has an invalid safe answer');
			}
		}
		return new MineField(8, 8, cells);
	}

	/**
	 * Creates a field with an exact proportion of randomly placed mines.
	 *
	 * @param {number} width
	 * @param {number} height
	 * @param {number} [mineRatio]
	 * @param {() => number} [random]
	 * @returns {MineField}
	 */
	static createRandom(width, height, mineRatio = 0.25, random = Math.random) {
		if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
			throw new Error('width and height must be positive integers');
		}
		if (mineRatio < 0 || mineRatio > 1) {
			throw new Error('mineRatio must be between 0 and 1');
		}

		let size = width * height;
		let indices = Array.from({ length: size }, (_, index) => index);
		let mineCount = Math.round(size * mineRatio);

		for (let index = 0; index < mineCount; index += 1) {
			let randomIndex = index + Math.floor(random() * (size - index));
			[indices[index], indices[randomIndex]] = [indices[randomIndex], indices[index]];
		}

		let state = new Uint8Array(size);
		for (let index = 0; index < mineCount; index += 1) {
			state[indices[index]] |= MINE;
		}
		return new MineField(width, height, state);
	}

	/**
	 * Creates a board and calculates clues from the mine bits in `state`.
	 *
	 * @param {number} width
	 * @param {number} height
	 * @param {Uint8Array} [state]
	 */
	constructor(width, height, state = new Uint8Array(width * height)) {
		if (width * height !== state.length) {
			throw new Error(`state must contain exactly ${width}x${height} cells`);
		}

		/** @type {number} */
		this.width = width;
		/** @type {number} */
		this.height = height;
		/** @type {Uint8Array} */
		this.state = state;
		/** @type {boolean} Whether this is a generated frontier puzzle. */
		this.isPuzzle = state.some((cell) => (cell & ACTIVE) !== 0);
		/** @type {number} Index of an unforced player action, or -1. */
		this.incorrectIndex = -1;
		/** @type {Uint8Array} */
		this.clues = new Uint8Array(width * height);

		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				if (this.isMine(x, y)) {
					forEachNeighbour(x, y, width, height, (neighbourX, neighbourY) => {
						this.clues[neighbourY * width + neighbourX] += 1;
					});
				}
			}
		}
	}

	/**
	 * Encodes the complete six-bit puzzle state while omitting the two player annotation bits,
	 * so every recipient starts with a fresh board.
	 * @returns {string}
	 */
	encode() {
		let encoded = Array.from(this.state, (cell, index) => {
			return BASE64URL[(cell & 0x3f) ^ PUZZLE_MASK[index]];
		}).join('');
		return `2.${encoded}`;
	}

	/** @returns {GameOverReason} The board's current completion state. */
	gameOverReason() {
		let revealedMine = false;
		let forcedMovePending = false;
		let mineCount = 0;
		let revealedCount = 0;

		for (let y = 0; y < this.height; y += 1) {
			for (let x = 0; x < this.width; x += 1) {
				let cell = this.state[y * this.width + x];
				if ((cell & MINE) !== 0) {
					mineCount += 1;
					if ((cell & REVEALED) !== 0) {
						revealedMine = true;
					}
				}
				if ((cell & REVEALED) !== 0) {
					revealedCount += 1;
				}
				if ((cell & FORCED_SAFE) !== 0 && (cell & MARKED_SAFE) === 0) {
					forcedMovePending = true;
				}
				if ((cell & FORCED_MINE) !== 0 && (cell & MARKED_MINE) === 0) {
					forcedMovePending = true;
				}
			}
		}

		if (revealedMine || this.incorrectIndex >= 0) return GAME_OVER_DETONATION;
		if (this.isPuzzle) return forcedMovePending ? GAME_OVER_FALSE : GAME_OVER_CLEARED;
		if (this.width * this.height === mineCount + revealedCount) return GAME_OVER_CLEARED;
		return GAME_OVER_FALSE;
	}

	/**
	 * @param {number} x
	 * @param {number} y
	 * @returns {number} The cell's index in `state`.
	 */
	getIndex(x, y) {
		if (!inBounds(x, this.width)) {
			throw new Error(`x = ${x} must be in bounds [0, ${this.width})`);
		}
		if (!inBounds(y, this.height)) {
			throw new Error(`y = ${y} must be in bounds [0, ${this.height})`);
		}
		return y * this.width + x;
	}

	/**
	 * @param {number} x
	 * @param {number} y
	 * @param {number} flag
	 * @returns {boolean}
	 */
	isState(x, y, flag) {
		return (this.state[this.getIndex(x, y)] & flag) !== 0;
	}

	/**
	 * @param {number} x
	 * @param {number} y
	 * @returns {boolean}
	 */
	isMine(x, y) {
		return this.isState(x, y, MINE);
	}

	/**
	 * @param {number} x
	 * @param {number} y
	 * @returns {boolean}
	 */
	isRevealed(x, y) {
		return this.isState(x, y, REVEALED);
	}

	/**
	 * @param {number} x
	 * @param {number} y
	 * @returns {boolean}
	 */
	isFlagged(x, y) {
		return this.isState(x, y, FLAG);
	}

	/**
	 * @param {number} x
	 * @param {number} y
	 * @returns {boolean}
	 */
	isActive(x, y) {
		return this.isState(x, y, ACTIVE);
	}

	/**
	 * @param {number} x
	 * @param {number} y
	 * @returns {boolean}
	 */
	isForcedMine(x, y) {
		return this.isState(x, y, FORCED_MINE);
	}

	/**
	 * @param {number} x
	 * @param {number} y
	 * @returns {boolean}
	 */
	isForcedSafe(x, y) {
		return this.isState(x, y, FORCED_SAFE);
	}

	/**
	 * @param {number} x
	 * @param {number} y
	 * @returns {boolean}
	 */
	isMarkedMine(x, y) {
		return this.isState(x, y, MARKED_MINE);
	}

	/**
	 * @param {number} x
	 * @param {number} y
	 * @returns {boolean}
	 */
	isMarkedSafe(x, y) {
		return this.isState(x, y, MARKED_SAFE);
	}

	/**
	 * Returns whether the player made an action that was not logically forced.
	 * @param {number} x
	 * @param {number} y
	 * @returns {boolean}
	 */
	isIncorrect(x, y) {
		return this.getIndex(x, y) === this.incorrectIndex;
	}

	/**
	 * Returns and clears the most recent incorrect puzzle action.
	 * @returns {number} The incorrect cell index, or -1 when there is none.
	 */
	consumeIncorrect() {
		let index = this.incorrectIndex;
		this.incorrectIndex = -1;
		return index;
	}

	/**
	 * @param {number} x
	 * @param {number} y
	 * @returns {number}
	 */
	getClue(x, y) {
		return this.clues[this.getIndex(x, y)];
	}

	/**
	 * Toggles a flag on a covered cell, or chords a revealed cell.
	 * @param {number} x
	 * @param {number} y
	 */
	actionFlag(x, y) {
		let index = this.getIndex(x, y);
		if (this.isPuzzle) return;
		if ((this.state[index] & REVEALED) !== 0) {
			this.actionChord(x, y);
		}
		else {
			this.state[index] ^= FLAG;
		}
	}

	/**
	 * Reveals a covered, unflagged cell and expands through connected empty cells.
	 * @param {number} x
	 * @param {number} y
	 */
	actionReveal(x, y) {
		this.getIndex(x, y);
		if (this.isPuzzle) return;
		/** @type {Array<[number, number]>} */
		let pending = [[x, y]];

		while (pending.length > 0) {
			let coordinate = pending.pop();
			if (!coordinate) break;

			let [cellX, cellY] = coordinate;
			let index = this.getIndex(cellX, cellY);
			let cell = this.state[index];
			if ((cell & (FLAG | REVEALED)) !== 0) continue;

			this.state[index] |= REVEALED;
			if ((cell & MINE) !== 0 || this.clues[index] !== 0) continue;

			forEachNeighbour(cellX, cellY, this.width, this.height, (neighbourX, neighbourY) => {
				pending.push([neighbourX, neighbourY]);
			});
		}
	}

	/**
	 * Reveals unflagged neighbours when a revealed clue's flag count matches.
	 * @param {number} x
	 * @param {number} y
	 */
	actionChord(x, y) {
		let index = this.getIndex(x, y);
		if (this.isPuzzle) return;
		if ((this.state[index] & REVEALED) === 0 || (this.state[index] & FLAG) !== 0) {
			return;
		}

		let flagCount = 0;
		forEachNeighbour(x, y, this.width, this.height, (neighbourX, neighbourY) => {
			if (this.isFlagged(neighbourX, neighbourY)) flagCount += 1;
		});

		if (flagCount === this.clues[index]) {
			forEachNeighbour(x, y, this.width, this.height, (neighbourX, neighbourY) => {
				this.actionReveal(neighbourX, neighbourY);
			});
		}
	}

	/**
	 * Toggles a puzzle annotation without changing the underlying board state.
	 * @param {number} x
	 * @param {number} y
	 * @param {number} mark
	 * @param {number} expected
	 */
	_actionMark(x, y, mark, expected) {
		let index = this.getIndex(x, y);
		let cell = this.state[index];
		if (!this.isPuzzle || (cell & ACTIVE) === 0) return;

		let previous = cell & (MARKED_MINE | MARKED_SAFE);
		// An opposite gesture on an annotated cell is most likely an input slip.
		// Only the gesture that created a mark may remove it.
		if (previous !== 0 && previous !== mark) return;
		let next = previous === mark ? 0 : mark;
		if (next !== 0 && (cell & expected) === 0) {
			this.incorrectIndex = index;
			return;
		}
		this.state[index] = (cell & ~(MARKED_MINE | MARKED_SAFE)) | next;
	}

	/**
	 * Marks a frontier cell as logically safe without revealing it.
	 * @param {number} x
	 * @param {number} y
	 */
	actionMarkSafe(x, y) {
		this._actionMark(x, y, MARKED_SAFE, FORCED_SAFE);
	}

	/**
	 * Marks a frontier cell as a logically forced mine without flagging it.
	 * @param {number} x
	 * @param {number} y
	 */
	actionMarkMine(x, y) {
		this._actionMark(x, y, MARKED_MINE, FORCED_MINE);
	}

	/**
	 * Completes either direct deduction around a revealed puzzle clue.
	 * Existing board flags and player mine marks both count as known mines.
	 * @param {number} x
	 * @param {number} y
	 * @returns {Array<{ index: number, mine: boolean }>} Newly applied marks.
	 */
	actionChordMarks(x, y) {
		let index = this.getIndex(x, y);
		let cell = this.state[index];
		if (!this.isPuzzle || (cell & REVEALED) === 0 || (cell & MINE) !== 0) return [];

		let knownMines = 0;
		/** @type {Array<[number, number]>} */
		let unknown = [];
		forEachNeighbour(x, y, this.width, this.height, (neighbourX, neighbourY) => {
			let neighbour = this.state[this.getIndex(neighbourX, neighbourY)];
			if ((neighbour & (FLAG | MARKED_MINE)) !== 0) knownMines += 1;
			else if ((neighbour & ACTIVE) !== 0 && (neighbour & MARKED_SAFE) === 0) {
				unknown.push([neighbourX, neighbourY]);
			}
		});

		let clue = this.clues[index];
		if (knownMines !== clue && knownMines + unknown.length !== clue) return [];
		let markMine = knownMines !== clue;

		let changed = [];
		for (let [neighbourX, neighbourY] of unknown) {
			let neighbourIndex = this.getIndex(neighbourX, neighbourY);
			if (markMine) this.actionMarkMine(neighbourX, neighbourY);
			else this.actionMarkSafe(neighbourX, neighbourY);
			if ((this.state[neighbourIndex] & (markMine ? MARKED_MINE : MARKED_SAFE)) !== 0) {
				changed.push({ index: neighbourIndex, mine: markMine });
			}
		}
		return changed;
	}
}
