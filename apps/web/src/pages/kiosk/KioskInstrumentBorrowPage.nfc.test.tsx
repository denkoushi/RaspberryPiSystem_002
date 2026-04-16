import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const borrowMeasuringInstrumentMock = vi.fn();
const createInspectionRecordMock = vi.fn();
const getMeasuringInstrumentInspectionProfileMock = vi.fn();

/** useNfcStream のモックが参照する可変状態（factory より前に hoisted） */
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
  useKioskConfig: () => ({
    data: { defaultMode: 'TAG' }
  })
}));

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    getResolvedClientKey: () => undefined,
    borrowMeasuringInstrument: (...args: unknown[]) => borrowMeasuringInstrumentMock(...args),
    getMeasuringInstrumentByTagUid: vi.fn().mockResolvedValue({
      id: 'inst-1',
      name: 'ノギス',
      managementNumber: 'M-1',
      status: 'AVAILABLE',
      createdAt: '',
      updatedAt: ''
    }),
    getMeasuringInstrumentTags: vi.fn().mockResolvedValue({ tags: [{ rfidTagUid: 'inst-rfid-1' }] }),
    getMeasuringInstrumentInspectionProfile: (...args: unknown[]) => getMeasuringInstrumentInspectionProfileMock(...args),
    createInspectionRecord: (...args: unknown[]) => createInspectionRecordMock(...args),
    postClientLogs: vi.fn().mockResolvedValue(undefined)
  };
});

import { KioskInstrumentBorrowPage } from './KioskInstrumentBorrowPage';

function Harness({ nfc }: { nfc: { uid: string; timestamp: string } | null }) {
  nfcStreamState.event = nfc;
  return (
    <MemoryRouter initialEntries={['/kiosk/instruments/borrow?tagUid=inst-rfid-1']}>
      <Routes>
        <Route path="/kiosk/instruments/borrow" element={<KioskInstrumentBorrowPage />} />
        <Route path="/kiosk/tag" element={<div>kiosk-tag</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('KioskInstrumentBorrowPage NFC', () => {
  beforeEach(() => {
    borrowMeasuringInstrumentMock.mockReset();
    createInspectionRecordMock.mockReset();
    getMeasuringInstrumentInspectionProfileMock.mockReset();
    borrowMeasuringInstrumentMock.mockResolvedValue({
      id: 'loan-1',
      employee: { id: 'emp-db-1', displayName: '試験' }
    });
    getMeasuringInstrumentInspectionProfileMock.mockResolvedValue({
      genre: {
        id: 'g1',
        name: '長さ',
        imageUrlPrimary: 'https://example.com/a.png',
        imageUrlSecondary: null
      },
      inspectionItems: []
    });
    createInspectionRecordMock.mockResolvedValue({});
    nfcStreamState.event = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('2枚目の氏名NFCで borrow にイベントUIDが渡る（setState直後の handleSubmit で空UIDにならない）', async () => {
    const { rerender } = render(<Harness nfc={null} />);

    await waitFor(
      () => {
        expect(screen.getByRole('combobox')).toHaveValue('inst-1');
      },
      { timeout: 5000 }
    );
    // ジャンル/点検プロファイル取得後に genreReady となりボタンが有効になる
    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: '持出登録' })).not.toBeDisabled();
      },
      { timeout: 5000 }
    );

    rerender(<Harness nfc={{ uid: 'employee-nfc-uid-99', timestamp: new Date().toISOString() }} />);

    await waitFor(() => {
      expect(borrowMeasuringInstrumentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeTagUid: 'employee-nfc-uid-99',
          instrumentTagUid: 'inst-rfid-1'
        })
      );
    });
  });

  it('点検記録作成が401で失敗すると持出完了遷移しない（認証トークン要求の再現）', async () => {
    getMeasuringInstrumentInspectionProfileMock.mockResolvedValueOnce({
      genre: {
        id: 'g1',
        name: '長さ',
        imageUrlPrimary: 'https://example.com/a.png',
        imageUrlSecondary: null
      },
      inspectionItems: [
        { id: 'insp-1', name: '外観確認', order: 1, createdAt: '', updatedAt: '', genreId: 'g1' }
      ]
    });
    createInspectionRecordMock.mockRejectedValueOnce({
      response: { status: 401, data: { message: '認証トークンが必要です' } },
      message: 'Request failed with status code 401'
    });

    const { rerender } = render(<Harness nfc={null} />);

    await waitFor(
      () => {
        expect(screen.getByRole('combobox')).toHaveValue('inst-1');
      },
      { timeout: 5000 }
    );

    rerender(<Harness nfc={{ uid: 'employee-nfc-uid-401', timestamp: new Date().toISOString() }} />);

    await waitFor(() => {
      expect(createInspectionRecordMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByText('kiosk-tag')).not.toBeInTheDocument();
    });
  });
});
