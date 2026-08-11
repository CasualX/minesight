use super::{Field64, RevealResult};
use std::fmt;

/// The kind of reasoning which produced a deduction.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Technique {
    /// Uses the declared total number of mines.
    MineCount,
    /// Applies the two standard rules to one numbered square.
    SinglePoint,
    /// Subtracts the unknown neighbors of one clue from another.
    Subset,
    /// Enumerates every assignment in a connected frontier component.
    Exhaustive,
}

impl fmt::Display for Technique {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::MineCount => "mine count",
            Self::SinglePoint => "single-point rule",
            Self::Subset => "subset rule",
            Self::Exhaustive => "exact frontier search",
        })
    }
}

/// A logically certain set of moves. Bits in `safe` may be revealed and bits
/// in `mines` may be flagged.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct Deduction {
    pub technique: Technique,
    pub safe: u64,
    pub mines: u64,
}

/// Why a solve pass stopped.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum SolveStatus {
    Solved,
    Stuck,
    Contradiction,
}

/// Summary returned by [`Field64::solve`].
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct SolveReport {
    pub status: SolveStatus,
    pub deductions: u32,
    pub newly_revealed: u32,
    pub newly_flagged: u32,
    /// Number of deductions by mine-count, single-point, subset, and exhaustive
    /// reasoning, in that order.
    pub techniques: [u32; 4],
}

/// An invalid set of visible clues or flags.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum SolveError {
    TooManyFlags { clue: usize },
    ImpossibleClue { clue: usize },
    ConflictingDeductions,
    DeducedMineWasSafe,
    DeducedSafeWasMine,
}

impl fmt::Display for SolveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooManyFlags { clue } => {
                write!(f, "clue at bit {clue} has too many adjacent flags")
            }
            Self::ImpossibleClue { clue } => write!(f, "clue at bit {clue} cannot be satisfied"),
            Self::ConflictingDeductions => {
                f.write_str("a square was deduced to be both safe and mined")
            }
            Self::DeducedMineWasSafe => {
                f.write_str("the supplied clues caused a safe square to be flagged")
            }
            Self::DeducedSafeWasMine => {
                f.write_str("the supplied clues caused a mine to be revealed")
            }
        }
    }
}

impl std::error::Error for SolveError {}

#[derive(Copy, Clone, Debug)]
struct Constraint {
    cells: u64,
    mines: u8,
    clue: usize,
}

impl Field64 {
    /// Returns the next certain move, preferring cheaper techniques.
    pub fn next_deduction(&self) -> Result<Option<Deduction>, SolveError> {
        Ok(self.available_deductions()?.into_iter().next())
    }

    /// Returns all currently provable moves, ordered from the cheapest proof to
    /// exact frontier search.
    pub(crate) fn available_deductions(&self) -> Result<Vec<Deduction>, SolveError> {
        let mut deductions = Vec::new();
        let hidden = !self.revealed & !self.flagged;
        let mines_left = self
            .mines
            .count_ones()
            .checked_sub(self.flagged.count_ones());
        if let Some(mines_left) = mines_left {
            if hidden != 0 && (mines_left == 0 || mines_left == hidden.count_ones()) {
                deductions.push(Deduction {
                    technique: Technique::MineCount,
                    safe: if mines_left == 0 { hidden } else { 0 },
                    mines: if mines_left == hidden.count_ones() {
                        hidden
                    } else {
                        0
                    },
                });
            }
        } else {
            return Err(SolveError::ConflictingDeductions);
        }

        let constraints = self.constraints()?;
        if let Some(deduction) = direct_deduction(&constraints)? {
            deductions.push(deduction);
        }
        if let Some(deduction) = subset_deduction(&constraints)? {
            deductions.push(deduction);
        }
        if let Some(deduction) = exhaustive_deduction(&constraints)? {
            deductions.push(deduction);
        }
        Ok(deductions)
    }

