import { isAxiosError } from 'axios';
import { useEffect, useRef, useState } from 'react';

import {
  getAssemblyProcedureMeeting, getAssemblyProcedureMeetingAvailability, rewriteAssemblyProcedureDictation, submitAssemblyProcedureMeeting
} from '../../../api/domains/assembly';
import { disposeVoiceSession, MEETING_RECORDING_MAX_SECONDS, startMeetingRecording, startVoiceTranscription, waitForVoiceDelay } from '../../voice/voiceTranscription';

import { PROCEDURE_TEXT_MAX_LENGTH } from './assemblyDocumentEditorDraft';

import type { ProcedureDictationMode } from '../../../api/domains/assembly';
import type { VoiceSession } from '../../voice/voiceTranscription';
import type { OverlayTextElement } from '@raspi-system/shared-types';

export { WHISPER_BASE_URL as PROCEDURE_WHISPER_BASE_URL } from '../../voice/voiceTranscription';
export const PROCEDURE_DICTATION_REWRITE_TIMEOUT_MS = 20000;

function meetingErrorMessage(code?: string) {
  if (code === 'meeting_transcribe_too_large' || code === 'meeting_transcribe_too_long') return '長すぎます';
  if (code === 'meeting_transcribe_busy' || code === 'meeting_transcribe_insufficient_memory') return '混んでいます';
  if (code === 'meeting_transcribe_timeout') return '時間がかかりすぎました';
  if (code === 'meeting_transcribe_bad_request') return '音声データが正しくありません';
  return '書き起こしができませんでした';
}

export function useProcedureVoiceInput(
  element: OverlayTextElement | null, enabled: boolean, onUpdate: (element: OverlayTextElement) => void,
  context?: string, documentId?: string, pageIndex?: number, holderToken?: string | null
) {
  const [status, setStatus] = useState<'idle' | 'recording' | 'processing'>('idle');
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const [previous, setPrevious] = useState<{ text: string; applied: string } | null>(null);
  const sessionRef = useRef<VoiceSession | null>(null);
  const latest = useRef({ element, enabled, onUpdate });
  latest.current = { element, enabled, onUpdate };

  const cancel = () => {
    if (sessionRef.current) disposeVoiceSession(sessionRef.current);
    sessionRef.current = null;
  };
  useEffect(() => {
    setStatus('idle'); setError(''); setTranscript(''); setPrevious(null);
    return () => {
      if (sessionRef.current) disposeVoiceSession(sessionRef.current);
      sessionRef.current = null;
    };
  }, [element?.id, enabled]);

  const manualEdit = () => {
    cancel(); setStatus('idle'); setPrevious(null); setError(''); setTranscript('');
  };
  const start = async (mode: ProcedureDictationMode) => {
    if (!element || !enabled || sessionRef.current) return;
    const original = element;
    const session: VoiceSession = { abort: new AbortController() };
    sessionRef.current = session;
    const current = () => sessionRef.current === session && !session.abort.signal.aborted && latest.current.enabled && latest.current.element?.id === original.id;
    // Undo/redo during a session changes the text; never write over that.
    const active = () => current() && latest.current.element?.text === original.text;
    const finish = () => {
      if (!current()) return;
      clearTimeout(session.timer);
      session.stream?.getTracks().forEach(track => track.stop());
      sessionRef.current = null;
      setStatus('idle');
    };
    const apply = (text: string) => {
      if (!active() || !latest.current.element) return false;
      const next = mode === 'append' ? original.text + '\n' + text : text;
      if (next.length > PROCEDURE_TEXT_MAX_LENGTH) { setError('長すぎます'); return false; }
      setPrevious({ text: original.text, applied: next });
      latest.current.onUpdate({ ...latest.current.element, text: next });
      return true;
    };
    setError(''); setTranscript(''); setStatus('recording');
    await startVoiceTranscription(session, active, () => setStatus('processing'), async (spokenText) => {
      setTranscript(spokenText);
      // The in-house LLM may still be loading; never keep the operator waiting on it.
      const limit = new AbortController();
      const onAbort = () => limit.abort();
      session.abort.signal.addEventListener('abort', onAbort, { once: true });
      const limitTimer = setTimeout(onAbort, PROCEDURE_DICTATION_REWRITE_TIMEOUT_MS);
      try {
        const result = await rewriteAssemblyProcedureDictation({
          mode, spokenText, currentText: mode === 'new' ? undefined : original.text, signal: limit.signal,
          ...(documentId && pageIndex !== undefined && { documentId, pageIndex, elementId: original.id, originalText: original.text }),
          ...(holderToken && { holderToken }),
        });
        apply(result.text);
      } catch {
        if (active()) {
          if (mode === 'revise') setError('直せませんでした');
          else if (apply(spokenText)) setError('そのまま入れました');
        }
      } finally {
        clearTimeout(limitTimer);
        session.abort.signal.removeEventListener('abort', onAbort);
        finish();
      }
    }, (message) => { if (active()) setError(message); finish(); }, context);
  };
  const stop = () => {
    const session = sessionRef.current;
    if (session?.recorder?.state === 'recording') session.recorder.stop();
    else if (session && !session.recorder) { cancel(); setStatus('idle'); }
  };
  const canRestore = previous !== null && previous.applied === element?.text;
  const restore = () => {
    if (!element || !canRestore || !previous) return;
    onUpdate({ ...element, text: previous.text });
    setPrevious(null); setTranscript(''); setError('');
  };
  return { status, error, transcript, canRestore, start, stop, restore, manualEdit };
}

