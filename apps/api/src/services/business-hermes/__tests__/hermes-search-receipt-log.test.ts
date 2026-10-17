import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createReceiptLog, tokyoDay } from '../hermes-search-receipt-log.js';

describe('Hermes search receipt log', () => {
  it('appends one line per answer to a Tokyo-day file and removes files past the retention', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hermes-receipts-'));
    await writeFile(path.join(dir, 'receipts-2026-01-01.jsonl'), '{}\n');
    await writeFile(path.join(dir, 'receipts-2026-09-20.jsonl'), '{}\n');
    await writeFile(path.join(dir, 'other.txt'), 'keep');
    const log = createReceiptLog({ dir, now: () => new Date('2026-09-28T16:30:00Z'), retentionDays: 90 });
    await log.append({ sessionId: 's1', recordIds: ['r1'], hermesReceipt: { outcome: 'answer', question: 'q1' } });
    await log.append({ sessionId: 's1', recordIds: [], hermesReceipt: { outcome: 'no_result', question: 'q2' } });
    expect(tokyoDay(new Date('2026-09-28T16:30:00Z'))).toBe('2026-09-29');
    const lines = (await readFile(path.join(dir, 'receipts-2026-09-29.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(lines.map((line) => line.hermesReceipt.question)).toEqual(['q1', 'q2']);
    expect(lines[0]).toMatchObject({ at: '2026-09-28T16:30:00.000Z', sessionId: 's1', recordIds: ['r1'] });
    expect((await readdir(dir)).sort()).toEqual(['other.txt', 'receipts-2026-09-20.jsonl', 'receipts-2026-09-29.jsonl']);
  });

  it('swallows a write failure so the answer is not affected', async () => {
    const log = createReceiptLog({ dir: '/dev/null/not-a-dir' });
    await expect(log.append({ hermesReceipt: { question: 'q' } })).resolves.toBeUndefined();
  });
});
