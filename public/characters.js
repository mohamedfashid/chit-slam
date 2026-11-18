// Characters built from parts (see avatar-parts.js), drawn as inline SVG.
// The shirt (and a cap or beanie) takes the player's colour. Every face carries
// four mouths; CSS shows the one matching the mood (smile / grin / o / sad),
// and the eyes blink.

import { normalizeAvatar } from './avatar-parts.js';

const SKINS = ['#e3b48c', '#c98e5d', '#b5763f', '#94603a', '#7a4a26', '#5a3519'];
const HAIR_COLORS = ['#1f1612', '#3b2417', '#7a3b1e', '#2e4fa3'];
const INK = '#2b1d14';
const MOUTH = '#5a2a1a';
const DEFAULT = { skin: 2, hair: 0, hairColor: 0, eyes: 0, face: 0, extra: 0 };

const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#888888');

const eyes =
  `<g class="eyes"><ellipse cx="43" cy="45" rx="2.3" ry="2.9" fill="${INK}"/><ellipse cx="57" cy="45" rx="2.3" ry="2.9" fill="${INK}"/>` +
  `<circle cx="43.8" cy="44" r=".8" fill="#fff"/><circle cx="57.8" cy="44" r=".8" fill="#fff"/></g>`;

const brows = (color) =>
  `<path d="M38.5 38.5 q4.5 -2.4 9 0 M52.5 38.5 q4.5 -2.4 9 0" stroke="${color}" stroke-width="1.7" fill="none" stroke-linecap="round"/>`;

