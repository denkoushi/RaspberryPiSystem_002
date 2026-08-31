import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkInstructionViewerDialog } from './WorkInstructionViewerDialog';

import type { WorkInstructionGroup, WorkInstructionStep } from '../../api/domains/work-instructions';

const { useProtectedImageBlobUrlMock } = vi.hoisted(() => ({
  useProtectedImageBlobUrlMock: vi.fn()
}));

vi.mock('../../hooks/useProtectedImageBlobUrl', () => ({
  useProtectedImageBlobUrl: useProtectedImageBlobUrlMock
}));

function makeStep(
  id: string,
  text: string,
  imageUrl: string | null,
  step: number
): WorkInstructionStep {
  return {
    id,
    step,
    text,
    imageName: imageUrl ? `${id}.png` : null,
    imageAssetId: imageUrl ? `asset-${id}` : null,
    imageUrl,
    imageMimeType: imageUrl ? 'image/png' : null,
    imageSha256: imageUrl ? `sha-${id}` : null,
    rowId: `row-${id}`,
    source: {
      system: 'sharepoint',
      list: 'WorkInstructions',
      itemId: step
    }
  };
}

const group: WorkInstructionGroup = {
  partNumber: 'PN-001',
  shootingTarget: 'FRONT',
  rows: [],
  steps: [
    makeStep('step-1', '最初のメモ', '/api/work-instructions/assets/asset-step-1', 20),
    makeStep('step-2', '画像なしのメモ', null, 5),
    makeStep('step-3', '最後のメモ', '/api/work-instructions/assets/asset-step-3', 1)
  ]
};

function renderViewer(
  overrides: Partial<React.ComponentProps<typeof WorkInstructionViewerDialog>> = {}
) {
  return render(
    <WorkInstructionViewerDialog
      isOpen
      partNumber="PN-001"
      shootingTarget="FRONT"
      group={group}
      isLoading={false}
      onClose={vi.fn()}
      {...overrides}
    />
  );
}

describe('WorkInstructionViewerDialog', () => {
  beforeEach(() => {
    useProtectedImageBlobUrlMock.mockReset();
    useProtectedImageBlobUrlMock.mockReturnValue({ blobUrl: 'blob:work-instruction', error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the flattened step order, display numbers, memo-only cards, and responsive grid contract', () => {
    renderViewer();

    const dialog = screen.getByRole('dialog', { name: '作業要領書' });
    const grid = screen.getByTestId('work-instruction-card-grid');

    expect(dialog).toBeInTheDocument();
    expect(grid).toHaveClass('min-[1280px]:grid-cols-3', 'min-[1800px]:grid-cols-4');
    expect(within(grid).getAllByRole('article')).toHaveLength(3);
    expect(within(grid).getByText('手順 1')).toBeInTheDocument();
    expect(within(grid).getByText('手順 2')).toBeInTheDocument();
    expect(within(grid).getByText('手順 3')).toBeInTheDocument();
    expect(within(grid).getByText('最初のメモ')).toBeInTheDocument();
    expect(within(grid).getByText('画像なしのメモ')).toBeInTheDocument();
    expect(within(grid).getByText('最後のメモ')).toBeInTheDocument();
    expect(within(grid).getByRole('button', { name: '手順1の画像を拡大' })).toBeInTheDocument();
    expect(within(grid).queryByRole('button', { name: '手順2の画像を拡大' })).not.toBeInTheDocument();
    expect(useProtectedImageBlobUrlMock).toHaveBeenCalledWith('/api/work-instructions/assets/asset-step-1');
    expect(useProtectedImageBlobUrlMock).toHaveBeenCalledWith('/api/work-instructions/assets/asset-step-3');
  });

  it('shows protected image loading state', () => {
    useProtectedImageBlobUrlMock.mockReturnValue({ blobUrl: null, error: null });
    renderViewer();

    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('画像を読み込み中…');
  });

  it('starts protected thumbnail loading only when a card approaches the viewport', () => {
    const observerCallbacks: IntersectionObserverCallback[] = [];
    class IntersectionObserverMock {
      constructor(callback: IntersectionObserverCallback) {
        observerCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
      readonly root = null;
      readonly rootMargin = '320px 0px';
      readonly thresholds = [0];
    }
    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);

    renderViewer();

    expect(useProtectedImageBlobUrlMock).not.toHaveBeenCalledWith(
      '/api/work-instructions/assets/asset-step-1'
    );
    expect(screen.getAllByText('画像を準備中…')).toHaveLength(2);

    act(() => {
      observerCallbacks[0]?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    expect(useProtectedImageBlobUrlMock).toHaveBeenCalledWith(
      '/api/work-instructions/assets/asset-step-1'
    );
  });

  it('shows protected image error state', () => {
    useProtectedImageBlobUrlMock.mockReturnValue({ blobUrl: null, error: 'request failed' });
    renderViewer();

    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('画像の読み込みに失敗しました');
  });

  it('opens a full image dialog and Escape closes only the image dialog', () => {
    renderViewer();

    fireEvent.click(screen.getByRole('button', { name: '手順1の画像を拡大' }));

    const imageDialog = screen.getByRole('dialog', { name: '作業要領画像' });
    expect(imageDialog).toBeInTheDocument();
    expect(within(imageDialog).getByRole('img', { name: '作業要領の拡大画像' })).toHaveAttribute(
      'src',
      'blob:work-instruction'
    );
    expect(within(imageDialog).getByText('最初のメモ')).toBeInTheDocument();
    expect(within(imageDialog).getByRole('button', { name: '画像を閉じる' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: '作業要領画像' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '作業要領書' })).toBeInTheDocument();
    expect(screen.getByTestId('work-instruction-card-grid')).toBeInTheDocument();
  });

  it('returns to self-inspection through the outer close callback', () => {
    const onClose = vi.fn();
    renderViewer({ onClose });

    fireEvent.click(screen.getByRole('button', { name: '自主検査画面に戻る' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the explicit loading and request error states', () => {
    const { rerender } = renderViewer({ isLoading: true, group: undefined });

    expect(screen.getByRole('status')).toHaveTextContent('作業要領を読み込み中…');
    expect(screen.queryByTestId('work-instruction-card-grid')).not.toBeInTheDocument();

    rerender(
      <WorkInstructionViewerDialog
        isOpen
        partNumber="PN-001"
        shootingTarget="FRONT"
        group={undefined}
        isLoading={false}
        errorMessage="要領書を取得できませんでした"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('要領書を取得できませんでした');
  });
});
