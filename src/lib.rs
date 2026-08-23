use std::{fmt, ops};

#[cfg(target_arch = "wasm32")]
mod wasm32;

pub mod puzzle;

mod sat;

/// Width and height of every generated puzzle.
pub const BOARD_SIZE: usize = 8;
/// Number of cells in every generated puzzle.
pub const BOARD_CELLS: usize = BOARD_SIZE * BOARD_SIZE;

/// Cell contains a mine.
pub const CELL_MINE: u8 = 0x01;
/// Cell is initially revealed.
pub const CELL_REVEALED: u8 = 0x02;
/// Cell is initially flagged.
pub const CELL_FLAG: u8 = 0x04;
/// Cell belongs to the covered frontier the player may interact with.
pub const CELL_ACTIVE: u8 = 0x08;
/// Cell is a logically forced mine in this puzzle.
pub const CELL_FORCED_MINE: u8 = 0x10;
/// Cell is logically forced safe in this puzzle.
pub const CELL_FORCED_SAFE: u8 = 0x20;

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

/// A fixed-point mine-probability gradient used to generate random boards.
///
/// Values use 16 fractional bits, so [`Gradient::DENOMINATOR`] represents one.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct Gradient {
	/// The x-coordinate of the gradient's reference point.
	pub center_x: i32,
	/// The y-coordinate of the gradient's reference point.
	pub center_y: i32,
	/// The probability numerator at the reference point.
	pub density: i32,
	/// The change in the probability numerator per square along the x-axis.
	pub direction_x: i32,
	/// The change in the probability numerator per square along the y-axis.
	pub direction_y: i32,
}

impl Gradient {
	/// Fixed-point value representing a probability of one.
	pub const DENOMINATOR: i32 = 1i32 << u16::BITS;

	pub const fn new(center_x: i32, center_y: i32, density: i32, direction_x: i32, direction_y: i32) -> Gradient {
		Gradient { center_x, center_y, density, direction_x, direction_y }
	}

	/// Creates a gradient crossing the central portion of the board.
	pub fn random<R: urandom::Rng>(rng: &mut urandom::Random<R>, density: i32, density_step: i32) -> Gradient {
		let center_x = rng.uniform(2..=5);
		let center_y = rng.uniform(2..=5);
		let min_step = (-density_step).min(density_step);
		let max_step = (-density_step).max(density_step);
		let secondary = rng.uniform(min_step..=max_step);
		let (direction_x, direction_y) = match rng.uniform(0..4) {
			0 => (density_step, secondary),
			1 => (-density_step, secondary),
			2 => (secondary, density_step),
			_ => (secondary, -density_step),
		};
		Gradient { center_x, center_y, density, direction_x, direction_y }
	}

	/// Returns this square's unsigned fixed-point mine probability.
	pub fn density_at(&self, x: i8, y: i8) -> i32 {
		let density = self.density +
			(x as i32 - self.center_x) * self.direction_x +
			(y as i32 - self.center_y) * self.direction_y;
		density.clamp(0, Self::DENOMINATOR)
	}

