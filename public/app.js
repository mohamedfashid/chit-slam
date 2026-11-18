// Chit Slam - browser client. The server is the referee; this file only shows
// what the server says and sends taps. All player text goes in via textContent.

import * as sfx from './sound.js';
import { avatarSVG } from './characters.js';
import { PARTS, PART_KEYS, PART_TITLES, randomAvatar } from './avatar-parts.js';
import { renderTable, renderPile, flyChit, bump, setTurnRing } from './table.js';

const $ = (sel) => document.querySelector(sel);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, sv);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

// Storage can be blocked (private mode etc.) - the game works without it.
const store = {
  get(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch { /* ignore */ }
  },
  del(k) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  },
};

const randInt = (n) => Math.floor(Math.random() * n);

// A small character face for lists and results.
function miniAv(avatar, color, cls = 'mini-av') {
  const span = h('span', { class: cls });
  span.innerHTML = avatarSVG(avatar, color); // our own SVG; no player text inside
  return span;
}

const S = {
  code: null,
  state: null,
  deadline: 0, // performance.now() when the shown phase timer hits zero
  turnDeadline: 0, // performance.now() when the current turn runs out (0 = no limit)
  turnTotal: 0,
  myTurnSince: 0, // performance.now() when my current turn began
  passedTurn: -1, // turnNo I already passed on (one pass per turn)
  look: null, // my character while a change is on its way to the server
  flash: null, // { text, until, big }
  muted: store.get('cs.muted') === '1',
};
sfx.setMuted(S.muted);

// eslint-disable-next-line no-undef
const socket = io({ transports: ['websocket', 'polling'] });

function send(event, data = {}) {
  return new Promise((resolve) => {
    socket.timeout(6000).emit(event, data, (err, res) => resolve(err ? { error: 'Connection problem - try again.' } : res || {}));
  });
}

// ---------- seat memory (so a refresh or a dropped connection rejoins your seat) ----------

function savedSeat() {
  try {
    const seat = JSON.parse(store.get('cs.seat') || 'null');
    return seat && typeof seat.code === 'string' && typeof seat.token === 'string' ? seat : null;
  } catch {
    return null;
  }
}
const saveSeat = (code, token) => store.set('cs.seat', JSON.stringify({ code, token }));
const clearSeat = () => store.del('cs.seat');

function hashCode() {
  const c = decodeURIComponent(location.hash.slice(1)).trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(c) ? c : null;
}
const inviteLink = (code) => `${location.origin}/#${code}`;

// ---------- small UI helpers ----------

let toastTimer = null;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function flash(text, ms = 1500, big = false) {
  S.flash = { text, until: performance.now() + ms, big };
  renderCenter();
}

function show(screen) {
  for (const id of ['home', 'lobby', 'game']) $(`#${id}`).hidden = id !== screen;
}

const byId = (st) => Object.fromEntries(st.players.map((p) => [p.id, p]));
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]);
const isHost = (st) => st && st.hostId === st.youId;
const nameOf = (st, id) => (id === st.youId ? 'You' : byId(st)[id]?.name || 'Someone');

function lettersEl(word, count, fresh = false) {
  return h(
    'span',
    { class: 'letters', 'aria-label': `${count} of ${word.length} letters` },
    [...word].map((ch, i) => h('i', { class: i < count ? (fresh && i === count - 1 ? 'on new' : 'on') : '', text: ch })),
  );
}

// ---------- home ----------

// The welcome table: a few random characters around the mat with three matching chits.
{
  const hero = $('#hero-table');
  const colors = ['#e4572e', '#2e86ab', '#3a9d5d', '#d99a1e', '#8e5ec4'];
  renderTable(
    hero,
    colors.map((color, i) => ({ id: `hero${i}`, avatar: randomAvatar(randInt), color })),
    { meId: null, seatInfo: () => ({ name: '', classes: [] }) },
  );
  hero.querySelector('.rt-pile').replaceChildren(
    ...['-14deg', '4deg', '16deg'].map((r, i) => h('span', { class: 'hero-chit', style: { '--r': r, '--i': String(i) }, text: 'Idli' })),
  );
}

const nameInput = $('#name');
nameInput.value = store.get('cs.name') || '';
if (hashCode()) $('#join-code').value = hashCode();

function homeError(msg) {
  $('#home-error').textContent = msg || '';
}

