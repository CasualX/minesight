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
fn test_bit_indices() {
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
fn game_state_reports_mine_count_and_clues() {
	let state = GameState {
		mines: cell(0, 0) | cell(2, 0) | cell(7, 7),
		revealed: 0,
		flagged: 0,
	};

	assert_eq!(state.count_mines(), 3);
	assert_eq!(state.clue(1, 0), 2);
	assert_eq!(state.clue(7, 7), 0);
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
fn flag_and_reveal_respect_existing_cell_state() {
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
fn flag_toggles_an_unrevealed_square() {
	let mut state = GameState::new();

	state.flag(1, 0);
	assert_eq!(state.flagged, cell(1, 0));

	state.flag(1, 0);
	assert_eq!(state.flagged, 0);
}

#[test]
fn clicking_satisfied_clue_reveals_its_other_squares() {
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
fn chording_into_a_mine_does_not_flood_fill_the_board() {
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

	let mut flagged_safe = GameState::new();
	flagged_safe.flag(0, 0);
	assert!(!flagged_safe.wand(0, 0));
	assert_eq!(flagged_safe.flagged, cell(0, 0));
}

#[test]
fn wand_flood_fills_from_a_safe_empty_square() {
	let mut state = GameState {
		mines: 0x0808_0808_0808_0808,
		revealed: 0,
		flagged: 0,
	};

	assert!(state.wand(0, 0));

	assert_eq!(state.revealed, 0x0707_0707_0707_0707);
}

#[test]
fn empty_squares_and_initial_reveal_exclude_mines() {
	let mine = cell(0, 0);
	let adjacent = cell(1, 0) | cell(0, 1) | cell(1, 1);

	assert_eq!(empty_squares(mine), !(mine | adjacent));
	assert_eq!(initial_reveal(mine), !mine);
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
fn check_guess_validates_frontier_clues_and_total() {
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
fn flood_fill_only_reveals_the_connected_empty_region() {
	let mut state = GameState {
		mines: 0x0808_0808_0808_0808,
		revealed: 0,
		flagged: 0,
	};

	state.reveal(0, 0);

	assert_eq!(state.revealed, 0x0707_0707_0707_0707);
}

#[test]
fn apply_adds_solver_deductions_to_the_state() {
	let mut state = GameState::new();
	state.apply(Deductions {
		always_mine: cell(1, 1),
		always_safe: cell(2, 2),
	});

	assert_eq!(state.flagged, cell(1, 1));
	assert_eq!(state.revealed, cell(2, 2));
}

#[test]
fn solve_local_finds_mines() {
	let neighbours = cell(1, 0) | cell(0, 1) | cell(1, 1);
	let state = GameState {
		mines: neighbours,
		revealed: cell(0, 0),
		flagged: 0,
	};

	assert_eq!(state.solve_local(), Deductions {
		always_mine: neighbours,
		always_safe: 0,
	});
}

#[test]
fn solve_local_finds_safe_cells() {
	let mine = cell(1, 0);
	let safe = cell(0, 1) | cell(1, 1);
	let state = GameState {
		mines: mine,
		revealed: cell(0, 0),
		flagged: mine,
	};

	assert_eq!(state.solve_local(), Deductions {
		always_mine: 0,
		always_safe: safe,
	});
}

#[test]
fn solve_total_finds_safe_squares_after_all_mines_are_flagged() {
	let mines = cell(1, 0) | cell(2, 0);
	let revealed = cell(0, 0);
	let state = GameState {
		mines,
		revealed,
		flagged: mines,
	};

	assert_eq!(state.solve_total(), Deductions {
		always_mine: 0,
		always_safe: !(revealed | mines),
	});
}

#[test]
fn solve_total_finds_mines_when_every_unknown_square_is_mined() {
	let mines = cell(1, 0) | cell(2, 0);
	let state = GameState {
		mines,
		revealed: !mines,
		flagged: 0,
	};

	assert_eq!(state.solve_total(), Deductions {
		always_mine: mines,
		always_safe: 0,
	});
}

#[test]
fn solve_total_returns_no_moves_before_the_mine_count_is_decisive() {
	let state = GameState {
		mines: cell(1, 0),
		revealed: cell(0, 0),
		flagged: 0,
	};

	assert!(state.solve_total().is_empty());
}

#[test]
fn solve_subset_includes_local_deductions() {
	let neighbours = cell(1, 0) | cell(0, 1) | cell(1, 1);
	let state = GameState {
		mines: neighbours,
		revealed: cell(0, 0),
		flagged: 0,
	};

	assert_eq!(state.solve_subset(), state.solve_local());
}

#[test]
fn solve_subset_finds_safe_difference() {
	let mine = cell(0, 1);
	let shared = cell(0, 1) | cell(1, 1);
	let difference = cell(2, 0) | cell(2, 1);
	let state = GameState {
		mines: mine,
		revealed: cell(0, 0) | cell(1, 0),
		flagged: 0,
	};

	assert_eq!(NEIGHBOURS[0] & !state.revealed, shared);
	assert_eq!(NEIGHBOURS[1] & !state.revealed, shared | difference);
	assert!(state.solve_local().is_empty());
	assert_eq!(state.solve_subset(), Deductions {
		always_mine: 0,
		always_safe: difference,
	});
}

#[test]
fn solve_subset_finds_mined_difference() {
	let shared_mine = cell(0, 1);
	let difference = cell(2, 0) | cell(2, 1);
	let state = GameState {
		mines: shared_mine | difference,
		revealed: cell(0, 0) | cell(1, 0),
		flagged: 0,
	};

	assert!(state.solve_local().is_empty());
	assert_eq!(state.solve_subset(), Deductions {
		always_mine: difference,
		always_safe: 0,
	});
}

#[test]
fn solve_subset_returns_no_moves_for_contradictory_flags() {
	let state = GameState {
		mines: cell(1, 0),
		revealed: cell(0, 0),
		flagged: cell(0, 1) | cell(1, 1),
	};

	assert!(state.solve_subset().is_empty());
}

#[test]
fn solve_exact_does_not_enumerate_flagged_squares() {
	let mine = cell(1, 0);
	let safe = cell(0, 1) | cell(1, 1);
	let state = GameState {
		mines: mine,
		revealed: cell(0, 0),
		flagged: mine,
	};

	assert_eq!(state.frontier(), mine | safe);
	assert_eq!(state.solve_exact(), Deductions {
		always_mine: 0,
		always_safe: !(state.revealed | state.flagged),
	});
	assert_eq!(state.solve(), state.solve_exact());
}

#[test]
fn solve_exact_finds_safe_cells_outside_the_frontier() {
	let revealed = cell(0, 0);
	let frontier = NEIGHBOURS[0];
	let outside = !(revealed | frontier);
	let state = GameState {
		// The revealed corner says that exactly one of its three neighbours is a
		// mine. Because this is also the board's only mine, every cell beyond
		// those three neighbours is certainly safe.
		mines: cell(1, 0),
		revealed,
		flagged: 0,
	};

	assert_eq!(state.frontier(), frontier);
	assert!(state.solve_total().is_empty());
	assert_eq!(state.solve_exact(), Deductions {
		always_mine: 0,
		always_safe: outside,
	});
	assert_eq!(state.solve(), state.solve_exact());
}

#[test]
fn solve_exact_finds_mines_outside_the_frontier() {
	let revealed = cell(0, 0);
	let frontier = NEIGHBOURS[0];
	let outside = !(revealed | frontier);
	let state = GameState {
		// One mine must neighbour the revealed corner. All remaining unknown
		// cells must also be mines to reach the board's total mine count.
		mines: cell(1, 0) | outside,
		revealed,
		flagged: 0,
	};

	assert!(state.solve_total().is_empty());
	assert_eq!(state.solve_exact(), Deductions {
		always_mine: outside,
		always_safe: 0,
	});
	assert_eq!(state.solve(), state.solve_exact());
}
