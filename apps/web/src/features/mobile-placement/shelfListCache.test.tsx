import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMobilePlacementRegisteredShelves, getMobilePlacementShelfMachines } from '../../api/client';

import { resetMobileConnectivityForTests } from './connectivity';
import { HaizenShelfPhotoList } from './haizen/HaizenShelfPhotoPicker';
import { getCachedRegisteredShelves, getCachedShelfMachines } from './shelfListCache';
import { useRegisteredShelves } from './useRegisteredShelves';
import { useShelfMachines } from './useShelfMachines';

vi.mock('../../api/client', () => ({ getMobilePlacementRegisteredShelves: vi.fn(), getMobilePlacementShelfMachines: vi.fn() }));
const shelves = { shelves: [{ shelfCodeRaw: '電気室 北', isStructured: true, machineName: '電気室', direction: '北' as const, displayLabel: null }] };
const machines = { machines: ['DAD-3220'], landmarks: ['電気室'] };
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
  vi.mocked(getMobilePlacementRegisteredShelves).mockResolvedValue(shelves);
  vi.mocked(getMobilePlacementShelfMachines).mockResolvedValue(machines);
});
afterEach(() => { resetMobileConnectivityForTests(); vi.restoreAllMocks(); vi.useRealTimers(); onlineManager.setOnline(true); });

describe('shelf list cache', () => {
  it('stores the last successful lists and uses them on no-response failures', async () => {
    await getCachedRegisteredShelves(); await getCachedShelfMachines();
    const updated = { machines: ['DAD-3220', '50013'], landmarks: ['電気室', '倉庫'] };
    vi.mocked(getMobilePlacementShelfMachines).mockResolvedValueOnce(updated);
    expect(await getCachedShelfMachines()).toEqual(machines);
    await waitFor(() => expect(JSON.parse(localStorage.getItem('mobile-placement-shelf-machines-v1')!)).toEqual(updated));
    vi.mocked(getMobilePlacementRegisteredShelves).mockRejectedValue(new Error('offline'));
    vi.mocked(getMobilePlacementShelfMachines).mockRejectedValue(new Error('offline'));
    expect(await getCachedRegisteredShelves()).toEqual(shelves);
    expect(await getCachedShelfMachines()).toEqual(updated);
  });

  it('returns both saved lists without waiting for a stalled online request', async () => {
    await getCachedRegisteredShelves(); await getCachedShelfMachines();
    let finishShelves!: (value: typeof shelves) => void;
    let finishMachines!: (value: typeof machines) => void;
    vi.mocked(getMobilePlacementRegisteredShelves).mockReturnValue(new Promise((resolve) => { finishShelves = resolve; }));
    vi.mocked(getMobilePlacementShelfMachines).mockReturnValue(new Promise((resolve) => { finishMachines = resolve; }));
    expect(await getCachedRegisteredShelves()).toEqual(shelves);
    expect(await getCachedShelfMachines()).toEqual(machines);
    const updated = { machines: ['new'], landmarks: [] };
    finishShelves({ shelves: [] }); finishMachines(updated);
    await waitFor(() => expect(JSON.parse(localStorage.getItem('mobile-placement-registered-shelves-v1')!)).toEqual({ shelves: [] }));
    expect(JSON.parse(localStorage.getItem('mobile-placement-shelf-machines-v1')!)).toEqual(updated);
  });

  it('immediately displays stored lists and updates observers when background requests finish', async () => {
    await getCachedRegisteredShelves(); await getCachedShelfMachines();
    let finishShelves!: (value: typeof shelves) => void;
    let finishMachines!: (value: typeof machines) => void;
    vi.mocked(getMobilePlacementRegisteredShelves).mockReturnValue(new Promise((resolve) => { finishShelves = resolve; }));
    vi.mocked(getMobilePlacementShelfMachines).mockReturnValue(new Promise((resolve) => { finishMachines = resolve; }));
    const client = new QueryClient();
    const { result } = renderHook(() => ({ shelves: useRegisteredShelves(), machines: useShelfMachines() }), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    });
    expect(result.current.shelves.data).toEqual(shelves);
    expect(result.current.machines.data).toEqual(machines);
    expect(result.current.shelves.isLoading).toBe(false);
    expect(result.current.machines.isLoading).toBe(false);
    const updated = { machines: ['new'], landmarks: ['倉庫'] };
    await act(async () => { finishShelves({ shelves: [] }); finishMachines(updated); });
    await waitFor(() => expect(result.current.machines.data).toEqual(updated));
    expect(result.current.shelves.data).toEqual({ shelves: [] });
    expect(JSON.parse(localStorage.getItem('mobile-placement-shelf-machines-v1')!)).toEqual(updated);
    expect(JSON.parse(localStorage.getItem('mobile-placement-registered-shelves-v1')!)).toEqual({ shelves: [] });
    client.clear();
  });

  it('fails immediately without saved lists offline, even if React Query is paused', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    onlineManager.setOnline(false);
    const client = new QueryClient();
    const { result } = renderHook(() => ({ shelves: useRegisteredShelves(), machines: useShelfMachines() }), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    });
    await waitFor(() => expect(result.current.machines.isError).toBe(true));
    expect(result.current.shelves.isError).toBe(true);
    expect(result.current.machines.fetchStatus).toBe('idle');
    expect(result.current.shelves.fetchStatus).toBe('idle');
    expect(getMobilePlacementShelfMachines).not.toHaveBeenCalled();
    expect(getMobilePlacementRegisteredShelves).not.toHaveBeenCalled();
    client.clear();
  });

  it('bounds unresponsive requests with no saved lists to five seconds and does not retry', async () => {
    vi.useFakeTimers();
    vi.mocked(getMobilePlacementRegisteredShelves).mockReturnValue(new Promise(() => {}));
    vi.mocked(getMobilePlacementShelfMachines).mockReturnValue(new Promise(() => {}));
    const client = new QueryClient();
    const { result } = renderHook(() => ({ shelves: useRegisteredShelves(), machines: useShelfMachines() }), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(5001); });
    expect(result.current.machines.isError).toBe(true);
    expect(result.current.shelves.isError).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(getMobilePlacementShelfMachines).toHaveBeenCalledTimes(1);
    expect(getMobilePlacementRegisteredShelves).toHaveBeenCalledTimes(1);
    client.clear();
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
