export class VisualizationImageCache {
  private readonly entries = new Map<string, { buffer: Buffer; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<Buffer>>();

  constructor(private readonly now: () => number = Date.now) {}

  async get(id: string, render: () => Promise<Buffer>): Promise<Buffer> {
    const cached = this.entries.get(id);
    if (cached && cached.expiresAt > this.now()) return cached.buffer;
    this.entries.delete(id);

    const pending = this.inFlight.get(id);
    if (pending) return pending;

    const result = Promise.resolve().then(render).then((buffer) => {
      this.entries.set(id, { buffer, expiresAt: this.now() + 30_000 });
      if (this.entries.size > 50) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
      return buffer;
    }).finally(() => {
      this.inFlight.delete(id);
    });
    this.inFlight.set(id, result);
    return result;
  }
}
