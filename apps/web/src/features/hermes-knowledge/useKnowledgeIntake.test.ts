import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api/http';

import { useKnowledgeIntake } from './useKnowledgeIntake';

vi.mock('../../api/http', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const response = { id: 'one', text: 'メモ', state: 'choice', version: 2, message: '選択してください', files: [], choices: [{ id: 'save', label: '記録に残す' }], errorCode: null };
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear();
  vi.mocked(api.get).mockImplementation(async url => ({ data: url.endsWith('capabilities') ? { enabled: true } : { intakes: [] } }));
});
describe('Knowledge intake UI contract', () => {
  it('preserves attachments and submission identity after a failed send', async () => {
    const { result } = renderHook(() => useKnowledgeIntake('actor', null, true));
    await waitFor(() => expect(result.current.enabled).toBe(true));
    const file = new File(['%PDF-synthetic'], '準備.pdf', { type: 'application/pdf' });
    act(() => result.current.setFiles([file]));
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: response });
    await act(async () => { await expect(result.current.receive('メモ')).rejects.toThrow('offline'); });
    expect(result.current.files).toEqual([file]);
    await act(async () => { expect(await result.current.receive('メモ')).toBe(true); });
    expect(vi.mocked(api.post).mock.calls[0]?.[1]).toEqual(vi.mocked(api.post).mock.calls[1]?.[1]);
    expect(result.current.files).toEqual([]);
    expect(result.current.items[0]?.state).toBe('choice');
  });
  it('sends the stable choice ID and expected version', async () => {
    const { result } = renderHook(() => useKnowledgeIntake('actor', null, true));
    await waitFor(() => expect(result.current.enabled).toBe(true));
    vi.mocked(api.post).mockResolvedValue({ data: response });
    await act(async () => { await result.current.choose(response, 'save'); });
    expect(api.post).toHaveBeenCalledWith('/hermes-knowledge/intakes/one/choice', { version: 2, action: 'save' });
  });
  it('discards an old actor response and delegates ordinary questions', async () => {
    const { result, rerender } = renderHook(({ actor }) => useKnowledgeIntake(actor, null, true), { initialProps: { actor: 'one' } });
    await waitFor(() => expect(result.current.enabled).toBe(true));
    let resolve!: (value: { data: typeof response }) => void;
    vi.mocked(api.post).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    let pending!: Promise<boolean | null>;
    act(() => { pending = result.current.receive('メモ'); });
    rerender({ actor: 'two' });
    await act(async () => { resolve({ data: response }); expect(await pending).toBeNull(); });
    expect(result.current.items).toEqual([]);
    await waitFor(() => expect(result.current.enabled).toBe(true));
    vi.mocked(api.post).mockResolvedValue({ data: { ...response, state: 'delegated' } });
    await act(async () => { expect(await result.current.receive('工具を探す')).toBe(false); });
  });
});