function readName() {
  const name = nameInput.value.trim();
  if (!name) {
    homeError('Type a nickname first.');
    nameInput.focus();
    return null;
  }
  store.set('cs.name', name);
  return name;
}

function enterRoom(res) {
  S.code = res.code;
  saveSeat(res.code, res.token);
  history.replaceState(null, '', `#${res.code}`);
  homeError('');
}

function leaveToHome(msg) {
  S.code = null;
  S.state = null;
  S.look = null;
  clearSeat();
  history.replaceState(null, '', location.pathname);
  $('#overlay').hidden = true;
  $('#hand').replaceChildren();
  $('#table .rt-pile')?.replaceChildren();
  show('home');
  homeError(msg);
}

let busy = false;
async function createRoom() {
  const name = readName();
  if (!name || busy) return;
  busy = true;
  const res = await send('create', { name });
  busy = false;
  if (res.error) return homeError(res.error);
  enterRoom(res);
}

async function joinRoom() {
  const name = readName();
  const code = $('#join-code').value.trim().toUpperCase();
  if (!name || busy) return;
  if (!/^[A-Z0-9]{6}$/.test(code)) return homeError('Room codes have 6 letters/numbers.');
  busy = true;
  const seat = savedSeat();
  const res = await send('join', { code, name, token: seat && seat.code === code ? seat.token : undefined });
  busy = false;
  if (res.error) return homeError(res.error);
  enterRoom(res);
}

$('#btn-create').addEventListener('click', createRoom);
$('#btn-join').addEventListener('click', joinRoom);
$('#home-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if ($('#join-code').value.trim()) joinRoom();
  else createRoom();
});

async function leaveRoom() {
  if (S.state && S.state.phase !== 'lobby' && !confirm('Leave this game?')) return;
  await send('leave');
  leaveToHome();
}
$('#lobby-leave').addEventListener('click', leaveRoom);
$('#game-leave').addEventListener('click', leaveRoom);

// ---------- lobby ----------

$('#btn-copy').addEventListener('click', async () => {
  if (!S.state) return;
  const link = inviteLink(S.state.code);
  try {
    await navigator.clipboard.writeText(link);
    toast('Invite link copied!');
  } catch {
    prompt('Copy this invite link:', link);
  }
});
$('#btn-bot').addEventListener('click', async () => {
  const res = await send('addBot');
  if (res.error) toast(res.error);
});
$('#lock-room').addEventListener('change', (e) => send('settings', { locked: e.target.checked }));
$('#btn-start').addEventListener('click', async () => {
  sfx.unlock();
  const res = await send('start');
  if (res.error) toast(res.error);
});
for (const seg of document.querySelectorAll('.seg[data-setting]')) {
  const key = seg.dataset.setting;
  for (const b of seg.querySelectorAll('button')) {
    b.addEventListener('click', () => send('settings', { [key]: key === 'botSpeed' ? b.dataset.v : Number(b.dataset.v) }));
  }
}
let customTimer = null;
$('#custom-items').addEventListener('input', (e) => {
  clearTimeout(customTimer);
  customTimer = setTimeout(() => send('settings', { customItems: e.target.value }), 400);
});

// ----- character maker -----

const myPlayer = (st) => st?.players.find((p) => p.id === st.youId);
const currentLook = (st) => S.look || myPlayer(st)?.avatar;

async function changeLook(look) {
  S.look = look;
  renderCharMaker(S.state);
  const res = await send('avatar', { avatar: look });
  if (res.error) {
    S.look = null;
    toast(res.error);
    if (S.state) renderCharMaker(S.state);
  }
}

$('#btn-reroll').addEventListener('click', () => changeLook(randomAvatar(randInt)));

let charKey = '';
function renderCharMaker(st) {
  const me = myPlayer(st);
  const look = currentLook(st);
  if (!me || !look) return;
  const key = `${JSON.stringify(look)}|${me.color}`;
  if (key === charKey) return;
  charKey = key;
  $('#char-preview').innerHTML = avatarSVG(look, me.color);
  $('#char-parts').replaceChildren(
    ...PART_KEYS.map((k) => {
      const n = PARTS[k].length;
      const step = (d) => () => changeLook({ ...currentLook(S.state), [k]: (look[k] + d + n) % n });
      return h(
        'div',
        { class: 'part' },
        h('span', { class: 'part-title', text: PART_TITLES[k] }),
        h('button', { type: 'button', class: 'part-btn', 'aria-label': `Previous ${PART_TITLES[k]}`, text: '‹', onclick: step(-1) }),
        h('span', { class: 'part-val', text: PARTS[k][look[k]] }),
        h('button', { type: 'button', class: 'part-btn', 'aria-label': `Next ${PART_TITLES[k]}`, text: '›', onclick: step(1) }),
      );
    }),
  );
}

