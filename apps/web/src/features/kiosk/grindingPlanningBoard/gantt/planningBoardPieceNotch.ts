export const PIECE_NOTCH_MIN_WIDTH = 16;

// Even-odd holes mark piece ends while preserving the outer outline and ring.
export function pieceNotchClipPath({ left, right }: { left: boolean; right: boolean }): string | undefined {
  if (!left && !right) return undefined;
  const leftHole = left ? '-4px 30%,0 30%,3px 50%,0 70%,0 30%,-4px 30%,' : '';
  const rightHole = right ? 'calc(100% + 4px) 30%,100% 30%,calc(100% - 3px) 50%,100% 70%,100% 30%,calc(100% + 4px) 30%,' : '';
  return `polygon(evenodd,${leftHole}-4px -4px,calc(100% + 4px) -4px,${rightHole}calc(100% + 4px) calc(100% + 4px),-4px calc(100% + 4px))`;
}
