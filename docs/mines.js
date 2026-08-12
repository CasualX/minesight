export const HIDDEN = 0;
export const REVEALED = 1;
export const FLAGGED = 2;

export class MineField {
	/**
	 * Create a field from an existing mine layout.
	 * `mines` contains one truthy/falsy value per cell, from left to right
	 * and top to bottom.
	 */
	constructor(width = 8, height = 8, mines = new Uint8Array(width * height)) {
		if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
			throw new RangeError("width and height must be positive integers");
		}
		if (mines.length !== width * height) {
			throw new RangeError("mines must contain exactly width * height cells");
		}

		this.width = width;
		this.height = height;
		this.mines = Uint8Array.from(mines, mine => mine ? 1 : 0);
		this.state = new Uint8Array(width * height);
		this.numbers = new Uint8Array(width * height);
		this.status = "ready";
		this.mineCount = this.mines.reduce((total, mine) => total + mine, 0);
		this.revealedCount = 0;
		this.flaggedCount = 0;

		this.#calculateNumbers();
	}

	/** Reveal a cell and any connected empty area. Returns changed indexes. */
	reveal(x, y) {
		const start = this.#index(x, y);
		if (this.status === "won" || this.status === "lost" || this.state[start] !== HIDDEN) {
			return [];
		}

		if (this.status === "ready") {
			this.status = "playing";
		}

		if (this.mines[start]) {
			this.state[start] = REVEALED;
			this.status = "lost";
			return [start];
		}

		const changed = [];
		const queue = [start];
		let next = 0;

		while (next < queue.length) {
			const index = queue[next++];
			if (this.state[index] !== HIDDEN || this.mines[index]) {
				continue;
			}

			this.state[index] = REVEALED;
			this.revealedCount += 1;
			changed.push(index);

			// Numbered cells form the edge of the revealed empty area.
			if (this.numbers[index] !== 0) {
				continue;
			}

			const cellX = index % this.width;
			const cellY = Math.floor(index / this.width);
			this.#forEachNeighbor(cellX, cellY, neighbor => {
				if (this.state[neighbor] === HIDDEN && !this.mines[neighbor]) {
					queue.push(neighbor);
				}
			});
		}

		if (this.revealedCount === this.width * this.height - this.mineCount) {
			this.status = "won";
		}

		return changed;
	}

	/** Toggle a flag on a hidden cell. Returns the cell's new state. */
	flag(x, y) {
		const index = this.#index(x, y);
		if (this.status === "won" || this.status === "lost" || this.state[index] === REVEALED) {
			return this.state[index];
		}

		if (this.status === "ready") {
			this.status = "playing";
		}

		if (this.state[index] === FLAGGED) {
			this.state[index] = HIDDEN;
			this.flaggedCount -= 1;
		} else {
			this.state[index] = FLAGGED;
			this.flaggedCount += 1;
		}

		return this.state[index];
	}

	/** Convert board coordinates into an array index. */
	index(x, y) {
		return this.#index(x, y);
	}

	/** Convert an array index into board coordinates. */
	coordinates(index) {
		if (!Number.isInteger(index) || index < 0 || index >= this.state.length) {
			throw new RangeError("index is outside the minefield");
		}

		return { x: index % this.width, y: Math.floor(index / this.width) };
	}

	#calculateNumbers() {
		for (let y = 0; y < this.height; y += 1) {
			for (let x = 0; x < this.width; x += 1) {
				const index = y * this.width + x;
				if (this.mines[index]) {
					continue;
				}

				this.#forEachNeighbor(x, y, neighbor => {
					this.numbers[index] += this.mines[neighbor];
				});
			}
		}
	}

	#forEachNeighbor(x, y, callback) {
		const left = Math.max(0, x - 1);
		const right = Math.min(this.width - 1, x + 1);
		const top = Math.max(0, y - 1);
		const bottom = Math.min(this.height - 1, y + 1);

		for (let neighborY = top; neighborY <= bottom; neighborY += 1) {
			for (let neighborX = left; neighborX <= right; neighborX += 1) {
				if (neighborX !== x || neighborY !== y) {
					callback(neighborY * this.width + neighborX);
				}
			}
		}
	}

	#index(x, y) {
		if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= this.width || y < 0 || y >= this.height) {
			throw new RangeError(`cell (${x}, ${y}) is outside the minefield`);
		}

		return y * this.width + x;
	}

	/** Create a random board where density is the chance of each cell being a mine. */
	static createRandom(density, width = 8, height = 8, random = Math.random) {
		if (typeof density !== "number" || !Number.isFinite(density) || density < 0 || density > 1) {
			throw new RangeError("density must be a number between 0 and 1");
		}
		if (typeof random !== "function") {
			throw new TypeError("random must be a function");
		}
		if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
			throw new RangeError("width and height must be positive integers");
		}

		const mines = new Uint8Array(width * height);
		for (let index = 0; index < mines.length; index += 1) {
			mines[index] = random() < density ? 1 : 0;
		}

		return new MineField(width, height, mines);
	}
}
