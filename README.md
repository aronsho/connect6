# Connect6

## Intro
- The idea of this project is to create a strong bot to play the game of connect6
- As a first step, a GUI with a deterministic bot was programmed
- Now, the plan is to apply machine learning techniques insted of the deterministic one

## Structure
- `playgame.py` is the main script (pygame GUI, game flow and rules)
- `Bot.py` contains the bot classes (`E6`, `PlayRand`)
- Games are saved as pickles under the name entered on the home screen (default `game1`)

## Play in the browser
- `web/` contains a browser version of the game (plain HTML/JS, no build step):
  `connect6.js` (rules), `bot.js` (port of the E6 bot), `main.js` (UI)
- Play locally: open `web/index.html`, or run `python3 -m http.server --directory web` and go to http://localhost:8000
- Bots: "medium" (greedy) plays like `Bot.py` does today; "expert" (lookahead) is the 2-ply min/max search that `E6.tree()` was meant to do;
  "killer" is expert plus a threat-space search (win if possible, block threats, find forced wins made of double
  threats, and avoid moves that let the opponent start one). Its settings are in `E6_KILLER` in `bot.js`
- Online play: "Play a friend online" creates a link; whoever opens it joins the game. Browsers connect
  peer-to-peer via WebRTC (`online.js`, PeerJS); the free public PeerJS server only introduces them
- Hosting: `.github/workflows/pages.yml` publishes `web/` to GitHub Pages on every push to `master`
  (one-time setup: repo Settings → Pages → Source: "GitHub Actions")
