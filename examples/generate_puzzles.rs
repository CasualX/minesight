use std::io::{self, Write};

const DEFAULT_PUZZLES: usize = 100;

#[derive(Copy, Clone)]
enum Difficulty {
	Easy,
	Medium,
	Hard,
}

fn parse_difficulty(value: &str) -> Option<Difficulty> {
	match value {
		"easy" => Some(Difficulty::Easy),
		"medium" => Some(Difficulty::Medium),
		"hard" => Some(Difficulty::Hard),
		_ => None,
	}
}

fn parse_count(value: &str) -> Result<usize, String> {
	match value.parse() {
		Ok(0) => Err("count must be greater than zero".to_owned()),
		Ok(count) => Ok(count),
		Err(error) => Err(format!("invalid count: {error}")),
	}
}

fn parse_args() -> (Difficulty, usize) {
	let matches = clap::Command::new("generate_puzzles")
		.about("Generate an HTML gallery of Minesight puzzles")
		.arg(clap::Arg::new("difficulty").required(true).value_parser(["easy", "medium", "hard"]))
		.arg(clap::Arg::new("count").short('n').long("count").value_name("COUNT").value_parser(parse_count))
		.arg(clap::Arg::new("positional_count").index(2).value_name("COUNT").value_parser(parse_count).conflicts_with("count"))
		.get_matches();

	let difficulty = parse_difficulty(matches.get_one::<String>("difficulty").unwrap()).unwrap();
	let count = matches.get_one::<usize>("count").or_else(|| matches.get_one::<usize>("positional_count")).copied().unwrap_or(DEFAULT_PUZZLES);
	(difficulty, count)
}

impl Difficulty {
	fn generate(self, seed: u64) -> minetacs::Puzzle {
		match self {
			Difficulty::Easy => minetacs::generate_easy_puzzle(seed),
			Difficulty::Medium => minetacs::generate_medium_puzzle(seed),
			Difficulty::Hard => minetacs::generate_hard_puzzle(seed),
		}
	}

	fn accepts(self, puzzle: &minetacs::Puzzle) -> bool {
		let counts_match = match self {
			Difficulty::Easy => puzzle.forced.count() >= 3,
			Difficulty::Medium => puzzle.forced.count() >= 2 && puzzle.ambiguous >= 2,
			Difficulty::Hard => puzzle.forced.count() >= 3 && puzzle.active_cells().count_ones() >= 8,
		};
		let shape_matches = match self {
			Difficulty::Easy => {
				let mut state = puzzle.state;
				state.apply(puzzle.forced);
				state.solve_exact().is_empty()
			}
			Difficulty::Medium | Difficulty::Hard => !puzzle.forced.is_empty(),
		};
		counts_match && shape_matches
	}
}

fn title(difficulty: Difficulty) -> &'static str {
	match difficulty {
		Difficulty::Easy => "Easy puzzles",
		Difficulty::Medium => "Medium puzzles",
		Difficulty::Hard => "Hard puzzles",
	}
}

fn intro(difficulty: Difficulty) -> &'static str {
	match difficulty {
		Difficulty::Easy => "Find squares that must be safe or contain a mine using local deductions from nearby clues. Highlighted squares show the answers, while faded squares are outside the puzzle.",
		Difficulty::Medium => "Find squares that must be safe or contain a mine by comparing clues across a wider part of the board. Highlighted squares show the answers, while faded squares are outside the puzzle.",
		Difficulty::Hard => "Find squares that must be safe or contain a mine in a broader, more tangled position where several clues and possibilities must be tracked together. Highlighted squares show the answers, while faded squares are outside the puzzle.",
	}
}

