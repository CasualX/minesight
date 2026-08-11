use crate::{Deduction, Field64, RevealResult, Technique};
use serde::Serialize;

const BOARD_CELLS: usize = 64;
const CHALLENGE_LENGTH: usize = 12;

const CATEGORY_DATA: [(&str, &str); 7] = [
    ("basics", "Basics"),
    ("subsets", "Subsets"),
    ("overlaps", "Overlaps"),
    ("chains", "Chains"),
    ("global", "Global"),
    ("contradiction", "Contradiction"),
    ("mixed", "Mixed"),
];

const DIFFICULTY_DATA: [(&str, &str); 4] = [
    ("easy", "Easy"),
    ("medium", "Medium"),
    ("hard", "Hard"),
    ("expert", "Expert"),
];

#[derive(Copy, Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Practice,
    Challenge,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PuzzleStatus {
    Playing,
    Solved,
    Mistake,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ActionKind {
    Reveal,
    Mark,
}

impl ActionKind {
    pub fn from_u32(value: u32) -> Option<Self> {
        match value {
            0 => Some(Self::Reveal),
            1 => Some(Self::Mark),
            _ => None,
        }
    }
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
enum Category {
    Basics,
    Subsets,
    Overlaps,
    Chains,
    Global,
    Contradiction,
    Mixed,
}

impl Category {
    fn from_index(index: usize) -> Self {
        match index {
            0 => Self::Basics,
            1 => Self::Subsets,
            2 => Self::Overlaps,
            3 => Self::Chains,
            4 => Self::Global,
            5 => Self::Contradiction,
            _ => Self::Mixed,
        }
    }

    fn index(self) -> usize {
        match self {
            Self::Basics => 0,
            Self::Subsets => 1,
            Self::Overlaps => 2,
            Self::Chains => 3,
            Self::Global => 4,
            Self::Contradiction => 5,
            Self::Mixed => 6,
        }
    }

    fn id(self) -> &'static str {
        CATEGORY_DATA[self.index()].0
    }

    fn label(self) -> &'static str {
        CATEGORY_DATA[self.index()].1
    }

    fn practice_difficulty(self) -> Difficulty {
        match self {
            Self::Basics => Difficulty::Easy,
            Self::Subsets | Self::Global | Self::Mixed => Difficulty::Medium,
            Self::Overlaps | Self::Chains => Difficulty::Hard,
            Self::Contradiction => Difficulty::Expert,
        }
    }

    fn accepts(self, technique: Technique, depth: usize, roll: u64) -> bool {
        match self {
            Self::Basics => technique == Technique::SinglePoint && depth >= 1,
            Self::Subsets => technique == Technique::Subset,
            Self::Overlaps | Self::Contradiction => technique == Technique::Exhaustive,
            Self::Chains => {
                depth >= 4 && matches!(technique, Technique::Subset | Technique::Exhaustive)
            }
            Self::Global => technique == Technique::MineCount,
            Self::Mixed => match roll % 4 {
                0 => technique == Technique::SinglePoint && depth >= 2,
                1 | 2 => technique == Technique::Subset,
                _ => technique == Technique::Exhaustive,
            },
        }
    }
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
enum Difficulty {
    Easy,
    Medium,
    Hard,
    Expert,
}

impl Difficulty {
    fn from_index(index: usize) -> Self {
        match index {
            0 => Self::Easy,
            1 => Self::Medium,
            2 => Self::Hard,
            _ => Self::Expert,
        }
    }

    fn index(self) -> usize {
        match self {
            Self::Easy => 0,
            Self::Medium => 1,
            Self::Hard => 2,
            Self::Expert => 3,
        }
    }

    fn id(self) -> &'static str {
        DIFFICULTY_DATA[self.index()].0
    }

    fn label(self) -> &'static str {
        DIFFICULTY_DATA[self.index()].1
    }

    fn mine_count(self) -> u32 {
        match self {
            Self::Easy => 8,
            Self::Medium => 10,
            Self::Hard => 12,
            Self::Expert => 14,
        }
    }
}

#[derive(Clone, Debug)]
struct Puzzle {
    id: String,
    category: Category,
    difficulty: Difficulty,
    initial: Field64,
    field: Field64,
    deduction: Deduction,
    available: Vec<Deduction>,
    required_safe: u64,
    required_mines: u64,
    frontier: u64,
    clues: u64,
    related: u64,
    status: PuzzleStatus,
    hint_level: u8,
    show_explanation: bool,
    mistake: Option<usize>,
    cascade_revealed: u64,
}

