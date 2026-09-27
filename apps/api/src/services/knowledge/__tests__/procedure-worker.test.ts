import { describe, expect, it, vi } from 'vitest';

import { InferenceDeferredError } from '../../inference/ports/text-completion.port.js';
import type { KnowledgeProcedureRepositoryPort } from '../knowledge-procedure.port.js';
import type { ProcedureInferencePort } from '../procedure-builder.js';
import type { ProcedureMaterial, ProcedureMaterialRepositoryPort } from '../procedure-material.port.js';
import { ProcedureWorker } from '../procedure-worker.js';
import type { Triage, TriageRepositoryPort } from '../triage.port.js';

const material = (id: string, text: string): ProcedureMaterial => ({
  id, intakeId: 'intake-1', state: 'pending', procedureId: null, createdAt: new Date(),
  source: { id: `source-${id}`, text, capturedAt: '2026-09-20T01:00:00.000Z', images: [] },
  organized: { title: text, summary: text, category: '段取り', quotes: [], photos: [] },
});
const generalHeader = { title: '技能検定｜申し込み・手続き', category: '申し込み・手続き', identifiers: {}, reviewTier: 'auto_publish' as const };
const setupHeader = { title: 'P-1 テーブル｜段取り', category: '段取り', identifiers: { partNumber: 'P-1' }, reviewTier: 'approval_required' as const };
const triageJob: Triage = { intakeId: 'intake-1', posterEmployeeId: 'e1', state: 'suggesting', suggestions: null, decidedProcedureId: null, createdAt: new Date() };

function harness(options: { triage?: Triage | null; build?: { procedureId: string; header: typeof generalHeader | typeof setupHeader } | null; materials?: ProcedureMaterial[] } = {}) {
  const requestedAt = new Date('2026-09-27T00:00:00Z');
  const triage = {
    open: vi.fn(), claimSuggesting: vi.fn().mockResolvedValue(options.triage ?? null), saveSuggestions: vi.fn(),
    failSuggesting: vi.fn().mockResolvedValue(undefined), get: vi.fn(), awaitingFor: vi.fn(), decide: vi.fn(),
  } satisfies TriageRepositoryPort;
  const materials = {
    enqueue: vi.fn(), materialsOfIntake: vi.fn().mockResolvedValue(options.materials ?? []), materialsOf: vi.fn().mockResolvedValue(options.materials ?? []),
  } satisfies ProcedureMaterialRepositoryPort;
  const procedures = {
    createDraft: vi.fn().mockResolvedValue({ procedureId: options.build?.procedureId ?? 'p', revisionId: 'r1', revisionNumber: 1 }),
    publishAutomatic: vi.fn(), listTopics: vi.fn().mockResolvedValue([
      { procedureId: 'old', header: generalHeader, parts: null }, { procedureId: 'same-part', header: setupHeader, parts: null },
    ]), listPublished: vi.fn(), getPublished: vi.fn(), searchTopics: vi.fn(),
    claimBuild: vi.fn().mockResolvedValue(options.build ? { ...options.build, requestedAt } : null),
    completeBuild: vi.fn(), failBuild: vi.fn().mockResolvedValue(undefined),
  } satisfies KnowledgeProcedureRepositoryPort;
  const inference = { suggest: vi.fn(), compose: vi.fn() } satisfies ProcedureInferencePort;
  const logError = vi.fn();
  const worker = new ProcedureWorker({ triage, materials, procedures, inference, logError,
    workTypes: async () => ['段取り', '申し込み・手続き', 'その他'], scannedPartNumber: async () => 'P-1' });
  return { triage, materials, procedures, inference, logError, worker, requestedAt };
}

describe('procedure worker', () => {
  it('suggests destinations for a new post, offering same-part topics first, without building anything', async () => {
    const h = harness({ triage: triageJob, materials: [material('m1', 'クランプを締める')] });
    h.inference.suggest.mockResolvedValue({ candidates: [{ procedureId: 'same-part', reason: '同じ品番' }], proposal: null, confidence: 0.9 });
    await h.worker.tick();
    const input = h.inference.suggest.mock.calls[0]![0];
    expect(input.scannedPartNumber).toBe('P-1');
    expect(input.topics[0].procedureId).toBe('same-part');
    expect(h.triage.saveSuggestions).toHaveBeenCalledWith('intake-1', expect.any(String), expect.objectContaining({
      candidates: [{ procedureId: 'same-part', title: setupHeader.title, reason: '同じ品番' }],
    }));
    expect(h.procedures.claimBuild).not.toHaveBeenCalled();
    expect(h.procedures.createDraft).not.toHaveBeenCalled();
  });

  it('rebuilds a decided general topic and publishes it', async () => {
    const h = harness({ build: { procedureId: 'p-general', header: generalHeader }, materials: [material('m1', '申込書を出す')] });
    h.inference.compose.mockResolvedValue([{ title: '提出', body: '申込書を出す。', cautions: [], needsReview: [], photoIds: [], sources: [{ materialId: 'm1' }] }]);
    await h.worker.tick();
    expect(h.procedures.createDraft).toHaveBeenCalledWith(expect.objectContaining({ procedureId: 'p-general', header: generalHeader }));
    expect(h.procedures.publishAutomatic).toHaveBeenCalledWith('r1');
    expect(h.procedures.completeBuild).toHaveBeenCalledWith('p-general', expect.any(String), h.requestedAt);
  });

  it('rebuilds a quality-critical topic as an unpublished draft', async () => {
    const h = harness({ build: { procedureId: 'p-setup', header: setupHeader }, materials: [material('m1', 'クランプを締める')] });
    h.inference.compose.mockResolvedValue([{ title: '固定', body: 'クランプを締める。', cautions: [], needsReview: [], photoIds: [], sources: [{ materialId: 'm1' }] }]);
    await h.worker.tick();
    expect(h.procedures.createDraft).toHaveBeenCalled();
    expect(h.procedures.publishAutomatic).not.toHaveBeenCalled();
  });

  it('defers on admission refusal and records invalid composition output', async () => {
    const deferred = harness({ triage: triageJob });
    deferred.inference.suggest.mockRejectedValue(new InferenceDeferredError());
    await deferred.worker.tick();
    expect(deferred.triage.failSuggesting).toHaveBeenCalledWith('intake-1', expect.any(String), 'WAITING_FOR_INFERENCE', true);
    expect(deferred.logError).not.toHaveBeenCalled();

    const invalid = harness({ build: { procedureId: 'p', header: generalHeader }, materials: [material('m1', 'x')] });
    invalid.inference.compose.mockResolvedValue([{ title: 't', body: 'b', cautions: [], needsReview: [], photoIds: [], sources: [] }]);
    await invalid.worker.tick();
    expect(invalid.procedures.failBuild).toHaveBeenCalledWith('p', expect.any(String), 'NO_SUPPORTED_STEPS', false);
    expect(invalid.procedures.createDraft).not.toHaveBeenCalled();
  });

  it('does nothing when no post or topic is waiting', async () => {
    const h = harness();
    await h.worker.tick();
    expect(h.inference.suggest).not.toHaveBeenCalled();
    expect(h.inference.compose).not.toHaveBeenCalled();
  });
});
