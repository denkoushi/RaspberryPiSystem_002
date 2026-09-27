import { randomUUID } from 'node:crypto';

import { InferenceDeferredError } from '../inference/ports/text-completion.port.js';

import type { KnowledgeProcedureRepositoryPort } from './knowledge-procedure.port.js';
import type { ProcedureMaterial, ProcedureMaterialRepositoryPort } from './procedure-material.port.js';
import {
  buildProcedureContent, digestMaterial, validateAssignment, type ProcedureInferencePort,
} from './procedure-builder.js';

/** Materials sent to one composition; older materials beyond this stay assigned but are not re-read. */
export const PROCEDURE_COMPOSE_MATERIAL_LIMIT = 40;

/**
 * Drains the material queue one item at a time: assign the material to a topic, rebuild that
 * topic's draft from all of its materials, and publish it only when the topic needs no approval.
 */
export class ProcedureWorker {
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private controller: AbortController | null = null;

  constructor(private readonly deps: {
    materials: ProcedureMaterialRepositoryPort; procedures: KnowledgeProcedureRepositoryPort;
    inference: ProcedureInferencePort; logError: (error: unknown) => void;
  }) {}

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
    const { materials } = this.deps;
    const token = randomUUID();
    const material = await materials.claim(token);
    if (!material) return;
    const controller = new AbortController(); this.controller = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(600_000)]);
    const heartbeat = setInterval(() => {
      void materials.renew(material.id, token).then(held => { if (!held) controller.abort(); }).catch(() => controller.abort());
    }, 15_000);
    try {
      await this.build(material, token, signal);
    } catch (error) {
      const deferred = error instanceof InferenceDeferredError || signal.aborted;
      await materials.fail(material.id, token, deferred ? 'WAITING_FOR_INFERENCE' : errorCode(error), deferred).catch(this.deps.logError);
      if (!deferred) this.deps.logError(error);
    } finally {
      clearInterval(heartbeat); this.controller = null;
    }
  }

  private async build(material: ProcedureMaterial, token: string, signal: AbortSignal) {
    const { materials, procedures, inference } = this.deps;
    const topics = await procedures.listTopics();
    const assignment = validateAssignment(await inference.assign(digestMaterial(material), topics, signal), topics);
    signal.throwIfAborted();
    if (assignment.kind === 'none') { await materials.finish(material.id, token, { unassigned: true }); return; }

    const header = assignment.kind === 'existing' ? assignment.topic.header : assignment.header;
    const earlier = assignment.kind === 'existing'
      ? await materials.materialsOf(assignment.topic.procedureId, PROCEDURE_COMPOSE_MATERIAL_LIMIT - 1) : [];
    const set = [...earlier.filter(item => item.id !== material.id), material];
    const content = buildProcedureContent(set, await inference.compose(header, set.map(digestMaterial), signal));
    signal.throwIfAborted();
    if (!await materials.renew(material.id, token)) throw new Error('PROCEDURE_MATERIAL_LEASE_LOST');

    const draft = await procedures.createDraft({
      ...(assignment.kind === 'existing' ? { procedureId: assignment.topic.procedureId } : {}),
      header, content, createdByKey: 'system:procedure-builder',
    });
    if (header.reviewTier === 'auto_publish') await procedures.publishAutomatic(draft.revisionId);
    await materials.finish(material.id, token, { procedureId: draft.procedureId });
  }
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^[A-Z_]{3,64}$/.test(message) ? message : 'PROCEDURE_BUILD_FAILED';
}
