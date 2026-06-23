// Global concurrency gate for yt-dlp spawns.
//
// A burst of simultaneous /play commands would otherwise spawn one yt-dlp
// (each pulling in Python + the Deno JS-challenge runtime) per request, all at
// once — the spike that pins this 2-core LXC. This gate caps how many run in
// parallel; requests past the cap wait their turn in FIFO order. Since /play
// already defers its reply (15-minute window), a few seconds queued is fine.
//
// Tune at runtime with YTDLP_MAX_CONCURRENT (no redeploy needed); defaults to 3.
const MAX = Math.max(1, Number(process.env.YTDLP_MAX_CONCURRENT) || 3);

let active = 0;
const waiters = [];

function acquire() {
  if (active < MAX) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function release() {
  const next = waiters.shift();
  // Hand the freed slot straight to the next waiter (active count unchanged);
  // only drop active when nobody is waiting.
  if (next) next();
  else active--;
}

// Run `task` once a slot is free, always releasing the slot afterwards.
export function withYtdlpSlot(task) {
  return acquire().then(async () => {
    try {
      return await task();
    } finally {
      release();
    }
  });
}
