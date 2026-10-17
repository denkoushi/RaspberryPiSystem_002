import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

// Answer receipts in the API log disappear when a release replaces the container, so misses and
// timeouts could not be counted across days. The same receipt, plus the shown record ids and the
// session id, is appended to one file per Tokyo day on the persistent Hermes storage volume.
// Record text is never written; the question text is, so files older than the retention are removed.
export const DEFAULT_RECEIPT_DIR = '/app/storage/hermes-search/runtime/receipts';
export const RECEIPT_RETENTION_DAYS = 90;
const FILE_PATTERN = /^receipts-(\d{4}-\d{2}-\d{2})\.jsonl$/u;

export type ReceiptLog = { append(entry: Record<string, unknown>): Promise<void> };

export function receiptLogDir(env: NodeJS.ProcessEnv = process.env) {
  return env.HERMES_SEARCH_RECEIPT_DIR || DEFAULT_RECEIPT_DIR;
}

export function tokyoDay(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function dayBefore(day: string, days: number) {
  const date = new Date(`${day}T00:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() - days);
  return tokyoDay(date);
}

async function prune(dir: string, today: string, retentionDays: number) {
  const cutoff = dayBefore(today, retentionDays);
  for (const name of await readdir(dir)) {
    const match = FILE_PATTERN.exec(name);
    if (match && match[1] < cutoff) await unlink(path.join(dir, name)).catch(() => {});
  }
}

export function createReceiptLog({
  dir = receiptLogDir(),
  now = () => new Date(),
  retentionDays = RECEIPT_RETENTION_DAYS,
}: { dir?: string; now?: () => Date; retentionDays?: number } = {}): ReceiptLog {
  let prunedFor = '';
  let chain: Promise<void> = Promise.resolve();
  return {
    append(entry) {
      const at = now();
      const day = tokyoDay(at);
      // Writes are serialized so lines never interleave; a failed write never reaches the answer.
      chain = chain.then(async () => {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await appendFile(path.join(dir, `receipts-${day}.jsonl`), `${JSON.stringify({ at: at.toISOString(), ...entry })}\n`, { mode: 0o600 });
        if (prunedFor !== day) {
          prunedFor = day;
          await prune(dir, day, retentionDays);
        }
      }).catch(() => {});
      return chain;
    },
  };
}
