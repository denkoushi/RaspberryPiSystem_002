import { describe, expect, it, vi } from 'vitest';

import { api } from '../http';

import { getInspectionDrawingPlacementProposals } from './part-measurement-placement';

vi.mock('../http', () => ({ api: { get: vi.fn() } }));

describe('getInspectionDrawingPlacementProposals', () => {
  it.each(['cutting', 'grinding'] as const)('sends %s as a query parameter', async (processGroup) => {
    const data = { status: 'no-sibling', sourceDrawingName: null, proposals: [], unplaced: [] };
    vi.mocked(api.get).mockResolvedValue({ data });
    expect(await getInspectionDrawingPlacementProposals('visual', processGroup, 'client-key')).toEqual(data);
    expect(api.get).toHaveBeenLastCalledWith('/part-measurement/visual-templates/visual/placement-proposals', {
      params: { processGroup }, headers: { 'x-client-key': 'client-key' }
    });
  });
});
