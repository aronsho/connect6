# Connect6

## Intro
- The idea of this project is to create a strong bot to play the game of connect6
- As a first step, a GUI with a deterministic bot was programmed
- Now, the plan is to apply machine learning techniques insted of the deterministic one

## Structure
- spiel.py is the main script
- game_class.py contains all the game specific classes
- bot_class.py contains the class for the moves of the bot
- gameX (X is a number) are files which contain information about a single game

## Play in the browser
- `web/` contains a browser version of the game (plain HTML/JS, no build step):
  `connect6.js` (rules), `bot.js` (port of the E6 bot), `main.js` (UI)
- Play locally: open `web/index.html`, or run `python3 -m http.server --directory web` and go to http://localhost:8000
- Bots: "greedy" plays like `Bot.py` does today; "lookahead" is the 2-ply min/max search that `E6.tree()` was meant to do
- Hosting: `.github/workflows/pages.yml` publishes `web/` to GitHub Pages on every push to `master`
  (one-time setup: repo Settings → Pages → Source: "GitHub Actions")
