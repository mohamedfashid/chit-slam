// Core game rules for one room. Pure logic: no sockets, no I/O.
// The server calls these methods and then broadcasts room.view(playerId)
// to each player. Time is always passed in (`now`) so tests can control it.
//
// Turn-based play: turns go clockwise. On your turn you hold one chit more than
// a set needs; you either pass one chit to the next player (their turn) or, if
// you hold a set, slam BOOST. After a BOOST everyone races to stack their hand
// on top - that part has no turns - and the order of the pile is the score.

import { randomBytes, randomInt } from 'node:crypto';
import { getPack, packSummaries, CUSTOM_PACK_ID, PACKS } from './packs.js';
import { randomAvatar, normalizeAvatar } from '../public/avatar-parts.js';

export const WORD = 'BOOST';
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const MAX_CUSTOM_ITEMS = 40;
export const MAX_ITEM_LEN = 24;
export const MAX_NAME_LEN = 16;
export const TURN_SECS = [10, 15, 20, 30];
export const AWAY_AFTER_MISSES = 2; // auto-passed this many turns in a row -> marked away

export const TIMING = {
  countdownMs: 3000, // "3, 2, 1, go!"
  stackTimeoutMs: 12000, // after the BOOST, how long stragglers get to stack
  readyTimeoutMs: 20000, // results screen with friends: next round when all are ready, or after this
  awayTurnMs: 3000, // turn length for someone marked away
  maxLatencyCompMs: 150, // cap on network-delay compensation per stack slam
  lobbyDisconnectMs: 30000, // drop a disconnected player from the lobby after this
  gameDisconnectMs: 120000, // ...and from a running game after this
  hostHandoverMs: 15000, // pass the host role on if the host is gone this long
  falseSlamShowMs: 2500, // how long "X slammed without a set!" stays visible
  autopilotPassMs: 1600, // how fast a disconnected player's seat passes on its turn
  noticeMs: 6000,
};

// How long bots take on their turn, and to notice hands going down.
export const BOT_SPEEDS = {
  relaxed: { turn: [1800, 3200], notice: [1500, 4000] },
  normal: { turn: [1000, 2000], notice: [800, 2800] },
  fast: { turn: [500, 1100], notice: [400, 1500] },
};

// Bots get an ordinary first name, never a relative's title.
export const BOT_NAMES = [
  'Arjun', 'Meera', 'Kavya', 'Rahul', 'Divya', 'Nikhil', 'Priya', 'Sanjay', 'Anjali', 'Vikram',
  'Lakshmi', 'Rohan', 'Asha', 'Karthik', 'Nisha', 'Varun', 'Deepa', 'Ravi', 'Sneha', 'Manoj',
  'Leela', 'Hari', 'Ishaan', 'Tara', 'Zoya', 'Sam', 'Maya', 'Leo', 'Nina', 'Omar',
  'Sara', 'Alex', 'Mia', 'Noah', 'Aisha', 'Yusuf', 'Joseph', 'Maria', 'Kiran', 'Gautam',
  'Revathi', 'Suresh', 'Anu', 'Vijay', 'Pooja', 'Arun', 'Shruti', 'Naveen', 'Farah', 'Imran',
  'Riya', 'Dev', 'Anika', 'Tom', 'Lina', 'Aditya', 'Bhavana', 'Chris', 'Esha', 'Felix',
];

const COLORS = ['#e4572e', '#2e86ab', '#3a9d5d', '#d99a1e', '#8e5ec4', '#d64f8c', '#14897e', '#6b5b4b'];
const BETWEEN = new Set(['lobby', 'gameOver']);
const MID_ROUND = new Set(['countdown', 'playing', 'stacking']);