	fn generate_mines<R: urandom::Rng>(&self, rng: &mut urandom::Random<R>) -> u64 {
		let mut mines = 0;
		for (i, x, y) in grid() {
			if (rng.random::<u16>() as i32) < self.density_at(x, y) {
				mines |= 1u64 << i;
			}
		}
		mines
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

	/// Returns the count of forced mines and safe squares.
	#[inline]
	pub const fn count(&self) -> u32 {
		(self.always_mine | self.always_safe).count_ones()
	}

	/// Returns the area of the smallest axis-aligned rectangle containing all forced cells.
	pub fn area(&self) -> u32 {
		let forced = self.always_mine | self.always_safe;
		if forced == 0 {
			return 0;
		}

		let mut min_x = BOARD_SIZE;
		let mut min_y = BOARD_SIZE;
		let mut max_x = 0;
		let mut max_y = 0;
		for index in enumerate(forced) {
			let x = index % BOARD_SIZE;
			let y = index / BOARD_SIZE;
			min_x = min_x.min(x);
			min_y = min_y.min(y);
			max_x = max_x.max(x);
			max_y = max_y.max(y);
		}

		((max_x - min_x + 1) * (max_y - min_y + 1)) as u32
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

impl From<sat::Forced> for Deductions {
	fn from(forced: sat::Forced) -> Self {
		Deductions {
			always_mine: forced.one,
			always_safe: forced.zero,
		}
	}
}

/// Medium reasoning may create two generations of temporary constraints, but
/// never computes their algebraic closure.
const DERIVED_CONSTRAINT_DEPTH: usize = 2;
/// Keeps adversarial frontiers from making the quadratic pair scan unbounded.
const MAX_DERIVED_CONSTRAINTS: usize = 256;

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
	pub const fn new(mines: u64) -> GameState {
		GameState {
			mines,
			revealed: 0,
			flagged: 0,
		}
	}
	/// Generates a deterministic random board using the given density gradient.
	pub fn random(rng: &mut urandom::Random<impl urandom::Rng>, gradient: &Gradient) -> GameState {
		let mines = gradient.generate_mines(rng);
		let revealed = initial_reveal(mines);
		let flagged = 0;
		GameState { mines, revealed, flagged }
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
	/// Returns the covered, unflagged frontier that belongs to the puzzle.
	#[inline]
	pub fn active(&self) -> u64 {
		self.frontier() & !self.flagged
	}
	/// Checks whether a complete assignment of the frontier is possible.
	///
	/// Set bits in `guess` are mines; other unflagged frontier cells are safe.
	/// Flagged squares are fixed mines, while cells beyond the frontier may contain
	/// any mines needed to reach the board's total mine count.
	#[inline]
	pub fn check_guess(&self, guess: u64) -> bool {
		self.check_frontier_assignment_with_total(guess, self.active(), self.revealed)
	}
	fn check_frontier_assignment(&self, guess: u64, frontier: u64, clues: u64) -> bool {
		if guess & !frontier != 0 {
			return false;
		}

		let hypothetical_mines = guess | self.flagged;

		for i in enumerate(clues) {
			let neighs = NEIGHBOURS[i];
			let clue = (self.mines & neighs).count_ones();

			if (hypothetical_mines & neighs).count_ones() != clue {
				return false;
			}
		}

		true
	}
	fn check_frontier_assignment_with_total(&self, guess: u64, frontier: u64, clues: u64) -> bool {
		if !self.check_frontier_assignment(guess, frontier, clues) {
			return false;
		}

		let placed = (guess | self.flagged).count_ones();
		let total = self.count_mines();
		if placed > total {
			return false;
		}

		let outside = !(self.revealed | self.flagged | frontier);
		total - placed <= outside.count_ones()
	}
}

impl GameState {
	/// Hides redundant resolved clues and removes flags that no longer constrain a visible clue.
	///
	/// A clue is resolved when its number equals the number of adjacent flags. It
	/// is only redundant once it has no covered, unflagged neighbours;
	/// otherwise it still allows the exact solver to prove those neighbours safe.
	///
	/// In strict mode, resolved clues adjacent to a clue that must remain visible are retained.
	/// This preserves every deduction on the original frontier,
	/// while allowing newly hidden interior clues to become additional forced-safe squares.
	/// Revealed mines, if any, are left untouched.
	pub fn prune(&mut self, strict: bool) {
		let mut resolved = 0;

		for i in enumerate(self.revealed & !self.mines) {
			let adjacent = NEIGHBOURS[i];
			let clue = (self.mines & adjacent).count_ones();
			let unknown = adjacent & !self.revealed & !self.flagged;
			if unknown == 0 && (self.flagged & adjacent).count_ones() == clue {
				resolved |= 1u64 << i;
			}
		}

		if strict {
			// A removed clue next to a retained clue would become a new variable in
			// that clue's constraint and could invalidate an existing deduction.
			// Only that boundary needs protection: retained resolved clues have zero remaining mines,
			// so any removed neighbours they expose are independent new safe deductions.
			let retained = self.revealed & !resolved;
			resolved &= !neighbours(retained);
		}

		self.revealed &= !resolved;
		self.flagged &= neighbours(self.revealed & !self.mines);
	}
	/// Applies the deductions of a solver to the board.
	pub fn apply(&mut self, result: Deductions) {
		self.revealed |= result.always_safe;
		self.flagged |= result.always_mine;
	}
	/// Translates the revealed region and its frontier towards the board's center if possible.
	///
	/// Inactive region is replaced by all mines.
	#[must_use]
	fn center(mut self) -> GameState {
		if self.revealed == 0 {
			return self;
		}

		let mut columns = self.revealed;
		columns |= columns >> 32;
		columns |= columns >> 16;
		columns |= columns >> 8;
		let columns = columns as u8;
		let min_x = columns.trailing_zeros() as i8;
		let max_x = (u8::BITS - 1 - columns.leading_zeros()) as i8;
		let min_y = (self.revealed.trailing_zeros() / BOARD_SIZE as u32) as i8;
		let max_y = ((u64::BITS - 1 - self.revealed.leading_zeros()) / BOARD_SIZE as u32) as i8;

		let dx = if min_x == 0 || max_x == BOARD_SIZE as i8 - 1 { 0 }
		else { (BOARD_SIZE as i8 - 1 - min_x - max_x) / 2 };
		let dy = if min_y == 0 || max_y == BOARD_SIZE as i8 - 1 { 0 }
		else { (BOARD_SIZE as i8 - 1 - min_y - max_y) / 2 };

		let shifth = |cells: u64| if dx < 0 { cells >> -dx } else { cells << dx };
		let shiftv = |cells: u64| if dy < 0 { cells >> (-dy * BOARD_SIZE as i8) } else { cells << (dy * BOARD_SIZE as i8) };
		let shift = |cells: u64| shiftv(shifth(cells));

		let local = expand(self.revealed);
		let target = shift(local);
		self.mines = shift(self.mines & local) | !target;
		self.revealed = shift(self.revealed);
		self.flagged = shift(self.flagged);
		return self;
	}
	/// Translates visible Minesweeper clues into Boolean cardinality constraints.
	/// The returned map preserves clue-cell to constraint-index correspondence for
	/// solvers whose choice of constraint pairs depends on board geometry.
	fn constraint_state(&self, clues: u64) -> Option<(sat::State<64>, [usize; 64])> {
		let mut state = sat::State::EMPTY;
		let mut indices = [usize::MAX; 64];

		for i in enumerate(clues & self.revealed) {
			let adjacent = NEIGHBOURS[i];
			let vars = adjacent & !self.revealed & !self.flagged;
			let clue = (self.mines & adjacent).count_ones();
			let flagged = (self.flagged & adjacent).count_ones();
			let sum = u8::try_from(clue.checked_sub(flagged)?).ok()?;
			indices[i] = state.push(vars, sum)?;
		}

		Some((state, indices))
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
	/// Computes all exact deductions implied by the revealed clues.
	///
	/// The board's total mine count is intentionally not used. Callers must apply
	/// the result and call this method again to continue solving.
	pub fn solve(&self) -> Deductions {
		self.solve_sat()
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
		let Some((state, _)) = self.constraint_state(self.revealed) else {
			return Deductions::default();
		};
		state.solve_subset().map(Into::into).unwrap_or_default()
	}
	/// Computes deductions from every geometrically adjacent pair of frontier
	/// clues using their remaining mine counts.
	///
	/// For constraints `A` and `B`, their shared cells cancel:
	///
	/// ```text
	/// mines(B-only) - mines(A-only) = remaining(B) - remaining(A)
	/// ```
	///
	/// If this difference reaches either possible extreme, every cell in both
	/// exclusive groups is determined. Only clues touching the current unflagged
	/// frontier are considered, and each clue has at most eight candidate partners.
	pub fn solve_overlap(&self) -> Deductions {
		let active = self.active();
		if active == 0 {
			return Deductions::default();
		}

		let clues = neighbours(active) & self.revealed;
		let mut result = Deductions::default();

		for a_index in enumerate(clues) {
			let a_neighbours = NEIGHBOURS[a_index];
			let a_unrevealed = a_neighbours & !self.revealed & !self.flagged;
			let a_clue = (self.mines & a_neighbours).count_ones();
			let a_flags = (self.flagged & a_neighbours).count_ones();
			if a_clue < a_flags || a_clue > a_flags + a_unrevealed.count_ones() {
				return Deductions::default();
			}

			for b_index in enumerate(NEIGHBOURS[a_index] & clues) {
				if b_index <= a_index {
					continue;
				}

				let b_neighbours = NEIGHBOURS[b_index];
				let b_unrevealed = b_neighbours & !self.revealed & !self.flagged;
				let b_clue = (self.mines & b_neighbours).count_ones();
				let b_flags = (self.flagged & b_neighbours).count_ones();
				if b_clue < b_flags || b_clue > b_flags + b_unrevealed.count_ones() {
					return Deductions::default();
				}

				let a_only = a_unrevealed & !b_unrevealed;
				let b_only = b_unrevealed & !a_unrevealed;

				if b_clue + a_flags == a_clue + b_flags + b_only.count_ones() {
					result.always_mine |= b_only;
					result.always_safe |= a_only;
				}
				else if a_clue + b_flags == b_clue + a_flags + a_only.count_ones() {
					result.always_mine |= a_only;
					result.always_safe |= b_only;
				}
			}
		}

		if result.always_mine & result.always_safe != 0 {
			return Deductions::default();
		}

		result
	}
	/// Computes deductions by covering one clue with one or more adjacent clues.
	///
	/// Subtracting the focus constraint from the sum of the covering constraints
	/// gives negative weight to uncovered focus cells and positive weight to cells
	/// covered outside the focus or more than once inside it. When this difference
	/// reaches either possible extreme, all cells in both groups are determined.
	pub fn solve_clue_cover(&self) -> Deductions {
		let active = self.active();
		if active == 0 {
			return Deductions::default();
		}

		let clues = neighbours(active) & self.revealed;
		let mut result = Deductions::default();

		for focus_index in enumerate(clues) {
			let focus_neighbours = NEIGHBOURS[focus_index];
			let focus_cells = focus_neighbours & !self.revealed & !self.flagged;
			let focus_clue = (self.mines & focus_neighbours).count_ones();
			let Some(focus_mines) = focus_clue.checked_sub((self.flagged & focus_neighbours).count_ones()) else {
				return Deductions::default();
			};
			if focus_mines > focus_cells.count_ones() {
				return Deductions::default();
			}

			let adjacent_clues = NEIGHBOURS[focus_index] & clues;
			let mut cover = adjacent_clues;
			while cover != 0 {
				let mut covered = 0;
				let mut covered_twice = 0;
				let mut covering_mines = 0;
				let mut covering_cells = 0;

				for cover_index in enumerate(cover) {
					let cover_neighbours = NEIGHBOURS[cover_index];
					let cover_cells = cover_neighbours & !self.revealed & !self.flagged;
					let cover_clue = (self.mines & cover_neighbours).count_ones();
					let Some(remaining) = cover_clue.checked_sub((self.flagged & cover_neighbours).count_ones()) else {
						return Deductions::default();
					};
					if remaining > cover_cells.count_ones() {
						return Deductions::default();
					}

					covered_twice |= covered & cover_cells;
					covered |= cover_cells;
					covering_mines += remaining;
					covering_cells += cover_cells.count_ones();
				}

				let uncovered = focus_cells & !covered;
				let positive = (covered & !focus_cells) | (covered_twice & focus_cells);
				let negative_capacity = uncovered.count_ones();
				let positive_capacity = covering_cells - (covered & focus_cells).count_ones();

				if focus_mines > covering_mines + negative_capacity || covering_mines > focus_mines + positive_capacity {
					return Deductions::default();
				}
				if focus_mines == covering_mines + negative_capacity {
					result.always_mine |= uncovered;
					result.always_safe |= positive;
				}
				if covering_mines == focus_mines + positive_capacity {
					result.always_mine |= positive;
					result.always_safe |= uncovered;
				}

				cover = (cover - 1) & adjacent_clues;
			}
		}

		if result.always_mine & result.always_safe != 0 {
			return Deductions::default();
		}

		result
	}
	/// Computes deductions from a small, temporary set of derived frontier constraints.
	///
	/// Overlapping constraints may produce exact constraints on their exclusive
	/// cells. Those constraints participate in the local, subset, and overlap
	/// rules for at most [`DERIVED_CONSTRAINT_DEPTH`] generations. This models a
	/// short chain of human-scale inferences without becoming an exact solver.
	pub fn solve_derived(&self) -> Deductions {
		let active = self.active();
		if active == 0 {
			return Deductions::default();
		}

		let clues = neighbours(active) & self.revealed;
		let Some((state, _)) = self.constraint_state(clues) else {
			return Deductions::default();
		};
		state
			.solve_derived::<MAX_DERIVED_CONSTRAINTS>(DERIVED_CONSTRAINT_DEPTH)
			.map(Into::into)
			.unwrap_or_default()
	}
	/// Computes exact deductions from the revealed clues using the SAT solver.
	pub fn solve_sat(&self) -> Deductions {
		let Some((state, _)) = self.constraint_state(self.revealed) else {
			return Deductions::default();
		};
		state.solve().map(Into::into).unwrap_or_default()
	}
}

//----------------------------------------------------------------

#[cfg(test)]
mod tests;
