import { describe, expect, it, vi } from 'vitest';
import { exportBusinessHermesLearning } from './export-business-hermes-learning.js';

const since = new Date('2026-09-13T00:00:00Z');
const until = new Date('2026-09-13T01:00:00Z');

describe('private Hermes learning export', () => {
  it('paginates and binds answers to the same consultation; retains failures and skips legacy rows', async () => {
    const measurement = { kind: 'business-hermes-learning-v1', status: 'ready', answerMessageId: 'answer-1' };
    const db = { businessHermesConsultationMessage: {
      findMany: vi.fn().mockResolvedValueOnce([
        { id: 'user-1', consultationId: 'case-1', searchDiagnostics: [measurement] },
        { id: 'legacy', consultationId: 'case-1', searchDiagnostics: [] }
      ]).mockResolvedValueOnce([
        { id: 'user-2', consultationId: 'case-2', searchDiagnostics: [{ kind: 'business-hermes-learning-v1', status: 'unavailable' }] }
      ]).mockResolvedValueOnce([]),
      findFirst: vi.fn().mockResolvedValue({ id: 'answer-1', content: 'answer', evidence: { items: [] }, searchDiagnostics: [] })
    } };
    const lines: string[] = [];
    expect(await exportBusinessHermesLearning(db as never, since, until, async (line) => { lines.push(line); })).toBe(2);
    expect(db.businessHermesConsultationMessage.findMany.mock.calls[0]![0]).toMatchObject({ take: 100, where: { role: 'user', createdAt: { gte: since, lt: until } } });
    expect(db.businessHermesConsultationMessage.findMany.mock.calls[1]![0]).toMatchObject({ cursor: { id: 'legacy' }, skip: 1 });
    expect(db.businessHermesConsultationMessage.findFirst).toHaveBeenCalledExactlyOnceWith({ where: { id: 'answer-1', consultationId: 'case-1', role: 'assistant' }, select: { id: true, content: true, evidence: true, searchDiagnostics: true } });
    expect(JSON.parse(lines[0]!)).toMatchObject({ schemaVersion: 1, id: 'user-1', measurement });
    expect(JSON.parse(lines[1]!)).toMatchObject({ id: 'user-2', answer: null, measurement: { status: 'unavailable' } });
  });

  it('rejects an invalid range before reading business data', async () => {
    const findMany = vi.fn();
    await expect(exportBusinessHermesLearning({ businessHermesConsultationMessage: { findMany } } as never, until, since, vi.fn())).rejects.toThrow('Invalid export');
    expect(findMany).not.toHaveBeenCalled();
  });
});
