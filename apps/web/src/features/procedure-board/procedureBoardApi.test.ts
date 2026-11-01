import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api/client';

import { procedureBoardApi } from './procedureBoardApi';
import { emptyLayout } from './procedureBoardLayout';

vi.mock('../../api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
describe('procedureBoardApi HTTP boundary', () => {
  it('creates only when initial GET reports missing, and never creates on 403 or network failure', async () => {
    vi.mocked(api.get).mockRejectedValueOnce({ response: { status: 404 } });
    vi.mocked(api.post).mockResolvedValue({ data: { version: 1 } });
    expect(await procedureBoardApi.open('topic/a')).toEqual({ version: 1 });
    expect(api.post).toHaveBeenCalledWith('/kiosk/procedure-boards/topic%2Fa', {});
    vi.mocked(api.post).mockClear(); vi.mocked(api.get).mockRejectedValueOnce({ response: { status: 403 } });
    await expect(procedureBoardApi.open('topic')).rejects.toMatchObject({ response: { status: 403 } });
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    await expect(procedureBoardApi.open('topic')).rejects.toThrow('offline'); expect(api.post).not.toHaveBeenCalled();
  });
  it('reads every materials page without duplicating the shelf', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { materials: [{ materialId: 'a' }], nextCursor: 'cursor a' } })
      .mockResolvedValueOnce({ data: { materials: [{ materialId: 'b' }], nextCursor: null } });
    expect(await procedureBoardApi.materials('topic')).toEqual([{ materialId: 'a' }, { materialId: 'b' }]);
    expect(api.get).toHaveBeenLastCalledWith('/kiosk/procedure-boards/topic/materials?cursor=cursor%20a');
  });
  it('uses the API single-event save and decision shapes with stable UUIDs', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: {} }); vi.mocked(api.post).mockResolvedValue({ data: {} });
    const layout = emptyLayout(); const event = { id: crypto.randomUUID(), type: 'item_removed', payload: { itemId: crypto.randomUUID() } };
    await procedureBoardApi.save('topic', 3, layout, event);
    expect(api.put).toHaveBeenCalledWith('/kiosk/procedure-boards/topic', { expectedVersion: 3, layout, event });
    const id = crypto.randomUUID(); await procedureBoardApi.decide('topic', 'ai', 3, { action: 'select_conflict', proposalId: 'c', selectedMaterialId: 'a' }, id);
    expect(api.post).toHaveBeenLastCalledWith('/kiosk/procedure-boards/topic/suggestions/ai/decisions', { expectedVersion: 3, eventId: id, action: 'select_conflict', proposalId: 'c', selectedMaterialId: 'a' });
    await procedureBoardApi.decideFormat('topic', 'fmt', 4, 'revert', id);
    expect(api.post).toHaveBeenLastCalledWith('/kiosk/procedure-boards/topic/format-proposals/fmt/decision', { expectedVersion: 4, eventId: id, action: 'revert' });
  });
});
