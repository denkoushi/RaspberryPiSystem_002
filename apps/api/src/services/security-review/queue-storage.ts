import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { securityReviewFindingSchema } from './report-schema.js';

export const queueFolders = ['pending', 'claimed', 'done', 'failed', 'progress', 'invalid'] as const;
const sha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const jobSchema = z.object({ version: z.literal(1), sha, parent: sha.nullable(),
  committedAt: z.string().datetime({ offset: true }), enqueuedAt: z.string().datetime({ offset: true }),
  files: z.array(z.object({ path: z.string(), diff: z.string() }).strict()),
  bytes: z.number().int().nonnegative(), omittedFiles: z.number().int().nonnegative(),
}).strict();
export const resultSchema = z.object({ version: z.literal(1), sha, committedAt: z.string().datetime({ offset: true }),
  finishedAt: z.string().datetime({ offset: true }), status: z.enum(['done', 'failed']), units: z.number().int().nonnegative(),
  failedUnits: z.array(z.object({ path: z.string(), reason: z.string() }).strict()),
  findings: z.array(securityReviewFindingSchema), reportedAt: z.string().datetime({ offset: true }).nullable(),
}).strict();
export type QueueResult = z.infer<typeof resultSchema>;
export async function atomicJson(filename: string, value: unknown) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, filename);
  } finally { await rm(temporary, { force: true }); }
}
export async function ensureQueue(dataDir: string) {
  for (const folder of queueFolders) await mkdir(path.join(dataDir, 'queue', folder), { recursive: true, mode: 0o700 });
}
export async function queueNames(dataDir: string, folder: typeof queueFolders[number]) {
  return (await readdir(path.join(dataDir, 'queue', folder))).filter(name => /^(?:[a-f0-9]{40}|[a-f0-9]{64})\.json$/.test(name));
}
// Only malformed data is quarantined; filesystem failures remain visible to callers.
export async function quarantine(dataDir: string, folder: string, name: string) {
  try { await rename(path.join(dataDir, 'queue', folder, name), path.join(dataDir, 'queue/invalid', `${folder}-${name}`)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
export async function readQueueJson<T>(dataDir: string, folder: typeof queueFolders[number], name: string, schema: z.ZodType<T>): Promise<T | null> {
  try { return schema.parse(JSON.parse(await readFile(path.join(dataDir, 'queue', folder, name), 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (!(error instanceof SyntaxError || error instanceof z.ZodError)) throw error;
    await quarantine(dataDir, folder, name);
    return null;
  }
}
export async function readQueueResults(dataDir: string) {
  await ensureQueue(dataDir);
  const results: { filename: string; result: QueueResult }[] = [];
  for (const folder of ['done', 'failed'] as const) {
    for (const name of await queueNames(dataDir, folder)) {
      const filename = path.join(dataDir, 'queue', folder, name);
      const result = await readQueueJson(dataDir, folder, name, resultSchema);
      if (result && result.reportedAt === null) results.push({ filename, result });
    }
  }
  return results.sort((a, b) => a.result.committedAt.localeCompare(b.result.committedAt) || a.result.sha.localeCompare(b.result.sha));
}
export async function queueCounts(dataDir: string) {
  await ensureQueue(dataDir);
  for (const folder of ['done', 'failed'] as const) {
    for (const name of await queueNames(dataDir, folder)) await readQueueJson(dataDir, folder, name, resultSchema);
  }
  const pending = await queueNames(dataDir, 'pending');
  const dates = [];
  for (const name of pending) {
    const job = await readQueueJson(dataDir, 'pending', name, jobSchema);
    if (job) dates.push(job.committedAt);
  }
  return { pending: dates.length, claimed: (await queueNames(dataDir, 'claimed')).length,
    failed: (await queueNames(dataDir, 'failed')).length, invalid: (await readdir(path.join(dataDir, 'queue/invalid'))).length, oldestPendingCommittedAt: dates.sort()[0] ?? null };
}
// Nightly marks its intent before waiting for an in-flight queue call. The queue
// checks this flag before every call, including schema retries and split units.
export const reviewActivity: { nightly: boolean; queueUnit: Promise<unknown> | null } = { nightly: false, queueUnit: null };
