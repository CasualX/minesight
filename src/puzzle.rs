use super::*;

const SHARE_ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// This mask is part of the public `2.` shared-puzzle format in public/mines.js.
// It only obscures the answer pattern at a glance; it is not encryption.
const SHARE_MASK: [u8; BOARD_CELLS] = {
	let mut mask = [0; BOARD_CELLS];
	let mut state = 0x6d2b79f5u32;
	let mut index = 0;
	while index < BOARD_CELLS {
		state ^= state << 13;
		state ^= state >> 17;
		state ^= state << 5;
		mask[index] = (state & 0x3f) as u8;
		index += 1;
	}
	mask
};

/// A generated tactics position.
#[derive(Copy, Clone)]
pub struct Puzzle {
	/// Seed used to construct this deterministic attempt series.
	pub seed: u64,
	/// Attempts consumed to find this puzzle; one means first-attempt success.
	pub attempts: u32,
	/// Visible starting position with hidden mine data.
	pub state: GameState,
	/// Logically forced mines and safe cells on the active frontier.
	pub forced: Deductions,
	/// Number of active frontier cells not identified as forced.
	pub ambiguous: u32,
}

impl Puzzle {
	/// Encodes this puzzle in the byte layout consumed by JavaScript's `MineField` constructor.
	pub fn cells(&self) -> [u8; BOARD_CELLS] {
		let active = self.state.active();
		let mut cells = [0; BOARD_CELLS];

		for (i, _, _) in grid() {
			let bit = 1u64 << i;
			let mut cell = 0;
			if self.state.mines & bit != 0 {
				cell |= CELL_MINE;
			}
			if self.state.revealed & bit != 0 {
				cell |= CELL_REVEALED;
			}
			if self.state.flagged & bit != 0 {
				cell |= CELL_FLAG;
			}
			if active & bit != 0 {
				cell |= CELL_ACTIVE;
			}
			if self.forced.always_mine & bit != 0 {
				cell |= CELL_FORCED_MINE;
			}
			if self.forced.always_safe & bit != 0 {
				cell |= CELL_FORCED_SAFE;
			}
			cells[i] = cell;
		}

		cells
	}
	/// Encodes this exact board in the stable shared-puzzle format accepted by
	/// `public/mines.js`, independently of its generator and seed.
	pub fn encode(&self) -> String {
		let cells = self.cells();
		let mut payload = String::with_capacity(2 + BOARD_CELLS);
		payload.push_str("2.");
		for (index, cell) in cells.into_iter().enumerate() {
			let encoded = (cell & 0x3f) ^ SHARE_MASK[index];
			payload.push(SHARE_ALPHABET[encoded as usize] as char);
		}
		payload
	}
}

fn ambiguous_count(state: &GameState, forced: Deductions) -> u32 {
	(state.active() & !(forced.always_mine | forced.always_safe)).count_ones()
}

fn make_puzzle(seed: u64, attempts: u32, state: GameState, deductions: Deductions) -> Puzzle {
	let active = state.frontier() & !state.flagged;
	let forced = Deductions {
		always_mine: deductions.always_mine & active,
		always_safe: deductions.always_safe & active,
	};
	let ambiguous = ambiguous_count(&state, forced);
	Puzzle { seed, attempts, state, forced, ambiguous }
}

/// Constructs a mine layout for one puzzle-generation attempt.
pub trait BoardGenerator {
	/// Returns a mine mask, or `None` when board construction fails.
	fn generate<R: urandom::Rng>(&self, rng: &mut urandom::Random<R>) -> Option<u64>;
}

impl BoardGenerator for Gradient {
	fn generate<R: urandom::Rng>(&self, rng: &mut urandom::Random<R>) -> Option<u64> {
		Some(self.generate_mines(rng))
	}
}

/// Produces naturally open boards with varied gradient directions.
#[derive(Copy, Clone, Debug, Default, Eq, PartialEq)]
struct EasyBoard;

impl BoardGenerator for EasyBoard {
	fn generate<R: urandom::Rng>(&self, rng: &mut urandom::Random<R>) -> Option<u64> {
		Gradient::random(
			rng,
			Gradient::DENOMINATOR * 25 / 100,
			Gradient::DENOMINATOR / 16,
		).generate(rng)
	}
}

