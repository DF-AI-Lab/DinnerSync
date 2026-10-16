// A plain countdown timer. No DOM access. Times are passed in as `now` (ms),
// so the logic is easy to test.
//
// `left` is the time left when the timer was last paused or changed. While
// running, `startedAt` is when it last (re)started and the time left is
// computed from it.

export function createCountdown() {
  let left = 0;          // ms left as of the last change, while not running
  let total = 0;         // ms added since the last reset (the ring's full circle)
  let startedAt = null;  // ms when the timer last started, null when stopped
  let done = false;      // true once it has hit 0 (until reset or more time added)

  // When the timer hits 0 it stops: running becomes false and done is set.
  function sync(now) {
    if (startedAt === null) return;
    if (now - startedAt >= left) {
      left = 0;
      startedAt = null;
      done = true;
    }
  }

  const remaining = now => {
    sync(now);
    if (startedAt === null) return left;
    return Math.max(0, left - (now - startedAt));
  };

  const api = {
    running: false,

    add(seconds, now) {
      // Bank the time already run, then add. A running timer keeps running.
      const current = remaining(now);
      left = current + seconds * 1000;
      total += seconds * 1000;
      if (startedAt !== null) startedAt = now;
      done = false;
      api.running = startedAt !== null;
    },

    start(now) {
      sync(now);
      if (startedAt !== null || left <= 0) return;
      startedAt = now;
      api.running = true;
    },

    pause(now) {
      sync(now);
      if (startedAt === null) return;
      left = remaining(now);
      startedAt = null;
      api.running = false;
    },

    reset() {
      left = 0;
      total = 0;
      startedAt = null;
      done = false;
      api.running = false;
    },

    remaining,

    fraction(now) {
      return total > 0 ? remaining(now) / total : 0;
    },

    finished(now) {
      sync(now);
      api.running = startedAt !== null;
      return done;
    },
  };
  return api;
}
