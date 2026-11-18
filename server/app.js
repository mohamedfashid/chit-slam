// HTTP + WebSocket server. Holds rooms in memory only: nothing is written to
// disk, there are no accounts, and a room disappears once everyone has left.

import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room } from './game.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const CODE_LEN = 6;
const MAX_ROOMS = 1000;
const TICK_MS = 100;
const PING_MS = 2000;
const IDLE_ROOM_MS = 5 * 60 * 1000; // delete a room nobody is connected to after this
const JOIN_LIMIT = { max: 20, windowMs: 60_000 }; // create/join attempts per IP
const EVENT_BUCKET = { capacity: 40, perSecond: 20 }; // per-socket flood guard

function securityHeaders(req, res, next) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
      "font-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  );
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
}

export function createGameServer({ timing, trustProxy = false, allowedOrigins = [] } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.get('/healthz', (req, res) => res.type('text').send('ok'));
  app.use(express.static(PUBLIC_DIR, { maxAge: 0 }));

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    maxHttpBufferSize: 16_000,
    pingInterval: 10_000,
    pingTimeout: 8_000,
    // Only accept browser connections from our own page (stops other sites from
    // opening sockets into rooms). Non-browser clients send no Origin.
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      if (!origin) return cb(null, true);
      try {
        const host = new URL(origin).host;
        cb(null, host === req.headers.host || allowedOrigins.includes(origin));
      } catch {
        cb(null, false);
      }
    },
  });

  const rooms = new Map(); // code -> Room
  const sockets = new Map(); // playerId -> socket
  const idleSince = new Map(); // code -> time the last human disconnected
  const joinAttempts = new Map(); // ipHash -> { count, resetAt }
  const salt = randomBytes(16); // per-process; IPs are never stored in the clear

  // Behind a proxy, find the visitor's real address. Checked live on Render:
  // Cloudflare sets CF-Connecting-IP to the real address and refuses (403) any
  // request that tries to send its own; True-Client-IP is overwritten too.
  // X-Forwarded-For is only a fallback: a visitor's fake value is kept at the
  // front ("fake, real, cloudflare, render-internal").
  const clientIp = (socket) => {
    if (trustProxy) {
      const h = socket.handshake.headers;
      for (const name of ['cf-connecting-ip', 'true-client-ip']) {
        if (typeof h[name] === 'string' && h[name].trim()) return h[name].trim();
      }
      const fwd = h['x-forwarded-for'];
      if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
    }
    return socket.handshake.address || '';
  };
  const ipHash = (socket, scope = '') => createHash('sha256').update(salt).update(scope).update(clientIp(socket)).digest('hex');

  function newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LEN; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
  }

  function joinAllowed(socket) {
    const key = ipHash(socket, 'join');
    const now = Date.now();
    const entry = joinAttempts.get(key);
    if (!entry || now > entry.resetAt) {
      joinAttempts.set(key, { count: 1, resetAt: now + JOIN_LIMIT.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= JOIN_LIMIT.max;
  }

  function broadcast(room) {
    const now = Date.now();
    for (const id of room.players.keys()) {
      const s = sockets.get(id);
      if (s && s.data.playerId === id) s.emit('state', room.view(id, now));
    }
    room.dirty = false;
  }

  function deleteRoom(code) {
    const room = rooms.get(code);
    if (!room) return;
    for (const id of room.players.keys()) {
      const s = sockets.get(id);
      if (s) s.data = {};
      sockets.delete(id);
    }
    rooms.delete(code);
    idleSince.delete(code);
  }

  function unbind(socket) {
    const { playerId } = socket.data || {};
    if (playerId && sockets.get(playerId) === socket) sockets.delete(playerId);
    socket.data = {};
  }

  function bind(socket, room, player) {
    leaveCurrent(socket);
    const old = sockets.get(player.id);
    if (old && old !== socket) {
      old.emit('kicked', { reason: 'You opened this room in another tab.' });
      old.data = {};
    }
    socket.data = { code: room.code, playerId: player.id };
    sockets.set(player.id, socket);
    idleSince.delete(room.code);
  }

  function current(socket) {
    const { code, playerId } = socket.data || {};
    const room = code && rooms.get(code);
    if (!room || !room.players.has(playerId)) return {};
    return { room, playerId };
  }

  function leaveCurrent(socket) {
    const { room, playerId } = current(socket);
    unbind(socket);
    if (!room) return;
    room.removePlayer(playerId);
    if (room.isAbandoned()) deleteRoom(room.code);
    else broadcast(room);
  }

  io.on('connection', (socket) => {
    socket.data = {};
    let tokens = EVENT_BUCKET.capacity;
    let last = Date.now();
    const allow = () => {
      const now = Date.now();
      tokens = Math.min(EVENT_BUCKET.capacity, tokens + ((now - last) / 1000) * EVENT_BUCKET.perSecond);
      last = now;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    };

    // Wrap every handler: flood guard, safe ack, never let a bad payload crash us.
    const on = (event, handler) => {
      socket.on(event, (...args) => {
        const ack = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
        if (!allow()) return ack({ error: 'Slow down a little!' });
        try {
          handler(args[0] ?? {}, ack);
        } catch (err) {
          console.error('handler error', event, err?.message);
          ack({ error: 'Something went wrong.' });
        }
      });
    };

    on('create', (data, ack) => {
      if (!joinAllowed(socket)) return ack({ error: 'Too many attempts. Wait a minute.' });
      if (rooms.size >= MAX_ROOMS) return ack({ error: 'Server is busy. Try again soon.' });
      const room = new Room(newCode(), { timing });
      const res = room.addPlayer({ name: data.name });
      if (res.error) return ack(res);
      rooms.set(room.code, room);
      bind(socket, room, res.player);
      ack({ ok: true, code: room.code, token: res.player.token, playerId: res.player.id });
      broadcast(room);
    });

    on('join', (data, ack) => {
      const code = typeof data.code === 'string' ? data.code.trim().toUpperCase() : '';
      const room = rooms.get(code);
      // Reconnecting with a valid seat token doesn't count against the limit.
      const existing = room?.findByToken(data.token);
      if (existing) {
        room.setConnected(existing.id, true);
        bind(socket, room, existing);
        ack({ ok: true, code, token: existing.token, playerId: existing.id });
        return broadcast(room);
      }
      if (!joinAllowed(socket)) return ack({ error: 'Too many attempts. Wait a minute.' });
      if (!room) return ack({ error: 'Room not found. Check the code.' });
      if (room.settings.locked) return ack({ error: 'The host has locked this room.' });
      const res = room.addPlayer({ name: data.name });
      if (res.error) return ack(res);
      bind(socket, room, res.player);
      ack({ ok: true, code, token: res.player.token, playerId: res.player.id });
      broadcast(room);
    });

    on('leave', (_data, ack) => {
      leaveCurrent(socket);
      ack({ ok: true });
    });

    // Host / player actions that just call into the room and broadcast.
    const roomAction = (event, fn) =>
      on(event, (data, ack) => {
        const { room, playerId } = current(socket);
        if (!room) return ack({ error: 'You are not in a room.' });
        const res = fn(room, playerId, data) || { ok: true };
        ack(res);
        if (room.dirty) broadcast(room);
      });

    roomAction('settings', (room, id, data) => room.updateSettings(id, data));
    roomAction('addBot', (room, id) => room.addBot(id));
    roomAction('avatar', (room, id, data) => room.setAvatar(id, data.avatar));
    roomAction('start', (room, id) => room.startGame(id));
    roomAction('lobby', (room, id) => room.backToLobby(id));
    roomAction('pass', (room, id, data) => room.pass(id, data.chitId));
    roomAction('slam', (room, id) => room.slam(id));
    roomAction('ready', (room, id) => room.ready(id));
    roomAction('here', (room, id) => room.here(id));
    roomAction('kick', (room, id, data) => {
      const res = room.kick(id, data.playerId);
      if (res.ok) {
        const s = sockets.get(data.playerId);
        if (s) {
          s.emit('kicked', { reason: 'The host removed you from the room.' });
          unbind(s);
        }
      }
      return res.error ? res : { ok: true };
    });

    socket.on('disconnect', () => {
      const { room, playerId } = current(socket);
      if (!room) return;
      if (sockets.get(playerId) === socket) {
        sockets.delete(playerId);
        room.setConnected(playerId, false);
        broadcast(room);
      }
    });
  });

  const tickTimer = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      room.tick(now);
      if (room.isAbandoned()) {
        deleteRoom(code);
        continue;
      }
      if (!room.hasConnectedHuman()) {
        if (!idleSince.has(code)) idleSince.set(code, now);
        else if (now - idleSince.get(code) > IDLE_ROOM_MS) {
          deleteRoom(code);
          continue;
        }
      } else idleSince.delete(code);
      if (room.dirty) broadcast(room);
    }
    for (const [key, entry] of joinAttempts) if (now > entry.resetAt) joinAttempts.delete(key);
  }, TICK_MS);

  // Measure each player's round-trip time; half of it is credited back on a slam.
  const pingTimer = setInterval(() => {
    for (const [playerId, socket] of sockets) {
      const { room } = current(socket);
      const player = room?.players.get(playerId);
      if (!player) continue;
      const t0 = Date.now();
      socket.timeout(3000).emit('p', (err) => {
        if (err) return;
        const rtt = Date.now() - t0;
        player.rtt = player.rtt ? player.rtt * 0.7 + rtt * 0.3 : rtt;
      });
    }
  }, PING_MS);

  return {
    app,
    httpServer,
    io,
    rooms,
    listen(port = 0, host) {
      return new Promise((resolve) => httpServer.listen(port, host, () => resolve(httpServer.address().port)));
    },
    close() {
      clearInterval(tickTimer);
      clearInterval(pingTimer);
      return new Promise((resolve) => io.close(() => resolve()));
    },
  };
}
