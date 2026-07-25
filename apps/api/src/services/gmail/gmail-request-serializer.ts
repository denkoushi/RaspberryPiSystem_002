export interface GmailRequestSerializer {
  runExclusive<T>(operation: string, task: () => Promise<T>): Promise<T>;
}

/**
 * One-process FIFO serializer for individual Gmail API requests.
 *
 * It intentionally does not serialize a complete import. Callers release the queue while
 * converting documents, parsing CSV, writing the database, or waiting for a cooldown.
 */
export class ProcessWideFifoGmailRequestSerializer implements GmailRequestSerializer {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(operation: string, task: () => Promise<T>): Promise<T> {
    void operation;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const predecessor = this.tail;
    this.tail = predecessor.catch(() => undefined).then(() => current);

    await predecessor.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
    }
  }
}

export const sharedGmailRequestSerializer: GmailRequestSerializer =
  new ProcessWideFifoGmailRequestSerializer();
