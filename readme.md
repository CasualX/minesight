Minesight
=========

A small experimental Minesweeper tactics engine.

The aim is to generate short, interesting positions that begin where an ordinary
Minesweeper board gets difficult. Routine deductions can be resolved in advance,
leaving compact puzzles built around the decisions that are actually worth
thinking about--something closer to chess tactics than a full game of Minesweeper.

The board is fixed at 8x8 so its cells fit in a single `u64`. This keeps board
operations and repeated solver checks cheap, which will be useful when searching
through many generated positions and ranking them by difficulty.

Current state
-------------

For now, this crate contains the beginnings of the core game logic:

- compact game-state and neighbourhood masks;
- seeded board generation with a safe opening area;
- revealing, flagging, flood filling, and win/loss detection;
- a local solver for direct clue deductions;
- a subset solver that subtracts contained clue constraints;
- a total-count solver for deductions from the number of mines;
- an exact solver that enumerates consistent frontier configurations; and
- a basic text-mode example for exercising the engine.

There is no polished game or user interface yet. Puzzle generation, difficulty
classification, and presentation are still to come.

Trying it
---------

Run the small terminal example with:

```sh
cargo run --example play
```

Enter `xXY` to reveal a cell, `fXY` to flag one, or `wXY` to make a
guaranteed-correct play, where `X` and `Y` are zero-based coordinates.

Enter `sl` to repeatedly apply local deductions, `ss` for subset deductions,
`st` for total mine-count deductions, or `se` to apply deductions from the exact
solver. Use `check local`, `check subset`, `check total`, or `check exact` to ask
whether a solver can make progress without applying its deductions.

To sample the current random board generator and compare solver strength, run:

```sh
cargo run --release --example solver_stats -- 1000
```

The example repeatedly applies each solver to the same seeded boards. It reports
how often the exact solver finishes and, among those boards, how often subset
plus total-count deductions are sufficient to finish without exact-only deductions.

To generate a self-contained HTML gallery of 100 puzzles, choose a difficulty:

```sh
cargo run --release --example demo -- easy > easy.html
cargo run --release --example demo -- medium > medium.html
cargo run --release --example demo -- hard > hard.html
```

Pass a number after the difficulty to change the puzzle count. Easy positions
highlight at least three deductions from one subset-solver pass after local
solving stalls. Medium and hard positions exhaust the subset solver and require
exact-known and ambiguous frontier cells. Medium keeps both counts between two
and four, except that four-and-four is classified as hard. Hard requires both
counts to be at least four. Both reject positions explained only by the total
mine count. All galleries dim covered cells beyond the frontier. Progress is
reported to stderr, leaving stdout as clean HTML for redirection.

To inspect an experimental integer mine-density function, render an HTML heat map:

```sh
cargo run --release --example density_map > density_map.html
```

Every cell is an unsigned fixed-point probability where 65,536 represents one.
Board generation compares it directly with `rng.random::<u16>()`. The experiment
chooses a random center and direction using the library implementation. Open the
generated file in a browser to inspect the per-cell percentages.
