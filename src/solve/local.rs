use super::*;

impl GameState {
	/// Computes deductions from individual revealed clues.
	///
	/// A clue determines its remaining covered neighbours when they must all be
	/// mines or must all be safe.
	///
	/// `known` treats covered cells as fixed without revealing the clues of known-safe cells.
	///
	/// Returns `None` if the visible clues, flags, and known cells contradict each other.
	pub fn solve_local(&self, known: Deductions) -> Option<Deductions> {
		let mut result = Deductions::default();

		for constraint in self.constraints(self.revealed, known) {
			let constraint = constraint.validate()?;
			result |= constraint.forced();
		}

		(result.mines & result.safe == 0).then_some(result)
	}
}
