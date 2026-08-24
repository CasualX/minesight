
/// Values forced by a set of Boolean cardinality constraints.
#[derive(Copy, Clone, Debug, Default, Eq, PartialEq)]
pub struct Forced {
	pub one: u64,
	pub zero: u64,
}

impl Forced {
	fn merge(&mut self, other: Forced) -> Option<()> {
		self.one |= other.one;
		self.zero |= other.zero;
		(self.one & self.zero == 0).then_some(())
	}
}

#[derive(Copy, Clone, Debug, Default, Eq, PartialEq)]
struct Constraint {
	vars: u64,
	sum: u8,
}

impl Constraint {
	fn forced(self) -> Option<Forced> {
		let count = self.vars.count_ones();
		if self.sum as u32 > count {
			return None;
		}
		Some(if self.sum == 0 {
			Forced { one: 0, zero: self.vars }
		}
		else if self.sum as u32 == count {
			Forced { one: self.vars, zero: 0 }
		}
		else {
			Forced::default()
		})
	}

	fn subtract_from(self, superset: Constraint) -> Option<Forced> {
		if self.vars & !superset.vars != 0 {
			return Some(Forced::default());
		}
		Constraint {
			vars: superset.vars & !self.vars,
			sum: superset.sum.checked_sub(self.sum)?,
		}.forced()
	}

	fn extreme_difference(self, other: Constraint) -> Forced {
		let self_only = self.vars & !other.vars;
		let other_only = other.vars & !self.vars;
		if other.sum as u32 == self.sum as u32 + other_only.count_ones() {
			Forced { one: other_only, zero: self_only }
		}
		else if self.sum as u32 == other.sum as u32 + self_only.count_ones() {
			Forced { one: self_only, zero: other_only }
		}
		else {
			Forced::default()
		}
	}

	fn exact_exclusives(self, other: Constraint) -> Result<Option<[Constraint; 2]>, ()> {
		let shared = self.vars & other.vars;
		if shared == 0 {
			return Ok(None);
		}
		let self_only = self.vars & !other.vars;
		let other_only = other.vars & !self.vars;
		let min_shared = (self.sum as u32).saturating_sub(self_only.count_ones())
			.max((other.sum as u32).saturating_sub(other_only.count_ones()));
		let max_shared = shared.count_ones().min(self.sum as u32).min(other.sum as u32);
		if min_shared > max_shared {
			return Err(());
		}
		if min_shared != max_shared {
			return Ok(None);
		}
		Ok(Some([
			Constraint { vars: self_only, sum: self.sum - min_shared as u8 },
			Constraint { vars: other_only, sum: other.sum - min_shared as u8 },
		]))
	}
}

/// A set of Boolean cardinality constraints.
///
/// Each constraint has the form `(values & vars).count_ones() == sum`.
#[derive(Copy, Clone)]
pub struct State<const N: usize> {
	len: usize,
	vars: [u64; N],
	sum: [u8; N],
	all: u64,
}

#[derive(Copy, Clone, Default)]
struct Asn {
	assigned: u64,
	values: u64,
}

impl<const N: usize> State<N> {
	pub const EMPTY: State<N> = State {
		len: 0,
		vars: [0; N],
		sum: [0; N],
		all: 0,
	};

	#[inline]
	fn constraint(&self, index: usize) -> Constraint {
		Constraint { vars: self.vars[index], sum: self.sum[index] }
	}

	/// Adds a constraint unconditionally and returns its index.
	pub fn push(&mut self, vars: u64, sum: u8) -> Option<usize> {
		if self.len == N {
			return None;
		}
		let index = self.len;
		self.vars[index] = vars;
		self.sum[index] = sum;
		self.len += 1;
		self.all |= vars;
		Some(index)
	}

	fn propagate(&self, mut asn: Asn) -> Option<Asn> {
		loop {
			let before = asn.assigned;
			for index in 0..self.len {
				let constraint = self.constraint(index);
				let unknown = constraint.vars & !asn.assigned;
				let nones = (constraint.vars & asn.values).count_ones();
				let target = constraint.sum as u32;
				if nones > target {
					return None;
				}
				let remaining = target - nones;
				let nunknown = unknown.count_ones();
				if remaining > nunknown {
					return None;
				}
				if remaining == 0 {
					asn.assigned |= unknown;
				}
				else if remaining == nunknown {
					asn.assigned |= unknown;
					asn.values |= unknown;
				}
			}
			if asn.assigned == before {
				return Some(asn);
			}
		}
	}

	fn next(&self, asn: Asn) -> (u64, bool) {
		let mut next = 0;
		let mut likely = false;
		let mut best = u32::MAX;
		for index in 0..self.len {
			let constraint = self.constraint(index);
			let free = constraint.vars & !asn.assigned;
			let nfree = free.count_ones();
			if nfree == 0 || nfree >= best {
				continue;
			}
			best = nfree;
			next = 1u64 << free.trailing_zeros();
			let known = (constraint.vars & asn.values).count_ones();
			likely = (constraint.sum as u32 - known) * 2 > nfree;
		}
		(next, likely)
	}

	fn sat(&self, asn: Asn) -> Option<Asn> {
		let asn = self.propagate(asn)?;
		let (var, likely) = self.next(asn);
		if var == 0 {
			return Some(asn);
		}
		let preferred = Asn {
			values: if likely { asn.values | var } else { asn.values },
			assigned: asn.assigned | var,
		};
		if let Some(solution) = self.sat(preferred) {
			return Some(solution);
		}
		self.sat(Asn {
			values: if likely { asn.values } else { asn.values | var },
			assigned: asn.assigned | var,
		})
	}

