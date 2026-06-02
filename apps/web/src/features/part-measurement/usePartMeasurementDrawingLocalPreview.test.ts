import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { previewPartMeasurementDrawing } from '../../api/client';

import { usePartMeasurementDrawingLocalPreview } from './usePartMeasurementDrawingLocalPreview';

vi.mock('../../api/client', () => ({
  previewPartMeasurementDrawing: vi.fn()
}));

const previewPartMeasurementDrawingMock = vi.mocked(previewPartMeasurementDrawing);

describe('usePartMeasurementDrawingLocalPreview', () => {
  beforeEach(() => {
    previewPartMeasurementDrawingMock.mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:http://localhost/preview');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses object URL for image files without calling preview API', () => {
    const { result } = renderHook(() => usePartMeasurementDrawingLocalPreview('key'));
    const png = new File([new Uint8Array([1])], 'drawing.png', { type: 'image/png' });

    act(() => {
      result.current.selectFile(png);
    });

    expect(previewPartMeasurementDrawingMock).not.toHaveBeenCalled();
    expect(result.current.localPreviewUrl).toBe('blob:http://localhost/preview');
    expect(result.current.saveFile).toBe(png);
    expect(result.current.previewResolving).toBe(false);
  });

  it('calls preview API for pdf and exposes jpeg save file', async () => {
    const jpegBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    previewPartMeasurementDrawingMock.mockResolvedValue(jpegBlob);

    const { result } = renderHook(() => usePartMeasurementDrawingLocalPreview('key'));
    const pdf = new File([new Uint8Array([1])], 'drawing.pdf', { type: 'application/pdf' });

    act(() => {
      result.current.selectFile(pdf);
    });

    expect(result.current.previewResolving).toBe(true);

    await waitFor(() => {
      expect(result.current.previewResolving).toBe(false);
    });

    expect(previewPartMeasurementDrawingMock).toHaveBeenCalledWith(pdf, 'key', expect.any(AbortSignal));
    expect(result.current.localPreviewUrl).toBe('blob:http://localhost/preview');
    expect(result.current.saveFile?.type).toBe('image/jpeg');
    expect(result.current.saveFile?.name).toBe('drawing.jpg');
  });

  it('ignores stale pdf preview when newer file is selected', async () => {
    let resolveFirst: ((value: Blob) => void) | undefined;
    const firstPromise = new Promise<Blob>((resolve) => {
      resolveFirst = resolve;
    });
    previewPartMeasurementDrawingMock.mockImplementationOnce(() => firstPromise);

    const { result } = renderHook(() => usePartMeasurementDrawingLocalPreview('key'));
    const pdfA = new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' });
    const pdfB = new File([new Uint8Array([2])], 'b.pdf', { type: 'application/pdf' });

    act(() => {
      result.current.selectFile(pdfA);
    });

    previewPartMeasurementDrawingMock.mockResolvedValueOnce(
      new Blob([new Uint8Array([9])], { type: 'image/jpeg' })
    );

    act(() => {
      result.current.selectFile(pdfB);
    });

    await waitFor(() => {
      expect(result.current.saveFile?.name).toBe('b.jpg');
    });

    resolveFirst?.(new Blob([new Uint8Array([0])], { type: 'image/jpeg' }));
    await Promise.resolve();

    expect(result.current.saveFile?.name).toBe('b.jpg');
  });

  it('sets preview error on pdf conversion failure', async () => {
    previewPartMeasurementDrawingMock.mockRejectedValue({
      response: { data: { message: 'PDF の変換に失敗しました' } }
    });

    const { result } = renderHook(() => usePartMeasurementDrawingLocalPreview('key'));
    const pdf = new File([new Uint8Array([1])], 'drawing.pdf', { type: 'application/pdf' });

    act(() => {
      result.current.selectFile(pdf);
    });

    await waitFor(() => {
      expect(result.current.previewError).toBe('PDF の変換に失敗しました');
    });

    expect(result.current.localPreviewUrl).toBeNull();
    expect(result.current.saveFile).toBeNull();
    expect(result.current.hasPendingLocalSelection).toBe(false);
  });
});