const newId = (prefix) => prefix + randomBytes(6).toString('hex');

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Clean user-typed text: strip control and bidi-override characters (spoofing),
// keep ZWJ/ZWNJ (needed by Malayalam, Telugu, etc.), collapse spaces, limit length.
export function cleanText(input, maxLen) {
  if (typeof input !== 'string') return '';
  const s = input
    .normalize('NFC')
    .replace(/[\p{Cc}‪-‮⁦-⁩‎‏﻿]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(s).slice(0, maxLen).join('').trim();
}

export function cleanItems(input) {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split('\n') : [];
  const seen = new Set();
  const out = [];
  for (const raw of list.slice(0, MAX_CUSTOM_ITEMS * 2)) {
    const item = cleanText(raw, MAX_ITEM_LEN);
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= MAX_CUSTOM_ITEMS) break;
  }
  return out;
}

export class Room {
  constructor(code, opts = {}) {
    this.code = code;
    this.t = { ...TIMING, ...(opts.timing || {}) };
    // inclusive random int, overridable for tests
    this.rand = opts.rand || ((min, max) => randomInt(min, max + 1));
    this.players = new Map();
    this.order = []; // join order, also the seating order around the circle
    this.hostId = null;
    this.settings = { packId: 'tiffin', customItems: [], setSize: 3, locked: false, turnSecs: 15, botSpeed: 'relaxed' };
    this.phase = 'lobby'; // lobby | countdown | playing | stacking | roundEnd | gameOver
    this.round = 0;
    this.seats = []; // player ids in this round, clockwise (pass to the next one)
    this.labels = new Map(); // chitId -> label (chit ids are random so they reveal nothing)
    this.turnId = null; // whose turn it is
    this.turnNo = 0; // counts turns, so "one false slam per turn" can be checked
    this.turnEndsAt = 0; // 0 = no time limit on this turn
    this.turnTotalMs = 0;
    this.slams = []; // { playerId, at, adjAt } in arrival order; [0] is the BOOST
    this.boosterId = null;
    this.phaseEndsAt = 0;
    this.lastResult = null;
    this.gameResult = null;
    this.falseSlams = []; // { playerId, at }
    this.notice = null; // { text, at }
    this.dirty = true;
  }

  // ---------- players ----------

  addPlayer({ name, isBot = false, avatar, now = Date.now() }) {
    if (this.order.length >= MAX_PLAYERS) return { error: `Room is full (${MAX_PLAYERS} players max).` };
    const clean = cleanText(name, MAX_NAME_LEN);
    if (!clean) return { error: 'Please enter a nickname.' };
    const p = {
      id: newId('p'),
      token: isBot ? null : randomBytes(18).toString('base64url'),
      name: this.uniqueName(clean),
      color: this.freeColor(),
      avatar: normalizeAvatar(avatar) || randomAvatar((n) => randomInt(n)),
      passes: 0,
      isBot,
      connected: true,
      disconnectedAt: null,
      score: 0,
      letters: 0,
      rtt: 0,
      inGame: false,
      leaving: false,
      hand: [],
      newChit: null, // the chit that just arrived (shown as NEW)
      slammed: false,
      falseTurn: -1, // turnNo of this player's last false slam
      missed: 0, // turns in a row the timer passed for them
      away: false,
      ready: false,
      ai: {},
      joinedAt: now,
    };
    this.players.set(p.id, p);
    this.order.push(p.id);
    if (!isBot && !this.hostId) this.hostId = p.id;
    this.dirty = true;
    return { player: p };
  }

  uniqueName(name) {
    const taken = new Set([...this.players.values()].map((p) => p.name.toLocaleLowerCase()));
    if (!taken.has(name.toLocaleLowerCase())) return name;
    for (let i = 2; ; i++) {
      const candidate = `${Array.from(name).slice(0, MAX_NAME_LEN - 2).join('')} ${i}`;
      if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
    }
  }

  freeColor() {
    const used = new Set([...this.players.values()].map((p) => p.color));
    return COLORS.find((c) => !used.has(c)) || COLORS[this.order.length % COLORS.length];
  }

