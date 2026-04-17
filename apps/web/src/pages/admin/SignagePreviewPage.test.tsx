import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SignagePreviewPage } from './SignagePreviewPage';

const mockUseSignageScheduleEditorClients = vi.fn();
const mockApiGet = vi.fn();

vi.mock('../../api/hooks', () => ({
  useSignageScheduleEditorClients: (...args: unknown[]) => mockUseSignageScheduleEditorClients(...args),
}));

vi.mock('../../api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}));

function makeClient(id: string, name: string, apiKey: string, location: string | null = null) {
  return {
    id,
    name,
    apiKey,
    location,
    defaultMode: null,
    lastSeenAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SignagePreviewPage', () => {
  beforeEach(() => {
    mockApiGet.mockReset();
    mockUseSignageScheduleEditorClients.mockReset();
    mockUseSignageScheduleEditorClients.mockReturnValue({
      data: [
        makeClient('1', 'Pi3', 'client-key-raspberrypi3-signage1', '工場A'),
        makeClient('2', 'Kiosk', 'client-key-raspberrypi4-kiosk1', '工場B'),
        makeClient('3', 'Tablet', 'client-key-android-signage-1', '工場C'),
      ],
      isLoading: false,
    });
    Object.defineProperty(URL, 'createObjectURL', {
      writable: true,
      value: vi.fn()
        .mockReturnValueOnce('blob:preview-1')
        .mockReturnValueOnce('blob:preview-2')
        .mockReturnValue('blob:preview-fallback'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      writable: true,
      value: vi.fn(),
    });
  });

  it('端末未選択では画像取得しない', () => {
    render(<SignagePreviewPage />);

    expect(mockApiGet).not.toHaveBeenCalled();
    expect(screen.getByText('上の一覧から端末を選ぶと、その端末向けに生成された画像が表示されます。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更新' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Pi3（工場A）' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Kiosk（工場B）' })).not.toBeInTheDocument();
  });

  it('端末切替時に古いレスポンスで新しい選択を上書きしない', async () => {
    const first = deferred<{ data: Blob }>();
    const second = deferred<{ data: Blob }>();
    mockApiGet.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    render(<SignagePreviewPage />);

    fireEvent.change(screen.getByLabelText('プレビューする端末'), {
      target: { value: 'client-key-raspberrypi3-signage1' },
    });
    fireEvent.change(screen.getByLabelText('プレビューする端末'), {
      target: { value: 'client-key-android-signage-1' },
    });

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(2));
    expect(mockApiGet.mock.calls[0][1].params.toString()).toContain('key=client-key-raspberrypi3-signage1');
    expect(mockApiGet.mock.calls[1][1].params.toString()).toContain('key=client-key-android-signage-1');

    first.resolve({ data: new Blob(['old']) });
    second.resolve({ data: new Blob(['new']) });

    await waitFor(() => {
      const image = screen.getByRole('img', { name: 'サイネージプレビュー' });
      expect(image).toHaveAttribute('src', 'blob:preview-2');
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
  });
});
