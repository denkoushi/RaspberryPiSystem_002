import { describe, expect, it, vi } from 'vitest';

import { InferenceDeferredError } from '../../inference/ports/text-completion.port.js';
import { emptyLayout } from '../procedure-board-layout.js';
import { emptyDecisions } from '../procedure-board.service.js';
import { ProcedureBoardWorker, type ProcedureBoardWorkerDeps } from '../procedure-board-worker.js';
import { ProcedureBoardInference } from '../procedure-board-inference.js';

const input = { layout: emptyLayout(), decisions: emptyDecisions(), materialFingerprint: 'v1', materials: [] };
const result = { placements: [], headings: [], gaps: [], conflicts: [] };
function setup(kind = 'placement') {
  const job = { id: 'job-1', boardVersion: 7, requestedByClientDeviceId: 'device-1', kind, input };
  const repository = { refreshAi: vi.fn().mockResolvedValue(undefined), claimAi: vi.fn().mockResolvedValue(job), aiClientEnabled: vi.fn().mockResolvedValue(true), saveAiResult: vi.fn().mockResolvedValue(true), deferAi: vi.fn().mockResolvedValue(undefined) };
  const inference = { suggest: vi.fn().mockResolvedValue(result), format: vi.fn().mockResolvedValue({ pages: [{ page: 1, rows: [] }, { page: 2, rows: [] }, { page: 3, rows: [] }], styles: [] }) };
  const deps = { repository, inference, logError: vi.fn() } as unknown as ProcedureBoardWorkerDeps;
  return { job, repository, inference, deps, worker: new ProcedureBoardWorker(deps) };
}

describe('Procedure board background worker', () => {
  it.each(['placement', 'format'])('refreshes and completes one %s job with its lease token', async kind => {
    const { worker, repository, inference } = setup(kind);
    await worker.tick();
    expect(repository.refreshAi).toHaveBeenCalledOnce(); expect(repository.claimAi).toHaveBeenCalledOnce();
    const token = repository.claimAi.mock.calls[0][0];
    expect(repository.saveAiResult).toHaveBeenCalledWith('job-1', token, 7, expect.any(Object));
    expect(inference[kind === 'placement' ? 'suggest' : 'format']).toHaveBeenCalledWith(input, expect.any(AbortSignal));
  });
  it('does not infer for a disabled requesting client or when there is no job', async () => {
    const { worker, repository, inference } = setup();
    repository.aiClientEnabled.mockResolvedValue(false);
    await worker.tick(); expect(inference.suggest).not.toHaveBeenCalled();
    expect(repository.deferAi).toHaveBeenCalledWith('job-1', expect.any(String), 'PROCEDURE_BOARD_CLIENT_DISABLED');
    repository.claimAi.mockResolvedValue(null);
    await worker.tick(); expect(repository.deferAi).toHaveBeenCalledOnce();
  });
  it.each([new InferenceDeferredError(), { status: 429 }, { statusCode: 503 }, { response: { status: 503 } }])('defers admission/provider unavailability %j', async error => {
    const { worker, repository, inference, deps } = setup(); inference.suggest.mockRejectedValue(error);
    await worker.tick(); expect(repository.deferAi).toHaveBeenCalledWith('job-1', expect.any(String), 'WAITING_FOR_INFERENCE', true);
    expect(repository.saveAiResult).not.toHaveBeenCalled(); expect(deps.logError).not.toHaveBeenCalled();
  });
  it.each(['aiClientEnabled', 'suggest', 'saveAiResult'] as const)('defers transient failures from %s', async stage => {
    const { worker, repository, inference } = setup();
    const error = new Error(stage === 'suggest' ? 'ECONNREFUSED' : 'database lock timeout / connection lost');
    if (stage === 'suggest') inference.suggest.mockRejectedValue(error);
    else repository[stage].mockRejectedValue(error);
    await worker.tick();
    expect(repository.deferAi).toHaveBeenCalledWith('job-1', expect.any(String), 'WAITING_FOR_INFERENCE', true);
  });
  it.each(['{bad', JSON.stringify({ ...result, css: 'red' })])('permanently fails malformed model output', async rawText => {
    const { repository, deps } = setup();
    deps.inference = new ProcedureBoardInference({ complete: vi.fn().mockResolvedValue({ rawText, model: 'fake' }) });
    await new ProcedureBoardWorker(deps).tick();
    expect(repository.deferAi).toHaveBeenCalledWith('job-1', expect.any(String), 'PROCEDURE_BOARD_AI_FAILED', false);
    expect(repository.saveAiResult).not.toHaveBeenCalled(); expect(deps.logError).toHaveBeenCalledOnce();
  });
  it('permanently fails a format item mismatch', async () => {
    const { repository, deps } = setup('format');
    deps.inference = new ProcedureBoardInference({ complete: vi.fn().mockResolvedValue({
      rawText: JSON.stringify({ pages: [{ page: 1, rows: [{ cols: [{ itemIds: ['00000000-0000-4000-8000-000000000001'] }], w: [1] }] },
        { page: 2, rows: [] }, { page: 3, rows: [] }], styles: [] }), model: 'fake',
    }) });
    await new ProcedureBoardWorker(deps).tick();
    expect(repository.deferAi).toHaveBeenCalledWith('job-1', expect.any(String), 'PROCEDURE_BOARD_AI_FAILED', false);
    expect(repository.saveAiResult).not.toHaveBeenCalled();
  });
  it.each(['start', 'tick'] as const)('runs at most one inference and stops by aborting work entered via %s', async entry => {
    const { worker, inference, repository } = setup();
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    inference.suggest.mockImplementation((_input, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }); started();
    }));
    if (entry === 'start') worker.start(); else void worker.tick();
    await entered;
    worker.kick(); const overlapping = worker.tick(); expect(inference.suggest).toHaveBeenCalledOnce();
    await worker.stop(); await overlapping; worker.kick();
    expect(repository.deferAi).toHaveBeenCalledWith('job-1', expect.any(String), 'WAITING_FOR_INFERENCE', true);
    expect(repository.saveAiResult).not.toHaveBeenCalled();
  });
  it('polls every five seconds and restarts after stopping', async () => {
    vi.useFakeTimers();
    try {
      const { worker, repository } = setup(); repository.claimAi.mockResolvedValue(null);
      worker.start(); await vi.advanceTimersByTimeAsync(0); expect(repository.claimAi).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5000); expect(repository.claimAi).toHaveBeenCalledTimes(2);
      await worker.stop(); await vi.advanceTimersByTimeAsync(5000); expect(repository.claimAi).toHaveBeenCalledTimes(2);
      worker.start(); await vi.advanceTimersByTimeAsync(0); expect(repository.claimAi).toHaveBeenCalledTimes(3); await worker.stop();
    } finally { vi.useRealTimers(); }
  });
});
