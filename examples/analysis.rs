//! Inspect successive bounded deduction hints for one generated puzzle.
//!
//! ```text
//! cargo run --release --example analyze_deductions -- --seed 0 --attempts 5000
//! ```

use std::time;

use minetacs::{solve, puzzle};

fn main() -> Result<(), String> {
	let matches = clap::Command::new("analyze_deductions")
		.about("Print bounded deduction hints for a Minesight puzzle")
		.arg(clap::Arg::new("seed").long("seed").value_parser(clap::value_parser!(u64)))
		.arg(clap::Arg::new("attempts").long("attempts").default_value("5000").value_parser(clap::value_parser!(u32)))
		.arg(clap::Arg::new("max-assumptions").long("max-assumptions").default_value("3").value_parser(clap::value_parser!(u8)))
		.arg(clap::Arg::new("candidates").long("candidates").default_value("6").value_parser(clap::value_parser!(u8)))
		.arg(clap::Arg::new("nodes").long("nodes").default_value("100000").value_parser(clap::value_parser!(u32)))
		.get_matches();

	let seed = matches.get_one::<u64>("seed").copied().unwrap_or_else(|| {
		time::SystemTime::now().duration_since(time::UNIX_EPOCH).unwrap_or_default().as_nanos() as u64
	});
	let attempts = *matches.get_one::<u32>("attempts").unwrap();
	let config = solve::ProofSearchConfig {
		max_assumptions: *matches.get_one::<u8>("max-assumptions").unwrap(),
		candidate_limit: *matches.get_one::<u8>("candidates").unwrap(),
		node_limit: *matches.get_one::<u32>("nodes").unwrap(),
	};

	let puzzle = puzzle::generate_mit(seed, attempts).ok_or_else(|| format!("no puzzle found for seed {seed} in {attempts} attempts"))?;
	println!("seed {} · generated in {} attempts", puzzle.seed, puzzle.attempts);
	println!("play: https://casualhacks.net/minesight/#/puzzle/{}", puzzle.encode());
	println!("{}", puzzle.state);

	let mut known = minetacs::Deductions::default();
	let mut waves = 0u8;
	let mut max_assumption_depth = 0u8;
	loop {
		let step = puzzle.state.next_deductions(known, config).ok_or_else(|| "generated puzzle is contradictory".to_owned())?;
		match step {
			solve::DeductionStep::Found { deductions, assumption_depth, budget_exhausted } => {
				waves = waves.saturating_add(1);
				max_assumption_depth = max_assumption_depth.max(assumption_depth);
				let exhausted_label = if budget_exhausted { " · an earlier target exhausted its node budget" } else { "" };
				println!(
					"\nwave {waves} · assumption depth {assumption_depth} · {} cells{exhausted_label}",
					deductions.count(),
				);
				print_deductions(deductions);
				known |= deductions;
			}
			solve::DeductionStep::Complete => {
				println!("\ncomplete · {waves} waves · maximum assumption depth {max_assumption_depth}");
				break;
			}
			solve::DeductionStep::Unresolved { deductions, budget_exhausted } => {
				let reason = if budget_exhausted { "node budget exhausted" } else { "assumption bound exceeded" };
				println!("\nunresolved ({reason}) · SAT fallback reveals {} cells", deductions.count());
				print_deductions(deductions);
				break;
			}
		}
	}
	Ok(())
}

fn print_deductions(deductions: minetacs::Deductions) {
	let mut cells = deductions.mines | deductions.safe;
	while cells != 0 {
		let cell = cells.trailing_zeros();
		cells &= cells - 1;
		let x = cell % 8 + 1;
		let y = cell / 8 + 1;
		let label = if deductions.mines & (1u64 << cell) != 0 { "mine" } else { "safe" };
		println!("  ({},{}) {label}", x, y);
	}
}
