import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';

import { uploadMachineSignalReports } from '../../../api/client';
import { getApiErrorMessage } from '../../../api/errors';
import { useInvalidateMachineSignal, useMachineSignalImportRuns } from '../../../api/hooks';
import { planSignalUpload } from '../machineSignalAdminModel';

type Progress = { done: number; total: number; imported: number; failed: number; ignored: number; failures: string[] };

type Entry = {
  isFile: boolean;
  isDirectory: boolean;
  file?: (resolve: (file: File) => void, reject: (error: unknown) => void) => void;
  createReader?: () => { readEntries: (resolve: (entries: Entry[]) => void, reject: (error: unknown) => void) => void };
};

/** 置かれたフォルダの中身を、下の階層までたどってファイルにする。 */
async function filesFromEntry(entry: Entry): Promise<File[]> {
  if (entry.isFile && entry.file) {
    const read = entry.file.bind(entry);
    return [await new Promise<File>((resolve, reject) => read(resolve, reject))];
  }
  if (!entry.isDirectory || !entry.createReader) return [];
  const reader = entry.createReader();
  const files: File[] = [];
  for (;;) {
    // readEntries は一度に全部を返さないので、空になるまで読む。
    const batch = await new Promise<Entry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    for (const child of batch) files.push(...(await filesFromEntry(child)));
  }
  return files;
}

async function filesFromDrop(transfer: DataTransfer): Promise<File[]> {
  const entries: Entry[] = [];
  for (const item of Array.from(transfer.items ?? [])) {
    const entry = (item as unknown as { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return Array.from(transfer.files ?? []);
  const nested = await Promise.all(entries.map(filesFromEntry));
  return nested.flat();
}

const RESULT_LABELS: Record<string, string> = { SUCCESS: '成功', PARTIAL: '一部失敗', FAILED: '失敗' };

/** 過去分の取り込み。日付フォルダを置くか選ぶと、日報だけを50件ずつ送る。 */
export function ImportSheet({ onClose }: { onClose: () => void }) {
  const runs = useMachineSignalImportRuns();
  const invalidate = useInvalidateMachineSignal();
  const folderInput = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    // フォルダごと選べるようにする（React の型に無い属性なので直接付ける）。
    folderInput.current?.setAttribute('webkitdirectory', '');
  }, []);

  const upload = async (files: File[]) => {
    if (files.length === 0 || uploading) return;
    const plan = planSignalUpload(files);
    const total = plan.batches.reduce((sum, batch) => sum + batch.length, 0);
    let current: Progress = { done: 0, total, imported: 0, failed: 0, ignored: plan.ignored, failures: [] };
    setProgress(current);
    setError(null);
    setUploading(true);
    try {
      for (const batch of plan.batches) {
        const run = await uploadMachineSignalReports(batch);
        current = {
          ...current,
          done: current.done + batch.length,
          imported: current.imported + run.importedCount,
          failed: current.failed + run.failedCount,
          failures: [...current.failures, ...run.failures.map((failure) => `${failure.fileName}: ${failure.reason}`)].slice(0, 10)
        };
        setProgress(current);
      }
    } catch (uploadError) {
      setError(getApiErrorMessage(uploadError, '取り込みに失敗しました'));
    } finally {
      setUploading(false);
      void invalidate();
    }
  };

  return (
    <div
      className="veil"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !uploading) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="msa-import-title">
        <h2 id="msa-import-title">
          過去分を取り込む
          <button className="link" type="button" onClick={onClose} disabled={uploading}>
            閉じる
          </button>
        </h2>
        <div
          className={clsx('drop', over && 'over')}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            void filesFromDrop(event.dataTransfer).then(upload);
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M12 16v-6M9.5 12.5 12 10l2.5 2.5" />
          </svg>
          <strong>日付フォルダをここへ</strong>
          <button className="btn pri" type="button" disabled={uploading} onClick={() => folderInput.current?.click()}>
            フォルダを選ぶ
          </button>
          <input
            ref={folderInput}
            type="file"
            multiple
            hidden
            aria-label="取り込むフォルダ"
            onChange={(event) => {
              void upload(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
          <span className="note">同じセンサー・同じ日付は上書き</span>
        </div>

        {progress ? (
          <div role="status">
            <div className="prog">
              <i style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 100}%` }} />
            </div>
            <p className="note num" style={{ margin: '6px 0 0' }}>
              {progress.done} / {progress.total} 件 ・ 取り込み {progress.imported} ・ 失敗 {progress.failed} ・ 対象外 {progress.ignored}
            </p>
            {progress.failures.map((failure) => (
              <p key={failure} className="err" style={{ margin: '2px 0 0', fontWeight: 500 }}>
                {failure}
              </p>
            ))}
          </div>
        ) : null}
        {error ? (
          <p className="err" role="alert">
            {error}
          </p>
        ) : null}

        <div>
          <h3>取り込み履歴</h3>
          {runs.data && runs.data.length === 0 ? <p className="note">まだ取り込んでいません</p> : null}
          {runs.data && runs.data.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>日時</th>
                  <th>経路</th>
                  <th>結果</th>
                  <th>取り込み</th>
                  <th>失敗</th>
                </tr>
              </thead>
              <tbody>
                {runs.data.slice(0, 6).map((run) => (
                  <tr key={run.id}>
                    <td className="num">{new Date(run.startedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{run.source === 'GMAIL' ? 'Gmail' : 'フォルダ'}</td>
                    <td>{RESULT_LABELS[run.status] ?? run.status}</td>
                    <td className="num">{run.importedCount}</td>
                    <td className="num" title={run.failures.map((failure) => `${failure.fileName}: ${failure.reason}`).join('\n')}>
                      {run.failedCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </div>
  );
}
