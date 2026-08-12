import { MineField } from "./mines.js";

function randomField() {
	function isMine(field, x, y) {
		if (x < 0 || x >= 8 || y < 0 || y >= 8) {
			return false;
		}

		return field[y * 8 + x] !== 0;
	}

	function getNumber(field, x, y) {
		return isMine(field, x - 1, y - 1) + isMine(field, x, y - 1) + isMine(field, x + 1, y - 1) +
			isMine(field, x - 1, y) + isMine(field, x + 1, y) +
			isMine(field, x - 1, y + 1) + isMine(field, x, y + 1) + isMine(field, x + 1, y + 1);
	}

	const field = new Uint8Array(64);
	for (let i = 0; i < field.length; i += 1) {
		field[i] = Math.random() < 0.1;
	}

	const cells = [];
	for (let y = 0; y < 8; y += 1) {
		for (let x = 0; x < 8; x += 1) {
			const i = y * 8 + x;
			const mine = isMine(field, x, y);
			const value = mine ? 0 : getNumber(field, x, y);

			cells.push({
				i,
				x,
				y,
				mine,
				value,
				class: mine ? "mine" : `n${value}`,
				label: mine ? "Covered square" : value ? `${value} adjacent mines` : "Empty square",
			});
		}
	}

	return cells;
}

function mineTacs() {
	return {
		mode: "practice",
		practice: {
			difficulty: "Medium",
			field: randomField(),
		},
		challenge: {
			seed: "7KQ9-M2",
			progress: 7,
			total: 16,
			elapsed: "01:46.3",
			field: randomField(),
		},

		newPractice() {
			this.practice.field = randomField();
		},
	};
}

window.mineTacs = mineTacs;
