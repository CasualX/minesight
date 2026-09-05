// @ts-check

const MINE = 0x01;
const REVEALED = 0x02;
const FLAG = 0x04;
const ACTIVE = 0x08;
const FORCED_MINE = 0x10;
const FORCED_SAFE = 0x20;
const MARKED_MINE = 0x40;
const MARKED_SAFE = 0x80;

/** @typedef {0 | 1 | 2} GameOverReason */

const GAME_OVER_FALSE = 0;
const GAME_OVER_CLEARED = 1;
const GAME_OVER_DETONATION = 2;

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// This is only meant to make shared minefields less visually recognizable, not to provide encryption.
const SHARE_MASK = (() => {
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

/** A Minesweeper board with revealing, flagging, and game-over rules. */
export class PlayField {
	/** @returns {number} Cell contains a mine. */
	static get MINE() { return MINE; }
	/** @returns {number} Cell is revealed. */
	static get REVEALED() { return REVEALED; }
	/** @returns {number} Cell is flagged. */
	static get FLAG() { return FLAG; }
	/** @returns {number} Cell is logically forced safe. */
	static get FORCED_SAFE() { return FORCED_SAFE; }
	/** @returns {0} The game is still in progress. */
	static get GAME_OVER_FALSE() { return GAME_OVER_FALSE; }
	/** @returns {1} Every non-mine cell has been revealed. */
	static get GAME_OVER_CLEARED() { return GAME_OVER_CLEARED; }
	/** @returns {2} A mine has been revealed. */
	static get GAME_OVER_DETONATION() { return GAME_OVER_DETONATION; }

	/**
	 * Creates a field whose mine count is the requested proportion rounded to the nearest cell.
	 * @param {number} width
	 * @param {number} height
	 * @param {number} [mineRatio]
	 * @param {() => number} [random]
	 * @returns {PlayField}
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
		return new PlayField(width, height, state);
	}

	/**
	 * Creates a board and calculates clues from the mine bits in `state`.
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
		/** @type {Uint8Array} */
		this.clues = new Uint8Array(width * height);

		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				if (this.isState(x, y, MINE)) {
					forEachNeighbour(x, y, width, height, (neighbourX, neighbourY) => {
						this.clues[neighbourY * width + neighbourX] += 1;
					});
				}
			}
		}
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
	 * @param {number} flag Cell-state bit mask to test.
	 * @returns {boolean}
	 */
	isState(x, y, flag) {
		return (this.state[this.getIndex(x, y)] & flag) !== 0;
	}

	/**
	 * Returns the number of neighbouring mines.
	 * @param {number} x
	 * @param {number} y
	 * @returns {number}
	 */
	getClue(x, y) {
		return this.clues[this.getIndex(x, y)];
	}

	/** @returns {GameOverReason} The traditional game's current completion state. */
	gameOverReason() {
		let cleared = true;
		for (let cell of this.state) {
			if ((cell & (MINE | REVEALED)) === (MINE | REVEALED)) {
				return GAME_OVER_DETONATION;
			}
			if ((cell & (MINE | REVEALED)) === 0) cleared = false;
		}
		return cleared ? GAME_OVER_CLEARED : GAME_OVER_FALSE;
	}

	/**
	 * Finds revealed clues surrounded by more flags than their number allows.
	 * @returns {Array<[number, number]>} Coordinates of the over-flagged clues.
	 */
	checkFlags() {
		/** @type {Array<[number, number]>} */
		let result = [];

		for (let y = 0; y < this.height; y += 1) {
			for (let x = 0; x < this.width; x += 1) {
				let index = this.getIndex(x, y);
				if ((this.state[index] & REVEALED) === 0) {
					continue;
				}

				let flags = 0;
				forEachNeighbour(x, y, this.width, this.height, (x, y) => {
					if ((this.state[this.getIndex(x, y)] & FLAG) !== 0) {
						flags += 1;
					}
				});

				if (flags > this.clues[index]) {
					result.push([x, y]);
				}
			}
		}

		return result;
	}

	/**
	 * Describes the direct deduction available from a revealed clue.
	 * This lets controllers decide whether a chord needs a new mine layout
	 * without duplicating the neighbouring-cell rules.
	 * @param {number} x
	 * @param {number} y
	 * @returns {'flag' | 'reveal' | undefined}
	 */
	getChordAction(x, y) {
		let index = this.getIndex(x, y);
		if ((this.state[index] & REVEALED) === 0 || (this.state[index] & MINE) !== 0) {
			return undefined;
		}

		let flagCount = 0;
		let coveredCount = 0;
		forEachNeighbour(x, y, this.width, this.height, (neighbourX, neighbourY) => {
			let neighbour = this.state[this.getIndex(neighbourX, neighbourY)];
			if ((neighbour & FLAG) !== 0) {
				flagCount += 1;
			}
			else if ((neighbour & REVEALED) === 0) {
				coveredCount += 1;
			}
		});

		if (coveredCount === 0) return undefined;
		if (this.clues[index] === flagCount + coveredCount) return 'flag';
		if (this.clues[index] === flagCount) return 'reveal';
		return undefined;
	}

	/**
	 * Toggles a flag on a covered cell, or chords a revealed cell.
	 * @param {number} x
	 * @param {number} y
	 */
	actionFlag(x, y) {
		let index = this.getIndex(x, y);
		if ((this.state[index] & REVEALED) !== 0) {
			this.actionChord(x, y);
		}
		else {
			this.state[index] ^= FLAG;
		}
	}

	/**
	 * Reveals a covered, unflagged cell and expands through connected empty cells.
	 * On a revealed clue, flags forced mines or reveals forced safe cells.
	 * @param {number} x
	 * @param {number} y
	 */
	actionChord(x, y) {
		let index = this.getIndex(x, y);

		if ((this.state[index] & FLAG) !== 0) {
			return;
		}

		if ((this.state[index] & REVEALED) !== 0) {
			let chordAction = this.getChordAction(x, y);
			if (chordAction === 'flag') {
				forEachNeighbour(x, y, this.width, this.height, (x, y) => {
					let index = this.getIndex(x, y);
					if ((this.state[index] & (FLAG | REVEALED)) === 0) {
						this.state[index] |= FLAG;
					}
				});
			}
			if (chordAction === 'reveal') {
				forEachNeighbour(x, y, this.width, this.height, (x, y) => {
					if ((this.state[this.getIndex(x, y)] & (FLAG | REVEALED)) === 0) {
						this.actionChord(x, y);
					}
				});
			}
		}
		else {
			/** @type {Array<[number, number]>} */
			let pending = [[x, y]];

			while (pending.length > 0) {
				let coordinate = pending.pop();
				if (!coordinate) {
					break;
				}

				let [cellX, cellY] = coordinate;
				let index = this.getIndex(cellX, cellY);
				let cell = this.state[index];
				if ((cell & (FLAG | REVEALED)) !== 0) {
					continue;
				}

				this.state[index] |= REVEALED;
				if ((cell & MINE) !== 0 || this.clues[index] !== 0) {
					continue;
				}

				forEachNeighbour(cellX, cellY, this.width, this.height, (neighbourX, neighbourY) => {
					pending.push([neighbourX, neighbourY]);
				});
			}
		}
	}
}

