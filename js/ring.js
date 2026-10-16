// Phone-style ring for the cooking alarm: 8-bit mono WAV, played through the keep-alive <audio> element.
export const RING = {
  loopSeconds: 3,
  bursts: [[0, 0.4], [0.6, 1.0]], // ringing parts of one loop, in seconds; the rest is silence
  fadeSeconds: 0.01,              // fade in/out at each burst edge, avoids clicks
  peak: 120,                      // peak distance from silence (128)
};

// One loop of the ring as a full WAV file: 44-byte header + 8-bit unsigned PCM (silence = 128).
export function ringWav(rate = 8000) {
  const n = Math.round(RING.loopSeconds * rate);
  const view = new DataView(new ArrayBuffer(44 + n));
  const text = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + n, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  text(36, 'data'); view.setUint32(40, n, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let v = 128;
    for (const [from, to] of RING.bursts) {
      if (t < from || t >= to) continue;
      // two sines at 440 + 480 Hz, scaled so the sum peaks at RING.peak
      const fade = Math.min(1, (t - from) / RING.fadeSeconds, (to - t) / RING.fadeSeconds);
      const wave = Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t);
      v = 128 + (RING.peak / 2) * wave * fade;
      break;
    }
    view.setUint8(44 + i, Math.max(0, Math.min(255, Math.round(v))));
  }
  return new Uint8Array(view.buffer);
}
