import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, WORD, BOT_NAMES, AWAY_AFTER_MISSES, cleanText, cleanItems } from '../server/game.js';
import { PARTS, PART_KEYS, normalizeAvatar } from '../public/avatar-parts.js';

// Deterministic "random" for bots and starters: always the minimum / first candidate.
const fixedRand = (min) => min;

function setup(n = 3, opts = {}) {
  const room = new Room('TEST01', { rand: fixedRand, ...opts });
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(room.addPlayer({ name: `P${i}`, now: 0 }).player.id);
  return { room, ids, host: ids[0] };
}

function startPlaying(room, host, now = 0) {
  assert.deepEqual(room.startGame(host, now), { ok: true });
  room.tick(now + room.t.countdownMs);
  assert.equal(room.phase, 'playing');
  return now + room.t.countdownMs;
}

const label = (room, cid) => room.labels.get(cid);
const allChits = (room) => room.seats.flatMap((id) => room.players.get(id).hand);
const P = (room, id) => room.players.get(id);

// Rig a player's hand into a finished set by swapping chits with others (keeps totals intact).
function giveSet(room, id) {
  const p = P(room, id);
  const size = room.settings.setSize;
  const target = label(room, p.hand[0]);
  for (let slot = 1; slot < size; slot++) {
    if (label(room, p.hand[slot]) === target) continue;
    search: for (const other of room.seats) {
      const pile = P(room, other).hand;
      const j = pile.findIndex((cid, k) => label(room, cid) === target && !(pile === p.hand && k <= slot));
      if (j >= 0) {
        [p.hand[slot], pile[j]] = [pile[j], p.hand[slot]];
        break search;
      }
    }
  }
  assert.ok(room.hasSet(p), 'rigged set');
}

// Break any set a player happens to hold (swap one chit with a neighbour).
function breakSet(room, id) {
  const p = P(room, id);
  for (let tries = 0; tries < 20 && room.hasSet(p); tries++) {
    const setL = room.setLabel(p);
    const i = p.hand.findIndex((c) => label(room, c) === setL);
    for (const other of room.seats) {
      if (other === id) continue;
      const o = P(room, other);
      const j = o.hand.findIndex((c) => label(room, c) !== setL);
      if (j >= 0) {
        [p.hand[i], o.hand[j]] = [o.hand[j], p.hand[i]];
        break;
      }
    }
  }
  assert.equal(room.hasSet(p), false);
}

// Pass (least useful chit) until it is `id`'s turn.
function passUntil(room, id, now) {
  for (let guard = 0; room.turnId !== id; guard++) {
    assert.ok(guard < 20);
    const t = P(room, room.turnId);
    assert.deepEqual(room.pass(t.id, room.pickDiscard(t), now), { ok: true });
  }
}

test('cleanText strips control/bidi chars, keeps Indic joiners, limits length', () => {
  assert.equal(cleanText('  Kutty‮  ', 16), 'Kutty');
  assert.equal(cleanText('a\u0000b', 16), 'a b');
  assert.equal(cleanText('ന്‍', 16), 'ന്‍'); // Malayalam chillu with ZWJ survives
  assert.equal(cleanText('x'.repeat(40), 16).length, 16);
  assert.equal(cleanText(42, 16), '');
});

test('cleanItems dedupes case-insensitively and drops blanks', () => {
  assert.deepEqual(cleanItems('Idli\nidli\n\n  Dosa \nVada'), ['Idli', 'Dosa', 'Vada']);
  assert.equal(cleanItems(Array.from({ length: 100 }, (_, i) => `w${i}`)).length, 40);
});

test('needs 3 players and enough chit words to start', () => {
  const { room, host } = setup(2);
  assert.match(room.startGame(host, 0).error, /at least 3/);
  room.addPlayer({ name: 'P2', now: 0 });
  room.updateSettings(host, { packId: 'custom', customItems: 'A\nB' });
  assert.match(room.startGame(host, 0).error, /different chits/);
  room.updateSettings(host, { customItems: 'A\nB\nC' });
  assert.deepEqual(room.startGame(host, 0), { ok: true });
});

test('only the host can start, change settings, add bots or kick', () => {
  const { room, ids } = setup(3);
  assert.ok(room.startGame(ids[1], 0).error);
  assert.ok(room.updateSettings(ids[1], { setSize: 4 }).error);
  assert.ok(room.addBot(ids[1]).error);
  assert.ok(room.kick(ids[1], ids[2]).error);
});