/// Produces mostly cheap diagonal-gradient candidates, interspersed with dense
/// uniform boards to keep the hard search tail short.
#[derive(Copy, Clone, Debug, Default, Eq, PartialEq)]
struct HardBoard;

impl BoardGenerator for HardBoard {
	fn generate<R: urandom::Rng>(&self, rng: &mut urandom::Random<R>) -> Option<u64> {
		// Uniform half-density boards pass relatively often, while steep gradients
		// are much cheaper to reject. The blend performs better than either alone.
		if rng.uniform(0..8) == 0 {
			return Some(rng.random::<u64>());
		}

		let density_step = Gradient::DENOMINATOR / 4;
		Gradient {
			center_x: rng.uniform(2..=5),
			center_y: rng.uniform(2..=5),
			density: Gradient::DENOMINATOR * 80 / 100,
			direction_x: if rng.coin_flip() { -density_step } else { density_step },
			direction_y: if rng.coin_flip() { -density_step } else { density_step },
		}.generate(rng)
	}
}

/// Produces dense uniform boards for expert puzzles.
#[derive(Copy, Clone, Debug, Default, Eq, PartialEq)]
struct ExpertBoard;

impl BoardGenerator for ExpertBoard {
	fn generate<R: urandom::Rng>(&self, rng: &mut urandom::Random<R>) -> Option<u64> {
		Some(rng.random::<u64>())
	}
}

/// Turns a hidden mine layout into a visible candidate state.
pub trait Explorer {
	/// Explores one board, applying the configured cleanup solver as needed.
	///
	/// `candidate_score` returns a score only for states accepted by the complete
	/// puzzle pipeline. Explorers may use it to retain the strongest acceptable
	/// intermediate state.
	fn explore<R: urandom::Rng>(&self,
		mines: u64,
		rng: &mut urandom::Random<R>,
		cleanup: Solver,
		candidate_score: &mut dyn FnMut(&GameState) -> Option<(u32, u32)>,
	) -> Option<GameState>;
}

/// Reveals every zero-clue region and its bordering clues, then optionally
/// enriches a sparse position with a random walk outside the original frontier.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct InitialRevealExplorer {
	/// Maximum number of enriched states to inspect after the initial reveal.
	pub max_steps: u32,
	/// Minimum number of cells beyond the initial frontier required to start a walk.
	pub walk_threshold: u32,
}

impl Explorer for InitialRevealExplorer {
	fn explore<R: urandom::Rng>(&self,
		mines: u64,
		rng: &mut urandom::Random<R>,
		cleanup: Solver,
		candidate_score: &mut dyn FnMut(&GameState) -> Option<(u32, u32)>,
	) -> Option<GameState> {
		let mut state = GameState { mines, revealed: initial_reveal(mines), flagged: 0 };
		apply_cleanup(&mut state, cleanup);

		let initial = state;
		let original_frontier = state.frontier();
		let beyond_frontier = !(state.revealed | original_frontier);
		if self.max_steps == 0 || beyond_frontier.count_ones() <= self.walk_threshold {
			return Some(state);
		}
		let mut best = candidate_score(&state).map(|score| (state, score));

		let safe_starts = beyond_frontier & !mines & !state.flagged;
		if safe_starts == 0 {
			return Some(state);
		}

		let start = deposit(1u64 << rng.uniform(0..safe_starts.count_ones()), safe_starts);
		let start_index = start.trailing_zeros();
		state.reveal((start_index & 7) as i8, (start_index >> 3) as i8);
		apply_cleanup(&mut state, cleanup);
		let mut walk_revealed = state.revealed & !initial.revealed;

		for step in 0..self.max_steps {
			if let Some(score) = candidate_score(&state)
				&& best.is_none_or(|(_, best_score)| score > best_score)
			{
				best = Some((state, score));
			}

			if step + 1 == self.max_steps {
				break;
			}

			// Stay on the newly exposed component instead of consuming the
			// original puzzle frontier merely because it is also safe.
			let safe_frontier = neighbours(walk_revealed) & state.frontier() & !mines;
			let safe_squares = if safe_frontier == 0 {
				// Restart somewhere else beyond the original frontier when this
				// component has no remaining safe frontier cells.
				safe_starts & !state.revealed & !state.flagged
			}
			else {
				safe_frontier
			};
			if safe_squares == 0 {
				break;
			}

			let square = deposit(1u64 << rng.uniform(0..safe_squares.count_ones()), safe_squares);
			let square_index = square.trailing_zeros();
			state.reveal((square_index & 7) as i8, (square_index >> 3) as i8);
			apply_cleanup(&mut state, cleanup);
			walk_revealed |= state.revealed & !initial.revealed;
		}

		Some(best.map_or(initial, |(state, _)| state))
	}
}

