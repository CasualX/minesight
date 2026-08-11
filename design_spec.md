# Minetacs — Frontend / Game Design Specification

## Product Summary

**Minetacs** is a compact Minesweeper logic-puzzle game focused on the interesting deduction moments rather than clearing full traditional boards.

The core analogy is **chess tactics for Minesweeper**:

- Each puzzle starts from a partially revealed small board.
- The position is intentionally selected because it contains an interesting logical deduction.
- The goal is to identify and play the correct logical move(s), not to spend time clearing large areas of routine cells.
- Puzzles are generated indefinitely in the browser.
- There is no backend, no account system, no leaderboard, and no daily puzzle requirement.
- The site should work as a static single-page site suitable for GitHub Pages.
- The UI should be especially comfortable on mobile.

Suggested subtitle:

> **Tactics for Minesweeper.**

---

# Core Design Principles

## 1. Focus on deduction, not board clearing

Traditional Minesweeper often contains long stretches of obvious moves between genuinely interesting deductions. Minetacs should skip as much routine work as possible and present the player close to the tactical moment.

The interesting question should usually be:

> **What can be proven from this position?**

rather than:

> Can you mechanically finish this entire large board?

## 2. Small boards

Puzzle size should be 8x8 for simplicity

Small boards are intentional because they:

- fit comfortably on phones;
- allow large tap targets;
- make the relevant reasoning easier to visually parse;
- reduce accidental clicks;
- make short puzzle sessions practical;
- avoid scrolling or panning around a traditional large Minesweeper board.

## 3. No guessing in intended puzzle solutions

The player should never be required to make an arbitrary probabilistic guess in normal Minetacs puzzles.

Every accepted puzzle should contain a logical continuation under the techniques allowed for its selected difficulty.

The game can still teach advanced reasoning, including contradiction or global reasoning, but the intended answer must be logically justified.

## 4. Minimal interface

The board is the product.

Avoid a dashboard-heavy look. The site should feel lightweight and immediate.

Visual direction:

- simple typography;
- clear square cells;
- strong number readability;
- restrained colors;
- no blur-heavy glass effects;
- no glow effects;
- minimal shadows, if any;
- few panels;
- responsive layout;
- desktop and mobile should use essentially the same page structure.

---

# Main Navigation

The application has two primary modes:

1. **Practice**
2. **Challenge**

The current mode should always be obvious.

A simple top navigation is enough:

```text
Minetacs
Practice   Challenge
```

The mode selector should remain compact on mobile.

No login, profile, streak, social feed, daily puzzle, or account-related UI is needed.

---

# Practice Mode

## Purpose

Practice is the relaxed, educational, infinite-puzzle mode.

The player chooses the kind of reasoning they want to practice or chooses a general difficulty. The game then continuously generates suitable puzzles.

Practice should feel low-pressure and exploratory.

## Practice flow

```text
Choose category / difficulty
        ↓
Generate puzzle
        ↓
Player solves
        ↓
Success / mistake / hint
        ↓
Optional explanation
        ↓
Next puzzle
        ↓
Repeat forever
```

There is no overall run score and no requirement to preserve a streak.

## Practice selectors

Practice should allow the player to request puzzles by **strategy / reasoning type**.

Suggested categories:

- Local deductions
- Subset reasoning
- Overlapping constraints
- Chains / multi-step deductions
- Global mine-count reasoning
- Contradiction / hypothetical reasoning
- Mixed

Names can be simplified for UI presentation. For example:

```text
Basics
Subsets
Overlaps
Chains
Global
Contradiction
Mixed
```

The exact solver taxonomy may evolve. The frontend should therefore treat categories as data rather than hard-code logic around specific names.

Practice can optionally also expose broad difficulty:

- Easy
- Medium
- Hard
- Expert

A puzzle may have both:

```text
Technique: Overlap
Difficulty: Hard
```

However, in Practice it is acceptable—and useful—to tell the player what technique they are practicing.

## Practice puzzle controls

Recommended controls:

- **New Puzzle**
- **Hint**
- **Explain** or explanation after reveal
- optional **Reset Puzzle**

Do not overload the interface with many settings.

If board size or density are exposed at all, they should be secondary / advanced settings, not the main interaction.

## Mistakes in Practice

A mistake should not feel punitive.

If the player clicks a mine or incorrectly marks a cell:

- clearly indicate the mistake;
- preserve enough of the position for the player to understand what went wrong;
- offer the explanation;
- allow immediate retry or next puzzle.

A mistake does **not** end Practice mode.

Suggested feedback:

```text
Not quite.
That square cannot be proven safe.
[Show why] [Try again] [Next]
```

Avoid condescending copy.

## Hint behavior

Hints should be incremental where possible.

A good progression:

### Hint 1 — attention

