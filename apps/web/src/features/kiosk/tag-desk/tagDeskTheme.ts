/**
 * Tag desk palette (see the approved mock). One accent: signal cyan means "read / linked";
 * coral means "release"; amber flags states worth a second look; green confirms.
 */
export const tagDesk = {
  ink: 'bg-[#070b12]',
  slab: 'bg-[#0e1520]',
  slab2: 'bg-[#131c29]',
  line: 'border-[#223043]',
  mute: 'text-[#8494a8]',
  faint: 'text-[#5c6d83]',
  signal: 'text-[#4cc9f0]',
  panel: 'rounded-[14px] border border-[#223043] bg-[#0e1520]',
  eyebrow: 'text-xs font-bold tracking-[0.12em] text-[#8494a8]',
  chipWarn: 'inline-flex h-7 items-center gap-1.5 rounded-full bg-[#3a2a12] px-2.5 text-[13px] font-bold text-[#ffb547]',
  chipCut: 'inline-flex h-7 items-center gap-1.5 rounded-full bg-[#3a1719] px-2.5 text-[13px] font-bold text-[#ff5d5d]',
  chipOk: 'inline-flex h-7 items-center gap-1.5 rounded-full bg-[#10352a] px-2.5 text-[13px] font-bold text-[#34d399]',
  chipInfo: 'inline-flex h-7 items-center gap-1.5 rounded-full bg-[#1a2636] px-2.5 text-[13px] font-bold text-[#aebbd0]',
  btn: 'inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border px-[18px] text-base font-bold disabled:cursor-not-allowed disabled:opacity-40',
  btnSm: 'inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] border px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40',
  go: 'border-[#4cc9f0] bg-[#4cc9f0] text-[#04131a] hover:bg-[#6fd6f4]',
  ghost: 'border-[#223043] bg-transparent text-white hover:bg-[#131c29]',
  cut: 'border-[#6b2a2d] bg-transparent text-[#ff5d5d] hover:bg-[#3a1719]',
  cutSolid: 'border-[#ff5d5d] bg-[#ff5d5d] text-[#1a0506] hover:bg-[#ff7676]',
  input: 'h-11 rounded-[10px] border border-[#223043] bg-[#070b12] px-3 text-base text-white placeholder:text-[#5c6d83] focus:border-[#4cc9f0] focus:outline-none'
} as const;