/** A static logic puzzle with player annotations and forced answers. */
export class PuzzleField {
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

	/**
	 * Decodes and validates a shared 8x8 puzzle.
	 * @param {string} payload
	 * @returns {PuzzleField}
	 */
	static decode(payload) {
		let [version, encoded, extra] = payload.split('.');
		if (!['1', '2'].includes(version) || extra !== undefined || encoded?.length !== 64) {
			throw new Error('unsupported format');
		}

		let cells = Uint8Array.from(encoded, (character) => BASE64URL.indexOf(character));
		if (cells.some((cell) => cell === 255)) {
			throw new Error('invalid puzzle data');
		}
		if (version === '2') {
			cells = cells.map((cell, index) => cell ^ SHARE_MASK[index]);
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
		return new PuzzleField(8, 8, cells);
	}

	/**
	 * Creates a board and calculates clues from the mine bits in `state`.
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
		/** @type {Uint8Array} */
		this.clues = new Uint8Array(width * height);

		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				if (this.isState(x, y, MINE)) {
					forEachNeighbour(x, y, width, height, (neighbourX, neighbourY) => {
						this.clues[neighbourY * width + neighbourX] += 1;
					});
				}
			}
		}
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
	 * @param {number} flag Cell-state bit mask to test.
	 * @returns {boolean}
	 */
	isState(x, y, flag) {
		return (this.state[this.getIndex(x, y)] & flag) !== 0;
	}

	/**
	 * Returns the number of neighbouring mines.
	 * @param {number} x
	 * @param {number} y
	 * @returns {number}
	 */
	getClue(x, y) {
		return this.clues[this.getIndex(x, y)];
	}

	/**
	 * Encodes an 8x8 field's six-bit puzzle state while omitting the two player annotation bits,
	 * so every recipient starts with a fresh board.
	 * @returns {string}
	 */
	encode() {
		let encoded = Array.from(this.state, (cell, index) => {
			return BASE64URL[(cell & 0x3f) ^ SHARE_MASK[index]];
		}).join('');
		return `2.${encoded}`;
	}

	/**
	 * Checks whether the player marks exactly match all forced puzzle answers.
	 * @returns {boolean}
	 */
	isPuzzleSolved() {
		return this.state.every(cell =>
			((cell & FORCED_SAFE) !== 0) === ((cell & MARKED_SAFE) !== 0)
			&& ((cell & FORCED_MINE) !== 0) === ((cell & MARKED_MINE) !== 0));
	}

	/**
	 * Finds revealed clues surrounded by more flags or mine marks than their number allows.
	 * @returns {Array<[number, number]>} Coordinates of the over-flagged clues.
	 */
	checkFlags() {
		/** @type {Array<[number, number]>} */
		let result = [];

		for (let y = 0; y < this.height; y += 1) {
			for (let x = 0; x < this.width; x += 1) {
				let index = this.getIndex(x, y);
				if ((this.state[index] & REVEALED) === 0) {
					continue;
				}

				let flags = 0;
				forEachNeighbour(x, y, this.width, this.height, (x, y) => {
					if ((this.state[this.getIndex(x, y)] & (FLAG | MARKED_MINE)) !== 0) {
						flags += 1;
					}
				});

				if (flags > this.clues[index]) {
					result.push([x, y]);
				}
			}
		}

		return result;
	}

	/**
	 * Marks direct deductions around a revealed clue without toggling existing marks.
	 * Flags and mine marks count as known mines; only unmarked active cells are candidates.
	 * @param {number} x
	 * @param {number} y
	 * @param {boolean} validate Whether to reject answers that are not forced.
	 * @returns {number[]} Indices of rejected cells. Valid deductions are applied.
	 */
	actionMarkChord(x, y, validate) {
		let index = this.getIndex(x, y);
		let cell = this.state[index];
		if ((cell & REVEALED) === 0 || (cell & MINE) !== 0) return [];

		let knownMines = 0;
		/** @type {Array<[number, number]>} */
		let unknown = [];
		forEachNeighbour(x, y, this.width, this.height, (neighbourX, neighbourY) => {
			let neighbour = this.state[this.getIndex(neighbourX, neighbourY)];
			if ((neighbour & (FLAG | MARKED_MINE)) !== 0) knownMines += 1;
			else if ((neighbour & ACTIVE) !== 0 && (neighbour & (REVEALED | MARKED_SAFE)) === 0) {
				unknown.push([neighbourX, neighbourY]);
			}
		});

		let clue = this.clues[index];
		if (knownMines !== clue && knownMines + unknown.length !== clue) return [];
		let mine = knownMines !== clue;
		let rejected = [];
		for (let [cellX, cellY] of unknown) {
			let result = mine ? this.actionMarkMine(cellX, cellY, validate) : this.actionMarkSafe(cellX, cellY, validate);
			if (result === false) rejected.push(this.getIndex(cellX, cellY));
		}
		return rejected;
	}

	/**
	 * Clears player annotations while preserving all other cell bits.
	 * @returns {boolean} Whether any marks were removed.
	 */
	actionClearMarks() {
		let changed = false;
		for (let index = 0; index < this.state.length; index += 1) {
			let cell = this.state[index];
			if ((cell & (MARKED_MINE | MARKED_SAFE)) === 0) continue;
			this.state[index] = cell & ~(MARKED_MINE | MARKED_SAFE);
			changed = true;
		}
		return changed;
	}

	/**
	 * Toggles a safe mark on an active cell, or chords a revealed clue.
	 * @param {number} x
	 * @param {number} y
	 * @param {boolean} validate Whether to reject a mark that is not a forced-safe answer.
	 * @returns {boolean | undefined | number[]} On covered cells: `true` when toggled, `false` when rejected, or `undefined` when ignored. On revealed cells: rejected chord indices.
	 */
	actionMarkSafe(x, y, validate) {
		let index = this.getIndex(x, y);
		if ((this.state[index] & REVEALED) !== 0) {
			return this.actionMarkChord(x, y, validate);
		}

		if ((this.state[index] & ACTIVE) === 0) {
			return undefined;
		}

		if ((this.state[index] & MARKED_MINE) !== 0) {
			return undefined;
		}

		if ((this.state[index] & MARKED_SAFE) !== 0) {
			this.state[index] ^= MARKED_SAFE;
			return true;
		}

		if (validate && (this.state[index] & FORCED_SAFE) === 0) {
			return false;
		}

		this.state[index] ^= MARKED_SAFE;
		return true;
	}

	/**
	 * Toggles a mine mark on an active cell, or chords a revealed clue.
	 * @param {number} x
	 * @param {number} y
	 * @param {boolean} validate Whether to reject a mark that is not a forced-mine answer.
	 * @returns {boolean | undefined | number[]} On covered cells: `true` when toggled, `false` when rejected, or `undefined` when ignored. On revealed cells: rejected chord indices.
	 */
	actionMarkMine(x, y, validate) {
		let index = this.getIndex(x, y);
		if ((this.state[index] & REVEALED) !== 0) {
			return this.actionMarkChord(x, y, validate);
		}

		if ((this.state[index] & ACTIVE) === 0) {
			return undefined;
		}

		if ((this.state[index] & MARKED_SAFE) !== 0) {
			return undefined;
		}

		if ((this.state[index] & MARKED_MINE) !== 0) {
			this.state[index] ^= MARKED_MINE;
			return true;
		}

		if (validate && (this.state[index] & FORCED_MINE) === 0) {
			return false;
		}

		this.state[index] ^= MARKED_MINE;
		return true;
	}
}
