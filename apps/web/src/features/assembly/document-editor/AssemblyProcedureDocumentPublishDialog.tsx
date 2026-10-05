import { useEffect, useRef, useState } from 'react';

import { resolveProcedureManualApprover } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { useArmedNfcRead } from '../../kiosk/inventory/setup/useArmedNfcRead';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

type Approval = { reviewerTagUid: string; comment?: string };
type Props = {
  busy: boolean;
  error: string | null;
  onPublish: (approval?: Approval) => Promise<boolean | void>;
  onClose: () => void;
};

export function AssemblyProcedureDocumentPublishDialog({ busy, error, onPublish, onClose }: Props) {
  const [method, setMethod] = useState<'tag' | 'password'>('tag');
  const [reviewer, setReviewer] = useState<{ tagUid: string; displayName: string; positionName: string | null } | null>(null);
  const [comment, setComment] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [publishFailed, setPublishFailed] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  const generation = useRef(0);
  const read = useArmedNfcRead(method === 'tag' && !reviewer && !verifying && !busy);

  useEffect(() => () => { generation.current += 1; }, []);
  useEffect(() => {
    if (!read?.uid) return;
    const current = ++generation.current;
    setVerifying(true); setTagError(null);
    void resolveProcedureManualApprover(read.uid).then(approver => {
      if (current === generation.current) setReviewer({ ...approver, tagUid: read.uid });
    }).catch(failure => {
      if (current === generation.current) setTagError(readAssemblyApiErrorMessage(failure, 'このタグは承認できません(職位の対応表を確認)'));
    }).finally(() => { if (current === generation.current) setVerifying(false); });
  }, [read]);

  const clearReviewer = () => {
    generation.current += 1;
    setReviewer(null); setVerifying(false); setTagError(null);
  };
  const submit = async () => {
    if (busy || verifying || (method === 'tag' && !reviewer)) return;
    setPublishFailed(false);
    const result = await onPublish(method === 'tag' && reviewer
      ? { reviewerTagUid: reviewer.tagUid, ...(comment.trim() ? { comment: comment.trim() } : {}) }
      : undefined);
    if (result !== false) onClose();
    else setPublishFailed(true);
  };
  return <Dialog isOpen title="手順書を公開" onClose={busy ? () => undefined : onClose}
    description="公開すると、この内容が使用側に反映されます。公開後に編集する場合は、新しい改版を作成します。">
    <fieldset disabled={busy} className="mt-3 space-y-3">
      <legend className="text-sm font-semibold">公開方法</legend>
      <label className="flex items-center gap-2 text-sm"><input type="radio" name="publish-method" checked={method === 'tag'} onChange={() => { clearReviewer(); setMethod('tag'); }} />社員タグで承認して公開</label>
      <label className="flex items-center gap-2 text-sm"><input type="radio" name="publish-method" checked={method === 'password'} onChange={() => { clearReviewer(); setMethod('password'); }} />パスワードで公開(締付テンプレート向け)</label>
    </fieldset>
    {method === 'tag' ? <div className="mt-3 space-y-3">
      {reviewer ? <div>
        <p role="status" className="text-sm font-semibold">承認者: {reviewer.displayName}{reviewer.positionName ? `(${reviewer.positionName})` : ''}</p>
        <Button variant="ghost" disabled={busy} onClick={clearReviewer}>別のタグを読む</Button>
      </div> : <p role="status" className="text-sm">{verifying ? '承認者を確認中…' : '承認者の社員タグをかざしてください'}</p>}
      <label className="block text-sm">コメント(任意)<textarea aria-label="コメント(任意)" maxLength={500} value={comment} disabled={busy} onChange={event => setComment(event.target.value)} className="mt-1 min-h-20 w-full rounded border border-slate-400 p-2" /></label>
    </div> : null}
    {tagError || (publishFailed && error) ? <p role="alert" className="mt-3 text-sm text-red-700">{tagError || error}</p> : null}
    <div className="mt-4 flex justify-end gap-2">
      <Button variant="ghost" disabled={busy} onClick={onClose}>キャンセル</Button>
      <Button data-kiosk-sop-target="assembly-document-editor-publish-confirm" className="min-h-11" disabled={busy || verifying || (method === 'tag' && !reviewer)} onClick={() => void submit()}>{method === 'tag' ? '承認して公開する' : '公開する'}</Button>
    </div>
  </Dialog>;
}
