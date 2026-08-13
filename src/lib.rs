use std::{fmt, ops};

//----------------------------------------------------------------

/// Precomputed neighbour masks.
///
/// For every cell, contains a mask of the neighbouring cells (excluding itself).
static NEIGHBOURS: [u64; 64] = {
	const fn bit(x: i8, y: i8) -> u64 {
		if x < 0 || x >= 8 {
			return 0;
		}
		if y < 0 || y >= 8 {
			return 0;
		}
		let i = y as u32 * 8 + x as u32;
		1u64 << i
	}
	let mut neighs = [0u64; 64];
	let mut iter = grid();
	while let Some((i, x, y)) = iter.next() {
		neighs[i] =
			bit(x - 1, y - 1) | bit(x, y - 1) | bit(x + 1, y - 1) |
			bit(x - 1, y) | bit(x + 1, y) |
			bit(x - 1, y + 1) | bit(x, y + 1) | bit(x + 1, y + 1);
	}
	neighs
};

#[inline]
const fn index(x: i8, y: i8) -> Option<u32> {
	if x < 0 || x >= 8 {
		return None;
	}
	if y < 0 || y >= 8 {
		return None;
	}
	Some(y as u32 * 8 + x as u32)
}

#[inline]
const fn clue(mines: u64, x: i8, y: i8) -> u8 {
	if x < 0 || x >= 8 {
		return 0;
	}
	if y < 0 || y >= 8 {
		return 0;
	}
	let i = y as usize * 8 + x as usize;
	(mines & NEIGHBOURS[i]).count_ones() as u8
}

/// Returns all cells neighbouring any bit in `cells`.
#[inline]
fn neighbours(cells: u64) -> u64 {
	let mut result = 0;

	for i in enumerate(cells) {
		result |= NEIGHBOURS[i];
	}

	result
}

/// Returns `cells` together with all of their neighbours.
#[inline]
fn expand(cells: u64) -> u64 {
	neighbours(cells) | cells
}

/// Returns a bitmask of all safe squares with no neighbouring mines.
#[inline]
fn empty_squares(mines: u64) -> u64 {
	!expand(mines)
}

/// Returns a bitmask of the empty squares and their neighbouring squares.
///
/// This is the area that can be revealed initially without exposing a mine.
#[inline]
fn initial_reveal(mines: u64) -> u64 {
	expand(!expand(mines))
}

cfg_select! {
	all(target_arch = "x86_64", target_feature = "bmi2") => {
		#[inline]
		fn deposit(value: u64, mask: u64) -> u64 {
			unsafe { std::arch::x86_64::_pdep_u64(value, mask) }
		}
	}
	all(target_arch = "x86", target_feature = "bmi2") => {
		#[inline]
		fn deposit(value: u64, mask: u64) -> u64 {
			let low_mask = mask as u32;
			let high_mask = (mask >> 32) as u32;
			let high_value = (value >> low_mask.count_ones()) as u32;

			let low = unsafe { std::arch::x86::_pdep_u32(value as u32, low_mask) };
			let high = unsafe { std::arch::x86::_pdep_u32(high_value, high_mask) };
			low as u64 | (high as u64) << 32
		}
	}
	_ => {
		#[inline]
		const fn deposit(mut value: u64, mut mask: u64) -> u64 {
			let mut result = 0u64;

			while mask != 0 {
				let dst = mask & mask.wrapping_neg(); // lowest set bit of mask

				if value & 1 != 0 {
					result |= dst;
				}

				value >>= 1;
				mask &= mask - 1;
			}

			result
		}
	}
}

struct BitIndices(u64);

impl Iterator for BitIndices {
	type Item = usize;

	#[inline]
	fn next(&mut self) -> Option<Self::Item> {
		if self.0 == 0 {
			return None;
		}

		let index = self.0.trailing_zeros() as usize;
		self.0 &= self.0 - 1;
		Some(index)
	}
}

#[inline]
const fn enumerate(bits: u64) -> BitIndices {
	BitIndices(bits)
}

struct GridIterator(u8);

