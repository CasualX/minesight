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
fn test_clue_cover() {
	let mines_131 = cell(3, 1) | cell(1, 3) | cell(3, 3);
	let revealed_131 = cell(2, 1) | cell(1, 2) | cell(2, 2);
	let expected_131 = Deductions {
		always_mine: cell(3, 3),
		always_safe: cell(1, 1) |
			cell(1, 0) | cell(2, 0) | cell(3, 0) |
			cell(0, 1) | cell(0, 2) | cell(0, 3),
	};

	let mines_121 = cell(7, 3) | cell(5, 5);
	let revealed_121 = rect(6, 4, 2, 3) | cell(5, 6);
	let expected_121 = Deductions {
		always_mine: 0,
		always_safe: cell(5, 3) |
			cell(4, 5) | cell(4, 6) |
			cell(6, 7) | cell(4, 7),
	};

	let mines_covering_cells = cell(5, 0) | cell(5, 1);
	let revealed_covering_cells = cell(6, 0) | cell(7, 0);
	let expected_covering_cells = Deductions {
		always_mine: mines_covering_cells,
		always_safe: 0,
	};

	let mine_one_covering_clue = cell(0, 6);
	let revealed_one_covering_clue = cell(0, 7) | cell(1, 7);
	let expected_one_covering_clue = Deductions {
		always_mine: 0,
		always_safe: cell(2, 6) | cell(2, 7),
	};

	let mut state = GameState {
		mines: mines_131 | mines_121 | mines_covering_cells | mine_one_covering_clue,
		revealed: revealed_131 | revealed_121 | revealed_covering_cells | revealed_one_covering_clue,
		flagged: 0,
	};
	println!("{state}");

	let expected = expected_131 | expected_121 | expected_covering_cells | expected_one_covering_clue;
	let actual = state.solve_clue_cover();
	state.apply(actual);
	println!("{state}");

	assert_eq!(actual, expected);
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