function renderLobby(st) {
  const host = isHost(st);
  $('#room-code').textContent = st.code;
  $('#btn-wa').href = `https://wa.me/?text=${encodeURIComponent(`Let's play Chit Slam! ✋ Join my room ${st.code}: ${inviteLink(st.code)}`)}`;
  $('#lock-room').checked = st.settings.locked;
  $('#locked-note').hidden = !st.settings.locked;

  $('#player-count').textContent = `${st.players.length}/${st.maxPlayers}`;
  $('#btn-bot').disabled = st.players.length >= st.maxPlayers;
  $('#lobby-players').replaceChildren(
    ...st.players.map((p) =>
      h(
        'li',
        {},
        miniAv(p.avatar, p.color),
        h('span', { class: 'nm', text: p.name + (p.id === st.youId ? ' (you)' : '') }),
        p.id === st.hostId ? h('span', { class: 'tag host', text: 'host' }) : null,
        p.isBot ? h('span', { class: 'tag', text: 'bot' }) : null,
        !p.connected ? h('span', { class: 'tag away', text: 'offline' }) : null,
        host && p.id !== st.youId
          ? h('button', {
              class: 'x-btn',
              type: 'button',
              'aria-label': `Remove ${p.name}`,
              title: 'Remove',
              text: '✕',
              onclick: async () => {
                const res = await send('kick', { playerId: p.id });
                if (res.error) toast(res.error);
              },
            })
          : null,
      ),
    ),
  );

  renderTable($('#lobby-table'), st.players, {
    meId: st.youId,
    word: st.word,
    seatInfo: (p) => ({
      name: p.id === st.youId ? 'You' : p.name,
      classes: [p.id === st.youId ? 'me' : '', !p.connected ? 'away' : ''],
      badges: [p.id === st.hostId ? { text: '★', cls: 'host', title: 'Host' } : null, p.isBot ? { text: '🤖', title: 'Bot' } : null].filter(Boolean),
    }),
  });

  // the server has caught up with my last change
  const me = myPlayer(st);
  if (S.look && me && JSON.stringify(S.look) === JSON.stringify(me.avatar)) S.look = null;
  renderCharMaker(st);

  const packs = [...(st.packs || []), { id: 'custom', name: 'Write our own', emoji: '✍️', sample: ['Your words, your jokes'] }];
  $('#pack-grid').replaceChildren(
    ...packs.map((p) =>
      h(
        'button',
        {
          type: 'button',
          class: `pack${st.settings.packId === p.id ? ' on' : ''}`,
          disabled: !host,
          'aria-pressed': String(st.settings.packId === p.id),
          onclick: () => send('settings', { packId: p.id }),
        },
        h('b', { text: `${p.emoji} ${p.name}` }),
        h('small', { text: p.sample.join(', ') }),
      ),
    ),
  );

  const custom = st.settings.packId === 'custom';
  $('#custom-box').hidden = !custom;
  const ta = $('#custom-items');
  ta.readOnly = !host;
  if (document.activeElement !== ta) ta.value = st.settings.customItems.join('\n');
  const need = st.players.length;
  $('#custom-count').textContent = `${st.settings.customItems.length} written · need at least ${Math.max(need, st.minPlayers)} (one per player)`;

  for (const seg of document.querySelectorAll('.seg[data-setting]')) {
    const value = String(st.settings[seg.dataset.setting]);
    for (const b of seg.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.v === value));
      b.disabled = !host;
    }
  }

  $('#btn-start').disabled = !st.canStart;
  $('#start-hint').textContent = host
    ? st.startProblem || 'Everyone in? Start when ready!'
    : st.startProblem || 'Waiting for the host to start…';
}

// ---------- game ----------

const activePhase = (st) => st && (st.phase === 'playing' || st.phase === 'stacking');
const meInRound = (st) => st && st.you && st.you.inGame;

