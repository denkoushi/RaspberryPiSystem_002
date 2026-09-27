import { describe, expect, it, vi } from 'vitest';

import { InferenceDeferredError } from '../../inference/ports/text-completion.port.js';
import type { KnowledgeProcedureRepositoryPort } from '../knowledge-procedure.port.js';
import type { ProcedureInferencePort } from '../procedure-builder.js';
import type { ProcedureMaterial, ProcedureMaterialRepositoryPort } from '../procedure-material.port.js';
import { ProcedureWorker } from '../procedure-worker.js';

const material = (id: string, text: string): ProcedureMaterial => ({
  id, intakeId: 'intake', state: 'pending', procedureId: null, attempts: 1, createdAt: new Date(),
  source: { id: `source-${id}`, text, capturedAt: '2026-09-20T01:00:00.000Z', images: [] },
  organized: { title: text, summary: text, category: '段取り', quotes: [], photos: [] },
});
const generalHeader = { title: '技能検定の申し込み', category: '事務手続き', identifiers: {}, reviewTier: 'auto_publish' as const };
const setupHeader = { title: '部品Aの段取り', category: '段取り手順', identifiers: { partNumber: 'P-1' }, reviewTier: 'approval_required' as const };

function harness(options: { claimed: ProcedureMaterial | null; topics?: { procedureId: string; header: typeof generalHeader | typeof setupHeader }[]; earlier?: ProcedureMaterial[] }) {
  const materials = {
    enqueue: vi.fn(), claim: vi.fn().mockResolvedValue(options.claimed), renew: vi.fn().mockResolvedValue(true),
    materialsOf: vi.fn().mockResolvedValue(options.earlier ?? []), finish: vi.fn(), fail: vi.fn().mockResolvedValue(undefined),
  } satisfies ProcedureMaterialRepositoryPort;
  const procedures = {
    createDraft: vi.fn().mockResolvedValue({ procedureId: 'p-new', revisionId: 'r1', revisionNumber: 1 }),
    publishAutomatic: vi.fn(), listTopics: vi.fn().mockResolvedValue(options.topics ?? []), listPublished: vi.fn(), getPublished: vi.fn(),
  } satisfies KnowledgeProcedureRepositoryPort;
  const inference = { assign: vi.fn(), compose: vi.fn() } satisfies ProcedureInferencePort;
  const logError = vi.fn();
  return { materials, procedures, inference, logError, worker: new ProcedureWorker({ materials, procedures, inference, logError }) };
}

describe('procedure worker', () => {
  it('creates and publishes a confident general topic', async () => {
    const h = harness({ claimed: material('m1', '申込書を提出する') });
    h.inference.assign.mockResolvedValue({ action: 'new', header: generalHeader, confidence: 0.95 });
    h.inference.compose.mockResolvedValue([{ title: '提出', body: '申込書を提出する。', cautions: [], needsReview: [], photoIds: [], sources: [{ materialId: 'm1' }] }]);
    await h.worker.tick();
    expect(h.procedures.createDraft).toHaveBeenCalledWith(expect.objectContaining({ header: generalHeader, createdByKey: 'system:procedure-builder' }));
    expect(h.procedures.publishAutomatic).toHaveBeenCalledWith('r1');
    expect(h.materials.finish).toHaveBeenCalledWith('m1', expect.any(String), { procedureId: 'p-new' });
  });

  it('rebuilds an existing quality-critical topic from all its materials without publishing', async () => {
    const earlier = material('m0', '治具Bを出す');
    const h = harness({ claimed: material('m1', 'クランプを締める'), topics: [{ procedureId: 'p1', header: setupHeader }], earlier: [earlier] });
    h.procedures.createDraft.mockResolvedValue({ procedureId: 'p1', revisionId: 'r2', revisionNumber: 2 });
    h.inference.assign.mockResolvedValue({ action: 'existing', procedureId: 'p1', confidence: 0.9 });
    h.inference.compose.mockResolvedValue([
      { title: '準備', body: '治具Bを出す。', cautions: [], needsReview: [], photoIds: [], sources: [{ materialId: 'm0' }] },
      { title: '固定', body: 'クランプを締める。', cautions: [], needsReview: [], photoIds: [], sources: [{ materialId: 'm1' }] },
    ]);
    await h.worker.tick();
    expect(h.inference.compose.mock.calls[0]![1].map((digest: { id: string }) => digest.id)).toEqual(['m0', 'm1']);
    expect(h.procedures.createDraft).toHaveBeenCalledWith(expect.objectContaining({ procedureId: 'p1', header: setupHeader }));
    expect(h.procedures.publishAutomatic).not.toHaveBeenCalled();
    expect(h.materials.finish).toHaveBeenCalledWith('m1', expect.any(String), { procedureId: 'p1' });
  });

  it('keeps non-procedural material as unassigned knowledge', async () => {
    const h = harness({ claimed: material('m1', '今日は晴れ') });
    h.inference.assign.mockResolvedValue({ action: 'none', confidence: 0.9 });
    await h.worker.tick();
    expect(h.inference.compose).not.toHaveBeenCalled();
    expect(h.materials.finish).toHaveBeenCalledWith('m1', expect.any(String), { unassigned: true });
  });

  it('defers on inference admission refusal and records a code for invalid output', async () => {
    const deferred = harness({ claimed: material('m1', 'x') });
    deferred.inference.assign.mockRejectedValue(new InferenceDeferredError());
    await deferred.worker.tick();
    expect(deferred.materials.fail).toHaveBeenCalledWith('m1', expect.any(String), 'WAITING_FOR_INFERENCE', true);
    expect(deferred.logError).not.toHaveBeenCalled();

    const invalid = harness({ claimed: material('m1', 'x') });
    invalid.inference.assign.mockResolvedValue({ action: 'existing', procedureId: 'invented', confidence: 0.9 });
    await invalid.worker.tick();
    expect(invalid.materials.fail).toHaveBeenCalledWith('m1', expect.any(String), 'UNKNOWN_PROCEDURE_TOPIC', false);
    expect(invalid.procedures.createDraft).not.toHaveBeenCalled();
  });

  it('does nothing when the queue is empty', async () => {
    const h = harness({ claimed: null });
    await h.worker.tick();
    expect(h.inference.assign).not.toHaveBeenCalled();
  });
});
