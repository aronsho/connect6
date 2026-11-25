// E6 bot: port of class E6 in Bot.py.
//
// depth 1 ("greedy")    – what Bot.py actually plays today: the tree evaluation in
//                         E6.tree() always ends up returning the top-ranked move of
//                         the first level, so the Python bot is effectively greedy.
// depth 2 ("lookahead") – the 2-ply min/max search that E6.tree() was meant to do:
//                         for each of my 6 best moves, assume the opponent's best
//                         reply, and pick the move that leaves them worst off.
"use strict";

const E6_PARAMS = {
  evalPri: [10, 10],               // candidates for 1st / 2nd stone
  evalPos: 6,                      // candidate pairs kept per tree level
  mePri1: [2, 6, 0, 1000],         // weights for 1st stone (my runs of 1..4)
  opPri1: [1, 4, 10, 100],         //                        (opponent runs)
  mePri2: [2, 1, 6, 0, 1000],      // weights for 2nd stone (runs of 1..5)
  opPri2: [1, 4, 6, 100, 100],
  mePos: [0, 4 / 5, 5 / 4, 15 / 3, 15 / 2, 10000], // board score per slot count 1..6
  opPos: [1 / 6, 1, 10 / 4, 1000, 1000, 1000],
};

class E6Bot {
  constructor(depth = 1, params = E6_PARAMS) {
    this.depth = depth;
    this.p = params;
  }

  // me, op: Uint8Array(N) of my / opponent's stones. stones: 1 or 2.
  // Returns an array of cell indices.
  getMove(me, op, stones) {
    me = me.slice(); op = op.slice();
    let empty = true;
    for (let i = 0; i < N; i++) if (me[i] || op[i]) { empty = false; break; }
    if (empty) return [Math.floor(BS / 2) * BS + Math.floor(BS / 2)]; // first move: centre
    if (stones === 1) return [this.topN(this.apriori(me, op, 4, this.p.mePri1, this.p.opPri1), me, op, 1)[0]];

    const mine = this.findBestMoves(me, op);
    if (this.depth < 2 || mine.length === 1) return mine[0].move;

    let best = null, bestVal = Infinity;
    for (const cand of mine) {
      const [a, b] = cand.move;
      me[a] = me[b] = 1;
      if (findWin(me)) { me[a] = me[b] = 0; return cand.move; } // winning move
      const replies = this.findBestMoves(op, me);
      const oppBest = replies.length ? replies[0].score : -Infinity;
      me[a] = me[b] = 0;
      if (oppBest < bestVal) { bestVal = oppBest; best = cand.move; }
    }
    return best;
  }

  // Best pairs of stones for the player owning `me` (port of find_best_mvs +
  // aposteriori). Returns [{move:[a,b], score}] sorted best first.
  findBestMoves(me, op) {
    const best1 = this.topN(this.apriori(me, op, 4, this.p.mePri1, this.p.opPri1), me, op, this.p.evalPri[0]);
    const seen = new Set();
    const pairs = [];
    for (const a of best1) {
      me[a] = 1;
      const best2 = this.topN(this.apriori(me, op, 5, this.p.mePri2, this.p.opPri2), me, op, this.p.evalPri[1]);
      me[a] = 0;
      for (const b of best2) {
        if (a === b) continue;
        const key = a < b ? a * N + b : b * N + a;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push([a, b]);
      }
    }
    const scored = pairs.map(([a, b]) => {
      me[a] = me[b] = 1;
      const score = this.boardScore(me, op);
      me[a] = me[b] = 0;
      return { move: [a, b], score, tie: Math.random() };
    });
    scored.sort((x, y) => (y.score - x.score) || (x.tie - y.tie));
    return scored.slice(0, this.p.evalPos);
  }

  // Port of count_mat + weighting in apriori_1/apriori_2: for every free cell,
  // how valuable is it, based on the open runs (per direction) it belongs to.
  apriori(me, op, nMax, wMe, wOp) {
    const val = new Float64Array(N);
    const tm = new Uint8Array(nMax * N), to = new Uint8Array(nMax * N);
    for (const slots of SLOTS_BY_DIR) {
      tm.fill(0); to.fill(0);
      for (const slot of slots) {
        let cm = 0, co = 0;
        for (let k = 0; k < WIN; k++) { cm += me[slot[k]]; co += op[slot[k]]; }
        if (cm >= 1 && co === 0) {
          const base = (Math.min(cm, nMax) - 1) * N;
          for (let k = 0; k < WIN; k++) tm[base + slot[k]] = 1;
        } else if (co >= 1 && cm === 0) {
          const base = (Math.min(co, nMax) - 1) * N;
          for (let k = 0; k < WIN; k++) to[base + slot[k]] = 1;
        }
      }
      for (let lv = 0; lv < nMax; lv++) {
        const base = lv * N, wm = wMe[lv], wo = wOp[lv];
        for (let i = 0; i < N; i++) val[i] += wm * tm[base + i] + wo * to[base + i];
      }
    }
    return val;
  }

  // Port of count_num + score in aposteriori: whole-board evaluation.
  boardScore(me, op) {
    let s = 0;
    for (const slot of ALL_SLOTS) {
      let cm = 0, co = 0;
      for (let k = 0; k < WIN; k++) { cm += me[slot[k]]; co += op[slot[k]]; }
      if (cm >= 1 && co === 0) s += this.p.mePos[cm - 1];
      else if (co >= 1 && cm === 0) s -= this.p.opPos[co - 1];
    }
    return s;
  }

  // n highest-valued FREE cells (random tie-break). The Python version could
  // pick occupied cells when scores tie at 0; this skips them.
  topN(val, me, op, n) {
    const cells = [];
    for (let i = 0; i < N; i++) if (!me[i] && !op[i]) cells.push({ i, v: val[i], t: Math.random() });
    cells.sort((x, y) => (y.v - x.v) || (x.t - y.t));
    return cells.slice(0, n).map(c => c.i);
  }
}