/// Walks through random safe frontier cells and retains the strongest state.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct RandomWalkExplorer {
	pub max_steps: u32,
}

impl Explorer for RandomWalkExplorer {
	fn explore<R: urandom::Rng>(&self,
		mines: u64,
		rng: &mut urandom::Random<R>,
		cleanup: Solver,
		candidate_score: &mut dyn FnMut(&GameState) -> Option<(u32, u32)>,
	) -> Option<GameState> {
		let mut state = GameState::new(mines);
		let non_zero_clues = !mines & expand(mines);
		let safe_starts = if non_zero_clues == 0 { !mines } else { non_zero_clues };
		if safe_starts == 0 {
			return None;
		}

		let start = deposit(1u64 << rng.uniform(0..safe_starts.count_ones()), safe_starts);
		let start_index = start.trailing_zeros();
		state.reveal((start_index & 7) as i8, (start_index >> 3) as i8);

		let mut best = None;
		let mut best_score = (0, 0);
		for _ in 0..self.max_steps {
			let safe_frontier = state.frontier() & !mines;
			let safe_squares = if safe_frontier == 0 {
				// Restart with the same safe-start filter when this component
				// has no remaining safe frontier cells.
				safe_starts & !state.revealed & !state.flagged
			}
			else {
				safe_frontier
			};
			if safe_squares == 0 {
				break;
			}

			let square = deposit(1u64 << rng.uniform(0..safe_squares.count_ones()), safe_squares);
			let square_index = square.trailing_zeros();
			state.reveal((square_index & 7) as i8, (square_index >> 3) as i8);
			apply_cleanup(&mut state, cleanup);

			let Some(score) = candidate_score(&state) else {
				continue;
			};
			if best.is_none() || score > best_score {
				best = Some(state);
				best_score = score;
			}
		}

		best
	}
}

/// Solver function used by cleanup, test, and reject roles.
pub type Solver = fn(&GameState) -> Deductions;

fn same_solver(left: Solver, right: Solver) -> bool {
	std::ptr::fn_addr_eq(left, right)
}

/// Cleanup, advertised-answer, and hidden-deduction solver roles.
#[derive(Copy, Clone, Debug)]
pub struct SolverConfig {
	pub cleanup: Solver,
	pub test: Solver,
	pub reject: Solver,
}

/// Inclusive high-level constraints applied to fully analyzed candidates.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct Criteria {
	/// Minimum number of forced cells.
	pub min_forced: u32,
	/// Minimum inclusive bounding-box area occupied by the forced cells.
	pub min_forced_area: u32,
	/// Minimum number of ambiguous cells.
	pub min_ambiguous: u32,
	/// Minimum number of clues already visible in the starting position.
	pub min_revealed: u32,
	/// Allow empty clue 0 revealed cells.
	pub allow_empty: bool,
}

fn has_empty_revealed(state: &GameState) -> bool {
	empty_squares(state.mines) & state.revealed != 0
}

impl Criteria {
	/// Returns whether a fully analyzed puzzle meets these constraints.
	pub fn accepts(&self, puzzle: &Puzzle) -> bool {
		let forced = puzzle.forced.count();
		forced != 0 && forced >= self.min_forced &&
			puzzle.forced.area() >= self.min_forced_area &&
			puzzle.ambiguous >= self.min_ambiguous &&
			puzzle.state.revealed.count_ones() >= self.min_revealed &&
			puzzle.forced.always_mine.count_ones() > 0 &&
			puzzle.forced.always_safe.count_ones() > 0 &&
			(self.allow_empty || !has_empty_revealed(&puzzle.state))
	}
}