    /// Applies deterministic deductions until the board is solved or no certain
    /// move remains. This method never guesses.
    pub fn solve(&mut self) -> SolveReport {
        let initial_revealed = self.revealed.count_ones();
        let initial_flagged = self.flagged.count_ones();
        let mut report = SolveReport {
            status: SolveStatus::Stuck,
            deductions: 0,
            newly_revealed: 0,
            newly_flagged: 0,
            techniques: [0; 4],
        };

        loop {
            if self.revealed | self.flagged == u64::MAX
                && self.flagged.count_ones() == self.mines.count_ones()
            {
                report.status = SolveStatus::Solved;
                break;
            }
            let deduction = match self.next_deduction() {
                Ok(Some(deduction)) => deduction,
                Ok(None) => break,
                Err(_) => {
                    report.status = SolveStatus::Contradiction;
                    break;
                }
            };
            if self.apply_deduction(deduction).is_err() {
                report.status = SolveStatus::Contradiction;
                break;
            }
            report.deductions += 1;
            report.techniques[technique_index(deduction.technique)] += 1;
        }

        report.newly_revealed = self.revealed.count_ones() - initial_revealed;
        report.newly_flagged = self.flagged.count_ones() - initial_flagged;
        report
    }

    fn constraints(&self) -> Result<Vec<Constraint>, SolveError> {
        let mut constraints = Vec::new();
        let mut clues = self.revealed;
        while clues != 0 {
            let clue = clues.trailing_zeros() as usize;
            clues &= clues - 1;
            let neighbors = Self::neighbors(clue);
            let flags = (neighbors & self.flagged).count_ones() as u8;
            let number = self.numbers[clue];
            if flags > number {
                return Err(SolveError::TooManyFlags { clue });
            }
            let cells = neighbors & !self.revealed & !self.flagged;
            let mines = number - flags;
            if mines as u32 > cells.count_ones() {
                return Err(SolveError::ImpossibleClue { clue });
            }
            if cells == 0 {
                if mines != 0 {
                    return Err(SolveError::ImpossibleClue { clue });
                }
                continue;
            }
            if !constraints
                .iter()
                .any(|c: &Constraint| c.cells == cells && c.mines == mines)
            {
                constraints.push(Constraint { cells, mines, clue });
            }
        }
        Ok(constraints)
    }

    pub(crate) fn apply_deduction(&mut self, deduction: Deduction) -> Result<(), SolveError> {
        if deduction.safe & deduction.mines != 0 {
            return Err(SolveError::ConflictingDeductions);
        }
        if deduction.mines & !self.mines != 0 {
            return Err(SolveError::DeducedMineWasSafe);
        }
        self.flagged |= deduction.mines;
        let mut safe = deduction.safe & !self.revealed;
        while safe != 0 {
            let index = safe.trailing_zeros() as usize;
            safe &= safe - 1;
            match self.reveal(index / 8, index % 8) {
                Ok(RevealResult::Safe { .. }) => {}
                _ => return Err(SolveError::DeducedSafeWasMine),
            }
        }
        Ok(())
    }
}

fn technique_index(technique: Technique) -> usize {
    match technique {
        Technique::MineCount => 0,
        Technique::SinglePoint => 1,
        Technique::Subset => 2,
        Technique::Exhaustive => 3,
    }
}

fn merge(technique: Technique, safe: u64, mines: u64) -> Result<Option<Deduction>, SolveError> {
    if safe & mines != 0 {
        Err(SolveError::ConflictingDeductions)
    } else if safe | mines == 0 {
        Ok(None)
    } else {
        Ok(Some(Deduction {
            technique,
            safe,
            mines,
        }))
    }
}

fn direct_deduction(constraints: &[Constraint]) -> Result<Option<Deduction>, SolveError> {
    let mut safe = 0;
    let mut mines = 0;
    for constraint in constraints {
        if constraint.mines == 0 {
            safe |= constraint.cells;
        } else if constraint.mines as u32 == constraint.cells.count_ones() {
            mines |= constraint.cells;
        }
    }
    merge(Technique::SinglePoint, safe, mines)
}

