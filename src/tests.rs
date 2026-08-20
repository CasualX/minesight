use super::*;

const fn cell(x: u32, y: u32) -> u64 {
	1u64 << (y * 8 + x)
}

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
fn test_index() {
	assert_eq!(index(0, 0), Some(0));
	assert_eq!(index(7, 7), Some(63));
	assert_eq!(index(3, 4), Some(35));

	for (x, y) in [(-1, 0), (0, -1), (8, 0), (0, 8)] {
		assert_eq!(index(x, y), None);
	}
}

#[test]
fn test_enumerate() {
	assert_eq!(enumerate(0).collect::<Vec<_>>(), []);
	assert_eq!(enumerate(cell(0, 0) | cell(3, 0) | cell(7, 7)).collect::<Vec<_>>(), [0, 3, 63]);
}

#[test]
fn test_neighbour_masks() {
	let top_left = cell(1, 0) | cell(0, 1) | cell(1, 1);
	let bottom_right = cell(6, 6) | cell(7, 6) | cell(6, 7);

	assert_eq!(NEIGHBOURS[0], top_left);
	assert_eq!(NEIGHBOURS[63], bottom_right);
	assert_eq!(neighbours(cell(0, 0) | cell(7, 7)), top_left | bottom_right);
	assert_eq!(neighbours(0), 0);
	assert_eq!(expand(cell(0, 0)), cell(0, 0) | top_left);
	assert_eq!(expand(0), 0);
}

#[test]
fn test_clue() {
	let mines = cell(2, 2) | cell(3, 2) | cell(4, 4) | cell(3, 3);

	assert_eq!(clue(mines, 3, 3), 3);
	assert_eq!(clue(mines, 0, 0), 0);
	assert_eq!(clue(mines, -1, 0), 0);
	assert_eq!(clue(mines, 8, 0), 0);
}

#[test]
fn test_revealed_flagged() {
	let state = GameState {
		mines: cell(0, 0),
		revealed: cell(1, 0),
		flagged: cell(0, 0),
	};

	assert!(state.is_revealed(1, 0));
	assert!(!state.is_revealed(0, 0));
	assert!(state.is_flagged(0, 0));
	assert!(!state.is_flagged(1, 0));
	assert!(!state.is_revealed(-1, 0));
	assert!(!state.is_flagged(8, 0));
}

#[test]
fn test_deposit_bits() {
	let mask = cell(0, 0) | cell(3, 0) | cell(7, 7);

	assert_eq!(deposit(0b000, mask), 0);
	assert_eq!(deposit(0b101, mask), cell(0, 0) | cell(7, 7));
	assert_eq!(deposit(0b111, mask), mask);
}

#[test]
fn test_game_over() {
	let mine = cell(7, 7);
	let mut state = GameState { mines: mine, revealed: 0, flagged: 0 };

	assert_eq!(state.is_game_over(), None);
	state.revealed = !mine;
	assert_eq!(state.is_game_over(), Some(GameOverReason::Cleared));
	state.revealed |= mine;
	assert_eq!(state.is_game_over(), Some(GameOverReason::Detonation));
}

#[test]
fn test_flag_reveal() {
	let mut state = GameState {
		mines: cell(1, 0),
		revealed: 0,
		flagged: 0,
	};

	state.flag(1, 0);
	state.reveal(1, 0);
	assert_eq!(state.flagged, cell(1, 0));
	assert_eq!(state.revealed, 0);

	let mut state = GameState {
		mines: cell(1, 0),
		revealed: 0,
		flagged: 0,
	};
	state.reveal(0, 0);
	state.flag(0, 0);
	assert_eq!(state.revealed, cell(0, 0));
	assert_eq!(state.flagged, 0);
}

#[test]
fn test_flag_toggle() {
	let mut state = GameState::new(0);

	state.flag(1, 0);
	assert_eq!(state.flagged, cell(1, 0));

	state.flag(1, 0);
	assert_eq!(state.flagged, 0);
}

#[test]
fn test_chord_clue() {
	let mine = cell(1, 0);
	let clue = cell(0, 0);
	let other_squares = cell(0, 1) | cell(1, 1);

	let mut reveal_click = GameState {
		mines: mine,
		revealed: clue,
		flagged: mine,
	};
	reveal_click.reveal(0, 0);
	assert_eq!(reveal_click.revealed, clue | other_squares);

	let mut flag_click = GameState {
		mines: mine,
		revealed: clue,
		flagged: mine,
	};
	flag_click.flag(0, 0);
	assert_eq!(flag_click.revealed, clue | other_squares);
}

#[test]
fn test_chord_mine() {
	let mine = cell(2, 2);
	let clue = cell(3, 3);
	let wrong_flag = cell(2, 3);
	let chord_squares = NEIGHBOURS[3 + 3 * 8] & !wrong_flag;
	let mut state = GameState {
		mines: mine,
		revealed: clue,
		flagged: wrong_flag,
	};

	state.reveal(3, 3);

	assert_ne!(state.revealed & mine, 0);
	assert_eq!(state.revealed, clue | chord_squares);
	assert_eq!(state.mines, mine);
}

