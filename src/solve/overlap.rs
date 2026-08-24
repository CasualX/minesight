use super::*;

impl GameState {
	/// Computes deductions by subtracting overlapping frontier-clue constraints.
	///
	/// For constraints `A` and `B`, their shared cells cancel:
	///
	/// ```text
	/// mines(B-only) - mines(A-only) = remaining(B) - remaining(A)
	/// ```
	///
	/// If this difference reaches either possible extreme, every cell in both
	/// exclusive groups is determined. Only clues touching the current unflagged
	/// frontier are considered.
	///
	/// When `extended_vision` is false, each clue is compared with its geometrically
	/// adjacent clues. When it is true, clues up to two squares apart are compared
	/// by also searching the neighbours of each neighbouring cell. The extended
	/// search includes every pair considered by the adjacent-only search.
	/// Returns `None` if the considered clues and flags contradict each other.
	pub fn solve_overlap(&self, extended_vision: bool) -> Option<Deductions> {
		let active = self.active();
		if active == 0 {
			return Some(Deductions::default());
		}

		let clues = neighbours(active) & self.revealed;
		let mut result = Deductions::default();

		for a in self.constraints(clues) {
			let a = a?;
			let partners = if extended_vision {
				neighbours(NEIGHBOURS[a.index])
			}
			else {
				NEIGHBOURS[a.index]
			};

			for b in self.constraints(partners & clues) {
				let b = b?;
				if b.index <= a.index {
					continue;
				}
				result |= a.extreme_difference(b);
			}
		}

		(result.always_mine & result.always_safe == 0).then_some(result)
	}
}

#[test]
fn overlap() {
	let mines_equal_clues = cell(0, 1);
	let revealed_equal_clues = cell(0, 0) | cell(1, 0);
	let expected_equal_clues = Deductions {
		always_mine: 0,
		always_safe: cell(2, 0) | cell(2, 1),
	};

	let mines_121 = cell(3, 1) | cell(5, 1);
	let revealed_121 = cell(3, 0) | cell(4, 0) | cell(5, 0);
	let expected_121 = Deductions {
		always_mine: mines_121,
		always_safe: cell(2, 0) | cell(2, 1) | cell(6, 0) | cell(6, 1),
	};

	let mines_differing_clues = cell(5, 6) | cell(6, 6) | cell(5, 7);
	let revealed_differing_clues = cell(6, 7) | cell(7, 7);
	let expected_differing_clues = Deductions {
		always_mine: cell(5, 6) | cell(5, 7),
		always_safe: 0,
	};

	let mut state = GameState {
		mines: mines_equal_clues | mines_121 | mines_differing_clues,
		revealed: revealed_equal_clues | revealed_121 | revealed_differing_clues,
		flagged: 0,
	};
	println!("{state}");

	let expected = expected_equal_clues | expected_121 | expected_differing_clues;
	let actual = state.solve_overlap(false).unwrap();
	state.apply(actual);
	println!("{state}");

	assert_eq!(actual, expected);
}

#[test]
fn extended_overlap() {
	let mines_left = cell(0, 1);
	let revealed_left = cell(0, 0) | cell(2, 0);
	let expected_left = Deductions {
		always_mine: mines_left,
		always_safe: cell(3, 0) | cell(2, 1) | cell(3, 1),
	};

	let mines_right = cell(7, 6);
	let revealed_right = cell(5, 7) | cell(7, 7);
	let expected_right = Deductions {
		always_mine: mines_right,
		always_safe: cell(4, 6) | cell(5, 6) | cell(4, 7),
	};

	let mut state = GameState {
		mines: mines_left | mines_right,
		revealed: revealed_left | revealed_right,
		flagged: 0,
	};
	println!("{state}");

	let expected = expected_left | expected_right;
	assert_eq!(state.solve_overlap(false), Some(Deductions::default()));
	let actual = state.solve_overlap(true).unwrap();
	state.apply(actual);
	println!("{state}");

	assert_eq!(actual, expected);
}
