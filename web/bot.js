// E6 bot: port of class E6 in Bot.py, in three levels.
//
// level 1 ("medium", greedy)    – what Bot.py plays: the best-scoring pair of stones.
// level 2 ("expert", lookahead) – the 2-ply min/max search that E6.tree() was meant to
//                         do: for each of my 6 best moves, assume the opponent's
//                         best reply, and pick the move that leaves them worst off.
// level 3 ("killer")    – lookahead plus a threat-based tactical layer.
// level 4 ("god")       – killer, but cautious: more time, deeper safety checks,
//                         and only attacks that hold up (see E6_GOD).
//
// Killer understands Connect6 threats. A "threat" is a run of 6 cells holding
// 4 or 5 of one player's stones and none of the other's: it can be completed
// in a single turn. Every turn it
//   1. wins if it can,
//   2. otherwise looks for the shortest forced win: a sequence of moves that
//      each leave the opponent threats to block – mostly two (both stones are
//      needed), at most one with a single threat – ending in three threats,
//      which cannot be blocked ("threat-space search"). Positions already
//      searched are remembered, so the search goes deeper in the same time,
//   3. otherwise blocks all of the opponent's threats (if possible),
//   4. otherwise plays the lookahead move, but skips moves that let the
//      opponent start such a forced win (checked cheapest-first, up to the
//      time limit of 1 s per move).
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

