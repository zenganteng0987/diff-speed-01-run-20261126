# Diff two texts faster

[![diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/zenganteng0987/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/zenganteng0987/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)

A faster drop-in for makefun-diff 1.0.0: the same patch, written the same way, in less CPU
time. `solve.js` runs Myers's greedy search exactly as the baseline does (common prefix, then
common suffix, deletion wins a tie, snakes follow every run of equal lines), but over lines
interned to small integers once, with the search's diagonals kept in flat `Int32Array`s and no
path objects ever built. `main.ts` reads every case from `/input/cases.json`, answers each one
with `run()`, and writes `/output/answers.json`.

Entry for the make.fun bounty
[diff-speed-01-run-20261126](https://make.fun/bounty/diff-speed-01-run-20261126).