const mouths =
  `<path class="m m-smile" d="M44 54.5 Q50 59.5 56 54.5" stroke="${MOUTH}" stroke-width="2.2" fill="none" stroke-linecap="round"/>` +
  `<path class="m m-grin" d="M42.5 53.5 Q50 64 57.5 53.5 Z" fill="${MOUTH}"/><path class="m m-grin" d="M45 54.4 h10 l-1 2 h-8z" fill="#fff"/>` +
  `<ellipse class="m m-o" cx="50" cy="56.5" rx="3.2" ry="4" fill="${MOUTH}"/>` +
  `<path class="m m-sad" d="M44 58.5 Q50 53.5 56 58.5" stroke="${MOUTH}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;

// A fringe that frames the face, used by several long styles.
const softFront = (c) =>
  `<path d="M29 47 C27 28 39 22 50 23 C61 22 73 28 71 47 C68 36 60 30 50 29.5 C40 30 32 36 29 47Z" fill="${c}"/><path d="M50 23.5 V30" stroke="rgba(0,0,0,.25)" stroke-width="1"/>`;

// Each style returns [behind the head, in front of the head]. c = hair colour, s = player colour.
const HAIR = [
  // Short
  (c) => ['', `<path d="M29 45 C27 28 39 22 50 22 C61 22 73 28 71 45 C68 35 60 31 50 31 C40 31 32 35 29 45Z" fill="${c}"/>`],
  // Side part
  (c) => ['', `<path d="M29 45 C27 27 40 22 52 23 C64 23 73 29 71 45 C69 36 63 31 56 31 L44 32 C38 33 32 38 29 45Z" fill="${c}"/><path d="M44 23.5 C43 27 43 30 44 32" stroke="rgba(255,255,255,.2)" stroke-width="1" fill="none"/>`],
  // Spiky
  (c) => ['', `<path d="M29 43 C27 30 32.5 23 39.5 24.5 L41.5 17.5 L46.5 23 L51 15.5 L55 23 L60 17.5 L62 25 C68.5 25.5 72.5 32 71 43 C67 34.5 60 32 50 32 C40 32 33 34.5 29 43Z" fill="${c}"/>`],
  // Curly
  (c) => ['', `<g fill="${c}"><circle cx="33.5" cy="33" r="7.5"/><circle cx="41.5" cy="26.5" r="8"/><circle cx="50.5" cy="24" r="8.5"/><circle cx="59.5" cy="26.5" r="8"/><circle cx="67" cy="33" r="7.5"/><circle cx="30.5" cy="40" r="5"/><circle cx="69.5" cy="40" r="5"/></g>`],
  // Buzz cut
  (c) => ['', `<path d="M30 42 C30 27 40 23.5 50 23.5 C60 23.5 70 27 70 42 C66 34 58 31 50 31 C42 31 34 34 30 42Z" fill="${c}" opacity=".8"/>`],
  // Long
  (c) => [`<path d="M27 44 C24 20 76 20 73 44 L76 80 C70 85 62 83 60 77 L40 77 C38 83 30 85 24 80Z" fill="${c}"/>`, softFront(c)],
  // Bob
  (c) => [
    `<path d="M26.5 46 C23.5 21 76.5 21 73.5 46 L75.5 66 C70.5 70.5 64 66.5 63.5 60 L36.5 60 C36 66.5 29.5 70.5 24.5 66Z" fill="${c}"/>`,
    `<path d="M30 45 C28 28 40 22 52 23 C64 24 72 30 70 45 C64 34 52 30 38 34.5 C34 36 32 40 30 45Z" fill="${c}"/>`,
  ],
  // Braid
  (c) => [
    `<circle cx="50" cy="42.5" r="23" fill="${c}"/><path d="M66 46 C76 56 77 72 73 92" stroke="${c}" stroke-width="9" fill="none" stroke-linecap="round"/>` +
      `<g stroke="rgba(255,255,255,.18)" stroke-width="1.2" fill="none"><path d="M70 60 l5 3 M71 68 l5 3 M71 76 l5 3 M70 84 l5 3"/></g>`,
    softFront(c),
  ],
  // Bun
  (c) => [`<circle cx="50" cy="20" r="8.5" fill="${c}"/>`, `<path d="M29.5 45 C27.5 27 39 22.5 50 22.5 C61 22.5 72.5 27 70.5 45 C67 34 59 30.5 50 31 C41 30.5 33 34 29.5 45Z" fill="${c}"/>`],
  // Ponytail
  (c, s) => [
    `<circle cx="50" cy="42.5" r="22" fill="${c}"/><path d="M67 33 C82 36 84 55 77 70 C75 58 73 48 65 41Z" fill="${c}"/>`,
    softFront(c) + `<circle cx="68.5" cy="34.5" r="2.4" fill="${s}"/>`,
  ],
  // Cap
  (c, s) => [
    '',
    `<path d="M29.5 47 C29 41 30 37 32.5 35 L35 47Z M70.5 47 C71 41 70 37 67.5 35 L65 47Z" fill="${c}"/>` +
      `<path d="M28.5 40 C28 24 39 19 50 19 C61 19 72 24 71.5 40 Z" fill="${s}" stroke="rgba(0,0,0,.25)" stroke-width="1"/>` +
      `<path d="M48 39 C60 35.5 76 36 81 40.5 C74 43.5 58 43 48 41.5Z" fill="${s}" stroke="rgba(0,0,0,.3)" stroke-width="1"/>` +
      `<path d="M50 19.5 V39" stroke="rgba(0,0,0,.18)" stroke-width="1"/><circle cx="50" cy="19.5" r="1.8" fill="rgba(0,0,0,.25)"/>`,
  ],
  // Beanie
  (c, s) => [
    '',
    `<path d="M29.5 48 C29 43 30 40 31.5 39 L34 48Z M70.5 48 C71 43 70 40 68.5 39 L66 48Z" fill="${c}"/>` +
      `<path d="M28 41 C27 22 39 17 50 17 C61 17 73 22 72 41Z" fill="${s}"/>` +
      `<rect x="27" y="34.5" width="46" height="8" rx="3" fill="${s}" stroke="rgba(0,0,0,.25)" stroke-width="1"/>` +
      `<path d="M32 35 v7 M37 35 v7 M42 35 v7 M47 35 v7 M52 35 v7 M57 35 v7 M62 35 v7 M67 35 v7" stroke="rgba(0,0,0,.15)" stroke-width="1"/>` +
      `<circle cx="50" cy="15.5" r="4.5" fill="#fffaf0" stroke="rgba(0,0,0,.2)" stroke-width="1"/>`,
  ],
];

const THIN_MOUSTACHE = (c) => `<path d="M42.5 51.6 Q50 48.2 57.5 51.6 Q50 50.4 42.5 51.6Z" fill="${c}" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/>`;
const BIG_MOUSTACHE = (c) => `<path d="M39 52.6 C43 48 48 49 50 51.2 C52 49 57 48 61 52.6 C58 56.4 54 54.6 50 53.8 C46 54.6 42 56.4 39 52.6Z" fill="${c}"/>`;
const BEARD = (c) => `<path d="M30 46 C30 62 39 69.5 50 69.5 C61 69.5 70 62 70 46 C68 55 64 59.5 59 60.5 C56 58 44 58 41 60.5 C36 59.5 32 55 30 46Z" fill="${c}"/>`;

const GLASSES = [
  '',
  `<g fill="none" stroke="#3b3b3b" stroke-width="1.7"><circle cx="43" cy="45.5" r="5.6"/><circle cx="57" cy="45.5" r="5.6"/><path d="M48.6 45.2h2.8"/></g>`,
  `<g fill="rgba(255,255,255,.12)" stroke="#2b2924" stroke-width="2"><rect x="36.5" y="41" width="12" height="9" rx="2"/><rect x="51.5" y="41" width="12" height="9" rx="2"/><path d="M48.5 45h3" fill="none"/></g>`,
  `<g><rect x="35.5" y="40.5" width="12.5" height="8.5" rx="3.5" fill="#151515"/><rect x="52" y="40.5" width="12.5" height="8.5" rx="3.5" fill="#151515"/><rect x="47" y="42.5" width="6" height="2" fill="#151515"/><path d="M38 43 l3 -1.5 M54.5 43 l3 -1.5" stroke="#fff" stroke-width="1.2" opacity=".7"/></g>`,
];

const BINDI = '<circle cx="50" cy="36.5" r="1.6" fill="#c8372d"/>';
const JASMINE =
  '<g fill="#fffaf0" stroke="#e7dcc0" stroke-width=".6"><circle cx="70.5" cy="33" r="2.3"/><circle cx="73.5" cy="37.5" r="2.3"/><circle cx="75" cy="42.5" r="2.3"/><circle cx="75.3" cy="47.5" r="2.3"/><circle cx="74.5" cy="52.5" r="2.3"/></g>';
const EARRINGS =
  '<g fill="#d9a520"><path d="M26.5 51 h4.5 l2.2 5.5 h-8.9z"/><circle cx="28.8" cy="58.3" r="1.3"/><path d="M69 51 h4.5 l2.2 5.5 h-8.9z"/><circle cx="71.3" cy="58.3" r="1.3"/></g>';
const HEADPHONES =
  '<path d="M27 47 C25 15 75 15 73 47" stroke="#2b2924" stroke-width="3.6" fill="none" stroke-linecap="round"/>' +
  '<rect x="22.5" y="40" width="10" height="15" rx="4" fill="#2b2924"/><rect x="67.5" y="40" width="10" height="15" rx="4" fill="#2b2924"/>' +
  '<rect x="24.5" y="42.5" width="3" height="10" rx="1.5" fill="#e4572e"/><rect x="72.5" y="42.5" width="3" height="10" rx="1.5" fill="#e4572e"/>';
const GOLD_CHAIN = '<path d="M40 75.5 Q50 89 60 75.5" fill="none" stroke="#d9a520" stroke-width="1.8"/><circle cx="50" cy="83" r="2" fill="#d9a520"/>';

/** The skin tone of a look (used for the hands in the pile). */
export function skinOf(avatar) {
  const a = normalizeAvatar(avatar) || DEFAULT;
  return SKINS[a.skin];
}

/** An SVG string for a look in a player colour. Only our own markup; no player text. */
export function avatarSVG(avatar, color) {
  const a = normalizeAvatar(avatar) || DEFAULT;
  const skin = SKINS[a.skin];
  const hc = HAIR_COLORS[a.hairColor];
  const shirt = safeColor(color);
  const [back, front] = HAIR[a.hair](hc, shirt);
  const moustache = a.face === 1 || a.face === 3 ? THIN_MOUSTACHE(hc) : a.face === 2 ? BIG_MOUSTACHE(hc) : '';
  return (
    '<svg class="av" viewBox="0 0 100 100" aria-hidden="true">' +
    back +
    `<path d="M13 100 C15 82 30 73.5 50 73.5 C70 73.5 85 82 87 100 Z" fill="${shirt}"/>` +
    '<path d="M44 75 L50 82 L56 75" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="2"/>' +
    (a.extra === 5 ? GOLD_CHAIN : '') +
    `<rect x="44" y="60" width="12" height="16" rx="5" fill="${skin}"/>` +
    `<circle cx="29.5" cy="47" r="4.8" fill="${skin}"/><circle cx="70.5" cy="47" r="4.8" fill="${skin}"/>` +
    `<circle cx="50" cy="44.5" r="20.5" fill="${skin}"/>` +
    (a.extra === 1 ? BINDI : '') +
    brows(hc) +
    front +
    (a.face === 3 ? BEARD(hc) : '') +
    mouths +
    moustache +
    eyes +
    GLASSES[a.eyes] +
    (a.extra === 2 ? JASMINE : a.extra === 3 ? EARRINGS : a.extra === 4 ? HEADPHONES : '') +
    '</svg>'
  );
}
