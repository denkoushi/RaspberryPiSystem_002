import { describe, expect, it } from 'vitest';

import {
  inspectionDrawingCreateMetaChipControlClassName,
  inspectionDrawingCreateMetaChipInputClassName,
  inspectionDrawingCreateMetaChipWideControlClassName,
  inspectionDrawingCreateMetaChipWideInputClassName,
  isSelfInspectionSessionChromeFocusTarget
} from './inspectionDrawingKioskUi';

describe('inspectionDrawingCreateMetaChip input class names', () => {
  it('applies black-on-white overrides to meta chip inputs', () => {
    expect(inspectionDrawingCreateMetaChipInputClassName).toContain('!bg-white');
    expect(inspectionDrawingCreateMetaChipInputClassName).toContain('!text-black');
    expect(inspectionDrawingCreateMetaChipInputClassName).toContain('placeholder:!text-slate-500');
    expect(inspectionDrawingCreateMetaChipInputClassName).toContain(
      inspectionDrawingCreateMetaChipControlClassName
    );
  });

  it('applies black-on-white overrides to wide meta chip inputs', () => {
    expect(inspectionDrawingCreateMetaChipWideInputClassName).toContain('!bg-white');
    expect(inspectionDrawingCreateMetaChipWideInputClassName).toContain('!text-black');
    expect(inspectionDrawingCreateMetaChipWideInputClassName).toContain('placeholder:!text-slate-500');
    expect(inspectionDrawingCreateMetaChipWideInputClassName).toContain(
      inspectionDrawingCreateMetaChipWideControlClassName
    );
  });

  it('keeps dark-theme control class names unchanged for selects and buttons', () => {
    expect(inspectionDrawingCreateMetaChipControlClassName).toContain('text-white');
    expect(inspectionDrawingCreateMetaChipControlClassName).not.toContain('!text-black');
    expect(inspectionDrawingCreateMetaChipWideControlClassName).toContain('text-white');
    expect(inspectionDrawingCreateMetaChipWideControlClassName).not.toContain('!text-black');
  });
});

describe('isSelfInspectionSessionChromeFocusTarget', () => {
  it('returns true for toolbar and session action buttons', () => {
    const toolbar = document.createElement('div');
    toolbar.setAttribute('data-self-inspection-session-toolbar', '');
    const toolbarButton = document.createElement('button');
    toolbar.appendChild(toolbarButton);

    const actions = document.createElement('div');
    actions.setAttribute('data-self-inspection-session-actions', '');
    const saveButton = document.createElement('button');
    saveButton.textContent = '入力を保存';
    actions.appendChild(saveButton);

    document.body.append(toolbar, actions);

    expect(isSelfInspectionSessionChromeFocusTarget(toolbarButton)).toBe(true);
    expect(isSelfInspectionSessionChromeFocusTarget(saveButton)).toBe(true);

    document.body.removeChild(toolbar);
    document.body.removeChild(actions);
  });

  it('returns true for point summary list buttons', () => {
    const list = document.createElement('div');
    list.setAttribute('data-self-inspection-point-summary-list', '');
    const button = document.createElement('button');
    list.appendChild(button);
    document.body.appendChild(list);

    expect(isSelfInspectionSessionChromeFocusTarget(button)).toBe(true);

    document.body.removeChild(list);
  });

  it('returns false for unrelated elements', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(isSelfInspectionSessionChromeFocusTarget(input)).toBe(false);
    document.body.removeChild(input);
  });
});