impl Puzzle {
    fn new(
        id: String,
        category: Category,
        difficulty: Difficulty,
        field: Field64,
        deduction: Deduction,
    ) -> Self {
        let clues = relevant_clues(&field, deduction);
        let related = related_unknowns(&field, clues) | deduction.safe | deduction.mines;
        let available = field
            .available_deductions()
            .unwrap_or_else(|_| vec![deduction]);
        let (required_safe, required_mines) =
            available.iter().fold((0, 0), |(safe, mines), candidate| {
                (safe | candidate.safe, mines | candidate.mines)
            });
        let frontier = puzzle_frontier(&field) | required_safe | required_mines;
        Self {
            id,
            category,
            difficulty,
            initial: field,
            field,
            deduction,
            available,
            required_safe,
            required_mines,
            frontier,
            clues,
            related,
            status: PuzzleStatus::Playing,
            hint_level: 0,
            show_explanation: false,
            mistake: None,
            cascade_revealed: 0,
        }
    }

    fn reset(&mut self) {
        self.field = self.initial;
        self.status = PuzzleStatus::Playing;
        self.hint_level = 0;
        self.show_explanation = false;
        self.mistake = None;
        self.cascade_revealed = 0;
    }

    fn hint(&mut self) {
        if self.status == PuzzleStatus::Playing {
            self.hint_level = (self.hint_level + 1).min(3);
        }
    }

    fn explain(&mut self) {
        self.show_explanation = true;
        self.hint_level = 3;
    }

    fn act(&mut self, index: usize, action: ActionKind) -> bool {
        if index >= BOARD_CELLS || self.status != PuzzleStatus::Playing {
            return false;
        }
        let bit = 1_u64 << index;
        if self.frontier & bit == 0
            || self.field.revealed & bit != 0
            || self.field.flagged & bit != 0
        {
            return false;
        }

        let proof = self
            .available
            .iter()
            .copied()
            .find(|deduction| match action {
                ActionKind::Reveal => deduction.safe & bit != 0,
                ActionKind::Mark => deduction.mines & bit != 0,
            });
        let Some(_proof) = proof else {
            self.status = PuzzleStatus::Mistake;
            self.mistake = Some(index);
            self.show_explanation = true;
            return true;
        };
        let before_revealed = self.field.revealed;
        match action {
            ActionKind::Reveal => {
                let _ = self.field.reveal(index / 8, index % 8);
            }
            ActionKind::Mark => self.field.flagged |= bit,
        }
        self.cascade_revealed |= self.field.revealed & !before_revealed & !bit;
        if self.required_safe & !self.field.revealed == 0
            && self.required_mines & !self.field.flagged == 0
        {
            self.status = PuzzleStatus::Solved;
            self.show_explanation = true;
        }
        true
    }

    fn technique_name(&self) -> &'static str {
        match self.deduction.technique {
            Technique::MineCount => "Global count",
            Technique::SinglePoint => "Local deduction",
            Technique::Subset => "Subset",
            Technique::Exhaustive if self.category == Category::Contradiction => "Contradiction",
            Technique::Exhaustive => "Overlap",
        }
    }

    fn hint_text(&self) -> &'static str {
        match (self.deduction.technique, self.hint_level) {
            (_, 0) => "",
            (Technique::MineCount, 1) => {
                "Compare the flags and covered cells with the total mine count."
            }
            (Technique::MineCount, 2) => {
                "Every remaining mine is accounted for—or every covered cell must be one."
            }
            (Technique::SinglePoint, 1) => "Look closely at the outlined clue.",
            (Technique::SinglePoint, 2) => "Count its flags and remaining covered neighbors.",
            (Technique::Subset, 1) => "Look at the two outlined, overlapping clues.",
            (Technique::Subset, 2) => {
                "One clue's covered neighbors are contained inside the other's."
            }
            (Technique::Exhaustive, 1) => "The outlined clues form one connected constraint.",
            (Technique::Exhaustive, 2) => {
                "Try each way their shared cells could contain the required mines."
            }
            (_, _) => "The striped cells are forced by the highlighted clues.",
        }
    }

    fn explanation(&self) -> &'static str {
        match self.deduction.technique {
            Technique::MineCount if self.deduction.safe != 0 => {
                "All mines are already accounted for, so every remaining covered cell is safe."
            }
            Technique::MineCount => {
                "The number of remaining mines equals the number of covered cells, so each of those cells is a mine."
            }
            Technique::SinglePoint if self.deduction.safe != 0 => {
                "The highlighted clue already has all of its mines accounted for. Its other covered neighbors are safe."
            }
            Technique::SinglePoint => {
                "The highlighted clue needs exactly as many mines as it has covered neighbors. Those cells must be mines."
            }
            Technique::Subset if self.deduction.safe != 0 => {
                "The smaller set already contains every mine required by the larger set. The extra striped cells are safe."
            }
            Technique::Subset => {
                "Subtracting the smaller clue's covered set leaves the extra striped cells forced to be mines."
            }
            Technique::Exhaustive => {
                "Every mine arrangement satisfying all highlighted clues agrees on the striped cells. They are forced."
            }
        }
    }
}

