use super::*;

impl GameState {
	/// Computes deductions by covering one clue with one or more adjacent clues.
	///
	/// Subtracting the focus constraint from the sum of the covering constraints
	/// gives negative weight to uncovered focus cells and positive weight to cells
	/// covered outside the focus or more than once inside it. When this difference
	/// reaches either possible extreme, all cells in both groups are determined.
	///
	/// `known` treats covered cells as fixed without revealing the clues of known-safe cells.
	///
	/// Returns `None` if the considered clues, flags, and known cells contradict each other.
	pub fn solve_clue_cover(&self, known: Deductions) -> Option<Deductions> {
		let active = self.active() & !(known.mines | known.safe);
		if active == 0 {
			return Some(Deductions::default());
		}

		let clues = neighbours(active) & self.revealed;
		let mut result = Deductions::default();

		for focus in self.constraints(clues, known) {
			let focus = focus.validate()?;
			let adjacent_clues = NEIGHBOURS[focus.index] & clues;
			let mut cover = adjacent_clues;

			while cover != 0 {
				let mut covered = 0;
				let mut covered_twice = 0;
				let mut covering_mines = 0;
				let mut covering_cells = 0;

				for covering in self.constraints(cover, known) {
					let covering = covering.validate()?;
					covered_twice |= covered & covering.vars;
					covered |= covering.vars;
					covering_mines += covering.sum;
					covering_cells += covering.vars.count_ones() as i32;
				}

				let uncovered = focus.vars & !covered;
				let positive = (covered & !focus.vars) | (covered_twice & focus.vars);
				let negative_capacity = uncovered.count_ones() as i32;
				let positive_capacity = covering_cells - (covered & focus.vars).count_ones() as i32;

				if focus.sum > covering_mines + negative_capacity || covering_mines > focus.sum + positive_capacity {
					return None;
				}
				if focus.sum == covering_mines + negative_capacity {
					result.mines |= uncovered;
					result.safe |= positive;
				}
				if covering_mines == focus.sum + positive_capacity {
					result.mines |= positive;
					result.safe |= uncovered;
				}

				cover = (cover - 1) & adjacent_clues;
			}
		}

		(result.mines & result.safe == 0).then_some(result)
	}
}

#[test]
fn clue_cover() {
	let mines_131 = cell(3, 1) | cell(1, 3) | cell(3, 3);
	let revealed_131 = cell(2, 1) | cell(1, 2) | cell(2, 2);
	let expected_131 = Deductions {
		mines: cell(3, 3),
		safe: cell(1, 1) |
			cell(1, 0) | cell(2, 0) | cell(3, 0) |
			cell(0, 1) | cell(0, 2) | cell(0, 3),
	};

	let mines_121 = cell(7, 3) | cell(5, 5);
	let revealed_121 = rect(6, 4, 2, 3) | cell(5, 6);
	let expected_121 = Deductions {
		mines: 0,
		safe: cell(5, 3) |
			cell(4, 5) | cell(4, 6) |
			cell(6, 7) | cell(4, 7),
	};

	let mines_covering_cells = cell(5, 0) | cell(5, 1);
	let revealed_covering_cells = cell(6, 0) | cell(7, 0);
	let expected_covering_cells = Deductions {
		mines: mines_covering_cells,
		safe: 0,
	};

	let mine_one_covering_clue = cell(0, 6);
	let revealed_one_covering_clue = cell(0, 7) | cell(1, 7);
	let expected_one_covering_clue = Deductions {
		mines: 0,
		safe: cell(2, 6) | cell(2, 7),
	};

	let mut state = GameState {
		mines: mines_131 | mines_121 | mines_covering_cells | mine_one_covering_clue,
		revealed: revealed_131 | revealed_121 | revealed_covering_cells | revealed_one_covering_clue,
		flagged: 0,
	};
	println!("{state}");

	let expected = expected_131 | expected_121 | expected_covering_cells | expected_one_covering_clue;
	let actual = state.solve_clue_cover(Deductions::default()).unwrap();
	state.apply(actual);
	println!("{state}");

	assert_eq!(actual, expected);
}
