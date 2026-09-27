import { randomUUID } from 'node:crypto';

import { InferenceDeferredError } from '../inference/ports/text-completion.port.js';

import type { KnowledgeProcedureRepositoryPort } from './knowledge-procedure.port.js';
import type { ProcedureMaterialRepositoryPort } from './procedure-material.port.js';
import type { TriageRepositoryPort } from './triage.port.js';
import {
  buildProcedureContent, digestMaterial, validateSuggestions, type ProcedureInferencePort,
} from './procedure-builder.js';

/** Materials sent to one composition; older materials beyond this stay assigned but are not re-read. */
export const PROCEDURE_COMPOSE_MATERIAL_LIMIT = 40;
/** Topics offered to the suggestion model, preferring the scanned part number and recent topics. */
export const SUGGESTION_TOPIC_LIMIT = 60;
const SUGGESTION_MATERIAL_LIMIT = 5;

export type ProcedureWorkerDeps = {
  triage: TriageRepositoryPort; materials: ProcedureMaterialRepositoryPort; procedures: KnowledgeProcedureRepositoryPort;
  inference: ProcedureInferencePort; workTypes: () => Promise<string[]>;
  scannedPartNumber: (intakeId: string) => Promise<string | null>;
  logError: (error: unknown) => void;
};

/**
 * One job per tick: first suggest destinations for a new post, otherwise rebuild a topic whose
 * materials changed after a poster's decision. Only confident general topics publish directly.
 */
export class ProcedureWorker {
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private controller: AbortController | null = null;

  constructor(private readonly deps: ProcedureWorkerDeps) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.kick(), 5000);
    this.timer.unref(); this.kick();
  }
  kick() {
    if (!this.timer || this.running) return;
    this.running = this.tick().catch(this.deps.logError).finally(() => { this.running = null; });
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null; this.controller?.abort(); await this.running;
  }

  async tick(): Promise<void> {
    if (await this.suggestOne()) return;
    await this.buildOne();
  }

  private async guarded(run: (signal: AbortSignal) => Promise<void>, fail: (code: string, deferred: boolean) => Promise<void>) {
    const controller = new AbortController(); this.controller = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(600_000)]);
    try {
      await run(signal);
    } catch (error) {
      const deferred = error instanceof InferenceDeferredError || signal.aborted;
      await fail(deferred ? 'WAITING_FOR_INFERENCE' : errorCode(error), deferred).catch(this.deps.logError);
      if (!deferred) this.deps.logError(error);
    } finally { this.controller = null; }
  }

  private async suggestOne(): Promise<boolean> {
    const { triage, materials, procedures, inference } = this.deps;
    const token = randomUUID();
    const job = await triage.claimSuggesting(token);
    if (!job) return false;
    await this.guarded(async signal => {
      const items = (await materials.materialsOfIntake(job.intakeId)).slice(0, SUGGESTION_MATERIAL_LIMIT);
      const scannedPartNumber = await this.deps.scannedPartNumber(job.intakeId);
      const all = await procedures.listTopics();
      const samePart = scannedPartNumber ? all.filter(topic => topic.header.identifiers.partNumber === scannedPartNumber) : [];
      const topics = [...samePart, ...all.filter(topic => !samePart.includes(topic)).reverse()].slice(0, SUGGESTION_TOPIC_LIMIT);
      const input = { materials: items.map(digestMaterial), scannedPartNumber, topics, workTypes: await this.deps.workTypes() };
      const suggestions = validateSuggestions(await inference.suggest(input, signal), input);
      signal.throwIfAborted();
      await triage.saveSuggestions(job.intakeId, token, suggestions);
    }, (code, deferred) => triage.failSuggesting(job.intakeId, token, code, deferred));
    return true;
  }

  private async buildOne(): Promise<void> {
    const { materials, procedures, inference } = this.deps;
    const token = randomUUID();
    const job = await procedures.claimBuild(token);
    if (!job) return;
    await this.guarded(async signal => {
      const set = await materials.materialsOf(job.procedureId, PROCEDURE_COMPOSE_MATERIAL_LIMIT);
      if (!set.length) { await procedures.completeBuild(job.procedureId, token, job.requestedAt); return; }
      const content = buildProcedureContent(set, await inference.compose(job.header, set.map(digestMaterial), signal));
      signal.throwIfAborted();
      const draft = await procedures.createDraft({ procedureId: job.procedureId, header: job.header, content, createdByKey: 'system:procedure-builder' });
      if (job.header.reviewTier === 'auto_publish') await procedures.publishAutomatic(draft.revisionId);
      await procedures.completeBuild(job.procedureId, token, job.requestedAt);
    }, (code, deferred) => procedures.failBuild(job.procedureId, token, code, deferred));
  }
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^[A-Z_]{3,64}$/.test(message) ? message : 'PROCEDURE_BUILD_FAILED';
}
