use super::*;

#[link(wasm_import_module = "env")]
unsafe extern "C" {
	/// JavaScript must copy `cells` before this callback returns.
	/// The buffer is 64 row-major bytes using the public `CELL_*` bit layout.
	fn resultPuzzle(seed_low: u32, seed_high: u32, attempts: u32, cells: *const u8, len: usize);
}

/// Generates an easy tactics puzzle and returns it through `env.resultPuzzle`.
#[unsafe(export_name = "randomEasyPuzzle")]
pub extern "C" fn random_easy_puzzle_wasm(seed_low: u32, seed_high: u32, attempts: u32) -> bool {
	generate_puzzle(generate_easy_puzzle, seed_low, seed_high, attempts)
}

/// Generates a medium tactics puzzle and returns it through `env.resultPuzzle`.
#[unsafe(export_name = "randomMediumPuzzle")]
pub extern "C" fn random_medium_puzzle_wasm(seed_low: u32, seed_high: u32, attempts: u32) -> bool {
	generate_puzzle(generate_medium_puzzle, seed_low, seed_high, attempts)
}

/// Generates a hard tactics puzzle and returns it through `env.resultPuzzle`.
#[unsafe(export_name = "randomHardPuzzle")]
pub extern "C" fn random_hard_puzzle_wasm(seed_low: u32, seed_high: u32, attempts: u32) -> bool {
	generate_puzzle(generate_hard_puzzle, seed_low, seed_high, attempts)
}

/// Generates an expert tactics puzzle and returns it through `env.resultPuzzle`.
#[unsafe(export_name = "randomExpertPuzzle")]
pub extern "C" fn random_expert_puzzle_wasm(seed_low: u32, seed_high: u32, attempts: u32) -> bool {
	generate_puzzle(generate_expert_puzzle, seed_low, seed_high, attempts)
}

/// Generates an MIT-style puzzle and returns it through `env.resultPuzzle`.
#[unsafe(export_name = "randomMitPuzzle")]
pub extern "C" fn random_mit_puzzle_wasm(seed_low: u32, seed_high: u32, attempts: u32) -> bool {
	generate_puzzle(generate_mit_puzzle::<100>, seed_low, seed_high, attempts)
}

/// The raw ABI keeps the full search in Rust without requiring `wasm-bindgen`.
/// `attempts` is the number of jump-separated candidates to try.
/// The seed is passed as two 32-bit halves because JavaScript numbers cannot represent all `u64` values exactly.
/// Returns false without invoking the callback if no matching puzzle is found.
fn generate_puzzle(generator: fn(u64, u32) -> Option<Puzzle>, seed_low: u32, seed_high: u32, attempts: u32) -> bool {
	let seed = u64::from(seed_low) | u64::from(seed_high) << 32;
	let Some(puzzle) = generator(seed, attempts) else {
		return false;
	};

	let cells = puzzle.cells();
	unsafe {
		resultPuzzle(seed_low, seed_high, puzzle.attempts, cells.as_ptr(), cells.len());
	}

	return true;
}
