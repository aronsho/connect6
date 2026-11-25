// UI and game flow (port of Gameplay / Human / GameGraphics in playgame.py).
"use strict";

const COLORS = {
  board: "#26262a",
  line: "#4a4a52",
  star: "#6a6a74",
  stones: ["#33b864", "#e04848"],
  marker: "#e3c53a",
};
const NAMES = ["Green", "Red"];
const BOT_DELAY_MS = 250; // pause before a bot moves, so bot-vs-bot is watchable

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const selects = [document.getElementById("p1"), document.getElementById("p2")];
const undoBtn = document.getElementById("undo");
const newBtn = document.getElementById("new");
const hostBtn = document.getElementById("host");
const onlineInfo = document.getElementById("online-info");
const onlineStatusEl = document.getElementById("online-status");
const shareRow = document.getElementById("share-row");
const shareInput = document.getElementById("share-link");

let g;          // game state
let gen = 0;    // bumps on new game / undo to cancel pending bot moves
let hover = -1;

function onlinePlayers() {
  return Online.myColor === 0 ? ["human", "remote"] : ["remote", "human"];
}

function newGame() {
  gen++;
  g = {
    boards: [new Uint8Array(N), new Uint8Array(N)],
    players: Online.active ? onlinePlayers() : selects.map(s => s.value),
    current: 0,
    placed: [],          // stones placed so far in the current turn
    history: [],         // completed turns: {player, cells}
    winner: null,        // 0, 1, "draw" or null
    winLine: null,
    thinking: false,
  };
  startTurn();
}

function stonesThisTurn() {
  return g.history.length === 0 ? 1 : Math.min(2, countFree(g.boards[0], g.boards[1]) + g.placed.length);
}

function startTurn() {
  g.placed = [];
  render();
  if (g.winner === null && g.players[g.current].startsWith("bot")) scheduleBot();
}

function scheduleBot() {
  const myGen = gen;
  g.thinking = true;
  render();
  setTimeout(() => {
    if (myGen !== gen) return;
    const me = g.boards[g.current], op = g.boards[1 - g.current];
    const bot = new E6Bot(g.players[g.current] === "bot2" ? 2 : 1);
    const t0 = performance.now();
    const cells = bot.getMove(me, op, stonesThisTurn());
    console.log(`${NAMES[g.current]} bot (${g.players[g.current]}) moved in ${(performance.now() - t0).toFixed(0)} ms`);
    g.thinking = false;
    for (const c of cells) {
      place(c);
      if (g.winner !== null) return;
    }
  }, BOT_DELAY_MS);
}

function place(cell) {
  g.boards[g.current][cell] = 1;
  g.placed.push(cell);
  const line = findWin(g.boards[g.current]);
  if (line || g.placed.length >= stonesThisTurn()) endTurn(line);
  else render();
}

function endTurn(line) {
  g.history.push({ player: g.current, cells: g.placed.slice() });
  if (line) {
    g.winner = g.current;
    g.winLine = line;
  } else if (countFree(g.boards[0], g.boards[1]) === 0) {
    g.winner = "draw";
  } else {
    g.current = 1 - g.current;
  }
  startTurn();
}

function onHumanClick(cell) {
  if (g.winner !== null || g.thinking || g.players[g.current] !== "human") return;
  if (Online.active && !Online.connected) return;
  if (g.placed.includes(cell)) { // click own pending stone again: take it back
    unplace(cell);
    Online.send({ t: "unplace", cell });
    return;
  }
  if (g.boards[0][cell] || g.boards[1][cell]) return;
  Online.send({ t: "place", cell });
  place(cell);
}

function unplace(cell) {
  g.boards[g.current][cell] = 0;
  g.placed.splice(g.placed.indexOf(cell), 1);
  render();
}

// ---------- online ----------

function serializeState() {
  return {
    boards: g.boards.map(b => Array.from(b)),
    current: g.current, placed: g.placed, history: g.history,
    winner: g.winner, winLine: g.winLine && Array.from(g.winLine),
  };
}

