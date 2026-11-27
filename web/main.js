// UI and game flow (port of Gameplay / Human / GameGraphics in playgame.py).
"use strict";

const COLORS = {
  board: "#26262a",
  line: "#4a4a52",
  star: "#6a6a74",
  stones: ["#3b9be0", "#f0a020"], // Okabe–Ito blue / orange: distinguishable with colour blindness
  marker: "#ffffff",
};
const NAMES = ["Blue", "Orange"];
const BOT_MIN_MS = 500; // a bot move takes at least this long (thinking included), so games are watchable

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const selects = [document.getElementById("p1"), document.getElementById("p2")];
const undoBtn = document.getElementById("undo");
const pauseBtn = document.getElementById("pause");
const browseEl = document.getElementById("browse");
const backBtn = document.getElementById("back");
const fwdBtn = document.getElementById("fwd");
const newBtn = document.getElementById("new");
const hostBtn = document.getElementById("host");
const onlineInfo = document.getElementById("online-info");
const onlineStatusEl = document.getElementById("online-status");
const shareRow = document.getElementById("share-row");
const shareInput = document.getElementById("share-link");
const scoreEl = document.getElementById("score");
const offerRow = document.getElementById("offer-row");
const offerText = document.getElementById("offer-text");
const acceptBtn = document.getElementById("accept");
const declineBtn = document.getElementById("decline");
const resignBtn = document.getElementById("resign");
const boardWrap = document.getElementById("board-wrap");
const zoomBtn = document.getElementById("zoom");

let g;          // game state
let gen = 0;    // bumps on new game / undo to cancel pending bot moves
let hover = -1;   // mouse hover cell (desktop)
let preview = -1; // tapped-but-not-yet-placed cell (touch screens)
let zoomed = false;

function onlinePlayers() {
  return Online.myColor === 0 ? ["human", "remote"] : ["remote", "human"];
}

function newGame() {
  gen++;
  g = {
    boards: [new Uint8Array(N), new Uint8Array(N)],
    players: Online.active ? onlinePlayers() : Tutorial.active ? ["human", "script"] : selects.map(s => s.value),
    current: 0,
    placed: [],          // stones placed so far in the current turn
    history: [],         // completed turns: {player, cells}
    winner: null,        // 0, 1, "draw" or null
    winLine: null,
    resigned: null,      // colour that resigned, if any
    thinking: false,
    paused: false,       // bot vs bot only: stop between turns to look at the game
    view: null,          // bot vs bot only: number of turns shown while browsing, null = live
    started: false,      // bot vs bot only: waits for "Start" before the first move
  };
  if (botsOnly()) g.paused = true;
  Online.offer = null;
  startTurn();
}

function stonesThisTurn() {
  return g.history.length === 0 ? 1 : Math.min(2, countFree(g.boards[0], g.boards[1]) + g.placed.length);
}

function startTurn() {
  g.placed = [];
  preview = -1;
  render();
  if (g.winner === null && !g.paused && g.players[g.current].startsWith("bot")) scheduleBot();
}

// Both players are bots (and this isn't online play or the tutorial).
function botsOnly() {
  return !Online.active && !Tutorial.active && g.players.every(p => p.startsWith("bot"));
}

function pause() {
  if (g.paused) return;
  g.paused = true;
  gen++;             // drop the move being thought about; it is redone on resume
  g.thinking = false;
}

// Resume always continues the game from its latest position.
function togglePause() {
  if (!botsOnly()) return;
  if (g.paused) {
    g.paused = false;
    g.started = true;
    g.view = null;
    startTurn();
  } else {
    pause();
    render();
  }
}

// Browse the game one turn back (pausing it first).
function back() {
  if (!botsOnly()) return;
  pause();
  g.view = Math.max(0, (g.view ?? g.history.length) - 1);
  render();
}

// One turn forward; at the latest position, play a new turn (staying paused).
function forward() {
  if (!botsOnly()) return;
  if (g.view !== null) {
    g.view = g.view + 1 >= g.history.length ? null : g.view + 1;
    render();
  } else if (g.paused && !g.thinking && g.winner === null) {
    g.started = true;
    scheduleBot();
  }
}

