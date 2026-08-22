import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentEditorInspector } from './AssemblyProcedureDocumentEditorInspector';

import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

const base = {
  id: 'overlay-1',
  pageIndex: 0,
  bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.2 },
  zIndex: 0,
  opacity: 1
} as const;

function commonProps(onUpdate: (element: AssemblyProcedureOverlayElement) => void) {
  return {
    onUpdate,
    onDelete: vi.fn(),
    onBringForward: vi.fn(),
    onSendBackward: vi.fn(),
    onUploadImage: vi.fn()
  };
}

describe('AssemblyProcedureDocumentEditorInspector', () => {
  it('updates text style and mask controls through the element callback', () => {
    const onUpdate = vi.fn();
    render(
      <AssemblyProcedureDocumentEditorInspector
        {...commonProps(onUpdate)}
        element={{
          ...base,
          kind: 'TEXT',
          text: '手順',
          style: { fontSizeRatio: 0.025, color: '#0f172a', fontWeight: 'normal', align: 'start' },
          mask: { enabled: true, color: '#ffffff' }
        }}
      />
    );

    fireEvent.change(screen.getByLabelText('文字サイズ比率'), { target: { value: '0.04' } });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ style: expect.objectContaining({ fontSizeRatio: 0.04 }) }));
    fireEvent.change(screen.getByLabelText('文字色'), { target: { value: '#ff0000' } });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ style: expect.objectContaining({ color: '#ff0000' }) }));
    fireEvent.change(screen.getByLabelText('太さ'), { target: { value: 'bold' } });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ style: expect.objectContaining({ fontWeight: 'bold' }) }));
    fireEvent.change(screen.getByLabelText('揃え'), { target: { value: 'center' } });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ style: expect.objectContaining({ align: 'center' }) }));
    fireEvent.change(screen.getByLabelText('マスク色'), { target: { value: '#eeeeee' } });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ mask: { enabled: true, color: '#eeeeee' } }));
  });

  it('updates image fit and uploads a selected file', () => {
    const onUpdate = vi.fn();
    const onUploadImage = vi.fn();
    render(
      <AssemblyProcedureDocumentEditorInspector
        {...commonProps(onUpdate)}
        onUploadImage={onUploadImage}
        element={{ ...base, kind: 'IMAGE', assetId: 'asset-1', objectFit: 'contain' }}
      />
    );

    fireEvent.change(screen.getByLabelText('画像の収まり'), { target: { value: 'cover' } });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ objectFit: 'cover' }));
    const file = new File(['image'], 'photo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('画像ファイルをアップロード'), { target: { files: [file] } });
    expect(onUploadImage).toHaveBeenCalledWith(file);
  });

  it('creates line endpoints on shape conversion and edits stroke fields', () => {
    const onUpdate = vi.fn();
    const { rerender } = render(
      <AssemblyProcedureDocumentEditorInspector
        {...commonProps(onUpdate)}
        element={{
          ...base,
          kind: 'SHAPE',
          shape: 'RECTANGLE',
          strokeColor: '#dc2626',
          fillColor: 'transparent',
          strokeWidthRatio: 0.008
        }}
      />
    );

    fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: 'ARROW' } });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      shape: 'ARROW',
      start: { xRatio: 0.1, yRatio: 0.2 },
      end: { xRatio: 0.4, yRatio: 0.4 }
    }));
    fireEvent.change(screen.getByLabelText('線色'), { target: { value: '#00ff00' } });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ strokeColor: '#00ff00' }));
    fireEvent.change(screen.getByLabelText('線幅比率'), { target: { value: '0.02' } });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ strokeWidthRatio: 0.02 }));
    rerender(
      <AssemblyProcedureDocumentEditorInspector
        {...commonProps(onUpdate)}
        element={{
          ...base,
          kind: 'SHAPE',
          shape: 'ARROW',
          strokeColor: '#00ff00',
          fillColor: 'transparent',
          strokeWidthRatio: 0.02,
          start: { xRatio: 0.1, yRatio: 0.2 },
          end: { xRatio: 0.4, yRatio: 0.4 }
        }}
      />
    );
    const startX = screen.getByText('始点 X').parentElement?.querySelector('input');
    expect(startX).not.toBeNull();
    fireEvent.change(startX!, { target: { value: '0.25' } });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ start: { xRatio: 0.25, yRatio: 0.2 } }));
  });

  it('disables inspector mutations when the editable document is read-only', () => {
    render(
      <AssemblyProcedureDocumentEditorInspector
        {...commonProps(vi.fn())}
        readOnly
        element={{ ...base, kind: 'TEXT', text: '閲覧のみ' }}
      />
    );

    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: '削除' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '前面へ' })).toBeDisabled();
  });
});
