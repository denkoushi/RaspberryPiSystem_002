import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../http';

import {
  getSelfInspectionNonconformities,
  type SelfInspectionNonconformity
} from './self-inspection-nonconformities';

vi.mock('../http', () => ({
  api: { get: vi.fn() }
}));

const apiGet = vi.mocked(api.get);

const item: SelfInspectionNonconformity = {
  id: 'nonconformity-1',
  discoveredOn: '2026-09-02',
  originDepartmentName: '製造一課',
  remarks: '寸法不良',
  nonconformityContent: '加工面に傷',
  dispositionContent: '再加工',
  correctiveContent1: '工具交換',
  correctiveContent2: '初品確認を追加',
  partName: '部品A',
  machineName: 'FJV50/80'
};

describe('self-inspection nonconformity API client', () => {
  beforeEach(() => apiGet.mockReset());

  it('normalizes the canonical part number and returns all current items', async () => {
    apiGet.mockResolvedValueOnce({ data: { count: 1, items: [item] } } as never);
    const signal = new AbortController().signal;

    await expect(getSelfInspectionNonconformities(' ｐａｒｔ－１ ', signal)).resolves.toEqual([item]);
    expect(apiGet).toHaveBeenCalledWith('/kiosk/self-inspection/nonconformities', {
      params: { partNumber: 'PART-1' },
      signal
    });
  });

  it('does not request the API for a blank part number', async () => {
    await expect(getSelfInspectionNonconformities('  ')).resolves.toEqual([]);
    expect(apiGet).not.toHaveBeenCalled();
  });
});
