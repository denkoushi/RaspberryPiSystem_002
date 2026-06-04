import { describe, expect, it } from 'vitest';

import { isSelfInspectionSessionChromeFocusTarget } from './inspectionDrawingKioskUi';

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

  it('returns false for unrelated elements', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(isSelfInspectionSessionChromeFocusTarget(input)).toBe(false);
    document.body.removeChild(input);
  });
});
