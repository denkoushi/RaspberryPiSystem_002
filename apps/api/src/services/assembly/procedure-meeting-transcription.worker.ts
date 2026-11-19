import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { runAssemblyTransaction } from './assembly-transaction.js';
import { MeetingTranscriptionError, transcribeProcedureMeeting } from '../inference/adapters/http-meeting-transcription.adapter.js';

export const PROCEDURE_MEETING_MAX_BYTES = 64 * 1024 * 1024;
export const PROCEDURE_MEETING_RETENTION_MS = 24 * 60 * 60_000;
export function getProcedureMeetingAudioDir() {
  return process.env.PROCEDURE_MEETING_AUDIO_DIR ?? join(tmpdir(), 'raspi-procedure-meetings');
}

const RETRY_DELAYS_MS = [2, 5, 10, 15, 15, 15, 15].map(minutes => minutes * 60_000);
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const LEASE_MS = 60_000;
const HEARTBEAT_MS = 15_000;

export function formatMeetingTranscript(text: string): string {
  const parts = text.split(/<spk:(\d+)>/g);
  const turns: { speaker: string; text: string }[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const speaker = index === 0 ? '1' : String(BigInt(parts[index - 1]!) + 1n);
    const speech = parts[index]!.trim().replace(/\s*\r?\n\s*/g, ' ');
    if (!speech) continue;
    const previous = turns.at(-1);
    if (previous?.speaker === speaker) previous.text += ` ${speech}`;
    else turns.push({ speaker, text: speech });
  }
  return turns.map(turn => `話者${turn.speaker}: ${turn.text}`).join('\n');
}

export class ProcedureMeetingTranscriptionWorker {
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private controller: AbortController | null = null;
  private cleaning: Promise<void> | null = null;
  private nextCleanup = 0;

