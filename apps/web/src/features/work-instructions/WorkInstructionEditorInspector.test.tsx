import { render, screen, within } from '@testing-library/react';
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

describe('WorkInstructionEditorInspector select styling', () => {
  it.each(['TEXT', 'IMAGE', 'SHAPE'] as const)('keeps %s select controls readable on the dark inspector', (kind) => {
    render(
      <WorkInstructionEditorInspector
        element={createWorkInstructionOverlayForRange(kind, 0, step.stepKey, bbox)}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onBringForward={vi.fn()}
        onSendBackward={vi.fn()}
        onUploadImage={vi.fn()}
        onRefetchTextCandidates={vi.fn()}
        steps={[step]}
        onAssignStep={vi.fn()}
      />
    );

    const inspector = screen.getByRole('complementary', { name: '加工要領書オーバーレイ編集' });
    const selects = within(inspector).getAllByRole('combobox');
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      expect(select).toHaveClass('text-sm', 'text-white', 'bg-slate-950', '[color-scheme:dark]');
      const relatedLabel = select.closest('label');
      if (relatedLabel) expect(relatedLabel).toHaveClass('text-sm');
      const options = within(select).getAllByRole('option');
      expect(options.length).toBeGreaterThan(0);
      for (const option of options) {
        expect(option).toHaveClass('text-sm', 'text-white', 'bg-slate-950', '[color-scheme:dark]');
      }
    }
  });

  it.each(['TEXT', 'IMAGE', 'SHAPE'] as const)('keeps every %s value control on the dark editor palette', (kind) => {
    render(
      <WorkInstructionEditorInspector
        element={createWorkInstructionOverlayForRange(kind, 0, step.stepKey, bbox)}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onBringForward={vi.fn()}
        onSendBackward={vi.fn()}
        onUploadImage={vi.fn()}
        onRefetchTextCandidates={vi.fn()}
        steps={[step]}
        onAssignStep={vi.fn()}
      />
    );

    const inspector = screen.getByRole('complementary', { name: '加工要領書オーバーレイ編集' });
    const controls = Array.from(inspector.querySelectorAll('input, textarea, select'));
    expect(controls.length).toBeGreaterThan(0);

    for (const control of controls) {
      expect(control).toHaveClass('bg-slate-950', '!bg-slate-950');
      if (control instanceof HTMLInputElement && control.type === 'checkbox') continue;
      if (control instanceof HTMLInputElement && control.type === 'color') continue;
      expect(control).toHaveClass('text-white', '!text-white');
    }
  });
});