impl GridIterator {
	const fn next(&mut self) -> Option<(usize, i8, i8)> {
		if self.0 >= 64 {
			return None;
		}

		let i = self.0;
		self.0 += 1;
		Some((i as usize, (i & 7) as i8, (i >> 3) as i8))
	}
}

impl Iterator for GridIterator {
	type Item = (usize, i8, i8);

	#[inline]
	fn next(&mut self) -> Option<Self::Item> {
		GridIterator::next(self)
	}
}

#[inline]
const fn grid() -> GridIterator {
	GridIterator(0)
}

//----------------------------------------------------------------

/// Game over reason.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum GameOverReason {
	/// A mine is revealed.
	Detonation,
	/// All safe squares are revealed.
	Cleared,
}

/// Fixed-point mine-probability gradient used for random board generation.
///
/// `density` is the probability numerator at (`center_x`, `center_y`).
/// `direction_x` and `direction_y` are the changes in the probability numerator
/// for moving one square along the x and y axes respectively. Values use 16
/// fractional bits, so [`Gradient::DENOMINATOR`] represents one.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct Gradient {
	pub center_x: i32,
	pub center_y: i32,
	pub density: i32,
	pub direction_x: i32,
	pub direction_y: i32,
}

impl Gradient {
	/// Fixed-point value representing a probability of one.
	pub const DENOMINATOR: i32 = 1i32 << u16::BITS;

	pub const fn new(center_x: i32, center_y: i32, density: i32, direction_x: i32, direction_y: i32) -> Gradient {
		Gradient { center_x, center_y, density, direction_x, direction_y }
	}

	/// Creates a gradient crossing the central portion of the board.
	///
	/// `density_step` is the dominant probability change per square and must be non-negative.
	pub fn random<R: urandom::Rng>(rng: &mut urandom::Random<R>, density: i32, density_step: i32) -> Gradient {
		assert!(density_step >= 0, "density step must be non-negative");
		let center_x = rng.uniform(2..=5);
		let center_y = rng.uniform(2..=5);
		let secondary = rng.uniform(-density_step..=density_step);
		let (direction_x, direction_y) = match rng.uniform(0..4) {
			0 => (density_step, secondary),
			1 => (-density_step, secondary),
			2 => (secondary, density_step),
			_ => (secondary, -density_step),
		};
		Gradient { center_x, center_y, density, direction_x, direction_y }
	}

	/// Returns this square's unsigned fixed-point mine probability.
	pub fn density_at(&self, x: i8, y: i8) -> u32 {
		let density = self.density +
			(x as i32 - self.center_x) * self.direction_x +
			(y as i32 - self.center_y) * self.direction_y;
		density.clamp(0, Self::DENOMINATOR) as u32
	}
}

#[derive(Copy, Clone, Debug, Default, Eq, PartialEq)]
pub struct Deductions {
	pub always_mine: u64,
	pub always_safe: u64,
}

impl Deductions {
	#[inline]
	pub const fn is_empty(&self) -> bool {
		self.always_mine | self.always_safe == 0
	}
}

impl ops::BitOr<Deductions> for Deductions {
	type Output = Deductions;

	#[inline]
	fn bitor(self, rhs: Deductions) -> Self::Output {
		Deductions {
			always_mine: self.always_mine | rhs.always_mine,
			always_safe: self.always_safe | rhs.always_safe,
		}
	}
}

impl ops::BitOrAssign<Deductions> for Deductions {
	#[inline]
	fn bitor_assign(&mut self, rhs: Deductions) {
		self.always_mine |= rhs.always_mine;
		self.always_safe |= rhs.always_safe;
	}
}

#[derive(Copy, Clone, Default)]
struct Constraint {
	cells: u64,
	mines: u32,
}

impl Constraint {
	/// Applies the information gained by subtracting this constraint from a constraint that contains it.
	fn subtract_from(self, superset: Constraint, result: &mut Deductions) -> bool {
		if self.cells & !superset.cells != 0 {
			return true;
		}

		let Some(mines) = superset.mines.checked_sub(self.mines) else {
			return false;
		};
		let cells = superset.cells & !self.cells;
		let count = cells.count_ones();

		if mines > count {
			return false;
		}
		if mines == 0 {
			result.always_safe |= cells;
		}
		else if mines == count {
			result.always_mine |= cells;
		}

		true
	}
}