Online.onStart = (myColor, state) => {
  newGame();
  if (state) {
    Object.assign(g, state, { boards: state.boards.map(b => Uint8Array.from(b)) });
    render();
  }
  updateOnlineUI();
};

Online.onMessage = msg => {
  const remoteTurn = g.winner === null && g.players[g.current] === "remote";
  if (msg.t === "need-sync") {
    Online.send({ t: "sync", state: serializeState(), guestColor: 1 - Online.myColor });
  } else if (msg.t === "place" && remoteTurn && !g.boards[0][msg.cell] && !g.boards[1][msg.cell]) {
    place(msg.cell);
  } else if (msg.t === "unplace" && remoteTurn && g.placed.includes(msg.cell)) {
    unplace(msg.cell);
  } else if (msg.t === "new") {
    Online.myColor = Online.role === "host" ? msg.hostColor : 1 - msg.hostColor;
    newGame();
  }
};

Online.onStatus = (text, warn) => {
  onlineStatusEl.textContent = text;
  onlineStatusEl.classList.toggle("warn", warn);
  updateOnlineUI();
};

function updateOnlineUI() {
  const on = Online.active;
  onlineInfo.hidden = !on;
  hostBtn.hidden = on;
  shareRow.hidden = !(on && Online.role === "host" && !Online.connected);
  if (on && Online.code) shareInput.value = Online.shareLink();
  selects.forEach(s => (s.parentElement.hidden = on));
  if (g) render();
}

function onlineNewGame() {
  if (!Online.connected) return;
  if (g.winner === null && g.history.length && !confirm("Start a new game? The current game will be lost.")) return;
  // Swap colours each new game so both players get to open.
  const hostColor = Online.role === "host" ? 1 - Online.myColor : Online.myColor;
  Online.send({ t: "new", hostColor });
  Online.onMessage({ t: "new", hostColor });
}

// ---------- undo ----------

function undo() {
  if (Online.active || !g.players.includes("human")) return;
  gen++;
  g.thinking = false;
  for (const c of g.placed) g.boards[g.current][c] = 0;
  const hadPending = g.placed.length > 0;
  g.placed = [];
  g.winner = null;
  g.winLine = null;
  if (!hadPending) {
    // Roll back to the start of the most recent human turn.
    while (g.history.length) {
      const t = g.history.pop();
      for (const c of t.cells) g.boards[t.player][c] = 0;
      g.current = t.player;
      if (g.players[t.player] === "human") break;
    }
  }
  if (g.players[g.current] !== "human") { // nothing human left to undo to
    newGame();
    return;
  }
  startTurn();
}

// ---------- rendering ----------

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const size = Math.round(canvas.clientWidth * dpr);
  if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
}

function cellCenter(cell) {
  const a = canvas.width / BS;
  return [((cell % BS) + 0.5) * a, (Math.floor(cell / BS) + 0.5) * a];
}

function drawStone(cell, player, alpha = 1) {
  const a = canvas.width / BS;
  const [x, y] = cellCenter(cell);
  const r = a * 0.44;
  ctx.globalAlpha = alpha;
  const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  grad.addColorStop(0, shade(COLORS.stones[player], 40));
  grad.addColorStop(1, COLORS.stones[player]);
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}

