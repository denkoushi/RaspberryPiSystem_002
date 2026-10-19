import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { importMaster, importMasterSingle } from '../client';
import { toolsQueryKeys } from '../queryKeys/tools';

import { useImportMaster, useImportMasterSingle } from './system';

import type { PropsWithChildren } from 'react';

vi.mock('../client', () => ({ importMaster: vi.fn(), importMasterSingle: vi.fn() }));
let client: QueryClient;
function Wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => { client = new QueryClient(); vi.mocked(importMaster).mockReset().mockResolvedValue({} as never); vi.mocked(importMasterSingle).mockReset().mockResolvedValue({} as never); });
afterEach(() => { client.clear(); vi.restoreAllMocks(); });

type ImportType = Parameters<typeof importMasterSingle>[0]['type'];

async function importAndCollectKeys(type: ImportType) {
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const { result } = renderHook(useImportMasterSingle, { wrapper: Wrapper });
  await act(async () => { await result.current.mutateAsync({ type, file: new File(['a'], 'a.csv') }); });
  return invalidate.mock.calls.map(([filters]) => filters?.queryKey);
}

describe('useImportMasterSingle', () => {
  it.each([
    ['employees', [['employees']]],
    ['items', [['items']]],
    ['measuringInstruments', [['measuring-instruments']]],
    ['riggingGears', [['rigging-gears']]],
    ['machines', [toolsQueryKeys.machinesAll, toolsQueryKeys.uninspectedMachinesAll]]
  ] as const)('invalidates the list cache for %s after a successful import', async (type, keys) => {
    expect(await importAndCollectKeys(type)).toEqual(keys);
  });
});

describe('useImportMaster', () => {
  it('invalidates the employee and item caches after a successful import', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(useImportMaster, { wrapper: Wrapper });
    await act(async () => { await result.current.mutateAsync({} as never); });
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([['employees'], ['items']]);
  });
});