function canPass(st = S.state) {
  return !!st && st.phase === 'playing' && meInRound(st) && st.you.myTurn && S.passedTurn !== st.turnNo;
}

function canSlam(st = S.state) {
  if (!st || !meInRound(st) || st.you.slammed) return false;
  if (st.phase === 'stacking') return true;
  return st.phase === 'playing' && st.you.myTurn && !st.you.falseThisTurn;
}

function visibleChits() {
  return [...$('#hand').querySelectorAll('.chit:not(.leaving)')];
}

function tiltFor(id) {
  let n = 0;
  for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) % 997;
  return `${(n % 9) - 4}deg`;
}

async function passChit(el) {
  const st = S.state;
  if (!canPass(st) || el.classList.contains('leaving')) return;
  sfx.unlock();
  S.passedTurn = st.turnNo; // one pass per turn
  el.classList.add('leaving');
  sfx.swish();
  for (const c of visibleChits()) c.disabled = true;
  const res = await send('pass', { chitId: el.dataset.id });
  if (res.error) {
    S.passedTurn = -1;
    el.classList.remove('leaving');
    toast(res.error);
    if (S.state) renderHand(S.state);
  }
}

function makeChit(c) {
  // Shrink the handwriting for long single words so they don't split mid-word.
  const longest = Math.max(...String(c.label).split(/\s+/).map((w) => [...w].length));
  const size = longest >= 12 ? ' xlong' : longest >= 8 ? ' long' : '';
  const el = h(
    'button',
    { type: 'button', class: `chit arriving${size}`, dataset: { id: c.id }, style: { '--tilt': tiltFor(c.id) } },
    h('span', { class: 'key' }),
    h('span', { class: 'new-tag', text: 'NEW' }),
    h('span', { class: 'chit-label', text: c.label }),
  );
  el.addEventListener('click', () => passChit(el));
  el.addEventListener('animationend', () => {
    el.classList.remove('arriving');
    if (el.classList.contains('leaving')) {
      el.dataset.gone = '1';
      const still = S.state?.you?.hand.some((x) => x.id === el.dataset.id);
      if (!still) el.remove();
    }
  });
  return el;
}

function renderHand(st) {
  const box = $('#hand');
  const you = st.you;
  const inRound = meInRound(st) && st.phase !== 'roundEnd';
  const hand = inRound ? you.hand : [];
  const byChit = new Map(hand.map((c) => [c.id, c]));

  for (const el of [...box.children]) {
    const keep = byChit.has(el.dataset.id);
    if (!keep && (!el.classList.contains('leaving') || el.dataset.gone)) el.remove();
  }
  const present = new Set([...box.querySelectorAll('.chit')].map((el) => el.dataset.id));
  for (const c of hand) {
    if (!present.has(c.id)) {
      box.append(makeChit(c));
      if (activePhase(st)) sfx.swish(0.03);
    }
  }

  box.dataset.n = String(hand.length);
  const enabled = canPass(st);
  visibleChits().forEach((el, i) => {
    el.disabled = !enabled;
    el.querySelector('.key').textContent = String(i + 1);
    el.classList.toggle('is-new', !!byChit.get(el.dataset.id)?.new && st.phase === 'playing');
  });
  box.classList.toggle('waiting', inRound && st.phase === 'playing' && !you.myTurn);
  box.classList.toggle('my-turn', enabled);
  box.classList.toggle('frozen', inRound && you.slammed);
}

// The face each character pulls, from what is happening to them.
function moodFor(st, p) {
  if (!p.connected || p.away) return 'mood-sleep';
  if (st.falseSlams.includes(p.id)) return 'mood-o';
  if (st.phase === 'gameOver' && st.gameResult) {
    if (st.gameResult.winnerId === p.id) return 'mood-grin';
    if (st.gameResult.boostedIds.includes(p.id)) return 'mood-sad';
    return '';
  }
  if (st.phase === 'roundEnd' && st.lastResult) {
    if (st.lastResult.boosterId === p.id) return 'mood-grin';
    if (st.lastResult.placements.find((x) => x.playerId === p.id)?.letter) return 'mood-sad';
    return '';
  }
  if (activePhase(st) && st.stack.includes(p.id)) return 'mood-grin';
  return '';
}

