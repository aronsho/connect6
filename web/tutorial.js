// Interactive tutorial: a short scripted game in which the player is Blue and
// a pretend Orange answers with fixed moves. Each step says what to do, marks
// where to do it (a pulsing ring on the board, or an outline on a button) and
// moves on by itself once the player has done it. It can be stopped any time.
//
// Loaded before main.js; it only uses main.js globals (g, place, render, …)
// from inside functions, which run after everything has loaded.
"use strict";

const at = (r, c) => r * BS + c;
const verb = () => (Tutorial.touch ? "Tap" : "Click");

const TUTORIAL_STEPS = [
  {
    text: () => `<b>Welcome!</b> Connect6 is played on a 19×19 board. Get <b>six stones in a row</b> – across, down or diagonally – to win.`,
    next: "Next",
  },
  {
    when: () => Tutorial.touch,
    text: () => `On a phone the board is small. Tap <b>Zoom in</b> to make it bigger, then drag to move around. You can zoom out again any time.`,
    el: () => document.getElementById("zoom"),
    done: () => zoomed,
    next: "Skip",
  },
  {
    text: () => `You are <b class="c0">Blue</b>. Blue always opens with <b>just one stone</b>. ${verb()} the marked spot to place it.`,
    cells: [at(9, 9)],
    done: () => g.history.length >= 1,
  },
  {
    text: () => `Now <b class="c1">Orange</b> answers. From here on, every turn is <b>two stones</b>.`,
    enter: () => Tutorial.script([at(8, 10), at(10, 8)]),
    done: () => g.history.length >= 2,
  },
  {
    text: () => `Your turn – two stones. ${verb()} the marked spot for your first one.`,
    cells: [at(9, 10)],
    done: () => g.placed.includes(at(9, 10)),
  },
  {
    text: () => `Changed your mind? Until your second stone is down, you can take the first one back. ${Tutorial.touch ? "Tap it once" : "Click it again"} to remove it.`,
    cells: [at(9, 10)],
    takeBack: true,
    done: () => !g.boards[0][at(9, 10)],
  },
  {
    text: () => `Now place <b>both</b> stones on the marked spots. Your turn ends as soon as the second one is down.`,
    cells: [at(9, 10), at(9, 11)],
    done: () => g.history.length >= 3,
  },
  {
    text: () => `<b class="c1">Orange</b> places two more stones.`,
    enter: () => Tutorial.script([at(10, 10), at(8, 12)]),
    done: () => g.history.length >= 4,
  },
  {
    text: () => `You have <b>three in a row</b>. Make it five with the marked spots.`,
    cells: [at(9, 12), at(9, 13)],
    done: () => g.history.length >= 5,
  },
  {
    text: () => `Five in a row! <b class="c1">Orange</b> has to block…`,
    enter: () => Tutorial.script([at(9, 14), at(9, 7)]),
    done: () => g.history.length >= 6,
  },
  {
    text: () => `Orange blocked both ends, but there is still room for exactly six. Place the winning stone.`,
    cells: [at(9, 8)],
    done: () => g.winner === 0,
  },
  {
    text: () => `<b>You win!</b> The white line marks your six. One stone was enough: the game ends the moment someone has six in a row.`,
    enter: () => { if (zoomed) setZoom(false); },
    next: "Next",
  },
  {
    text: () => `Up here you choose who plays each colour: <b>Human</b> or a bot. <b>New game</b> starts over and <b>Undo</b> takes back your last turn.`,
    el: () => document.querySelector(".controls"),
    next: "Next",
  },
  {
    text: () => `Want to play a friend on another device? Press <b>Play a friend online</b> and send them the link. Have fun!`,
    el: () => document.getElementById("host"),
    next: "Finish",
  },
];