#[derive(Clone, Debug)]
struct Challenge {
    seed: String,
    seed_hash: u64,
    index: usize,
    solved: usize,
    failed: usize,
    tier_solved: [usize; 4],
    complete: bool,
}

/// Stateful puzzle engine used by both native tests and the WASM adapter.
#[derive(Clone, Debug)]
pub struct Game {
    mode: Mode,
    practice_category: Category,
    practice_seed: u64,
    practice_number: u64,
    puzzle: Option<Puzzle>,
    challenge: Option<Challenge>,
    message: String,
}

impl Game {
    pub fn new(seed: u64) -> Self {
        let mut game = Self {
            mode: Mode::Practice,
            practice_category: Category::Mixed,
            practice_seed: seed,
            practice_number: 0,
            puzzle: None,
            challenge: None,
            message: String::new(),
        };
        game.new_practice();
        game
    }

    pub fn set_mode(&mut self, mode: Mode) {
        if self.mode == mode {
            return;
        }
        match mode {
            Mode::Practice => {
                self.mode = Mode::Practice;
                self.challenge = None;
                self.new_practice();
            }
            Mode::Challenge => self.challenge_home(),
        }
    }

    pub fn configure_practice(&mut self, category: usize) {
        self.practice_category = Category::from_index(category);
        self.new_practice();
    }

    pub fn new_practice(&mut self) {
        self.practice_number = self.practice_number.wrapping_add(1);
        let seed =
            mix64(self.practice_seed ^ self.practice_number.wrapping_mul(0x9e37_79b9_7f4a_7c15));
        self.puzzle = Some(generate_puzzle(
            seed,
            self.practice_category,
            self.practice_category.practice_difficulty(),
            format!("P-{:08X}", seed as u32),
        ));
        self.message = "Find every forced move in this position.".into();
    }

    pub fn start_challenge(&mut self, seed: &str) {
        let normalized = if seed.trim().is_empty() {
            "MINETACS".to_string()
        } else {
            seed.trim().to_uppercase()
        };
        let seed_hash = hash_seed(&normalized);
        self.mode = Mode::Challenge;
        self.challenge = Some(Challenge {
            seed: normalized,
            seed_hash,
            index: 0,
            solved: 0,
            failed: 0,
            tier_solved: [0; 4],
            complete: false,
        });
        self.load_challenge_puzzle();
        self.message = "Challenge started. Find every forced move.".into();
    }

    pub fn random_challenge_seed(entropy: u64) -> String {
        const ALPHABET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
        let mut value = mix64(entropy);
        let mut result = String::with_capacity(9);
        for _ in 0..9 {
            result.push(ALPHABET[(value as usize) % ALPHABET.len()] as char);
            value = mix64(value);
        }
        result
    }

    pub fn act(&mut self, index: usize, action: ActionKind) {
        let Some(puzzle) = self.puzzle.as_mut() else {
            return;
        };
        let was_playing = puzzle.status == PuzzleStatus::Playing;
        if !puzzle.act(index, action) || !was_playing {
            return;
        }
        match puzzle.status {
            PuzzleStatus::Solved => {
                self.message = format!("Solved — {}.", puzzle.technique_name());
                if let Some(challenge) = self
                    .challenge
                    .as_mut()
                    .filter(|_| self.mode == Mode::Challenge)
                {
                    challenge.solved += 1;
                    challenge.tier_solved[challenge.index / 3] += 1;
                }
            }
            PuzzleStatus::Mistake => {
                self.message = "Not quite. That move was not logically forced.".into();
                if let Some(challenge) = self
                    .challenge
                    .as_mut()
                    .filter(|_| self.mode == Mode::Challenge)
                {
                    challenge.failed += 1;
                }
            }
            PuzzleStatus::Playing => {
                self.message = "Forced. Keep looking.".into();
            }
        }
    }

