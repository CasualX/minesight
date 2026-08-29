use super::*;

mod clue_cover;
mod local;
mod overlap;
mod subset;
mod total;
mod deduction;
pub use self::deduction::*;

#[derive(Copy, Clone, Debug, Default, Eq, PartialEq)]
pub struct Constraint {
	pub index: usize,
	pub vars: u64,
	pub sum: i32,
}

impl Constraint {
	fn from_clue(state: &GameState, index: usize, known: Deductions) -> Constraint {
		let neighbours = NEIGHBOURS[index];
		let fixed_mines = state.flagged | known.mines;
		let fixed = state.revealed | fixed_mines | known.safe;
		let vars = neighbours & !fixed;
		let clue = (state.mines & neighbours).count_ones() as i32;
		let flagged = (fixed_mines & neighbours).count_ones() as i32;
		Constraint { index, vars, sum: clue - flagged }
	}

	pub fn validate(self) -> Option<Self> {
		(self.sum >= 0 && self.sum <= self.vars.count_ones() as i32).then_some(self)
	}

	fn forced(self) -> Deductions {
		if self.sum == 0 {
			Deductions { mines: 0, safe: self.vars }
		}
		else if self.sum == self.vars.count_ones() as i32 {
			Deductions { mines: self.vars, safe: 0 }
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
			sum: superset.sum - self.sum,
		};
		Some(difference.validate()?.forced())
	}

	fn extreme_difference(self, other: Constraint) -> Deductions {
		let self_only = self.vars & !other.vars;
		let other_only = other.vars & !self.vars;
		if other.sum == self.sum + other_only.count_ones() as i32 {
			Deductions { mines: other_only, safe: self_only }
		}
		else if self.sum == other.sum + self_only.count_ones() as i32 {
			Deductions { mines: self_only, safe: other_only }
		}
		else {
			Deductions::default()
		}
	}
}

impl GameState {
	pub fn constraints(&self, clues: u64, known: Deductions) -> impl Iterator<Item = Constraint> + '_ {
		enumerate(clues & self.revealed).map(move |index| Constraint::from_clue(self, index, known))
	}
}

#[test]
fn constraint_validation() {
	assert_eq!(Constraint { index: 0, vars: 0, sum: -1 }.validate(), None);
	assert_eq!(Constraint { index: 0, vars: 0, sum: 1 }.validate(), None);
	assert_eq!(Constraint { index: 0, vars: 0, sum: 0 }.validate(), Some(Constraint { index: 0, vars: 0, sum: 0 }));
	assert_eq!(Constraint { index: 0, vars: 1, sum: 1 }.validate(), Some(Constraint { index: 0, vars: 1, sum: 1 }));
}

#[test]
fn solver_contradiction() {
	let state = GameState {
		mines: 0,
		revealed: cell(0, 0),
		flagged: cell(0, 1),
	};

	assert_eq!(state.solve(Deductions::default()), None);
	assert_eq!(state.solve_total(Deductions::default()), None);
	assert_eq!(state.solve_local(Deductions::default()), None);
	assert_eq!(state.solve_subset(Deductions::default()), None);
	assert_eq!(state.solve_overlap(Deductions::default(), false), None);
	assert_eq!(state.solve_clue_cover(Deductions::default()), None);
	assert_eq!(state.solve_derived(Deductions::default()), None);
	assert_eq!(state.solve_sat(Deductions::default()), None);
}
