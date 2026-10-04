import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskSignagePreviewModal } from './KioskSignagePreviewModal';

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();
const mockApiGet = vi.fn();
const mockPutSelection = vi.fn();
const fixtureOptions = {
  candidates: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Pi3', location: '工場A' }],
  selectedClientDeviceId: null as string | null,
  effectivePreviewClientDeviceId: '11111111-1111-4111-8111-111111111111',
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    api: { get: (...args: unknown[]) => mockApiGet(...args) },
    putKioskSignagePreviewSelection: (...args: unknown[]) => mockPutSelection(...args),
  };
});

describe('KioskSignagePreviewModal', () => {
  beforeEach(() => {
    mockApiGet.mockReset();
    mockPutSelection.mockReset();
    fixtureOptions.selectedClientDeviceId = null;
    fixtureOptions.effectivePreviewClientDeviceId = '11111111-1111-4111-8111-111111111111';
    mockUseMutation.mockReturnValue({
      mutateAsync: mockPutSelection.mockResolvedValue({ ok: true, signagePreviewTargetClientDeviceId: '22222222-2222-4222-8222-222222222222' }),
      isPending: false,
    });
    mockUseQuery.mockImplementation((options: { enabled?: boolean }) => {
      if (options.enabled === false) {
        return { data: undefined, isLoading: false, isError: false, error: null };
      }
      return {
        data: fixtureOptions,
        isLoading: false,
        isError: false,
        error: null,
      };
    });
    Object.defineProperty(URL, 'createObjectURL', {
      writable: true,
      value: vi.fn().mockReturnValue('blob:preview-1'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      writable: true,
      value: vi.fn(),
    });
    mockApiGet.mockResolvedValue({ data: new Blob(['x']) });
  });

  it('開いているときにセレクトで端末を選ぶと保存APIが呼ばれる', async () => {
    render(
      <KioskSignagePreviewModal isOpen onClose={vi.fn()} kioskClientKey="client-key-fixture-only-kiosk" />
    );

    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('プレビューするサイネージ端末'), {
      target: { value: '22222222-2222-4222-8222-222222222222' },
    });

    await waitFor(() =>
      expect(mockPutSelection).toHaveBeenCalledWith({ signagePreviewTargetClientDeviceId: '22222222-2222-4222-8222-222222222222' })
    );
  });

  it('閉じているときは画像取得をしない', () => {
    render(
      <KioskSignagePreviewModal isOpen={false} onClose={vi.fn()} kioskClientKey="client-key-fixture-only-kiosk" />
    );

    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('保存済み端末IDを表示し、自端末認証と非秘密のIDだけで画像を取得する', async () => {
    fixtureOptions.selectedClientDeviceId = fixtureOptions.candidates[0].id;
    fixtureOptions.effectivePreviewClientDeviceId = fixtureOptions.candidates[0].id;
    render(<KioskSignagePreviewModal isOpen onClose={vi.fn()} kioskClientKey="client-key-fixture-only-kiosk" />);
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith('/kiosk/signage-preview/image', {
      responseType: 'blob',
      headers: { 'x-client-key': 'client-key-fixture-only-kiosk' },
      params: { clientDeviceId: fixtureOptions.candidates[0].id, t: expect.any(Number) },
    }));
    expect(screen.getByLabelText('プレビューするサイネージ端末')).toHaveValue(fixtureOptions.candidates[0].id);
    for (const [, config] of mockApiGet.mock.calls) {
      expect(config.params).not.toHaveProperty('key');
      expect(config.params).not.toHaveProperty('clientKey');
    }
  });

  it('デフォルト選択を保存すると非秘密のnullを送る', async () => {
    fixtureOptions.selectedClientDeviceId = fixtureOptions.candidates[0].id;
    render(<KioskSignagePreviewModal isOpen onClose={vi.fn()} kioskClientKey="client-key-fixture-only-kiosk" />);
    fireEvent.change(screen.getByLabelText('プレビューするサイネージ端末'), { target: { value: '' } });
    await waitFor(() => expect(mockPutSelection).toHaveBeenCalledWith({ signagePreviewTargetClientDeviceId: null }));
  });
});