function tableList(st) {
  const players = byId(st);
  return st.seats.length ? st.seats.map((id) => players[id]).filter(Boolean) : st.players;
}

function renderGameTable(st) {
  const active = activePhase(st);
  renderTable($('#table'), tableList(st), {
    meId: st.youId,
    word: st.word,
    flow: st.seats.length > 0,
    seatInfo: (p) => ({
      name: p.id === st.youId ? 'You' : p.name,
      score: String(p.score),
      letters: p.letters,
      classes: [
        p.id === st.youId ? 'me' : '',
        st.turnId === p.id ? 'turn' : '',
        !p.connected ? 'away' : '',
        active && st.stack.includes(p.id) ? 'slammed' : '',
        moodFor(st, p),
      ],
      badges: [
        p.isBot ? { text: '🤖', title: 'Bot' } : null,
        !p.connected ? { text: p.leaving ? 'left' : 'offline', cls: 'warn' } : null,
        p.connected && p.away ? { text: '💤', cls: 'warn', title: 'Away' } : null,
        st.phase === 'roundEnd' && !p.isBot && p.connected && !p.leaving
          ? { text: p.ready ? '✓' : '…', cls: p.ready ? 'ok' : '', title: p.ready ? 'Ready' : 'Not ready yet' }
          : null,
      ].filter(Boolean),
    }),
  });
  const showPile = st.phase === 'roundEnd' || st.phase === 'gameOver' || active;
  renderPile($('#table'), showPile ? st.stack : [], byId(st));
  const watchers = st.seats.length ? st.players.filter((p) => !st.seats.includes(p.id)) : [];
  $('#watchers').textContent = watchers.length ? `Watching, joins next round: ${watchers.map((p) => p.name).join(', ')}` : '';
}

function turnSecsLeft() {
  return S.turnDeadline ? Math.max(0, Math.ceil((S.turnDeadline - performance.now()) / 1000)) : null;
}

function centerText(st) {
  const now = performance.now();
  if (S.flash && now < S.flash.until) return { text: S.flash.text, big: S.flash.big };
  if (st.phase === 'countdown') return { text: String(Math.max(1, Math.ceil((S.deadline - now) / 1000))), big: true };
  if (!activePhase(st)) return { text: '' };
  if (!meInRound(st)) return { text: "You'll be dealt in next round 👀" };
  if (st.phase === 'playing') {
    const secs = turnSecsLeft();
    if (st.you.myTurn) return { text: secs === null ? 'Your turn!' : `Your turn! ${secs}s`, mine: true };
    return { text: `${nameOf(st, st.turnId)}'s turn${secs === null ? '…' : ` · ${secs}s`}` };
  }
  if (st.you.slammed) {
    const pos = st.stack.indexOf(st.youId) + 1;
    return { text: pos === 1 ? 'BOOST! Your hand is down first ✋' : `Your hand is down - ${ordinal(pos)}` };
  }
  return { text: '' }; // stacking and you haven't noticed yet: no hints
}

let lastCenter = '';
function renderCenter() {
  const st = S.state;
  if (!st) return;
  const el = $('#table .rt-msg');
  if (!el) return;
  const { text, big, mine } = centerText(st);
  const key = `${text}|${big}|${mine}`;
  if (key === lastCenter) return;
  lastCenter = key;
  el.textContent = text;
  el.classList.toggle('big', !!big);
  el.classList.toggle('mine', !!mine);
  el.classList.remove('pop');
  if (big && text) {
    void el.offsetWidth; // restart the pop animation
    el.classList.add('pop');
  }
}

function renderSlamButton(st) {
  const btn = $('#btn-slam');
  btn.disabled = !canSlam(st);
  btn.classList.remove('pressed');
}

function renderFlow(st) {
  const you = st.you;
  let kids = [];
  if (st.phase === 'countdown' && st.turnId && meInRound(st)) {
    kids = st.turnId === st.youId ? [h('b', { text: 'You start' }), ' - you hold the extra chit'] : [h('b', { text: nameOf(st, st.turnId) }), ' starts'];
  } else if (st.phase === 'playing' && meInRound(st)) {
    if (you.myTurn && you.falseThisTurn) kids = ['No set - ', h('b', { text: 'pass a chit' }), ` to ${you.passTo} →`];
    else if (you.myTurn) kids = [h('b', { class: 'go', text: 'Your turn' }), ' · pass a chit to ', h('b', { text: `${you.passTo} →` })];
    else kids = ['Waiting for ', h('b', { text: nameOf(st, st.turnId) }), ' · you pass to ', h('b', { text: `${you.passTo} →` })];
  }
  $('#flow').replaceChildren(...kids);
  $('#flow').classList.toggle('mine', !!(st.phase === 'playing' && you?.myTurn));
}