//----------------------------------------------------------------

/// Minesweeper game state.
///
/// The board is a fixed 8x8 for performance reasons.
#[derive(Copy, Clone, Default)]
pub struct GameState {
	mines: u64,
	revealed: u64,
	flagged: u64,
}

impl fmt::Display for GameState {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str("┌─────────────────┐\n")?;
		let nmines = self.count_mines() as i32 - self.flagged.count_ones() as i32;
		writeln!(f, "│ MINES: {nmines: <8} │")?;
		f.write_str("├─────────────────┤\n")?;
		for (i, x, y) in grid() {
			if x == 0 {
				f.write_str("│")?;
			}

			let i_mask = 1u64 << i;
			if self.revealed & i_mask != 0 {
				if self.mines & i_mask != 0 {
					f.write_str(" *")?;
				}
				else {
					let n = self.clue(x, y);
					if n == 0 {
						f.write_str(" ·")?;
					}
					else {
						write!(f, " {n}")?;
					}
				}
			}
			else if self.flagged & i_mask != 0 {
				f.write_str(" ⚑")?;
			}
			else {
				f.write_str(" ■")?;
			}

			if x == 7 {
				f.write_str(" │\n")?;
			}
		}
		f.write_str("└─────────────────┘")?;
		Ok(())
	}
}

impl GameState {
	/// Creates a new empty gamestate with no mines.
	pub const fn new() -> GameState {
		GameState {
			mines: 0,
			revealed: 0,
			flagged: 0,
		}
	}
	/// Generates a deterministic random board using the given density gradient.
	pub fn random(seed: u64, gradient: &Gradient) -> GameState {
		let mut rng = urandom::seeded(seed);
		let mut mines = 0u64;
		for (i, x, y) in grid() {
			if u32::from(rng.random::<u16>()) < gradient.density_at(x, y) {
				mines |= 1u64 << i;
			}
		}
		let revealed = initial_reveal(mines);
		let flagged = 0;
		GameState {
			mines,
			revealed,
			flagged,
		}
	}
}