    pub fn hint(&mut self) {
        if self.mode == Mode::Challenge {
            return;
        }
        if let Some(puzzle) = self.puzzle.as_mut() {
            puzzle.hint();
            self.message = puzzle.hint_text().into();
        }
    }

    pub fn explain(&mut self) {
        if let Some(puzzle) = self.puzzle.as_mut() {
            puzzle.explain();
            self.message = puzzle.explanation().into();
        }
    }

    pub fn reset(&mut self) {
        if self.mode == Mode::Practice
            && let Some(puzzle) = self.puzzle.as_mut()
        {
            puzzle.reset();
            self.message = "Position reset.".into();
        }
    }

    pub fn next(&mut self) {
        if self.mode == Mode::Practice {
            self.new_practice();
            return;
        }
        let can_advance = self
            .puzzle
            .as_ref()
            .is_some_and(|puzzle| puzzle.status != PuzzleStatus::Playing);
        if !can_advance {
            return;
        }
        if let Some(challenge) = self.challenge.as_mut() {
            challenge.index += 1;
            if challenge.index >= CHALLENGE_LENGTH {
                challenge.complete = true;
                self.puzzle = None;
                self.message = if challenge.failed == 0 {
                    "Perfect run.".into()
                } else {
                    "Challenge complete.".into()
                };
                return;
            }
        }
        self.load_challenge_puzzle();
    }

    pub fn replay_challenge(&mut self) {
        if let Some(seed) = self
            .challenge
            .as_ref()
            .map(|challenge| challenge.seed.clone())
        {
            self.start_challenge(&seed);
        }
    }

    pub fn challenge_home(&mut self) {
        self.mode = Mode::Challenge;
        self.challenge = None;
        self.puzzle = None;
        self.message = "Choose a fresh run or enter a shared seed.".into();
    }

    pub fn snapshot(&self) -> GameSnapshot {
        let challenge_view = self.challenge.as_ref().map(|challenge| ChallengeView {
            seed: challenge.seed.clone(),
            index: challenge.index.min(CHALLENGE_LENGTH - 1),
            current: (challenge.index + 1).min(CHALLENGE_LENGTH),
            total: CHALLENGE_LENGTH,
            solved: challenge.solved,
            failed: challenge.failed,
            tier_solved: challenge.tier_solved,
            complete: challenge.complete,
            perfect: challenge.complete && challenge.failed == 0,
        });
        let screen = match (self.mode, challenge_view.as_ref()) {
            (Mode::Practice, _) => "practice",
            (Mode::Challenge, None) => "challenge-start",
            (Mode::Challenge, Some(challenge)) if challenge.complete => "results",
            (Mode::Challenge, Some(_)) => "challenge",
        };
        let puzzle = matches!(screen, "practice" | "challenge")
            .then(|| {
                self.puzzle
                    .as_ref()
                    .map(|puzzle| puzzle_view(puzzle, self.mode))
            })
            .flatten();
        GameSnapshot {
            mode: self.mode,
            screen,
            message: self.message.clone(),
            categories: CATEGORY_DATA
                .iter()
                .map(|&(id, label)| OptionView { id, label })
                .collect(),
            difficulties: DIFFICULTY_DATA
                .iter()
                .map(|&(id, label)| OptionView { id, label })
                .collect(),
            selected_category: self.practice_category.id(),
            puzzle,
            challenge: challenge_view,
        }
    }