fn subset_deduction(constraints: &[Constraint]) -> Result<Option<Deduction>, SolveError> {
    let mut safe = 0;
    let mut mines = 0;
    for (i, small) in constraints.iter().enumerate() {
        for (j, large) in constraints.iter().enumerate() {
            if i == j || small.cells == large.cells || small.cells & !large.cells != 0 {
                continue;
            }
            if small.mines > large.mines {
                return Err(SolveError::ImpossibleClue { clue: large.clue });
            }
            let difference = large.cells & !small.cells;
            let difference_mines = large.mines - small.mines;
            if difference_mines as u32 > difference.count_ones() {
                return Err(SolveError::ImpossibleClue { clue: large.clue });
            }
            if difference_mines == 0 {
                safe |= difference;
            } else if difference_mines as u32 == difference.count_ones() {
                mines |= difference;
            }
        }
    }
    merge(Technique::Subset, safe, mines)
}

fn exhaustive_deduction(constraints: &[Constraint]) -> Result<Option<Deduction>, SolveError> {
    let mut remaining: Vec<usize> = (0..constraints.len()).collect();
    let mut all_safe = 0;
    let mut all_mines = 0;

    while let Some(first) = remaining.pop() {
        let mut component_constraints = vec![first];
        let mut component_cells = constraints[first].cells;
        loop {
            let mut changed = false;
            let mut index = 0;
            while index < remaining.len() {
                let candidate = remaining[index];
                if constraints[candidate].cells & component_cells != 0 {
                    component_cells |= constraints[candidate].cells;
                    component_constraints.push(candidate);
                    remaining.swap_remove(index);
                    changed = true;
                } else {
                    index += 1;
                }
            }
            if !changed {
                break;
            }
        }

        // Exact search is deliberately bounded. Larger frontiers remain `Stuck`
        // instead of causing surprising exponential runtimes.
        if component_cells.count_ones() > 22 {
            continue;
        }
        let cells: Vec<usize> = BitIndices(component_cells).collect();
        let selected: Vec<Constraint> = component_constraints
            .iter()
            .map(|&i| constraints[i])
            .collect();
        let mut search = Search {
            constraints: &selected,
            cells: &cells,
            solutions: 0,
            union: 0,
            intersection: component_cells,
        };
        search.visit(0, 0);
        if search.solutions == 0 {
            return Err(SolveError::ImpossibleClue {
                clue: constraints[first].clue,
            });
        }
        all_mines |= search.intersection;
        all_safe |= component_cells & !search.union;
    }

    merge(Technique::Exhaustive, all_safe, all_mines)
}

struct Search<'a> {
    constraints: &'a [Constraint],
    cells: &'a [usize],
    solutions: u64,
    union: u64,
    intersection: u64,
}

impl Search<'_> {
    fn visit(&mut self, depth: usize, mines: u64) {
        if !self.viable(depth, mines) {
            return;
        }
        if depth == self.cells.len() {
            self.solutions += 1;
            self.union |= mines;
            self.intersection &= mines;
            return;
        }
        self.visit(depth + 1, mines);
        self.visit(depth + 1, mines | (1_u64 << self.cells[depth]));
    }

    fn viable(&self, depth: usize, mines: u64) -> bool {
        let assigned = self.cells[..depth]
            .iter()
            .fold(0_u64, |mask, &cell| mask | (1_u64 << cell));
        for constraint in self.constraints {
            let placed = (constraint.cells & assigned & mines).count_ones();
            let undecided = (constraint.cells & !assigned).count_ones();
            let target = constraint.mines as u32;
            if placed > target || placed + undecided < target {
                return false;
            }
        }
        true
    }
}

struct BitIndices(u64);

impl Iterator for BitIndices {
    type Item = usize;

    fn next(&mut self) -> Option<Self::Item> {
        if self.0 == 0 {
            None
        } else {
            let index = self.0.trailing_zeros() as usize;
            self.0 &= self.0 - 1;
            Some(index)
        }
    }
}

#[cfg(test)]
mod tests;
