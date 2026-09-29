type Tone = 'sky' | 'amber' | 'green';

const TONES: Record<Tone, { box: string; mark: string }> = {
  sky: { box: 'border-sky-400 bg-sky-950/70 text-sky-50', mark: 'bg-sky-400' },
  amber: { box: 'border-amber-400 bg-amber-950/70 text-amber-100', mark: 'bg-amber-400' },
  green: { box: 'border-emerald-400 bg-emerald-950/70 text-emerald-50', mark: 'bg-emerald-400' },
};

function NfcMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 8.5a6 6 0 0 1 0 7" />
      <path d="M10 6a10 10 0 0 1 0 12" />
      <path d="M14 3.5a14 14 0 0 1 0 17" />
    </svg>
  );
}

/** "Hold this tag" prompt: NFC mark + a short word, in its own colour so it stands out. */
export function NfcPrompt({ label, sub, tone, size = 'large' }: { label: string; sub?: string; tone: Tone; size?: 'large' | 'small' }) {
  const colours = TONES[tone];
  if (size === 'small') {
    return (
      <span role="status" className={`inline-flex h-11 items-center gap-2.5 rounded-lg border-2 pl-1.5 pr-3.5 ${colours.box}`}>
        <span className={`flex h-8 w-8 items-center justify-center rounded-full text-slate-950 ${colours.mark}`}><NfcMark size={20} /></span>
        <span className="text-base font-bold">{label}</span>
        {sub ? <span className="text-sm opacity-85">{sub}</span> : null}
      </span>
    );
  }
  return (
    <div role="status" className={`inline-flex h-[88px] items-center gap-4 rounded-xl border-2 pl-4 pr-7 ${colours.box}`}>
      <span className={`flex h-[60px] w-[60px] items-center justify-center rounded-full text-slate-950 ${colours.mark}`}><NfcMark size={36} /></span>
      <span className="text-3xl font-bold">{label}</span>
      {sub ? <span className="text-base opacity-80">{sub}</span> : null}
    </div>
  );
}
