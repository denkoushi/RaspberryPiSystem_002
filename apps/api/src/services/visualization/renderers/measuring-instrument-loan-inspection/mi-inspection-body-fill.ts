import type { Md3Tokens } from '../_design-system/md3.js';
import type { BodyLineTone } from './mi-instrument-display.types.js';

export function resolveBodyFill(tone: BodyLineTone, hasVisibleLoanState: boolean, t: Md3Tokens): string {
  if (!hasVisibleLoanState) {
    if (tone === 'muted') {
      return t.colors.outline;
    }
    if (tone === 'primary') {
      return t.colors.text.primary;
    }
    return t.colors.text.secondary;
  }
  if (tone === 'muted') {
    return t.colors.outline;
  }
  return t.colors.status.onInfoContainer;
}
