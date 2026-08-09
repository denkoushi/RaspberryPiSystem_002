import { describe, expect, it } from 'vitest';

import {
  presentSelfInspectionInspectorSlotState,
  resolveFirstInspectorUsableEntryIndex
} from './selfInspectionInspectorSlotState';

const states = [
  { entryIndex: 0, operatorState: 'missing' as const, inspectorState: 'not_started' as const },
  { entryIndex: 1, operatorState: 'confirmed' as const, inspectorState: 'complete' as const },
  { entryIndex: 2, operatorState: 'confirmed' as const, inspectorState: 'in_progress' as const },
  { entryIndex: 3, operatorState: 'confirmed' as const, inspectorState: 'not_started' as const }
];

describe('self inspection inspector slot presentation', () => {
  it('renders 未 with a complete operator confirmation message and disables it', () => {
    const presentation = presentSelfInspectionInspectorSlotState(states[0]!, '3件目');
    expect(presentation.badge).toBe('未');
    expect(presentation.selectable).toBe(false);
    expect(presentation.ariaLabel).toContain('作業者が「入力を保存」すると検査できます');
  });

  it('renders 可/中/済 and selects them in operation priority order', () => {
    expect(presentSelfInspectionInspectorSlotState(states[1]!, '2件目').badge).toBe('済');
    expect(presentSelfInspectionInspectorSlotState(states[2]!, '3件目').badge).toBe('中');
    expect(presentSelfInspectionInspectorSlotState(states[3]!, '4件目').badge).toBe('可');
    expect(resolveFirstInspectorUsableEntryIndex(states)).toBe(3);
  });
});
