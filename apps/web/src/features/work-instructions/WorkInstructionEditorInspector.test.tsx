import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createWorkInstructionOverlayForRange } from './workInstructionEditorDraft';
import { WorkInstructionEditorInspector } from './WorkInstructionEditorInspector';

import type { WorkInstructionEditorStepDto } from '../../api/domains/work-instruction-overlays';

const bbox = { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.2 };
const step: WorkInstructionEditorStepDto = {
  stepKey: 'SharePoint:WorkInstructions:101:1',
  sourceVersionId: 'latest-1',
  sourceSystem: 'SharePoint',
  sourceList: 'WorkInstructions',
  sourceItemId: 101,
  step: 1,
  operation: null,
  text: '加工面を確認します。',
  imageName: null,
  imageAssetId: null,
  imageUrl: null,
  imageMimeType: null,
  imageSha256: null,
  sourceModified: '2026-08-31T00:00:00.000Z',
  contentHash: 'latest-hash',
  memoFingerprint: 'latest-memo-fingerprint',
  overlays: []
};

function renderInspector(kind: 'TEXT' | 'IMAGE' | 'SHAPE', extra = {}) {
  const onUpdate = vi.fn();
  const onDelete = vi.fn();
  const onDuplicate = vi.fn();
  const onUploadImage = vi.fn();
  render(<WorkInstructionEditorInspector element={createWorkInstructionOverlayForRange(kind, 0, step.stepKey, bbox)} onUpdate={onUpdate} onDelete={onDelete} onDuplicate={onDuplicate} onBringForward={vi.fn()} onSendBackward={vi.fn()} onUploadImage={onUploadImage} onRefetchTextCandidates={vi.fn()} steps={[step]} onAssignStep={vi.fn()} {...extra} />);
  return { onUpdate, onDelete, onDuplicate, onUploadImage };
}

describe('WorkInstructionEditorInspector', () => {
  it.each(['TEXT', 'IMAGE', 'SHAPE'] as const)('uses white, readable controls for %s and keeps status and step at the end', (kind) => {
    renderInspector(kind);
    const inspector = screen.getByRole('complementary', { name: '注釈の編集' });
    for (const control of inspector.querySelectorAll('input:not([type=checkbox]):not([type=file]),textarea,select')) {
      expect(control).toHaveClass('!bg-white', '!text-lg', '!text-[#161c22]');
    }
    expect(within(inspector).getByLabelText('状態')).toHaveValue('MIGRATED');
    expect(within(inspector).getByLabelText('手順')).toHaveValue(step.stepKey);
    expect(inspector).not.toHaveTextContent(/オーバーレイ|比率|asset|移植|KEEP|fingerprint/);
  });

  it('shows ratios as percentages and stores percentages as ratios', () => {
    const { onUpdate } = renderInspector('TEXT');
    expect(screen.getByLabelText('左 (%)')).toHaveValue(10);
    expect(screen.getByLabelText('不透明度 (%)')).toHaveValue(100);
    fireEvent.change(screen.getByLabelText('左 (%)'), { target: { value: '25' } });
    expect(onUpdate.mock.lastCall?.[0].bbox.xRatio).toBe(0.25);
    fireEvent.change(screen.getByLabelText('文字サイズ (%)'), { target: { value: '2.5' } });
    expect(onUpdate.mock.lastCall?.[0].style.fontSizeRatio).toBe(0.025);
    fireEvent.change(screen.getByLabelText('不透明度 (%)'), { target: { value: '50' } });
    expect(onUpdate.mock.lastCall?.[0].opacity).toBe(0.5);
  });

  it('duplicates immediately and confirms deletion', () => {
    const { onDelete, onDuplicate } = renderInspector('SHAPE');
    fireEvent.click(screen.getByRole('button', { name: '複製' }));
    expect(onDuplicate).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '削除', exact: true }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog', { name: '注釈を削除' })).getByRole('button', { name: '削除' }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('uploads image files without exposing an ID input', () => {
    const { onUploadImage } = renderInspector('IMAGE');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    const file = new File(['image'], 'photo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('画像を選ぶ', { selector: 'input' }), { target: { files: [file] } });
    expect(onUploadImage).toHaveBeenCalledWith(file);
    expect(screen.getByTestId('work-instruction-editor-image-asset')).toHaveTextContent('画像を選ぶ');
  });

  it('preserves and displays an unassigned state', () => {
    renderInspector('TEXT', { element: { ...createWorkInstructionOverlayForRange('TEXT', 0, step.stepKey, bbox), migrationState: 'UNASSIGNED' } });
    expect(screen.getByLabelText('状態')).toHaveValue('UNASSIGNED');
    expect(within(screen.getByLabelText('状態')).getByRole('option', { name: '未割当' })).toBeInTheDocument();
  });
});
