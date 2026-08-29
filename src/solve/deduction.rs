use std::collections::HashMap;

use super::*;

/// Limits for bounded deduction proof search.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct ProofSearchConfig {
	/// Maximum assumptions in a contradiction proof, including the deliberately
	/// wrong assumption about the square being proved. Zero disables proof search.
	pub max_assumptions: u8,
	/// Number of relevance-ranked variables considered at each case split.
	/// Zero disables case splitting.
	pub candidate_limit: u8,
	/// Maximum propagated search nodes per target and assumption depth.
	/// Zero is unlimited.
	pub node_limit: u32,
}

impl Default for ProofSearchConfig {
	fn default() -> Self {
		ProofSearchConfig {
			max_assumptions: 3,
			candidate_limit: 6,
			node_limit: 100_000,
		}
	}
}

/// One next step in a bounded deduction analysis.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum DeductionStep {
	/// The easiest deductions currently available.
	Found {
		/// A natural easy-solver wave, or one focused contradiction target.
		deductions: Deductions,
		/// Zero is ordinary propagation; one is a failed literal.
		assumption_depth: u8,
		/// Whether an earlier target reached its node budget. The returned
		/// deductions remain valid, but another equally shallow hint may exist.
		budget_exhausted: bool,
	},
	/// No logically forced active cells remain.
	Complete,
	/// Forced cells remain, but bounded proof search could not derive them.
	/// The exact SAT deductions are included as a fallback hint set.
	Unresolved {
		deductions: Deductions,
		budget_exhausted: bool,
	},
}

#[derive(Copy, Clone, Default)]
struct CaseSplitCandidate {
	distance: u8,
	tightness: u32,
	index: usize,
	bit: u64,
	likely_mine: bool,
}

impl CaseSplitCandidate {
	fn priority_key(&self) -> (u8, u32, usize) {
		(self.distance, self.tightness, self.index)
	}
}

enum Propagation {
	Contradiction,
	Stable(Deductions),
}

struct ProofContext<'a, 'm> {
	field: &'a GameState,
	distances: [u8; BOARD_CELLS],
	candidate_limit: usize,
	node_limit: u32,
	visited: u32,
	budget_exhausted: bool,
	memo: &'m mut HashMap<(Deductions, u8), bool>,
}

impl ProofContext<'_, '_> {
	fn propagate(&self, mut known: Deductions) -> Propagation {
		loop {
			let Some(deductions) = self.field.easy_deduction_step(known) else {
				return Propagation::Contradiction;
			};
			if deductions.is_empty() {
				return Propagation::Stable(known);
			}
			known |= deductions;
		}
	}

	fn candidates(&self, known: Deductions) -> ([CaseSplitCandidate; BOARD_CELLS], usize) {
		let assigned = known.mines | known.safe | self.field.revealed | self.field.flagged;
		let mut candidates = [CaseSplitCandidate::default(); BOARD_CELLS];
		let mut candidate_count = 0;
		let mut variables = self.field.active() & !assigned;

		while variables != 0 {
			let bit = 1u64 << variables.trailing_zeros();
			variables &= variables - 1;
			let index = bit.trailing_zeros() as usize;
			let distance = self.distances[index];
			let mut tightness = u32::MAX;
			let mut likely_mine = false;

			for constraint in self.field.constraints(self.field.revealed, known) {
				let Some(constraint) = constraint.validate() else {
					continue;
				};
				if constraint.vars & bit == 0 {
					continue;
				}
				let variable_count = constraint.vars.count_ones();
				if variable_count < tightness {
					tightness = variable_count;
					likely_mine = constraint.sum * 2 > variable_count as i32;
				}
			}
			candidates[candidate_count] = CaseSplitCandidate { distance, tightness, index, bit, likely_mine };
			candidate_count += 1;
		}

		candidates[..candidate_count].sort_unstable_by_key(CaseSplitCandidate::priority_key);
		(candidates, candidate_count.min(self.candidate_limit))
	}