const Tutorial = {
  active: false,
  touch: matchMedia("(pointer: coarse)").matches, // updated by the last pointer used on the board
  steps: [],
  i: 0,
  advancing: false,
  token: 0,     // bumps on stop, so pending scripted moves are dropped
  shownText: "",
  highlighted: null,
  lastFrame: 0,

  get step() { return this.steps[this.i]; },

  start() {
    if (Online.active) return;
    if (zoomed) setZoom(false);
    this.active = true;
    this.token++;
    this.steps = TUTORIAL_STEPS.filter(s => !s.when || s.when());
    this.i = 0;
    this.advancing = false;
    document.documentElement.classList.add("tutorial-on");
    for (const el of document.querySelectorAll(".controls, .online")) el.inert = true;
    document.getElementById("tutorial-btn").hidden = true;
    document.getElementById("tutorial").hidden = false;
    newGame();
    this.go(0);
    requestAnimationFrame(t => this.tick(t));
  },

  stop() {
    if (!this.active) return;
    this.active = false;
    this.token++;
    this.highlight(null);
    document.documentElement.classList.remove("tutorial-on");
    for (const el of document.querySelectorAll(".controls, .online")) el.inert = false;
    document.getElementById("tutorial-btn").hidden = Online.active;
    document.getElementById("tutorial").hidden = true;
    newGame();
  },

  go(i) {
    if (!this.active) return;
    if (i >= this.steps.length) return this.stop();
    this.i = i;
    const s = this.step;
    this.highlight(s.el ? s.el() : null);
    const nextBtn = document.getElementById("tut-next");
    nextBtn.hidden = !s.next;
    nextBtn.textContent = s.next || "";
    document.getElementById("tut-progress").textContent = `Step ${i + 1} of ${this.steps.length}`;
    if (s.enter) s.enter();
    this.update();
    if (s.cells) this.showCell(s.cells[0]);
    else if (s.el) s.el().scrollIntoView({ block: "nearest", behavior: "smooth" });
  },

  // Called after every board render: move on once the step is done, else refresh the text.
  update() {
    if (!this.active || this.advancing) return;
    const s = this.step;
    if (s.done && s.done()) {
      this.advancing = true;
      const tok = this.token;
      setTimeout(() => {
        if (tok !== this.token) return;
        this.advancing = false;
        this.go(this.i + 1);
      }, 450);
      return;
    }
    let html = s.text();
    if (this.touch && s.cells && s.cells.includes(preview))
      html = `Good – that is only a preview, so a slip of the finger costs nothing. <b>Tap it again</b> to place the stone.`;
    if (html !== this.shownText) {
      this.shownText = html;
      document.getElementById("tut-text").innerHTML = html;
    }
  },

  // Orange's scripted reply, one stone at a time.
  script(cells) {
    const tok = this.token;
    g.thinking = true;
    render();
    cells.forEach((c, k) => setTimeout(() => {
      if (tok !== this.token) return;
      if (k === cells.length - 1) g.thinking = false;
      place(c);
    }, 700 * (k + 1)));
  },

  // May the player use this board cell right now?
  allows(cell) {
    const s = this.step;
    return !this.advancing && !!s.cells && s.cells.includes(cell);
  },

  // Wrong spot: shake the card and repeat where to go.
  nudge() {
    const card = document.getElementById("tutorial");
    card.classList.remove("nudge");
    void card.offsetWidth; // restart the animation
    card.classList.add("nudge");
    const s = this.step;
    if (s.cells && !this.advancing) this.showCell(s.cells.find(c => !g.boards[0][c] && !g.boards[1][c]) ?? s.cells[0]);
  },

  highlight(el) {
    if (this.highlighted) this.highlighted.classList.remove("tut-target");
    this.highlighted = el;
    if (el) el.classList.add("tut-target");
  },

  // Scroll so that the cell is on screen and not hidden behind the tutorial card.
  showCell(cell) {
    if (zoomed) scrollBoardTo(cell);
    const rect = canvas.getBoundingClientRect();
    const a = rect.width / BS;
    const y = rect.top + (Math.floor(cell / BS) + 0.5) * a;
    const cardTop = document.getElementById("tutorial").getBoundingClientRect().top;
    const margin = Math.max(60, 3 * a);
    if (y > cardTop - margin) window.scrollBy({ top: y - cardTop + margin, behavior: "smooth" });
    else if (y < margin) window.scrollBy({ top: y - margin, behavior: "smooth" });
  },

  // Pulsing rings on the cells the player should use (drawn by main.js render()).
  draw(ctx, a) {
    if (!this.active || this.advancing || !this.step.cells) return;
    const phase = 0.5 + 0.5 * Math.sin((performance.now() / 1100) * Math.PI * 2);
    for (const cell of this.step.cells) {
      const taken = g.boards[0][cell] || g.boards[1][cell];
      if (taken && !this.step.takeBack) continue;
      if (cell === preview) continue;
      const [x, y] = cellCenter(cell);
      ctx.fillStyle = `rgba(255,255,255,${0.10 + 0.12 * phase})`;
      ctx.beginPath(); ctx.arc(x, y, a * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.95 - 0.45 * phase})`;
      ctx.lineWidth = Math.max(2, a * 0.1);
      ctx.beginPath(); ctx.arc(x, y, a * (0.55 + 0.22 * phase), 0, Math.PI * 2); ctx.stroke();
    }
  },

  tick(t) {
    if (!this.active) return;
    if (this.step.cells && t - this.lastFrame > 40) { this.lastFrame = t; render(); }
    requestAnimationFrame(tt => this.tick(tt));
  },
};

document.getElementById("tutorial-btn").addEventListener("click", () => Tutorial.start());
document.getElementById("tut-stop").addEventListener("click", () => Tutorial.stop());
document.getElementById("tut-next").addEventListener("click", () => Tutorial.go(Tutorial.i + 1));
document.addEventListener("keydown", e => { if (e.key === "Escape") Tutorial.stop(); });
