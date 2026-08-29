use std::{fmt, io::Write, str::FromStr};

const HELP: &str = "Commands:
  reveal <x> <y>  Reveal a square (aliases: x; compact: x12)
  flag <x> <y>    Flag a square (alias: f; compact: f12)
  wand <x> <y>    Safely play a square (alias: w; compact: w12)
  solve sat       Apply SAT deductions (alias: sa)
  solve subset    Apply subset deductions (alias: ss)
  solve total     Apply total mine-count deductions (alias: st)
  solve local     Apply local deductions (alias: sl)
  solve overlap   Apply neighbouring clue-overlap deductions (alias: so)
  solve cover     Apply multi-clue cover deductions (alias: sc)
  check sat       Check for SAT deductions without applying them (alias: ca)
  check subset    Check for subset deductions without applying them (alias: cs)
  check total     Check for total mine-count deductions without applying them (alias: ct)
  check local     Check for local deductions without applying them (alias: cl)
  check overlap   Check neighbouring clue-overlap deductions (alias: co)
  check cover     Check multi-clue cover deductions (alias: cc)
  help            Show this help (alias: h)
  quit            Leave the game (aliases: q, exit)

Coordinates must be between 0 and 7.";

const CENTER_DENSITY: i32 = minetacs::Gradient::DENOMINATOR * 35 / 100;
const DENSITY_STEP: i32 = minetacs::Gradient::DENOMINATOR / 16;

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
enum Action {
	Reveal(i8, i8),
	Flag(i8, i8),
	Wand(i8, i8),
	SolveSat,
	SolveSubset,
	SolveTotal,
	SolveLocal,
	SolveOverlap,
	SolveCover,
	CheckSat,
	CheckSubset,
	CheckTotal,
	CheckLocal,
	CheckOverlap,
	CheckCover,
	Help,
	Quit,
}

#[derive(Debug, Eq, PartialEq)]
struct ParseActionError(&'static str);

macro_rules! usage {
	($syntax:literal) => {
		ParseActionError(concat!("Invalid syntax. Usage: `", $syntax, "`."))
	};
	($first:literal, $second:literal) => {
		ParseActionError(concat!("Invalid syntax. Usage: `", $first, "` or `", $second, "`."))
	};
}

impl fmt::Display for ParseActionError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str(self.0)
	}
}

impl FromStr for Action {
	type Err = ParseActionError;

	fn from_str(input: &str) -> Result<Self, Self::Err> {
		let input = input.trim().to_ascii_lowercase();
		let words: Vec<_> = input.split_whitespace().collect();

		match words.as_slice() {
			[] => Err(ParseActionError("Please enter a command. Type `help` to see the available commands.")),
			["h" | "help"] => Ok(Action::Help),
			["q" | "quit" | "exit"] => Ok(Action::Quit),
			["sa"] | ["solve", "sat"] => Ok(Action::SolveSat),
			["ss"] | ["solve", "subset"] => Ok(Action::SolveSubset),
			["st"] | ["solve", "total"] => Ok(Action::SolveTotal),
			["sl"] | ["solve", "local"] => Ok(Action::SolveLocal),
			["so"] | ["solve", "overlap"] => Ok(Action::SolveOverlap),
			["sc"] | ["solve", "cover"] => Ok(Action::SolveCover),
			["ca"] | ["check", "sat"] => Ok(Action::CheckSat),
			["cs"] | ["check", "subset"] => Ok(Action::CheckSubset),
			["ct"] | ["check", "total"] => Ok(Action::CheckTotal),
			["cl"] | ["check", "local"] => Ok(Action::CheckLocal),
			["co"] | ["check", "overlap"] => Ok(Action::CheckOverlap),
			["cc"] | ["check", "cover"] => Ok(Action::CheckCover),
			["x" | "reveal", x, y] => Ok(Action::Reveal(
				parse_coordinate(x)?,
				parse_coordinate(y)?,
			)),
			["f" | "flag", x, y] => Ok(Action::Flag(
				parse_coordinate(x)?,
				parse_coordinate(y)?,
			)),
			["w" | "wand", x, y] => Ok(Action::Wand(
				parse_coordinate(x)?,
				parse_coordinate(y)?,
			)),
			[command] if command.len() == 3 => parse_compact_action(command),
			["x" | "reveal", ..] => Err(usage!("reveal <x> <y>")),
			["f" | "flag", ..] => Err(usage!("flag <x> <y>")),
			["w" | "wand", ..] => Err(usage!("wand <x> <y>")),
			["solve", ..] => Err(ParseActionError("Invalid syntax. See `help` for the available solve commands.")),
			["check", ..] => Err(ParseActionError("Invalid syntax. See `help` for the available check commands.")),
			_ => Err(ParseActionError("Unknown command. Type `help` to see the available commands.")),
		}
	}
}

