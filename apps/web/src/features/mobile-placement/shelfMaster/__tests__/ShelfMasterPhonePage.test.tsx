import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../../../../api/client';
import { ShelfMasterPageContent } from '../ShelfMasterPageContent';

vi.mock('../../../../api/client', () => ({
  getMobilePlacementRegisteredShelves: vi.fn(), getMobilePlacementShelfPhoto: vi.fn(),
  getMobilePlacementClientCapabilities: vi.fn(), getMobilePlacementMachineMasters: vi.fn(),
  getMobilePlacementShelfLayoutSummary: vi.fn(), getMobilePlacementShelfLayoutZone: vi.fn(),
  postMobilePlacementShelfRelocate: vi.fn(), putMobilePlacementShelfLayoutZone: vi.fn(),
  putMobilePlacementHaizenTargetPresetShelf: vi.fn(), getMobilePlacementHaizenTargetDevices: vi.fn(),
}));
const entity = (id: string, cell: number, kind: api.ShelfLayoutEntityDto['entityKind'], code: string | null = null): api.ShelfLayoutEntityDto => ({
  id, cellIndices: [cell], entityKind: kind, resourceCd: kind === 'MACHINE' ? 'M1' : null,
  resourceName: kind === 'MACHINE' ? '加工機A' : null, shelfCodeRaw: code, displayLabel: code, aisleLabel: null,
});
const west: api.ShelfLayoutZoneDto = {
  macroZoneId: 'nw', displayName: '西·北', shelfPrefix: '西-北', gridSize: 3, nextShelfSlot: 2,
  updatedAt: '2026-10-16T00:00:00Z', zero2wDeviceCountByShelfCode: { '西-北-01': 1 },
  entities: [entity('shelf', 0, 'SHELF', '西-北-01'), entity('machine', 4, 'MACHINE'), entity('aisle', 8, 'AISLE')],
};
const center: api.ShelfLayoutZoneDto = { ...west, macroZoneId: 'n', displayName: '中央·北', shelfPrefix: '中央-北', gridSize: 4,
  entities: [entity('destination', 0, 'SHELF', '中央-北-01')] };
