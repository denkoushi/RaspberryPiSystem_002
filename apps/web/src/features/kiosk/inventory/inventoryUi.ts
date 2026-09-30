/**
 * Shared look of the kiosk inventory screens (在庫操作 and 在庫の準備).
 * Controls are sized to their content (44px high), never stretched to the screen.
 */

/** Full-bleed dark surface that replaces the kiosk shell background on inventory screens. */
export const invSurface = '-m-4 flex min-h-0 flex-1 flex-col gap-4 bg-inv-bg px-7 pb-6 pt-5 text-inv-text [color-scheme:dark] [font-feature-settings:"palt"]';

export const invPanel = 'rounded-[18px] border border-inv-line bg-inv-s1';
export const invCard = 'rounded-[14px] border border-inv-line bg-inv-s1';
export const invEyebrow = 'text-xs font-bold tracking-[0.14em] text-inv-faint';
export const invTitle = 'text-2xl font-black tracking-[0.02em] text-inv-text';

const button = 'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border font-bold disabled:cursor-not-allowed disabled:opacity-40';
export const invButton = `${button} h-11 border-inv-line2 bg-inv-s2 px-4 text-[15px] text-inv-text hover:bg-inv-s3`;
export const invButtonGhost = `${button} h-11 border-inv-line2 bg-transparent px-4 text-[15px] text-inv-text hover:bg-inv-s2`;
export const invButtonDanger = `${button} h-11 border-inv-red/45 bg-transparent px-4 text-[15px] text-[#ffb3b3] hover:bg-inv-red/10`;
export const invButtonPrimary = `${button} h-11 border-inv-cyan bg-inv-cyan px-4 text-[15px] text-inv-cyan-ink hover:brightness-110`;
export const invButtonGo = `${button} h-11 border-inv-green bg-inv-green px-4 text-[15px] text-inv-green-ink hover:brightness-110`;
export const invButtonSm = `${button} h-9 rounded-lg border-inv-line2 bg-inv-s2 px-3 text-[13px] text-inv-text hover:bg-inv-s3`;
export const invButtonSmGhost = `${button} h-9 rounded-lg border-inv-line2 bg-transparent px-3 text-[13px] text-inv-text hover:bg-inv-s2`;
export const invIconButton = `${button} h-9 w-9 rounded-lg border-transparent bg-transparent text-inv-muted hover:bg-inv-s2 hover:text-inv-text`;

/** Segmented choice (unit, direction, shelf, drawer ...). */
export function invSeg(on: boolean): string {
  return on
    ? 'inline-flex h-10 min-w-14 items-center justify-center gap-1.5 rounded-[10px] border-2 border-inv-cyan bg-inv-cyan/[0.12] px-4 text-base font-bold text-[#dff8ff] disabled:opacity-40'
    : 'inline-flex h-10 min-w-14 items-center justify-center gap-1.5 rounded-[10px] border border-inv-line2 bg-inv-s2 px-4 text-base font-bold text-inv-text hover:bg-inv-s3 disabled:opacity-40';
}
export const invSegAdd = 'inline-flex h-10 items-center justify-center gap-1 rounded-[10px] border border-dashed border-inv-line2 bg-transparent px-3.5 text-sm text-inv-muted hover:bg-inv-s2 disabled:opacity-40';

export const invField = 'h-10 rounded-lg border border-inv-line2 bg-inv-bg px-3 text-[15px] text-inv-text placeholder:text-inv-faint focus:border-inv-cyan focus:outline-none';
export const invLabel = 'shrink-0 text-[13px] text-inv-muted';

/** Small status chip: 解除中, counts, ... */
export const invTag = 'inline-flex items-center rounded-md bg-inv-s3 px-2 py-0.5 text-[11px] font-bold tracking-[0.08em] text-inv-muted';

export const invKey = 'inline-flex h-16 items-center justify-center rounded-xl border border-inv-line2 bg-inv-s2 text-[26px] font-black text-inv-text hover:bg-inv-s3 disabled:opacity-40';
export const invKeyUtil = 'inline-flex h-16 items-center justify-center rounded-xl border border-inv-line2 bg-inv-s2 text-[15px] font-bold text-inv-muted hover:bg-inv-s3 disabled:opacity-40';

export const invSuccess = 'border-inv-green bg-inv-green/[0.12] text-[#d7fbe9]';
export const invError = 'border-inv-red/70 bg-inv-red/10 text-[#ffd0d0]';
