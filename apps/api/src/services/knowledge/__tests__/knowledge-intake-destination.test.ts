import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { KnowledgeIntakeService } from '../knowledge-intake.service.js';
import type { KnowledgeAssetStore } from '../knowledge-asset-store.js';
import type { Intake, KnowledgeIntakeRepositoryPort } from '../knowledge-intake.port.js';
import type { TriageRepositoryPort } from '../triage.port.js';

const request = () => ({ id: randomUUID(), conversationId: randomUUID(), posterTagUid: 'tag-1', text: 'メモ',
  files: [{ kind: 'pdf', filename: 'test.pdf', base64: Buffer.from('%PDF-test').toString('base64') }], destination: { procedureId: randomUUID() } });
function harness() {
  let stored: Intake | null = null;
  const repository = { get: vi.fn(async () => stored), receive: vi.fn(async receipt => stored ??= { ...receipt, state: 'receiving', action: null }),
    accepted: vi.fn(async () => { stored!.state = 'pending'; }), route: vi.fn(async () => { stored!.action = 'save'; }) };
  const assets = { save: vi.fn() }; const triage = { validateDestination: vi.fn() };
  const service = new KnowledgeIntakeService(repository as unknown as KnowledgeIntakeRepositoryPort, assets as unknown as KnowledgeAssetStore,
    async () => ({ id: 'e1', displayName: '田中' }), triage as unknown as TriageRepositoryPort);
  return { service, repository, assets, triage };
}

describe('knowledge intake destination', () => {
  it.each(['UNKNOWN_PROCEDURE_TOPIC', 'UNKNOWN_KNOWLEDGE_FIELD'])('rejects %s before receiving or writing any files', async code => {
    const h = harness(); h.triage.validateDestination.mockRejectedValue(new Error(code));
    await expect(h.service.receive('client:one', request())).rejects.toThrow(code);
    expect(h.assets.save).not.toHaveBeenCalled(); expect(h.repository.receive).not.toHaveBeenCalled();
  });
  it('passes a durable destination and hashes it, preserving identical resends and rejecting different destinations', async () => {
    const h = harness(); const input = request();
    await h.service.receive('client:one', input);
    expect(h.repository.receive).toHaveBeenCalledWith(expect.objectContaining({ destination: input.destination }));
    await h.service.receive('client:one', input);
    expect(h.assets.save).toHaveBeenCalledOnce(); expect(h.triage.validateDestination).toHaveBeenCalledOnce();
    await expect(h.service.receive('client:one', { ...input, destination: { procedureId: randomUUID() } })).rejects.toThrow('INTAKE_CONFLICT');
  });
  it('allows office topics without AI confidence and retains the legacy hash when no destination is sent', async () => {
    const h = harness(); const input = request();
    await h.service.receive('client:one', { ...input, destination: { newTopic: { target: '休暇', workType: '各種申請' } } });
    expect(h.repository.receive).toHaveBeenCalledWith(expect.objectContaining({ destination: { newTopic: {
      parts: { target: '休暇', workType: '各種申請' }, identifiers: {}, reviewTier: 'auto_publish',
    } } }));
    const auto = harness(); const legacy = { ...request(), destination: undefined };
    await auto.service.receive('client:one', legacy);
    expect(auto.triage.validateDestination).not.toHaveBeenCalled();
    expect(auto.repository.receive.mock.calls[0][0].destination).toBeUndefined();
  });
});