  setAvatar(id, avatar) {
    const p = this.players.get(id);
    if (!p) return { error: 'Player not found.' };
    if (!BETWEEN.has(this.phase)) return { error: 'Change your look between games.' };
    const clean = normalizeAvatar(avatar);
    if (!clean) return { error: 'Unknown character.' };
    p.avatar = clean;
    this.dirty = true;
    return { ok: true };
  }

  findByToken(token) {
    if (typeof token !== 'string' || !token) return null;
    for (const p of this.players.values()) if (p.token && p.token === token && !p.leaving) return p;
    return null;
  }

  humans() {
    return [...this.players.values()].filter((p) => !p.isBot && !p.leaving);
  }

  isHost(id) {
    return id && this.hostId === id;
  }

  // Friends games have a turn timer; playing alone with bots never does.
  timed() {
    return this.humans().filter((p) => p.connected).length > 1;
  }

  setConnected(id, connected, now = Date.now()) {
    const p = this.players.get(id);
    if (!p || p.isBot) return;
    p.connected = connected;
    p.disconnectedAt = connected ? null : now;
    if (connected) this.markActive(p);
    if (this.phase === 'playing') this.syncTurnClock(now);
    this.dirty = true;
  }

  // Any action from a player shows they are here.
  markActive(p) {
    p.missed = 0;
    if (p.away) {
      p.away = false;
      this.dirty = true;
    }
  }

  here(id) {
    const p = this.players.get(id);
    if (p) this.markActive(p);
    return { ok: true };
  }

