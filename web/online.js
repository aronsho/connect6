// Remote multiplayer over WebRTC (PeerJS). The two browsers talk directly to
// each other; the free public PeerJS server is only used to introduce them.
//
// The host creates a game and shares a link (?join=CODE). Both sides apply the
// same stone placements in the same order, so their boards stay identical.
// When the guest (re)connects, the host sends the full state ("sync").
//
// Messages: {t:"place", cell} | {t:"unplace", cell} | {t:"resign"}
//           | {t:"offer"} | {t:"offer-cancel"} | {t:"offer-decline"} | {t:"new", hostColor}
//           | {t:"sync", state, guestColor, score}
"use strict";

const PEER_PREFIX = "aronsho-connect6-";

const Online = {
  active: false,
  role: null,       // "host" | "guest"
  code: null,
  myColor: 0,       // 0 = Blue, 1 = Orange
  connected: false,
  offer: null,      // new-game offer: null | "me" | "friend" | "declined"
  score: { host: 0, guest: 0, draws: 0 }, // wins this session, by person
  peer: null,
  conn: null,
  onStatus: () => {},   // set by main.js
  onMessage: () => {},  // set by main.js
  onStart: () => {},    // set by main.js: (myColor, state|null) => void

  shareLink() {
    return `${location.origin}${location.pathname}?join=${this.code}`;
  },

  host() {
    this.leave();
    this.active = true;
    this.role = "host";
    this.myColor = 0;
    this.code = randomCode();
    this.status("Starting online game…");
    this.peer = new Peer(PEER_PREFIX + this.code);
    this.peer.on("open", () => {
      this.onStart(this.myColor, null);
      this.status("Waiting for your friend to open the link…");
    });
    this.peer.on("connection", conn => {
      if (this.conn) this.conn.close(); // a reconnecting guest replaces the old link
      this.attach(conn);
    });
    this.peer.on("error", err => {
      if (err.type === "unavailable-id") return this.host(); // code clash: pick another
      this.status(`Connection problem: ${err.type || err.message}`, true);
    });
    this.peer.on("disconnected", () => { if (this.peer && !this.peer.destroyed) this.peer.reconnect(); });
  },

  join(code) {
    this.leave();
    this.active = true;
    this.role = "guest";
    this.code = code;
    this.status("Connecting to your friend…");
    this.peer = new Peer();
    this.peer.on("open", () => this.attach(this.peer.connect(PEER_PREFIX + code, { reliable: true })));
    this.peer.on("error", err => {
      if (err.type === "peer-unavailable") this.status("Game not found. The host may have closed their page; ask them for a new link.", true);
      else this.status(`Connection problem: ${err.type || err.message}`, true);
    });
  },

  attach(conn) {
    this.conn = conn;
    conn.on("open", () => {
      this.connected = true;
      this.status("Connected – playing online.");
      if (this.role === "host") this.onMessage({ t: "need-sync" });
    });
    conn.on("data", msg => {
      if (this.role === "guest" && msg.t === "sync") {
        this.myColor = msg.guestColor;
        this.onStart(this.myColor, msg.state, msg.score);
      } else {
        this.onMessage(msg);
      }
    });
    conn.on("close", () => {
      if (this.conn !== conn) return;
      this.connected = false;
      this.offer = null;
      this.status(this.role === "host"
        ? "Your friend disconnected. They can reopen the link to continue."
        : "Connection to the host was lost. Reload the page to reconnect.", true);
    });
  },

  send(msg) {
    if (this.conn && this.connected) this.conn.send(msg);
  },

  leave() {
    if (this.peer) this.peer.destroy();
    Object.assign(this, {
      active: false, role: null, code: null, connected: false, peer: null, conn: null, myColor: 0,
      offer: null, score: { host: 0, guest: 0, draws: 0 },
    });
  },

  status(text, warn = false) { this.onStatus(text, warn); },
};

function randomCode() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  const r = crypto.getRandomValues(new Uint8Array(6));
  for (const b of r) s += alphabet[b % alphabet.length];
  return s;
}
