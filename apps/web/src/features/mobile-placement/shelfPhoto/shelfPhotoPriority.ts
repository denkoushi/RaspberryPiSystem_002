// Shelf photo grids can hold hundreds of tiles. Tiles near the viewport fetch at once; the rest are
// still fetched (so every photo stays cached for offline use) but later, at idle, a few at a time.
// Kept below the per-host connection limit so a tile scrolled into view is not queued behind background fetches.
const BACKGROUND_CONCURRENCY = 4;

const observers = new Map<Element | null, { observer: IntersectionObserver; targets: Map<Element, () => void> }>();

function scrollRoot(el: Element): Element | null {
  for (let node = el.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return node;
  }
  return null;
}

/** Synchronous version of the observer test, so tiles already on screen show their photo without waiting a frame. */
export function isNearViewport(el: Element): boolean {
  const root = scrollRoot(el);
  const box = root ? root.getBoundingClientRect() : { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
  const rect = el.getBoundingClientRect();
  const margin = box.bottom - box.top;
  if (!rect.width && !rect.height) return false;
  return rect.bottom >= box.top - margin && rect.top <= box.bottom + margin && rect.right >= box.left && rect.left <= box.right;
}

/** Calls `onNear` once `el` is within about one screen of its scroll container. Returns an unsubscribe. */
export function observeNearViewport(el: Element, onNear: () => void): () => void {
  const root = scrollRoot(el);
  let entry = observers.get(root);
  if (!entry) {
    const targets = new Map<Element, () => void>();
    const observer = new IntersectionObserver((records) => {
      for (const record of records) {
        if (!record.isIntersecting) continue;
        const callback = targets.get(record.target);
        if (!callback) continue;
        unobserve(root, record.target);
        callback();
      }
    }, { root, rootMargin: '100% 0px' });
    entry = { observer, targets };
    observers.set(root, entry);
  }
  entry.targets.set(el, onNear);
  entry.observer.observe(el);
  return () => unobserve(root, el);
}

function unobserve(root: Element | null, el: Element) {
  const entry = observers.get(root);
  if (!entry || !entry.targets.delete(el)) return;
  entry.observer.unobserve(el);
  if (!entry.targets.size) { entry.observer.disconnect(); observers.delete(root); }
}

type Job = () => Promise<unknown>;
const queue: Job[] = [];
let running = 0;
let scheduled = false;

function schedule() {
  if (scheduled || running >= BACKGROUND_CONCURRENCY || !queue.length) return;
  scheduled = true;
  const run = () => { scheduled = false; pump(); };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1000 });
  else setTimeout(run, 50);
}

function pump() {
  while (running < BACKGROUND_CONCURRENCY && queue.length) {
    const job = queue.shift()!;
    running++;
    void job().catch(() => undefined).finally(() => { running--; schedule(); });
  }
}

/** Queues a low-priority fetch. Returns a cancel that drops the job if it has not started yet. */
export function enqueueBackgroundShelfPhoto(job: Job): () => void {
  queue.push(job);
  schedule();
  return () => {
    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
  };
}