Highlight the region or clues involved.

Example:

> Look at these two overlapping clues.

### Hint 2 — reasoning direction

Explain the relationship without giving the final cell.

Example:

> The unknown cells around the 2 are contained within the unknown cells around the 3.

### Hint 3 — answer

Highlight the forced safe or mine cell and explain why.

If implementing multiple hint levels is undesirable for the first version, a single useful hint is acceptable.

## Explanations

Explanations are important to Practice mode.

After solving, failing, or requesting help, the game should be able to explain the intended deduction in plain language.

The explanation should ideally:

- visually highlight the relevant numbered cells;
- highlight the relevant unknown cells;
- distinguish known mines and known safe cells;
- name the technique;
- explain the logical relation in one or a few short steps.

Example:

```text
Subset

The 2 already needs one mine among these two cells.
The neighboring 3 needs two mines among those same cells plus this third cell.
Therefore the extra cell must be a mine.
```

Avoid showing an enormous solver proof when a short human-readable explanation exists.

## Practice completion

After a successful deduction or completion of the intended sequence:

- show brief success feedback;
- optionally show the technique used;
- make **Next Puzzle** the obvious action.

Example:

```text
Solved — Overlap
[Next Puzzle]
```

The next puzzle should be fast to reach, especially on mobile.

---

# Challenge Mode

## Purpose

Challenge mode gives Minetacs a clear start-to-finish gameplay loop.

Instead of endless sandbox play, the player attempts a fixed sequence of increasingly difficult puzzles and receives a result at the end.

The emphasis is on:

- progression;
- consistency;
- speed;
- solving without hints;
- replaying or sharing the same seeded run.

## Challenge flow

Example:

```text
Start Challenge
      ↓
Easy puzzles
      ↓
Medium puzzles
      ↓
Hard puzzles
      ↓
Expert puzzles
      ↓
Run result
```

The exact number of puzzles per tier should be configurable.

A reasonable starting structure might be:

```text
Easy    × 3
Medium  × 3
Hard    × 3
Expert  × 3
```

or 4–5 puzzles per tier if the individual puzzles are very short.

The first tier should **not** be absolute beginner / trivial local deductions. Challenge assumes the player already understands basic Minesweeper.

The first puzzles should be easy enough to warm up but still contain an actual deduction worth noticing.

## Difficulty information in Challenge

Challenge mode should show broad difficulty only:

- Easy
- Medium
- Hard
- Expert

Do **not** reveal the required solving technique before the puzzle.

For example, do not tell the player:

> Technique: Subset

because that itself is a hint.

The technique may be shown afterward in a result or explanation screen.

## Progress indicator

Challenge should always show the player where they are in the run.

Examples:

```text
Puzzle 5 / 12
Medium
```

or:

```text
Easy     ✓ ✓ ✓
Medium   ✓ ● ○
Hard     ○ ○ ○
Expert   ○ ○ ○
```

Keep it compact on mobile.

## Timer

Challenge mode is timed.

The timer begins when the first challenge puzzle becomes playable.

The timer ends when:

- the player completes the final puzzle, or
- the run ends according to the chosen failure rules.

The running timer may be visible but should not dominate the board.

The primary final metric for a perfect completed challenge is **total completion time**.

Optional secondary stats:

- per-tier times;
- number of failed puzzles;
- number solved;
- average puzzle time.

## Failure model

Recommended default:

**A mistake fails the current puzzle but does not immediately destroy the entire run.**

This is more mobile-friendly and less frustrating than one accidental click erasing a long run.

A completed run can therefore produce:

```text
12 / 12 solved
Perfect Run
6:42
```

or:

```text
10 / 12 solved
2 failed
5:58
```

A **Perfect Run** should be visually distinguished and should be the main result worth comparing by time.

An optional future hardcore / survival mode could make one mistake end the run, but this is not required for the initial product.

## Hints in Challenge

Challenge should not provide hints.

---

# Seeded Challenges

## Purpose

Randomly generated puzzles make raw completion times difficult to compare because one run may naturally be easier than another.

Challenge mode therefore supports deterministic **seeded runs**.

A seed represents the complete challenge sequence.

Players using the same seed should receive the same:

- puzzle sequence;
- puzzle order;
- difficulty progression;
- board layouts;
- rotations / reflections;
- any other random choices that affect gameplay.

The frontend does not need to know how the seed maps to generated puzzles; it only needs to treat the seed as a stable identifier passed into the game engine.

## Default Challenge behavior

When the player starts a normal Challenge run:

1. generate a new random human-readable seed;
2. use that seed for the entire challenge;
3. show the seed during or at the end of the run;
4. allow the player to copy/share it.

## Entering a seed

Challenge start screen should offer two paths:

```text
[Start New Challenge]

Seed: [________]
[Play Seed]
```