	fn prove_unsat(&mut self, known: Deductions, remaining_depth: u8) -> bool {
		if self.budget_exhausted {
			return false;
		}
		if self.node_limit != 0 && self.visited >= self.node_limit {
			self.budget_exhausted = true;
			return false;
		}
		self.visited += 1;

		let key = (known, remaining_depth);
		if let Some(&cached) = self.memo.get(&key) {
			return cached;
		}
		let Propagation::Stable(known) = self.propagate(known) else {
			self.memo.insert(key, true);
			return true;
		};
		if remaining_depth == 0 {
			self.memo.insert(key, false);
			return false;
		}

		let (candidates, candidate_count) = self.candidates(known);
		for candidate in candidates.into_iter().take(candidate_count) {
			let Some(preferred) = known.insert(candidate.bit, candidate.likely_mine) else { continue };
			if !self.prove_unsat(preferred, remaining_depth - 1) {
				continue;
			}
			let Some(other) = known.insert(candidate.bit, !candidate.likely_mine) else { continue };
			if self.prove_unsat(other, remaining_depth - 1) {
				if !self.budget_exhausted {
					self.memo.insert(key, true);
				}
				return true;
			}
		}

		if !self.budget_exhausted {
			self.memo.insert(key, false);
		}
		false
	}
}

impl GameState {
	fn easy_deduction_step(&self, known: Deductions) -> Option<Deductions> {
		if !known.is_compatible_with(self.revealed, self.flagged) {
			return None;
		}
		let local = self.solve_local(known)?;
		let mut deductions = if !local.is_empty() {
			local
		}
		else {
			self.solve_derived(known)? | self.solve_clue_cover(known)?
		};
		let assigned = known.mines | known.safe | self.revealed | self.flagged;
		deductions.mines &= !assigned;
		deductions.safe &= !assigned;
		(deductions.mines & deductions.safe == 0).then_some(deductions)
	}

	fn variable_distances(&self, target: u64, known: Deductions) -> [u8; BOARD_CELLS] {
		let mut distances = [u8::MAX; BOARD_CELLS];
		distances[target.trailing_zeros() as usize] = 0;
		let mut reached = target;
		let mut edge = target;
		let mut distance = 0u8;

		while edge != 0 {
			let mut next = 0;
			for constraint in self.constraints(self.revealed, known) {
				let Some(constraint) = constraint.validate() else {
					continue;
				};
				if constraint.vars & edge != 0 {
					next |= constraint.vars & !reached;
				}
			}
			if next == 0 {
				break;
			}
			distance = distance.saturating_add(1);
			for index in enumerate(next) {
				distances[index] = distance;
			}
			reached |= next;
			edge = next;
		}

		distances
	}

	/// Finds the easiest next deductions given the caller's accumulated knowledge.
	///
	/// Easy propagation is returned immediately at assumption depth zero. When it
	/// is stuck, the SAT solver identifies exactly forced cells and bounded proof
	/// search tries every target at depth one before proceeding to deeper proofs.
	/// Known-safe cells remain covered, so their hidden clues are never exposed.
	///
	/// Returns `None` when the visible position and `known` assignments contradict
	/// each other. Callers can repeatedly merge [`DeductionStep::Found`] results into
	/// `known` to obtain successive waves and aggregate their own difficulty score.
	pub fn next_deductions(&self, known: Deductions, config: ProofSearchConfig) -> Option<DeductionStep> {
		let easy = self.easy_deduction_step(known)?;
		if !easy.is_empty() {
			return Some(DeductionStep::Found {
				deductions: easy,
				assumption_depth: 0,
				budget_exhausted: false,
			});
		}

		let exact = self.solve_sat(known)?;
		let active = self.active() & !(known.mines | known.safe);
		let forced = Deductions {
			mines: exact.mines & active,
			safe: exact.safe & active,
		};
		if forced.is_empty() {
			return Some(DeductionStep::Complete);
		}

		let mut memo = HashMap::new();
		let mut budget_exhausted = false;
		for assumption_depth in 1..=config.max_assumptions {
			for cell in enumerate(forced.mines | forced.safe) {
				let target = 1u64 << cell;
				let is_mine = forced.mines & target != 0;
				let Some(initial) = known.insert(target, !is_mine) else {
					continue;
				};
				memo.clear();
				let mut context = ProofContext {
					field: self,
					distances: self.variable_distances(target, known),
					candidate_limit: config.candidate_limit as usize,
					node_limit: config.node_limit,
					visited: 0,
					budget_exhausted: false,
					memo: &mut memo,
				};
				if context.prove_unsat(initial, assumption_depth - 1) {
					let deductions = if is_mine {
						Deductions { mines: target, safe: 0 }
					}
					else {
						Deductions { mines: 0, safe: target }
					};
					debug_assert_eq!(deductions.mines & !exact.mines, 0);
					debug_assert_eq!(deductions.safe & !exact.safe, 0);
					return Some(DeductionStep::Found { deductions, assumption_depth, budget_exhausted });
				}
				budget_exhausted |= context.budget_exhausted;
			}
		}

		Some(DeductionStep::Unresolved { deductions: forced, budget_exhausted })
	}
}

