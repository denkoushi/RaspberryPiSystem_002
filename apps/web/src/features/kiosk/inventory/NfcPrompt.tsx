import { NfcIcon } from './InventoryIcons';

type Tone = 'sky' | 'amber' | 'green';

const TONES: Record<Tone, { box: string; mark: string }> = {
  sky: { box: 'border-inv-cyan bg-inv-cyan/[0.12] text-[#dff8ff]', mark: 'bg-inv-cyan text-inv-cyan-ink' },
  amber: { box: 'border-inv-amber bg-inv-amber/[0.12] text-[#ffe8bf]', mark: 'bg-inv-amber text-inv-amber-ink' },
  green: { box: 'border-inv-green bg-inv-green/[0.12] text-[#d7fbe9]', mark: 'bg-inv-green text-inv-green-ink' },
};

/** "Hold this tag" prompt: NFC mark + a short word, in its own colour so it stands out. */
export function NfcPrompt({ label, sub, tone, size = 'large' }: { label: string; sub?: string; tone: Tone; size?: 'large' | 'small' }) {
  const colours = TONES[tone];
  const large = size === 'large';
  return (
    <span role="status" className={`inline-flex shrink-0 items-center rounded-full border-[1.5px] font-black tracking-[0.04em] ${large ? 'h-14 gap-3 pl-2 pr-6 text-xl' : 'h-11 gap-2.5 pl-1.5 pr-4 text-[17px]'} ${colours.box}`}>
      <span className={`flex items-center justify-center rounded-full ${large ? 'h-10 w-10' : 'h-8 w-8'} ${colours.mark}`}><NfcIcon size={large ? 22 : 18} /></span>
      {label}
      {sub ? <span className="text-[13px] font-medium tracking-normal text-inv-muted">{sub}</span> : null}
    </span>
  );
}
