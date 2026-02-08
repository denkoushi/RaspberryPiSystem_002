import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../api/client';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

import type { MouseEvent } from 'react';

type KioskSignagePreviewModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function KioskSignagePreviewModal({ isOpen, onClose }: KioskSignagePreviewModalProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imageUrlRef = useRef<string | null>(null);

  const updateImageUrl = useCallback((url: string) => {
    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current);
    }
    imageUrlRef.current = url;
    setImageUrl(url);
  }, []);

  const fetchImage = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await api.get('/signage/current-image', { responseType: 'blob' });
      const blob = response.data as Blob;
      const url = URL.createObjectURL(blob);
      updateImageUrl(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : '画像の取得に失敗しました';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [updateImageUrl]);

  useEffect(() => {
    if (!isOpen) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = null;
      }
      setImageUrl(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    fetchImage();
    intervalRef.current = setInterval(fetchImage, 30000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchImage, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleBackdropMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="サイネージプレビュー"
      onMouseDown={handleBackdropMouseDown}
    >
      <Card className="w-[calc(100vw-2rem)] max-w-none max-h-[calc(100vh-2rem)] my-4 flex flex-col">
        <div
          className="flex-1 overflow-y-auto"
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">サイネージプレビュー</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              title="閉じる"
              className="text-slate-500 hover:text-slate-700"
            >
              ✕
            </button>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-600">
                Pi3で表示中のサイネージ画像をプレビューします（30秒ごとに自動更新）
              </p>
              <Button
                type="button"
                onClick={fetchImage}
                disabled={isLoading}
                className="bg-emerald-600 text-white hover:bg-emerald-500"
              >
                {isLoading ? '読み込み中...' : '更新'}
              </Button>
            </div>

            {error && (
              <div className="rounded-md bg-red-50 p-4 text-red-800">
                <p className="font-semibold">エラー</p>
                <p className="text-sm">{error}</p>
              </div>
            )}

            {isLoading && !imageUrl && (
              <div className="flex items-center justify-center py-12">
                <p className="text-slate-500">画像を読み込んでいます...</p>
              </div>
            )}

            {imageUrl && (
              <div className="rounded-lg border-2 border-slate-300 bg-slate-100 p-4">
                <div className="aspect-video w-full overflow-hidden rounded-md bg-black">
                  <img src={imageUrl} alt="サイネージプレビュー" className="h-full w-full object-contain" />
                </div>
                <p className="mt-2 text-xs text-slate-500">解像度: 1920x1080（Full HD）想定</p>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