#[test]
fn test_wand() {
	let mut state = GameState {
		mines: cell(1, 0),
		revealed: 0,
		flagged: 0,
	};

	assert!(state.wand(1, 0));
	assert!(!state.wand(1, 0));
	assert!(state.wand(0, 0));
	assert!(!state.wand(0, 0));
	assert!(!state.wand(8, 0));

	assert_eq!(state.flagged, cell(1, 0));
	assert_eq!(state.revealed, cell(0, 0));

	let mut flagged_safe = GameState::new(0);
	flagged_safe.flag(0, 0);
	assert!(!flagged_safe.wand(0, 0));
	assert_eq!(flagged_safe.flagged, cell(0, 0));
}

#[test]
fn test_frontier() {
	let center = cell(3, 3);
	let inner_ring = rect(2, 2, 3, 3) & !center;
	let outer_ring = rect(1, 1, 5, 5) & !rect(2, 2, 3, 3);
	let flagged_outer = cell(1, 1);
	let state = GameState {
		mines: 0,
		revealed: center,
		flagged: cell(2, 2) | flagged_outer,
	};

	assert_eq!(state.frontier(), inner_ring);
	assert_eq!(state.outer_frontier(), outer_ring);
	assert_ne!(state.frontier() & state.flagged, 0);
	assert_ne!(state.outer_frontier() & flagged_outer, 0);
}

#[test]
fn test_coverup() {
	let satisfied_clue = cell(0, 0);
	let satisfied_flag = cell(1, 0);
	let unresolved_clue = cell(4, 4);
	let contributing_flag = cell(4, 3);
	let zero_clue = cell(0, 7);
	let revealed_mine = cell(7, 7);
	let orphan_flag = cell(7, 0);
	let mines = satisfied_flag | contributing_flag | cell(5, 3) | revealed_mine;
	let mut state = GameState {
		mines,
		revealed: satisfied_clue | unresolved_clue | zero_clue | revealed_mine,
		flagged: satisfied_flag | contributing_flag | orphan_flag,
	};

	state.prune(true);

	// Satisfied clues with covered neighbours still prove those neighbours safe.
	assert_eq!(state.revealed, satisfied_clue | unresolved_clue | zero_clue | revealed_mine);
	assert_eq!(state.flagged, satisfied_flag | contributing_flag);

	// Pruning an already-pruned position has no further effect.
	let pruned = state;
	state.prune(true);
	assert_eq!(state.revealed, pruned.revealed);
	assert_eq!(state.flagged, pruned.flagged);
}

#[test]
fn test_prune_preserves_existing_exact_deductions() {
	let mine = cell(1, 0);
	let mut state = GameState {
		mines: mine,
		revealed: cell(0, 0),
		flagged: mine,
	};
	let exact = state.solve_exact();

	assert_eq!(exact.always_safe, cell(0, 1) | cell(1, 1));
	state.prune(true);

	assert_eq!(state.solve_exact(), exact);
	assert_eq!(state.revealed, cell(0, 0));
	assert_eq!(state.flagged, mine);

	// Once every neighbour has been consumed, the clue itself is redundant.
	state.revealed |= exact.always_safe;
	let exact = state.solve_exact();
	state.prune(true);

	assert_eq!(state.solve_exact(), exact);
	assert_eq!(state.revealed, cell(0, 0) | cell(0, 1) | cell(1, 1));

	// An isolated, fully consumed clue and its now-unused flags can be removed.
	let adjacent = cell(1, 0) | cell(0, 1) | cell(1, 1);
	let mut state = GameState {
		mines: adjacent,
		revealed: cell(0, 0),
		flagged: adjacent,
	};
	let exact = state.solve_exact();
	state.prune(true);

	assert_eq!(state.solve_exact(), exact);
	assert_eq!(state.revealed, 0);
	assert_eq!(state.flagged, 0);

	// A large solved interior can be hidden. Its boundary remains visible so the
	// original frontier deductions survive; the newly exposed inner row is safe.
	let mut state = GameState {
		mines: 0,
		revealed: rect(0, 0, 8, 4),
		flagged: 0,
	};
	let exact = state.solve_exact();
	state.prune(true);
	let pruned_exact = state.solve_exact();

	assert_eq!(exact.always_mine & !pruned_exact.always_mine, 0);
	assert_eq!(exact.always_safe & !pruned_exact.always_safe, 0);
	assert_eq!(state.revealed, rect(0, 2, 8, 2));
	assert_eq!(pruned_exact.always_safe & rect(0, 1, 8, 1), rect(0, 1, 8, 1));
}

#[test]
fn test_check_guess() {
	let mine = cell(1, 0);
	let state = GameState { mines: mine, revealed: cell(0, 0), flagged: 0 };

	assert!(state.check_guess(mine));
	assert!(state.check_guess(cell(0, 1)));
	assert!(!state.check_guess(0));
	assert!(!state.check_guess(mine | cell(0, 1)));

	let flagged = GameState { flagged: mine, ..state };
	assert!(flagged.check_guess(0));
	assert!(!flagged.check_guess(mine));

	// Guesses must be subsets of the current unflagged frontier.
	let mine = cell(2, 0);
	let state = GameState {
		mines: mine,
		revealed: cell(0, 0) | cell(1, 0),
		flagged: 0,
	};
	assert!(state.check_guess(mine));
	assert!(!state.check_guess(mine | cell(1, 0)));
}