function scheduleBot() {
  const myGen = gen;
  g.thinking = true;
  render();
  // Think right away (after a moment, so the board and "thinking" status
  // paint first), then wait out the rest of BOT_MIN_MS: thinking time counts
  // toward the minimum instead of adding to it.
  const start = performance.now();
  setTimeout(() => {
    if (myGen !== gen) return;
    const me = g.boards[g.current], op = g.boards[1 - g.current];
    const bot = new E6Bot(+g.players[g.current].slice(3));
    const t0 = performance.now();
    const cells = bot.getMove(me, op, stonesThisTurn());
    console.log(`${NAMES[g.current]} bot (${g.players[g.current]}) moved in ${(performance.now() - t0).toFixed(0)} ms`);
    setTimeout(() => {
      if (myGen !== gen) return;
      g.thinking = false;
      for (const c of cells) {
        place(c);
        if (g.winner !== null) return;
      }
    }, Math.max(0, BOT_MIN_MS - (performance.now() - start)));
  }, 20);
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
    startTurn();
    return;
  }
  recordResult();
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
    winner: g.winner, winLine: g.winLine && Array.from(g.winLine), resigned: g.resigned,
  };
}

Online.onStart = (myColor, state, score) => {
  newGame();
  if (state) {
    Object.assign(g, state, { boards: state.boards.map(b => Uint8Array.from(b)) });
    render();
  }
  if (score) Online.score = score;
  updateOnlineUI();
};

// Count a finished online game in the session score (by person, not colour,
// because colours swap every game).
function recordResult() {
  if (!Online.active) return;
  if (g.winner === "draw") Online.score.draws++;
  else {
    const winnerRole = g.winner === Online.myColor ? Online.role : (Online.role === "host" ? "guest" : "host");
    Online.score[winnerRole]++;
  }
  updateOnlineUI();
}

function resign(loser) {
  if (g.winner !== null) return;
  gen++;
  g.winner = 1 - loser;
  g.resigned = loser;
  g.thinking = false;
  recordResult();
  render();
}

function onResignClick() {
  if (!Online.connected || g.winner !== null) return;
  if (!confirm("Resign this game? Your friend gets the win.")) return;
  Online.send({ t: "resign" });
  resign(Online.myColor);
}

function startAgreedNewGame() {
  // Swap colours each new game so both players get to open.
  const hostColor = Online.role === "host" ? 1 - Online.myColor : Online.myColor;
  Online.send({ t: "new", hostColor });
  Online.onMessage({ t: "new", hostColor });
}

