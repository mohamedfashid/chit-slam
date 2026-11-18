// Starts the real server and plays through it with 3 socket clients.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createGameServer } from '../server/app.js';

let server;
let url;
const clients = [];

before(async () => {
  server = createGameServer({ timing: { countdownMs: 200, resultsMs: 300, stackTimeoutMs: 1500 } });
  const port = await server.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${port}`;
});

after(async () => {
  for (const c of clients) c.socket.disconnect();
  await server.close();
});

function client() {
  const socket = connect(url, { transports: ['websocket'], forceNew: true });
  const c = { socket, state: null, waiters: [] };
  socket.on('state', (st) => {
    c.state = st;
    c.waiters = c.waiters.filter((w) => !(w.pred(st) && (w.resolve(st), true)));
  });
  socket.on('p', (cb) => cb());
  c.emit = (event, data = {}) => new Promise((resolve) => socket.emit(event, data, resolve));
  c.waitFor = (pred, ms = 4000) =>
    new Promise((resolve, reject) => {
      if (c.state && pred(c.state)) return resolve(c.state);
      const timer = setTimeout(() => reject(new Error('timed out waiting for state')), ms);
      c.waiters.push({ pred, resolve: (st) => (clearTimeout(timer), resolve(st)) });
    });
  clients.push(c);
  return c;
}

test('security headers are set on the page', async () => {
  const res = await fetch(url + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('x-powered-by'), null);
  const io = await fetch(url + '/socket.io/socket.io.min.js');
  assert.equal(io.status, 200, 'socket.io client served from our own origin');
});

test('sockets from a foreign origin are refused', async () => {
  const bad = connect(url, { transports: ['websocket'], forceNew: true, extraHeaders: { Origin: 'https://evil.example' } });
  const outcome = await new Promise((resolve) => {
    bad.on('connect', () => resolve('connected'));
    bad.on('connect_error', () => resolve('refused'));
  });
  bad.disconnect();
  assert.equal(outcome, 'refused');
});

test('three players: create, join, play a round to the end', async () => {
  const a = client();
  const b = client();
  const c = client();

  const created = await a.emit('create', { name: 'Amma' });
  assert.ok(created.ok, JSON.stringify(created));
  assert.match(created.code, /^[A-Z0-9]{6}$/);

  assert.ok((await b.emit('join', { code: created.code, name: 'Appa' })).ok);
  assert.equal((await c.emit('join', { code: 'ZZZZZZ', name: 'Kutty' })).error, 'Room not found. Check the code.');
  assert.ok((await c.emit('join', { code: created.code.toLowerCase(), name: 'Kutty' })).ok);

  await a.waitFor((st) => st.players.length === 3);
  assert.equal(a.state.hostId, a.state.youId);

  // non-host can't start
  assert.ok((await b.emit('start')).error);
  assert.deepEqual(await a.emit('start'), { ok: true });

  const players = [a, b, c];
  await Promise.all(players.map((p) => p.waitFor((st) => st.phase === 'playing')));

  // Each client sees only its own chits: the starter holds 4, everyone else 3.
  const sizes = players.map((p) => p.state.you.hand.length).sort();
  assert.deepEqual(sizes, [3, 3, 4]);
  const starter = players.find((p) => p.state.you.myTurn);
  assert.ok(starter, 'someone has the first turn');

  // Out of turn: passing and slamming are refused.
  const idle = players.find((p) => !p.state.you.myTurn);
  assert.match((await idle.emit('pass', { chitId: idle.state.you.hand[0].id })).error, /your turn/);
  assert.match((await idle.emit('slam')).error, /your turn/);

  // Play: on your turn pass the chit you have fewest of, or BOOST with a set; stack when a hand goes down.
  let done = false;
  const loop = async (p) => {
    let actedOn = -1;
    while (!done) {
      const st = p.state;
      if (st.phase === 'roundEnd' || st.phase === 'gameOver') break;
      if (st.phase === 'stacking' && !st.you.slammed) {
        await p.emit('slam');
      } else if (st.phase === 'playing' && st.you.myTurn && actedOn !== st.turnNo) {
        actedOn = st.turnNo;
        const counts = {};
        for (const ch of st.you.hand) counts[ch.label] = (counts[ch.label] || 0) + 1;
        if (Object.values(counts).some((n) => n >= 3)) {
          await p.emit('slam');
        } else {
          const min = Math.min(...Object.values(counts));
          const chit = st.you.hand.find((ch) => counts[ch.label] === min);
          assert.deepEqual(await p.emit('pass', { chitId: chit.id }), { ok: true });
        }
      }
      await new Promise((r) => setTimeout(r, 15));
    }
  };
  await Promise.race([
    Promise.all(players.map(loop)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('round never ended')), 15000)),
  ]).finally(() => {
    done = true;
  });

  const st = await a.waitFor((s) => s.phase === 'roundEnd' || s.phase === 'gameOver');
  const r = st.lastResult;
  assert.equal(r.placements.length, 3);
  assert.equal(r.placements[0].playerId, r.boosterId);
  assert.ok(r.placements.some((x) => x.letter));

  if (st.phase === 'gameOver') return;
  // next round starts once everyone taps Ready; the last hand starts it
  assert.deepEqual(await a.emit('ready'), { ok: true });
  assert.deepEqual(await b.emit('ready'), { ok: true });
  assert.equal(a.state.phase, 'roundEnd', 'still waiting for the third player');
  assert.deepEqual(await c.emit('ready'), { ok: true });
  const next = await a.waitFor((s) => s.phase === 'countdown' && s.round === 2);
  assert.ok(r.placements.some((x) => x.letter && x.playerId === next.turnId), 'a last hand starts');
});

test('refresh: rejoining with the seat token returns the same seat', async () => {
  const a = client();
  const res = await a.emit('create', { name: 'Thatha' });
  const playerId = res.playerId;
  a.socket.disconnect();

  const again = client();
  const back = await again.emit('join', { code: res.code, token: res.token, name: 'whatever' });
  assert.equal(back.playerId, playerId);
  const st = await again.waitFor((s) => s.players.length === 1);
  assert.equal(st.players[0].name, 'Thatha');
  assert.equal(st.hostId, playerId);
});

test('host lock keeps new people out; kick removes a player', async () => {
  const a = client();
  const b = client();
  const c = client();
  const { code } = await a.emit('create', { name: 'Host' });
  const joined = await b.emit('join', { code, name: 'Guest' });
  assert.ok(joined.ok);

  const kicked = new Promise((resolve) => b.socket.once('kicked', resolve));
  assert.deepEqual(await a.emit('kick', { playerId: joined.playerId }), { ok: true });
  assert.match((await kicked).reason, /removed/);
  await a.waitFor((s) => s.players.length === 1);

  await a.emit('settings', { locked: true });
  assert.match((await c.emit('join', { code, name: 'Stranger' })).error, /locked/);
});

test('behind Cloudflare, a faked X-Forwarded-For cannot dodge the join limit', async () => {
  const proxied = createGameServer({ trustProxy: true });
  const port = await proxied.listen(0, '127.0.0.1');
  const purl = `http://127.0.0.1:${port}`;
  let limited = 0;
  for (let i = 0; i < 24; i++) {
    const s = connect(purl, {
      transports: ['websocket'],
      forceNew: true,
      extraHeaders: { 'CF-Connecting-IP': '198.51.100.7', 'X-Forwarded-For': `203.0.113.${i + 1}, 10.0.0.1` },
    });
    const r = await new Promise((resolve) => s.emit('join', { code: 'ZZZZZZ', name: 'x' }, resolve));
    if (/Too many/.test(r.error || '')) limited++;
    s.disconnect();
  }
  await proxied.close();
  assert.equal(limited, 4, 'attempts 21-24 are refused');
});

test('bad payloads are rejected without crashing the server', async () => {
  const a = client();
  await a.emit('create', { name: 'Tester' });
  for (const payload of [null, 42, 'x', { chitId: { $gt: '' } }, { name: '<img src=x onerror=alert(1)>' }]) {
    const r = await a.emit('pass', payload);
    assert.ok(r.error);
  }
  const r = await a.emit('settings', { packId: '__proto__', setSize: 99, customItems: 12345, turnSecs: -5, botSpeed: 'constructor' });
  assert.ok(r.ok);
  const st = await a.waitFor(() => true);
  assert.equal(st.settings.setSize, 3);
  assert.notEqual(st.settings.packId, '__proto__');
  assert.equal(st.settings.turnSecs, 15);
  assert.equal(st.settings.botSpeed, 'relaxed');
  for (const avatar of [null, 'x', { skin: 999 }, { __proto__: { skin: 1 } }]) {
    assert.ok((await a.emit('avatar', { avatar })).error);
  }
  assert.ok((await a.emit('ready')).error, 'ready outside the results screen');
  // names are stored as plain text (rendered with textContent on the client)
  const b = client();
  const res = await b.emit('create', { name: '<b>x</b>' });
  assert.ok(res.ok);
});
