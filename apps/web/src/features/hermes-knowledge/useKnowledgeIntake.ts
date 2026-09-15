import { useEffect, useRef, useState } from 'react';

import { getApiErrorMessage } from '../../api/errors';
import { api } from '../../api/http';

import type { KnowledgeReport } from '@raspi-system/shared-types';

export type KnowledgeIntakeView = {
  id: string; text: string; state: string; version: number; message: string; errorCode: string | null;
  files: { filename: string; kind: 'image' | 'pdf' }[];
  choices: { id: string; label: string }[]; report?: KnowledgeReport;
};

function conversationKey() {
  // The server scopes this opaque conversation ID to its authenticated owner.
  const key = 'hermes-knowledge-conversation';
  try {
    const current = sessionStorage.getItem(key);
    if (current && /^[a-f0-9-]{36}$/.test(current)) return current;
    const id = crypto.randomUUID(); sessionStorage.setItem(key, id); return id;
  } catch { return crypto.randomUUID(); }
}
async function encodeFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error('添付を読み込めませんでした。'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(file);
  });
}

export function useKnowledgeIntake(identity: string, consultationId: string | null, open: boolean) {
  const [enabled, setEnabled] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<KnowledgeIntakeView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localId, setLocalId] = useState(() => conversationKey());
  const conversationId = consultationId ?? localId;
  const active = useRef({ identity, conversationId }); active.current = { identity, conversationId };
  const submission = useRef<{ signature: string; id: string } | null>(null);
  const delegated = useRef(new Set<string>());
  const operation = useRef(false);

  useEffect(() => {
    setEnabled(false); setFiles([]); setItems([]); setError(null); setLocalId(conversationKey()); submission.current = null;
    const controller = new AbortController();
    void api.get<{ enabled: boolean }>('/hermes-knowledge/capabilities', { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setEnabled(data.enabled); }).catch(() => undefined);
    return () => controller.abort();
  }, [identity]);

  useEffect(() => {
    setItems([]);
    if (!enabled || !open) return;
    const controller = new AbortController(); let pending = false;
    const poll = async () => {
      if (pending) return; pending = true;
      try {
        const { data } = await api.get<{ intakes: KnowledgeIntakeView[] }>('/hermes-knowledge/intakes', { params: { conversationId }, signal: controller.signal });
        if (!controller.signal.aborted) setItems(data.intakes.filter(item => !delegated.current.has(item.id)));
      } catch (failure) {
        if (!controller.signal.aborted) setError(getApiErrorMessage(failure, '記録の処理状況を取得できませんでした。'));
      } finally { pending = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 4000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [enabled, open, conversationId, identity]);

  const receive = async (text: string): Promise<boolean | null> => {
    if (!enabled) return false;
    if (operation.current) return true;
    operation.current = true; setBusy(true); setError(null);
    const scope = active.current;
    try {
      if (files.length > 4 || (files.some(file => file.type === 'application/pdf') && files.length !== 1)) throw new Error('写真は4枚まで、PDFは1件ずつ送信してください。');
      for (const file of files) {
        const pdf = file.type === 'application/pdf';
        if ((!pdf && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) || file.size > (pdf ? 20_000_000 : 10_000_000)) throw new Error('画像はJPEG・PNG・WebPの10 MBまで、PDFは20 MBまでです。');
      }
      const signature = JSON.stringify({ text, conversationId, files: files.map(file => [file.name, file.size, file.lastModified]) });
      if (submission.current?.signature !== signature) submission.current = { signature, id: crypto.randomUUID() };
      const encoded = [];
      for (const file of files) encoded.push({ filename: file.name, kind: file.type === 'application/pdf' ? 'pdf' : 'image', base64: await encodeFile(file) });
      const { data } = await api.post<KnowledgeIntakeView>('/hermes-knowledge/intakes', { id: submission.current.id, conversationId, text, files: encoded });
      if (active.current.identity !== scope.identity || active.current.conversationId !== scope.conversationId) return null;
      submission.current = null; setFiles([]);
      if (data.state === 'delegated' && !files.length) { delegated.current.add(data.id); return false; }
      setItems(current => [...current.filter(item => item.id !== data.id), data]);
      return true;
    } catch (failure) {
      if (active.current.identity === scope.identity) setError(getApiErrorMessage(failure, failure instanceof Error ? failure.message : '送信できませんでした。内容を保持しています。'));
      // Throw so the caller preserves its draft as well as attachments and stable submission ID.
      throw failure;
    } finally { operation.current = false; setBusy(false); }
  };
  const choose = async (item: KnowledgeIntakeView, action: string) => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(null);
    const scope = active.current;
    try {
      const { data } = await api.post<KnowledgeIntakeView>(`/hermes-knowledge/intakes/${item.id}/${action === 'retry' ? 'retry' : 'choice'}`, { version: item.version, ...(action === 'retry' ? {} : { action }) });
      if (active.current.identity === scope.identity && active.current.conversationId === scope.conversationId) setItems(current => current.map(value => value.id === item.id ? data : value));
    } catch (failure) { if (active.current.identity === scope.identity && active.current.conversationId === scope.conversationId) setError(getApiErrorMessage(failure, '選択を保存できませんでした。最新の確認を選んでください。')); }
    finally { operation.current = false; setBusy(false); }
  };
  const reset = () => { const id = crypto.randomUUID(); setLocalId(id); setFiles([]); setItems([]); setError(null); submission.current = null;
    try { sessionStorage.setItem('hermes-knowledge-conversation', id); } catch { /* memory-only continuation */ }
  };
  return { enabled, files, setFiles, items, busy, error, receive, choose, reset };
}
