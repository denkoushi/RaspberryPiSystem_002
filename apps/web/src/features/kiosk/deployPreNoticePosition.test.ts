import { describe, expect, it } from 'vitest';

import {
  clampDeployPreNoticeOffset,
  moveDeployPreNoticeOffset
} from './deployPreNoticePosition';

describe('deploy pre-notice position', () => {
  it('moves exactly 10px in each arrow direction', () => {
    expect(moveDeployPreNoticeOffset({ x: 0, y: 0 }, 'ArrowRight')).toEqual({ x: 10, y: 0 });
    expect(moveDeployPreNoticeOffset({ x: 0, y: 0 }, 'ArrowLeft')).toEqual({ x: -10, y: 0 });
    expect(moveDeployPreNoticeOffset({ x: 0, y: 0 }, 'ArrowDown')).toEqual({ x: 0, y: 10 });
    expect(moveDeployPreNoticeOffset({ x: 0, y: 0 }, 'ArrowUp')).toEqual({ x: 0, y: -10 });
  });

  it('keeps every card edge inside the 16px viewport margin', () => {
    expect(clampDeployPreNoticeOffset({ x: 999, y: -999 }, 1000, 700, 400, 200))
      .toEqual({ x: 284, y: -234 });
  });
});
