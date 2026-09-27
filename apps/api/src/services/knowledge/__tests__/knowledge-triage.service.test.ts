import { describe, expect, it, vi } from 'vitest';

import type { KnowledgeIntakeRepositoryPort } from '../knowledge-intake.port.js';
import { KnowledgeTriageService } from '../knowledge-triage.service.js';
import type { Triage, TriageRepositoryPort } from '../triage.port.js';

const procedureId = '123e4567-e89b-42d3-a456-426614174000';
const triageRow = (suggestions: Triage['suggestions']): Triage => ({ intakeId: 'post-1', posterEmployeeId: 'e1', state: 'awaiting', suggestions, decidedProcedureId: null, createdAt: new Date() });

function service(suggestions: Triage['suggestions'] = null) {
  const triage = { open: vi.fn(), claimSuggesting: vi.fn(), saveSuggestions: vi.fn(), failSuggesting: vi.fn(),
    get: vi.fn().mockResolvedValue([triageRow(suggestions)]), awaitingFor: vi.fn().mockResolvedValue([triageRow(suggestions)]),
    decide: vi.fn().mockResolvedValue({ procedureId }) } satisfies TriageRepositoryPort;
  const intakes = { byIds: vi.fn().mockResolvedValue([{ id: 'post-1', text: 'メモ', createdAt: new Date('2026-09-27T00:00:00Z'), scannedPartNumber: null,
    files: [{ id: 'f', key: 'k', kind: 'image', filename: 'a.jpg' }] }]) } as unknown as KnowledgeIntakeRepositoryPort;
  const resolvePoster = vi.fn(async (uid: string) => uid === 'tag-1' ? { id: 'e1', displayName: '田中' } : null);
  return { triage, resolvePoster, service: new KnowledgeTriageService({ triage, intakes, resolvePoster }) };
}

describe('knowledge triage service', () => {
  it('rejects an unknown tag before touching triage', async () => {
    const { triage, service: s } = service();
    await expect(s.decide('post-1', { posterTagUid: 'stranger', destination: { procedureId } })).rejects.toThrow('UNKNOWN_POSTER');
    expect(triage.decide).not.toHaveBeenCalled();
  });

  it('passes the resolved poster, never an id from the request', async () => {
    const { triage, service: s } = service();
    await s.decide('post-1', { posterTagUid: 'tag-1', destination: { procedureId } });
    expect(triage.decide).toHaveBeenCalledWith('post-1', 'e1', { procedureId });
    await expect(s.decide('post-1', { posterTagUid: 'tag-1', posterEmployeeId: 'someone-else', destination: { procedureId } })).rejects.toThrow();
  });

  it('keeps the review tier in code when a person edits the AI title', async () => {
    const { triage, service: s } = service({ candidates: [], confidence: 0.95, proposal: {
      parts: { target: '技能検定', workType: '申し込み・手続き' }, title: '技能検定｜申し込み・手続き', identifiers: {}, reviewTier: 'auto_publish', reason: '' } });
    await s.decide('post-1', { posterTagUid: 'tag-1', destination: { newTopic: { target: '技能検定', workType: '申し込み・手続き', detail: ' ' } } });
    expect(triage.decide).toHaveBeenLastCalledWith('post-1', 'e1', { newTopic: {
      parts: { target: '技能検定', workType: '申し込み・手続き' }, identifiers: {}, reviewTier: 'auto_publish' } });
    await s.decide('post-1', { posterTagUid: 'tag-1', destination: { newTopic: { target: '部品A', workType: '段取り', partNumber: 'P-1' } } });
    expect(triage.decide).toHaveBeenLastCalledWith('post-1', 'e1', expect.objectContaining({ newTopic: expect.objectContaining({ reviewTier: 'approval_required' }) }));
  });

  it('lists only the scanned poster\'s undecided posts', async () => {
    const { triage, service: s } = service();
    const result = await s.pending({ posterTagUid: 'tag-1' });
    expect(triage.awaitingFor).toHaveBeenCalledWith('e1');
    expect(result).toEqual({ posterName: '田中', items: [{ intakeId: 'post-1', text: 'メモ', createdAt: '2026-09-27T00:00:00.000Z', scannedPartNumber: null,
      files: [{ filename: 'a.jpg', kind: 'image' }], state: 'awaiting', suggestions: null }] });
  });
});
