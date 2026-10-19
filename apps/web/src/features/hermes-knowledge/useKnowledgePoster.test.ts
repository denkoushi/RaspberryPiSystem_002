import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchPendingTriage } from './knowledgeTriageApi';
import { useKnowledgePoster } from './useKnowledgePoster';

const nfc = vi.hoisted(() => ({ read: null as null | { uid: string }, armed: [] as boolean[], baseline: null as null | { uid: string } }));
// Like the real hook, a read already present when the reader is re-armed is not reported again.
vi.mock('../kiosk/inventory/setup/useArmedNfcRead', () => ({ useArmedNfcRead: (armed: boolean) => {
  const wasArmed = nfc.armed.at(-1) ?? false;
  nfc.armed.push(armed);
  if (armed && !wasArmed && nfc.armed.length > 1) nfc.baseline = nfc.read;
  return armed && nfc.read !== nfc.baseline ? nfc.read : null;
} }));
vi.mock('./knowledgeTriageApi', () => ({ fetchPendingTriage: vi.fn() }));

beforeEach(() => { nfc.read = null; nfc.armed = []; nfc.baseline = null; vi.mocked(fetchPendingTriage).mockReset(); });

describe('knowledge poster', () => {
  it('verifies a scanned tag, exposes pending posts and requires a new scan after one post', async () => {
    vi.mocked(fetchPendingTriage).mockResolvedValue({ posterName: '田中', items: [{ intakeId: 'old', text: 'x', createdAt: '2026-09-26T00:00:00Z', scannedPartNumber: null, files: [], state: 'awaiting', suggestions: null }] });
    const { result, rerender } = renderHook(({ active }) => useKnowledgePoster(active), { initialProps: { active: true } });
    expect(nfc.armed.at(-1)).toBe(true);
    nfc.read = { uid: 'tag-1' }; rerender({ active: true });
    await waitFor(() => expect(result.current.poster).toEqual({ tagUid: 'tag-1', name: '田中' }));
    expect(result.current.pending).toHaveLength(1);
    act(() => result.current.setPartNumber('P-1'));
    let consumed: ReturnType<typeof result.current.consume> = null;
    act(() => { consumed = result.current.consume(); });
    expect(consumed).toEqual({ tagUid: 'tag-1', name: '田中', partNumber: 'P-1' });
    expect(result.current.poster).toBeNull(); expect(result.current.partNumber).toBeNull();
  });

  it('reports an unknown tag and forgets everything when knowledge closes', async () => {
    vi.mocked(fetchPendingTriage).mockRejectedValueOnce(new Error('社員タグを確認できません。'));
    const { result, rerender } = renderHook(({ active }) => useKnowledgePoster(active), { initialProps: { active: true } });
    nfc.read = { uid: 'stranger' }; rerender({ active: true });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.poster).toBeNull();
    rerender({ active: false });
    expect(result.current.error).toBeNull();
  });
});