// Killer's search settings.
//   winDepth:  how many of my turns a forced win may take
//   safeChecks: before playing a move, checks that the opponent has no forced
//              win after it, as [turns, single-threat moves allowed] – from
//              cheap to thorough; the time limit decides how far it gets
//   singles:   how many single-threat moves my own forced wins may contain
//   freeCells: cells tried for the defender's free stone after a single threat
//   budgetMs:  time limit per move (the bot always moves in time)
//   keep:      how many of my best moves to consider (2-ply and safety check)
//   width:     candidate cells per stone when building those moves
const E6_KILLER = { winDepth: 5, budgetMs: 1000, keep: 40, width: 25,
  safeChecks: [[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [3, 1], [4, 1]],
  singles: 1, freeCells: 6, verify: false };

// God: Killer, but cautious. Attacks that contain a single threat are only
// guesses (the defender's free stone isn't tried everywhere), so God plays
// one only if it also passes all the safety checks (verify); safety checks
// go deeper; and there is more time to think.
const E6_GOD = { ...E6_KILLER, budgetMs: 2500, verify: true,
  safeChecks: [[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [2, 1], [3, 1], [4, 1], [5, 1], [3, 2]] };

const NSLOT = ALL_SLOTS.length;
// Random numbers per (player, cell) for hashing positions (Zobrist hashing),
// so the threat search can remember positions it has already searched.
const ZOBRIST = (() => {
  let x = 0x9e3779b9;
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };
  return [0, 1].map(() => [Uint32Array.from({ length: N }, rnd), Uint32Array.from({ length: N }, rnd)]);
})();
const CELL_SLOTS = (() => {
  const lists = Array.from({ length: N }, () => []);
  ALL_SLOTS.forEach((slot, s) => { for (const c of slot) lists[c].push(s); });
  return lists.map(l => Int16Array.from(l));
})();

// Board plus, for every slot, how many stones each player has in it.
// Player 0 is the bot, player 1 its opponent.
class Pos {
  constructor(me, op) {
    this.b = [me.slice(), op.slice()];
    this.cnt = [new Int8Array(NSLOT), new Int8Array(NSLOT)];
    for (let s = 0; s < NSLOT; s++) {
      const slot = ALL_SLOTS[s];
      let a = 0, o = 0;
      for (let k = 0; k < WIN; k++) { a += me[slot[k]]; o += op[slot[k]]; }
      this.cnt[0][s] = a; this.cnt[1][s] = o;
    }
    this.mark = new Int32Array(NSLOT);
    this.stamp = 0;
    this.h1 = 0; this.h2 = 0;
    for (let c = 0; c < N; c++) for (const p of [0, 1]) if (this.b[p][c]) this.hash(c, p);
  }
  hash(c, p) { this.h1 ^= ZOBRIST[p][0][c]; this.h2 ^= ZOBRIST[p][1][c]; }
  // 53-bit key of the position (a JS number, so it can key a Map).
  key() { return (this.h1 >>> 0) * 2097152 + (this.h2 & 0x1fffff); }
  empty(c) { return !this.b[0][c] && !this.b[1][c]; }
  put(c, p) {
    this.b[p][c] = 1;
    this.hash(c, p);
    const ss = CELL_SLOTS[c], cn = this.cnt[p];
    for (let i = 0; i < ss.length; i++) cn[ss[i]]++;
  }
  take(c, p) {
    this.b[p][c] = 0;
    this.hash(c, p);
    const ss = CELL_SLOTS[c], cn = this.cnt[p];
    for (let i = 0; i < ss.length; i++) cn[ss[i]]--;
  }
  isThreat(s, p) { return this.cnt[p][s] >= 4 && this.cnt[1 - p][s] === 0; }
  // All of p's threat slots.
  threats(p) {
    const out = [];
    for (let s = 0; s < NSLOT; s++) if (this.isThreat(s, p)) out.push(s);
    return out;
  }
  // p's threat slots that contain one of `cells` (enough when p had none before).
  threatsAt(p, cells) {
    const out = [], st = ++this.stamp;
    for (const c of cells) {
      const ss = CELL_SLOTS[c];
      for (let i = 0; i < ss.length; i++) {
        const s = ss[i];
        if (this.mark[s] !== st && this.isThreat(s, p)) { this.mark[s] = st; out.push(s); }
      }
    }
    return out;
  }
  // How many stones it takes to block every slot in `wins`, and how.
  // need 0/1/2 come with the ways to do it; need 3 means "can't be blocked".
  cover(wins) {
    if (wins.length === 0) return { need: 0 };
    if (wins.length > 30) return { need: 3 };
    const cells = [], mask = new Map();
    wins.forEach((s, k) => {
      for (const c of ALL_SLOTS[s]) {
        if (!this.empty(c)) continue;
        if (!mask.has(c)) { mask.set(c, 0); cells.push(c); }
        mask.set(c, mask.get(c) | (1 << k));
      }
    });
    const full = (1 << wins.length) - 1;
    const singles = cells.filter(c => mask.get(c) === full);
    if (singles.length) return { need: 1, singles };
    const pairs = [];
    for (let i = 0; i < cells.length; i++)
      for (let j = i + 1; j < cells.length; j++)
        if ((mask.get(cells[i]) | mask.get(cells[j])) === full) pairs.push([cells[i], cells[j]]);
    return pairs.length ? { need: 2, pairs } : { need: 3, cells, mask };
  }
  // Board evaluation from player p's point of view (aposteriori in Bot.py).
  score(p, prm) {
    const a = this.cnt[p], o = this.cnt[1 - p];
    let s = 0;
    for (let i = 0; i < NSLOT; i++) {
      if (a[i] && !o[i]) s += prm.mePos[a[i] - 1];
      else if (o[i] && !a[i]) s -= prm.opPos[o[i] - 1];
    }
    return s;
  }
}

class E6Bot {
  constructor(level = 1, params = E6_PARAMS) {
    this.level = level;
    this.p = params;
    this.lv = level >= 4 ? E6_GOD : E6_KILLER;
  }

  // me, op: Uint8Array(N) of my / opponent's stones. stones: 1 or 2.
  // Returns an array of cell indices.
  getMove(me, op, stones) {
    let empty = true;
    for (let i = 0; i < N; i++) if (me[i] || op[i]) { empty = false; break; }
    if (empty) return [Math.floor(BS / 2) * BS + Math.floor(BS / 2)]; // first move: centre

    const pos = new Pos(me, op);
    if (this.level < 3) return this.classic(pos, stones);
    const t0 = this.t0 = performance.now();
    this.deadline = t0 + this.lv.budgetMs;
    this.tt = [new Map(), new Map()]; // threat-search results per attacker
    if (stones === 1) return [this.singleStone(pos)];

    // 1. Win now.
    for (const s of pos.threats(0)) {
      const cells = [...ALL_SLOTS[s]].filter(c => pos.empty(c));
      if (cells.length === 1) cells.push(this.topCells(pos, 0, 2).find(c => c !== cells[0]));
      return cells;
    }

    // 2. Forced win, the shortest one found (with part of the time; the rest
    //    is for defence). Works when I have to block too: the search then
    //    only tries moves that block while attacking.
    this.deadline = t0 + 0.3 * this.lv.budgetMs;
    const win = this.forcedWin(pos, 0, this.lv.winDepth, this.lv.verify ? 0 : this.lv.singles);
    if (win) return win;
    if (this.lv.verify && this.lv.singles) {
      // A win with single threats is a guess: play it only if it holds up.
      const guess = this.forcedWin(pos, 0, this.lv.winDepth, this.lv.singles);
      this.deadline = t0 + 0.45 * this.lv.budgetMs;
      if (guess && this.safeAll(pos, guess)) return guess;
    }
    this.deadline = t0 + 0.7 * this.lv.budgetMs; // the rest is for breakAttack

    // 3. Block the opponent's threats.
    const opThreats = pos.threats(1);
    if (opThreats.length) { this.deadline = t0 + this.lv.budgetMs; return this.block(pos, opThreats); }

    // 4. Positional move that doesn't hand the opponent a forced win.
    return this.quiet(pos);
  }

  // Greedy and lookahead, as before the threat layer was added.
  classic(pos, stones) {
    if (stones === 1) return [this.topCells(pos, 0, 1)[0]];
    const mine = this.findBestMoves(pos, 0, this.p.evalPos);
    if (this.level < 2 || mine.length === 1) return mine[0].move;
    let best = null, bestVal = Infinity;
    for (const { move: [a, b] } of mine) {
      pos.put(a, 0); pos.put(b, 0);
      const won = findWin(pos.b[0]);
      const replies = won ? [] : this.findBestMoves(pos, 1, 1);
      pos.take(a, 0); pos.take(b, 0);
      if (won) return [a, b];
      const oppBest = replies.length ? replies[0].score : -Infinity;
      if (oppBest < bestVal) { bestVal = oppBest; best = [a, b]; }
    }
    return best;
  }

  // Only one stone left to place (the board is nearly full).
  singleStone(pos) {
    for (const s of pos.threats(0)) if (pos.cnt[0][s] === 5) return ALL_SLOTS[s].find(c => pos.empty(c));
    for (const s of pos.threats(1)) if (pos.cnt[1][s] === 5) return ALL_SLOTS[s].find(c => pos.empty(c));
    return this.topCells(pos, 0, 1)[0];
  }

  // Every candidate move that stops the opponent's threats, best first.
  block(pos, opThreats) {
    const info = pos.cover(opThreats);
    let moves = [];
    if (info.need === 1) {
      const extra = [...new Set([...this.topCells(pos, 0, this.p.evalPri[1]), ...this.vcfCands(pos, 1).slice(0, 10)])];
      for (const a of info.singles) for (const b of extra) if (a !== b) moves.push([a, b]);
    } else if (info.need === 2) {
      moves = info.pairs;
    } else {
      // Can't block everything: block as much as possible and hope.
      const cells = info.cells.slice().sort((x, y) => popcount(info.mask.get(y)) - popcount(info.mask.get(x)));
      return cells.length > 1 ? [cells[0], cells[1]] : [cells[0], this.topCells(pos, 0, 2).find(c => c !== cells[0])];
    }
    return this.pickSafe(pos, this.rank(pos, moves));
  }

  quiet(pos) {
    const moves = this.findBestMoves(pos, 0, this.lv.keep, this.lv.width);
    {
      // 2-ply: order my moves by the opponent's best answer.
      for (const m of moves) {
        pos.put(m.move[0], 0); pos.put(m.move[1], 0);
        const replies = this.findBestMoves(pos, 1, 1);
        m.score = replies.length ? -replies[0].score : m.score;
        pos.take(m.move[0], 0); pos.take(m.move[1], 0);
      }
      moves.sort((x, y) => (y.score - x.score) || (x.tie - y.tie));
    }
    const choice = this.pickSafe(pos, moves.map(m => m.move), true);
    if (choice) return choice;
    // Every top move loses to a forced win: try to break up the opponent's attack.
    const defend = this.breakAttack(pos);
    return defend || moves[0].move;
  }

  // Best move in `moves` (they come best first) after which the opponent has
  // no forced win. Checks every move one turn deep first, then the survivors
  // deeper, so running out of time still leaves a move checked as deep as
  // there was time for. Returns moves[0] (or null if orNull) when none
  // survives even the shallowest check.
  pickSafe(pos, moves, orNull = false) {
    let alive = moves;
    const checks = this.lv.safeChecks;
    for (let i = 0; i < checks.length; i++) {
      const [d, singles] = checks[i], last = i === checks.length - 1, next = [];
      for (const m of alive) {
        this.timedOut = false;
        const safe = this.isSafe(pos, m, d, singles);
        if (this.timedOut) return next[0] || alive[0];
        if (safe) { next.push(m); if (last) break; }
      }
      if (!next.length) return i === 0 ? (orNull ? null : moves[0]) : alive[0];
      alive = next;
    }
    return alive[0];
  }

  // Does `move` pass every safety check (in time)?
  safeAll(pos, move) {
    for (const [d, singles] of this.lv.safeChecks) {
      this.timedOut = false;
      if (!this.isSafe(pos, move, d, singles) || this.timedOut) return false;
    }
    return true;
  }

  // After my move [a, b], can the opponent not force a win? If my move makes
  // threats, the search only lets them use moves that block those.
  isSafe(pos, [a, b], depth, singles) {
    pos.put(a, 0); pos.put(b, 0);
    const safe = pos.cover(pos.threatsAt(0, [a, b])).need >= 3 || !this.vcf(pos, 1, depth, singles);
    pos.take(a, 0); pos.take(b, 0);
    return safe;
  }

  // Opponent has a forced win against all my good moves: look for a pair of
  // stones in their attacking area that stops it.
  breakAttack(pos) {
    const area = this.vcfCands(pos, 1).slice(0, 12);
    const mine = this.topCells(pos, 0, 6);
    const cells = [...new Set([...area, ...mine])];
    const moves = [];
    for (let i = 0; i < cells.length; i++)
      for (let j = i + 1; j < cells.length; j++) moves.push([cells[i], cells[j]]);
    const ranked = this.rank(pos, moves);
    this.deadline = this.t0 + this.lv.budgetMs;
    const m = this.pickSafe(pos, ranked, true);
    return m;
  }

  // Sort moves by the board score they lead to.
  rank(pos, moves) {
    return moves.map(m => {
      pos.put(m[0], 0); pos.put(m[1], 0);
      const score = pos.score(0, this.p);
      pos.take(m[0], 0); pos.take(m[1], 0);
      return { m, score, tie: Math.random() };
    }).sort((x, y) => (y.score - x.score) || (x.tie - y.tie)).map(x => x.m);
  }

  // Shortest forced win for p within maxDepth turns (iterative deepening).
  forcedWin(pos, p, maxDepth, singles) {
    this.timedOut = false;
    for (let d = 1; d <= maxDepth; d++) {
      const m = this.vcf(pos, p, d, singles);
      if (m || this.timedOut) return m;
    }
    return null;
  }

  // Threat-space search: can player p, to move, force a win within `depth`
  // turns? Every move of p's must leave the other side (q) threats to block:
  //  - two threats: both of q's stones are needed, so all q's blocks are tried;
  //  - one threat (at most `singles` times): q blocks with one stone and has a
  //    free one, which is tried on the few cells that matter most (q's own
  //    attacking spots and p's) – a good guess, not a proof;
  //  - three threats can't all be blocked: p wins.
  // If q has threats on the board, p's move must block them too, and q's
  // blocks may make new threats that p then has to block. Returns p's first
  // move, or null. Results are cached per position in this.tt.
  vcf(pos, p, depth, singles = 0) {
    const q = 1 - p, key = pos.key(), tt = this.tt[p];
    const known = tt.get(key);
    if (known !== undefined) {
      if (known.win && known.depth <= depth && known.singles <= singles) return known.win;
      if (known.fail >= depth && known.singles >= singles) return null;
    }
    if (performance.now() > this.deadline) { this.timedOut = true; return null; }

    // Moves to try: if q has threats, only moves that block all of them.
    const block = pos.cover(pos.threats(q));
    if (block.need >= 3) { tt.set(key, { fail: Infinity, singles: Infinity }); return null; }
    const cands = this.vcfCands(pos, p);
    const moves = block.need === 0 ? this.threatMoves(pos, p, cands, cands)
      : block.need === 1 ? this.threatMoves(pos, p, block.singles, cands)
      : block.pairs.flat();

    const result = win => {
      if (win) tt.set(key, { win, depth, singles });
      else if (!this.timedOut) tt.set(key, { fail: depth, singles });
      return win;
    };
    const oneThreat = []; // single-threat moves, tried after the double threats
    // Moves come grouped by their first stone a: place a once, then count each
    // b's threats from the slot counts, and only place b if that's promising.
    const cp = pos.cnt[p], co = pos.cnt[q], wantSingles = singles > 0 && depth > 1;
    let curA = -1, aThreats = [];
    for (let k = 0; k < moves.length; k += 2) {
      const a = moves[k], b = moves[k + 1];
      if (a !== curA) {
        if (curA >= 0) pos.take(curA, p);
        if (performance.now() > this.deadline) { this.timedOut = true; return null; }
        curA = a;
        pos.put(a, p);
        aThreats = [];
        for (const s of CELL_SLOTS[a]) if (cp[s] >= 4 && !co[s]) aThreats.push(s);
      }
      let n = 0;
      const st = ++pos.stamp, bs = CELL_SLOTS[b];
      for (let i = 0; i < bs.length; i++) {
        const s = bs[i];
        pos.mark[s] = st;
        if (!co[s] && cp[s] >= 3) n++;
      }
      for (const s of aThreats) if (pos.mark[s] !== st) n++;
      if (n < 2 && !(n === 1 && wantSingles)) continue;
      pos.put(b, p);
      const wins = pos.threatsAt(p, [a, b]);
      let found = false;
      if (wins.length >= 2) {
        const info = pos.cover(wins);
        if (info.need >= 3) found = true;
        else if (info.need === 2 && depth > 1) found = this.allBlocksLose(pos, p, info.pairs, depth, singles);
        else if (info.need === 1 && wantSingles) oneThreat.push(a, b);
      } else if (wins.length === 1 && wantSingles) oneThreat.push(a, b);
      pos.take(b, p);
      if (this.timedOut || found) {
        pos.take(a, p);
        return this.timedOut ? null : result([a, b]);
      }
    }
    if (curA >= 0) pos.take(curA, p);
    for (let k = 0; k < oneThreat.length; k += 2) {
      const a = oneThreat[k], b = oneThreat[k + 1];
      pos.put(a, p); pos.put(b, p);
      const info = pos.cover(pos.threatsAt(p, [a, b]));
      // q's replies: a blocking stone plus a free stone on a cell that matters
      const free = [...new Set([...this.vcfCands(pos, q).slice(0, this.lv.freeCells),
                                ...this.vcfCands(pos, p).slice(0, this.lv.freeCells)])];
      const replies = [];
      for (const x of info.singles) for (const y of free) if (y !== x) replies.push([x, y]);
      const found = this.allBlocksLose(pos, p, replies, depth, singles - 1);
      pos.take(a, p); pos.take(b, p);
      if (this.timedOut) return null;
      if (found) return result([a, b]);
    }
    return result(null);
  }

  // Pairs [a, b] (flat list) with a from `firsts` that can make a threat for p.
  // A threat is a slot reaching 4 stones. If it contains b, it had 3 stones
  // once a was placed, so b only needs to be tried on cells of such slots
  // ("hot" cells). If it only contains a, b is free and is tried on the most
  // promising cells. This skips the thousands of pairs that make no threat.
  threatMoves(pos, p, firsts, cands) {
    const cp = pos.cnt[p], co = pos.cnt[1 - p];
    const hot0 = new Set();
    for (let s = 0; s < NSLOT; s++)
      if (cp[s] === 3 && !co[s]) for (const c of ALL_SLOTS[s]) if (pos.empty(c)) hot0.add(c);
    const out = [], seen = new Set(), builders = cands.slice(0, 10);
    for (const a of firsts) {
      pos.put(a, p);
      const hot = new Set(hot0);
      let threats = 0;
      for (const s of CELL_SLOTS[a]) {
        if (co[s]) continue;
        if (cp[s] >= 4) threats++;
        else if (cp[s] === 3) for (const c of ALL_SLOTS[s]) if (pos.empty(c)) hot.add(c);
      }
      pos.take(a, p);
      if (threats) for (const c of builders) hot.add(c);
      for (const b of hot) {
        if (b === a) continue;
        const k = a < b ? a * N + b : b * N + a;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(a, b);
      }
    }
    return out;
  }

  // Does p (who just moved) still force a win against each of q's replies?
  allBlocksLose(pos, p, replies, depth, singles) {
    const q = 1 - p;
    for (const [x, y] of replies) {
      pos.put(x, q); pos.put(y, q);
      const ok = this.vcf(pos, p, depth - 1, singles) !== null;
      pos.take(x, q); pos.take(y, q);
      if (!ok) return false;
    }
    return true;
  }

  // Empty cells in slots where p has 2+ stones and the other side none – the
  // only places a new threat can come from. Most promising first.
  vcfCands(pos, p) {
    const val = new Map();
    const a = pos.cnt[p], o = pos.cnt[1 - p];
    for (let s = 0; s < NSLOT; s++) {
      if (a[s] < 2 || o[s]) continue;
      const w = a[s] * a[s];
      for (const c of ALL_SLOTS[s]) if (pos.empty(c)) val.set(c, (val.get(c) || 0) + w);
    }
    return [...val.keys()].sort((x, y) => val.get(y) - val.get(x));
  }

  // Best pairs of stones for player p (port of find_best_mvs + aposteriori).
  // Returns [{move:[a,b], score}] sorted best first.
  findBestMoves(pos, p, keep, width = this.p.evalPri[0]) {
    const me = pos.b[p], op = pos.b[1 - p];
    const best1 = this.topN(this.apriori(me, op, 4, this.p.mePri1, this.p.opPri1), me, op, width);
    const seen = new Set();
    const scored = [];
    for (const a of best1) {
      pos.put(a, p);
      const best2 = this.topN(this.apriori(me, op, 5, this.p.mePri2, this.p.opPri2), me, op, width);
      for (const b of best2) {
        const key = a < b ? a * N + b : b * N + a;
        if (seen.has(key)) continue;
        seen.add(key);
        pos.put(b, p);
        scored.push({ move: [a, b], score: pos.score(p, this.p), tie: Math.random() });
        pos.take(b, p);
      }
      pos.take(a, p);
    }
    scored.sort((x, y) => (y.score - x.score) || (x.tie - y.tie));
    return scored.slice(0, keep);
  }

  // n best free cells for player p by the first-stone heuristic.
  topCells(pos, p, n) {
    const me = pos.b[p], op = pos.b[1 - p];
    return this.topN(this.apriori(me, op, 4, this.p.mePri1, this.p.opPri1), me, op, n);
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

  // n highest-valued FREE cells (random tie-break).
  topN(val, me, op, n) {
    const cells = [];
    for (let i = 0; i < N; i++) if (!me[i] && !op[i]) cells.push({ i, v: val[i], t: Math.random() });
    cells.sort((x, y) => (y.v - x.v) || (x.t - y.t));
    return cells.slice(0, n).map(c => c.i);
  }
}

function popcount(x) { let n = 0; while (x) { n += x & 1; x >>>= 1; } return n; }
