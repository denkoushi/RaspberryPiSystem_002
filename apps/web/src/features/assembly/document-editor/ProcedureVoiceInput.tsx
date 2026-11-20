import { useLocalLlmAvailability } from '../../../api/hooks/local-llm';
import { AiUnavailableBadge } from '../../../components/ui/AiUnavailableBadge';

import type { useProcedureLiveMeeting } from './useProcedureLiveMeeting';
import type { useProcedureMeetingInput, useProcedureVoiceInput } from './useProcedureVoiceInput';

function recordingTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function ProcedureVoiceInput({ voice, meeting, live, empty, disabled }: {
  voice: ReturnType<typeof useProcedureVoiceInput>;
  meeting?: ReturnType<typeof useProcedureMeetingInput>;
  live?: ReturnType<typeof useProcedureLiveMeeting>;
  empty: boolean;
  disabled: boolean;
}) {
  const { unavailable } = useLocalLlmAvailability();
  const mic = <svg aria-hidden="true" className="h-[26px] w-[26px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
  const buttonClass = 'flex h-16 items-center justify-center gap-2 rounded-lg border border-[#7cc4ff] bg-[#7cc4ff1f] text-xl font-extrabold text-[#7cc4ff] disabled:opacity-50';
  const meetingIcon = <svg aria-hidden="true" className="h-[26px] w-[26px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="7" r="3" /><circle cx="16" cy="7" r="3" /><path d="M2 20v-2a6 6 0 0 1 12 0v2m1-8a6 6 0 0 1 7 6v2" /></svg>;
  const meetingButton = (locked: boolean, onStart: () => Promise<void> | void) => <AiUnavailableBadge unavailable={unavailable}>
    <button type="button" disabled={disabled || locked} onClick={() => void onStart()} className={`${buttonClass} col-span-2`}>{meetingIcon}話し合い</button>
  </AiUnavailableBadge>;
  const activeLive = live && live.status !== 'idle' ? live : undefined;
  const activeMeeting = activeLive ?? (meeting && meeting.status !== 'idle' ? meeting : undefined);
  const status = activeMeeting?.status ?? voice.status;
  return <div className="grid gap-3">
    <div className="grid grid-cols-2 gap-2">
      {status === 'recording' ? <>
        {activeMeeting ? <div className="col-span-2 flex items-center justify-center gap-2 text-[28px] font-extrabold tabular-nums text-[#ff8a80]">
          <span aria-hidden="true" className="h-3 w-3 animate-pulse rounded-full bg-[#ff8a80] motion-reduce:animate-none" />
          {recordingTime(activeMeeting.elapsedSeconds)}{activeLive ? '' : ' / 60:00'}
        </div> : null}
        <button type="button" data-kiosk-sop-target="assembly-document-editor-voice-stop" disabled={disabled && !activeMeeting} onClick={activeMeeting?.stop ?? voice.stop} className={`${buttonClass} col-span-2 !border-[#ff8a80] !bg-[#ff8a80] !text-[#2a0b08]`}>止める</button>
      </> : status === 'processing' ? <>
          <div role="status" className="col-span-2 flex h-16 items-center justify-center text-lg text-[#f6b93b]">{activeMeeting ? '書き起こし中…' : '文にしています…'}</div>
          {activeMeeting ? meetingButton(true, () => {}) : null}
        </>
          : <>
            {empty ? <AiUnavailableBadge unavailable={unavailable}><button type="button" data-kiosk-sop-target="assembly-document-editor-voice-new" disabled={disabled} onClick={() => void voice.start('new')} className={`${buttonClass} col-span-2`}>{mic}話す</button></AiUnavailableBadge>
              : <><AiUnavailableBadge unavailable={unavailable}><button type="button" data-kiosk-sop-target="assembly-document-editor-voice-append" disabled={disabled} onClick={() => void voice.start('append')} className={buttonClass}>{mic}続き</button></AiUnavailableBadge><AiUnavailableBadge unavailable={unavailable}><button type="button" data-kiosk-sop-target="assembly-document-editor-voice-revise" disabled={disabled} onClick={() => void voice.start('revise')} className={buttonClass}>{mic}直す</button></AiUnavailableBadge></>}
            {live?.available ? meetingButton(live.locked, live.start) : meeting?.available ? meetingButton(meeting.locked, meeting.start) : null}
            {voice.canRestore || live?.canRestore || meeting?.canRestore ? <button type="button" data-kiosk-sop-target="assembly-document-editor-voice-restore" disabled={disabled} onClick={voice.canRestore ? voice.restore : live?.canRestore ? live.restore : meeting?.restore} className="col-span-2 h-12 rounded-lg border border-[#344252] text-[17px] font-extrabold text-[#eef3f6]">戻す</button> : null}
          </>}
    </div>
    {voice.error || live?.error || meeting?.error ? <div role="alert" className="text-[15px] text-[#ff8a80]">{voice.error || live?.error || meeting?.error}</div> : null}
    <div className="min-h-[22px] truncate text-[15px] font-normal leading-[1.4] text-[#9fadb9]" title={voice.transcript || undefined}>{voice.transcript ? `聞き取り: ${voice.transcript}` : ''}</div>
  </div>;
}