function renderGame(st) {
  $('#round-label').textContent = st.round ? `Round ${st.round}` : '';
  renderGameTable(st);
  renderHand(st);
  renderCenter();
  renderSlamButton(st);
  renderFlow(st);
  $('#away-note').hidden = !(st.you?.away && activePhase(st));
}

async function doSlam() {
  const st = S.state;
  if (!canSlam(st)) return;
  sfx.unlock();
  $('#btn-slam').classList.add('pressed');
  sfx.thud(st.stack.length);
  navigator.vibrate?.(40);
  const res = await send('slam');
  if (res.falseSlam) {
    sfx.buzz();
    $('#hand').classList.add('shake');
    setTimeout(() => $('#hand').classList.remove('shake'), 700);
    flash('No set! −1 point', 2000);
  } else if (res.error) {
    toast(res.error);
  }
  $('#btn-slam').classList.remove('pressed');
}
$('#btn-slam').addEventListener('click', doSlam);

$('#btn-mute').addEventListener('click', () => {
  S.muted = !S.muted;
  sfx.setMuted(S.muted);
  store.set('cs.muted', S.muted ? '1' : '0');
  $('#btn-mute').textContent = S.muted ? '🔇' : '🔊';
});
$('#btn-mute').textContent = S.muted ? '🔇' : '🔊';

// Marked away? Any touch or key says "I'm here".
function imHere() {
  if (S.state?.you?.away) send('here');
}

document.addEventListener('keydown', (e) => {
  imHere();
  if (!S.state || $('#game').hidden) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === 'Space' || e.key === 'b' || e.key === 'B') {
    e.preventDefault();
    doSlam();
  } else if (/^[1-5]$/.test(e.key)) {
    const el = visibleChits()[Number(e.key) - 1];
    if (el) passChit(el);
  }
});
document.addEventListener('pointerdown', () => {
  sfx.unlock();
  imHere();
});

// ---------- overlays: round results & game over ----------

function readyPeople(st) {
  return st.players.filter((p) => !p.isBot && p.connected && !p.leaving);
}

function resultsView(st) {
  const r = st.lastResult;
  const booster = r.placements.find((x) => x.playerId === r.boosterId);
  const lettered = r.placements.filter((x) => x.letter).map((x) => (x.playerId === st.youId ? 'You' : x.name));
  const people = readyPeople(st);
  const waitingFor = people.filter((p) => !p.ready && p.id !== st.youId).map((p) => p.name);
  const iAmReady = !!st.you?.ready;
  return h(
    'div',
    { class: 'results' },
    h('p', { class: 'kicker', text: `Round ${r.round}` }),
    h(
      'h2',
      {},
      booster ? `✋ ${booster.playerId === st.youId ? 'You' : booster.name} boosted with ${r.setSize} × ` : 'Round over',
      booster ? h('span', { class: 'ink', text: r.boosterLabel }) : null,
    ),
    h(
      'ol',
      { class: 'placements' },
      r.placements.map((x) =>
        h(
          'li',
          { class: `${x.playerId === st.youId ? 'me' : ''}${x.letter ? ' got-letter' : ''}` },
          h('span', { class: 'place', text: x.slammed ? ordinal(x.place) : '✗' }),
          miniAv(x.avatar, x.color),
          h('span', { class: 'nm', text: x.playerId === st.youId ? 'You' : x.name }),
          h('span', { class: 'pts', text: `+${x.points}` }),
          lettersEl(st.word, x.letters, x.letter),
        ),
      ),
    ),
    lettered.length
      ? h('p', { class: 'sub', text: `${lettered.join(' & ')} ${lettered.length > 1 || lettered[0] === 'You' ? 'were' : 'was'} the last hand - a letter, and the first turn next round.` })
      : null,
    h(
      'div',
      { class: 'sheet-actions' },
      h('button', {
        class: `btn btn-big ${iAmReady ? '' : 'btn-primary'}`,
        type: 'button',
        id: 'btn-ready',
        disabled: iAmReady,
        text: iAmReady ? '✓ Ready' : 'Ready for the next round',
        onclick: async () => {
          sfx.unlock();
          const res = await send('ready');
          if (res.error) toast(res.error);
        },
      }),
      h(
        'p',
        { class: 'next' },
        iAmReady && waitingFor.length ? `Waiting for ${waitingFor.join(', ')}` : '',
        st.timed ? h('span', {}, iAmReady && waitingFor.length ? ' · ' : '', 'starts anyway in ', h('b', { dataset: { countdown: '' } }), 's') : null,
      ),
    ),
  );
}

