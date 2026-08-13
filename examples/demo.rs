use std::io::{self, Write};

use minetacs::{GameState, Gradient, Deductions};

const DEFAULT_PUZZLES: usize = 1000;
const CENTER_DENSITY: i32 = Gradient::DENOMINATOR * 35 / 100;
const DENSITY_STEP: i32 = Gradient::DENOMINATOR / 16;

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
enum Difficulty {
	Easy,
	Medium,
	Hard,
}

impl Difficulty {
	fn parse(value: &str) -> Option<Difficulty> {
		match value {
			"easy" => Some(Difficulty::Easy),
			"medium" => Some(Difficulty::Medium),
			"hard" => Some(Difficulty::Hard),
			_ => None,
		}
	}

	fn title(self) -> &'static str {
		match self {
			Difficulty::Easy => "Easy subset puzzles",
			Difficulty::Medium => "Medium exact puzzles",
			Difficulty::Hard => "Hard exact puzzles",
		}
	}

	fn intro(self) -> &'static str {
		match self {
			Difficulty::Easy => "Each board is shown after ordinary local deductions stall. One subset pass finds the highlighted cells; after those deductions, the exact solver finds nothing else. Faded covered cells are beyond the current frontier.",
			Difficulty::Medium => "Each board is shown after repeated subset deductions stall. Its frontier has two to four exact-known cells and two to four ambiguous cells; the four-and-four boundary belongs to hard. Each puzzle includes reasoning beyond the total mine count. Faded covered cells are beyond the current frontier.",
			Difficulty::Hard => "Each board is shown after repeated subset deductions stall. Its frontier has at least four exact-known and four ambiguous cells, including reasoning beyond the total mine count. Faded covered cells are beyond the current frontier.",
		}
	}

	fn applied_solver(self) -> &'static str {
		match self {
			Difficulty::Easy => "local",
			Difficulty::Medium | Difficulty::Hard => "subset",
		}
	}

	fn known_solver(self) -> &'static str {
		match self {
			Difficulty::Easy => "subset",
			Difficulty::Medium | Difficulty::Hard => "exact",
		}
	}
}

struct Puzzle {
	seed: u64,
	state: GameState,
	known: Deductions,
	ambiguous: u32,
}

fn apply_until_stuck(state: &mut GameState, solve: fn(&GameState) -> Deductions) {
	loop {
		let deductions = solve(state);
		if deductions.is_empty() {
			return;
		}
		state.apply(deductions);
	}
}

fn random_state(seed: u64) -> GameState {
	let mut rng = urandom::seeded(seed);
	let gradient = Gradient::random(&mut rng, CENTER_DENSITY, DENSITY_STEP);
	GameState::random(rng.random(), &gradient)
}

fn easy_puzzle(seed: u64) -> Option<Puzzle> {
	// GameState::random starts with every zero-clue region and its numbered edge
	// revealed, just as an ordinary Minesweeper opening would.
	let mut state = random_state(seed);
	apply_until_stuck(&mut state, GameState::solve_local);

	let known = state.solve_subset();
	if (known.always_mine | known.always_safe).count_ones() < 3 {
		return None;
	}

	let mut after_subset = state;
	after_subset.apply(known);
	if !after_subset.solve_exact().is_empty() {
		return None;
	}

	let ambiguous = ambiguous_count(&state, known);
	Some(Puzzle { seed, state, known, ambiguous })
}

fn classify_exact(known: u32, ambiguous: u32) -> Option<Difficulty> {
	if known >= 4 && ambiguous >= 4 {
		Some(Difficulty::Hard)
	}
	else if (2..=4).contains(&known) && (2..=4).contains(&ambiguous) {
		Some(Difficulty::Medium)
	}
	else {
		None
	}
}

fn exact_puzzle(seed: u64, wanted: Difficulty) -> Option<Puzzle> {
	let mut state = random_state(seed);
	apply_until_stuck(&mut state, GameState::solve_subset);

	let frontier = unflagged_frontier(&state);
	let exact = state.solve_exact();
	let known = Deductions {
		always_mine: exact.always_mine & frontier,
		always_safe: exact.always_safe & frontier,
	};
	let known_count = (known.always_mine | known.always_safe).count_ones();
	let ambiguous = ambiguous_count(&state, known);
	if classify_exact(known_count, ambiguous) != Some(wanted) {
		return None;
	}

	// Exact deductions that are all also returned by solve_total are merely
	// global mine-count bookkeeping, rather than a frontier deduction.
	let total = state.solve_total();
	let exact_only_mines = known.always_mine & !total.always_mine;
	let exact_only_safe = known.always_safe & !total.always_safe;
	if exact_only_mines | exact_only_safe == 0 {
		return None;
	}

	Some(Puzzle { seed, state, known, ambiguous })
}

