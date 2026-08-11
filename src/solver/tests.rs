use super::*;

fn bits(cells: &[(usize, usize)]) -> u64 {
    cells.iter().fold(0, |mask, &(row, column)| {
        mask | Field64::bit(row, column).unwrap()
    })
}

#[test]
fn single_point_rule_finds_flags_and_safe_cells() {
    let constraints = [
        Constraint {
            cells: 0b0011,
            mines: 2,
            clue: 8,
        },
        Constraint {
            cells: 0b1100,
            mines: 0,
            clue: 9,
        },
    ];
    let deduction = direct_deduction(&constraints).unwrap().unwrap();
    assert_eq!(deduction.technique, Technique::SinglePoint);
    assert_eq!(deduction.mines, 0b0011);
    assert_eq!(deduction.safe, 0b1100);
}

#[test]
fn subset_rule_subtracts_overlapping_clues() {
    // a + b = 1 and a + b + c = 1, therefore c is safe.
    // a + b + d = 2 then also proves d is a mine.
    let constraints = [
        Constraint {
            cells: 0b0011,
            mines: 1,
            clue: 8,
        },
        Constraint {
            cells: 0b0111,
            mines: 1,
            clue: 9,
        },
        Constraint {
            cells: 0b1011,
            mines: 2,
            clue: 10,
        },
    ];
    let deduction = subset_deduction(&constraints).unwrap().unwrap();
    assert_eq!(deduction.technique, Technique::Subset);
    assert_eq!(deduction.safe, 0b0100);
    assert_eq!(deduction.mines, 0b1000);
}

#[test]
fn exhaustive_search_combines_non_subset_constraints() {
    // a + b = 1, b + c = 1, a + c + d = 2 has exactly one solution:
    // a and c are mines, while b and d are safe. No set is a subset of another.
    let constraints = [
        Constraint {
            cells: 0b0011,
            mines: 1,
            clue: 8,
        },
        Constraint {
            cells: 0b0110,
            mines: 1,
            clue: 9,
        },
        Constraint {
            cells: 0b1101,
            mines: 2,
            clue: 10,
        },
    ];
    assert!(direct_deduction(&constraints).unwrap().is_none());
    assert!(subset_deduction(&constraints).unwrap().is_none());
    let deduction = exhaustive_deduction(&constraints).unwrap().unwrap();
    assert_eq!(deduction.technique, Technique::Exhaustive);
    assert_eq!(deduction.mines, 0b0101);
    assert_eq!(deduction.safe, 0b1010);
}

#[test]
fn display_shows_player_view_and_optional_answer_key() {
    let mut field = Field64::new(bits(&[(0, 1), (7, 7)]));
    field.revealed = bits(&[(0, 0), (1, 0), (1, 1)]);
    field.flagged = bits(&[(0, 1)]);

    let player = field.to_string();
    assert!(player.contains("0 |1 F # # # # # # |"));
    assert!(player.contains("1 |1 1 # # # # # # |"));
    assert!(!player.contains('M'));

    let answer_key = format!("{field:#}");
    assert!(answer_key.contains("7 |# # # # # # # M |"));
    println!("Player view:\n{player}\n\nAnswer key:\n{answer_key}");
}

#[test]
fn solver_finishes_a_board_and_prints_the_transcript() {
    let mines = bits(&[
        (0, 0),
        (0, 1),
        (0, 5),
        (2, 4),
        (2, 7),
        (3, 2),
        (3, 3),
        (4, 4),
        (6, 5),
        (7, 5),
    ]);
    let mut field = Field64::new(mines);
    field.reveal(4, 6).unwrap();
    println!("Initial board:\n{field}");

    let report = field.solve();
    println!("\nSolver report: {report:?}\nFinal board:\n{field}");

    assert_eq!(report.status, SolveStatus::Solved);
    assert!(report.deductions > 1);
    assert!(
        report.techniques[1] > 0,
        "single-point reasoning should be used"
    );
    assert!(report.techniques[2] > 0, "subset reasoning should be used");
    assert!(report.techniques[3] > 0, "exact search should be used");
    assert_eq!(field.flagged, mines);
    assert!(field.is_solved());
}

#[test]
fn inconsistent_flags_are_reported_without_panicking() {
    let mut field = Field64::new(bits(&[(0, 0)]));
    field.revealed = bits(&[(1, 1)]);
    field.flagged = bits(&[(0, 0), (0, 1)]);
    assert_eq!(
        field.next_deduction(),
        Err(SolveError::ConflictingDeductions)
    );
    assert_eq!(field.solve().status, SolveStatus::Contradiction);
}