fn parse_coordinate(value: &str) -> Result<i8, ParseActionError> {
	value.parse().ok().filter(|value| (0..8).contains(value))
		.ok_or(ParseActionError("Invalid coordinate; coordinates must be integers from 0 to 7."))
}

fn parse_compact_action(command: &str) -> Result<Action, ParseActionError> {
	let bytes = command.as_bytes();
	let action = bytes[0];
	if !matches!(action, b'x' | b'f' | b'w') {
		return Err(ParseActionError("Unknown command. Type `help` to see the available commands."));
	}

	let x = parse_coordinate(&command[1..2])?;
	let y = parse_coordinate(&command[2..3])?;
	match action {
		b'f' => Ok(Action::Flag(x, y)),
		b'w' => Ok(Action::Wand(x, y)),
		_ => Ok(Action::Reveal(x, y)),
	}
}

fn read_action() -> std::io::Result<Option<Action>> {
	loop {
		print!(">>> ");
		std::io::stdout().flush()?;

		let mut input = String::new();
		if std::io::stdin().read_line(&mut input)? == 0 {
			return Ok(None);
		}

		match input.parse() {
			Ok(action) => return Ok(Some(action)),
			Err(error) => eprintln!("Input error: {error}"),
		}
	}
}

fn solve_sat(state: &minetacs::GameState) -> Option<minetacs::Deductions> {
	state.solve_sat(minetacs::Deductions::default())
}

fn solve_subset(state: &minetacs::GameState) -> Option<minetacs::Deductions> {
	state.solve_subset(minetacs::Deductions::default())
}

fn solve_total(state: &minetacs::GameState) -> Option<minetacs::Deductions> {
	state.solve_total(minetacs::Deductions::default())
}

fn solve_local(state: &minetacs::GameState) -> Option<minetacs::Deductions> {
	state.solve_local(minetacs::Deductions::default())
}

fn solve_overlap(state: &minetacs::GameState) -> Option<minetacs::Deductions> {
	state.solve_overlap(minetacs::Deductions::default(), false)
}

fn solve_clue_cover(state: &minetacs::GameState) -> Option<minetacs::Deductions> {
	state.solve_clue_cover(minetacs::Deductions::default())
}

fn apply_solver(state: &mut minetacs::GameState, name: &str, solver: impl Fn(&minetacs::GameState) -> Option<minetacs::Deductions>) {
	let mut deductions = 0;
	loop {
		let Some(result) = solver(state) else {
			println!("The {name} solver found a contradiction.");
			return;
		};
		if result.is_empty() {
			break;
		}
		deductions += result.count();
		state.apply(result);
	}

	if deductions == 0 {
		println!("The {name} solver found no certain moves.");
	}
	else {
		println!("The {name} solver applied {deductions} deductions.");
	}
}

fn check_solver(state: &minetacs::GameState, name: &str, solver: impl Fn(&minetacs::GameState) -> Option<minetacs::Deductions>) {
	match solver(state) {
		None => println!("The {name} solver found a contradiction."),
		Some(result) if result.is_empty() => println!("The {name} solver cannot make progress."),
		Some(_) => println!("The {name} solver can make progress."),
	}
}

// fn generate_board() -> minetacs::GameState {
// 	let mut rng = urandom::new();
//
// 	loop {
// 		let gradient = minetacs::Gradient::random(&mut rng, CENTER_DENSITY, DENSITY_STEP);
// 		let state = minetacs::GameState::random(rng.random(), &gradient);
// 		if !solver_finishes(state, solve_subset_total) &&
// 			solver_finishes(state, minetacs::GameState::solve)
// 		{
// 			return state;
// 		}
// 	}
// }

fn generate_board() -> minetacs::GameState {
	let mut rng = urandom::new();

	loop {
		let gradient = minetacs::Gradient::random(&mut rng, CENTER_DENSITY, DENSITY_STEP);
		let state = minetacs::GameState::random(&mut rng, &gradient);
		let mut subset_state = state;

		while let Some(deductions) = solve_subset(&subset_state) {
			if deductions.is_empty() {
				break;
			}
			subset_state.apply(deductions);
		}

		if solve_sat(&subset_state).is_some_and(|deductions| !deductions.is_empty()) {
			return state;
		}
	}
}

// fn solve_subset_total(state: &minetacs::GameState) -> minetacs::Result {
// 	solve_subset(state) | solve_total(state)
// }
//
// fn solver_finishes(mut state: minetacs::GameState, solver: fn(&minetacs::GameState) -> minetacs::Result) -> bool {
// 	loop {
// 		if state.is_game_over() == Some(minetacs::GameOverReason::Cleared) {
// 			return true;
// 		}
//
// 		let result = solver(&state);
// 		if result.is_empty() {
// 			return false;
// 		}
// 		state.apply(result);
// 	}
// }

