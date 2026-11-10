import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { recordConsultationFeedback } from './business-hermes-consultation-feedback.js';
import type { BusinessHermesConsultationCaller } from './business-hermes-consultation-owner.js';

const experience = { kind: 'business-hermes-experience-v1', canonicalQuestion: 'question', question: 'question', answer: 'answer', sources: [{ kind: 'nonconformity', id: '1', sha256: 'a'.repeat(64) }] };
function fixture(userId: string | null, deviceId: string | null) {
  return { businessHermesConsultation: { findUnique: vi.fn(async () => ({ createdByUserId: userId, createdByClientDeviceId: deviceId })) },
    businessHermesConsultationMessage: { findFirst: vi.fn(async () => ({ id: 'm1', searchDiagnostics: [experience] })), update: vi.fn(async () => ({})) } };
}
describe('consultation feedback promotion', () => {
  it.each([
    [{ kind: 'device', clientDeviceId: 'd1' }, null, 'd1', false],
    [{ kind: 'user', userId: 'u1', role: 'MANAGER' }, 'u1', null, true],
    [{ kind: 'user', userId: 'u2', role: 'ADMIN' }, 'u1', null, true],
    [{ kind: 'user', userId: 'u1', role: 'ADMIN' }, 'u1', null, true]
  ] as const)('records feedback and controls promotion for %j', async (caller, userId, deviceId, canPromote) => {
    const db = fixture(userId, deviceId);
    const cache = { remember: vi.fn(async () => true), feedback: vi.fn(async () => true) };
    expect(await recordConsultationFeedback(db as unknown as PrismaClient, cache, 'c1', 'm1', 'helpful', caller)).toBe(true);
    expect(cache.feedback).toHaveBeenCalledWith('m1', 'helpful', canPromote);
    expect(db.businessHermesConsultationMessage.update).toHaveBeenCalledWith(expect.objectContaining({ data: { searchDiagnostics: [{ ...experience, verdict: 'helpful' }] } }));
  });
  it('preserves owner checks for VIEWER users', async () => {
    const db = fixture('u1', null);
    const caller: BusinessHermesConsultationCaller = { kind: 'user', userId: 'u1', role: 'VIEWER' };
    await expect(recordConsultationFeedback(db as unknown as PrismaClient, {}, 'c1', 'm1', 'helpful', caller)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('continues to send negative owner feedback to the cache', async () => {
    const db = fixture(null, 'd1');
    const cache = { remember: vi.fn(async () => true), feedback: vi.fn(async () => true) };
    await recordConsultationFeedback(db as unknown as PrismaClient, cache, 'c1', 'm1', 'unhelpful', { kind: 'device', clientDeviceId: 'd1' });
    expect(cache.feedback).toHaveBeenCalledWith('m1', 'unhelpful', false);
  });
});