    fn load_challenge_puzzle(&mut self) {
        let Some(challenge) = self.challenge.as_ref() else {
            return;
        };
        let index = challenge.index;
        let difficulty = Difficulty::from_index(index / 3);
        let category = match difficulty {
            Difficulty::Easy => Category::Basics,
            Difficulty::Medium => Category::Subsets,
            Difficulty::Hard => {
                if index.is_multiple_of(2) {
                    Category::Chains
                } else {
                    Category::Overlaps
                }
            }
            Difficulty::Expert => {
                if index.is_multiple_of(2) {
                    Category::Contradiction
                } else {
                    Category::Mixed
                }
            }
        };
        let seed = mix64(challenge.seed_hash ^ (index as u64).wrapping_mul(0xd1b5_4a32_d192_ed03));
        self.puzzle = Some(generate_puzzle(
            seed,
            category,
            difficulty,
            format!("{}-{:02}", challenge.seed, index + 1),
        ));
        self.message = "Find all forced moves in this position.".into();
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSnapshot {
    pub mode: Mode,
    pub screen: &'static str,
    pub message: String,
    pub categories: Vec<OptionView>,
    pub difficulties: Vec<OptionView>,
    pub selected_category: &'static str,
    pub puzzle: Option<PuzzleView>,
    pub challenge: Option<ChallengeView>,
}

#[derive(Clone, Debug, Serialize)]
pub struct OptionView {
    pub id: &'static str,
    pub label: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleView {
    pub id: String,
    pub status: PuzzleStatus,
    pub category: &'static str,
    pub category_label: &'static str,
    pub difficulty: &'static str,
    pub difficulty_label: &'static str,
    pub technique: Option<&'static str>,
    pub mine_count: u32,
    pub hint_level: u8,
    pub hint: &'static str,
    pub explanation: Option<&'static str>,
    pub forced_total: u32,
    pub forced_remaining: u32,
    pub cells: Vec<CellView>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CellView {
    pub index: usize,
    pub row: usize,
    pub column: usize,
    pub state: &'static str,
    pub number: Option<u8>,
    pub label: String,
    pub frontier: bool,
    pub relevant_clue: bool,
    pub related: bool,
    pub forced_safe: bool,
    pub forced_mine: bool,
    pub cascade: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeView {
    pub seed: String,
    pub index: usize,
    pub current: usize,
    pub total: usize,
    pub solved: usize,
    pub failed: usize,
    pub tier_solved: [usize; 4],
    pub complete: bool,
    pub perfect: bool,
}

fn puzzle_view(puzzle: &Puzzle, mode: Mode) -> PuzzleView {
    let reveal_reasoning = puzzle.hint_level > 0 || puzzle.show_explanation;
    let reveal_result = puzzle.hint_level >= 3 || puzzle.status != PuzzleStatus::Playing;
    let cells = (0..BOARD_CELLS)
        .map(|index| {
            let bit = 1_u64 << index;
            let revealed = puzzle.field.revealed & bit != 0;
            let flagged = puzzle.field.flagged & bit != 0;
            let is_mistake = puzzle.mistake == Some(index);
            let state = if is_mistake {
                if puzzle.field.mines & bit != 0 {
                    "mine"
                } else {
                    "incorrect"
                }
            } else if revealed {
                if puzzle.field.mines & bit != 0 {
                    "mine"
                } else {
                    "revealed"
                }
            } else if flagged {
                "flagged"
            } else {
                "hidden"
            };
            let number =
                (revealed && puzzle.field.mines & bit == 0).then_some(puzzle.field.numbers[index]);
            let in_frontier = puzzle.frontier & bit != 0;
            let label = match (state, number) {
                ("revealed", Some(0)) => {
                    format!("Row {}, column {}, empty", index / 8 + 1, index % 8 + 1)
                }
                ("revealed", Some(number)) => format!(
                    "Row {}, column {}, clue {number}",
                    index / 8 + 1,
                    index % 8 + 1
                ),
                ("flagged", _) => format!(
                    "Row {}, column {}, marked mine",
                    index / 8 + 1,
                    index % 8 + 1
                ),
                ("mine", _) => format!("Row {}, column {}, mine", index / 8 + 1, index % 8 + 1),
                ("incorrect", _) => format!(
                    "Row {}, column {}, incorrect move",
                    index / 8 + 1,
                    index % 8 + 1
                ),
                _ if !in_frontier => format!(
                    "Row {}, column {}, outside this puzzle's frontier",
                    index / 8 + 1,
                    index % 8 + 1
                ),
                _ => format!("Row {}, column {}, hidden", index / 8 + 1, index % 8 + 1),
            };
            CellView {
                index,
                row: index / 8,
                column: index % 8,
                state,
                number,
                label,
                frontier: in_frontier,
                relevant_clue: reveal_reasoning && puzzle.clues & bit != 0,
                related: puzzle.hint_level >= 2 && puzzle.related & bit != 0,
                forced_safe: reveal_result && puzzle.required_safe & bit != 0,
                forced_mine: reveal_result && puzzle.required_mines & bit != 0,
                cascade: puzzle.cascade_revealed & bit != 0,
            }
        })
        .collect();
    let technique_visible = mode == Mode::Practice || puzzle.status != PuzzleStatus::Playing;
    PuzzleView {
        id: puzzle.id.clone(),
        status: puzzle.status,
        category: puzzle.category.id(),
        category_label: puzzle.category.label(),
        difficulty: puzzle.difficulty.id(),
        difficulty_label: puzzle.difficulty.label(),
        technique: technique_visible.then(|| puzzle.technique_name()),
        mine_count: puzzle.field.mines.count_ones(),
        hint_level: puzzle.hint_level,
        hint: puzzle.hint_text(),
        explanation: puzzle.show_explanation.then(|| puzzle.explanation()),
        forced_total: (puzzle.required_safe | puzzle.required_mines).count_ones(),
        forced_remaining: (puzzle.required_safe & !puzzle.field.revealed).count_ones()
            + (puzzle.required_mines & !puzzle.field.flagged).count_ones(),
        cells,
    }
}

fn generate_puzzle(seed: u64, category: Category, difficulty: Difficulty, id: String) -> Puzzle {
    let mut rng = Rng::new(seed);
    for attempt in 0..4_000_u64 {
        let mines = random_mines(&mut rng, difficulty.mine_count());
        let mut field = Field64::new(mines);
        let start = (0..BOARD_CELLS)
            .map(|_| (rng.next() & 63) as usize)
            .find(|&index| mines & (1_u64 << index) == 0)
            .unwrap_or_else(|| (!mines).trailing_zeros() as usize);
        if !matches!(
            field.reveal(start / 8, start % 8),
            Ok(RevealResult::Safe { .. })
        ) {
            continue;
        }
        for depth in 0..32 {
            let Ok(Some(deduction)) = field.next_deduction() else {
                break;
            };
            if category.accepts(deduction.technique, depth, seed ^ attempt)
                && has_no_alternative_moves(&field, deduction)
            {
                return Puzzle::new(id, category, difficulty, field, deduction);
            }
            if field.apply_deduction(deduction).is_err() || field.is_solved() {
                break;
            }
        }
    }

    // Stable hand-picked positions guarantee every category remains available if
    // random generation happens to have an unlucky run.
    let (mines, start) = if matches!(category, Category::Subsets | Category::Chains) {
        (0x0090_9120_0018_1100, 6)
    } else {
        (0x2020_0010_0c90_0023, 38)
    };
    let mut field = Field64::new(mines);
    let _ = field.reveal(start / 8, start % 8);
    for depth in 0..64 {
        if let Ok(Some(deduction)) = field.next_deduction() {
            if (category.accepts(deduction.technique, depth, seed)
                && has_no_alternative_moves(&field, deduction))
                || depth == 63
            {
                return Puzzle::new(id, category, difficulty, field, deduction);
            }
            let _ = field.apply_deduction(deduction);
        } else {
            break;
        }
    }
    let deduction = field.next_deduction().ok().flatten().unwrap_or(Deduction {
        technique: Technique::SinglePoint,
        safe: !field.mines & !field.revealed,
        mines: 0,
    });
    Puzzle::new(id, category, difficulty, field, deduction)
}

fn has_no_alternative_moves(field: &Field64, intended: Deduction) -> bool {
    field.available_deductions().is_ok_and(|deductions| {
        deductions.into_iter().all(|deduction| {
            deduction.safe & !intended.safe == 0 && deduction.mines & !intended.mines == 0
        })
    })
}

fn random_mines(rng: &mut Rng, count: u32) -> u64 {
    let mut mines = 0_u64;
    while mines.count_ones() < count {
        mines |= 1_u64 << (rng.next() & 63);
    }
    mines
}

fn relevant_clues(field: &Field64, deduction: Deduction) -> u64 {
    let targets = deduction.safe | deduction.mines;
    let mut result = 0;
    let mut revealed = field.revealed;
    while revealed != 0 {
        let index = revealed.trailing_zeros() as usize;
        revealed &= revealed - 1;
        if Field64::neighbors(index) & targets != 0 {
            result |= 1_u64 << index;
        }
    }
    result
}

fn related_unknowns(field: &Field64, clues: u64) -> u64 {
    let mut result = 0;
    let mut remaining = clues;
    while remaining != 0 {
        let index = remaining.trailing_zeros() as usize;
        remaining &= remaining - 1;
        result |= Field64::neighbors(index) & !field.revealed;
    }
    result
}

fn puzzle_frontier(field: &Field64) -> u64 {
    let mut frontier = 0;
    let mut clues = field.revealed;
    while clues != 0 {
        let index = clues.trailing_zeros() as usize;
        clues &= clues - 1;
        frontier |= Field64::neighbors(index);
    }
    frontier & !field.revealed & !field.flagged
}

fn hash_seed(seed: &str) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in seed.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    mix64(hash)
}

fn mix64(mut value: u64) -> u64 {
    value ^= value >> 30;
    value = value.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed)
    }

    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        mix64(self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn play_all_required(game: &mut Game) {
        let (mut safe, mut mines) = {
            let puzzle = game.puzzle.as_ref().unwrap();
            (puzzle.required_safe, puzzle.required_mines)
        };
        while safe != 0 {
            let index = safe.trailing_zeros() as usize;
            safe &= safe - 1;
            if game.puzzle.as_ref().unwrap().field.revealed & (1_u64 << index) == 0 {
                game.act(index, ActionKind::Reveal);
                assert_ne!(game.puzzle.as_ref().unwrap().status, PuzzleStatus::Mistake);
            }
        }
        while mines != 0 {
            let index = mines.trailing_zeros() as usize;
            mines &= mines - 1;
            if game.puzzle.as_ref().unwrap().field.flagged & (1_u64 << index) == 0 {
                game.act(index, ActionKind::Mark);
                assert_ne!(game.puzzle.as_ref().unwrap().status, PuzzleStatus::Mistake);
            }
        }
        assert_eq!(game.puzzle.as_ref().unwrap().status, PuzzleStatus::Solved);
    }

    #[test]
    fn practice_categories_generate_logical_positions() {
        for seed in 0..32 {
            let mut game = Game::new(seed);
            for category in 0..CATEGORY_DATA.len() {
                game.configure_practice(category);
                let puzzle = game.puzzle.as_ref().unwrap();
                assert_ne!(puzzle.deduction.safe | puzzle.deduction.mines, 0);
                assert_eq!(puzzle.status, PuzzleStatus::Playing);
                let expected = match puzzle.category {
                    Category::Basics => puzzle.deduction.technique == Technique::SinglePoint,
                    Category::Subsets => puzzle.deduction.technique == Technique::Subset,
                    Category::Overlaps | Category::Contradiction => {
                        puzzle.deduction.technique == Technique::Exhaustive
                    }
                    Category::Chains => matches!(
                        puzzle.deduction.technique,
                        Technique::Subset | Technique::Exhaustive
                    ),
                    Category::Global => puzzle.deduction.technique == Technique::MineCount,
                    Category::Mixed => true,
                };
                assert!(expected, "wrong technique for {}", puzzle.category.label());
                assert!(
                    has_no_alternative_moves(&puzzle.initial, puzzle.deduction),
                    "{} puzzle from seed {seed} exposed another valid move",
                    puzzle.category.label()
                );
            }
        }
    }

    #[test]
    fn any_solver_proven_move_is_accepted_even_if_not_in_the_intended_mask() {
        let mut game = Game::new(73);
        for _ in 0..32 {
            let puzzle = game.puzzle.as_mut().unwrap();
            let valid = puzzle
                .available
                .iter()
                .fold(0, |mask, deduction| mask | deduction.safe | deduction.mines);
            if valid.count_ones() >= 2 {
                let bit = 1_u64 << valid.trailing_zeros();
                puzzle.deduction.safe &= !bit;
                puzzle.deduction.mines &= !bit;
                let action = if puzzle
                    .available
                    .iter()
                    .any(|deduction| deduction.safe & bit != 0)
                {
                    ActionKind::Reveal
                } else {
                    ActionKind::Mark
                };
                game.act(bit.trailing_zeros() as usize, action);
                assert_ne!(game.puzzle.as_ref().unwrap().status, PuzzleStatus::Mistake);
                return;
            }
            game.new_practice();
        }
        panic!("expected a puzzle with at least two provable moves");
    }

    #[test]
    fn every_original_move_is_required_without_solver_auto_resolution() {
        let mut game = Game::new(7);
        for _ in 0..64 {
            let puzzle = game.puzzle.as_ref().unwrap();
            if puzzle.required_mines != 0
                && (puzzle.required_safe | puzzle.required_mines).count_ones() >= 2
            {
                break;
            }
            game.new_practice();
        }
        let puzzle = game.puzzle.as_ref().unwrap();
        let index = puzzle.required_mines.trailing_zeros() as usize;
        let action = ActionKind::Mark;
        let mut expected = puzzle.field;
        match action {
            ActionKind::Reveal => {
                expected.reveal(index / 8, index % 8).unwrap();
            }
            ActionKind::Mark => expected.flagged |= 1_u64 << index,
        }
        game.act(index, action);
        assert_eq!(game.puzzle.as_ref().unwrap().field, expected);
        assert_eq!(game.puzzle.as_ref().unwrap().status, PuzzleStatus::Playing);
        play_all_required(&mut game);
    }

    #[test]
    fn wrong_frontier_move_is_educational_and_outside_cells_are_inert() {
        let mut game = Game::new(19);
        for _ in 0..64 {
            let puzzle = game.puzzle.as_ref().unwrap();
            let wrong = puzzle.frontier & !(puzzle.required_safe | puzzle.required_mines);
            if wrong != 0 {
                break;
            }
            game.new_practice();
        }
        let puzzle = game.puzzle.as_ref().unwrap();
        let target = puzzle.required_safe | puzzle.required_mines;
        let wrong = (puzzle.frontier & !target).trailing_zeros() as usize;
        game.act(wrong, ActionKind::Reveal);
        assert_eq!(game.puzzle.as_ref().unwrap().status, PuzzleStatus::Mistake);
        assert!(game.snapshot().puzzle.unwrap().explanation.is_some());

        game.reset();
        let puzzle = game.puzzle.as_ref().unwrap();
        let outside_mask = !puzzle.frontier & !puzzle.field.revealed & !puzzle.field.flagged;
        let outside = outside_mask.trailing_zeros() as usize;
        let before = puzzle.field;
        game.act(outside, ActionKind::Reveal);
        assert_eq!(game.puzzle.as_ref().unwrap().field, before);
        assert_eq!(game.puzzle.as_ref().unwrap().status, PuzzleStatus::Playing);
    }

    #[test]
    fn hints_reveal_reasoning_in_steps() {
        let mut game = Game::new(11);
        assert_eq!(game.puzzle.as_ref().unwrap().hint_level, 0);
        game.hint();
        assert_eq!(game.puzzle.as_ref().unwrap().hint_level, 1);
        assert!(
            game.snapshot()
                .puzzle
                .unwrap()
                .cells
                .iter()
                .any(|cell| cell.relevant_clue)
        );
        game.hint();
        game.hint();
        assert!(
            game.snapshot()
                .puzzle
                .unwrap()
                .cells
                .iter()
                .any(|cell| cell.forced_safe || cell.forced_mine)
        );
    }

    #[test]
    fn challenge_seed_is_deterministic_and_progresses() {
        let mut first = Game::new(1);
        let mut second = Game::new(999);
        first.start_challenge("K4M8JQB5T");
        second.start_challenge("k4m8jqb5t");
        assert_eq!(
            first.puzzle.as_ref().unwrap().initial,
            second.puzzle.as_ref().unwrap().initial
        );

        play_all_required(&mut first);
        assert_eq!(first.challenge.as_ref().unwrap().solved, 1);
        first.next();
        assert_eq!(first.challenge.as_ref().unwrap().index, 1);
    }

    #[test]
    fn perfect_challenge_reaches_the_result_screen() {
        let mut game = Game::new(1);
        game.start_challenge("FULL-RUN");
        for _ in 0..CHALLENGE_LENGTH {
            play_all_required(&mut game);
            game.next();
        }
        let snapshot = game.snapshot();
        let challenge = snapshot.challenge.unwrap();
        assert_eq!(snapshot.screen, "results");
        assert_eq!(challenge.solved, CHALLENGE_LENGTH);
        assert_eq!(challenge.failed, 0);
        assert!(challenge.perfect);
    }

    #[test]
    fn solver_generator_never_uses_a_guess_as_the_target() {
        for seed in 0..24 {
            let puzzle =
                generate_puzzle(seed, Category::Mixed, Difficulty::Expert, seed.to_string());
            let next = puzzle.initial.next_deduction().unwrap().unwrap();
            assert_eq!(next, puzzle.deduction);
        }
    }
}