/// Configurable first-match puzzle generation pipeline.
#[derive(Copy, Clone, Debug)]
pub struct Generator<B, E> {
	pub board: B,
	pub explorer: E,
	pub solvers: SolverConfig,
	pub criteria: Criteria,
}

impl<B: BoardGenerator, E: Explorer> Generator<B, E> {
	/// Searches up to `attempts` candidates in one deterministic, jump-separated series.
	pub fn search(&self, seed: u64, attempts: u32) -> Option<Puzzle> {
		let mut master_rng = urandom::seeded(seed);
		for attempt in 0..attempts {
			let mut attempt_rng = master_rng.split();
			if let Some(puzzle) = self.try_attempt(seed, attempt + 1, &mut attempt_rng) {
				return Some(puzzle);
			}
		}
		None
	}

	fn try_attempt<R: urandom::Rng>(&self, seed: u64, attempts: u32, rng: &mut urandom::Random<R>) -> Option<Puzzle> {
		let mines = self.board.generate(rng)?;
		let mut candidate_score = |state: &GameState| {
			analyze_candidate(seed, attempts, *state, self.solvers, self.criteria)
				.map(|puzzle| (puzzle.forced.count(), puzzle.ambiguous))
		};
		let state = self.explorer.explore(mines, rng, self.solvers.cleanup, &mut candidate_score)?.center();
		analyze_candidate(seed, attempts, state, self.solvers, self.criteria)
	}
}

fn analyze_candidate(seed: u64, attempts: u32, state: GameState, solvers: SolverConfig, criteria: Criteria) -> Option<Puzzle> {
	let deductions = (solvers.test)(&state);
	let puzzle = make_puzzle(seed, attempts, state, deductions);

	// Count checks are cheap and can avoid a stronger reject solver.
	if !criteria.accepts(&puzzle) {
		return None;
	}

	if !same_solver(solvers.test, solvers.reject) {
		let mut remainder = state;
		remainder.apply(puzzle.forced);
		if !(solvers.reject)(&remainder).is_empty() {
			return None;
		}
	}

	Some(puzzle)
}

fn apply_cleanup(state: &mut GameState, solver: Solver) {
	loop {
		let deductions = solver(state);
		if deductions.is_empty() {
			return;
		}
		state.apply(deductions);
	}
}

/// Easy puzzles start with most of the board open, use local cleanup, and
/// advertise overlap deductions only when SAT solving finds nothing
/// left after those answers are applied.
pub fn generate_easy(seed: u64, attempts: u32) -> Option<Puzzle> {
	Generator {
		board: EasyBoard,
		explorer: InitialRevealExplorer { max_steps: 0, walk_threshold: 0 },
		solvers: SolverConfig {
			cleanup: GameState::solve_local,
			test: |state| state.solve_subset() | state.solve_overlap() | state.solve_clue_cover(),
			reject: GameState::solve_sat,
		},
		criteria: Criteria {
			min_forced: 4,
			min_forced_area: 9,
			min_ambiguous: 2,
			min_revealed: 24,
			allow_empty: true,
		},
	}.search(seed, attempts)
}

/// Medium puzzles advertise short chains of derived-constraint deductions.
pub fn generate_medium(seed: u64, attempts: u32) -> Option<Puzzle> {
	Generator {
		board: Gradient::new(4, 4, Gradient::DENOMINATOR * 35 / 100, Gradient::DENOMINATOR / 16, 0),
		explorer: InitialRevealExplorer { max_steps: 16, walk_threshold: 48 },
		solvers: SolverConfig {
			cleanup: |state| state.solve_local(),
			test: |state| state.solve_derived() | state.solve_clue_cover(),
			reject: GameState::solve_sat,
		},
		criteria: Criteria {
			min_forced: 4,
			min_forced_area: 16,
			min_ambiguous: 3,
			min_revealed: 0,
			allow_empty: true,
		},
	}.search(seed, attempts)
}

