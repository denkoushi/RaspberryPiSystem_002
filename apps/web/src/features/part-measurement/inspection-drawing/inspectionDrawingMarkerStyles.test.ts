import { describe, expect, it } from 'vitest';

import {
  inspectionDrawingMarkerButtonClass,
  inspectionDrawingMarkerInputTargetOutlineClass
} from './inspectionDrawingMarkerStyles';

describe('inspectionDrawingMarkerStyles', () => {
  it('adds sky outline only for input target', () => {
    expect(inspectionDrawingMarkerInputTargetOutlineClass(true)).toContain('outline-sky-400');
    expect(inspectionDrawingMarkerInputTargetOutlineClass(false)).toBe('');
  });

  it('keeps status ring on marker button without selection ring', () => {
    const ok = inspectionDrawingMarkerButtonClass('ok');
    expect(ok).toContain('ring-emerald-200');
    expect(ok).not.toContain('ring-amber');
    expect(ok).not.toContain('outline-sky');
  });
});
