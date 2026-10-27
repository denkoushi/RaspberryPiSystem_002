import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMobilePlacementRegisteredShelves, getMobilePlacementShelfMachines } from '../../api/client';

import { HaizenShelfPhotoList } from './haizen/HaizenShelfPhotoPicker';
import { getCachedRegisteredShelves, getCachedShelfMachines } from './shelfListCache';
import { useRegisteredShelves } from './useRegisteredShelves';

vi.mock('../../api/client', () => ({ getMobilePlacementRegisteredShelves: vi.fn(), getMobilePlacementShelfMachines: vi.fn() }));
const shelves = { shelves: [{ shelfCodeRaw: '電気室 北', isStructured: true, machineName: '電気室', direction: '北' as const, displayLabel: null }] };
const machines = { machines: ['DAD-3220'], landmarks: ['電気室'] };
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.mocked(getMobilePlacementRegisteredShelves).mockResolvedValue(shelves);
  vi.mocked(getMobilePlacementShelfMachines).mockResolvedValue(machines);
});
afterEach(() => { vi.restoreAllMocks(); onlineManager.setOnline(true); });

describe('shelf list cache', () => {
  it('stores the last successful lists and uses them on no-response failures', async () => {
    await getCachedRegisteredShelves(); await getCachedShelfMachines();
    const updated = { machines: ['DAD-3220', '50013'], landmarks: ['電気室', '倉庫'] };
    vi.mocked(getMobilePlacementShelfMachines).mockResolvedValueOnce(updated);
    expect(await getCachedShelfMachines()).toEqual(updated);
    vi.mocked(getMobilePlacementRegisteredShelves).mockRejectedValue(new Error('offline'));
    vi.mocked(getMobilePlacementShelfMachines).mockRejectedValue(new Error('offline'));
    expect(await getCachedRegisteredShelves()).toEqual(shelves);
    expect(await getCachedShelfMachines()).toEqual(updated);
  });

  it('uses stored lists without network calls offline', async () => {
    await getCachedRegisteredShelves(); await getCachedShelfMachines();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.mocked(getMobilePlacementRegisteredShelves).mockClear(); vi.mocked(getMobilePlacementShelfMachines).mockClear();
    expect(await getCachedRegisteredShelves()).toEqual(shelves);
    expect(await getCachedShelfMachines()).toEqual(machines);
    expect(getMobilePlacementRegisteredShelves).not.toHaveBeenCalled();
    expect(getMobilePlacementShelfMachines).not.toHaveBeenCalled();
  });

  it('still returns live lists when storage is blocked or full', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(await getCachedRegisteredShelves()).toEqual(shelves);
    expect(await getCachedShelfMachines()).toEqual(machines);
  });

  it.each(['{broken', '{}', '{"shelves":[null],"machines":[1],"landmarks":[]}'])('rejects invalid stored lists: %s', async (bad) => {
    localStorage.setItem('mobile-placement-registered-shelves-v1', bad);
    localStorage.setItem('mobile-placement-shelf-machines-v1', bad);
    vi.mocked(getMobilePlacementRegisteredShelves).mockRejectedValue(new Error('offline'));
    vi.mocked(getMobilePlacementShelfMachines).mockRejectedValue(new Error('offline'));
    await expect(getCachedRegisteredShelves()).rejects.toThrow('offline');
    await expect(getCachedShelfMachines()).rejects.toThrow('offline');
  });

  it('lets the haizen shelf picker select a cached registered shelf while React Query is offline', async () => {
    await getCachedRegisteredShelves();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    onlineManager.setOnline(false);
    vi.mocked(getMobilePlacementRegisteredShelves).mockRejectedValue(new Error('offline'));
    const onSelect = vi.fn();
    function Picker() {
      const query = useRegisteredShelves();
      return <HaizenShelfPhotoList shelves={query.data?.shelves ?? []} previousShelfCodes={[]} selected=""
        loading={query.isLoading} error={query.isError} onRetry={() => void query.refetch()} onSelect={onSelect} />;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><Picker /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '棚 電気室 北', exact: true }));
    expect(onSelect).toHaveBeenCalledWith('電気室 北');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
