/** Internal fallback used to make invalid owner data visibly obvious. */
const INVALID_CELL_STATE = 'invalid';

const CellState = Object.freeze({
	MASKED: 'masked',
	COVERED: 'covered',
	CLUE_0: 'clue-0',
	CLUE_1: 'clue-1',
	CLUE_2: 'clue-2',
	CLUE_3: 'clue-3',
	CLUE_4: 'clue-4',
	CLUE_5: 'clue-5',
	CLUE_6: 'clue-6',
	CLUE_7: 'clue-7',
	CLUE_8: 'clue-8',
	FLAGGED: 'flagged',
	MARKED_MINE: 'marked-mine',
	MARKED_SAFE: 'marked-safe',
	HINT: 'hint',
	MISFLAGGED: 'misflagged',
	EXPOSED_MINE: 'exposed-mine',
	DETONATED_MINE: 'detonated-mine',
});

const CELL_STATES = Object.freeze(Object.values(CellState));

const CELL_STATE_METADATA = Object.freeze({
	[CellState.MASKED]: Object.freeze({ symbol: '', description: 'outside the puzzle' }),
	[CellState.COVERED]: Object.freeze({ symbol: '', description: 'covered' }),
	[CellState.CLUE_0]: Object.freeze({ symbol: '', description: 'empty' }),
	[CellState.CLUE_1]: Object.freeze({ symbol: '1', description: 'clue 1' }),
	[CellState.CLUE_2]: Object.freeze({ symbol: '2', description: 'clue 2' }),
	[CellState.CLUE_3]: Object.freeze({ symbol: '3', description: 'clue 3' }),
	[CellState.CLUE_4]: Object.freeze({ symbol: '4', description: 'clue 4' }),
	[CellState.CLUE_5]: Object.freeze({ symbol: '5', description: 'clue 5' }),
	[CellState.CLUE_6]: Object.freeze({ symbol: '6', description: 'clue 6' }),
	[CellState.CLUE_7]: Object.freeze({ symbol: '7', description: 'clue 7' }),
	[CellState.CLUE_8]: Object.freeze({ symbol: '8', description: 'clue 8' }),
	[CellState.FLAGGED]: Object.freeze({ symbol: '⚑', description: 'flagged' }),
	[CellState.MARKED_MINE]: Object.freeze({ symbol: '⚑', description: 'marked mine' }),
	[CellState.MARKED_SAFE]: Object.freeze({ symbol: '✓', description: 'provably safe' }),
	[CellState.HINT]: Object.freeze({ symbol: '?', description: 'hint' }),
	[CellState.MISFLAGGED]: Object.freeze({ symbol: '×', description: 'incorrectly flagged' }),
	[CellState.EXPOSED_MINE]: Object.freeze({ symbol: '✹', description: 'covered square, mine shown' }),
	[CellState.DETONATED_MINE]: Object.freeze({ symbol: '✹', description: 'detonated mine' }),
	[INVALID_CELL_STATE]: Object.freeze({ symbol: '!', description: 'invalid cell state' }),
});

function isCellState(value) {
	return CELL_STATES.includes(value);
}

function getCellStateMetadata(state) {
	return CELL_STATE_METADATA[state] ?? CELL_STATE_METADATA[INVALID_CELL_STATE];
}