fn medium_puzzle(seed: u64) -> Option<Puzzle> {
	exact_puzzle(seed, Difficulty::Medium)
}

fn hard_puzzle(seed: u64) -> Option<Puzzle> {
	exact_puzzle(seed, Difficulty::Hard)
}

fn flagged_squares(state: &GameState) -> u64 {
	let mut flagged = 0;
	for y in 0..8 {
		for x in 0..8 {
			if state.is_flagged(x, y) {
				flagged |= 1u64 << (y * 8 + x);
			}
		}
	}
	flagged
}

fn unflagged_frontier(state: &GameState) -> u64 {
	state.frontier() & !flagged_squares(state)
}

fn ambiguous_count(state: &GameState, known: Deductions) -> u32 {
	let known = known.always_mine | known.always_safe;
	(unflagged_frontier(state) & !known).count_ones()
}

fn write_cell(
	out: &mut impl Write,
	difficulty: Difficulty,
	puzzle: &Puzzle,
	x: i8,
	y: i8,
) -> io::Result<()> {
	let bit = 1u64 << (y as u32 * 8 + x as u32);
	let state = &puzzle.state;

	if state.is_revealed(x, y) {
		let clue = state.clue(x, y);
		let text = if clue == 0 { String::new() } else { clue.to_string() };
		return write!(
			out,
			r#"<span class="cell revealed clue-{clue}" title="revealed">{text}</span>"#,
		);
	}

	if state.is_flagged(x, y) {
		return write!(
			out,
			r#"<span class="cell covered flag" title="known mine ({})">⚑</span>"#,
			difficulty.applied_solver(),
		);
	}

	let frontier = state.frontier();
	if puzzle.known.always_mine & bit != 0 {
		return write!(
			out,
			r#"<span class="cell covered known known-mine" title="known mine ({})">⚑</span>"#,
			difficulty.known_solver(),
		);
	}
	if puzzle.known.always_safe & bit != 0 {
		return write!(
			out,
			r#"<span class="cell covered known known-safe" title="known safe ({})">✓</span>"#,
			difficulty.known_solver(),
		);
	}

	if frontier & bit == 0 {
		write!(out, r#"<span class="cell covered distant" title="unrevealed beyond the frontier"></span>"#)
	}
	else {
		write!(out, r#"<span class="cell covered frontier" title="unrevealed frontier"></span>"#)
	}
}

fn write_puzzle(
	out: &mut impl Write,
	difficulty: Difficulty,
	index: usize,
	puzzle: &Puzzle,
) -> io::Result<()> {
	let frontier = unflagged_frontier(&puzzle.state).count_ones();
	let known = (puzzle.known.always_mine | puzzle.known.always_safe).count_ones();
	let mines_left = puzzle.state.count_mines() - flagged_squares(&puzzle.state).count_ones();

	writeln!(out, r#"<article class="puzzle">"#)?;
	writeln!(out, r#"<header><strong>#{index}</strong><span>seed {}</span></header>"#, puzzle.seed)?;
	writeln!(out, r#"<div class="board" role="img" aria-label="Puzzle {index}">"#)?;
	for y in 0..8 {
		for x in 0..8 {
			write_cell(out, difficulty, puzzle, x, y)?;
		}
	}
	writeln!(out, "</div>")?;
	writeln!(
		out,
		r#"<footer><span>⚑ {mines_left} left</span><span>{frontier} frontier</span><span>{known} known</span><span>{} ambiguous</span></footer>"#,
		puzzle.ambiguous,
	)?;
	writeln!(out, "</article>")
}

fn main() -> io::Result<()> {
	let mut args = std::env::args().skip(1);
	let difficulty = args
		.next()
		.as_deref()
		.and_then(Difficulty::parse)
		.expect("usage: demo <easy|medium|hard> [puzzle count]");
	let count = args
		.next()
		.map(|value| value.parse().expect("puzzle count must be a positive integer"))
		.unwrap_or(DEFAULT_PUZZLES);
	assert!(count > 0, "puzzle count must be a positive integer");
	assert!(args.next().is_none(), "usage: demo <easy|medium|hard> [puzzle count]");

	let generate: fn(u64) -> Option<Puzzle> = match difficulty {
		Difficulty::Easy => easy_puzzle,
		Difficulty::Medium => medium_puzzle,
		Difficulty::Hard => hard_puzzle,
	};

	let stdout = io::stdout();
	let mut out = io::BufWriter::new(stdout.lock());
	writeln!(out, r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
:root {{ color-scheme: dark; font-family: ui-monospace, "Cascadia Mono", monospace; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: #11151b; color: #dce5ef; }}
.page {{ max-width: 1500px; margin: auto; padding: 28px; }}
h1 {{ margin: 0 0 8px; font: 700 28px/1.2 system-ui, sans-serif; }}
.intro {{ max-width: 80ch; margin: 0 0 18px; color: #9ba9b8; font: 14px/1.5 system-ui, sans-serif; }}
.legend {{ display: flex; flex-wrap: wrap; gap: 10px 18px; margin-bottom: 24px; color: #b8c3cf; font-size: 12px; }}
.key {{ display: inline-flex; align-items: center; gap: 7px; }}
.key .cell {{ width: 22px; height: 22px; font-size: 13px; }}
.gallery {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(228px, 1fr)); gap: 18px; align-items: start; }}
.puzzle {{ border: 1px solid #2b3542; border-radius: 7px; background: #181e27; overflow: hidden; box-shadow: 0 5px 18px #0005; }}
.puzzle header, .puzzle footer {{ display: flex; justify-content: space-between; gap: 9px; padding: 8px 10px; color: #8998a8; font-size: 11px; }}
.puzzle header strong {{ color: #dce5ef; font-size: 13px; }}
.puzzle footer {{ border-top: 1px solid #2b3542; }}
.board {{ display: grid; grid-template-columns: repeat(8, 1fr); aspect-ratio: 1; margin: 0 10px 10px; border: 2px solid #707983; background: #242b34; }}
.cell {{ display: grid; place-items: center; min-width: 0; aspect-ratio: 1; font-weight: 800; font-size: clamp(13px, 1.6vw, 19px); line-height: 1; user-select: none; }}
.revealed {{ background: #c7cbd0; color: #3a4149; border: 1px solid #aeb3b8; }}
.covered {{ position: relative; background: #717982; color: #f4f7fa; border: 2px outset #aeb5bd; text-shadow: 0 1px #0008; }}
.flag {{ color: #ff5f69; }}
.distant {{ opacity: .24; }}
.known {{ z-index: 1; }}
.known-safe {{ color: #123824; background: #7be1a1; border-color: #b0f3c8 #398358 #398358 #b0f3c8; text-shadow: none; }}
.known-mine {{ color: #fff; background: #d94b58; border-color: #ff8991 #812a34 #812a34 #ff8991; }}
.clue-1 {{ color: #1767d2; }} .clue-2 {{ color: #16833b; }} .clue-3 {{ color: #d72d38; }}
.clue-4 {{ color: #6333ad; }} .clue-5 {{ color: #8d271d; }} .clue-6 {{ color: #087c86; }}
.clue-7 {{ color: #20252a; }} .clue-8 {{ color: #656a70; }}
@media (max-width: 540px) {{ .page {{ padding: 18px 12px; }} .gallery {{ grid-template-columns: repeat(auto-fill, minmax(165px, 1fr)); gap: 10px; }} }}
</style>
</head>
<body>
<main class="page">
<h1>{title}</h1>
<p class="intro">{intro}</p>
<div class="legend">
 <span class="key"><i class="cell covered frontier"></i>frontier</span>
 <span class="key"><i class="cell covered distant"></i>beyond frontier</span>
 <span class="key"><i class="cell covered known known-safe">✓</i>known safe</span>
 <span class="key"><i class="cell covered flag">⚑</i>{applied_solver} flag</span>
</div>
<section class="gallery">"#,
		title = difficulty.title(),
		intro = difficulty.intro(),
		applied_solver = difficulty.applied_solver(),
	)?;

	let mut found = 0;
	let mut seed = 0;
	while found < count {
		if let Some(puzzle) = generate(seed) {
			found += 1;
			write_puzzle(&mut out, difficulty, found, &puzzle)?;
			eprintln!("generated {found}/{count} boards");
		}
		seed = seed.checked_add(1).expect("ran out of seeds");
	}

	writeln!(out, "</section>\n</main>\n</body>\n</html>")
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn classifies_exact_frontier_size() {
		assert_eq!(classify_exact(1, 4), None);
		assert_eq!(classify_exact(4, 1), None);
		assert_eq!(classify_exact(2, 2), Some(Difficulty::Medium));
		assert_eq!(classify_exact(4, 3), Some(Difficulty::Medium));
		assert_eq!(classify_exact(3, 4), Some(Difficulty::Medium));
		assert_eq!(classify_exact(4, 4), Some(Difficulty::Hard));
		assert_eq!(classify_exact(5, 4), Some(Difficulty::Hard));
		assert_eq!(classify_exact(4, 5), Some(Difficulty::Hard));
		assert_eq!(classify_exact(5, 3), None);
		assert_eq!(classify_exact(3, 5), None);
	}
}
