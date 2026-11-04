import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getByTagMock = vi.hoisted(() => vi.fn());

const nfcStreamState = vi.hoisted(() => ({
  event: null as { uid: string; timestamp: string } | null
}));

vi.mock('../../hooks/useNfcStream', () => ({
  useNfcStream: (enabled: boolean) => (enabled ? nfcStreamState.event : null)
}));

vi.mock('../../api/hooks', () => ({
  useMeasuringInstruments: () => ({
    data: [{ id: 'inst-1', name: 'ノギス', managementNumber: 'M-1', status: 'AVAILABLE', createdAt: '', updatedAt: '' }],
    isLoading: false
  }),
  useKioskConfig: () => ({ data: { defaultMode: 'TAG' } })
}));

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    getResolvedClientKey: () => undefined,
    getMeasuringInstrumentByTagUid: (...args: unknown[]) => getByTagMock(...args),
    getMeasuringInstrumentTags: vi.fn().mockResolvedValue({ tags: [{ rfidTagUid: 'inst-rfid-1' }] }),
    getMeasuringInstrumentInspectionProfile: vi.fn().mockResolvedValue({
      genre: { id: 'g1', name: '長さ', imageUrlPrimary: 'https://example.com/a.png', imageUrlSecondary: null },
      inspectionItems: []
    }),
    postClientLogs: vi.fn().mockResolvedValue(undefined)
  };
});

import { KioskInstrumentBorrowPage } from './KioskInstrumentBorrowPage';

function Harness({ entry, nfc }: { entry: string; nfc: { uid: string; timestamp: string } | null }) {
  nfcStreamState.event = nfc;
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/kiosk/instruments/borrow" element={<KioskInstrumentBorrowPage />} />
      </Routes>
    </MemoryRouter>
  );
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('KioskInstrumentBorrowPage tag lookup timing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    nfcStreamState.event = null;
    getByTagMock.mockReset();
    getByTagMock.mockResolvedValue({
      id: 'inst-1',
      name: 'ノギス',
      managementNumber: 'M-1',
      status: 'AVAILABLE',
      createdAt: '',
      updatedAt: ''
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('URLの tagUid はデバウンスせず即時に照会し、解決後に同じタグを再照会しない', async () => {
    render(<Harness entry="/kiosk/instruments/borrow?tagUid=inst-rfid-1" nfc={null} />);

    await advance(10);
    expect(getByTagMock).toHaveBeenCalledTimes(1);
    expect(getByTagMock).toHaveBeenCalledWith('inst-rfid-1');
    expect(screen.getByRole('combobox')).toHaveValue('inst-1');

    await advance(2000);
    expect(getByTagMock).toHaveBeenCalledTimes(1);
  });

  it('1枚目のNFCタグはデバウンスせず即時に照会する', async () => {
    const { rerender } = render(<Harness entry="/kiosk/instruments/borrow" nfc={null} />);
    await advance(1000);
    expect(getByTagMock).not.toHaveBeenCalled();

    rerender(
      <Harness entry="/kiosk/instruments/borrow" nfc={{ uid: 'inst-rfid-1', timestamp: '2026-01-01T00:00:00.000Z' }} />
    );
    await advance(10);
    expect(getByTagMock).toHaveBeenCalledTimes(1);
    expect(getByTagMock).toHaveBeenCalledWith('inst-rfid-1');
    expect(screen.getByRole('combobox')).toHaveValue('inst-1');

    await advance(2000);
    expect(getByTagMock).toHaveBeenCalledTimes(1);
  });

  it('キーボード入力のタグUIDは従来通り500msデバウンスしてから照会する', async () => {
    render(<Harness entry="/kiosk/instruments/borrow" nfc={null} />);
    await advance(1000);

    fireEvent.change(screen.getByPlaceholderText('スキャンまたは手入力'), { target: { value: 'inst-rfid-1' } });
    await advance(499);
    expect(getByTagMock).not.toHaveBeenCalled();

    await advance(1);
    expect(getByTagMock).toHaveBeenCalledTimes(1);
    expect(getByTagMock).toHaveBeenCalledWith('inst-rfid-1');
    await advance(10);
    expect(screen.getByRole('combobox')).toHaveValue('inst-1');

    await advance(2000);
    expect(getByTagMock).toHaveBeenCalledTimes(1);
  });

  it('照会結果と異なるタグを入力し直すと再照会する', async () => {
    render(<Harness entry="/kiosk/instruments/borrow?tagUid=inst-rfid-1" nfc={null} />);
    await advance(10);
    expect(getByTagMock).toHaveBeenCalledTimes(1);

    getByTagMock.mockRejectedValueOnce({ response: { status: 404 } });
    fireEvent.change(screen.getByPlaceholderText('スキャンまたは手入力'), { target: { value: 'unknown-tag' } });
    await advance(510);
    expect(getByTagMock).toHaveBeenLastCalledWith('unknown-tag');
    expect(screen.getByRole('combobox')).toHaveValue('');

    fireEvent.change(screen.getByPlaceholderText('スキャンまたは手入力'), { target: { value: 'inst-rfid-1' } });
    await advance(510);
    expect(getByTagMock).toHaveBeenLastCalledWith('inst-rfid-1');
    expect(screen.getByRole('combobox')).toHaveValue('inst-1');
  });
});