impl GameState {
	/// Returns whether the game is over.
	#[inline]
	pub fn is_game_over(&self) -> Option<GameOverReason> {
		if self.mines & self.revealed != 0 {
			return Some(GameOverReason::Detonation);
		}
		if !self.revealed == self.mines {
			return Some(GameOverReason::Cleared);
		}
		None
	}
	/// Counts the total number of mines.
	#[inline]
	pub fn count_mines(&self) -> u32 {
		self.mines.count_ones()
	}
	/// Returns whether the given square has been revealed.
	#[inline]
	pub fn is_revealed(&self, x: i8, y: i8) -> bool {
		let Some(i) = index(x, y) else {
			return false;
		};
		self.revealed & (1u64 << i) != 0
	}
	/// Returns whether the given square has been flagged.
	#[inline]
	pub fn is_flagged(&self, x: i8, y: i8) -> bool {
		let Some(i) = index(x, y) else {
			return false;
		};
		self.flagged & (1u64 << i) != 0
	}
	/// Returns the clue for this tile, ignoring if there's a mine here.
	#[inline]
	pub fn clue(&self, x: i8, y: i8) -> u8 {
		clue(self.mines, x, y)
	}
	/// Reveals the given square.
	#[inline]
	pub fn reveal(&mut self, x: i8, y: i8) {
		let Some(i) = index(x, y) else {
			return;
		};
		self.chord(i);
	}
	/// Magic wand reveals or flags a square safely.
	///
	/// Returns true if the wand was used successfully.
	pub fn wand(&mut self, x: i8, y: i8) -> bool {
		let Some(i) = index(x, y) else {
			return false
		};
		let i_mask = 1u64 << i;
		if (self.revealed | self.flagged) & i_mask != 0 {
			return false;
		}
		if self.mines & i_mask != 0 {
			self.flagged |= i_mask;
		}
		else {
			self.chord(i);
		}
		true
	}
	/// Flags the given square.
	pub fn flag(&mut self, x: i8, y: i8) {
		let Some(i) = index(x, y) else {
			return
		};
		let i_mask = 1u64 << i;
		if self.revealed & i_mask == 0 {
			self.flagged ^= i_mask;
		}
		else {
			self.chord(i);
		}
	}
	/// Reveals a square, or its unflagged neighbours when its clue is satisfied.
	fn chord(&mut self, i: u32) {
		let i_mask = 1u64 << i;
		if self.flagged & i_mask != 0 {
			return;
		}

		let mut squares = i_mask;
		if self.revealed & i_mask != 0 {
			let neighbours = NEIGHBOURS[i as usize];
			let clue = (self.mines & neighbours).count_ones();
			if (self.flagged & neighbours).count_ones() != clue {
				return;
			}

			squares = neighbours & !self.revealed & !self.flagged;
		}

		self.revealed |= squares;
		// A bad chord may contain both a mine and an empty square. Detonation
		// ends the action before that empty square can flood-fill the board.
		if self.mines & squares != 0 {
			return;
		}

		let empty = empty_squares(self.mines);
		let mut region = squares & empty;
		let mut edge = region;

		while edge != 0 {
			edge = neighbours(edge) & empty & !region;
			region |= edge;
		}

		self.revealed |= expand(region) & !self.flagged;
	}
	/// Returns the unrevealed squares adjacent to the revealed area.
	///
	/// This geometric frontier may include flagged squares.
	/// Solver candidate masks must exclude them.
	#[inline]
	pub fn frontier(&self) -> u64 {
		neighbours(self.revealed) & !self.revealed
	}
	/// Returns the unrevealed squares just beyond the frontier.
	///
	/// These squares neighbour the frontier, but are neither revealed nor part of the frontier themselves.
	/// Like [`GameState::frontier`], this geometric mask may include flagged squares.
	#[inline]
	pub fn outer_frontier(&self) -> u64 {
		let frontier = self.frontier();
		neighbours(frontier) & !self.revealed & !frontier
	}
	/// Checks whether a complete assignment of the frontier is possible.
	///
	/// Set bits in `guess` are mines; other unflagged frontier cells are safe.
	/// Flagged squares are fixed mines, while cells beyond the frontier may contain
	/// any mines needed to reach the board's total mine count.
	#[inline]
	pub fn check_guess(&self, guess: u64) -> bool {
		let frontier = self.frontier() & !self.flagged;
		self.check_frontier_assignment(guess, frontier)
	}
	fn check_frontier_assignment(&self, guess: u64, frontier: u64) -> bool {
		if guess & !frontier != 0 {
			return false;
		}

		let hypothetical_mines = guess | self.flagged;
		let total = self.count_mines();
		let placed = hypothetical_mines.count_ones();

		if placed > total {
			return false;
		}

		let outside = !(self.revealed | self.flagged | frontier);
		if total - placed > outside.count_ones() {
			return false;
		}

		for i in enumerate(self.revealed) {
			let neighs = NEIGHBOURS[i];
			let clue = (self.mines & neighs).count_ones();

			if (hypothetical_mines & neighs).count_ones() != clue {
				return false;
			}
		}

		true
	}
}

