import { describe, expect, it } from 'vitest';

import { isMachineSectionAssigned } from './machine-section-assignee.js';

describe('isMachineSectionAssigned', () => {
  it.each([
    [['機械課'], true],
    [['資材課', '機械課'], true],
    [['機械課・資材課', '↑製造課'], true],
    [['設計機械課'], true],
    [['組立課'], false],
    [['資材課'], false],
    [['製造課'], false],
    [['生産管理課'], false],
    [['組立中　'], false],
    [[], false]
  ] as const)('classifies %j as %s', (assignees, expected) => {
    expect(isMachineSectionAssigned(assignees)).toBe(expected);
  });
});