#[test]
fn next_deductions_distinguishes_propagation_from_contradiction() {
	let direct = GameState {
		mines: cell(0, 1),
		revealed: cell(0, 0) | cell(1, 0) | cell(1, 1),
		flagged: 0,
	};
	let DeductionStep::Found { deductions, assumption_depth, budget_exhausted } =
		direct.next_deductions(Deductions::default(), ProofSearchConfig::default()).unwrap()
	else {
		panic!("expected direct deductions");
	};
	assert!(!deductions.is_empty());
	assert_eq!(assumption_depth, 0);
	assert!(!budget_exhausted);

	let split = crate::puzzle::generate_expert(0, 200).unwrap().state;
	let DeductionStep::Found { deductions, assumption_depth, .. } =
		split.next_deductions(Deductions::default(), ProofSearchConfig::default()).unwrap()
	else {
		panic!("expected contradiction deductions");
	};
	assert_eq!(deductions.count(), 1);
	assert!(assumption_depth > 0);
}

#[test]
fn next_deductions_accepts_previous_waves() {
	let state = GameState {
		mines: cell(0, 1),
		revealed: cell(0, 0) | cell(1, 0) | cell(1, 1),
		flagged: 0,
	};
	let mut known = Deductions::default();
	let mut waves = 0;
	loop {
		match state.next_deductions(known, ProofSearchConfig::default()).unwrap() {
			DeductionStep::Found { deductions, .. } => {
				assert_eq!((deductions.mines | deductions.safe) & (known.mines | known.safe), 0);
				known |= deductions;
				waves += 1;
			}
			DeductionStep::Complete => break,
			DeductionStep::Unresolved { .. } => panic!("expected the deductions to complete"),
		}
	}
	assert!(waves > 1);
}

#[test]
fn unresolved_step_contains_sat_fallback() {
	let state = crate::puzzle::generate_expert(0, 200).unwrap().state;
	let config = ProofSearchConfig { max_assumptions: 0, ..ProofSearchConfig::default() };
	let DeductionStep::Unresolved { deductions, budget_exhausted } =
		state.next_deductions(Deductions::default(), config).unwrap()
	else {
		panic!("expected unresolved SAT deductions");
	};
	assert_eq!(deductions, state.solve_sat(Deductions::default()).unwrap());
	assert!(!budget_exhausted);
}

#[test]
fn next_deductions_handles_complete_and_contradictory_positions() {
	assert_eq!(
		GameState::default().next_deductions(Deductions::default(), ProofSearchConfig::default()),
		Some(DeductionStep::Complete),
	);

	let contradictory = GameState {
		mines: 0,
		revealed: cell(0, 0),
		flagged: cell(0, 1),
	};
	assert_eq!(contradictory.next_deductions(Deductions::default(), ProofSearchConfig::default()), None);

	let direct = GameState {
		mines: cell(0, 1),
		revealed: cell(0, 0),
		flagged: 0,
	};
	let incompatible = Deductions { mines: cell(0, 0), safe: 0 };
	assert_eq!(direct.next_deductions(incompatible, ProofSearchConfig::default()), None);
}

#[test]
fn assumed_safe_square_does_not_reveal_its_clue() {
	let state = GameState {
		mines: cell(0, 1) | cell(2, 1),
		revealed: cell(1, 0),
		flagged: 0,
	};
	let known = Deductions { mines: 0, safe: cell(1, 1) };
	let deductions = state.solve_local(known).unwrap();
	assert!(deductions.is_empty());
}