  // Leaving mid-round keeps the seat on autopilot until the round ends, so the
  // turns keep going; otherwise the player is removed right away.
  removePlayer(id, now = Date.now()) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.inGame && MID_ROUND.has(this.phase)) {
      p.leaving = true;
      p.connected = false;
      p.disconnectedAt = p.disconnectedAt ?? now;
      if (this.phase === 'playing') this.syncTurnClock(now);
    } else {
      this.deletePlayer(id);
    }
    if (this.hostId === id) this.reassignHost();
    this.dirty = true;
  }

  deletePlayer(id) {
    this.players.delete(id);
    this.order = this.order.filter((x) => x !== id);
    if (this.hostId === id) this.reassignHost();
    this.dirty = true;
  }

  reassignHost() {
    const humans = this.humans();
    const next = humans.find((p) => p.connected) || humans[0] || null;
    this.hostId = next ? next.id : null;
    this.dirty = true;
  }

  // Kicking just removes the seat. To keep people out, the host locks the room
  // (no IP bans: families often share one Wi-Fi, and we don't keep IPs anyway).
  kick(byId, targetId, now = Date.now()) {
    if (!this.isHost(byId)) return { error: 'Only the host can remove players.' };
    if (byId === targetId) return { error: "You can't remove yourself - use Leave." };
    const target = this.players.get(targetId);
    if (!target) return { error: 'Player not found.' };
    this.removePlayer(targetId, now);
    return { ok: true, target };
  }

  addBot(byId, now = Date.now()) {
    if (!this.isHost(byId)) return { error: 'Only the host can add bots.' };
    if (!BETWEEN.has(this.phase)) return { error: 'Add bots between games.' };
    const taken = new Set([...this.players.values()].map((p) => p.name.toLocaleLowerCase()));
    const free = BOT_NAMES.filter((n) => !taken.has(n.toLocaleLowerCase()));
    const name = free.length ? free[randomInt(free.length)] : 'Bot';
    return this.addPlayer({ name, isBot: true, now });
  }

  // ---------- settings ----------

  updateSettings(byId, s = {}) {
    if (!this.isHost(byId)) return { error: 'Only the host can change settings.' };
    // Locking the room is allowed at any time; everything else only between games.
    if (typeof s.locked === 'boolean') {
      this.settings.locked = s.locked;
      this.dirty = true;
    }
    const keys = ['packId', 'customItems', 'setSize', 'turnSecs', 'botSpeed'];
    if (!keys.some((k) => s[k] !== undefined)) return { ok: true };
    if (!BETWEEN.has(this.phase)) return { error: 'Change settings between games.' };
    if (typeof s.packId === 'string' && (s.packId === CUSTOM_PACK_ID || getPack(s.packId))) {
      this.settings.packId = s.packId;
    }
    if (s.customItems !== undefined) this.settings.customItems = cleanItems(s.customItems);
    if (s.setSize === 3 || s.setSize === 4) this.settings.setSize = s.setSize;
    if (TURN_SECS.includes(s.turnSecs)) this.settings.turnSecs = s.turnSecs;
    if (typeof s.botSpeed === 'string' && Object.hasOwn(BOT_SPEEDS, s.botSpeed)) this.settings.botSpeed = s.botSpeed;
    this.dirty = true;
    return { ok: true };
  }

  itemsPool() {
    if (this.settings.packId === CUSTOM_PACK_ID) return this.settings.customItems;
    return (getPack(this.settings.packId) || PACKS[0]).items;
  }

  startProblem() {
    const count = this.order.filter((id) => !this.players.get(id).leaving).length;
    if (count < MIN_PLAYERS) return `Need at least ${MIN_PLAYERS} players - invite friends or add a bot.`;
    const pool = this.itemsPool().length;
    if (pool < count) return `Need at least ${count} different chits for ${count} players (you have ${pool}).`;
    return null;
  }

  // ---------- game flow ----------

  startGame(byId, now = Date.now()) {
    if (!this.isHost(byId)) return { error: 'Only the host can start.' };
    if (!BETWEEN.has(this.phase)) return { error: 'A game is already running.' };
    const problem = this.startProblem();
    if (problem) return { error: problem };
    for (const p of this.players.values()) {
      p.score = 0;
      p.letters = 0;
    }
    this.round = 0;
    this.lastResult = null;
    this.gameResult = null;
    this.startRound(now);
    return { ok: true };
  }

  backToLobby(byId) {
    if (!this.isHost(byId)) return { error: 'Only the host can do that.' };
    this.resetToLobby();
    return { ok: true };
  }

  resetToLobby(noticeText, now = Date.now()) {
    for (const p of [...this.players.values()]) {
      if (p.leaving) this.deletePlayer(p.id);
    }
    for (const p of this.players.values()) {
      p.inGame = false;
      p.hand = [];
      p.newChit = null;
      p.slammed = false;
    }
    this.phase = 'lobby';
    this.seats = [];
    this.slams = [];
    this.turnId = null;
    this.turnEndsAt = 0;
    this.labels = new Map();
    if (noticeText) this.notice = { text: noticeText, at: now };
    this.dirty = true;
  }

  // Whoever got the letter last round starts this one (and holds the extra chit).
  pickStarter() {
    const losers = (this.lastResult?.placements || [])
      .filter((x) => x.letter && this.seats.includes(x.playerId))
      .map((x) => x.playerId);
    const pool = losers.length ? losers : this.seats;
    return pool[this.rand(0, pool.length - 1)];
  }

  startRound(now) {
    // Seats that left (or vanished for too long) go now, between rounds.
    for (const p of [...this.players.values()]) {
      const gone = !p.isBot && !p.connected && p.disconnectedAt !== null && now - p.disconnectedAt > this.t.gameDisconnectMs;
      if (p.leaving || gone) this.deletePlayer(p.id);
    }
    // Late joiners get dealt in from the next round.
    this.seats = [...this.order];
    const problem = this.startProblem();
    if (problem) {
      this.resetToLobby(`Game stopped: ${problem}`, now);
      return;
    }
    const size = this.settings.setSize;
    const n = this.seats.length;
    const starter = this.pickStarter();
    const starterIdx = this.seats.indexOf(starter);
    const items = shuffle([...this.itemsPool()]).slice(0, n);

    // Each word on `size` chits, plus one extra chit for the starter.
    let hands;
    for (let attempt = 0; attempt < 100; attempt++) {
      const chits = shuffle([...items.flatMap((item) => Array(size).fill(item)), items[this.rand(0, n - 1)]]);
      hands = [];
      let k = 0;
      for (let i = 0; i < n; i++) {
        const take = i === starterIdx ? size + 1 : size;
        hands.push(chits.slice(k, k + take));
        k += take;
      }
      // Nobody should be dealt a finished set.
      const dealtSet = hands.some((h) => {
        const counts = new Map();
        return h.some((label) => counts.set(label, (counts.get(label) || 0) + 1).get(label) >= size);
      });
      if (!dealtSet) break;
    }

    this.round += 1;
    this.labels = new Map();
    this.seats.forEach((id, i) => {
      const p = this.players.get(id);
      p.inGame = true;
      p.hand = hands[i].map((label) => {
        const cid = newId('c');
        this.labels.set(cid, label);
        return cid;
      });
      p.newChit = null;
      p.slammed = false;
      p.falseTurn = -1;
      p.ready = false;
      p.passes = 0;
      p.ai = {};
    });
    this.slams = [];
    this.boosterId = null;
    this.falseSlams = [];
    this.turnId = starter; // shown during the countdown as "X starts"
    this.turnEndsAt = 0;
    this.phase = 'countdown';
    this.phaseEndsAt = now + this.t.countdownMs;
    this.dirty = true;
  }

  nextSeat(id) {
    const i = this.seats.indexOf(id);
    return this.seats[(i + 1) % this.seats.length];
  }

  prevSeat(id) {
    const i = this.seats.indexOf(id);
    return this.seats[(i - 1 + this.seats.length) % this.seats.length];
  }

  setLabel(p) {
    const size = this.settings.setSize;
    const counts = new Map();
    for (const cid of p.hand) {
      const label = this.labels.get(cid);
      const c = (counts.get(label) || 0) + 1;
      if (c >= size) return label;
      counts.set(label, c);
    }
    return null;
  }

  hasSet(p) {
    return this.setLabel(p) !== null;
  }

  // How long the current turn may last (0 = no limit).
  turnLimitMs(p) {
    if (!p || p.isBot) return 0; // bots move on their own schedule
    if (!p.connected) return this.t.autopilotPassMs;
    if (!this.timed()) return 0;
    return p.away ? this.t.awayTurnMs : this.settings.turnSecs * 1000;
  }

  beginTurn(id, now) {
    const p = this.players.get(id);
    this.turnId = id;
    this.turnNo += 1;
    p.ai = {};
    const limit = this.turnLimitMs(p);
    this.turnEndsAt = limit ? now + limit : 0;
    this.turnTotalMs = limit;
    this.dirty = true;
  }

  // Keep the deadline in step with who is connected (someone may join or drop mid-turn).
  syncTurnClock(now) {
    const p = this.players.get(this.turnId);
    if (!p) return;
    const limit = this.turnLimitMs(p);
    if (!limit && this.turnEndsAt) {
      this.turnEndsAt = 0;
      this.turnTotalMs = 0;
      this.dirty = true;
    } else if (limit && (!this.turnEndsAt || this.turnEndsAt > now + limit)) {
      this.turnEndsAt = now + limit;
      this.turnTotalMs = limit;
      this.dirty = true;
    }
  }

  doPass(p, chitId, now) {
    p.hand.splice(p.hand.indexOf(chitId), 1);
    p.newChit = null;
    p.passes += 1; // lets every screen animate a chit flying to the next seat
    const to = this.players.get(this.nextSeat(p.id));
    to.hand.push(chitId);
    to.newChit = chitId;
    this.beginTurn(to.id, now);
  }

  pass(id, chitId, now = Date.now()) {
    const p = this.players.get(id);
    if (!p || !p.inGame) return { error: "You're not in this round." };
    if (this.phase === 'stacking') return { error: 'Hands are going down - slam!' };
    if (this.phase !== 'playing') return { error: 'Not now.' };
    if (this.turnId !== id) return { error: 'Wait for your turn.' };
    if (!p.hand.includes(chitId)) return { error: "That chit isn't in your hand." };
    this.markActive(p);
    this.doPass(p, chitId, now);
    return { ok: true };
  }

  slam(id, now = Date.now()) {
    const p = this.players.get(id);
    if (!p || !p.inGame) return { error: "You're not in this round." };
    if (p.slammed) return { error: 'Your hand is down already.' };
    if (this.phase === 'playing') {
      if (this.turnId !== id) return { error: 'You can only BOOST on your turn.' };
      this.markActive(p);
      if (!this.hasSet(p)) {
        if (p.falseTurn === this.turnNo) return { error: 'No set - pass a chit.' };
        // Slamming without a set: -1 point, and you still have to pass.
        p.falseTurn = this.turnNo;
        p.score = Math.max(0, p.score - 1);
        this.falseSlams.push({ playerId: id, at: now });
        this.dirty = true;
        return { ok: false, falseSlam: true };
      }
      p.slammed = true;
      this.slams.push({ playerId: id, at: now, adjAt: now });
      this.phase = 'stacking';
      this.boosterId = id;
      this.turnId = null;
      this.turnEndsAt = 0;
      this.phaseEndsAt = now + this.t.stackTimeoutMs;
    } else if (this.phase === 'stacking') {
      this.markActive(p);
      // Network-delay compensation: assume the tap happened ~half a round-trip earlier.
      const comp = Math.min((p.rtt || 0) / 2, this.t.maxLatencyCompMs);
      p.slammed = true;
      this.slams.push({ playerId: id, at: now, adjAt: now - comp });
    } else {
      return { error: 'Not now.' };
    }
    if (this.seats.every((sid) => this.players.get(sid)?.slammed)) this.endRound(now);
    this.dirty = true;
    return { ok: true };
  }

  // Final hand order: the BOOST is always first; everyone else by delay-adjusted time.
  placementOrder() {
    const [booster, ...rest] = this.slams;
    return booster ? [booster, ...rest.sort((a, b) => a.adjAt - b.adjAt)] : [];
  }

  endRound(now) {
    const order = this.placementOrder();
    const n = this.seats.length;
    const placements = order.map((s, i) => ({ playerId: s.playerId, place: i + 1, points: n - 1 - i, slammed: true }));
    for (const id of this.seats) {
      if (!this.slams.some((s) => s.playerId === id)) {
        placements.push({ playerId: id, place: order.length + 1, points: 0, slammed: false });
      }
    }
    const lastPlace = Math.max(...placements.map((x) => x.place));
    for (const x of placements) {
      const p = this.players.get(x.playerId);
      x.letter = x.place === lastPlace;
      p.score += x.points;
      if (x.letter) p.letters = Math.min(WORD.length, p.letters + 1);
      x.name = p.name;
      x.color = p.color;
      x.avatar = p.avatar;
      x.isBot = p.isBot;
      x.score = p.score;
      x.letters = p.letters;
    }
    const boosterId = order[0]?.playerId ?? null;
    const booster = boosterId ? this.players.get(boosterId) : null;
    this.lastResult = {
      round: this.round,
      boosterId,
      boosterLabel: booster ? this.setLabel(booster) : null,
      setSize: this.settings.setSize,
      placements,
    };
    this.turnId = null;
    this.turnEndsAt = 0;
    for (const p of this.players.values()) p.ready = false;

    const out = this.seats.map((id) => this.players.get(id)).filter((p) => p.letters >= WORD.length);
    if (out.length) {
      const standings = this.seats
        .map((id) => this.players.get(id))
        .sort((a, b) => b.score - a.score || a.letters - b.letters)
        .map((p) => ({ playerId: p.id, name: p.name, color: p.color, avatar: p.avatar, isBot: p.isBot, score: p.score, letters: p.letters }));
      this.gameResult = { standings, winnerId: standings[0].playerId, boostedIds: out.map((p) => p.id) };
      this.phase = 'gameOver';
      for (const p of this.players.values()) p.inGame = false;
    } else {
      this.phase = 'roundEnd';
      this.phaseEndsAt = now + this.t.readyTimeoutMs;
    }
    this.dirty = true;
  }

  // ---------- between rounds ----------

  // People who must tap Ready before the next round (connected humans only).
  readyWaiting() {
    return this.humans().filter((p) => p.connected && !p.ready);
  }

  ready(id, now = Date.now()) {
    const p = this.players.get(id);
    if (!p) return { error: 'Player not found.' };
    if (this.phase !== 'roundEnd') return { error: 'Not now.' };
    this.markActive(p);
    p.ready = true;
    this.dirty = true;
    if (!this.readyWaiting().length) this.startRound(now);
    return { ok: true };
  }

  // ---------- bots & autopilot ----------

  pickDiscard(p) {
    const counts = new Map();
    for (const cid of p.hand) {
      const l = this.labels.get(cid);
      counts.set(l, (counts.get(l) || 0) + 1);
    }
    const min = Math.min(...counts.values());
    const candidates = p.hand.filter((cid) => counts.get(this.labels.get(cid)) === min);
    return candidates[this.rand(0, candidates.length - 1)];
  }

  botDelay(kind) {
    const [min, max] = (BOT_SPEEDS[this.settings.botSpeed] || BOT_SPEEDS.relaxed)[kind];
    return this.rand(min, max);
  }

  runPlaying(now) {
    const p = this.players.get(this.turnId);
    if (!p) return;
    if (p.isBot) {
      p.ai.actAt ??= now + this.botDelay('turn');
      if (now < p.ai.actAt) return;
      if (this.hasSet(p)) this.slam(p.id, now);
      else this.doPass(p, this.pickDiscard(p), now);
      return;
    }
    this.syncTurnClock(now);
    if (this.turnEndsAt && now >= this.turnEndsAt) {
      // Time's up: pass the least useful chit for them. Never slams for anyone.
      if (p.connected && !p.leaving) {
        p.missed += 1;
        if (p.missed >= AWAY_AFTER_MISSES) p.away = true;
      }
      this.doPass(p, this.pickDiscard(p), now);
    }
  }

  runStacking(now) {
    for (const id of this.seats) {
      if (this.phase !== 'stacking') return; // the last slam ended the round
      const p = this.players.get(id);
      if (!p || p.slammed || !p.isBot) continue;
      p.ai.noticeAt ??= now + this.botDelay('notice');
      if (now >= p.ai.noticeAt) this.slam(id, now);
    }
    if (this.phase !== 'stacking') return;
    const waiting = this.seats.map((id) => this.players.get(id)).filter((p) => !p.slammed);
    const nobodyCanSlam = waiting.every((p) => !p.isBot && !p.connected);
    if (now >= this.phaseEndsAt || nobodyCanSlam) this.endRound(now);
  }

  // ---------- clock ----------

  tick(now = Date.now()) {
    // housekeeping for disconnected players
    for (const p of [...this.players.values()]) {
      if (p.isBot || p.connected || p.disconnectedAt === null) continue;
      const away = now - p.disconnectedAt;
      if (BETWEEN.has(this.phase) && away > this.t.lobbyDisconnectMs) this.deletePlayer(p.id);
      else if (this.hostId === p.id && away > this.t.hostHandoverMs) {
        const other = this.humans().find((h) => h.connected);
        if (other) {
          this.hostId = other.id;
          this.dirty = true;
        }
      }
    }

    switch (this.phase) {
      case 'countdown':
        if (now >= this.phaseEndsAt) {
          this.phase = 'playing';
          this.beginTurn(this.turnId, now);
        }
        break;
      case 'playing':
        this.runPlaying(now);
        break;
      case 'stacking':
        this.runStacking(now);
        break;
      case 'roundEnd':
        // With friends: start when everyone is ready, or when the wait runs out.
        // Alone with bots: wait for you, however long.
        if (!this.readyWaiting().length || (this.timed() && now >= this.phaseEndsAt)) this.startRound(now);
        break;
      default:
        break;
    }

    const freshFalse = this.falseSlams.filter((f) => now - f.at < this.t.falseSlamShowMs);
    if (freshFalse.length !== this.falseSlams.length) {
      this.falseSlams = freshFalse;
      this.dirty = true;
    }
    if (this.notice && now - this.notice.at > this.t.noticeMs) {
      this.notice = null;
      this.dirty = true;
    }
  }

  isAbandoned() {
    return this.humans().length === 0;
  }

  hasConnectedHuman() {
    return this.humans().some((p) => p.connected);
  }

  // ---------- what each player is allowed to see ----------

  view(viewerId, now = Date.now()) {
    const me = this.players.get(viewerId);
    const between = BETWEEN.has(this.phase);
    const problem = this.startProblem();
    const timed = this.timed();
    let phaseMs = null;
    if (this.phase === 'countdown') phaseMs = Math.max(0, this.phaseEndsAt - now);
    else if (this.phase === 'roundEnd' && timed) phaseMs = Math.max(0, this.phaseEndsAt - now);
    const turnVisible = this.phase === 'playing' || this.phase === 'countdown';
    const myTurn = !!me && this.phase === 'playing' && this.turnId === me.id;
    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      word: WORD,
      youId: viewerId,
      hostId: this.hostId,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      settings: {
        packId: this.settings.packId,
        setSize: this.settings.setSize,
        locked: this.settings.locked,
        turnSecs: this.settings.turnSecs,
        botSpeed: this.settings.botSpeed,
        customItems: between ? this.settings.customItems : [],
      },
      packs: between ? packSummaries() : null,
      canStart: !problem,
      startProblem: problem,
      timed,
      players: this.order.map((id) => {
        const p = this.players.get(id);
        return {
          id: p.id,
          name: p.name,
          color: p.color,
          avatar: p.avatar,
          passes: p.passes,
          isBot: p.isBot,
          connected: p.connected,
          leaving: p.leaving,
          away: p.away,
          ready: p.isBot || p.ready,
          score: p.score,
          letters: p.letters,
          inGame: p.inGame,
          seat: this.seats.indexOf(id),
          handCount: p.hand.length,
        };
      }),
      seats: MID_ROUND.has(this.phase) ? this.seats : [],
      turnId: turnVisible ? this.turnId : null,
      turnNo: this.turnNo,
      turnMs: this.phase === 'playing' && this.turnEndsAt ? Math.max(0, this.turnEndsAt - now) : null,
      turnTotalMs: this.turnTotalMs,
      you: me
        ? {
            inGame: me.inGame && MID_ROUND.has(this.phase),
            hand: me.hand.map((cid) => ({ id: cid, label: this.labels.get(cid), new: cid === me.newChit })),
            slammed: me.slammed,
            myTurn,
            falseThisTurn: myTurn && me.falseTurn === this.turnNo,
            away: me.away,
            ready: me.ready,
            passTo: me.inGame && this.seats.length ? this.players.get(this.nextSeat(me.id))?.name : null,
            from: me.inGame && this.seats.length ? this.players.get(this.prevSeat(me.id))?.name : null,
          }
        : null,
      // The live stack shows hands in arrival order. No timer is shown while
      // stacking: noticing the hands is the whole point.
      stack: this.slams.map((s) => s.playerId),
      phaseMs,
      falseSlams: this.falseSlams.map((f) => f.playerId),
      lastResult: this.lastResult,
      gameResult: this.gameResult,
      notice: this.notice ? this.notice.text : null,
    };
  }
}
