use minetacs::{GameOverReason, GameState, Gradient, Deductions};

const DEFAULT_BOARDS: u64 = 1_000;
const CENTER_DENSITY: i32 = Gradient::DENOMINATOR * 35 / 100;
const DENSITY_STEP: i32 = Gradient::DENOMINATOR / 16;

fn finishes(mut state: GameState, solve: fn(&GameState) -> Deductions) -> bool {
	loop {
		if state.is_game_over() == Some(GameOverReason::Cleared) {
			return true;
		}

		let deductions = solve(&state);
		if deductions.is_empty() {
			return false;
		}
		state.apply(deductions);
	}
}

fn solve_subset_total(state: &GameState) -> Deductions {
	state.solve_subset() | state.solve_total()
}

fn percentage(part: u64, total: u64) -> f64 {
	if total == 0 { 0.0 } else { part as f64 * 100.0 / total as f64 }
}

fn main() {
	let boards = std::env::args()
		.nth(1)
		.map(|value| value.parse().expect("board count must be a positive integer"))
		.unwrap_or(DEFAULT_BOARDS);
	assert!(boards > 0, "board count must be a positive integer");

	let mut exact_finishes = 0;
	let mut subset_total_finishes = 0;
	let mut both_finish = 0;

	// Sequential seeds make the experiment deterministic and reproducible.
	for seed in 0..boards {
		let mut rng = urandom::seeded(seed);
		let gradient = Gradient::random(&mut rng, CENTER_DENSITY, DENSITY_STEP);
		let state = GameState::random(rng.random(), &gradient);
		let exact_finished = finishes(state, GameState::solve);
		let subset_total_finished = finishes(state, solve_subset_total);
		exact_finishes += exact_finished as u64;
		subset_total_finishes += subset_total_finished as u64;
		both_finish += (exact_finished && subset_total_finished) as u64;
	}

	println!("boards sampled: {boards}");
	println!(
		"exact finishes:            {exact_finishes:>6} ({:.2}% of all boards)",
		percentage(exact_finishes, boards),
	);
	println!(
		"subset + total finishes:   {subset_total_finishes:>6} ({:.2}% of all boards)",
		percentage(subset_total_finishes, boards),
	);
	println!(
		"subset + total is sufficient for {:.2}% of exact-solvable boards",
		percentage(both_finish, exact_finishes),
	);
	println!(
		"exact adds necessary progress on {:.2}% of exact-solvable boards",
		percentage(exact_finishes - both_finish, exact_finishes),
	);
}
