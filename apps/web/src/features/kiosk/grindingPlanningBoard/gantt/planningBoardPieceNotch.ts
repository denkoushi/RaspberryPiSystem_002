export const PIECE_NOTCH_MIN_WIDTH = 16;

// Even-odd holes mark piece ends; the 12px outer margin keeps outlines, rings and the move flash unclipped.
export function pieceNotchClipPath({ left, right }: { left: boolean; right: boolean }): string | undefined {
  if (!left && !right) return undefined;
  const leftHole = left ? '-12px 30%,0 30%,6px 50%,0 70%,0 30%,-12px 30%,' : '';
  const rightHole = right ? 'calc(100% + 12px) 30%,100% 30%,calc(100% - 6px) 50%,100% 70%,100% 30%,calc(100% + 12px) 30%,' : '';
  return `polygon(evenodd,${leftHole}-12px -12px,calc(100% + 12px) -12px,${rightHole}calc(100% + 12px) calc(100% + 12px),-12px calc(100% + 12px))`;
}
