import { PuzzleField } from './minefield.js';

/**
 * Calls `callback` for each cell surrounding a coordinate.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {(x: number, y: number) => void} callback
 */
function forEachEditorNeighbour(x, y, width, height, callback) {
	for (let neighbourY = Math.max(0, y - 1); neighbourY <= Math.min(height - 1, y + 1); neighbourY += 1) {
		for (let neighbourX = Math.max(0, x - 1); neighbourX <= Math.min(width - 1, x + 1); neighbourX += 1) {
			if (neighbourX !== x || neighbourY !== y) {
				callback(neighbourX, neighbourY);
			}
		}
	}
}

/**
 * Finds cells whose value is the same in every mine layout satisfying an
 * editor board. Cells use the states defined by `minefield.vue.js`.
 *
 * @param {string[]} cells
 * @param {number} width
 * @param {number} height
 */
function analyzeEditorBoard(cells, width, height) {
	if (cells.length !== width * height) throw new Error('incorrect editor board size');
	/** @type {Array<{ variables: number[], mines: number }>} */
	let constraints = [];
	let frontier = new Set();
	let covered = [];

	for (let index = 0; index < cells.length; index += 1) {
		if (cells[index] === CellState.COVERED) covered.push(index);
		let clue = /^clue-([0-8])$/.exec(cells[index]);
		if (!clue) continue;
		let x = index % width;
		let y = Math.floor(index / width);
		/** @type {number[]} */
		let variables = [];
		let flagged = 0;
		forEachEditorNeighbour(x, y, width, height, (neighbourX, neighbourY) => {
			let neighbour = neighbourY * width + neighbourX;
			if (cells[neighbour] === CellState.FLAGGED) flagged += 1;
			else if (cells[neighbour] === CellState.COVERED) variables.push(neighbour);
		});
		let mines = Number(clue[1]) - flagged;
		if (mines < 0 || mines > variables.length) return editorContradiction();
		constraints.push({ variables, mines });
		for (let variable of variables) frontier.add(variable);
	}

	let frontierCells = [...frontier];
	let variablePosition = new Map(frontierCells.map((cell, position) => [cell, position]));
	let normalized = constraints.map(({ variables, mines }) => ({
		variables: variables.map((cell) => /** @type {number} */ (variablePosition.get(cell))),
		mines,
	}));

	/** @param {number | undefined} fixedPosition @param {0 | 1 | undefined} fixedValue */
	function findSolution(fixedPosition, fixedValue) {
		let values = new Int8Array(frontierCells.length).fill(-1);
		if (fixedPosition !== undefined && fixedValue !== undefined) values[fixedPosition] = fixedValue;

		function search() {
			let changed = true;
			while (changed) {
				changed = false;
				for (let constraint of normalized) {
					let assignedMines = 0;
					let unknown = [];
					for (let variable of constraint.variables) {
						if (values[variable] === 1) assignedMines += 1;
						else if (values[variable] < 0) unknown.push(variable);
					}
					let needed = constraint.mines - assignedMines;
					if (needed < 0 || needed > unknown.length) return false;
					if (unknown.length > 0 && (needed === 0 || needed === unknown.length)) {
						let value = /** @type {0 | 1} */ (needed === 0 ? 0 : 1);
						for (let variable of unknown) {
							values[variable] = value;
							changed = true;
						}
					}
				}
			}

			let branch = -1;
			let smallestChoice = Infinity;
			for (let constraint of normalized) {
				let choices = constraint.variables.filter((variable) => values[variable] < 0);
				if (choices.length > 0 && choices.length < smallestChoice) {
					branch = choices[0];
					smallestChoice = choices.length;
				}
			}
			if (branch < 0) return true;
			let snapshot = values.slice();
			values[branch] = 0;
			if (search()) return true;
			values.set(snapshot);
			values[branch] = 1;
			if (search()) return true;
			values.set(snapshot);
			return false;
		}

		return search() ? values : undefined;
	}

	let first = findSolution(undefined, undefined);
	if (!first) return editorContradiction();
	let solution = new Uint8Array(cells.length);
	for (let index = 0; index < cells.length; index += 1) {
		solution[index] = cells[index] === CellState.FLAGGED ? 1 : 0;
	}
	frontierCells.forEach((cell, position) => { solution[cell] = first[position] < 0 ? 0 : first[position]; });
	/** @type {number[]} */
	let forcedMine = [];
	/** @type {number[]} */
	let forcedSafe = [];
	for (let position = 0; position < frontierCells.length; position += 1) {
		let value = /** @type {0 | 1} */ (first[position]);
		if (!findSolution(position, /** @type {0 | 1} */ (1 - value))) {
			(value === 1 ? forcedMine : forcedSafe).push(frontierCells[position]);
		}
	}
	let forcedCount = forcedMine.length + forcedSafe.length;
	return {
		contradiction: false,
		unique: forcedCount === covered.length,
		forcedMine,
		forcedSafe,
		solution,
		coveredCount: covered.length,
	};
}

/**
 * Turns a successfully analyzed editor position into a shareable puzzle.
 * Ambiguous cells use the analyzer's example layout; only universally true
 * cells become puzzle answers.
 *
 * @param {string[]} cells
 * @param {ReturnType<typeof analyzeEditorBoard>} analysis
 * @param {number} width
 * @param {number} height
 */
function createEditorPuzzle(cells, analysis, width, height) {
	if (analysis.contradiction) throw new Error('cannot share a contradictory board');
	if (analysis.forcedMine.length + analysis.forcedSafe.length === 0) {
		throw new Error('cannot share a board without a provable move');
	}
	let forcedMine = new Set(analysis.forcedMine);
	let forcedSafe = new Set(analysis.forcedSafe);
	let state = Uint8Array.from(cells, (cell, index) => {
		if (/^clue-[0-8]$/.test(cell)) return PuzzleField.REVEALED;
		if (cell === CellState.FLAGGED) return PuzzleField.MINE | PuzzleField.FLAG;
		if (cell === CellState.MASKED) return 0;
		let value = PuzzleField.ACTIVE;
		if (analysis.solution[index] === 1) value |= PuzzleField.MINE;
		if (forcedMine.has(index)) value |= PuzzleField.FORCED_MINE;
		if (forcedSafe.has(index)) value |= PuzzleField.FORCED_SAFE;
		return value;
	});
	return new PuzzleField(width, height, state);
}

function editorContradiction() {
	return {
		contradiction: true,
		unique: false,
		forcedMine: [],
		forcedSafe: [],
		solution: new Uint8Array(),
		coveredCount: 0,
	};
}