test('settings: turn timer and bot speed only accept known values', () => {
  const { room, host } = setup(3);
  assert.ok(room.updateSettings(host, { turnSecs: 20, botSpeed: 'fast' }).ok);
  assert.equal(room.settings.turnSecs, 20);
  assert.equal(room.settings.botSpeed, 'fast');
  room.updateSettings(host, { turnSecs: 1, botSpeed: '__proto__' });
  assert.equal(room.settings.turnSecs, 20);
  assert.equal(room.settings.botSpeed, 'fast');
});

test('deal: each word on setSize chits plus one extra; the starter holds one more; nobody starts with a set', () => {
  for (const setSize of [3, 4]) {
    for (let run = 0; run < 30; run++) {
      const { room, host } = setup(5, { rand: undefined });
      room.updateSettings(host, { setSize });
      room.startGame(host, 0);
      assert.equal(allChits(room).length, 5 * setSize + 1);
      const counts = new Map();
      for (const cid of allChits(room)) counts.set(label(room, cid), (counts.get(label(room, cid)) || 0) + 1);
      assert.equal(counts.size, 5);
      assert.deepEqual([...counts.values()].sort(), [...Array(4).fill(setSize), setSize + 1].sort());
      assert.ok(room.seats.includes(room.turnId), 'a starter is chosen');
      for (const id of room.seats) {
        assert.equal(P(room, id).hand.length, id === room.turnId ? setSize + 1 : setSize);
        assert.equal(room.hasSet(P(room, id)), false);
      }
    }
  }
});

