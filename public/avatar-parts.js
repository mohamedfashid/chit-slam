// The parts a character is built from. Shared by the server (to check what
// players send) and the browser (to draw them and build the editor).

export const PARTS = {
  skin: ['Light', 'Wheat', 'Tan', 'Brown', 'Deep brown', 'Dark'],
  hair: ['Short', 'Side part', 'Spiky', 'Curly', 'Buzz cut', 'Long', 'Bob', 'Braid', 'Bun', 'Ponytail', 'Cap', 'Beanie'],
  hairColor: ['Black', 'Dark brown', 'Auburn', 'Blue'],
  eyes: ['Plain', 'Round glasses', 'Square glasses', 'Sunglasses'],
  face: ['Clean', 'Moustache', 'Big moustache', 'Beard'],
  extra: ['None', 'Bindi', 'Jasmine', 'Earrings', 'Headphones', 'Gold chain'],
};

export const PART_KEYS = Object.keys(PARTS);

export const PART_TITLES = {
  skin: 'Skin',
  hair: 'Hair',
  hairColor: 'Hair colour',
  eyes: 'Eyes',
  face: 'Face',
  extra: 'Extra',
};

/** A random look. randInt(n) must return an integer in 0..n-1. */
export function randomAvatar(randInt) {
  const a = {};
  for (const k of PART_KEYS) a[k] = randInt(PARTS[k].length);
  // Keep most faces simple: glasses, facial hair and extras turn up now and then.
  if (randInt(2)) a.eyes = 0;
  if (randInt(2)) a.face = 0;
  if (randInt(2)) a.extra = 0;
  if (randInt(4)) a.hairColor = Math.min(a.hairColor, 1); // mostly black / dark brown
  return a;
}

/** A clean copy of a look, or null if anything is missing or out of range. */
export function normalizeAvatar(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const out = {};
  for (const k of PART_KEYS) {
    const v = a[k];
    if (!Number.isInteger(v) || v < 0 || v >= PARTS[k].length) return null;
    out[k] = v;
  }
  return out;
}
