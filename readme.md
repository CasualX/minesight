# Minesight

A minesweeper tactics game.

**[Play Minesight](https://casualhacks.net/minesight/)**

Minesight is a collection of short Minesweeper logic puzzles.
You can skip the routine opening moves and get straight to a small knot of clues.
Your job is to work out which covered squares are safe and which hide mines.

## How to play

Use the revealed numbers to mark every covered square that must be safe or mined.

- Tap or left-click to mark a square as safe.
- Long-press or right-click to mark a mine.
- Choose **Study** to play at your own pace. You can change the difficulty or ask for a hint.
- Choose **Challenge** to race through a set of puzzles that gets harder as you go. An unsupported mark fails that segment; you can keep solving.

You never need to guess. Every answer follows from the clues on the board.

## Development

The Vue 3 frontend lives in `app/` and uses a custom framework: [link](https://github.com/CasualX/Vue-Script).

Run `vue-script build` after editing components to regenerate `public/index.html`.

The previous Alpine frontend is retained as `public/old.html`, `public/old.js` and `public/old.css`.

Run `./scripts/build.sh` to build both the WebAssembly engine and Vue frontend, then serve `public/` over HTTP.

Run `npm test` for browser model and Vue controller regressions, and `cargo test --all-targets` for the engine.