impl GameState {
	/// Applies the deductions of a solver to the board.
	pub fn apply(&mut self, result: Deductions) {
		self.revealed |= result.always_safe;
		self.flagged |= result.always_mine;
	}
	/// Computes deductions implied by the total number of mines on the board.
	///
	/// If every mine has been flagged, all remaining squares are safe. If the
	/// number of remaining mines equals the number of unknown squares, all of
	/// those squares are mines.
	pub fn solve_total(&self) -> Deductions {
		let unknown = !(self.revealed | self.flagged);
		let Some(remaining_mines) = self.count_mines().checked_sub(self.flagged.count_ones()) else {
			return Deductions::default();
		};

		if remaining_mines == 0 {
			Deductions {
				always_mine: 0,
				always_safe: unknown,
			}
		}
		else if remaining_mines == unknown.count_ones() {
			Deductions {
				always_mine: unknown,
				always_safe: 0,
			}
		}
		else {
			Deductions::default()
		}
	}
	/// Computes all exact deductions available from the current state.
	///
	/// This composes revealed-clue constraints with the total mine count. Callers
	/// must apply the result and call this method again to continue solving.
	pub fn solve(&self) -> Deductions {
		self.solve_exact()
	}
	/// Computes mines and safe cells implied directly by revealed clues.
	pub fn solve_local(&self) -> Deductions {
		let mut always_mine = 0;
		let mut always_safe = 0;

		for i in enumerate(self.revealed) {
			let n_mask = NEIGHBOURS[i];

			let unknown = n_mask & !self.revealed & !self.flagged;
			let clue = (self.mines & n_mask).count_ones();
			let flagged = (self.flagged & n_mask).count_ones();

			if flagged == clue {
				always_safe |= unknown;
			}
			else if flagged < clue && clue - flagged == unknown.count_ones() {
				always_mine |= unknown;
			}
		}

		Deductions {
			always_mine,
			always_safe,
		}
	}
	/// Computes deductions obtained by subtracting overlapping clue constraints.
	///
	/// For example, if one clue requires one mine in `{a, b}` and another requires one mine in `{a, b, c}`, then `c` is safe.
	/// Direct local deductions are included, making this solver strictly more capable than [`GameState::solve_local`].
	pub fn solve_subset(&self) -> Deductions {
		let mut constraints = [Constraint::default(); 64];
		let mut len = 0;

		for i in enumerate(self.revealed) {
			let neighbours = NEIGHBOURS[i];
			let cells = neighbours & !self.revealed & !self.flagged;
			let clue = (self.mines & neighbours).count_ones();
			let flagged = (self.flagged & neighbours).count_ones();
			let Some(mines) = clue.checked_sub(flagged) else {
				return Deductions::default();
			};

			if mines > cells.count_ones() {
				return Deductions::default();
			}

			constraints[len] = Constraint { cells, mines };
			len += 1;
		}

		let mut result = Deductions::default();
		for a in 0..len {
			// Subtracting the empty constraint gives the ordinary local rules.
			if !Constraint::default().subtract_from(constraints[a], &mut result) {
				return Deductions::default();
			}

			for b in a + 1..len {
				if !constraints[a].subtract_from(constraints[b], &mut result) ||
					!constraints[b].subtract_from(constraints[a], &mut result)
				{
					return Deductions::default();
				}
			}
		}

		// Conflicting deductions mean the visible state has no solution under
		// the current flags. Match the exact solver by returning no moves.
		if result.always_mine & result.always_safe != 0 {
			return Deductions::default();
		}

		result
	}
	/// Computes deductions by exhaustively enumerating the frontier against the
	/// revealed clues and total mine count.
	pub fn solve_exact(&self) -> Deductions {
		// Flags are fixed mines, not variables to enumerate.
		let frontier = self.frontier() & !self.flagged;
		let outside = !(self.revealed | self.flagged | frontier);
		let outside_count = outside.count_ones();
		let n = frontier.count_ones();

		let mut always_mine = frontier | outside;
		let mut always_safe = frontier | outside;
		let mut valid = 0;

		for i in 0..(1u64 << n) {
			let guess = deposit(i, frontier);

			if self.check_frontier_assignment(guess, frontier) {
				valid += 1;

				let placed = (guess | self.flagged).count_ones();
				let remaining = self.count_mines() - placed;
				let outside_mines = if remaining == outside_count { outside } else { 0 };
				let outside_safe = if remaining == 0 { outside } else { 0 };

				// Outside cells are interchangeable because they touch no revealed clue.
				// Unless all or none of them must be mines,
				// no individual outside cell is certain for this frontier assignment.
				always_mine &= guess | outside_mines;
				always_safe &= (frontier & !guess) | outside_safe;
			}
		}

		if valid == 0 {
			// contradictory state; no valid solution exists
			return Deductions::default();
		}

		Deductions {
			always_mine,
			always_safe,
		}
	}
}

#[cfg(test)]
mod tests;