const routeState = { transferOrder: '1234567890', transferPart: 'PART', actualOrder: '1234567890', actualFseiban: 'S', actualPart: 'PART', slipResult: 'ok', shelfCode: '西-北-01', orderBarcode: '1234567890' };
function Hub() { const location = useLocation(); return <pre data-testid="hub-state">{JSON.stringify(location.state)}</pre>; }
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: '/master', state: routeState }]}><Routes>
    <Route path="/master" element={<ShelfMasterPageContent />} /><Route path="/kiosk/mobile-placement" element={<Hub />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getMobilePlacementRegisteredShelves).mockResolvedValue({ shelves: [] });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.mocked(api.getMobilePlacementClientCapabilities).mockResolvedValue({ shelfLayoutEditEnabled: true, haizenEdgeEnabled: true });
  vi.mocked(api.getMobilePlacementMachineMasters).mockResolvedValue({ machines: [{ resourceCd: 'M1', resourceName: '加工機A' }] });
  vi.mocked(api.getMobilePlacementShelfLayoutSummary).mockResolvedValue({ zones: [west, center].map((z) => ({ macroZoneId: z.macroZoneId, displayName: z.displayName, gridSize: z.gridSize, shelfCount: 1, machineCount: 1, entities: z.entities })) });
  vi.mocked(api.getMobilePlacementShelfLayoutZone).mockImplementation(async (zone) => zone === 'n' ? center : west);
  vi.mocked(api.getMobilePlacementHaizenTargetDevices).mockResolvedValue({ devices: [{ id: 'pi1', name: 'Pi 1', location: null, lastSeenAt: null, shelfCodeRaw: '西-北-01' }] });
  vi.mocked(api.putMobilePlacementShelfLayoutZone).mockResolvedValue(west);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('ShelfMaster phone/desktop and existing mutations', () => {
  it('opens photo mode first and allows switching to the map', async () => {
    mount();
    expect(screen.getByRole('button', { name: '写真', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await screen.findByRole('button', { name: '棚を追加' });
    click('棚を移す');
    await screen.findByLabelText('工場マップ');
  });

  it('renders a north-up map and retains the hub hand-off on back', async () => {
    mount(); click('棚を移す'); const map = await screen.findByLabelText('工場マップ');
    expect(within(map).getAllByRole('button').map((b) => b.textContent?.replace(/棚\d+/, ''))).toEqual(['西·北', '中央·北', '東·北', '西·中央', '中央·中央', '東·中央', '西·南', '中央·南', '東·南']);
    click(/西·北/); await screen.findByRole('button', { name: '西-北-01' });
    expect(screen.getByLabelText('区画の配置')).toHaveStyle({ gridTemplateColumns: '30px repeat(3, minmax(0, 1fr)) 30px' });
    expect(screen.getByRole('img', { name: 'Zero2W 担当' })).toBeInTheDocument();
    click('戻る'); expect(screen.getByRole('heading', { name: '棚マスタ' })).toBeInTheDocument();
    click('戻る'); expect(JSON.parse(screen.getByTestId('hub-state').textContent!)).toEqual(routeState);
  });

  it('retains the original desktop UI and responds to viewport changes', async () => {
    let notify = () => {};
    const media = { matches: false, addEventListener: vi.fn((_event, callback) => { notify = callback; }), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    mount(); await screen.findByRole('button', { name: 'レイアウト', exact: true });
    expect(screen.getByRole('heading', { name: '棚マスタ — 工場全体' })).toHaveClass('text-xs');
    expect(screen.getByRole('button', { name: '再割当', exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '棚を移す' })).not.toBeInTheDocument();
    act(() => { media.matches = true; notify(); });
    expect(screen.getByRole('button', { name: '棚を移す' })).toBeInTheDocument();
    act(() => { media.matches = false; notify(); });
    expect(screen.getByRole('heading', { name: '棚マスタ — 工場全体' })).toBeInTheDocument();
  });

  it('hides editing without the existing capability', async () => {
    vi.mocked(api.getMobilePlacementClientCapabilities).mockResolvedValue({ shelfLayoutEditEnabled: false, haizenEdgeEnabled: false });
    mount(); click('棚を移す'); await screen.findByLabelText('工場マップ');
    expect(screen.queryByRole('button', { name: '配置を変える' })).not.toBeInTheDocument();
  });

  it('preserves relocation source across zones and uses registered shelf codes', async () => {
    mount(); click('棚を移す'); await screen.findByLabelText('工場マップ'); click(/西·北/);
    await screen.findByRole('button', { name: '西-北-01' }); click('西-北-01');
    expect(screen.getByText(/の置き先をタップ/)).toHaveTextContent('西-北-01');
    click('空き 2'); expect(screen.getByRole('alert')).toHaveTextContent('登録済みの棚');
    expect(api.postMobilePlacementShelfRelocate).not.toHaveBeenCalled();
    click(/中央·北/); await screen.findByRole('button', { name: '中央-北-01' });
    expect(screen.getByLabelText('区画の配置')).toHaveStyle({ gridTemplateColumns: '30px repeat(4, minmax(0, 1fr)) 30px' });
    click('中央-北-01');
    await waitFor(() => expect(api.postMobilePlacementShelfRelocate).toHaveBeenCalledWith('西-北-01', '中央-北-01'));
    expect(await screen.findByRole('status')).toHaveTextContent('移しました');
  });

  it('shows relocation failure by the status and allows canceling', async () => {
    vi.mocked(api.postMobilePlacementShelfRelocate).mockRejectedValueOnce(new Error('移動先に既に稼働データがあります'));
    mount(); click('棚を移す'); await screen.findByLabelText('工場マップ'); click(/西·北/);
    await screen.findByRole('button', { name: '西-北-01' }); click('西-北-01'); click(/中央·北/);
    await screen.findByRole('button', { name: '中央-北-01' }); click('中央-北-01');
    expect(await screen.findByRole('alert')).toHaveTextContent('移動先に既に稼働データがあります');
    click('やめる'); expect(screen.getByText('動かす棚をタップ')).toBeInTheDocument();
  });

  it('multi-selects cells, discards unsaved changes on reset, and saves through the existing layout mutation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount(); click('棚を移す'); await screen.findByLabelText('工場マップ'); click('配置を変える'); click(/西·北/);
    await screen.findByRole('button', { name: '空き 2' }); click('空き 2'); click('空き 3');
    expect(screen.getByRole('button', { name: '選択をやめる 2' })).toBeInTheDocument();
    click('通路'); expect(screen.getByRole('button', { name: '通路 2' })).toBeInTheDocument();
    expect(api.putMobilePlacementShelfLayoutZone).not.toHaveBeenCalled();
    click('リセット'); expect(confirm).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '空き 2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存', exact: true })).not.toBeInTheDocument();
    click('空き 2'); click('棚'); click('保存');
    await waitFor(() => expect(api.putMobilePlacementShelfLayoutZone).toHaveBeenCalledWith('nw', expect.objectContaining({ gridSize: 3, expectedUpdatedAt: west.updatedAt,
      entities: expect.arrayContaining([expect.objectContaining({ entityKind: 'SHELF', cellIndices: [1], shelfCodeRaw: '西-北-02' })]) })));
  });

  it('uses the machine sheet and guards leaving a dirty zone', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mount(); click('棚を移す'); await screen.findByLabelText('工場マップ'); click('配置を変える'); click(/西·北/);
    await screen.findByRole('button', { name: '空き 2' }); click('空き 2'); click('加工機');
    const dialog = screen.getByRole('dialog', { name: '加工機を選ぶ' });
    fireEvent.click(within(dialog).getByRole('button', { name: '加工機A' })); click('確定');
    expect(screen.getAllByRole('button', { name: '加工機 加工機A' })).toHaveLength(2);
    click('戻る'); expect(confirm).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: '西·北' })).toBeInTheDocument();
    confirm.mockReturnValue(true); click('戻る');
    expect(screen.getByLabelText('工場マップ')).toBeInTheDocument();
  });

  it('requires confirmation before clearing a Zero2W preset', async () => {
    mount(); click('棚を移す'); await screen.findByLabelText('工場マップ'); click('配置を変える'); click(/西·北/);
    await screen.findByRole('button', { name: '西-北-01' }); click('西-北-01'); click('Zero2W 外す');
    expect(api.putMobilePlacementHaizenTargetPresetShelf).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Zero2W 担当棚' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zero2W 外す' })); click('確定');
    await waitFor(() => expect(api.putMobilePlacementHaizenTargetPresetShelf).toHaveBeenCalledWith({ clientDeviceId: 'pi1', shelfCodeRaw: null }, expect.any(Object)));
  });

  it('queues a new shelf preset until layout save and drops queued edits on reset', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.getMobilePlacementHaizenTargetDevices).mockResolvedValue({ devices: [{ id: 'pi2', name: 'Pi 2', location: null, lastSeenAt: null, shelfCodeRaw: null }] });
    mount(); click('棚を移す'); await screen.findByLabelText('工場マップ'); click('配置を変える'); click(/西·北/);
    await screen.findByRole('button', { name: '空き 2' });
    const assign = () => {
      click('空き 2'); click('棚'); click('西-北-02'); click('Zero2W 付ける');
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Zero2W 担当棚' })).getByRole('button', { name: /Pi 2/ }));
      click('確定');
    };
    assign(); expect(api.putMobilePlacementHaizenTargetPresetShelf).not.toHaveBeenCalled();
    click('リセット'); expect(screen.getByRole('button', { name: '空き 2' })).toBeInTheDocument();
    expect(api.putMobilePlacementHaizenTargetPresetShelf).not.toHaveBeenCalled();
    assign(); click('保存');
    await waitFor(() => expect(api.putMobilePlacementHaizenTargetPresetShelf).toHaveBeenCalledWith({ clientDeviceId: 'pi2', shelfCodeRaw: '西-北-02' }, expect.any(Object)));
    expect(vi.mocked(api.putMobilePlacementShelfLayoutZone).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.putMobilePlacementHaizenTargetPresetShelf).mock.invocationCallOrder[0]);
  });

  it('keeps unsaved edits when an existing shelf preset would invalidate the layout query', async () => {
    mount(); click('棚を移す'); await screen.findByLabelText('工場マップ'); click('配置を変える'); click(/西·北/);
    await screen.findByRole('button', { name: '空き 2' }); click('空き 2'); click('通路');
    click('西-北-01'); click('Zero2W 外す');
    expect(screen.getByRole('alert')).toHaveTextContent('先に配置を保存');
    expect(screen.getByRole('button', { name: '通路 2' })).toBeInTheDocument();
    expect(api.putMobilePlacementHaizenTargetPresetShelf).not.toHaveBeenCalled();
  });

  it('keeps the draft and reports layout save failures', async () => {
    vi.mocked(api.putMobilePlacementShelfLayoutZone).mockRejectedValueOnce(new Error('保存できません'));
    mount(); click('棚を移す'); await screen.findByLabelText('工場マップ'); click('配置を変える'); click(/西·北/);
    await screen.findByRole('button', { name: '空き 2' }); click('空き 2'); click('棚'); click('保存');
    expect(await screen.findByRole('alert')).toHaveTextContent('保存できません');
    expect(screen.getByRole('button', { name: '西-北-02' })).toBeInTheDocument();
  });

  it('confirms before saving a removed shelf', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mount(); click('棚を移す'); await screen.findByLabelText('工場マップ'); click('配置を変える'); click(/西·北/);
    await screen.findByRole('button', { name: '西-北-01' }); click('西-北-01'); click('空き'); click('保存');
    expect(confirm).toHaveBeenCalledWith('棚を外す変更を保存しますか？');
    expect(api.putMobilePlacementShelfLayoutZone).not.toHaveBeenCalled();
    confirm.mockReturnValue(true); click('保存');
    await waitFor(() => expect(api.putMobilePlacementShelfLayoutZone).toHaveBeenCalled());
  });

});