Entering a seed should start the exact corresponding challenge.

No server lookup is needed.

The seed is an arbitrary string that is hashed in the backend no validation required on the front end.

## Sharing

At the result screen:

```text
Perfect Run
6:42

Seed: K4M8JQB5T

[Copy Seed]
[Play Again]
[New Challenge]
```

If desired, **Copy Challenge** can copy a compact line such as:

```text
Minetacs — 6:42 — Seed K4M8JQB5T
```

A URL query parameter is also strongly recommended so a challenge can be shared as a link.

Example:

```text
https://example.github.io/minetacs/?seed=K4M8JQB5T
```

Opening that URL should prefill or directly offer the seeded challenge.

Do not require a backend for this.

---

# Puzzle Interaction

## Revealing cells

Primary click / tap reveals a cell.
Right click (contextmenu) marks a mine.

Because mobile is important, use generic interactions like contextmenu.

## Marking mines

The game should support marking likely mines because some deductions are easier to reason about visually with marks.

Recommended mobile-friendly options:

- tap = reveal;
- long press = mark;

Avoid requiring players to flag every mine merely to make the solver/game state work.

The game is about deduction, not compulsory bookkeeping.

## Incorrect flags

In Practice, incorrect flags should be easy to undo and can trigger educational feedback.

In Challenge, an incorrect committed action may count as a mistake depending on the final interaction rules.

## Auto-resolution of trivial continuation

A key design option is to automatically resolve routine deductions after the player finds the difficult breakthrough.

Example:

```text
hard deduction
    ↓
player selects forced cell
    ↓
several trivial forced moves become available
    ↓
game resolves them automatically
    ↓
puzzle complete
```

This reinforces the design principle that the game is about finding the interesting deduction, not executing obvious cleanup.

This feature is optional but strongly aligned with the product identity.

If auto-resolution is used:

- animate it quickly and clearly;
- do not make it visually noisy;
- ensure the player understands why the puzzle ended;
- Practice mode can show the resulting deduction chain.

---

# Puzzle States and Visual Feedback

The board needs clear visual states for:

- hidden cell;
- revealed empty cell;
- revealed numbered cell;
- player-marked mine;
- correct mine shown by explanation;
- incorrect click;
- highlighted hint cell;
- highlighted relevant clue;
- solved / auto-resolved cells.

Do not depend only on subtle color differences. Shapes, borders, icons, or other cues should help distinguish states.

Number colors should remain conventional enough that experienced Minesweeper players parse them instantly.

The exact visual palette can vary with theme, but readability is more important than novelty.

---

# Puzzle Explanation UI

Explanation overlays should not obscure the board unnecessarily.

Recommended desktop layout:

```text
[ Board ]   [ Short explanation ]
```

Recommended mobile layout:

```text
[ Board ]

[ Explanation ]
```

or a small expandable explanation area below the board.

Explanation UI may use:

- numbered steps;
- highlighted cells;
- arrows or outlines;
- simple labels such as “1 mine here” / “therefore safe”.

Avoid complex modal sequences if the same information can be shown inline.

---

# Difficulty Model — User-Facing

Internally, difficulty may be generated from solver techniques and puzzle complexity, but the frontend should distinguish two concepts:

## Strategy category

Mostly used in Practice:

```text
Local
Subset
Overlap
Chain
Global
Contradiction
Mixed
```

## Difficulty rating

Used in Practice and Challenge:

```text
Easy
Medium
Hard
Expert
```

Difficulty should not merely mean mine density.

From the player's perspective, difficulty represents how hard the logical breakthrough is to find and execute.

Potential factors may include:

- number of clues involved;
- visual obviousness;
- deduction-chain depth;
- competing candidate regions;
- need for global reasoning;
- need for hypothetical reasoning.

The frontend does not need to calculate these values; it only receives the classification from the puzzle generator.

---

# Challenge Result Screen

For a perfect run:

```text
Challenge Complete

PERFECT RUN
6:42

Easy      0:48
Medium    1:16
Hard      1:53
Expert    2:45

12 / 12 solved
Seed K4M8JQB5T

[Copy Result]
[Play Seed Again]
[New Challenge]
```

For a non-perfect run:

```text
Challenge Complete

9 / 12 solved
3 failed
6:08

Seed K4M8JQB5T

[Review]
[Play Seed Again]
[New Challenge]
```

The exact presentation can be simpler than this; avoid turning the result screen into a statistics dashboard.

---

# Start / Landing Experience

The app should load quickly and make it obvious what to do.

A minimal first screen can simply show:

```text
Minetacs
Chess tactics for Minesweeper.

[Practice]
[Challenge]
```

Alternatively, default directly into Practice with a generated puzzle and keep Challenge available in the top navigation.

The latter is likely better for immediacy:

> Open page → puzzle already visible → start playing.

Avoid onboarding slides.

A tiny one-time or persistent help link is enough:

```text
How to play
```

---

# Help / Rules

A compact help panel should explain:

1. normal Minesweeper number rules;
2. every puzzle is logically solvable without guessing;
3. Practice allows hints and explanations;
4. Challenge is a seeded escalating run;
5. same seed = same challenge.

Example:

> Every puzzle has a logical solution. Numbers show how many mines touch that square. Find the forced safe cells or mines. Practice teaches specific techniques; Challenge gives you a fixed seeded sequence from Easy to Expert.

Do not provide a long tutorial before the player can begin.

---

# Mobile Design

Mobile usability is a core advantage of Minetacs.

## Requirements

- no horizontal page scrolling;
- board always fits within viewport width;
- sufficiently large touch targets;
- board remains square;
- controls stack cleanly beneath or above the board;
- important actions remain thumb-friendly;
- no hover-only functionality;
- marking mines must have a touch interaction;
- avoid accidental double-tap zoom behavior if possible using normal responsive layout techniques;
- no need for board panning.

The board should generally be the widest major element on the page.

---

# URL / Browser Behavior

Because this is a static GitHub Pages-style app, useful state can be represented in the URL.

Recommended query parameters:

```text
?challenge=K4M8JQB5T
```

Do not put transient puzzle progress into the URL unless there is a specific reason.

## Refresh behavior

For a seeded Challenge:

- refreshing should ideally retain the seed;
- whether it restores exact challenge progress is optional.

For Practice:

- refreshing can simply generate a new puzzle.

Browser-local persistence may be used for convenience, but the core game must not depend on an account or server.

---

# Accessibility

At minimum:

- all controls keyboard accessible;
- visible focus states;
- buttons use semantic HTML buttons;
- board cells are interactive elements with useful accessible labels;
- status changes use an `aria-live` region where appropriate;
- color is not the only indicator of mines, mistakes, or highlights;
- number contrast remains strong;
- touch controls have equivalent keyboard / mouse behavior.

Potential cell label example:

```text
Row 3 column 5, hidden
```

or after reveal:

```text
Row 3 column 5, clue 2
```

---

# Expected Engine / Frontend Contract

This document intentionally does not prescribe the Rust/WASM solver implementation.

From the HTML/frontend perspective, assume the puzzle engine can provide something conceptually equivalent to:

## Generate Practice puzzle

Input:

```text
technique / category
difficulty
optional seed
```

Output:

```text
board dimensions
cell states / clues
puzzle identifier or seed
technique label
difficulty label
```

## Generate Challenge

Input:

```text
challenge seed
```

Output:

```text
ordered list or deterministic stream of puzzles
broad difficulty for each puzzle
```

## Player action validation

Input:

```text
current puzzle
action type
target cell
```

Output:

```text
correct / incorrect
updated board state
puzzle solved or not
optional auto-resolution sequence
```

## Hint / explanation

Output should be suitable for direct UI presentation and ideally include:

```text
technique name
short explanation text
relevant clue cells
relevant unknown cells
forced result cells
optional ordered reasoning steps
```

The frontend should not need to reconstruct solver reasoning itself.

---

# Tone and Copy

The game can be slightly playful but should avoid excessive gamification.

Good tone:

- concise;
- confident;
- puzzle-oriented;
- occasionally dry / playful.

Potential small bits of flavor:

```text
Nice.
Forced.
Solved.
That one was sneaky.
```

A hidden or optional “Skill Issue” reference can be fun, especially around Challenge mode, but it should not become the entire visual identity.

Examples:

```text
Practice
Challenge
```

is clearer than making the main mode literally named “Skill Issue.”

“Skill Issue” could instead appear as:

- an achievement-like perfect-run message;
- a joke after requesting a hint;
- an alternate hardcore mode later;
- an easter egg.

---

# Non-Goals

The initial project does **not** need:

- accounts;
- cloud saves;
- backend services;
- global leaderboards;
- daily puzzles;
- streaks;
- achievements;
- social network features;
- monetization;
- large traditional Minesweeper boards;
- arbitrary guessing mechanics;
- elaborate graphics;
- multiple pages.

Keep the project small enough that its identity stays obvious.

---

# Core Gameplay Loop Summary

## Practice

> Choose what you want to practice → solve an interesting position → ask for help if needed → learn the reasoning → immediately get another puzzle.

## Challenge

> Start or enter a seed → solve a fixed sequence of increasingly difficult puzzles → avoid mistakes and hints → finish the ladder → receive a completion result and time → share the seed with a friend or replay it.

---

# Product Identity in One Sentence

> **Minetacs takes the interesting logical moments from Minesweeper and turns them into fast, replayable tactics puzzles.**

