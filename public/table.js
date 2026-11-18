// The round table: characters seated around a wooden table with a straw mat,
// arrows showing which way chits travel, flying chits, and the hand pile.

import { avatarSVG, skinOf } from './characters.js';

const SEAT_R = 39; // seat distance from centre, % of the table box
const FLOW_R = 27.5; // radius of the direction arrows
const PILE_JITTER = [
  [0, 2, -6], [3, -1, 9], [-3, -2, -12], [2, 3, 5], [-2, 1, 14], [4, 0, -4], [-4, -3, 8], [1, -2, -9],
];

export function ensureTable(root) {
  if (root.dataset.ready) return;
  root.dataset.ready = '1';
  const id = root.id || 'rt';
  root.innerHTML =
    '<div class="rt-wood"><div class="rt-mat"></div></div>' +
    `<svg class="rt-flow" viewBox="0 0 100 100" aria-hidden="true"><defs><marker id="${id}-ah" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto"><path d="M0 0 L10 5 L0 10 z"/></marker></defs><g class="arcs"></g></svg>` +
    '<div class="rt-pile"></div><div class="rt-seats"></div><div class="rt-fx"></div><div class="rt-msg" aria-live="polite"></div>';
}

const point = (angDeg, r) => {
  const a = (angDeg * Math.PI) / 180;
  return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
};

/**
 * Seat `list` (in passing order) around the table, `meId` at the bottom.
 * Passing goes clockwise. seatInfo(p, i) -> { name, classes[], score?, letters?, badges[] }
 */