function drawMarker(cell) {
  const a = canvas.width / BS;
  const [x, y] = cellCenter(cell);
  ctx.fillStyle = COLORS.marker;
  ctx.beginPath(); ctx.arc(x, y, a * 0.16, 0, Math.PI * 2); ctx.fill();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = s => Math.min(255, ((n >> s) & 255) + amt);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function render() {
  resizeCanvas();
  const W = canvas.width, a = W / BS;
  ctx.fillStyle = COLORS.board;
  ctx.fillRect(0, 0, W, W);

  // grid
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = Math.max(1, W / 800);
  ctx.beginPath();
  for (let i = 0; i < BS; i++) {
    const p = (i + 0.5) * a;
    ctx.moveTo(p, a / 2); ctx.lineTo(p, W - a / 2);
    ctx.moveTo(a / 2, p); ctx.lineTo(W - a / 2, p);
  }
  ctx.stroke();
  ctx.fillStyle = COLORS.star;
  for (const r of [3, 9, 15]) for (const c of [3, 9, 15]) {
    const [x, y] = cellCenter(r * BS + c);
    ctx.beginPath(); ctx.arc(x, y, a * 0.09, 0, Math.PI * 2); ctx.fill();
  }

  // stones
  for (let i = 0; i < N; i++) {
    if (g.boards[0][i]) drawStone(i, 0);
    else if (g.boards[1][i]) drawStone(i, 1);
  }

  // hover preview
  const humanTurn = g.winner === null && !g.thinking && g.players[g.current] === "human";
  if (humanTurn && hover >= 0 && !g.boards[0][hover] && !g.boards[1][hover]) drawStone(hover, g.current, 0.35);

  // markers: stones of the current turn, otherwise the last completed turn
  const last = g.history[g.history.length - 1];
  const marked = g.placed.length ? g.placed : (last ? last.cells : []);
  marked.forEach(drawMarker);

  // winning line
  if (g.winLine) {
    const [x1, y1] = cellCenter(g.winLine[0]);
    const [x2, y2] = cellCenter(g.winLine[WIN - 1]);
    ctx.strokeStyle = COLORS.marker;
    ctx.lineWidth = a * 0.14;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  updateStatus();
}

function updateStatus() {
  const tag = { human: Online.active ? " (you)" : "", remote: " (friend)", bot1: " (bot)", bot2: " (bot)" };
  const who = p => NAMES[p] + tag[g.players[p]];
  let text;
  if (g.winner === "draw") text = "Draw – the board is full.";
  else if (g.winner !== null) text = `${who(g.winner)} wins! Press “New game” to play again.`;
  else if (g.thinking) text = `${who(g.current)} is thinking…`;
  else if (Online.active && !Online.connected) text = `You are ${NAMES[Online.myColor]}. Waiting for your friend…`;
  else if (g.players[g.current] === "remote") text = `${who(g.current)} to move – waiting for their stones…`;
  else {
    const n = stonesThisTurn();
    text = `${who(g.current)} to move – place ${n === 1 ? "1 stone" : `stone ${g.placed.length + 1} of ${n}`}.`;
  }
  statusEl.textContent = text;
  statusEl.style.color = g.winner === null || g.winner === "draw" ? "" : COLORS.stones[g.winner];
  undoBtn.disabled = Online.active || !g.players.includes("human") || (g.history.length === 0 && g.placed.length === 0);
  newBtn.disabled = Online.active && !Online.connected;
}

// ---------- input ----------

function eventCell(e) {
  const rect = canvas.getBoundingClientRect();
  const c = Math.floor(((e.clientX - rect.left) / rect.width) * BS);
  const r = Math.floor(((e.clientY - rect.top) / rect.height) * BS);
  return r >= 0 && r < BS && c >= 0 && c < BS ? r * BS + c : -1;
}

canvas.addEventListener("click", e => { const c = eventCell(e); if (c >= 0) onHumanClick(c); });
canvas.addEventListener("mousemove", e => { const c = eventCell(e); if (c !== hover) { hover = c; render(); } });
canvas.addEventListener("mouseleave", () => { hover = -1; render(); });
newBtn.addEventListener("click", () => (Online.active ? onlineNewGame() : newGame()));
undoBtn.addEventListener("click", undo);
selects.forEach(s => s.addEventListener("change", newGame));
new ResizeObserver(() => render()).observe(canvas);

hostBtn.addEventListener("click", () => Online.host());
document.getElementById("leave").addEventListener("click", () => {
  Online.leave();
  history.replaceState(null, "", location.pathname);
  updateOnlineUI();
  newGame();
});
document.getElementById("copy").addEventListener("click", async e => {
  shareInput.select();
  try { await navigator.clipboard.writeText(shareInput.value); } catch { document.execCommand("copy"); }
  e.target.textContent = "Copied!";
  setTimeout(() => (e.target.textContent = "Copy link"), 1500);
});

newGame();
const joinCode = new URLSearchParams(location.search).get("join");
if (joinCode) Online.join(joinCode);
updateOnlineUI();
