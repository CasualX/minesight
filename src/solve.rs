use super::*;

mod clue_cover;
mod local;
mod overlap;
mod subset;
mod total;

#[derive(Copy, Clone, Debug, Default, Eq, PartialEq)]
struct Constraint {
	index: usize,
	vars: u64,
	sum: u32,
}

impl Constraint {
	fn from_clue(state: &GameState, index: usize) -> Option<Constraint> {
		let neighbours = NEIGHBOURS[index];
		let vars = neighbours & !state.revealed & !state.flagged;
		let clue = (state.mines & neighbours).count_ones();
		let flagged = (state.flagged & neighbours).count_ones();
		let sum = clue.checked_sub(flagged)?;
		(sum <= vars.count_ones()).then_some(Constraint { index, vars, sum })
	}

	fn forced(self) -> Deductions {
		if self.sum == 0 {
			Deductions { always_mine: 0, always_safe: self.vars }
		}
		else if self.sum == self.vars.count_ones() {
			Deductions { always_mine: self.vars, always_safe: 0 }
		}
		else {
			Deductions::default()
		}
	}

	fn subtract_from(self, superset: Constraint) -> Option<Deductions> {
		if self.vars & !superset.vars != 0 {
			return Some(Deductions::default());
		}

		let difference = Constraint {
			index: superset.index,
			vars: superset.vars & !self.vars,
			sum: superset.sum.checked_sub(self.sum)?,
		};
		(difference.sum <= difference.vars.count_ones()).then(|| difference.forced())
	}

	fn extreme_difference(self, other: Constraint) -> Deductions {
		let self_only = self.vars & !other.vars;
		let other_only = other.vars & !self.vars;
		if other.sum == self.sum + other_only.count_ones() {
			Deductions { always_mine: other_only, always_safe: self_only }
		}
		else if self.sum == other.sum + self_only.count_ones() {
			Deductions { always_mine: self_only, always_safe: other_only }
		}
		else {
			Deductions::default()
		}
	}
}

impl GameState {
	fn constraints(&self, clues: u64) -> impl Iterator<Item = Option<Constraint>> + '_ {
		enumerate(clues & self.revealed).map(|index| Constraint::from_clue(self, index))
	}
}

#[cfg(test)]
const fn cell(x: u32, y: u32) -> u64 {
	1u64 << (y * 8 + x)
}

#[cfg(test)]
fn rect(x: u32, y: u32, w: u32, h: u32) -> u64 {
	let mut result = 0;
	for dy in 0..h {
		for dx in 0..w {
			result |= cell(x + dx, y + dy);
		}
	}
	result
}

#[test]
fn solver_contradiction() {
	let state = GameState {
		mines: 0,
		revealed: cell(0, 0),
		flagged: cell(0, 1),
	};

	assert_eq!(state.solve(), None);
	assert_eq!(state.solve_total(), None);
	assert_eq!(state.solve_local(), None);
	assert_eq!(state.solve_subset(), None);
	assert_eq!(state.solve_overlap(false), None);
	assert_eq!(state.solve_clue_cover(), None);
	assert_eq!(state.solve_derived(), None);
	assert_eq!(state.solve_sat(), None);
}
