// Connect6 rules: board, slots, win detection.
// Port of the Connect6 class in playgame.py.
"use strict";

const BS = 19;   // board size
const WIN = 6;   // stones in a row needed to win
const N = BS * BS;

// A "slot" is a run of WIN consecutive cells. Slots are grouped by direction
// (horizontal, vertical, diagonal, anti-diagonal) like ind_list_collect in Python.
const SLOTS_BY_DIR = (() => {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  return dirs.map(([dr, dc]) => {
    const slots = [];
    for (let r = 0; r < BS; r++) {
      for (let c = 0; c < BS; c++) {
        const er = r + dr * (WIN - 1), ec = c + dc * (WIN - 1);
        if (er < 0 || er >= BS || ec < 0 || ec >= BS) continue;
        const cells = new Int16Array(WIN);
        for (let k = 0; k < WIN; k++) cells[k] = (r + dr * k) * BS + (c + dc * k);
        slots.push(cells);
      }
    }
    return slots;
  });
})();
const ALL_SLOTS = SLOTS_BY_DIR.flat();

// Returns the cells of a winning run for `board`, or null.
function findWin(board) {
  for (const slot of ALL_SLOTS) {
    let s = 0;
    for (let k = 0; k < WIN; k++) s += board[slot[k]];
    if (s >= WIN) return slot;
  }
  return null;
}

function countFree(p1, p2) {
  let n = 0;
  for (let i = 0; i < N; i++) if (!p1[i] && !p2[i]) n++;
  return n;
}
