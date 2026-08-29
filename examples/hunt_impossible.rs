//! Parallel best-of search for unusually hard Minesight puzzles.
//!
//! ```text
//! cargo run --release --example hunt_impossible -- --seconds 60
//! ```

use std::time;

use minetacs::{solve, puzzle};
use rayon::prelude::*;

struct Args {
	seed: u64,
	seconds: u64,
	batch: usize,
	attempts: u32,
	keep: usize,
	validation: solve::ProofSearchConfig,
}

fn args() -> Args {
	let matches = clap::Command::new("hunt_impossible")
		.about("Search all CPU cores for puzzles with deep deduction proofs")
		.arg(clap::Arg::new("seed").long("seed").value_parser(clap::value_parser!(u64)))
		.arg(clap::Arg::new("seconds").long("seconds").default_value("30").value_parser(clap::value_parser!(u64)))
		.arg(clap::Arg::new("batch").long("batch").default_value("64").value_parser(clap::value_parser!(usize)))
		.arg(clap::Arg::new("attempts").long("attempts").default_value("250").value_parser(clap::value_parser!(u32)))
		.arg(clap::Arg::new("keep").long("keep").default_value("6").value_parser(clap::value_parser!(usize)))
		.arg(clap::Arg::new("max-assumptions").long("max-assumptions").default_value("5").value_parser(clap::value_parser!(u8)))
		.arg(clap::Arg::new("candidates").long("candidates").default_value("64").value_parser(clap::value_parser!(u8)))
		.arg(clap::Arg::new("nodes").long("nodes").default_value("5000000").value_parser(clap::value_parser!(u32)))
		.get_matches();
	let random_seed = time::SystemTime::now().duration_since(time::UNIX_EPOCH).unwrap_or_default().as_nanos() as u64;
	Args {
		seed: matches.get_one::<u64>("seed").copied().unwrap_or(random_seed),
		seconds: *matches.get_one::<u64>("seconds").unwrap(),
		batch: (*matches.get_one::<usize>("batch").unwrap()).max(1),
		attempts: *matches.get_one::<u32>("attempts").unwrap(),
		keep: (*matches.get_one::<usize>("keep").unwrap()).max(1),
		validation: solve::ProofSearchConfig {
			max_assumptions: *matches.get_one::<u8>("max-assumptions").unwrap(),
			candidate_limit: *matches.get_one::<u8>("candidates").unwrap(),
			node_limit: *matches.get_one::<u32>("nodes").unwrap(),
		},
	}
}

#[derive(Copy, Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct Score {
	assumption_depth: u8,
	area: u32,
	forced: u32,
}

#[derive(Copy, Clone)]
struct Candidate {
	puzzle: puzzle::Puzzle,
	score: Score,
	unresolved: bool,
}

fn evaluate(puzzle: puzzle::Puzzle, config: solve::ProofSearchConfig) -> Option<Candidate> {
	let step = puzzle.state.next_deductions(minetacs::Deductions::default(), config)?;
	let (assumption_depth, unresolved) = match step {
		solve::DeductionStep::Found { assumption_depth, budget_exhausted: false, .. } => (assumption_depth, false),
		solve::DeductionStep::Unresolved { budget_exhausted: false, .. } => (config.max_assumptions.saturating_add(1), true),
		solve::DeductionStep::Found { budget_exhausted: true, .. } |
		solve::DeductionStep::Unresolved { budget_exhausted: true, .. } |
		solve::DeductionStep::Complete => return None,
	};
	Some(Candidate {
		puzzle,
		score: Score {
			assumption_depth,
			area: puzzle.forced.area(),
			forced: puzzle.forced.count(),
		},
		unresolved,
	})
}

fn retain_top(candidates: &mut Vec<Candidate>, keep: usize) {
	candidates.sort_unstable_by(|left, right| right.score.cmp(&left.score).then_with(|| left.puzzle.seed.cmp(&right.puzzle.seed)));
	candidates.dedup_by_key(|candidate| candidate.puzzle.encode());
	candidates.truncate(keep);
}

fn main() -> Result<(), String> {
	let args = args();
	let started = time::Instant::now();
	let deadline = started + time::Duration::from_secs(args.seconds);
	let quick = solve::ProofSearchConfig {
		max_assumptions: 3,
		candidate_limit: 64,
		node_limit: 500_000,
	};
	let shortlist_size = (args.keep * 8).max(args.keep);
	let mut shortlist = Vec::new();
	let mut next_seed = args.seed;
	let mut searched = 0u64;

	loop {
		let batch_start = next_seed;
		let batch: Vec<_> = (0..args.batch)
			.into_par_iter()
			.filter_map(|offset| {
				let seed = batch_start.wrapping_add(offset as u64);
				let puzzle = minetacs::puzzle::generate_impossible(seed, args.attempts)?;
				evaluate(puzzle, quick)
			})
			.collect();
		searched += args.batch as u64;
		next_seed = next_seed.wrapping_add(args.batch as u64);
		shortlist.extend(batch);
		retain_top(&mut shortlist, shortlist_size);
		eprintln!(
			"searched {searched} seed series in {:.1}s; current best assumption depth {}",
			started.elapsed().as_secs_f32(),
			shortlist.first().map(|candidate| candidate.score.assumption_depth).unwrap_or(0),
		);
		if time::Instant::now() >= deadline {
			break;
		}
	}

	let mut finalists: Vec<_> = shortlist.into_par_iter().filter_map(|candidate| evaluate(candidate.puzzle, args.validation)).collect();
	retain_top(&mut finalists, args.keep);
	if finalists.is_empty() {
		return Err("no finalist completed validation; increase --nodes or search longer".to_owned());
	}

	for (index, candidate) in finalists.into_iter().enumerate() {
		let proof_effort = if candidate.unresolved {
			format!("assumption depth >{}", args.validation.max_assumptions)
		}
		else {
			format!("assumption depth {}", candidate.score.assumption_depth)
		};
		println!(
			"#{} · {} · {} answers · seed {} attempt {}\nhttps://casualhacks.net/minesight/#/puzzle/{}\n",
			index + 1,
			proof_effort,
			candidate.score.forced,
			candidate.puzzle.seed,
			candidate.puzzle.attempts,
			candidate.puzzle.encode(),
		);
	}
	Ok(())
}
