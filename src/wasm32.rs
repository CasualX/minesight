use super::{puzzle::*, sat};
use std::alloc;

const MAX_SOLVE_WIDTH: u8 = 8;
const MAX_SOLVE_HEIGHT: u8 = 8;
const MAX_SOLVE_CELLS: usize = MAX_SOLVE_WIDTH as usize * MAX_SOLVE_HEIGHT as usize;

#[derive(Copy, Clone, Eq, PartialEq)]
#[repr(u8)]
// Variants are constructed by the validated wire-buffer cast in solve_wasm.
#[allow(dead_code)]
enum Cell {
	Clue0 = 0,
	Clue1 = 1,
	Clue2 = 2,
	Clue3 = 3,
	Clue4 = 4,
	Clue5 = 5,
	Clue6 = 6,
	Clue7 = 7,
	Clue8 = 8,
	Masked = 9,
	Covered = 10,
	Flagged = 11,
}

impl Cell {
	fn clue(self) -> Option<u8> {
		let value = self as u8;
		(value <= Cell::Clue8 as u8).then_some(value)
	}
}

struct SolveBoard<'a> {
	width: u8,
	height: u8,
	cells: &'a [Cell],
}

#[link(wasm_import_module = "env")]
unsafe extern "C" {
	/// JavaScript must copy `cells` before this callback returns.
	/// The buffer is 64 row-major bytes using the public `CELL_*` bit layout.
	fn resultPuzzle(seed_low: u32, seed_high: u32, attempts: u32, cells: *const u8, len: usize);

	fn resultError(ptr: *const u8, len: usize);

	fn resultSolve(ptr: *const SolveEntry, len: usize);
}

#[repr(C)]
struct SolveEntry {
	x: u8,
	y: u8,
	mine: bool,
}

fn error<E: ToString>(err: &E) {
	let s = err.to_string();
	unsafe {
		resultError(s.as_ptr(), s.len());
	}
}

fn validate_dimensions(width: u8, height: u8) -> Result<(), &'static str> {
	if width > MAX_SOLVE_WIDTH || height > MAX_SOLVE_HEIGHT {
		return Err("board width and height must not exceed 8");
	}
	Ok(())
}

fn bit_index(x: u8, y: u8) -> usize {
	y as usize * MAX_SOLVE_WIDTH as usize + x as usize
}

fn cell_index(board: &SolveBoard<'_>, x: u8, y: u8) -> usize {
	y as usize * board.width as usize + x as usize
}

fn adjacent_mask(board: &SolveBoard<'_>, x: u8, y: u8) -> (u64, u8) {
	let mut vars = 0;
	let mut flags = 0;
	let min_x = x.saturating_sub(1);
	let min_y = y.saturating_sub(1);
	let max_x = x.saturating_add(1).min(board.width.saturating_sub(1));
	let max_y = y.saturating_add(1).min(board.height.saturating_sub(1));

	for adjacent_y in min_y..=max_y {
		for adjacent_x in min_x..=max_x {
			if adjacent_x == x && adjacent_y == y {
				continue;
			}
			match board.cells[cell_index(board, adjacent_x, adjacent_y)] {
				Cell::Covered => vars |= 1u64 << bit_index(adjacent_x, adjacent_y),
				Cell::Flagged => flags += 1,
				_ => {},
			}
		}
	}
	(vars, flags)
}