export function renderTable(root, list, { meId, word = 'BOOST', flow = false, seatInfo }) {
  ensureTable(root);
  const n = Math.max(list.length, 1);
  const m = Math.max(0, list.findIndex((p) => p.id === meId));
  const pos = new Map();
  list.forEach((p, i) => {
    const ang = 90 + ((i - m) * 360) / n;
    const [x, y] = point(ang, SEAT_R);
    pos.set(p.id, { ang, x, y, i });
  });
  root._pos = pos;
  root._order = list.map((p) => p.id);
  root.classList.toggle('rt-crowded', list.length >= 7);

  const box = root.querySelector('.rt-seats');
  for (const el of [...box.children]) if (!pos.has(el.dataset.pid)) el.remove();

  list.forEach((p, i) => {
    let el = box.querySelector(`[data-pid="${p.id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.dataset.pid = p.id;
      el.innerHTML =
        '<div class="rt-av"></div><div class="rt-ring"></div><div class="rt-badges"></div><div class="rt-tag"><span class="nm"></span><span class="pts"></span></div><div class="rt-letters"></div>';
      el.style.setProperty('--bd', `${-((i * 1.37) % 5).toFixed(2)}s`);
      box.append(el);
    }
    const { x, y } = pos.get(p.id);
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
    const info = seatInfo(p, i);
    const bumping = el.classList.contains('bump');
    el.className = ['rt-seat', ...info.classes, bumping ? 'bump' : ''].join(' ');

    const av = el.querySelector('.rt-av');
    const key = `${JSON.stringify(p.avatar)}|${p.color}`;
    if (av.dataset.key !== key) {
      av.innerHTML = avatarSVG(p.avatar, p.color);
      av.dataset.key = key;
    }
    el.querySelector('.nm').textContent = info.name;
    el.querySelector('.pts').textContent = info.score ?? '';
    el.querySelector('.pts').hidden = info.score === undefined;

    const letters = el.querySelector('.rt-letters');
    const lkey = info.letters === undefined ? '' : String(info.letters);
    if (letters.dataset.key !== lkey) {
      letters.dataset.key = lkey;
      letters.replaceChildren(
        ...(info.letters === undefined
          ? []
          : [...word].map((ch, k) => {
              const s = document.createElement('i');
              s.textContent = ch;
              if (k < info.letters) s.className = 'on';
              return s;
            })),
      );
    }
    el.querySelector('.rt-badges').replaceChildren(
      ...(info.badges || []).map((b) => {
        const s = document.createElement('span');
        s.className = `rt-badge ${b.cls || ''}`;
        s.textContent = b.text;
        if (b.title) s.title = b.title;
        return s;
      }),
    );
  });

  // direction arrows between neighbours
  const arcs = root.querySelector('.arcs');
  if (!flow || list.length < 2) {
    arcs.replaceChildren();
    return;
  }
  const step = 360 / list.length;
  const gap = Math.min(16, step * 0.3);
  const ns = 'http://www.w3.org/2000/svg';
  arcs.replaceChildren(
    ...list.map((p, i) => {
      const a1 = pos.get(p.id).ang + gap;
      const a2 = pos.get(p.id).ang + step - gap;
      const [x1, y1] = point(a1, FLOW_R);
      const [x2, y2] = point(a2, FLOW_R);
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', `M${x1.toFixed(2)} ${y1.toFixed(2)} A${FLOW_R} ${FLOW_R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`);
      path.setAttribute('marker-end', `url(#${root.id || 'rt'}-ah)`);
      const next = list[(i + 1) % list.length];
      path.setAttribute('class', p.id === meId ? 'out' : next.id === meId ? 'in' : '');
      return path;
    }),
  );
}

// A hand seen from above: four fingers, thumb, sleeve in the player's colour.
function handSVG(skin, sleeve) {
  return (
    '<svg viewBox="0 0 100 140" aria-hidden="true"><g stroke="#2b2924" stroke-width="3" stroke-linejoin="round">' +
    `<ellipse cx="22" cy="74" rx="9" ry="19" transform="rotate(-38 22 74)" fill="${skin}"/>` +
    `<rect x="27" y="22" width="11" height="44" rx="5.5" fill="${skin}"/>` +
    `<rect x="39" y="10" width="11" height="54" rx="5.5" fill="${skin}"/>` +
    `<rect x="51" y="13" width="11" height="52" rx="5.5" fill="${skin}"/>` +
    `<rect x="63" y="24" width="10" height="42" rx="5" fill="${skin}"/>` +
    `<rect x="26" y="52" width="48" height="50" rx="14" fill="${skin}"/>` +
    `<rect x="34" y="96" width="32" height="18" fill="${skin}" stroke="none"/>` +
    `<rect x="28" y="108" width="44" height="32" rx="6" fill="${sleeve}"/>` +
    '</g><path d="M38 58 q6 -3 12 0 M51 58 q6 -3 12 0" stroke="rgba(0,0,0,.18)" stroke-width="2" fill="none"/></svg>'
  );
}

/** The pile of hands in the middle, in arrival order. Each new hand reaches in from its seat. */
export function renderPile(root, stack, players) {
  ensureTable(root);
  const pile = root.querySelector('.rt-pile');
  while (pile.children.length > stack.length) pile.lastChild.remove();
  const W = root.clientWidth || 300;
  stack.forEach((pid, i) => {
    if (pile.children[i]?.dataset.pid === pid) return;
    while (pile.children.length > i) pile.lastChild.remove();
    const p = players[pid] || { color: '#888888', avatar: null };
    const seat = root._pos?.get(pid) || { ang: 90, x: 50, y: 90 };
    const [jx, jy, jr] = PILE_JITTER[i % PILE_JITTER.length];
    const x = 50 + jx;
    const y = 50 + jy - i * 1.2;
    const el = document.createElement('div');
    el.className = `slap${i === 0 ? ' first' : ''}`;
    el.dataset.pid = pid;
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
    el.style.zIndex = String(10 + i);
    el.style.setProperty('--r', `${seat.ang - 90 + jr}deg`);
    el.style.setProperty('--fx', `${(((seat.x - x) / 100) * W).toFixed(1)}px`);
    el.style.setProperty('--fy', `${(((seat.y - y) / 100) * W).toFixed(1)}px`);
    el.innerHTML = handSVG(skinOf(p.avatar), /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#888888');
    pile.append(el);
  });
}

/** A folded chit flies from one seat to the next. */
export function flyChit(root, fromId, toId) {
  const a = root._pos?.get(fromId);
  const b = root._pos?.get(toId);
  if (!a || !b) return;
  const W = root.clientWidth || 300;
  // start and end a little inside the table edge, in front of each character
  const sx = 50 + (a.x - 50) * 0.72;
  const sy = 50 + (a.y - 50) * 0.72;
  const ex = 50 + (b.x - 50) * 0.72;
  const ey = 50 + (b.y - 50) * 0.72;
  const el = document.createElement('div');
  el.className = 'fly-chit';
  el.style.left = `${sx}%`;
  el.style.top = `${sy}%`;
  el.style.setProperty('--dx', `${(((ex - sx) / 100) * W).toFixed(1)}px`);
  el.style.setProperty('--dy', `${(((ey - sy) / 100) * W).toFixed(1)}px`);
  el.addEventListener('animationend', () => el.remove());
  root.querySelector('.rt-fx').append(el);
  setTimeout(() => el.remove(), 1500);
}

/** Show how much of the current turn is left (0..1) on one seat's ring; clears the others. */
export function setTurnRing(root, pid, fraction) {
  for (const el of root.querySelectorAll('.rt-seat')) {
    const ring = el.querySelector('.rt-ring');
    if (!ring) continue;
    const on = el.dataset.pid === pid && fraction !== null;
    ring.classList.toggle('on', on);
    if (on) {
      ring.style.setProperty('--t', Math.max(0, Math.min(1, fraction)).toFixed(3));
      ring.classList.toggle('low', fraction < 0.3);
    }
  }
}

export function bump(root, pid) {
  const el = root.querySelector(`.rt-seat[data-pid="${pid}"]`);
  if (!el) return;
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
  setTimeout(() => el.classList.remove('bump'), 450);
}