#[test]
fn test_derived_constraint_subtraction() {
	let a = cell(0, 0);
	let b = cell(1, 0);
	let c = cell(2, 0);
	let deductions = solve_constraint_set([
		Constraint { cells: a | b | c, mines: 2 },
		Constraint { cells: a | b, mines: 1 },
	], DERIVED_CONSTRAINT_DEPTH).expect("constraints are consistent");

	assert_eq!(deductions.always_mine, c);
	assert_eq!(deductions.always_safe, 0);
}

#[test]
fn test_derived_constraint_depth_is_bounded() {
	let a = cell(0, 0);
	let b = cell(1, 0);
	let c = cell(2, 0);
	let d = cell(3, 0);
	let e = cell(4, 0);
	let f = cell(5, 0);
	let g = cell(6, 0);
	let constraints = [
		Constraint { cells: a | b | c | d, mines: 2 },
		Constraint { cells: a | b, mines: 1 },
		Constraint { cells: c | d | e | f, mines: 2 },
		Constraint { cells: e | f | g, mines: 1 },
	];

	// First derive {c,d}=1, then derive {e,f}=1. Only the second
	// derivation round lets the final subset rule prove that g is safe.
	assert_eq!(solve_constraint_set(constraints, 1), Some(Deductions::default()));
	assert_eq!(
		solve_constraint_set(constraints, 2),
		Some(Deductions { always_mine: 0, always_safe: g }),
	);
}

#[test]
fn test_derived_constraints_reject_conflicts() {
	let cells = cell(0, 0) | cell(1, 0);
	assert_eq!(
		solve_constraint_set([
			Constraint { cells, mines: 0 },
			Constraint { cells, mines: 1 },
		], DERIVED_CONSTRAINT_DEPTH),
		None,
	);
}

#[test]
fn test_flood_fill() {
	let mut state = GameState {
		mines: 0x0808_0808_0808_0808,
		revealed: 0,
		flagged: 0,
	};

	state.reveal(0, 0);

	assert_eq!(state.revealed, 0x0707_0707_0707_0707);
}

fn assert_puzzle_analysis(puzzle: &Puzzle) {
	let active = puzzle.state.active();
	let forced = puzzle.forced.always_mine | puzzle.forced.always_safe;

	let mut pruned = puzzle.state;
	let exact = pruned.solve_exact();
	pruned.prune(true);
	let pruned_exact = pruned.solve_exact();
	assert_eq!(exact.always_mine & !pruned_exact.always_mine, 0);
	assert_eq!(exact.always_safe & !pruned_exact.always_safe, 0);
	assert_eq!(puzzle.state.flagged & !neighbours(puzzle.state.revealed & !puzzle.state.mines), 0);
	assert_eq!(puzzle.forced.always_mine & !puzzle.state.mines, 0);
	assert_eq!(puzzle.forced.always_safe & puzzle.state.mines, 0);
	assert_eq!(puzzle.forced.always_mine & puzzle.forced.always_safe, 0);
	assert_eq!(forced & !active, 0);
	assert_eq!(puzzle.forced.count(), forced.count_ones());
	assert_eq!(puzzle.ambiguous, (active & !forced).count_ones());
	assert_eq!(puzzle.forced.count() + puzzle.ambiguous, active.count_ones());
}

fn exhausts_exact_deductions(puzzle: &Puzzle) -> bool {
	let mut state = puzzle.state;
	state.apply(puzzle.forced);
	try_solve_exact(&state).is_some_and(|deductions| deductions.is_empty())
}

#[test]
fn test_generators() {
	assert!(generate_expert_puzzle(56, 0).is_none());

	let easy = generate_easy_puzzle(32, 1000).expect("easy search should succeed");
	assert_puzzle_analysis(&easy);
	assert!(exhausts_exact_deductions(&easy));
	assert!(easy.forced.count() >= 4);
	assert!(easy.forced.area() >= 9);
	assert!(easy.ambiguous >= 2);
	assert!(easy.state.revealed.count_ones() >= 32);

	let medium = generate_medium_puzzle(2, 1000).expect("medium search should succeed");
	assert_puzzle_analysis(&medium);
	assert!(medium.forced.count() >= 4);
	assert!(medium.ambiguous >= 3);

	let hard = generate_hard_puzzle(32, 1000).expect("hard search should succeed");
	assert_puzzle_analysis(&hard);
	assert!(exhausts_exact_deductions(&hard));
	assert!(hard.forced.count() >= 4);
	assert!(hard.forced.area() >= 16);
	assert!(hard.ambiguous >= 2);

	let expert = generate_expert_puzzle(56, 1000).expect("expert search should succeed");
	assert_puzzle_analysis(&expert);
	assert!(expert.forced.count() >= 3);
	assert!(expert.forced.area() >= 16);
	assert!(expert.state.active().count_ones() >= 8);
	assert_eq!(expert.attempts, 1);
}
