use rayon::prelude::*;
use std::io::{self, Write};

const DEFAULT_PUZZLES: u64 = 100;
const DEFAULT_ATTEMPTS: u32 = 1000;
const PUBLIC_URL: &str = "https://casualhacks.net/minesight/";

#[derive(Copy, Clone)]
enum Difficulty {
	Easy,
	Medium,
	Hard,
	Expert,
	Impossible,
	Mit,
}

fn parse_difficulty(value: &str) -> Option<Difficulty> {
	match value {
		"easy" => Some(Difficulty::Easy),
		"medium" => Some(Difficulty::Medium),
		"hard" => Some(Difficulty::Hard),
		"expert" => Some(Difficulty::Expert),
		"impossible" => Some(Difficulty::Impossible),
		"mit" => Some(Difficulty::Mit),
		_ => None,
	}
}

fn parse_count(value: &str) -> Result<u64, String> {
	let count = match value.strip_prefix("0x").or_else(|| value.strip_prefix("0X")) {
		Some(value) => u64::from_str_radix(value, 16),
		None => value.parse(),
	};

	match count {
		Ok(0) => Err("count must be greater than zero".to_owned()),
		Ok(count) => Ok(count),
		Err(error) => Err(format!("invalid count: {error}")),
	}
}

fn parse_args() -> (Difficulty, u64, u32) {
	let matches = clap::Command::new("generate_puzzles")
		.about("Generate an HTML gallery of Minesight puzzles")
		.arg(clap::Arg::new("difficulty").required(true).value_parser(["easy", "medium", "hard", "expert", "impossible", "mit"]))
		.arg(clap::Arg::new("count").short('n').long("count").value_name("COUNT").value_parser(parse_count))
		.arg(clap::Arg::new("attempts").long("attempts").value_name("ATTEMPTS").default_value("1000").value_parser(clap::value_parser!(u32)))
		.arg(clap::Arg::new("positional_count").index(2).value_name("COUNT").value_parser(parse_count).conflicts_with("count"))
		.get_matches();

	let difficulty = parse_difficulty(matches.get_one::<String>("difficulty").unwrap()).unwrap();
	let count = matches.get_one::<u64>("count").or_else(|| matches.get_one::<u64>("positional_count")).copied().unwrap_or(DEFAULT_PUZZLES);
	let attempts = matches.get_one::<u32>("attempts").copied().unwrap_or(DEFAULT_ATTEMPTS);
	(difficulty, count, attempts)
}

impl Difficulty {
	fn generate(self, seed: u64, attempts: u32) -> Option<minetacs::puzzle::Puzzle> {
		match self {
			Difficulty::Easy => minetacs::puzzle::generate_easy(seed, attempts),
			Difficulty::Medium => minetacs::puzzle::generate_medium(seed, attempts),
			Difficulty::Hard => minetacs::puzzle::generate_hard(seed, attempts),
			Difficulty::Expert => minetacs::puzzle::generate_expert(seed, attempts),
			Difficulty::Impossible => minetacs::puzzle::generate_impossible(seed, attempts),
			Difficulty::Mit => minetacs::puzzle::generate_mit(seed, attempts),
		}
	}
}

fn title(difficulty: Difficulty) -> &'static str {
	match difficulty {
		Difficulty::Easy => "Easy puzzles",
		Difficulty::Medium => "Medium puzzles",
		Difficulty::Hard => "Hard puzzles",
		Difficulty::Expert => "Expert puzzles",
		Difficulty::Impossible => "Impossible puzzles",
		Difficulty::Mit => "MIT-style puzzles",
	}
}

fn intro(difficulty: Difficulty) -> &'static str {
	match difficulty {
		Difficulty::Easy => "Recognize familiar patterns on a mostly open board to find squares that must be safe or contain a mine. Highlighted squares show the answers, while faded squares are outside the puzzle.",
		Difficulty::Medium => "Recognize patterns on a denser board where finding squares that must be safe or contain a mine requires more scanning. Highlighted squares show the answers, while faded squares are outside the puzzle.",
		Difficulty::Hard => "Follow deeper chains of logic to find squares that must be safe or contain a mine. Highlighted squares show the answers, while faded squares are outside the puzzle.",
		Difficulty::Expert => "Find squares that must be safe or contain a mine in a broader, more tangled position where several clues and possibilities must be tracked together. Highlighted squares show the answers, while faded squares are outside the puzzle.",
		Difficulty::Impossible => "Use contradiction and nested case splits to find the least approachable forced moves from a best-of candidate search. Highlighted squares show the answers, while faded squares are outside the puzzle.",
		Difficulty::Mit => "Determine the unique mine layout from a minimal set of clues. Every active square has one logically forced answer.",
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

fn write_cell(out: &mut impl Write, puzzle: &minetacs::puzzle::Puzzle, cell: u8, x: i8, y: i8) -> io::Result<()> {
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
	if puzzle.forced.mines & bit != 0 {
		return write!(out, r#"<span class="cell covered known known-mine" title="mine to find"><span class="marker">⚑</span></span>"#);
	}

	let truth = hidden_truth(state, cell, x, y);
	if puzzle.forced.safe & bit != 0 {
		return write!(out, r#"<span class="cell covered known known-safe" title="safe square to find">{truth}<span class="marker">✓</span></span>"#);
	}

	if frontier & bit == 0 {
		write!(out, r#"<span class="cell covered distant" title="outside this puzzle">{truth}</span>"#)
	}
	else {
		write!(out, r#"<span class="cell covered frontier" title="square to consider">{truth}</span>"#)
	}
}

fn write_puzzle(out: &mut impl Write, index: usize, puzzle: &minetacs::puzzle::Puzzle) -> io::Result<()> {
	let cells = puzzle.cells();
	let frontier = puzzle.state.active().count_ones();
	let known = puzzle.forced.count();
	let payload = puzzle.encode();

	writeln!(out, r#"<article class="puzzle">"#)?;
	writeln!(out, r#"<header><strong>#{index}</strong><span>seed {}, attempts {}</span><a href="{PUBLIC_URL}#/puzzle/{payload}" target="_blank" rel="noopener">play</a></header>"#, puzzle.seed, puzzle.attempts)?;
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
	let (difficulty, count, attempts) = parse_args();

	let stdout = io::stdout();
	let mut stream = io::BufWriter::new(stdout.lock());
	writeln!(stream, r#"<!doctype html>
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
.puzzle header a {{ color: #7bb8ff; font-weight: 700; text-decoration: none; }}
.puzzle header a:hover {{ text-decoration: underline; }}
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
	let mut exhausted = 0u64;
	let puzzles: Vec<_> = (0..count).into_par_iter().map(|seed| (seed, difficulty.generate(seed, attempts))).collect();

	for (seed, puzzle) in puzzles {
		match puzzle {
			Some(puzzle) => {
				found += 1;
				write_puzzle(&mut stream, found, &puzzle)?;
				eprintln!("seed {seed}: accepted as {found}/{count} after {} attempts", puzzle.attempts);
			}
			None => {
				exhausted += 1;
				eprintln!("seed {seed}: exhausted after {attempts} attempts");
			}
		}
	}
	eprintln!("searched {count} seeds: accepted {found}, exhausted {exhausted}");

	writeln!(stream, "</section>\n</main>\n</body>\n</html>")
}
