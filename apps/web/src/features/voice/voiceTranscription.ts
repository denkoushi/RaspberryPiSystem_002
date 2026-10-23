import { isAxiosError } from 'axios';

import { getAssemblyProcedureSpeechToTextAvailability, transcribeAssemblyProcedureDictation } from '../../api/domains/assembly';

export const WHISPER_BASE_URL = 'http://127.0.0.1:8178';
// Whisper returns these stock phrases for silence; treat them as nothing heard.
const SILENCE_PHRASES = new Set([
  'ご視聴ありがとうございました', 'ご視聴ありがとうございます', '最後までご視聴ありがとうございました',
  '最後までご視聴いただきありがとうございます', 'ご清聴ありがとうございました', 'チャンネル登録お願いします',
  'チャンネル登録よろしくお願いします', '字幕視聴ありがとうございました'
]);
const isSilencePhrase = (text: string) => SILENCE_PHRASES.has(text.replace(/[\s、。．.!！?？「」]/g, ''));
export type VoiceSession = { abort: AbortController; stream?: MediaStream; recorder?: MediaRecorder; timer?: ReturnType<typeof setTimeout> };

export function disposeVoiceSession(session: VoiceSession) {
  session.abort.abort();
  clearTimeout(session.timer);
  if (session.recorder?.state === 'recording') session.recorder.stop();
  session.stream?.getTracks().forEach(track => track.stop());
}

function waitForRetry(seconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => { clearTimeout(timer); reject(new Error('Aborted')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, seconds * 1000);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export type VoiceInputError = 'マイクを使えません' | '長すぎます' | '混んでいます' | '音声認識が動いていません' | '聞き取れませんでした';

export async function startVoiceTranscription(
  session: VoiceSession,
  active: () => boolean,
  onProcessing: () => void,
  onTranscript: (text: string) => Promise<void> | void,
  onError: (error: VoiceInputError) => void,
  context?: string
) {
  const availability = getAssemblyProcedureSpeechToTextAvailability(session.abort.signal).catch(() => false);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    session.stream = stream;
    if (!active()) { stream.getTracks().forEach(track => track.stop()); return; }
    const recorder = new MediaRecorder(stream, {
      audioBitsPerSecond: 64000,
      ...(MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : {})
    });
    session.recorder = recorder;
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => {
      if (!active()) return;
      onError('マイクを使えません'); disposeVoiceSession(session);
    };
    recorder.onstop = async () => {
      clearTimeout(session.timer);
      stream.getTracks().forEach(track => track.stop());
      if (!active()) return;
      onProcessing();
      let spokenText: string;
      try {
        const audio = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (await availability) {
          if (!active()) return;
          if (audio.size > 2_000_000) { onError('長すぎます'); return; }
          let result: { text: string };
          try {
            result = await transcribeAssemblyProcedureDictation(audio, session.abort.signal, context);
          } catch (error) {
            if (!isAxiosError(error) || error.response?.status !== 429) throw error;
            const header = String(error.response.headers['retry-after'] ?? '');
            const seconds = /^[1-9]\d*$/.test(header) ? Math.min(Number(header), 5) : 2;
            await waitForRetry(seconds, session.abort.signal);
            result = await transcribeAssemblyProcedureDictation(audio, session.abort.signal, context);
          }
          spokenText = result.text.trim();
        } else {
          if (!active()) return;
          const form = new FormData();
          form.append('file', new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }), 'dictation.webm');
          form.append('response_format', 'json'); form.append('language', 'ja'); form.append('temperature', '0');
          const response = await fetch(`${WHISPER_BASE_URL}/inference`, { method: 'POST', body: form, signal: session.abort.signal });
          if (!response.ok) throw new Error('STT unavailable');
          const data = await response.json() as { text?: unknown };
          spokenText = typeof data.text === 'string' ? data.text.trim() : '';
        }
      } catch (error) {
        onError(isAxiosError(error) && error.response?.status === 429 ? '混んでいます' : '音声認識が動いていません');
        return;
      }
      if (!active()) return;
      if (!spokenText || isSilencePhrase(spokenText)) { onError('聞き取れませんでした'); return; }
      await onTranscript(spokenText);
    };
    recorder.start();
    session.timer = setTimeout(() => {
      if (active() && recorder.state === 'recording') recorder.stop();
    }, 60000);
  } catch {
    if (active()) {
      onError('マイクを使えません'); disposeVoiceSession(session);
    }
  }
}