function gameOverView(st) {
  const g = st.gameResult;
  const winner = g.standings[0];
  const name = (x) => (x.playerId === st.youId ? 'You' : x.name);
  const boosted = g.standings.filter((x) => g.boostedIds.includes(x.playerId)).map(name);
  return h(
    'div',
    { class: 'results' },
    h('p', { class: 'kicker', text: 'Game over' }),
    h('div', { class: 'winner-av mood-grin' }, h('span', { class: 'crown', text: '👑' }), miniAv(winner.avatar, winner.color, 'big-av')),
    h('h2', { text: winner.playerId === st.youId ? '🏆 You win!' : `🏆 ${winner.name} wins!` }),
    h('p', { class: 'sub', text: `${boosted.join(' & ')} spelled ${st.word}.` }),
    h(
      'ol',
      { class: 'placements' },
      g.standings.map((x, i) =>
        h(
          'li',
          { class: x.playerId === st.youId ? 'me' : '' },
          h('span', { class: 'place', text: ordinal(i + 1) }),
          miniAv(x.avatar, x.color),
          h('span', { class: 'nm', text: name(x) }),
          h('span', { class: 'pts', text: `${x.score} pts` }),
          lettersEl(st.word, x.letters),
        ),
      ),
    ),
    h(
      'div',
      { class: 'sheet-actions' },
      isHost(st)
        ? h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn btn-primary', type: 'button', text: 'Rematch', onclick: async () => {
              const res = await send('start');
              if (res.error) toast(res.error);
            } }),
            h('button', { class: 'btn', type: 'button', text: 'Change chits', onclick: () => send('lobby') }),
          )
        : h('p', { class: 'hint', text: 'Waiting for the host to start a rematch…' }),
      h('button', { class: 'btn btn-ghost', type: 'button', text: 'Leave room', onclick: leaveRoom }),
    ),
  );
}

let overlayKey = '';
function renderOverlay(st) {
  const ov = $('#overlay');
  let key = '';
  if (st.phase === 'roundEnd' && st.lastResult) {
    const ready = readyPeople(st).map((p) => `${p.id}:${p.ready}`).join(',');
    key = `r${st.lastResult.round}|${st.timed}|${ready}`;
  } else if (st.phase === 'gameOver' && st.gameResult) key = `g${st.round}|${isHost(st)}`;
  if (!key) {
    ov.hidden = true;
    overlayKey = '';
    return;
  }
  ov.hidden = false;
  if (key === overlayKey) return;
  overlayKey = key;
  $('#sheet').replaceChildren(key.startsWith('r') ? resultsView(st) : gameOverView(st));
  updateTimers();
}

// ---------- sounds & flashes from state changes ----------