	/// Finds every variable fixed in all satisfying assignments.
	pub fn solve(&self) -> Option<Forced> {
		let solution = self.sat(Asn::default())?;
		let mut result = Forced::default();
		let mut remaining = self.all;
		while remaining != 0 {
			let mask = 1u64 << remaining.trailing_zeros();
			remaining &= !mask;
			if self.sat(Asn { assigned: mask, values: !solution.values & mask }).is_none() {
				if solution.values & mask != 0 {
					result.one |= mask;
				}
				else {
					result.zero |= mask;
				}
			}
		}
		Some(result)
	}

	/// Applies direct and subset-subtraction deductions to all constraints.
	#[allow(dead_code)]
	pub fn solve_subset(&self) -> Option<Forced> {
		let mut result = Forced::default();
		for a_index in 0..self.len {
			let a = self.constraint(a_index);
			result.merge(a.forced()?)?;
			for b_index in a_index + 1..self.len {
				let b = self.constraint(b_index);
				result.merge(a.subtract_from(b)?)?;
				result.merge(b.subtract_from(a)?)?;
			}
		}
		Some(result)
	}

	/// Runs bounded rounds of direct, subset, extreme-difference, and derived
	/// exclusive-constraint deductions. At most `M` derived constraints are kept
	/// in fixed scratch storage.
	pub fn solve_derived<const M: usize>(&self, depth: usize) -> Option<Forced> {
		let mut derived_constraints = [Constraint { vars: 0, sum: 0 }; M];
		let mut derived_len = 0;
		let mut result = Forced::default();

		for round in 0..=depth {
			let len = self.len + derived_len;
			for a_index in 0..len {
				let a = self.constraint_with_derived(&derived_constraints, a_index);
				result.merge(a.forced()?)?;
				for b_index in a_index + 1..len {
					let b = self.constraint_with_derived(&derived_constraints, b_index);
					if a.vars & b.vars == 0 {
						continue;
					}
					result.merge(a.subtract_from(b)?)?;
					result.merge(b.subtract_from(a)?)?;
					result.merge(a.extreme_difference(b))?;
					if let Some(derived) = a.exact_exclusives(b).ok()? && round < depth {
						for constraint in derived {
							self.add_derived(&mut derived_constraints, &mut derived_len, constraint)?;
						}
					}
				}
			}
		}
		Some(result)
	}

	#[inline]
	fn constraint_with_derived<const M: usize>(&self, derived: &[Constraint; M], index: usize) -> Constraint {
		if index < self.len {
			self.constraint(index)
		}
		else {
			derived[index - self.len]
		}
	}

	fn add_derived<const M: usize>(&self, derived: &mut [Constraint; M], derived_len: &mut usize, constraint: Constraint) -> Option<()> {
		constraint.forced()?;
		if constraint.vars == 0 {
			return (constraint.sum == 0).then_some(());
		}
		for index in 0..self.len {
			let existing = self.constraint(index);
			if existing.vars == constraint.vars {
				return (existing.sum == constraint.sum).then_some(());
			}
		}
		if let Some(existing) = derived[..*derived_len].iter().find(|item| item.vars == constraint.vars) {
			return (existing.sum == constraint.sum).then_some(());
		}
		if *derived_len < M {
			derived[*derived_len] = constraint;
			*derived_len += 1;
		}
		Some(())
	}
}

#[test]
fn exact_solver() {
	let mut state: State<3> = State::EMPTY;
	assert!(state.push(0b011, 1).is_some());
	assert!(state.push(0b111, 2).is_some());
	assert!(state.push(0b110, 1).is_some());
	assert_eq!(state.solve(), Some(Forced { one: 0b101, zero: 0b010 }));
}

#[test]
fn subset_solver() {
	let mut state: State<2> = State::EMPTY;
	assert!(state.push(0b111, 2).is_some());
	assert!(state.push(0b011, 1).is_some());
	assert_eq!(state.solve_subset(), Some(Forced { one: 0b100, zero: 0 }));
}

#[test]
fn derived_solver_depth_is_bounded() {
	let mut state: State<4> = State::EMPTY;
	assert!(state.push(0b0001111, 2).is_some());
	assert!(state.push(0b0000011, 1).is_some());
	assert!(state.push(0b0111100, 2).is_some());
	assert!(state.push(0b1110000, 1).is_some());

	// First derive bits 2..=3 = 1, then bits 4..=5 = 1. Only the
	// second derivation round lets the final subset rule force bit 6.
	assert_eq!(state.solve_derived::<256>(1), Some(Forced::default()));
	assert_eq!(state.solve_derived::<256>(2), Some(Forced { one: 0, zero: 0b1000000 }));
}

#[test]
fn duplicate_conflict_is_checked_at_solve_time() {
	let mut state: State<2> = State::EMPTY;
	assert!(state.push(0b11, 0).is_some());
	assert!(state.push(0b11, 1).is_some());
	assert_eq!(state.solve(), None);
	assert_eq!(state.solve_subset(), None);
}

#[test]
fn invalid_constraint_is_checked_at_solve_time() {
	let mut state: State<1> = State::EMPTY;
	assert!(state.push(0b1, 2).is_some());
	assert_eq!(state.solve(), None);
	assert_eq!(state.solve_subset(), None);
	assert_eq!(state.solve_derived::<256>(2), None);
}
