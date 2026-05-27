import { describe, expect, it } from 'vitest';

import { formatExternalizationPlanActionError } from '../externalizationPlanErrors';

describe('formatExternalizationPlanActionError', () => {
  it('複数 mutation エラーを結合する', () => {
    const message = formatExternalizationPlanActionError({
      planError: new Error('plan failed'),
      candidatesError: new Error('candidates failed')
    });
    expect(message).toContain('plan failed');
    expect(message).toContain('candidates failed');
  });

  it('エラーが無ければ null', () => {
    expect(formatExternalizationPlanActionError({})).toBeNull();
  });
});
