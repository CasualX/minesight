use super::*;

impl GameState {
	/// Computes mines and safe cells implied directly by revealed clues.
	/// Returns `None` if the visible clues and flags contradict each other.
	pub fn solve_local(&self) -> Option<Deductions> {
		let mut result = Deductions::default();

		for constraint in self.constraints(self.revealed) {
			let constraint = constraint?;
			result |= constraint.forced();
		}

		Some(result)
	}
}
