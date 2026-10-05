import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import {
  deleteTagDeskRecord,
  getTagDeskEvents,
  getTagDeskOptions,
  getTagDeskRegistry,
  linkTagDeskTag,
  resolveTagDeskUid,
  saveTagDeskRecord,
  unlinkTagDeskTag,
  type TagBindingKind,
  type TagDeskKind,
  type TagDeskRow
} from '../../../api/domains/tag-desk';
import { getApiErrorMessage } from '../../../api/errors';
import { useArmedNfcRead } from '../inventory/setup/useArmedNfcRead';

export type FormState = { kind: TagDeskKind; id: string | null };
export type Selection = { kind: TagDeskKind; id: string };

const KEY = ['kiosk-tag-desk'] as const;

/**
 * All state of the tag desk screen. The reader is live whenever no form is open: a read
 * replaces the current tag. A selected list row stays selected so a free tag can be bound to it.
 */
export function useTagDesk(pin: string) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<TagDeskKind>('employee');
  const [search, setSearch] = useState('');
  const [untaggedOnly, setUntaggedOnly] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = useArmedNfcRead(form === null);
  useEffect(() => {
    if (!read?.uid) return;
    setUid(read.uid.trim());
    setNotice(null);
    setError(null);
  }, [read]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const registries = useQuery({
    queryKey: [...KEY, 'registry', kind],
    queryFn: () => getTagDeskRegistry(pin, kind),
    staleTime: 30_000
  });
  const options = useQuery({ queryKey: [...KEY, 'options'], queryFn: () => getTagDeskOptions(pin), staleTime: 300_000 });
  const events = useQuery({ queryKey: [...KEY, 'events'], queryFn: () => getTagDeskEvents(pin), staleTime: 15_000 });
  const bindings = useQuery({
    queryKey: [...KEY, 'tag', uid],
    queryFn: () => resolveTagDeskUid(pin, uid ?? ''),
    enabled: uid !== null
  });

  const rows = useMemo(() => registries.data ?? [], [registries.data]);
  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (untaggedOnly && row.tags.length > 0) return false;
      if (!needle) return true;
      return row.code.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle) || (row.sub ?? '').toLowerCase().includes(needle);
    });
  }, [rows, search, untaggedOnly]);

  const selectedRow: TagDeskRow | null = selection && selection.kind === kind ? rows.find((row) => row.id === selection.id) ?? null : null;

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [...KEY, 'registry'] }),
      queryClient.invalidateQueries({ queryKey: [...KEY, 'tag'] }),
      queryClient.invalidateQueries({ queryKey: [...KEY, 'events'] })
    ]);
  };
  const onFail = (fallback: string) => (err: unknown) => setError(getApiErrorMessage(err, fallback));

  const link = useMutation({
    mutationFn: (input: { target: TagDeskRow; replace: boolean }) =>
      linkTagDeskTag(pin, { kind: input.target.kind, targetId: input.target.id, uid: uid ?? '', replace: input.replace }),
    onSuccess: async (_data, input) => {
      setNotice(`${input.target.name} に付けました`);
      setError(null);
      await refresh();
    },
    onError: onFail('付けられませんでした')
  });

  const unlink = useMutation({
    mutationFn: (input: { kind: TagBindingKind; bindingId: string; label: string }) =>
      unlinkTagDeskTag(pin, { kind: input.kind, bindingId: input.bindingId }),
    onSuccess: async (_data, input) => {
      setNotice(`${input.label} から外しました`);
      setError(null);
      await refresh();
    },
    onError: onFail('外せませんでした')
  });

  const save = useMutation({
    mutationFn: (input: { form: FormState; payload: Record<string, unknown> }) => saveTagDeskRecord(pin, input.form.kind, input.form.id, input.payload),
    onSuccess: async (saved, input) => {
      setForm(null);
      setSelection({ kind: input.form.kind, id: saved.id });
      setNotice(input.form.id ? '保存しました' : '登録しました');
      setError(null);
      await refresh();
    },
    onError: onFail('保存できませんでした')
  });

  const remove = useMutation({
    mutationFn: (input: { kind: TagDeskKind; id: string }) => deleteTagDeskRecord(pin, input.kind, input.id),
    onSuccess: async () => {
      setForm(null);
      setSelection(null);
      setNotice('削除しました');
      setError(null);
      await refresh();
    },
    onError: onFail('削除できませんでした')
  });

  return {
    kind,
    setKind: (next: TagDeskKind) => {
      setKind(next);
      setForm(null);
    },
    search,
    setSearch,
    untaggedOnly,
    setUntaggedOnly,
    rows,
    visibleRows,
    registryLoading: registries.isLoading,
    options: options.data ?? { divisions: [], sections: [], departments: [], genres: [] },
    events: events.data ?? [],
    uid,
    clearUid: () => {
      setUid(null);
      setError(null);
    },
    setUidManually: (value: string) => setUid(value.trim() || null),
    bindings: bindings.data ?? null,
    bindingsLoading: bindings.isFetching && !bindings.data,
    selection,
    selectedRow,
    select: (next: Selection | null) => {
      setSelection(next);
      setForm(null);
      setError(null);
    },
    form,
    openForm: (next: FormState | null) => {
      setForm(next);
      setError(null);
    },
    notice,
    error,
    link,
    unlink,
    save,
    remove
  };
}

export type TagDeskState = ReturnType<typeof useTagDesk>;
