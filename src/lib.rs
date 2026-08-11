//! A small, deterministic Minesweeper engine and solver for an 8 by 8 board.
//!
//! Bits are laid out in row-major order: bit `row * 8 + column` represents a
//! square. [`Field64::next_deduction`] only reasons from revealed numbers,
//! flags, and the total mine count; it never uses mine locations.

use std::fmt;

mod game;
mod solver;

pub use game::{ActionKind, Game, GameSnapshot, Mode, PuzzleStatus};
pub use solver::{Deduction, SolveError, SolveReport, SolveStatus, Technique};

#[cfg(target_arch = "wasm32")]
mod wasm32;

/// The result of revealing a square.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum RevealResult {
    /// One or more safe squares were revealed (zeroes reveal their border too).
    Safe { newly_revealed: u32 },
    /// The selected square contained a mine.
    Mine,
}

/// Errors produced by board operations.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum BoardError {
    OutOfBounds { row: usize, column: usize },
    Flagged { row: usize, column: usize },
}

impl fmt::Display for BoardError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::OutOfBounds { row, column } => {
                write!(f, "square ({row}, {column}) is outside the 8x8 board")
            }
            Self::Flagged { row, column } => {
                write!(f, "square ({row}, {column}) is flagged")
            }
        }
    }
}

impl std::error::Error for BoardError {}

/// An 8 by 8 Minesweeper field.
///
/// The four bit sets are public to keep the type convenient for experiments.
/// Prefer [`Field64::new`], [`Field64::reveal`], and [`Field64::set_flag`] when
/// constructing a valid game state.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct Field64 {
    /// Ground truth used for revealing squares and validating solver moves.
    pub mines: u64,
    /// Squares currently marked as mines.
    pub flagged: u64,
    /// Squares visible to the player.
    pub revealed: u64,
    /// Adjacent-mine counts, indexed in row-major order.
    pub numbers: [u8; 64],
}

impl Field64 {
    pub const WIDTH: usize = 8;

    /// Creates a covered board and calculates all adjacent-mine counts.
    pub fn new(mines: u64) -> Self {
        let mut numbers = [0; 64];
        for (index, number) in numbers.iter_mut().enumerate() {
            *number = (Self::neighbors(index) & mines).count_ones() as u8;
        }
        Self {
            mines,
            flagged: 0,
            revealed: 0,
            numbers,
        }
    }

    /// Returns the bit belonging to `(row, column)`.
    pub const fn bit(row: usize, column: usize) -> Option<u64> {
        if row < 8 && column < 8 {
            Some(1_u64 << (row * 8 + column))
        } else {
            None
        }
    }

    /// Returns the eight-way neighborhood of a row-major square index.
    pub fn neighbors(index: usize) -> u64 {
        if index >= 64 {
            return 0;
        }
        let row = index / 8;
        let column = index % 8;
        let mut result = 0;
        for dr in -1_isize..=1 {
            for dc in -1_isize..=1 {
                if dr == 0 && dc == 0 {
                    continue;
                }
                let r = row as isize + dr;
                let c = column as isize + dc;
                if (0..8).contains(&r) && (0..8).contains(&c) {
                    result |= 1_u64 << (r * 8 + c);
                }
            }
        }
        result
    }

    /// Reveals a square. Revealing a zero recursively opens its safe region.
    pub fn reveal(&mut self, row: usize, column: usize) -> Result<RevealResult, BoardError> {
        let Some(bit) = Self::bit(row, column) else {
            return Err(BoardError::OutOfBounds { row, column });
        };
        if self.flagged & bit != 0 {
            return Err(BoardError::Flagged { row, column });
        }
        if self.mines & bit != 0 {
            self.revealed |= bit;
            return Ok(RevealResult::Mine);
        }

        let before = self.revealed;
        let mut pending = bit;
        while pending != 0 {
            let index = pending.trailing_zeros() as usize;
            let current = 1_u64 << index;
            pending &= !current;
            if self.revealed & current != 0
                || self.flagged & current != 0
                || self.mines & current != 0
            {
                continue;
            }
            self.revealed |= current;
            if self.numbers[index] == 0 {
                pending |= Self::neighbors(index) & !self.revealed & !self.flagged & !self.mines;
            }
        }

        Ok(RevealResult::Safe {
            newly_revealed: (self.revealed ^ before).count_ones(),
        })
    }

    /// Adds or removes a flag without revealing the square.
    pub fn set_flag(&mut self, row: usize, column: usize, flagged: bool) -> Result<(), BoardError> {
        let Some(bit) = Self::bit(row, column) else {
            return Err(BoardError::OutOfBounds { row, column });
        };
        if flagged {
            self.flagged |= bit;
        } else {
            self.flagged &= !bit;
        }
        Ok(())
    }

    /// True when every non-mine square has been revealed.
    pub fn is_solved(&self) -> bool {
        (!self.mines & !self.revealed) == 0
    }

    fn symbol(&self, index: usize, reveal_truth: bool) -> char {
        let bit = 1_u64 << index;
        if self.revealed & bit != 0 {
            if self.mines & bit != 0 {
                '*'
            } else if self.numbers[index] == 0 {
                '.'
            } else {
                char::from(b'0' + self.numbers[index])
            }
        } else if self.flagged & bit != 0 {
            'F'
        } else if reveal_truth && self.mines & bit != 0 {
            'M'
        } else {
            '#'
        }
    }
}

impl fmt::Display for Field64 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "	0 1 2 3 4 5 6 7")?;
        writeln!(f, "  +----------------+")?;
        for row in 0..8 {
            write!(f, "{row} |")?;
            for column in 0..8 {
                write!(f, "{} ", self.symbol(row * 8 + column, f.alternate()))?;
            }
            writeln!(f, "|")?;
        }
        write!(f, "  +----------------+")
    }
}
