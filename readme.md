# minetacs

An 8×8 Minesweeper board and deterministic solver backed by `u64` bit sets.
The solver applies, in order:

1. the known total mine count;
2. the standard single-clue safe/mine rules;
3. subset subtraction between overlapping clues; and
4. exact enumeration of connected frontier components (up to 22 cells).

It deliberately does not guess: `solve()` returns `SolveStatus::Stuck` when a
position has multiple valid solutions.

```rust
use minetacs::{Field64, SolveStatus};

let mines = Field64::bit(0, 0).unwrap() | Field64::bit(7, 7).unwrap();
let mut field = Field64::new(mines);
field.reveal(3, 3).unwrap();

let report = field.solve();
assert_eq!(report.status, SolveStatus::Solved);
println!("{field}");
```

Run `cargo test -- --nocapture` to see the player view, answer-key view, and a
complete solve transcript. Normal formatting (`{field}`) hides covered mines;
alternate formatting (`{field:#}`) displays them as `M` for debugging.

## Browser build

The static Alpine application lives in `docs/`. Rebuild its dependency-free
WASM module after changing Rust code:

```text
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/minetacs.wasm docs/minetacs.wasm
```

Serve `docs/` over HTTP (rather than opening `index.html` as a local file) so
the browser can fetch the module. Practice puzzle generation, validation,
hints, explanations, and seeded Challenge progression all run inside WASM.
