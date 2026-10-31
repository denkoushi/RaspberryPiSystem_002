import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { logger } from '../../lib/logger.js';
import { InferenceDeferredError, type TextCompletionPort } from '../inference/ports/text-completion.port.js';
import { queryDeviceHealth } from './device-health.js';
import { prepareChunks, redact } from './material.js';
import { securityReviewReportSchema, type DeviceHealth, type SecurityReviewReport } from './report-schema.js';

import { completeReview, completionError, halveMaterial, loadKnown, unavailable } from './review-completion.js';
import { atomicJson, queueCounts, readQueueResults, type QueueResult, reviewActivity } from './queue-storage.js';
export { reviewMessages } from './review-completion.js';

const DAY_MS = 24 * 60 * 60_000;
export const RUN_TIMEOUT_MS = 50 * 60_000;
export const RETRY_INTERVAL_MS = 10 * 60_000;
const bundleSchema = z.object({
  reviewedCommits: securityReviewReportSchema.shape.reviewedCommits,
  droppedLines: z.record(z.string(), z.number().int().nonnegative()),
  sourceErrors: z.array(z.string().max(100)),
  carriedOver: z.number().int().nonnegative().default(0),
  carryOverExpired: z.number().int().nonnegative().default(0),
  queue: z.object({ pending: z.number(), claimed: z.number(), done: z.number(), failed: z.number(), invalid: z.number().optional() }).optional(),
}).strict();
type ClientErrorGroup = { clientId: string; message: string; count: number; first: string; last: string };
type Dependencies = {
  dataDir: string;
  retryUntil: string;
  completion: TextCompletionPort;
  clientErrors: (since: Date) => Promise<ClientErrorGroup[]>;
  deviceHealth: (since: Date) => Promise<DeviceHealth>;
  now?: () => Date;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export function tokyoDate(now: Date): string { return new Date(now.getTime() + 9 * 60 * 60_000).toISOString().slice(0, 10); }
export function retryDeadline(now: Date, until: string): number {
  return Math.min(Date.parse(`${tokyoDate(now)}T${until}:00+09:00`), now.getTime() + RUN_TIMEOUT_MS);
}

export async function retainRecent(dataDir: string, now: Date) {
  for (const folder of ['bundles', 'reports']) {
    const root = path.join(dataDir, folder);
    for (const name of await readdir(root)) {
      if (!/^\d{4}-\d{2}-\d{2}(?:\.json)?$/.test(name)) continue;
      if (Date.parse(`${name.slice(0, 10)}T00:00:00+09:00`) < now.getTime() - 14 * DAY_MS) {
        await rm(path.join(root, name), { recursive: true, force: true });
      }
    }
  }
}

export class SecurityReviewService {
  constructor(private readonly deps: Dependencies) {}

  async run(runSignal: AbortSignal, options: { rerun?: boolean } = {}): Promise<SecurityReviewReport | null> {
    if (reviewActivity.nightly) return null;
    reviewActivity.nightly = true;
    try {
      await reviewActivity.queueUnit?.catch(() => {});
      return await this.runNightly(runSignal, options);
    } finally { reviewActivity.nightly = false; }
  }

  private async runNightly(runSignal: AbortSignal, options: { rerun?: boolean }): Promise<SecurityReviewReport | null> {
    const now = this.deps.now ?? (() => new Date());
    const started = now();
    const deadline = retryDeadline(started, this.deps.retryUntil);
    const signal = AbortSignal.any([runSignal, AbortSignal.timeout(Math.max(0, deadline - started.getTime()))]);
    const root = this.deps.dataDir;
    await mkdir(root, { recursive: true, mode: 0o700 });
    for (const folder of ['bundles', 'reports']) await mkdir(path.join(root, folder), { recursive: true, mode: 0o700 });
    await retainRecent(root, started);
    const reports = new Set(await readdir(path.join(root, 'reports')));
    for (const name of reports) {
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
      try {
        const previous = securityReviewReportSchema.parse(JSON.parse(await readFile(path.join(root, 'reports', name), 'utf8')));
        if (previous.status !== 'ok' && previous.reason && JSON.parse(previous.reason).outcome === 'no_bundle') reports.delete(name);
      } catch { /* Preserve existing reports unless they explicitly record no bundle. */ }
    }
    const wait = this.deps.wait ?? (async (ms: number, abort: AbortSignal) => { await delay(ms, undefined, { signal: abort }); });
    let bundles: string[];
    while (true) {
      bundles = (await readdir(path.join(root, 'bundles')))
        .filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name) && name <= tokyoDate(started) && (options.rerun || !reports.has(`${name}.json`))).sort().reverse();
      if (bundles.length || reports.has(`${tokyoDate(started)}.json`) || signal.aborted || now().getTime() >= deadline) break;
      try { await wait(Math.min(RETRY_INTERVAL_MS, deadline - now().getTime()), signal); }
      catch { break; }
    }
    const date = bundles[0] ?? tokyoDate(started);
    if (!bundles.length && reports.has(`${date}.json`)) return null;
    const report: SecurityReviewReport = { date, status: 'skipped', reviewedCommits: { from: '', to: '' }, chunks: [], findings: [] };
    const counts = { truncated: { security: 0, errors: 0, changes: 0 }, droppedLines: {} as Record<string, number>, knownFindingsDropped: 0,
      carriedOver: 0, carryOverExpired: 0,
      knownFindingsState: 'not_read' as 'not_read' | 'loaded' | 'missing' | 'invalid' };
    let reason = 'no_bundle'; let completed = 0; let incomplete = false;
    try {
      if (bundles.length) {
        const folder = path.join(root, 'bundles', date);
        const bundle = bundleSchema.parse(JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8')));
        report.reviewedCommits = bundle.reviewedCommits;
        counts.droppedLines = { security: bundle.droppedLines.security ?? 0, errors: bundle.droppedLines.errors ?? 0 };
        counts.carriedOver = bundle.carriedOver;
        counts.carryOverExpired = bundle.carryOverExpired;
        incomplete = bundle.sourceErrors.length > 0;
        const known = await loadKnown(root);
        counts.knownFindingsState = known.state;
        const material = { security: '', errors: '', changes: '' };
        for (const kind of ['security', 'errors'] as const) {
          const text = await readFile(path.join(folder, `${kind}.txt`), 'utf8');
          material[kind] = redact(text);
        }
        try {
          const rows = await this.deps.clientErrors(new Date(started.getTime() - DAY_MS));
          if (rows.length) material.errors += '\n' + rows.map(row => redact(JSON.stringify({ source: 'ClientLog', ...row }))).join('\n');
        } catch { incomplete = true; reason = 'client_logs_unavailable'; }
        const prepared = prepareChunks(material);
        counts.truncated = prepared.truncated;
        reason = incomplete ? 'incomplete_sources' : 'completed';
        // 24 calls * 120 seconds = 48 minutes < RUN_TIMEOUT_MS (50 minutes).
        // Splits and schema retries share this budget; unfinished material is explicit.
        let calls = 0;
        for (let index = 0; index < prepared.chunks.length; index++) {
          const chunk = prepared.chunks[index]!;
          while (true) {
            if (signal.aborted || now().getTime() >= deadline) { reason = 'window_ended'; break; }
            try {
              const answer = await completeReview(this.deps.completion, chunk, known, signal, () => {
                if (calls >= 24) throw new Error('call_budget_exhausted');
                calls++;
              });
              if (answer.length) {
                const halves = halveMaterial(chunk.text);
                if (!halves) {
                  report.chunks.push({ id: chunk.id, kind: chunk.kind, refusedOrVague: false, error: 'length_at_minimum_unit' });
                  incomplete = true; reason = 'chunk_failed'; break;
                }
                prepared.chunks.splice(index, 1, ...halves.map((text, half) => ({ ...chunk, id: `${chunk.id}.${half}`, text })));
                index--; break;
              }
              counts.knownFindingsDropped += answer.dropped;
              report.findings.push(...answer.findings);
              report.chunks.push({ id: chunk.id, kind: chunk.kind, refusedOrVague: answer.refusedOrVague });
              completed++;
              reason = incomplete ? 'incomplete_review' : 'completed';
              break;
            } catch (error) {
              if (signal.aborted) { reason = 'window_ended'; break; }
              if (unavailable(error)) {
                reason = error instanceof InferenceDeferredError ? 'admission_deferred' : 'model_unavailable';
                const remaining = deadline - now().getTime();
                if (remaining <= 0) break;
                try {
                  await wait(Math.min(RETRY_INTERVAL_MS, remaining), signal);
                } catch { break; }
                if (now().getTime() >= deadline || signal.aborted) break;
                continue;
              }

              report.chunks.push({ id: chunk.id, kind: chunk.kind, refusedOrVague: false,
                error: error instanceof Error && error.message === 'call_budget_exhausted' ? 'call_budget_exhausted' : completionError(error) });
              incomplete = true;
              reason = 'chunk_failed';
              break;
            }
          }
          if (prepared.chunks[index] !== chunk) continue;
          if (!report.chunks.some(item => item.id === chunk.id)) {
            report.chunks.push({ id: chunk.id, kind: chunk.kind, refusedOrVague: false, error: reason });
            incomplete = true;
            break;
          }
        }
        if (completed > 0 || prepared.chunks.length === 0) {
          report.status = incomplete || report.chunks.length < prepared.chunks.length ||
            Object.values(counts.truncated).some(Boolean) || Object.values(counts.droppedLines).some(Boolean) ? 'partial' : 'ok';
        }
      }
    } catch {
      reason = 'invalid_or_unavailable_bundle';
      report.status = completed > 0 ? 'partial' : 'skipped';
    }
    const queueErrors: string[] = [];
    const queueFailure = (operation: string, error: unknown) => {
      if (queueErrors.length < 10) queueErrors.push(`${operation}:${error instanceof Error ? redact(error.message).slice(0, 160) : 'unknown'}`);
      report.status = 'partial';
    };
    const included: { filename: string; result: QueueResult }[] = [];
    try {
      for (const entry of await readQueueResults(root)) {
        if (report.findings.length + entry.result.findings.length > 10000) break;
        report.findings.push(...entry.result.findings);
        included.push(entry);
        if (entry.result.status === 'failed') report.status = 'partial';
      }
    } catch (error) { queueFailure('queue_results', error); }
    try { report.changeQueue = { reviewedCommits: included.length, ...await queueCounts(root) }; }
    catch (error) { queueFailure('queue_counts', error); }
    try {
      report.deviceHealth = await this.deps.deviceHealth(new Date(started.getTime() - DAY_MS));
    } catch (error) {
      report.deviceHealth = { attention: 'none', storage: { open: [], last24h: [] }, ext4Errors: [], power: [], offline: [], unavailable: true };
      report.status = 'partial';
      logger.error({ error: error instanceof Error ? error.name : 'unknown',
        message: error instanceof Error ? error.message : String(error) }, 'Security review device health unavailable');
    }
    report.reason = JSON.stringify({ outcome: reason, ...counts, queueErrors });
    const validated = securityReviewReportSchema.parse(report);
    await atomicJson(path.join(root, 'reports', `${date}.json`), validated);
    for (const { filename, result } of included) {
      try { await atomicJson(filename, { ...result, reportedAt: now().toISOString() }); }
      catch (error) { queueFailure('queue_reported_at', error); }
    }
    if (queueErrors.length) {
      validated.status = 'partial';
      validated.reason = JSON.stringify({ outcome: reason, ...counts, queueErrors });
      await atomicJson(path.join(root, 'reports', `${date}.json`), validated);
    }
    return validated;
  }
}

export async function createSecurityReviewService(dataDir: string, retryUntil: string) {
  const { getInferenceRuntime } = await import('../inference/inference-runtime.js');
  const { prisma } = await import('../../lib/prisma.js');
  return new SecurityReviewService({ dataDir, retryUntil,
    completion: getInferenceRuntime().createTextCompletionPort(),
    deviceHealth: since => queryDeviceHealth(prisma, since),
    clientErrors: async since => {
      const rows = await prisma.clientLog.groupBy({ by: ['clientId', 'message'],
        where: { level: 'ERROR', createdAt: { gte: since } },
        _count: { _all: true }, _min: { createdAt: true }, _max: { createdAt: true },
      });
      return rows.map(row => ({ clientId: row.clientId, message: row.message, count: row._count._all,
        first: row._min.createdAt!.toISOString(), last: row._max.createdAt!.toISOString() }));
    },
  });
}