Online.onMessage = msg => {
  const remoteTurn = g.winner === null && g.players[g.current] === "remote";
  if (msg.t === "need-sync") {
    Online.send({ t: "sync", state: serializeState(), guestColor: 1 - Online.myColor, score: Online.score });
  } else if (msg.t === "place" && remoteTurn && !g.boards[0][msg.cell] && !g.boards[1][msg.cell]) {
    place(msg.cell);
  } else if (msg.t === "unplace" && remoteTurn && g.placed.includes(msg.cell)) {
    unplace(msg.cell);
  } else if (msg.t === "resign" && g.winner === null) {
    resign(1 - Online.myColor);
  } else if (msg.t === "offer") {
    if (Online.offer === "me") startAgreedNewGame(); // we both asked: just do it
    else { Online.offer = "friend"; updateOnlineUI(); }
  } else if (msg.t === "offer-cancel" || msg.t === "offer-decline") {
    Online.offer = msg.t === "offer-decline" ? "declined" : null;
    updateOnlineUI();
  } else if (msg.t === "new") {
    Online.myColor = Online.role === "host" ? msg.hostColor : 1 - msg.hostColor;
    newGame();
    updateOnlineUI();
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

  // score
  const sc = Online.score, mine = sc[Online.role] || 0, theirs = sc[Online.role === "host" ? "guest" : "host"] || 0;
  scoreEl.hidden = !(on && (Online.connected || mine + theirs + sc.draws > 0));
  scoreEl.innerHTML = `Score this session: <b>You ${mine}</b> – <b>${theirs} Friend</b>` +
    (sc.draws ? ` <span class="muted">(${sc.draws} draw${sc.draws > 1 ? "s" : ""})</span>` : "");

  // new-game offers
  const offer = on && Online.connected ? Online.offer : null;
  offerRow.hidden = !offer;
  acceptBtn.hidden = offer !== "friend";
  declineBtn.hidden = offer !== "friend" && offer !== "me";
  declineBtn.textContent = offer === "me" ? "Cancel" : "Decline";
  offerText.textContent = {
    friend: "Your friend wants to start a new game.",
    me: "New game offered – waiting for your friend to agree…",
    declined: "Your friend declined the new game.",
  }[offer] || "";
  resignBtn.hidden = !(on && Online.connected);
  undoBtn.hidden = on;
  document.getElementById("tutorial-btn").hidden = on || Tutorial.active;
  if (g) render();
}

function onlineNewGame() {
  if (!Online.connected) return;
  if (Online.offer === "friend") return startAgreedNewGame();
  if (Online.offer === "me") return;
  Online.offer = "me";
  Online.send({ t: "offer" });
  updateOnlineUI();
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
  const size = Math.min(2400, Math.round(canvas.clientWidth * dpr));
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

  // stones (while browsing a bot game: only the first g.view turns)
  const browsing = g.view !== null;
  const shown = browsing ? g.history.slice(0, g.view) : null;
  if (browsing) for (const t of shown) t.cells.forEach(c => drawStone(c, t.player));
  else for (let i = 0; i < N; i++) {
    if (g.boards[0][i]) drawStone(i, 0);
    else if (g.boards[1][i]) drawStone(i, 1);
  }

  // hover preview
  const humanTurn = g.winner === null && !g.thinking && g.players[g.current] === "human";
  if (humanTurn && hover >= 0 && !g.boards[0][hover] && !g.boards[1][hover] && (!Tutorial.active || Tutorial.allows(hover)))
    drawStone(hover, g.current, 0.35);

  // touch preview: ghost stone + crosshair along its row and column
  if (humanTurn && preview >= 0) {
    const [x, y] = cellCenter(preview);
    ctx.strokeStyle = COLORS.stones[g.current];
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1.5, a * 0.07);
    ctx.beginPath();
    ctx.moveTo(a / 2, y); ctx.lineTo(W - a / 2, y);
    ctx.moveTo(x, a / 2); ctx.lineTo(x, W - a / 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    drawStone(preview, g.current, 0.6);
    ctx.lineWidth = Math.max(2, a * 0.09);
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(x, y, a * 0.5, 0, Math.PI * 2); ctx.stroke();
  }

  // markers: stones of the current turn, otherwise the last completed turn
  const last = browsing ? shown[shown.length - 1] : g.history[g.history.length - 1];
  const marked = g.placed.length && !browsing ? g.placed : (last ? last.cells : []);
  marked.forEach(drawMarker);

  // winning line
  if (g.winLine && !browsing) {
    const [x1, y1] = cellCenter(g.winLine[0]);
    const [x2, y2] = cellCenter(g.winLine[WIN - 1]);
    ctx.strokeStyle = COLORS.marker;
    ctx.lineWidth = a * 0.14;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  Tutorial.draw(ctx, a);
  updateStatus();
  Tutorial.update();
}

function updateStatus() {
  const tag = { human: Online.active ? " (you)" : "", remote: " (friend)", bot1: " (bot)", bot2: " (bot)", bot3: " (bot)", bot4: " (bot)", script: "" };
  const who = p => NAMES[p] + tag[g.players[p]];
  let text;
  const again = Tutorial.active ? "" : Online.active ? "Press “New game” to offer a rematch." : "Press “New game” to play again.";
  if (g.view !== null) text = `Viewing turn ${g.view} of ${g.history.length} – use ◀ ▶ (or the arrow keys) to browse; “Resume” continues the game.`;
  else if (g.winner === "draw") text = `Draw – the board is full. ${again}`;
  else if (g.resigned !== null) text = `${who(g.resigned)} resigned – ${who(g.winner)} wins! ${again}`;
  else if (g.winner !== null) text = `${who(g.winner)} wins! ${again}`;
  else if (g.thinking) text = `${who(g.current)} is thinking…`;
  else if (g.paused && !g.started) text = `Press “Start” to let the bots play (or ▶ to go one turn at a time).`;
  else if (g.paused) text = `Paused – ${who(g.current)} to move. ◀ ▶ (or the arrow keys) go through the moves.`;
  else if (Online.active && !Online.connected) text = `You are ${NAMES[Online.myColor]}. Waiting for your friend…`;
  else if (g.players[g.current] === "remote") text = `${who(g.current)} to move – waiting for their stones…`;
  else {
    const n = stonesThisTurn();
    text = `${who(g.current)} to move – place ${n === 1 ? "1 stone" : `stone ${g.placed.length + 1} of ${n}`}.`;
    if (preview >= 0) text += " Tap it again to place it.";
  }
  statusEl.textContent = text;
  statusEl.style.color = g.winner === null || g.winner === "draw" ? "" : COLORS.stones[g.winner];
  const bots = botsOnly();
  undoBtn.hidden = Online.active || bots;
  undoBtn.disabled = Online.active || Tutorial.active || (g.history.length === 0 && g.placed.length === 0);
  pauseBtn.hidden = browseEl.hidden = !bots;
  pauseBtn.textContent = !g.started ? "Start" : g.paused ? "Resume" : "Pause";
  pauseBtn.classList.toggle("secondary", g.started); // "Start" stands out
  pauseBtn.disabled = g.winner !== null && g.view === null;
  backBtn.disabled = (g.view ?? g.history.length) === 0;
  fwdBtn.disabled = g.view === null && (g.winner !== null || g.thinking);
  newBtn.disabled = Online.active && (!Online.connected || Online.offer === "me");
  resignBtn.disabled = g.winner !== null;
}

// ---------- input ----------

function eventCell(e) {
  const rect = canvas.getBoundingClientRect();
  const c = Math.floor(((e.clientX - rect.left) / rect.width) * BS);
  const r = Math.floor(((e.clientY - rect.top) / rect.height) * BS);
  return r >= 0 && r < BS && c >= 0 && c < BS ? r * BS + c : -1;
}

// Mouse: click places directly. Touch/pen: first tap shows a preview, a second
// tap on the same spot places it (fat fingers on a 19x19 board miss easily).
function onTap(cell, pointerType) {
  if (Tutorial.active && !Tutorial.allows(cell)) return Tutorial.nudge();
  if (pointerType === "mouse" || g.placed.includes(cell) || cell === preview) {
    preview = -1;
    onHumanClick(cell);
    render();
    return;
  }
  const myTurn = g.winner === null && !g.thinking && g.players[g.current] === "human";
  if (!myTurn || g.boards[0][cell] || g.boards[1][cell]) return;
  preview = cell;
  render();
}

let down = null;
canvas.addEventListener("pointerdown", e => {
  down = { x: e.clientX, y: e.clientY, id: e.pointerId };
  Tutorial.touch = e.pointerType !== "mouse";
});
canvas.addEventListener("pointercancel", () => { down = null; }); // e.g. the finger started panning
canvas.addEventListener("pointerup", e => {
  if (!down || down.id !== e.pointerId) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > 12 || (e.pointerType === "mouse" && e.button !== 0)) return;
  const c = eventCell(e);
  if (c >= 0) onTap(c, e.pointerType);
});
canvas.addEventListener("pointermove", e => {
  if (e.pointerType !== "mouse") return;
  const c = eventCell(e);
  if (c !== hover) { hover = c; render(); }
});
canvas.addEventListener("pointerleave", () => { if (hover !== -1) { hover = -1; render(); } });

function setZoom(on) {
  zoomed = on;
  boardWrap.classList.toggle("zoomed", on);
  zoomBtn.textContent = on ? "Zoom out" : "Zoom in";
  zoomBtn.setAttribute("aria-pressed", on);
  canvas.style.width = on ? `${boardWrap.clientWidth * 2}px` : "";
  render();
  if (on) { // centre the view on the action
    const last = g.history[g.history.length - 1];
    scrollBoardTo(preview >= 0 ? preview : g.placed.length ? g.placed[0] : last ? last.cells[0] : (N - 1) / 2);
  }
}

// When zoomed in, scroll the board so that this cell is in the middle.
function scrollBoardTo(cell) {
  const a = canvas.clientWidth / BS;
  boardWrap.scrollLeft = ((cell % BS) + 0.5) * a - boardWrap.clientWidth / 2;
  boardWrap.scrollTop = (Math.floor(cell / BS) + 0.5) * a - boardWrap.clientHeight / 2;
}
zoomBtn.addEventListener("click", () => setZoom(!zoomed));
window.addEventListener("resize", () => { if (zoomed) canvas.style.width = `${boardWrap.clientWidth * 2}px`; });
resignBtn.addEventListener("click", onResignClick);
acceptBtn.addEventListener("click", () => startAgreedNewGame());
declineBtn.addEventListener("click", () => {
  Online.send({ t: Online.offer === "me" ? "offer-cancel" : "offer-decline" });
  Online.offer = null;
  updateOnlineUI();
});
newBtn.addEventListener("click", () => (Online.active ? onlineNewGame() : newGame()));
undoBtn.addEventListener("click", undo);
pauseBtn.addEventListener("click", togglePause);
backBtn.addEventListener("click", back);
fwdBtn.addEventListener("click", forward);
document.addEventListener("keydown", e => {
  if (!g || !botsOnly() || e.target.closest("select, input, textarea")) return;
  if (e.key === "ArrowLeft") { back(); e.preventDefault(); }
  else if (e.key === "ArrowRight") { forward(); e.preventDefault(); }
});
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
