/**
 * Minimal sound layer: a few synthesized tones via the Web Audio API, no
 * audio files. Off by default per the brief; the player has to turn it on.
 * This module is intentionally the only place that touches AudioContext —
 * everything else just calls playDelivered()/playGaveUp() and doesn't know
 * or care whether sound is currently enabled.
 */

let audioContext: AudioContext | null = null;
let enabled = false;

function getContext(): AudioContext {
  audioContext ??= new AudioContext();
  return audioContext;
}

export function setSoundEnabled(value: boolean): void {
  enabled = value;
}

export function isSoundEnabled(): boolean {
  return enabled;
}

function beep(frequency: number, durationSeconds: number, type: OscillatorType, gainValue: number): void {
  if (!enabled) return;
  const ctx = getContext();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(gainValue, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationSeconds);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + durationSeconds);
}

/** A passenger reached their floor. */
export function playDelivered(): void {
  beep(880, 0.12, 'sine', 0.05);
}

/** A passenger gave up and took the stairs. */
export function playGaveUp(): void {
  beep(180, 0.3, 'sawtooth', 0.06);
}
