import { randomUUID } from 'node:crypto';

import type { PrismaProcedureBoardRepository } from './prisma-procedure-board.repository.js';
import { ProcedureBoardModelOutputError, type ProcedureBoardInferencePort } from './procedure-board-inference.js';

export type ProcedureBoardWorkerDeps = {
  repository: Pick<PrismaProcedureBoardRepository, 'refreshAi' | 'claimAi' | 'saveAiResult' | 'deferAi' | 'aiClientEnabled'>;
  inference: ProcedureBoardInferencePort;
  logError: (error: unknown) => void;
};

export class ProcedureBoardWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private controller: AbortController | null = null;

  constructor(private readonly deps: ProcedureBoardWorkerDeps) {}
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.kick(), 5000);
    this.timer.unref(); this.kick();
  }
  kick() {
    if (!this.timer || this.running) return;
    void this.tick().catch(this.deps.logError);
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.controller?.abort();
    await this.running;
  }
  tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.runOne().finally(() => { this.running = null; });
    return this.running;
  }
  private async runOne(): Promise<void> {
    const controller = new AbortController(); this.controller = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(600000)]);
    const token = randomUUID();
    let job: Awaited<ReturnType<ProcedureBoardWorkerDeps['repository']['claimAi']>> = null;
    try {
      await this.deps.repository.refreshAi();
      if (signal.aborted) return;
      job = await this.deps.repository.claimAi(token);
      if (!job) return;
      if (!await this.deps.repository.aiClientEnabled(job.requestedByClientDeviceId)) {
        await this.deps.repository.deferAi(job.id, token, 'PROCEDURE_BOARD_CLIENT_DISABLED'); return;
      }
      signal.throwIfAborted();
      const result = job.kind === 'placement'
        ? await this.deps.inference.suggest(job.input, signal)
        : await this.deps.inference.format(job.input, signal);
      signal.throwIfAborted();
      await this.deps.repository.saveAiResult(job.id, token, job.boardVersion, result);
    } catch (error) {
      if (!job) throw error;
      const deferred = !(error instanceof ProcedureBoardModelOutputError);
      await this.deps.repository.deferAi(job.id, token, deferred ? 'WAITING_FOR_INFERENCE' : 'PROCEDURE_BOARD_AI_FAILED', deferred);
      if (!deferred) this.deps.logError(error);
    } finally { this.controller = null; }
  }
}
