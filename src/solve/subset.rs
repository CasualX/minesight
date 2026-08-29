use super::*;

impl GameState {
	/// Computes deductions obtained by subtracting overlapping clue constraints.
	///
	/// For example, if one clue requires one mine in `{a, b}` and another requires one mine in `{a, b, c}`, then `c` is safe.
	/// Direct local deductions are included, making this solver strictly more capable than [`GameState::solve_local`].
	///
	/// `known` treats covered cells as fixed without revealing the clues of known-safe cells.
	///
	/// Returns `None` if the visible clues, flags, and known cells contradict each other.
	pub fn solve_subset(&self, known: Deductions) -> Option<Deductions> {
		let mut result = Deductions::default();

		for a in self.constraints(self.revealed, known) {
			let a = a.validate()?;
			result |= a.forced();

			let later_clues = self.revealed & (!0u64 << a.index) & !(1u64 << a.index);
			for b in self.constraints(later_clues, known) {
				let b = b.validate()?;
				let a_difference = a.subtract_from(b)?;
				let b_difference = b.subtract_from(a)?;
				result |= a_difference | b_difference;
			}
		}

		(result.mines & result.safe == 0).then_some(result)
	}
}

#[test]
fn subset() {
	let revealed = cell(0, 0) | cell(1, 0);

	let safe_difference = GameState {
		mines: cell(0, 1),
		revealed,
		flagged: 0,
	};
	assert_eq!(safe_difference.solve_subset(Deductions::default()), Some(Deductions {
		mines: 0,
		safe: cell(2, 0) | cell(2, 1),
	}));
	assert_eq!(safe_difference.solve_subset(Deductions { mines: 0, safe: cell(2, 0) }), Some(Deductions {
		mines: 0,
		safe: cell(2, 1),
	}));

	let mined_difference = GameState {
		mines: cell(0, 1) | cell(2, 0) | cell(2, 1),
		revealed,
		flagged: 0,
	};
	assert_eq!(mined_difference.solve_subset(Deductions::default()), Some(Deductions {
		mines: cell(2, 0) | cell(2, 1),
		safe: 0,
	}));
	assert_eq!(mined_difference.solve_subset(Deductions { mines: cell(2, 0), safe: 0 }), Some(Deductions {
		mines: cell(2, 1),
		safe: 0,
	}));
}
