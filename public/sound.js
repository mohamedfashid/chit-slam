// Tiny synthesized sounds - no audio files, nothing loaded from elsewhere.

let ctx = null;
let muted = false;

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

export function setMuted(m) {
  muted = m;
}

const ready = () => ctx && !muted && ctx.state === 'running';

function noise(seconds) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

function envelope(vol, start, dur) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(Math.max(vol, 0.0002), start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  g.connect(ctx.destination);
  return g;
}

// A hand hitting the floor. level 0 = the first, quiet slam; louder as the pile grows.
export function thud(level = 0) {
  if (!ready()) return;
  const t = ctx.currentTime;
  const vol = Math.min(0.9, 0.1 + level * 0.2);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);
  osc.connect(envelope(vol, t, 0.25));
  osc.start(t);
  osc.stop(t + 0.3);
  const n = noise(0.08);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  n.connect(lp).connect(envelope(vol * 0.7, t, 0.08));
  n.start(t);
}

// Paper sliding across the floor.
export function swish(vol = 0.07) {
  if (!ready()) return;
  const t = ctx.currentTime;
  const n = noise(0.14);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(1800, t);
  bp.frequency.linearRampToValueAtTime(3200, t + 0.12);
  n.connect(bp).connect(envelope(vol, t, 0.14));
  n.start(t);
}

export function blip(freq = 660, dur = 0.12, vol = 0.12, type = 'triangle', delay = 0) {
  if (!ready()) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.connect(envelope(vol, t, dur));
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const buzz = () => blip(110, 0.3, 0.12, 'sawtooth');
export const win = () => [523, 659, 784, 1046].forEach((f, i) => blip(f, 0.18, 0.12, 'triangle', i * 0.1));
export const sad = () => [392, 330, 262].forEach((f, i) => blip(f, 0.22, 0.1, 'triangle', i * 0.16));
