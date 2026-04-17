import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskSignagePreviewModal } from './KioskSignagePreviewModal';

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();
const mockApiGet = vi.fn();
const mockPutSelection = vi.fn();

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
    mockUseMutation.mockReturnValue({
      mutateAsync: mockPutSelection.mockResolvedValue({ ok: true, signagePreviewTargetApiKey: 'client-key-sig' }),
      isPending: false,
    });
    mockUseQuery.mockImplementation((options: { enabled?: boolean }) => {
      if (options.enabled === false) {
        return { data: undefined, isLoading: false, isError: false, error: null };
      }
      return {
        data: {
          candidates: [{ id: 's1', name: 'Pi3', location: '工場A', apiKey: 'client-key-sig' }],
          selectedApiKey: null,
          effectivePreviewApiKey: 'client-key-kiosk',
        },
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
      <KioskSignagePreviewModal isOpen onClose={vi.fn()} kioskClientKey="client-key-kiosk" />
    );

    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('プレビューするサイネージ端末'), {
      target: { value: 'client-key-sig' },
    });

    await waitFor(() =>
      expect(mockPutSelection).toHaveBeenCalledWith({ signagePreviewTargetApiKey: 'client-key-sig' })
    );
  });

  it('閉じているときは画像取得をしない', () => {
    render(
      <KioskSignagePreviewModal isOpen={false} onClose={vi.fn()} kioskClientKey="client-key-kiosk" />
    );

    expect(mockApiGet).not.toHaveBeenCalled();
  });
});