fn hidden_truth(state: &minetacs::GameState, cell: u8, x: i8, y: i8) -> String {
	if cell & minetacs::CELL_MINE != 0 {
		return r#"<span class="truth truth-mine">✹</span>"#.to_owned();
	}

	let clue = state.clue(x, y);
	let text = if clue == 0 { "·".to_owned() } else { clue.to_string() };
	format!(r#"<span class="truth clue-{clue}">{text}</span>"#)
}

fn write_cell(out: &mut impl Write, puzzle: &minetacs::Puzzle, cell: u8, x: i8, y: i8) -> io::Result<()> {
	let bit = 1u64 << (y as u32 * 8 + x as u32);
	let state = &puzzle.state;

	if state.is_revealed(x, y) {
		let clue = state.clue(x, y);
		let text = if clue == 0 { String::new() } else { clue.to_string() };
		return write!(out, r#"<span class="cell revealed clue-{clue}" title="revealed">{text}</span>"#);
	}

	if state.is_flagged(x, y) {
		return write!(out, r#"<span class="cell covered flag" title="mine already marked"><span class="marker">⚑</span></span>"#);
	}

	let frontier = state.frontier();
	if puzzle.forced.always_mine & bit != 0 {
		return write!(out, r#"<span class="cell covered known known-mine" title="mine to find"><span class="marker">⚑</span></span>"#);
	}

	let truth = hidden_truth(state, cell, x, y);
	if puzzle.forced.always_safe & bit != 0 {
		return write!(out, r#"<span class="cell covered known known-safe" title="safe square to find">{truth}<span class="marker">✓</span></span>"#);
	}

	if frontier & bit == 0 {
		write!(out, r#"<span class="cell covered distant" title="outside this puzzle">{truth}</span>"#)
	}
	else {
		write!(out, r#"<span class="cell covered frontier" title="square to consider">{truth}</span>"#)
	}
}

fn write_puzzle(out: &mut impl Write, index: usize, puzzle: &minetacs::Puzzle) -> io::Result<()> {
	let cells = puzzle.cells();
	let frontier = puzzle.active_cells().count_ones();
	let known = puzzle.forced.count();

	writeln!(out, r#"<article class="puzzle">"#)?;
	writeln!(out, r#"<header><strong>#{index}</strong><span>seed {}</span></header>"#, puzzle.seed)?;
	writeln!(out, r#"<div class="board" role="img" aria-label="Puzzle {index}">"#)?;
	for y in 0..8 {
		for x in 0..8 {
			write_cell(out, puzzle, cells[y as usize * 8 + x as usize], x, y)?;
		}
	}
	writeln!(out, "</div>")?;
	writeln!(out, r#"<footer><span>{frontier} to consider</span><span>{known} answers</span><span>{} uncertain</span></footer>"#, puzzle.ambiguous)?;
	writeln!(out, "</article>")
}

fn main() -> io::Result<()> {
	let (difficulty, count) = parse_args();

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
.truth, .marker {{ grid-area: 1 / 1; }}
.truth {{ opacity: .4; font-size: .78em; text-shadow: none; }}
.truth-mine {{ color: #ffbbc0; font-size: .95em; }}
.marker {{ position: relative; z-index: 1; }}
.flag .truth, .known .truth {{ place-self: end; margin: 0 1px 1px 0; font-size: .52em; opacity: .5; }}
.flag {{ color: #ff5f69; }}
.distant {{ opacity: .5; }}
.distant .truth {{ opacity: 1; }}
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
 <span class="key"><i class="cell covered frontier"></i>square to consider</span>
 <span class="key"><i class="cell covered distant"></i>outside puzzle</span>
 <span class="key"><i class="cell covered"><span class="truth clue-2">2</span></i>hidden number</span>
 <span class="key"><i class="cell covered"><span class="truth truth-mine">✹</span></i>hidden mine</span>
 <span class="key"><i class="cell covered known known-safe">✓</i>safe answer</span>
 <span class="key"><i class="cell covered flag">⚑</i>mine answer</span>
</div>
<section class="gallery">"#,
		title = title(difficulty),
		intro = intro(difficulty),
	)?;

	let mut found = 0;
	let mut seed = 0;
	while found < count {
		let puzzle = difficulty.generate(seed);
		if difficulty.accepts(&puzzle) {
			found += 1;
			write_puzzle(&mut out, found, &puzzle)?;
			eprintln!("generated {found}/{count} boards");
		}
		seed = seed.checked_add(1).expect("ran out of seeds");
	}

	writeln!(out, "</section>\n</main>\n</body>\n</html>")
}
