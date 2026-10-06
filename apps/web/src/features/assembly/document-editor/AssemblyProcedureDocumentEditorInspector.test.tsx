import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentEditorInspector, percentToRatio, ratioToPercent } from './AssemblyProcedureDocumentEditorInspector';

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
    onUploadImage: vi.fn(),
    onRefetchTextCandidates: vi.fn(),
    busy: false
  };
}

describe('percentage conversion', () => {
  it.each([0, 0.001, 0.005, 0.025, 0.413, 1])('round-trips ratio %s at display precision', (ratio) => {
    expect(percentToRatio(ratioToPercent(ratio))).toBeCloseTo(ratio, 10);
  });

  it.each([0, 0.1, 0.5, 2.5, 41.3, 100])('round-trips percent %s', (percent) => {
    expect(ratioToPercent(percentToRatio(percent))).toBe(percent);
  });

  it('rounds dragged ratios to one decimal place in percent', () => {
    expect(ratioToPercent(0.4123728)).toBe(41.2);
    expect(ratioToPercent(0.4128728)).toBe(41.3);
  });
});

describe('AssemblyProcedureDocumentEditorInspector', () => {
  it('displays all ratio fields as percentages rounded to one decimal place', () => {
    const fractionalBase = {
      ...base,
      bbox: { xRatio: 0.4123728, yRatio: 0.2138728, widthRatio: 0.3143728, heightRatio: 0.2158728 },
      opacity: 0.8163728
    };
    const { rerender } = render(
      <AssemblyProcedureDocumentEditorInspector
        {...commonProps(vi.fn())}
        element={{ ...fractionalBase, kind: 'TEXT', text: '手順', style: { fontSizeRatio: 0.0253728 } }}
      />
    );

    for (const [label, value, min, max] of [
      ['左 (%)', 41.2, 0, 100],
      ['上 (%)', 21.4, 0, 100],
      ['幅 (%)', 31.4, 0, 100],
      ['高さ (%)', 21.6, 0, 100],
      ['文字サイズ比率 (%)', 2.5, 0.5, 20],
      ['不透明度 (%)', 81.6, 0, 100]
    ] as const) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveValue(value);
      expect(input).toHaveAttribute('min', String(min));
      expect(input).toHaveAttribute('max', String(max));
      expect(input).toHaveAttribute('step', '0.5');
    }

    rerender(
      <AssemblyProcedureDocumentEditorInspector
        {...commonProps(vi.fn())}
        element={{
          ...fractionalBase,
          kind: 'SHAPE',
          shape: 'ARROW',
          strokeWidthRatio: 0.0088728,
          start: { xRatio: 0.1123728, yRatio: 0.2138728 },
          end: { xRatio: 0.7143728, yRatio: 0.8158728 }
        }}
      />
    );

    for (const [label, value, min, max, step] of [
      ['線幅比率 (%)', 0.9, 0.1, 20, '0.1'],
      ['始点 X (%)', 11.2, 0, 100, '0.5'],
      ['始点 Y (%)', 21.4, 0, 100, '0.5'],
      ['終点 X (%)', 71.4, 0, 100, '0.5'],
      ['終点 Y (%)', 81.6, 0, 100, '0.5']
    ] as const) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveValue(value);
      expect(input).toHaveAttribute('min', String(min));
      expect(input).toHaveAttribute('max', String(max));
      expect(input).toHaveAttribute('step', step);
    }
  });

  it('keeps the stored value while a field is cleared and clamps out-of-range percentages', () => {
    const onUpdate = vi.fn();
    render(
      <AssemblyProcedureDocumentEditorInspector
        {...commonProps(onUpdate)}
        element={{ ...base, kind: 'TEXT', text: '手順', style: { fontSizeRatio: 0.03 }, opacity: 0.8 }}
      />
    );
    fireEvent.change(screen.getByLabelText('不透明度 (%)'), { target: { value: '' } });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ opacity: 0.8 }));
    fireEvent.change(screen.getByLabelText('不透明度 (%)'), { target: { value: '150' } });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ opacity: 1 }));
    fireEvent.change(screen.getByLabelText('文字サイズ比率 (%)'), { target: { value: '0' } });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ style: { fontSizeRatio: 0.005 } }));
  });

  it('converts percentage edits to stored ratios and preserves endpoint clamping', () => {
    const onUpdate = vi.fn();
    render(
      <AssemblyProcedureDocumentEditorInspector
        {...commonProps(onUpdate)}
        element={{
          ...base,
          kind: 'SHAPE',
          shape: 'LINE',
          start: { xRatio: 0.1, yRatio: 0.2 },
          end: { xRatio: 0.4, yRatio: 0.4 }
        }}
      />
    );

    for (const [label, key] of [
      ['左 (%)', 'xRatio'],
      ['上 (%)', 'yRatio'],
      ['幅 (%)', 'widthRatio'],
      ['高さ (%)', 'heightRatio']
    ] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: '25.5' } });
      expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
        bbox: { ...base.bbox, [key]: 0.255 }
      }));
    }
    fireEvent.change(screen.getByLabelText('不透明度 (%)'), { target: { value: '75.5' } });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ opacity: 0.755 }));
    fireEvent.change(screen.getByLabelText('始点 Y (%)'), { target: { value: '-10' } });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ start: { xRatio: 0.1, yRatio: 0 } }));
    fireEvent.change(screen.getByLabelText('終点 X (%)'), { target: { value: '120' } });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ end: { xRatio: 1, yRatio: 0.4 } }));
    fireEvent.change(screen.getByLabelText('終点 Y (%)'), { target: { value: '65.5' } });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ end: { xRatio: 0.4, yRatio: 0.655 } }));
  });

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

    fireEvent.change(screen.getByLabelText('文字サイズ比率 (%)'), { target: { value: '4' } });
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

  it('offers explicit OCR candidate re-fetch for selected text and disables it while busy', () => {
    const onRefetchTextCandidates = vi.fn();
    const { rerender } = render(
      <AssemblyProcedureDocumentEditorInspector
        {...commonProps(vi.fn())}
        onRefetchTextCandidates={onRefetchTextCandidates}
        element={{ ...base, kind: 'TEXT', text: '既存文章' }}
      />
    );

    const refetchButton = screen.getByRole('button', { name: 'この範囲で候補を再取得' });
    expect(refetchButton).toBeEnabled();
    fireEvent.click(refetchButton);
    expect(onRefetchTextCandidates).toHaveBeenCalledTimes(1);

    rerender(
      <AssemblyProcedureDocumentEditorInspector
        {...commonProps(vi.fn())}
        onRefetchTextCandidates={onRefetchTextCandidates}
        busy
        element={{ ...base, kind: 'TEXT', text: '既存文章' }}
      />
    );
    expect(screen.getByRole('button', { name: 'この範囲で候補を再取得' })).toBeDisabled();
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
    fireEvent.change(screen.getByLabelText('線幅比率 (%)'), { target: { value: '2' } });
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
    const startX = screen.getByLabelText('始点 X (%)');
    expect(startX).not.toBeNull();
    fireEvent.change(startX!, { target: { value: '25' } });
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
    expect(screen.getByRole('button', { name: 'この範囲で候補を再取得' })).toBeDisabled();
  });
});
