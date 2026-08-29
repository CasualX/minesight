use super::*;

impl GameState {
	/// Computes deductions implied by the total number of mines on the board.
	///
	/// If every mine has been flagged, all remaining squares are safe. If the
	/// number of remaining mines equals the number of unknown squares, all of
	/// those squares are mines.
	///
	/// `known` treats covered cells as fixed without revealing the clues of known-safe cells.
	///
	/// Returns `None` if the known cells contradict the total mine count.
	pub fn solve_total(&self, known: Deductions) -> Option<Deductions> {
		if !known.is_compatible_with(self.revealed, self.flagged) {
			return None;
		}

		let fixed_mines = self.flagged | known.mines;
		let unknown = !(self.revealed | fixed_mines | known.safe);
		let remaining_mines = self.count_mines().checked_sub(fixed_mines.count_ones())?;

		if remaining_mines == 0 {
			Some(Deductions {
				mines: 0,
				safe: unknown,
			})
		}
		else if remaining_mines == unknown.count_ones() {
			Some(Deductions {
				mines: unknown,
				safe: 0,
			})
		}
		else if remaining_mines < unknown.count_ones() {
			Some(Deductions::default())
		}
		else {
			None
		}
	}
}

#[test]
fn total_with_known_deductions() {
	let mine = cell(0, 0);
	let other = cell(1, 0);
	let state = GameState {
		mines: mine,
		revealed: !(mine | other),
		flagged: 0,
	};

	assert_eq!(state.solve_total(Deductions { mines: mine, safe: 0 }), Some(Deductions {
		mines: 0,
		safe: other,
	}));
	assert_eq!(state.solve_total(Deductions { mines: 0, safe: other }), Some(Deductions {
		mines: mine,
		safe: 0,
	}));
	assert_eq!(state.solve_total(Deductions { mines: mine | other, safe: 0 }), None);
}
