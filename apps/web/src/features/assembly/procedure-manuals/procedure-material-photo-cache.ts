type Entry = { promise: Promise<string>; resolve: (url: string) => void; reject: (error: unknown) => void;
  load: () => Promise<Blob>; users: number; started: boolean; url?: string; bytes: number; epoch: number };

export class ProcedureMaterialPhotoCache {
  private readonly entries = new Map<string, Entry>();
  private readonly urls = new Set<string>();
  private readonly queue: Array<[string, Entry]> = [];
  private active = 0;
  private epoch = 0;
  private byteSize = 0;

  request(key: string, load: () => Promise<Blob>) {
    let entry = this.entries.get(key);
    if (!entry) {
      let resolve!: Entry['resolve']; let reject!: Entry['reject'];
      const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
      entry = { promise, resolve, reject, load, users: 0, started: false, bytes: 0, epoch: this.epoch };
      this.entries.set(key, entry); this.queue.push([key, entry]);
    } else { this.entries.delete(key); this.entries.set(key, entry); }
    const current = entry;
    current.users++;
    this.pump();
    let released = false;
    return { promise: current.promise, release: () => {
      if (released) return;
      released = true; current.users--;
      if (!current.started && !current.users) {
        if (this.entries.get(key) === current) this.entries.delete(key); current.reject(new Error('cancelled'));
        const index = this.queue.findIndex(([, item]) => item === current);
        if (index >= 0) this.queue.splice(index, 1);
      }
      if (!current.users && current.url && this.entries.get(key) !== current) this.revoke(current.url);
    } };
  }

  private pump() {
    while (this.active < 6 && this.queue.length) {
      const [key, entry] = this.queue.shift()!;
      entry.started = true; this.active++;
      void Promise.resolve().then(entry.load).then((blob) => {
        if (entry.epoch !== this.epoch) throw new Error('closed');
        entry.url = URL.createObjectURL(blob); entry.bytes = blob.size;
        this.urls.add(entry.url); this.byteSize += blob.size;
        entry.resolve(entry.url);
        this.trim();
      }).catch((error: unknown) => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
        entry.reject(error);
      }).finally(() => { this.active--; this.pump(); });
    }
  }

  private trim() {
    let count = [...this.entries.values()].filter((entry) => entry.url).length;
    for (const [key, entry] of this.entries) {
      if (count <= 256 && this.byteSize <= 32 * 1024 * 1024) break;
      if (!entry.url) continue;
      this.entries.delete(key); this.byteSize -= entry.bytes; count--;
      // Mounted cards own a lease so eviction cannot revoke an image they still display.
      if (!entry.users) this.revoke(entry.url);
    }
  }

  private revoke(url: string) { if (this.urls.delete(url)) URL.revokeObjectURL(url); }

  clear() {
    this.epoch++;
    for (const entry of this.entries.values()) if (!entry.started) entry.reject(new Error('closed'));
    this.queue.length = 0; this.entries.clear(); this.byteSize = 0;
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}