test('turns: only the player whose turn it is can pass; the chit goes to the next seat and it becomes their turn', () => {
  const { room, ids, host } = setup(3);
  room.startGame(host, 0);
  assert.match(room.pass(ids[0], P(room, ids[0]).hand[0], 0).error, /Not now/);
  const now = room.t.countdownMs;
  room.tick(now);
  assert.equal(room.phase, 'playing');
  assert.equal(room.turnId, ids[0]);
  const before = allChits(room).length;
  const [a, b, c] = ids.map((id) => P(room, id));

  assert.match(room.pass(b.id, b.hand[0], now).error, /Wait for your turn/);
  assert.match(room.pass(a.id, b.hand[0], now).error, /isn't in your hand/);

  const chit = a.hand[0];
  assert.deepEqual(room.pass(a.id, chit, now), { ok: true });
  assert.equal(a.hand.length, 3);
  assert.equal(b.hand.length, 4);
  assert.equal(b.newChit, chit);
  assert.equal(room.turnId, b.id);
  assert.match(room.pass(a.id, a.hand[0], now).error, /Wait for your turn/);

  room.pass(b.id, b.hand[0], now);
  room.pass(c.id, c.hand[0], now);
  assert.equal(room.turnId, a.id, 'back round the circle');
  assert.equal(allChits(room).length, before);

  const view = room.view(a.id, now);
  assert.equal(view.you.myTurn, true);
  assert.equal(view.you.hand.filter((x) => x.new).length, 1);
  assert.equal(room.view(b.id, now).you.myTurn, false);
});

test('BOOST only on your turn; a false slam costs 1 point (floor 0), once per turn, and you still pass', () => {
  const { room, ids, host } = setup(3);
  const now = startPlaying(room, host);
  const a = P(room, ids[0]);
  const b = P(room, ids[1]);
  giveSet(room, ids[1]);
  assert.match(room.slam(b.id, now).error, /only BOOST on your turn/);
  assert.equal(room.phase, 'playing');

  breakSet(room, ids[0]);
  a.score = 2;
  assert.equal(room.slam(a.id, now).falseSlam, true);
  assert.equal(a.score, 1);
  assert.equal(room.phase, 'playing');
  assert.equal(room.turnId, a.id, 'still your turn');
  assert.match(room.slam(a.id, now + 10).error, /pass a chit/);
  assert.equal(a.score, 1, 'no double penalty');
  assert.equal(room.view(a.id, now).you.falseThisTurn, true);
  assert.ok(room.pass(a.id, a.hand[0], now + 20).ok);

  // floor at 0
  const { room: r2, ids: i2, host: h2 } = setup(3);
  const n2 = startPlaying(r2, h2);
  breakSet(r2, i2[0]);
  P(r2, i2[0]).score = 0;
  r2.slam(i2[0], n2);
  assert.equal(P(r2, i2[0]).score, 0);
});

test('a real BOOST starts the stack; others slam on top in any order; order = points; last gets a letter', () => {
  const { room, ids, host } = setup(4);
  const now = startPlaying(room, host);
  passUntil(room, ids[2], now);
  giveSet(room, ids[2]);
  const setL = room.setLabel(P(room, ids[2]));
  assert.ok(room.slam(ids[2], now).ok);
  assert.equal(room.phase, 'stacking');
  assert.equal(room.boosterId, ids[2]);
  assert.equal(room.view(ids[0], now).turnId, null, 'turns stop');
  // stackers don't need a set or a turn
  assert.ok(room.slam(ids[0], now + 300).ok);
  assert.ok(room.slam(ids[3], now + 500).ok);
  assert.match(room.pass(ids[1], P(room, ids[1]).hand[0], now + 600).error, /slam/);
  assert.match(room.slam(ids[0], now + 650).error, /down already/);
  assert.ok(room.slam(ids[1], now + 900).ok);
  assert.equal(room.phase, 'roundEnd');
  const r = room.lastResult;
  assert.deepEqual(r.placements.map((x) => x.playerId), [ids[2], ids[0], ids[3], ids[1]]);
  assert.deepEqual(r.placements.map((x) => x.points), [3, 2, 1, 0]);
  assert.deepEqual(r.placements.map((x) => x.letter), [false, false, false, true]);
  assert.equal(P(room, ids[1]).letters, 1);
  assert.equal(r.boosterLabel, setL);
});

test('stragglers who never slam all get a letter when the stack times out', () => {
  const { room, ids, host } = setup(4);
  const now = startPlaying(room, host);
  giveSet(room, ids[0]);
  room.slam(ids[0], now);
  room.slam(ids[1], now + 100);
  room.tick(now + room.t.stackTimeoutMs - 1);
  assert.equal(room.phase, 'stacking');
  room.tick(now + room.t.stackTimeoutMs);
  assert.equal(room.phase, 'roundEnd');
  const missing = room.lastResult.placements.filter((x) => !x.slammed);
  assert.equal(missing.length, 2);
  assert.ok(missing.every((x) => x.letter && x.points === 0));
});

test('latency compensation can reorder near-simultaneous stack slams (capped); the BOOST stays first', () => {
  const { room, ids, host } = setup(4);
  const now = startPlaying(room, host);
  giveSet(room, ids[0]);
  P(room, ids[1]).rtt = 40; // fast connection
  P(room, ids[2]).rtt = 400; // slow connection: credited 150ms max
  room.slam(ids[0], now + 900);
  room.slam(ids[1], now + 1000);
  room.slam(ids[2], now + 1100); // tapped ~150ms earlier really -> 950 < 980
  room.slam(ids[3], now + 2000);
  assert.deepEqual(room.lastResult.placements.map((x) => x.playerId), [ids[0], ids[2], ids[1], ids[3]]);
});

test('next round waits for Ready; whoever got the letter starts it', () => {
  const { room, ids, host } = setup(3);
  let now = startPlaying(room, host);
  giveSet(room, ids[0]);
  room.slam(ids[0], now);
  room.slam(ids[2], now + 10);
  room.slam(ids[1], now + 20); // P1 last
  assert.equal(room.phase, 'roundEnd');
  room.ready(ids[0], now);
  room.ready(ids[1], now);
  room.tick(now + 100);
  assert.equal(room.phase, 'roundEnd', 'still waiting for P2');
  assert.equal(room.view(ids[0], now).players.find((p) => p.id === ids[2]).ready, false);
  room.ready(ids[2], now + 200);
  assert.equal(room.phase, 'countdown');
  assert.equal(room.round, 2);
  assert.equal(room.turnId, ids[1], 'the last hand starts');
  assert.equal(P(room, ids[1]).hand.length, 4);
});

test('with friends, the results screen moves on by itself after the wait', () => {
  const { room, ids, host } = setup(3);
  const now = startPlaying(room, host);
  giveSet(room, ids[0]);
  room.slam(ids[0], now);
  room.tick(now + room.t.stackTimeoutMs);
  const end = now + room.t.stackTimeoutMs;
  assert.equal(room.phase, 'roundEnd');
  assert.ok(room.view(ids[1], end).phaseMs > 0, 'a countdown is shown');
  room.tick(end + room.t.readyTimeoutMs - 1);
  assert.equal(room.phase, 'roundEnd');
  room.tick(end + room.t.readyTimeoutMs);
  assert.equal(room.phase, 'countdown');
});

test('turn timer with friends: time runs out -> auto-pass; twice in a row -> away with short turns; any action clears it', () => {
  const { room, ids, host } = setup(3);
  let now = startPlaying(room, host);
  const a = P(room, ids[0]);
  const ms = room.settings.turnSecs * 1000;
  assert.equal(room.view(ids[0], now).turnMs, ms);
  room.tick(now + ms - 1);
  assert.equal(room.turnId, ids[0]);
  room.tick(now + ms);
  assert.equal(room.turnId, ids[1], 'auto-passed');
  assert.equal(a.hand.length, 3);
  assert.equal(a.missed, 1);
  assert.equal(a.slammed, false);
  now += ms;
  // round the circle with quick passes, then let it run out again
  passUntil(room, ids[0], now);
  room.tick(now + ms);
  assert.equal(a.away, true);
  assert.equal(a.missed, AWAY_AFTER_MISSES);
  now += ms;
  passUntil(room, ids[0], now);
  assert.equal(room.turnTotalMs, room.t.awayTurnMs, 'away players get short turns');
  room.here(ids[0]);
  assert.equal(a.away, false);
  assert.equal(a.missed, 0);
});

test('alone with bots: there is no turn timer and the game never moves on without you', () => {
  const room = new Room('SOLO01');
  const me = room.addPlayer({ name: 'Me', now: 0 }).player.id;
  for (let i = 0; i < 3; i++) room.addBot(me);
  room.startGame(me, 0);
  let now = 0;
  for (let i = 0; i < 6000; i++) {
    now += 100; // ten simulated minutes, and I never touch anything
    room.tick(now);
  }
  assert.equal(room.round, 1, 'still the first round');
  assert.ok(room.phase === 'roundEnd' || (room.phase === 'playing' && room.turnId === me), room.phase);
  assert.equal(room.view(me, now).turnMs, null);
  assert.equal(room.view(me, now).phaseMs, null);
  assert.equal(P(room, me).away, false);
});

test('bots play a full round with a human who takes their turns', () => {
  for (const botSpeed of ['relaxed', 'normal', 'fast']) {
    const room = new Room('BOTS01');
    const host = room.addPlayer({ name: 'Host', now: 0 }).player.id;
    for (let i = 0; i < 3; i++) room.addBot(host);
    room.updateSettings(host, { botSpeed });
    room.startGame(host, 0);
    let now = 0;
    const hostP = P(room, host);
    for (let i = 0; i < 5000 && room.phase !== 'roundEnd'; i++) {
      now += 100;
      room.tick(now);
      if (room.phase === 'playing' && room.turnId === host) {
        if (room.hasSet(hostP)) room.slam(host, now);
        else room.pass(host, room.pickDiscard(hostP), now);
      }
      if (room.phase === 'stacking' && !hostP.slammed && i % 30 === 0) room.slam(host, now);
    }
    assert.equal(room.phase, 'roundEnd', botSpeed);
    assert.equal(room.lastResult.placements.length, 4);
  }
});

test('disconnected player: autopilot passes on their turn but never slams; leaving mid-round keeps the seat until round end', () => {
  const { room, ids, host } = setup(3);
  let now = startPlaying(room, host);
  room.setConnected(ids[1], false, now);
  room.pass(ids[0], room.pickDiscard(P(room, ids[0])), now);
  assert.equal(room.turnId, ids[1]);
  giveSet(room, ids[1]);
  room.tick(now + 1);
  room.tick(now + room.t.autopilotPassMs + 2);
  assert.equal(room.turnId, ids[2], 'autopilot passed');
  assert.equal(P(room, ids[1]).slammed, false);
  assert.equal(room.phase, 'playing', 'autopilot never boosts');
  now += room.t.autopilotPassMs + 2;

  room.removePlayer(ids[2], now);
  assert.ok(room.players.has(ids[2]), 'seat kept mid-round');
  assert.equal(P(room, ids[2]).leaving, true);
  room.tick(now + room.t.autopilotPassMs + 1);
  assert.equal(room.turnId, ids[0]);
  now += room.t.autopilotPassMs + 1;
  giveSet(room, ids[0]);
  room.slam(ids[0], now);
  // nobody left who can slam -> round ends on the next tick
  room.tick(now + 1);
  assert.equal(room.phase, 'roundEnd');
  room.ready(ids[0], now + 2);
  // only 2 players remain -> game stops and goes back to the lobby
  assert.equal(room.players.has(ids[2]), false);
  assert.equal(room.phase, 'lobby');
  assert.match(room.notice.text, /at least 3/);
});

test('spelling the whole word ends the game; winner has most points; rematch resets', () => {
  const { room, ids, host } = setup(3);
  let now = startPlaying(room, host);
  for (let round = 1; round <= WORD.length; round++) {
    passUntil(room, ids[0], now);
    giveSet(room, ids[0]);
    room.slam(ids[0], now);
    room.slam(ids[1], now + 10);
    room.slam(ids[2], now + 20); // P2 always last
    if (round === WORD.length) break;
    assert.equal(room.phase, 'roundEnd');
    for (const id of ids) room.ready(id, now + 30);
    now += 1000;
    room.tick(now + room.t.countdownMs);
    now += room.t.countdownMs;
  }
  assert.equal(room.phase, 'gameOver');
  assert.deepEqual(room.gameResult.boostedIds, [ids[2]]);
  assert.equal(room.gameResult.winnerId, ids[0]);
  assert.deepEqual(room.startGame(host, now), { ok: true });
  assert.equal(P(room, ids[0]).score, 0);
  assert.equal(P(room, ids[2]).letters, 0);
});

test('privacy: a view only contains your own chit labels', () => {
  const { room, ids, host } = setup(3);
  const now = startPlaying(room, host);
  const view = room.view(ids[1], now);
  const json = JSON.stringify(view);
  const mine = new Set(P(room, ids[1]).hand.map((c) => label(room, c)));
  for (const id of [ids[0], ids[2]]) {
    for (const cid of P(room, id).hand) {
      assert.ok(!json.includes(cid), 'no foreign chit ids');
      const l = label(room, cid);
      if (!mine.has(l)) assert.ok(!json.includes(`"${l}"`), `foreign label ${l} leaked`);
    }
  }
  assert.ok(!json.includes(P(room, ids[0]).token), 'no tokens');
  assert.equal(view.you.hand.length, 3);
});

test('no timer is exposed while hands are stacking', () => {
  const { room, ids, host } = setup(3);
  const now = startPlaying(room, host);
  giveSet(room, ids[0]);
  room.slam(ids[0], now);
  const v = room.view(ids[1], now);
  assert.equal(v.phaseMs, null);
  assert.equal(v.turnMs, null);
  assert.deepEqual(v.stack, [ids[0]]);
});

test('characters: everyone gets a random valid look; changes are checked and only allowed between games', () => {
  const { room, ids, host } = setup(3);
  for (const id of ids) assert.deepEqual(normalizeAvatar(P(room, id).avatar), P(room, id).avatar);
  const look = { skin: 2, hair: 3, hairColor: 0, eyes: 1, face: 0, extra: 4 };
  assert.ok(room.setAvatar(ids[1], { ...look, evil: '<script>' }).ok);
  assert.deepEqual(P(room, ids[1]).avatar, look, 'unknown keys dropped');
  for (const bad of [null, 3, 'x', [], { ...look, hair: 99 }, { ...look, skin: -1 }, { ...look, eyes: 1.5 }, { skin: 0 }]) {
    assert.ok(room.setAvatar(ids[1], bad).error, JSON.stringify(bad));
  }
  assert.ok(room.setAvatar(ids[1], { ...look, hair: PARTS.hair.length - 1 }).ok);
  startPlaying(room, host);
  assert.match(room.setAvatar(ids[1], look).error, /between games/);
  for (const k of PART_KEYS) assert.ok(Number.isInteger(P(room, ids[2]).avatar[k]));
});

test('bots get ordinary random names, never repeated in a room', () => {
  const room = new Room('NAMES2');
  const host = room.addPlayer({ name: 'Host' }).player.id;
  for (let i = 0; i < 7; i++) assert.ok(room.addBot(host).player);
  const names = [...room.players.values()].filter((p) => p.isBot).map((p) => p.name);
  assert.equal(new Set(names).size, 7);
  for (const n of names) assert.ok(BOT_NAMES.includes(n), n);
  for (const title of ['Paati', 'Thatha', 'Kutty', 'Anna', 'Akka', 'Machan', 'Chechi', 'Mama']) {
    assert.ok(!BOT_NAMES.includes(title));
  }
});

test('host role moves on when the host leaves', () => {
  const { room, ids, host } = setup(3);
  room.removePlayer(host, 0);
  assert.equal(room.hostId, ids[1]);
});

test('room lock is host-only and toggleable mid-game', () => {
  const { room, ids, host } = setup(3);
  startPlaying(room, host);
  assert.ok(room.updateSettings(host, { locked: true }).ok);
  assert.equal(room.settings.locked, true);
  assert.ok(room.updateSettings(host, { setSize: 4 }).error, 'game settings frozen mid-game');
  assert.ok(room.updateSettings(ids[1], { locked: false }).error);
});

test('duplicate nicknames get a number; max 8 players', () => {
  const room = new Room('NAMES1');
  room.addPlayer({ name: 'Anna' });
  assert.equal(room.addPlayer({ name: 'anna' }).player.name, 'anna 2');
  for (let i = 0; i < 6; i++) room.addPlayer({ name: `x${i}` });
  assert.match(room.addPlayer({ name: 'late' }).error, /full/);
  assert.match(new Room('X').addPlayer({ name: '   ' }).error, /nickname/);
});