function effects(prev, st) {
  if (!prev || prev.code !== st.code) return;
  const players = byId(st);
  if (st.phase === 'countdown' && prev.phase !== 'countdown') sfx.blip(440, 0.12);
  if (prev.phase === 'countdown' && st.phase === 'playing') sfx.blip(880, 0.18, 0.16);
  // my turn has come round
  const myTurnNow = st.phase === 'playing' && st.you?.myTurn;
  const wasMyTurn = prev.phase === 'playing' && prev.you?.myTurn && prev.turnNo === st.turnNo;
  if (myTurnNow && !wasMyTurn) {
    sfx.blip(990, 0.1, 0.12);
    navigator.vibrate?.(30);
  }
  if (st.round === prev.round && st.stack.length > prev.stack.length) {
    for (let i = prev.stack.length; i < st.stack.length; i++) {
      if (st.stack[i] === st.youId) continue; // already played on tap
      sfx.thud(i);
      if (i > 0) navigator.vibrate?.(15 + i * 10);
    }
  }
  // a chit flying to the next seat for every pass
  if (st.round === prev.round && st.seats.length && !$('#game').hidden) {
    const before = byId(prev);
    const table = $('#table');
    for (const p of st.players) {
      const diff = p.passes - (before[p.id]?.passes ?? p.passes);
      if (diff <= 0 || !st.seats.includes(p.id)) continue;
      const next = st.seats[(st.seats.indexOf(p.id) + 1) % st.seats.length];
      for (let k = 0; k < Math.min(diff, 2); k++) setTimeout(() => flyChit(table, p.id, next), k * 120);
      bump(table, p.id);
    }
  }
  for (const id of st.falseSlams) {
    if (prev.falseSlams.includes(id) || id === st.youId) continue;
    sfx.blip(160, 0.2, 0.08, 'sawtooth');
    flash(`${players[id]?.name || 'Someone'} said BOOST with no set! −1`, 2000);
  }
  if (st.you?.away && !prev.you?.away) sfx.blip(300, 0.2, 0.1);
  const ended = (ph) => ph === 'roundEnd' || ph === 'gameOver';
  if (ended(st.phase) && !ended(prev.phase) && st.lastResult) {
    const mine = st.lastResult.placements.find((x) => x.playerId === st.youId);
    if (st.phase === 'gameOver' && st.gameResult?.winnerId === st.youId) sfx.win();
    else if (st.lastResult.boosterId === st.youId) sfx.win();
    else if (mine?.letter) sfx.sad();
    else sfx.blip(660, 0.15);
  }
}

// ---------- main render ----------

function render(st) {
  const prev = S.state;
  S.state = st;
  const now = performance.now();
  if (st.phaseMs !== null && st.phaseMs !== undefined) S.deadline = now + st.phaseMs;
  S.turnDeadline = st.turnMs === null || st.turnMs === undefined ? 0 : now + st.turnMs;
  S.turnTotal = st.turnTotalMs || 0;
  if (st.phase === 'playing' && st.you?.myTurn && !(prev?.phase === 'playing' && prev.you?.myTurn && prev.turnNo === st.turnNo)) {
    S.myTurnSince = now;
  }
  document.body.classList.toggle('is-host', isHost(st));
  if (st.phase === 'lobby') {
    show('lobby');
    renderLobby(st);
  } else {
    show('game');
    renderGame(st);
  }
  effects(prev, st); // after layout, so animations know where everyone sits
  renderOverlay(st);
  updateTimers();
  if (st.notice && st.notice !== prev?.notice) toast(st.notice);
}

function updateTimers() {
  const st = S.state;
  if (!st) return;
  const now = performance.now();
  const secs = Math.max(0, Math.ceil((S.deadline - now) / 1000));
  for (const el of document.querySelectorAll('[data-countdown]')) el.textContent = String(secs);
  if ($('#game').hidden) return;
  renderCenter();
  // the ring round the current player's face empties as their time runs out
  const table = $('#table');
  if (st.phase === 'playing' && st.turnId && S.turnDeadline && S.turnTotal) {
    setTurnRing(table, st.turnId, (S.turnDeadline - now) / S.turnTotal);
  } else {
    setTurnRing(table, null, null);
  }
  // a gentle nudge if it's been my turn for a while
  const mine = st.phase === 'playing' && st.you?.myTurn && S.passedTurn !== st.turnNo;
  $('#hand').classList.toggle('nudge', !!mine && now - S.myTurnSince > 4000);
}
setInterval(updateTimers, 150);

// ---------- connection ----------

socket.on('state', render);
socket.on('p', (cb) => typeof cb === 'function' && cb());
socket.on('kicked', ({ reason } = {}) => leaveToHome(reason || 'You left the room.'));
socket.on('disconnect', () => {
  if (S.code) $('#conn').hidden = false;
});
socket.on('connect', async () => {
  $('#conn').hidden = true;
  const seat = savedSeat();
  const target = S.code || hashCode();
  if (!seat || !target || seat.code !== target) return;
  const res = await send('join', { code: seat.code, token: seat.token, name: store.get('cs.name') || 'Player' });
  if (res.error) {
    if (S.code) leaveToHome(res.error === 'Room not found. Check the code.' ? 'That room has closed.' : res.error);
    else clearSeat();
    return;
  }
  enterRoom(res);
});
