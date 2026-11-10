import { rename, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { logger } from '../../lib/logger.js';
import type { TextCompletionPort } from '../inference/ports/text-completion.port.js';
import { MATERIAL_BYTES, redactCode, splitBytes } from './material.js';
import { completeReview, completionError, halveMaterial, loadKnown, timedOut, unavailable } from './review-completion.js';
import { atomicJson, ensureQueue, jobSchema, quarantine, readQueueJson, queueNames, resultSchema, reviewActivity } from './queue-storage.js';
import { securityReviewFindingSchema } from './report-schema.js';

const unitSchema = z.object({ id: z.string(), path: z.string(), paths: z.array(z.string()).optional(), text: z.string(), attempts: z.number().int().nonnegative().default(0),
  vagueAttempts: z.number().int().nonnegative().default(0), retryAfter: z.string().datetime({ offset: true }).optional(),
  result: z.object({ findings: z.array(securityReviewFindingSchema), refusedOrVague: z.boolean(), vagueReason: z.string().min(1).transform(value => value.slice(0, 200)).optional(), error: z.string().optional() }).strict().optional(),
}).strict();
const progressSchema = z.object({ version: z.literal(1), sha: jobSchema.shape.sha, units: z.array(unitSchema) }).strict();
type Unit = z.infer<typeof unitSchema>;
class QueuePaused extends Error {}
export function quietTime(now: Date, quiet: string) {
  const [start, end] = quiet.split('-');
  const time = new Date(now.getTime() + 9 * 60 * 60_000).toISOString().slice(11, 16);
  return start! <= end! ? time >= start! && time < end! : time >= start! || time < end!;
}
export function jobUnits(files: { path: string; diff: string }[]): Unit[] {
  const units: Unit[] = [];
  const add = (paths: string[], text: string) => units.push({ id: String(units.length), path: paths[0]!, paths, text, attempts: 0, vagueAttempts: 0 });
  let paths: string[] = []; let packed = '';
  const flush = () => { if (packed) add(paths, packed); paths = []; packed = ''; };
  for (const file of files) {
    const text = redactCode(file.diff);
    if (!text) continue;
    if (Buffer.byteLength(text) <= MATERIAL_BYTES) {
      if (Buffer.byteLength(packed + '\n' + text) > MATERIAL_BYTES) flush();
      packed += (packed ? '\n' : '') + text; paths.push(file.path);
      continue;
    }
    flush();
    const header = `--- ${splitBytes(file.path, 500)[0]} (continued) ---\n`;
    const cap = MATERIAL_BYTES - Buffer.byteLength(header);
    // Only an over-long line may be split at UTF-8 byte boundaries.
    // Only an over-long line is split at UTF-8 boundaries; the first piece has no header.
    const lines = (text.match(/[^\n]*\n|[^\n]+/g) ?? []).flatMap((line, index) => {
      if (Buffer.byteLength(line) <= (index ? cap : MATERIAL_BYTES)) return [line];
      const first = index ? '' : splitBytes(line)[0]!;
      return [...(first ? [first] : []), ...splitBytes(line.slice(first.length), cap)];
    });
    const sizes = lines.map(line => Buffer.byteLength(line));
    const sums = [0];
    for (const size of sizes) sums.push(sums.at(-1)! + size);
    // Minimum continuation pieces needed for each suffix, using greedy line packing.
    const needed = Array<number>(lines.length + 1).fill(0);
    let end = lines.length;
    for (let start = lines.length - 1; start >= 0; start--) {
      while (end > start + 1 && sums[end]! - sums[start]! > cap) end--;
      needed[start] = 1 + needed[end]!;
    }
    let firstEnd = 0;
    while (firstEnd < lines.length && sums[firstEnd + 1]! <= MATERIAL_BYTES) firstEnd++;
    let pieces = 1 + needed[firstEnd]!;
    for (let start = 0; start < lines.length; pieces--) {
      const budget = start === 0 ? MATERIAL_BYTES : cap;
      const target = (sums.at(-1)! - sums[start]!) / pieces;
      let best = start + 1; let distance = Infinity;
      for (let next = start + 1; next <= lines.length && sums[next]! - sums[start]! <= budget; next++) {
        if (needed[next]! > pieces - 1 || lines.length - next < pieces - 1) continue;
        const delta = Math.abs(sums[next]! - sums[start]! - target);
        if (delta < distance) { best = next; distance = delta; }
      }
      add([file.path], (start ? header : '') + lines.slice(start, best).join(''));
      start = best;
    }
  }
  flush();
  return units;
}
type Dependencies = { dataDir: string; quiet: string; completion: TextCompletionPort; now?: () => Date };
export class SecurityReviewQueueService {
  private active = false;
  constructor(private readonly deps: Dependencies) {}
  async tick(signal: AbortSignal): Promise<void> {
    if (this.active) return;
    this.active = true;
    try { await this.process(signal); } finally { this.active = false; }
  }
  private async process(signal: AbortSignal) {
    const now = this.deps.now ?? (() => new Date());
    const blocked = () => signal.aborted || reviewActivity.nightly || quietTime(now(), this.deps.quiet);
    if (blocked()) return;
    const root = path.join(this.deps.dataDir, 'queue');
    await ensureQueue(this.deps.dataDir);
    for (const name of await queueNames(this.deps.dataDir, 'claimed')) {
      const filename = path.join(root, 'claimed', name);
      try {
        if (now().getTime() - (await stat(filename)).mtimeMs >= 2 * 60 * 60_000) await rename(filename, path.join(root, 'pending', name));
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const pending = [];
    for (const name of await queueNames(this.deps.dataDir, 'pending')) {
      const job = await readQueueJson(this.deps.dataDir, 'pending', name, jobSchema);
      if (job) pending.push({ name, job });
    }
    pending.sort((a, b) => a.job.committedAt.localeCompare(b.job.committedAt) || a.job.enqueuedAt.localeCompare(b.job.enqueuedAt) || a.name.localeCompare(b.name));
    jobs: for (const { name, job } of pending) {
      if (blocked()) return;
      const claimed = path.join(root, 'claimed', name);
      try { await rename(path.join(root, 'pending', name), claimed); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      const progressFile = path.join(root, 'progress', name);
      let finished = false;
      try {
        await utimes(claimed, now(), now());
        // A crash after publishing a result but before removing claimed must not review it again.
        let published = false;
        for (const folder of ['done', 'failed'] as const) {
          if (await readQueueJson(this.deps.dataDir, folder, name, resultSchema)) published = true;
        }
        if (published) { finished = true; continue; }
        let progress = await readQueueJson(this.deps.dataDir, 'progress', name, progressSchema);
        if (progress && progress.sha !== job.sha) {
          await quarantine(this.deps.dataDir, 'progress', name);
          progress = null;
        }
        if (!progress) {
          progress = { version: 1 as const, sha: job.sha, units: jobUnits(job.files) };
          await atomicJson(progressFile, progress);
        }
        if (progress.units.some(unit => unit.retryAfter && Date.parse(unit.retryAfter) > now().getTime())) continue;
        const known = await loadKnown(this.deps.dataDir);
        for (let index = 0; index < progress.units.length; index++) {
          const unit = progress.units[index]!;
          if (unit.result) continue;
          if (blocked()) return;
          try {
            const call = completeReview(this.deps.completion, { id: `${(unit.paths ?? [unit.path]).join(', ')}#${unit.id}`, kind: 'changes', text: unit.text,
              reviewedElsewhere: [...new Set(progress.units.filter(other => other !== unit).flatMap(other => other.paths ?? [other.path]))].slice(0, 50) }, known, signal, () => {
              if (blocked()) throw new QueuePaused();
            });
            reviewActivity.queueUnit = call;
            let answer;
            try { answer = await call; } finally { reviewActivity.queueUnit = null; }
            if (answer.length) {
              const halves = halveMaterial(unit.text);
              if (halves) {
                progress.units.splice(index, 1, ...halves.map((text, half) => ({ id: `${unit.id}.${half}`, path: unit.path, paths: unit.paths, text, attempts: 0, vagueAttempts: 0 })));
                index--;
              } else unit.result = { findings: [], refusedOrVague: false, error: 'length_at_minimum_unit' };
            } else {
              delete unit.retryAfter;
              if (answer.refusedOrVague) {
                unit.vagueAttempts++;
                if (unit.vagueAttempts < 3) {
                  unit.retryAfter = new Date(now().getTime() + 30 * 60_000).toISOString();
                  await atomicJson(progressFile, progress);
                  logger.warn({ sha: job.sha, path: (unit.paths ?? [unit.path]).join(', ').slice(0, 500), vagueAttempts: unit.vagueAttempts, vagueReason: answer.vagueReason }, 'Security review retry scheduled');
                  continue jobs;
                }
              }
              unit.result = { findings: answer.findings, refusedOrVague: answer.refusedOrVague,
                ...(answer.refusedOrVague ? { error: 'refused_or_vague', vagueReason: answer.vagueReason } : {}) };
            }
          } catch (error) {
            if (error instanceof QueuePaused || unavailable(error) || signal.aborted) return;
            if (timedOut(error)) {
              unit.attempts++;
              if (unit.attempts >= 2) {
                const halves = halveMaterial(unit.text);
                if (halves) progress.units.splice(index, 1, ...halves.map((text, half) => ({ id: `${unit.id}.${half}`, path: unit.path, paths: unit.paths, text, attempts: 0, vagueAttempts: 0 })));
                else unit.result = { findings: [], refusedOrVague: false, error: 'timeout_at_minimum_unit' };
              }
              if (!unit.result) index--;
            } else unit.result = { findings: [], refusedOrVague: false, error: completionError(error) };
          }
          await atomicJson(progressFile, progress);
          await utimes(claimed, now(), now());
        }
        const failedUnits = progress.units.filter(unit => unit.result?.error).map(unit => ({ path: unit.path, paths: unit.paths, reason: unit.result!.error!, detail: unit.result!.vagueReason }));
        const result = resultSchema.parse({ version: 1, sha: job.sha, committedAt: job.committedAt, finishedAt: now().toISOString(),
          status: failedUnits.length ? 'failed' : 'done', units: progress.units.length, failedUnits,
          findings: progress.units.flatMap(unit => unit.result!.findings), reportedAt: null });
        await atomicJson(path.join(root, result.status, name), result);
        finished = true;
      } finally {
        if (finished) { await rm(claimed, { force: true }); await rm(progressFile, { force: true }); }
        else await rename(claimed, path.join(root, 'pending', name));
      }
    }
  }
}
