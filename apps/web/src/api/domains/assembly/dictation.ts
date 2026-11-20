import { api } from '../../http';

import { procedureEditHeaders } from './shared';

const dictationPath = '/assembly/procedure-documents/dictation';

export type ProcedureDictationMode = 'new' | 'append' | 'revise';

export async function getAssemblyProcedureSpeechToTextAvailability(signal: AbortSignal) {
  const { data } = await api.get<{ available: boolean }>(`${dictationPath}/speech-to-text`, { signal, timeout: 5000 });
  return data.available === true;
}

export async function getAssemblyProcedureMeetingAvailability(signal: AbortSignal) {
  const { data } = await api.get<{ meetingAvailable: boolean }>(`${dictationPath}/speech-to-text`, { signal, timeout: 5000 });
  return data.meetingAvailable === true;
}

export const ASSEMBLY_PROCEDURE_MEETING_LIVE_PATH = '/assembly/procedure-documents/meeting-live';

export async function getAssemblyProcedureMeetingLiveAvailability(signal: AbortSignal) {
  const { data } = await api.get<{ available: boolean }>(`${ASSEMBLY_PROCEDURE_MEETING_LIVE_PATH}/availability`, { signal, timeout: 5000 });
  return data.available === true;
}

export async function submitAssemblyProcedureMeeting(audio: Blob, signal: AbortSignal) {
  const form = new FormData();
  form.append('audio', audio, 'meeting.webm');
  const { data } = await api.post<{ jobId: string }>(`${dictationPath}/meetings`, form, { signal, timeout: 5 * 60_000 });
  return data;
}

export async function getAssemblyProcedureMeeting(jobId: string, signal: AbortSignal) {
  const { data } = await api.get<{ status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'; text?: string; errorCode?: string }>(
    `${dictationPath}/meetings/${encodeURIComponent(jobId)}`, { signal, timeout: 10_000 }
  );
  return data;
}

export async function transcribeAssemblyProcedureDictation(audio: Blob, signal: AbortSignal, context?: string) {
  const form = new FormData();
  form.append('file', audio, 'dictation.webm');
  if (context !== undefined) form.append('context', context);
  const { data } = await api.post<{ text: string }>(`${dictationPath}/transcribe`, form, { signal, timeout: 45000 });
  if (typeof data.text !== 'string') throw new Error('Invalid transcription response');
  return { text: data.text.trim() };
}

export async function rewriteAssemblyProcedureDictation(input: {
  mode: ProcedureDictationMode; spokenText: string; currentText?: string; signal: AbortSignal;
  documentId?: string; pageIndex?: number; elementId?: string; originalText?: string; holderToken?: string;
}) {
  const { signal, holderToken, ...body } = input;
  const { data } = await api.post<{ text: string }>(`${dictationPath}/rewrite`, body, { signal, ...procedureEditHeaders(holderToken) });
  if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 10000) throw new Error('Invalid dictation response');
  return data;
}