fn solve_board(board: &SolveBoard<'_>) -> Result<Vec<SolveEntry>, &'static str> {
	validate_dimensions(board.width, board.height)?;
	let mut state: sat::State<MAX_SOLVE_CELLS> = sat::State::EMPTY;

	for y in 0..board.height {
		for x in 0..board.width {
			if let Some(clue) = board.cells[cell_index(board, x, y)].clue() {
				let (vars, flags) = adjacent_mask(board, x, y);
				let sum = clue.checked_sub(flags).ok_or("board clues and flags contradict each other")?;
				state.push(vars, sum).ok_or("board contains too many clues")?;
			}
		}
	}

	let forced = state.solve().ok_or("board clues and flags contradict each other")?;
	let mut result = Vec::with_capacity((forced.one | forced.zero).count_ones() as usize);
	for index in 0..MAX_SOLVE_CELLS {
		let bit = 1u64 << index;
		if (forced.one | forced.zero) & bit != 0 {
			result.push(SolveEntry {
				x: index as u8 % MAX_SOLVE_WIDTH,
				y: index as u8 / MAX_SOLVE_WIDTH,
				mine: forced.one & bit != 0,
			});
		}
	}
	Ok(result)
}

/// Allocates `size` bytes with `align` alignment using Rust's global allocator.
/// The allocation must eventually be returned to [`free_wasm`] with the exact
/// same size and alignment.
#[unsafe(export_name = "allocate")]
pub extern "C" fn allocate_wasm(size: usize, align: usize) -> *mut u8 {
	match alloc::Layout::from_size_align(size, align) {
		Ok(layout) => {
			let pointer = unsafe { alloc::alloc(layout) };
			if pointer.is_null() {
				error(&"memory allocation failed");
			}
			pointer
		}
		Err(err) => {
			error(&err);
			std::ptr::null_mut()
		}
	}
}

/// Returns an allocation to Rust's global allocator. `size` and `align` must
/// exactly match the values originally passed to [`allocate_wasm`].
#[unsafe(export_name = "free")]
pub unsafe extern "C" fn free_wasm(pointer: *mut u8, size: usize, align: usize) -> bool {
	if pointer.is_null() {
		error(&"cannot free a null pointer");
		return false;
	}
	match alloc::Layout::from_size_align(size, align) {
		Ok(layout) => {
			unsafe { alloc::dealloc(pointer, layout); }
			true
		},
		Err(err) => {
			error(&err);
			false
		},
	}
}

/// Borrows an input encoded as `{ width: u8, height: u8, cells: [u8] }`,
/// computes exact SAT deductions, and reports the forced covered cells through
/// `env.resultSolve`. The caller retains ownership of the input allocation.
#[unsafe(export_name = "solve")]
pub unsafe extern "C" fn solve_wasm(pointer: *const u8) -> bool {
	if pointer.is_null() {
		error(&"solve received a null board");
		return false;
	}

	let width = unsafe { pointer.read() };
	let height = unsafe { pointer.add(1).read() };
	if let Err(err) = validate_dimensions(width, height) {
		error(&err);
		return false;
	}
	let cell_count = width as usize * height as usize;
	let cells = unsafe { std::slice::from_raw_parts(pointer.add(2), cell_count) };
	if cells.iter().any(|&cell| cell > Cell::Flagged as u8) {
		error(&"board contains an invalid cell value");
		return false;
	}
	let board = SolveBoard {
		width,
		height,
		// Cell is repr(u8), and every byte was checked to be one of its
		// contiguous discriminants before constructing this typed slice.
		cells: unsafe { std::slice::from_raw_parts(cells.as_ptr().cast::<Cell>(), cell_count) },
	};
	let result = match solve_board(&board) {
		Ok(result) => result,
		Err(err) => {
			error(&err);
			return false;
		},
	};
	unsafe {
		resultSolve(result.as_ptr(), result.len());
	}
	true
}

/// Generates an easy tactics puzzle and returns it through `env.resultPuzzle`.
#[unsafe(export_name = "randomEasyPuzzle")]
pub extern "C" fn random_easy_puzzle_wasm(seed_low: u32, seed_high: u32, attempts: u32) -> bool {
	generate_puzzle(generate_easy, seed_low, seed_high, attempts)
}

/// Generates a medium tactics puzzle and returns it through `env.resultPuzzle`.
#[unsafe(export_name = "randomMediumPuzzle")]
pub extern "C" fn random_medium_puzzle_wasm(seed_low: u32, seed_high: u32, attempts: u32) -> bool {
	generate_puzzle(generate_medium, seed_low, seed_high, attempts)
}

/// Generates a hard tactics puzzle and returns it through `env.resultPuzzle`.
#[unsafe(export_name = "randomHardPuzzle")]
pub extern "C" fn random_hard_puzzle_wasm(seed_low: u32, seed_high: u32, attempts: u32) -> bool {
	generate_puzzle(generate_hard, seed_low, seed_high, attempts)
}

/// Generates an expert tactics puzzle and returns it through `env.resultPuzzle`.
#[unsafe(export_name = "randomExpertPuzzle")]
pub extern "C" fn random_expert_puzzle_wasm(seed_low: u32, seed_high: u32, attempts: u32) -> bool {
	generate_puzzle(generate_expert, seed_low, seed_high, attempts)
}

/// Generates an MIT-style puzzle and returns it through `env.resultPuzzle`.
#[unsafe(export_name = "randomMitPuzzle")]
pub extern "C" fn random_mit_puzzle_wasm(seed_low: u32, seed_high: u32, attempts: u32) -> bool {
	generate_puzzle(generate_mit, seed_low, seed_high, attempts)
}

/// The raw ABI keeps the full search in Rust without requiring `wasm-bindgen`.
/// `attempts` is the number of candidates to try.
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
