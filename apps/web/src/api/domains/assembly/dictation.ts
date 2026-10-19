import { api } from '../../http';

export type ProcedureDictationMode = 'new' | 'append' | 'revise';

export async function getAssemblyProcedureSpeechToTextAvailability(signal: AbortSignal) {
  const { data } = await api.get<{ available: boolean }>('/assembly/procedure-documents/dictation/speech-to-text', { signal, timeout: 5000 });
  return data.available === true;
}

export async function transcribeAssemblyProcedureDictation(audio: Blob, signal: AbortSignal) {
  const form = new FormData();
  form.append('file', audio, 'dictation.webm');
  const { data } = await api.post<{ text: string }>('/assembly/procedure-documents/dictation/transcribe', form, { signal, timeout: 45000 });
  if (typeof data.text !== 'string') throw new Error('Invalid transcription response');
  return { text: data.text.trim() };
}

export async function rewriteAssemblyProcedureDictation(input: { mode: ProcedureDictationMode; spokenText: string; currentText?: string; signal: AbortSignal }) {
  const { signal, ...body } = input;
  const { data } = await api.post<{ text: string }>('/assembly/procedure-documents/dictation/rewrite', body, { signal });
  if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 10000) throw new Error('Invalid dictation response');
  return data;
}
