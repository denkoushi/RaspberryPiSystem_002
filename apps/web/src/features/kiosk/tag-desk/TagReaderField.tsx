import { useEffect, useRef, useState, type Ref } from 'react';

import { CheckIcon, CloseIcon, NfcIcon } from './TagDeskIcons';
import { uidBytes } from './tagDeskModel';

export type ReaderTone = 'idle' | 'live' | 'cut' | 'ok';

const TONE_RGB: Record<ReaderTone, [number, number, number]> = {
  idle: [76, 201, 240],
  live: [76, 201, 240],
  cut: [255, 93, 93],
  ok: [52, 211, 153]
};

const TOKEN_CLASS: Record<ReaderTone, string> = {
  idle: 'border-2 border-dashed border-[#2c3d55] text-[#4cc9f0]',
  live: 'border border-[#4cc9f0] text-[#4cc9f0] shadow-[0_0_0_10px_rgba(76,201,240,0.07),0_30px_60px_-20px_#000]',
  cut: 'border border-[#ff5d5d] text-[#ff5d5d] shadow-[0_30px_60px_-20px_#000]',
  ok: 'border border-[#34d399] text-[#34d399] shadow-[0_0_0_10px_rgba(52,211,153,0.08),0_30px_60px_-20px_#000]'
};

/** Concentric field lines around the reader, slowly breathing; still when motion is reduced. */
function useFieldLines(canvasRef: React.RefObject<HTMLCanvasElement>, tone: ReaderTone) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const [r, g, b] = TONE_RGB[tone];
    let frame = 0;
    const paint = (time: number) => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(132,148,168,0.05)';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
      for (let y = 0; y < height; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
      const shift = reduced ? 0 : (time / 2600) % (1 / 9);
      for (let i = 0; i < 9; i++) {
        const radius = 96 + (i / 9 + shift) * 300;
        const alpha = Math.max(0, 0.22 * (1 - (radius - 96) / 300));
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      if (!reduced) frame = window.requestAnimationFrame(paint);
    };
    frame = window.requestAnimationFrame(paint);
    return () => window.cancelAnimationFrame(frame);
  }, [canvasRef, tone]);
}

type Props = {
  uid: string | null;
  tone: ReaderTone;
  /** Shorter strip used while a record or form fills the dock. */
  compact: boolean;
  /** Null while reading is paused (a form is open). */
  prompt: string | null;
  tokenRef: Ref<HTMLDivElement>;
  onClear: () => void;
  /** Fallback when the reader is unavailable: type the tag ID. */
  onManualUid: (uid: string) => void;
};

function ManualUid({ onSubmit }: { onSubmit: (uid: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-[#8494a8] underline decoration-dotted underline-offset-4 hover:text-white">
        IDを手で入れる
      </button>
    );
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onSubmit(value.trim());
        setValue('');
        setOpen(false);
      }}
    >
      <input
        id="tag-desk-manual-uid"
        autoFocus
        aria-label="タグのID"
        placeholder="タグのID"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="h-9 w-56 rounded-[9px] border border-[#223043] bg-[#070b12] px-2.5 font-mono text-sm text-white placeholder:text-[#5c6d83] focus:border-[#4cc9f0] focus:outline-none"
      />
      <button type="submit" className="h-9 rounded-[9px] border border-[#223043] px-3 text-sm text-white hover:bg-[#131c29]">読む</button>
    </form>
  );
}

export function TagReaderField({ uid, tone, compact, prompt, tokenRef, onClear, onManualUid }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useFieldLines(canvasRef, tone);
  const bytes = uid ? uidBytes(uid) : [];

  if (compact) {
    return (
      <div className="flex h-[88px] flex-none items-center gap-4 border-b border-[#223043] px-6">
        <div ref={tokenRef} className={`grid h-14 w-14 flex-none place-items-center rounded-full bg-[#0d141e] ${TOKEN_CLASS[uid ? tone : 'idle']}`}>
          <NfcIcon className="h-6 w-6" />
        </div>
        {uid ? (
          <span className="font-mono text-xl tracking-wide text-white">{bytes.join(' ')}</span>
        ) : prompt ? (
          <span className="inline-flex h-10 items-center gap-2 rounded-full bg-[#4cc9f0] px-4 text-base font-black text-[#04131a]">
            <NfcIcon className="h-5 w-5" />
            {prompt}
          </span>
        ) : null}
        <span className="ml-auto">{uid || !prompt ? null : <ManualUid onSubmit={onManualUid} />}</span>
      </div>
    );
  }

  return (
    <div className="relative h-[430px] flex-none">
      <canvas ref={canvasRef} width={640} height={430} className="absolute inset-0 h-full w-full" aria-hidden />
      <div className="absolute inset-x-6 top-5 z-[2] flex items-center justify-between">
        <span className="text-[13px] font-bold tracking-[0.14em] text-[#8494a8]">TAG</span>
        {uid ? (
          <button type="button" onClick={onClear} className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#223043] px-3 text-sm text-[#aebbd0] hover:bg-[#131c29]">
            <CloseIcon className="h-4 w-4" />
            閉じる
          </button>
        ) : (
          <ManualUid onSubmit={onManualUid} />
        )}
      </div>
      <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-[22px]">
        <div
          ref={tokenRef}
          className={`grid h-[168px] w-[168px] place-items-center rounded-full transition-transform duration-300 motion-reduce:transition-none ${uid ? 'bg-[radial-gradient(circle_at_35%_30%,#1d2a3b,#0d141e_70%)]' : 'bg-transparent'} ${TOKEN_CLASS[uid ? tone : 'idle']}`}
        >
          {tone === 'ok' ? <CheckIcon className="h-16 w-16" /> : <NfcIcon className="h-16 w-16" />}
        </div>
        {uid ? (
          <>
            <div className="flex gap-2.5 font-mono text-[34px] font-medium tabular-nums" aria-label={`タグID ${uid}`}>
              {bytes.map((byte, index) => (
                <span key={index} className={bytes.length > 1 && (index === 0 || index >= 5) ? 'text-[#4d5d72]' : 'text-white'}>{byte}</span>
              ))}
            </div>
            <div className="-mt-3 text-[13px] tracking-[0.08em] text-[#8494a8]">{bytes.length > 1 ? `UID · ${bytes.length} BYTE` : 'UID'}</div>
          </>
        ) : (
          <div className="inline-flex h-[52px] items-center gap-3 rounded-full bg-[#4cc9f0] pl-4 pr-[22px] text-xl font-black text-[#04131a]">
            <NfcIcon className="h-[26px] w-[26px]" />
            {prompt}
          </div>
        )}
      </div>
    </div>
  );
}
