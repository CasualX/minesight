use super::*;

impl GameState {
	/// Computes deductions implied by the total number of mines on the board.
	///
	/// If every mine has been flagged, all remaining squares are safe. If the
	/// number of remaining mines equals the number of unknown squares, all of
	/// those squares are mines.
	/// Returns `None` if the known cells contradict the total mine count.
	pub fn solve_total(&self) -> Option<Deductions> {
		let unknown = !(self.revealed | self.flagged);
		let remaining_mines = self.count_mines().checked_sub(self.flagged.count_ones())?;

		if remaining_mines == 0 {
			Some(Deductions {
				always_mine: 0,
				always_safe: unknown,
			})
		}
		else if remaining_mines == unknown.count_ones() {
			Some(Deductions {
				always_mine: unknown,
				always_safe: 0,
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