fn main() {
	let mut state = generate_board();

	apply_solver(&mut state, "local", solve_local);

	println!("Enter `help` to see the available commands.");
	let result = 'game: loop {
		println!("{state}");

		if let Some(face) = state.is_game_over() {
			break Some(face);
		}

		let action = match read_action() {
			Ok(Some(action)) => action,
			Ok(None) => break None,
			Err(error) => {
				eprintln!("Could not read input: {error}");
				break None;
			}
		};

		match action {
			Action::Reveal(x, y) => state.reveal(x, y),
			Action::Flag(x, y) => state.flag(x, y),
			Action::Wand(x, y) => {
				if !state.wand(x, y) {
					println!("The wand requires an unrevealed, unflagged square.");
				}
			}
			Action::SolveSat => apply_solver(&mut state, "SAT", solve_sat),
			Action::SolveSubset => apply_solver(&mut state, "subset", solve_subset),
			Action::SolveTotal => apply_solver(&mut state, "total", solve_total),
			Action::SolveLocal => apply_solver(&mut state, "local", solve_local),
			Action::SolveOverlap => apply_solver(&mut state, "clue-overlap", solve_overlap),
			Action::SolveCover => apply_solver(&mut state, "clue-cover", solve_clue_cover),
			Action::CheckSat => check_solver(&state, "SAT", solve_sat),
			Action::CheckSubset => check_solver(&state, "subset", solve_subset),
			Action::CheckTotal => check_solver(&state, "total", solve_total),
			Action::CheckLocal => check_solver(&state, "local", solve_local),
			Action::CheckOverlap => check_solver(&state, "clue-overlap", solve_overlap),
			Action::CheckCover => check_solver(&state, "clue-cover", solve_clue_cover),
			Action::Help => println!("{HELP}"),
			Action::Quit => break 'game None,
		}

		if let Some(face) = state.is_game_over() {
			println!("{state}");
			break Some(face);
		}
	};

	if let Some(result) = result {
		let face = match result {
			minetacs::GameOverReason::Cleared => "(^_^)",
			minetacs::GameOverReason::Detonation => "(x_x)",
		};
		println!("{face}");
	}
	else {
		println!("Goodbye!");
	}
}

#[test]
fn parses_coordinate_actions() {
	assert_eq!("x12".parse(), Ok(Action::Reveal(1, 2)));
	assert_eq!("reveal 3 4".parse(), Ok(Action::Reveal(3, 4)));
	assert_eq!("f56".parse(), Ok(Action::Flag(5, 6)));
	assert_eq!("flag 7 0".parse(), Ok(Action::Flag(7, 0)));
	assert_eq!("w24".parse(), Ok(Action::Wand(2, 4)));
	assert_eq!("wand 6 3".parse(), Ok(Action::Wand(6, 3)));
}

#[test]
fn parses_non_coordinate_actions() {
	assert_eq!("sa".parse(), Ok(Action::SolveSat));
	assert_eq!("solve subset".parse(), Ok(Action::SolveSubset));
	assert_eq!("solve total".parse(), Ok(Action::SolveTotal));
	assert_eq!("solve local".parse(), Ok(Action::SolveLocal));
	assert_eq!("solve overlap".parse(), Ok(Action::SolveOverlap));
	assert_eq!("sc".parse(), Ok(Action::SolveCover));
	assert_eq!("ca".parse(), Ok(Action::CheckSat));
	assert_eq!("check subset".parse(), Ok(Action::CheckSubset));
	assert_eq!("check total".parse(), Ok(Action::CheckTotal));
	assert_eq!("check local".parse(), Ok(Action::CheckLocal));
	assert_eq!("co".parse(), Ok(Action::CheckOverlap));
	assert_eq!("check cover".parse(), Ok(Action::CheckCover));
	assert_eq!("HELP".parse(), Ok(Action::Help));
	assert_eq!("quit".parse(), Ok(Action::Quit));
}

#[test]
fn rejects_invalid_input() {
	assert!("".parse::<Action>().is_err());
	assert!("reveal 8 0".parse::<Action>().is_err());
	assert!("f-11".parse::<Action>().is_err());
	assert!("wand 1 8".parse::<Action>().is_err());
	assert!("sg".parse::<Action>().is_err());
	assert!("solve endgame".parse::<Action>().is_err());
	assert!("solve sometimes".parse::<Action>().is_err());
	assert!("check sometimes".parse::<Action>().is_err());
	assert!("wat".parse::<Action>().is_err());
}
