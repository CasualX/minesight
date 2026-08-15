use super::*;

#[link(wasm_import_module = "env")]
unsafe extern "C" {
	/// JavaScript must copy `cells` before this callback returns.
	/// The buffer is 64 row-major bytes using the public `CELL_*` bit layout.
	fn resultPuzzle(seed_low: u32, seed_high: u32, cells: *const u8, len: usize);
}

/// Generates an easy tactics puzzle and returns it through `env.resultPuzzle`.
#[unsafe(export_name = "randomEasyPuzzle")]
pub extern "C" fn random_easy_puzzle_wasm(
	min_forced: u32,
	max_forced: u32,
	min_ambiguous: u32,
	max_ambiguous: u32,
	min_active: u32,
	seed_low: u32,
	seed_high: u32,
	max_attempts: u32,
) -> bool {
	generate_puzzle(
		generate_easy_puzzle,
		exhausts_exact_deductions,
		min_forced,
		max_forced,
		min_ambiguous,
		max_ambiguous,
		min_active,
		seed_low,
		seed_high,
		max_attempts,
	)
}

/// Generates a medium tactics puzzle and returns it through `env.resultPuzzle`.
#[unsafe(export_name = "randomMediumPuzzle")]
pub extern "C" fn random_medium_puzzle_wasm(
	min_forced: u32,
	max_forced: u32,
	min_ambiguous: u32,
	max_ambiguous: u32,
	min_active: u32,
	seed_low: u32,
	seed_high: u32,
	max_attempts: u32,
) -> bool {
	generate_puzzle(
		generate_medium_puzzle,
		has_forced_deductions,
		min_forced,
		max_forced,
		min_ambiguous,
		max_ambiguous,
		min_active,
		seed_low,
		seed_high,
		max_attempts,
	)
}

/// Generates a hard tactics puzzle and returns it through `env.resultPuzzle`.
#[unsafe(export_name = "randomHardPuzzle")]
pub extern "C" fn random_hard_puzzle_wasm(
	min_forced: u32,
	max_forced: u32,
	min_ambiguous: u32,
	max_ambiguous: u32,
	min_active: u32,
	seed_low: u32,
	seed_high: u32,
	max_attempts: u32,
) -> bool {
	generate_puzzle(
		generate_hard_puzzle,
		has_forced_deductions,
		min_forced,
		max_forced,
		min_ambiguous,
		max_ambiguous,
		min_active,
		seed_low,
		seed_high,
		max_attempts,
	)
}

/// The raw ABI keeps puzzle generation in Rust without requiring `wasm-bindgen`.
/// Limits are inclusive; `min_active` applies to forced and ambiguous frontier cells combined.
/// The seed is passed as two 32-bit halves because JavaScript numbers cannot represent all `u64` values exactly.
/// At most `max_attempts` consecutive seeds are checked.
/// Returns false without invoking the callback if no matching puzzle is found.
fn generate_puzzle(
	generator: fn(u64) -> Puzzle,
	shape_matches: fn(&Puzzle) -> bool,
	min_forced: u32,
	max_forced: u32,
	min_ambiguous: u32,
	max_ambiguous: u32,
	min_active: u32,
	seed_low: u32,
	seed_high: u32,
	max_attempts: u32,
) -> bool {
	let mut seed = u64::from(seed_low) | u64::from(seed_high) << 32;
	let mut found = None;
	for _ in 0..max_attempts {
		let puzzle = generator(seed);
		let counts_match = (min_forced..=max_forced).contains(&puzzle.forced.count()) &&
			(min_ambiguous..=max_ambiguous).contains(&puzzle.ambiguous) &&
			puzzle.forced.count() + puzzle.ambiguous >= min_active;
		if counts_match && shape_matches(&puzzle) {
			found = Some(puzzle);
			break;
		}
		seed = seed.wrapping_add(1);
	}

	let Some(puzzle) = found else {
		return false;
	};
	let cells = puzzle.cells();
	let actual_seed_low = puzzle.seed as u32;
	let actual_seed_high = (puzzle.seed >> 32) as u32;

	unsafe {
		resultPuzzle(actual_seed_low, actual_seed_high, cells.as_ptr(), cells.len());
	}
	true
}

/// Easy puzzles must contain only the advertised two-clue deductions.
fn exhausts_exact_deductions(puzzle: &Puzzle) -> bool {
	let mut state = puzzle.state;
	state.apply(puzzle.forced);
	try_solve_exact(&state, MAX_PUZZLE_EXACT_FRONTIER).is_some_and(|deductions| deductions.is_empty())
}

fn has_forced_deductions(puzzle: &Puzzle) -> bool {
	!puzzle.forced.is_empty()
}
