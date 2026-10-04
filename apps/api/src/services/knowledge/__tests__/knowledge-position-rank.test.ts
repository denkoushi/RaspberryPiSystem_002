import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { canApprove, positionRank, KNOWLEDGE_POSITION_RANKS } from '../knowledge-position-rank.js';
import { PrismaKnowledgeReviewerRepository, resolveKnowledgeEmployee } from '../prisma-knowledge-reviewer.repository.js';

function database(positionName: string | null = '主任', rank: string | null = 'leader', status = 'ACTIVE') {
  return { employee: { findUnique: vi.fn().mockResolvedValue({ id: 'e1', employeeCode: '0001', displayName: '社員A', nfcTagUid: 'tag', positionName, status }), groupBy: vi.fn() },
    measuringInstrumentTag: { findUnique: vi.fn().mockResolvedValue(null) },
    knowledgePositionRank: { findUnique: vi.fn().mockResolvedValue(rank ? { rank } : null), findMany: vi.fn() } };
}

describe('knowledge approval ranks and NFC identity', () => {
  it('orders the four ranks and defaults unknown ranks to general', () => {
    expect(KNOWLEDGE_POSITION_RANKS).toEqual(['general', 'leader', 'section_chief', 'manager']);
    expect(canApprove('general')).toBe(false); expect(positionRank('unexpected')).toBe('general');
  });
  it.each(['leader', 'section_chief', 'manager'])('permits %s and returns roster snapshots', async rank => {
    const employee = await resolveKnowledgeEmployee(database('主任', rank) as unknown as PrismaClient, ' tag ', true);
    expect(employee).toEqual({ id: 'e1', employeeCode: '0001', displayName: '社員A', nfcTagUid: 'tag', positionName: '主任', rank });
  });
  it.each([['一般', 'general'], ['未対応', null], [null, null], ['', null]])('rejects non-approvers with position %s', async (position, rank) => {
    const db = database(position, rank);
    await expect(resolveKnowledgeEmployee(db as unknown as PrismaClient, 'tag', true)).rejects.toThrow('KNOWLEDGE_APPROVAL_FORBIDDEN');
    expect((await resolveKnowledgeEmployee(db as unknown as PrismaClient, 'tag')).rank).toBe('general');
  });
  it.each(['INACTIVE', 'SUSPENDED'])('rejects %s employees for reviews and error reports', async status => {
    await expect(resolveKnowledgeEmployee(database('主任', 'leader', status) as unknown as PrismaClient, 'tag')).rejects.toThrow('KNOWLEDGE_INACTIVE_EMPLOYEE');
  });
  it('rejects unknown, instrument-only, blank and duplicated tags', async () => {
    const db = database(); db.employee.findUnique.mockResolvedValue(null);
    await expect(resolveKnowledgeEmployee(db as unknown as PrismaClient, 'tag', true)).rejects.toThrow('KNOWLEDGE_UNKNOWN_EMPLOYEE');
    db.measuringInstrumentTag.findUnique.mockResolvedValue({ id: 'instrument' });
    await expect(resolveKnowledgeEmployee(db as unknown as PrismaClient, 'tag', true)).rejects.toThrow('KNOWLEDGE_UNKNOWN_EMPLOYEE');
    db.employee.findUnique.mockResolvedValue({ nfcTagUid: 'tag' });
    await expect(resolveKnowledgeEmployee(db as unknown as PrismaClient, 'tag', true)).rejects.toThrow('KNOWLEDGE_DUPLICATE_TAG');
    await expect(resolveKnowledgeEmployee(db as unknown as PrismaClient, ' ', true)).rejects.toThrow('KNOWLEDGE_UNKNOWN_EMPLOYEE');
  });
  it('lists unmapped roster positions with employee counts', async () => {
    const db = database();
    db.knowledgePositionRank.findMany.mockResolvedValue([{ positionName: '主任', rank: 'leader' }]);
    db.employee.groupBy.mockResolvedValue([{ positionName: '主任', _count: { _all: 2 } }, { positionName: '主事', _count: { _all: 3 } }, { positionName: '', _count: { _all: 1 } }]);
    expect(await new PrismaKnowledgeReviewerRepository(db as unknown as PrismaClient).listRanks()).toEqual({
      ranks: [{ positionName: '主任', rank: 'leader' }], unmappedPositions: [{ positionName: '主事', employeeCount: 3 }],
    });
  });
});
