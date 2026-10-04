import { useEffect, useRef, useState } from 'react';

import { getApiErrorMessage } from '../../api/errors';

import { fetchFields } from './knowledgeTriageApi';

import type { KnowledgeFieldNode } from '@raspi-system/shared-types';

const button = 'h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:opacity-40';
// Mirrors enforceReviewTier in the API: only the clerical branch may publish without approval.
export const approvalField = (root: string) => root !== '事務・教育';

function findPath(nodes: KnowledgeFieldNode[], name: string): KnowledgeFieldNode[] | null {
  for (const node of nodes) {
    if (node.name === name) return [node];
    const child = findPath(node.children, name);
    if (child) return [node, ...child];
  }
  return null;
}

export function KnowledgeFieldPicker({ value, disabled = false, requiresApproval = false, onChange }: {
  value: string; disabled?: boolean; requiresApproval?: boolean; onChange: (name: string, root: string) => void;
}) {
  const initialValue = useRef(value);
  const [fields, setFields] = useState<KnowledgeFieldNode[]>([]);
  const [path, setPath] = useState<KnowledgeFieldNode[]>([]);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchFields(controller.signal).then(nodes => {
      if (controller.signal.aborted) return;
      setFields(nodes); setPath(findPath(nodes, initialValue.current) ?? []);
    }).catch(failure => { if (!controller.signal.aborted) setError(getApiErrorMessage(failure, '分野を取得できませんでした。')); });
    return () => controller.abort();
    // The initial AI proposal opens its branch; subsequent navigation stays local.
  }, []);
  const current = path.at(-1);
  const nodes = current?.children ?? fields;
  const controls = current ? 2 : 0;
  const pageSize = nodes.length > 9 - controls ? 7 - controls : 9 - controls;
  return <div className="space-y-1.5" role="group" aria-label="分野">
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
      <span>種類{path.length ? `：${path.map(node => node.name).join(' › ')}` : ''}</span>
      {path.length ? <button type="button" className={button} disabled={disabled} onClick={() => {
        setPath(path.slice(0, -1)); setPage(0); onChange('', '');
      }}>戻る</button> : null}
    </div>
    <div className="flex flex-wrap gap-1.5">{nodes.slice(page * pageSize, page * pageSize + pageSize).map(node => <button type="button" key={node.id} disabled={disabled}
      className={button} onClick={() => { setPath([...path, node]); setPage(0); if (node.children.length) onChange('', ''); else onChange(node.name, (path[0] ?? node).name); }}>{node.name}</button>)}</div>
    {nodes.length > pageSize ? <div className="flex gap-1.5">
      <button type="button" className={button} disabled={disabled || page === 0} onClick={() => setPage(page - 1)}>前</button>
      <button type="button" className={button} disabled={disabled || (page + 1) * pageSize >= nodes.length} onClick={() => setPage(page + 1)}>次</button>
    </div> : null}
    {current ? <div className="flex flex-wrap items-center gap-1.5">
      {current.children.length ? <button type="button" disabled={disabled} className={`${button} border-blue-700 text-blue-800`} onClick={() => onChange(current.name, path[0].name)}>ここで決定</button> : null}
      {value ? <span className="text-sm text-blue-800">✓ {value}</span> : null}
    </div> : null}
    {requiresApproval || (current && approvalField(path[0].name)) ? <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">承認が要る</span> : null}
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
  </div>;
}
