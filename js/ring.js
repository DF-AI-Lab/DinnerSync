// Near-silent loop that keeps the page running while cooking: a low hum at about -60 dBFS.
// Perfect silence is not enough: Chrome treats a silent tab as not playing and may pause it when the phone locks.
export const KEEP_ALIVE = {
  seconds: 1,
  hz: 30,          // too low for a phone speaker to really play; whole cycles per loop so it repeats without a click
  amplitude: 33,   // of 32767, about -60 dBFS
};

// One loop of the hum as a full WAV file: 44-byte header + 16-bit signed mono PCM.
export function keepAliveWav(rate = 8000) {
  const n = Math.round(KEEP_ALIVE.seconds * rate);
  const view = new DataView(new ArrayBuffer(44 + n * 2));
  const text = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    view.setInt16(44 + i * 2, Math.round(KEEP_ALIVE.amplitude * Math.sin(2 * Math.PI * KEEP_ALIVE.hz * i / rate)), true);
  }
  return new Uint8Array(view.buffer);
}