  constructor(private readonly transcribe = transcribeProcedureMeeting) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.kick(), 3000);
    this.timer.unref();
    this.kick();
  }

  kick() {
    if (!this.timer) return;
    if (Date.now() >= this.nextCleanup && !this.cleaning) {
      this.nextCleanup = Date.now() + 60_000;
      this.cleaning = this.cleanup()
        .catch(() => { logger.warn('procedure_meeting_cleanup_failed'); })
        .finally(() => { this.cleaning = null; });
    }
    if (this.running || !env.PROCEDURE_MEETING_TRANSCRIBE_ENABLED) return;
    const controller = new AbortController();
    this.controller = controller;
    this.running = this.tick(controller.signal)
      .catch(() => { logger.warn('procedure_meeting_worker_failed'); })
      .finally(() => { this.running = null; this.controller = null; });
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.controller?.abort();
    await Promise.all([this.running, this.cleaning]);
  }

  async tick(shutdown: AbortSignal) {
    if (shutdown.aborted) return;
    const cutoff = new Date(Date.now() - PROCEDURE_MEETING_RETENTION_MS);
    const jobs = prisma.procedureMeetingTranscriptionJob;

    const job = await runAssemblyTransaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('procedure-meeting-transcription-worker'))`;
      const queue = tx.procedureMeetingTranscriptionJob;
      const claimTime = new Date();
      if (await queue.findFirst({ where: { status: 'RUNNING', leaseExpiresAt: { gt: claimTime } }, select: { id: true } })) return null;
      const eligible: Prisma.ProcedureMeetingTranscriptionJobWhereInput = {
        createdAt: { gt: cutoff }, attempts: { lt: MAX_ATTEMPTS }, audioPath: { not: null },
        OR: [{ status: 'QUEUED', retryAt: { lte: claimTime } }, { status: 'RUNNING', leaseExpiresAt: { lte: claimTime } }]
      };
      const candidate = await queue.findFirst({ where: eligible, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (!candidate) return null;
      const [claimed] = await queue.updateManyAndReturn({
        where: { id: candidate.id, ...eligible },
        data: { status: 'RUNNING', attempts: { increment: 1 }, leaseExpiresAt: new Date(claimTime.getTime() + LEASE_MS) }
      });
      return claimed;
    });
    if (!job?.audioPath) return;

    const held = { id: job.id, status: 'RUNNING' as const, attempts: job.attempts };
    const lostLease = new AbortController();
    const expiresAt = job.createdAt.getTime() + PROCEDURE_MEETING_RETENTION_MS;
    const signal = AbortSignal.any([shutdown, lostLease.signal, AbortSignal.timeout(Math.max(0, expiresAt - Date.now()))]);
    let leaseExpiresAt = job.leaseExpiresAt!.getTime();
    let renewing = false;
    let finished = false;
    let leaseTimer = setTimeout(() => lostLease.abort(), Math.max(0, leaseExpiresAt - Date.now()));
    const heartbeat = setInterval(() => {
      if (signal.aborted || renewing) return;
      renewing = true;
      const time = new Date();
      const nextExpiry = new Date(time.getTime() + LEASE_MS);
      void jobs.updateMany({
        where: { ...held, leaseExpiresAt: { gt: time } },
        data: { leaseExpiresAt: nextExpiry }
      }).then(({ count }) => {
        if (finished) return;
        if (!count || Date.now() >= leaseExpiresAt) {
          lostLease.abort();
        } else if (!signal.aborted) {
          leaseExpiresAt = nextExpiry.getTime();
          clearTimeout(leaseTimer);
          leaseTimer = setTimeout(() => lostLease.abort(), Math.max(0, leaseExpiresAt - Date.now()));
        }
      }).catch(() => {
        logger.warn('procedure_meeting_heartbeat_failed');
      }).finally(() => { renewing = false; });
    }, HEARTBEAT_MS);

    let removeAudio = false;
    try {
      let outcome: Prisma.ProcedureMeetingTranscriptionJobUpdateManyMutationInput;
      try {
        signal.throwIfAborted();
        const { audioPath, audioBytes, mimeType } = job;
        const text = formatMeetingTranscript(await this.transcribe({ audioPath, audioBytes, mimeType }, signal));
        signal.throwIfAborted();
        outcome = { status: 'SUCCEEDED', resultText: text, errorCode: null };
      } catch (error) {
        if (lostLease.signal.aborted) return;
        const errorCode = error instanceof MeetingTranscriptionError ? error.code : 'meeting_transcribe_failed';
        const retryDelay = RETRY_DELAYS_MS[job.attempts - 1];
        const retryAt = retryDelay === undefined ? undefined : Date.now() + retryDelay;
        const retryable = !(error instanceof MeetingTranscriptionError) || error.retryable;
        if (shutdown.aborted) {
          outcome = { status: 'QUEUED', attempts: { decrement: 1 } };
        } else if (retryable && retryAt !== undefined && retryAt < expiresAt) {
          outcome = { status: 'QUEUED', retryAt: new Date(retryAt) };
        } else {
          outcome = { status: 'FAILED', errorCode };
        }
      }
      const { count } = await jobs.updateMany({
        where: { ...held, leaseExpiresAt: { gt: new Date() } },
        data: { ...outcome, leaseExpiresAt: null }
      });
      removeAudio = count === 1 && outcome.status !== 'QUEUED';
    } finally {
      finished = true;
      clearInterval(heartbeat);
      clearTimeout(leaseTimer);
      if (removeAudio) {
        await rm(job.audioPath, { force: true });
        await jobs.updateMany({ where: { id: job.id }, data: { audioPath: null } });
      }
    }
  }

  async cleanup() {
    const now = new Date();
    const cutoff = new Date(now.getTime() - PROCEDURE_MEETING_RETENTION_MS);
    const jobs = prisma.procedureMeetingTranscriptionJob;
    await jobs.updateMany({
      where: {
        status: 'RUNNING', leaseExpiresAt: { lte: now },
        OR: [{ attempts: { gte: MAX_ATTEMPTS } }, { createdAt: { lte: cutoff } }]
      },
      data: { status: 'FAILED', errorCode: 'meeting_transcribe_failed', leaseExpiresAt: null }
    });
    const expired = { createdAt: { lte: cutoff }, status: { not: 'RUNNING' as const } };
    const removable = await jobs.findMany({
      where: { audioPath: { not: null }, OR: [expired, { status: { in: ['FAILED', 'SUCCEEDED'] } }] },
      select: { id: true, audioPath: true }
    });
    for (const job of removable) {
      await rm(job.audioPath!, { force: true });
      await jobs.updateMany({ where: { id: job.id }, data: { audioPath: null } });
    }
    await jobs.deleteMany({ where: { ...expired, audioPath: null } });

    // Recover audio written before a crash interrupted the database insert.
    const directory = getProcedureMeetingAudioDir();
    const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const id of files) {
      if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)) continue;
      const path = join(directory, id);
      const file = await stat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (file && file.mtimeMs <= cutoff.getTime() && !await jobs.findUnique({ where: { id }, select: { id: true } })) {
        await rm(path, { force: true });
      }
    }
  }
}

export const procedureMeetingTranscriptionWorker = new ProcedureMeetingTranscriptionWorker();