type MeetingEdit = { element: OverlayTextElement; undo: () => boolean };

export function useProcedureMeetingInput({
  element, enabled, disabled, busy, inlineEditingId, documentId, applyTranscript
}: {
  element: OverlayTextElement | null;
  enabled: boolean;
  disabled: boolean;
  busy: boolean;
  inlineEditingId: string | null;
  documentId?: string;
  applyTranscript: (target: OverlayTextElement, transcript: string) => MeetingEdit | undefined;
}) {
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<'idle' | 'recording' | 'processing'>('idle');
  const [targetId, setTargetId] = useState<string>();
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ target: OverlayTextElement; text: string; documentId?: string }>();
  const [previous, setPrevious] = useState<MeetingEdit>();
  const sessionRef = useRef<VoiceSession | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    void getAssemblyProcedureMeetingAvailability(abort.signal).then(result => {
      if (!abort.signal.aborted) setAvailable(result);
    }).catch(() => {});
    return () => { abort.abort(); setAvailable(false); };
  }, [enabled]);

  useEffect(() => {
    setStatus('idle');
    setTargetId(undefined);
    setPending(undefined);
    setPrevious(undefined);
    setError('');
    return () => {
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) disposeVoiceSession(session);
    };
  }, [documentId]);

  useEffect(() => {
    if (status !== 'recording' || recordingStartedAt === null) return;
    const timer = setInterval(() => {
      setElapsedSeconds(Math.min(MEETING_RECORDING_MAX_SECONDS, Math.floor((Date.now() - recordingStartedAt) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [status, recordingStartedAt]);

  useEffect(() => {
    if (!pending || pending.documentId !== documentId || busy || inlineEditingId === pending.target.id) return;
    const edit = applyTranscript(pending.target, pending.text);
    if (edit) {
      setPrevious(edit);
      setTargetId(edit.element.id);
    } else {
      setError('追記できませんでした');
    }
    setPending(undefined);
    setStatus('idle');
  }, [pending, documentId, busy, inlineEditingId, applyTranscript]);

  const start = async () => {
    if (!element || !enabled || disabled || busy || !available || sessionRef.current || status !== 'idle') return;
    const target = element;
    const session: VoiceSession = { abort: new AbortController() };
    const signal = session.abort.signal;
    sessionRef.current = session;
    const current = () => sessionRef.current === session && !signal.aborted;
    const finish = () => {
      if (!current()) return;
      sessionRef.current = null;
      setStatus('idle');
    };
    setTargetId(target.id);
    setStatus('recording');
    setRecordingStartedAt(null);
    setElapsedSeconds(0);
    setPrevious(undefined);
    setError('');

    await startMeetingRecording(session, current, () => setRecordingStartedAt(Date.now()), async audio => {
      setStatus('processing');
      let readyToApply = false;
      try {
        if (!audio.size) { setError('聞き取れませんでした'); return; }
        const jobId = await uploadMeeting(audio, signal);
        let firstFailureAt: number | undefined;
        while (current()) {
          await waitForVoiceDelay(5, signal);
          const startedAt = Date.now();
          let job: Awaited<ReturnType<typeof getAssemblyProcedureMeeting>>;
          try {
            job = await getAssemblyProcedureMeeting(jobId, signal);
          } catch (error) {
            firstFailureAt ??= startedAt;
            if ((isAxiosError(error) && error.response?.status === 404) || Date.now() - firstFailureAt >= 10 * 60_000) throw error;
            continue;
          }
          if (!current()) return;
          firstFailureAt = undefined;
          if (job.status === 'QUEUED' || job.status === 'RUNNING') continue;
          if (job.status === 'FAILED') { setError(meetingErrorMessage(job.errorCode)); return; }
          const text = job.text?.trim();
          if (!text) { setError('聞き取れませんでした'); return; }
          readyToApply = true;
          setPending({ target, text, documentId });
          return;
        }
      } catch (error) {
        if (current()) {
          const code = isAxiosError(error) ? error.response?.status : undefined;
          setError(code === 413 ? '長すぎます' : code === 429 ? '混んでいます' : meetingErrorMessage());
        }
      } finally {
        if (readyToApply) sessionRef.current = null;
        else finish();
      }
    }, message => { if (current()) setError(message); finish(); });
  };

  const stop = () => {
    const session = sessionRef.current;
    if (session?.recorder?.state === 'recording') session.recorder.stop();
    else if (session && !session.recorder) {
      sessionRef.current = null;
      disposeVoiceSession(session);
      setStatus('idle');
    }
  };
  const selected = element !== null && element.id === targetId;
  const canRestore = selected && previous !== undefined && element.text === previous.element.text;
  const restore = () => {
    if (!canRestore || !previous) return;
    if (!previous.undo()) { setError('戻せませんでした'); return; }
    setPrevious(undefined);
    setError('');
  };
  return { available: enabled && available, status: selected ? status : 'idle' as const, locked: status !== 'idle',
    elapsedSeconds, error: selected ? error : '', canRestore, start, stop, restore };
}

async function uploadMeeting(audio: Blob, signal: AbortSignal): Promise<string> {
  for (const delay of [10, 20]) {
    try {
      return (await submitAssemblyProcedureMeeting(audio, signal)).jobId;
    } catch {
      await waitForVoiceDelay(delay, signal);
    }
  }
  return (await submitAssemblyProcedureMeeting(audio, signal)).jobId;
}
