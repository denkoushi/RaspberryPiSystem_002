import { describe, expect, it } from 'vitest';

import { workInstructionsQueryKeys } from './workInstructions';

describe('workInstructionsQueryKeys', () => {

  it('preserves groups values, order and boundary arguments', () => {
    expect(workInstructionsQueryKeys.groups('PART-1')).toEqual(['work-instructions', 'groups', 'PART-1']);
    expect(Reflect.apply(workInstructionsQueryKeys.groups, undefined, [undefined])).toEqual(['work-instructions', 'groups', undefined]);
    expect(Reflect.apply(workInstructionsQueryKeys.groups, undefined, [null])).toEqual(['work-instructions', 'groups', null]);
    expect(Reflect.apply(workInstructionsQueryKeys.groups, undefined, [{}])).toEqual(['work-instructions', 'groups', {}]);
    expect(Reflect.apply(workInstructionsQueryKeys.groups, undefined, [''])).toEqual(['work-instructions', 'groups', '']);
    expect(Reflect.apply(workInstructionsQueryKeys.groups, undefined, [])).toEqual(['work-instructions', 'groups', undefined]);
  });

  it('preserves group values, order and boundary arguments', () => {
    expect(workInstructionsQueryKeys.group('PART-1', 'TARGET-1')).toEqual(['work-instructions', 'group', 'PART-1', 'TARGET-1']);
    expect(Reflect.apply(workInstructionsQueryKeys.group, undefined, [undefined, undefined])).toEqual(['work-instructions', 'group', undefined, undefined]);
    expect(Reflect.apply(workInstructionsQueryKeys.group, undefined, [null, null])).toEqual(['work-instructions', 'group', null, null]);
    expect(Reflect.apply(workInstructionsQueryKeys.group, undefined, [{}, {}])).toEqual(['work-instructions', 'group', {}, {}]);
    expect(Reflect.apply(workInstructionsQueryKeys.group, undefined, ['', ''])).toEqual(['work-instructions', 'group', '', '']);
    expect(Reflect.apply(workInstructionsQueryKeys.group, undefined, [])).toEqual(['work-instructions', 'group', undefined, undefined]);
    expect(Reflect.apply(workInstructionsQueryKeys.group, undefined, ['PART-1'])).toEqual(['work-instructions', 'group', 'PART-1', undefined]);
    expect(Reflect.apply(workInstructionsQueryKeys.group, undefined, [undefined, 'TARGET-1'])).toEqual(['work-instructions', 'group', undefined, 'TARGET-1']);
  });

  it('preserves editorGroup values, order and boundary arguments', () => {
    expect(workInstructionsQueryKeys.editorGroup('PART-1', 'TARGET-1')).toEqual(['work-instructions', 'editor-group', 'PART-1', 'TARGET-1']);
    expect(Reflect.apply(workInstructionsQueryKeys.editorGroup, undefined, [undefined, undefined])).toEqual(['work-instructions', 'editor-group', undefined, undefined]);
    expect(Reflect.apply(workInstructionsQueryKeys.editorGroup, undefined, [null, null])).toEqual(['work-instructions', 'editor-group', null, null]);
    expect(Reflect.apply(workInstructionsQueryKeys.editorGroup, undefined, [{}, {}])).toEqual(['work-instructions', 'editor-group', {}, {}]);
    expect(Reflect.apply(workInstructionsQueryKeys.editorGroup, undefined, ['', ''])).toEqual(['work-instructions', 'editor-group', '', '']);
    expect(Reflect.apply(workInstructionsQueryKeys.editorGroup, undefined, [])).toEqual(['work-instructions', 'editor-group', undefined, undefined]);
    expect(Reflect.apply(workInstructionsQueryKeys.editorGroup, undefined, ['PART-1'])).toEqual(['work-instructions', 'editor-group', 'PART-1', undefined]);
    expect(Reflect.apply(workInstructionsQueryKeys.editorGroup, undefined, [undefined, 'TARGET-1'])).toEqual(['work-instructions', 'editor-group', undefined, 'TARGET-1']);
  });

  it('preserves procedureManualsByPart values, order and boundary arguments', () => {
    expect(workInstructionsQueryKeys.procedureManualsByPart('PART-1')).toEqual(['procedure-manuals', 'by-part', 'PART-1']);
    expect(Reflect.apply(workInstructionsQueryKeys.procedureManualsByPart, undefined, [undefined])).toEqual(['procedure-manuals', 'by-part', undefined]);
    expect(Reflect.apply(workInstructionsQueryKeys.procedureManualsByPart, undefined, [null])).toEqual(['procedure-manuals', 'by-part', null]);
    expect(Reflect.apply(workInstructionsQueryKeys.procedureManualsByPart, undefined, [{}])).toEqual(['procedure-manuals', 'by-part', {}]);
    expect(Reflect.apply(workInstructionsQueryKeys.procedureManualsByPart, undefined, [''])).toEqual(['procedure-manuals', 'by-part', '']);
    expect(Reflect.apply(workInstructionsQueryKeys.procedureManualsByPart, undefined, [])).toEqual(['procedure-manuals', 'by-part', undefined]);
  });
});
