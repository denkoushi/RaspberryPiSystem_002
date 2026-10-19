import { useLocalLlmAvailability } from '../../../api/hooks/local-llm';
import { AiUnavailableBadge } from '../../../components/ui/AiUnavailableBadge';

import type { useProcedureVoiceInput } from './useProcedureVoiceInput';

export function ProcedureVoiceInput({ voice, empty, disabled }: {
  voice: ReturnType<typeof useProcedureVoiceInput>;
  empty: boolean;
  disabled: boolean;
}) {
  const { unavailable } = useLocalLlmAvailability();
  const mic = <svg aria-hidden="true" className="h-[26px] w-[26px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
  const buttonClass = 'flex h-16 items-center justify-center gap-2 rounded-lg border border-[#7cc4ff] bg-[#7cc4ff1f] text-xl font-extrabold text-[#7cc4ff] disabled:opacity-50';
  return <div className="grid gap-3">
    <div className="grid grid-cols-2 gap-2">
      {voice.status === 'recording' ? <button type="button" data-kiosk-sop-target="assembly-document-editor-voice-stop" disabled={disabled} onClick={voice.stop} className={`${buttonClass} col-span-2 !border-[#ff8a80] !bg-[#ff8a80] !text-[#2a0b08]`}>止める</button>
        : voice.status === 'processing' ? <div role="status" className="col-span-2 flex h-16 items-center justify-center text-lg text-[#f6b93b]">文にしています…</div>
          : <>
            {empty ? <AiUnavailableBadge unavailable={unavailable}><button type="button" data-kiosk-sop-target="assembly-document-editor-voice-new" disabled={disabled} onClick={() => void voice.start('new')} className={`${buttonClass} col-span-2`}>{mic}話す</button></AiUnavailableBadge>
              : <><AiUnavailableBadge unavailable={unavailable}><button type="button" data-kiosk-sop-target="assembly-document-editor-voice-append" disabled={disabled} onClick={() => void voice.start('append')} className={buttonClass}>{mic}続き</button></AiUnavailableBadge><AiUnavailableBadge unavailable={unavailable}><button type="button" data-kiosk-sop-target="assembly-document-editor-voice-revise" disabled={disabled} onClick={() => void voice.start('revise')} className={buttonClass}>{mic}直す</button></AiUnavailableBadge></>}
            {voice.canRestore ? <button type="button" data-kiosk-sop-target="assembly-document-editor-voice-restore" disabled={disabled} onClick={voice.restore} className="col-span-2 h-12 rounded-lg border border-[#344252] text-[17px] font-extrabold text-[#eef3f6]">戻す</button> : null}
          </>}
    </div>
    {voice.error ? <div role="alert" className="text-[15px] text-[#ff8a80]">{voice.error}</div> : null}
    <div className="min-h-[22px] truncate text-[15px] font-normal leading-[1.4] text-[#9fadb9]" title={voice.transcript || undefined}>{voice.transcript ? `聞き取り: ${voice.transcript}` : ''}</div>
  </div>;
}