/// Hard puzzles use basic deductions on dense boards with widely separated answers.
pub fn generate_hard(seed: u64, attempts: u32) -> Option<Puzzle> {
	Generator {
		board: HardBoard,
		explorer: InitialRevealExplorer { max_steps: 16, walk_threshold: 48 },
		solvers: SolverConfig {
			cleanup: GameState::solve_local,
			test: |state| state.solve_subset() | state.solve_overlap() | state.solve_clue_cover(),
			reject: GameState::solve_sat,
		},
		criteria: Criteria {
			min_forced: 4,
			min_forced_area: 17,
			min_ambiguous: 3,
			min_revealed: 0,
			allow_empty: false,
		},
	}.search(seed, attempts)
}

/// Expert puzzles use the random-walk explorer and advertise exact deductions.
pub fn generate_expert(seed: u64, attempts: u32) -> Option<Puzzle> {
	Generator {
		board: ExpertBoard,
		explorer: RandomWalkExplorer { max_steps: 16 },
		solvers: SolverConfig {
			cleanup: |state| state.solve_subset() | state.solve_derived() | state.solve_clue_cover(),
			test: GameState::solve_sat,
			reject: GameState::solve_sat,
		},
		criteria: Criteria {
			min_forced: 4,
			min_forced_area: 16,
			min_ambiguous: 3,
			min_revealed: 0,
			allow_empty: false,
		},
	}.search(seed, attempts)
}

fn minimize_mit_clues<R: urandom::Rng>(mines: u64, rng: &mut urandom::Random<R>) -> Option<GameState> {
	// Empty clues make immediate local deductions, so exclude layouts containing them.
	if empty_squares(mines) != 0 {
		return None;
	}

	let mut state = GameState {
		mines,
		revealed: !mines,
		flagged: 0,
	};

	// Even with every safe clue visible, some mine layouts are not uniquely determined.
	if state.solve_sat().always_mine != mines {
		return None;
	}

	let mut indices: [u8; BOARD_CELLS] = std::array::from_fn(|i| i as u8);
	let indices = &mut indices[..state.revealed.count_ones() as usize];

	loop {
		let mut removed_any = false;
		rng.shuffle(indices);

		for &i in &*indices {
			let cell = deposit(1u64 << i, !mines);
			if state.revealed & cell == 0 {
				continue;
			}

			state.revealed &= !cell;
			if state.solve_sat().always_mine == mines {
				removed_any = true;
			}
			else {
				state.revealed |= cell;
			}
		}

		if !removed_any {
			return Some(state);
		}
	}
}

/// Generates an MIT-style puzzle with a uniquely determined mine layout and
/// minimizes the number of deductions available to the local solver.
pub fn generate_mit<const REFINEMENTS: usize>(seed: u64, attempts: u32) -> Option<Puzzle> {
	fn cleanup(state: &GameState) -> Deductions {
		state.solve_local() | state.solve_overlap() | state.solve_clue_cover()
	}
	fn random(rng: &mut urandom::Random<impl urandom::Rng>) -> u64 {
		// Since we only ever open clues, balance the unrevealed cells between mines and safe cells
		rng.random::<u64>() & rng.random::<u64>()
	}

	let mut master_rng = urandom::seeded(seed);
	for attempt in 0..attempts {
		let mut rng = master_rng.split();

		let mines = loop {
			let mines = random(&mut rng);
			if empty_squares(mines) == 0 {
				break mines;
			}
		};
		let Some(mut current) = minimize_mit_clues(mines, &mut rng) else {
			continue;
		};

		let mut best = current;
		let mut best_local_count = cleanup(&best).count();

		for _ in 0..REFINEMENTS {
			let local = cleanup(&current);
			let forced = local.always_mine | local.always_safe;
			if forced == 0 {
				break;
			}

			// Rescramble locally obvious cells and their neighbourhood, then repeat
			// clue minimization for the resulting mine layout.
			let rescramble = expand(forced);
			let candidate_mines = (current.mines & !rescramble) | (random(&mut rng) & rescramble);
			let Some(candidate) = minimize_mit_clues(candidate_mines, &mut rng) else {
				continue;
			};

			current = candidate;
			let local_count = cleanup(&current).count();
			if local_count < best_local_count {
				best = current;
				best_local_count = local_count;
			}
		}

		let deductions = best.solve_sat();
		return Some(make_puzzle(seed, attempt + 1, best, deductions));
	}
	None
}
