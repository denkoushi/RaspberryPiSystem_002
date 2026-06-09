import { describe, expect, it } from 'vitest';

import { resolveSelfInspectionSessionPlaceholderData } from '../selfInspectionSessionPlaceholder';

import type { SelfInspectionSessionDetailDto } from '../types';

function sessionWithId(id: string): SelfInspectionSessionDetailDto {
  return { id } as SelfInspectionSessionDetailDto;
}

describe('resolveSelfInspectionSessionPlaceholderData', () => {
  it('returns previous data only when session id matches', () => {
    const previous = sessionWithId('session-a');
    expect(resolveSelfInspectionSessionPlaceholderData(previous, 'session-a')).toBe(previous);
  });

  it('returns undefined when session id changes', () => {
    const previous = sessionWithId('session-a');
    expect(resolveSelfInspectionSessionPlaceholderData(previous, 'session-b')).toBeUndefined();
  });

  it('returns undefined when previous data is missing', () => {
    expect(resolveSelfInspectionSessionPlaceholderData(undefined, 'session-a')).toBeUndefined();
  });
});
