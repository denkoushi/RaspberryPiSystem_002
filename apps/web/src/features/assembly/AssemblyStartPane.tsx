import { Link } from 'react-router-dom';

import { Button, buttonClassName } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

import { AssemblyKeypad } from './AssemblyKeypad';
import { KIOSK_ASSEMBLY_LIBRARY_PATH } from './assemblyRoutes';

import type { AssemblySeibanCandidateDto } from './types';

type Props = {
  fseibanInput: string;
  normalizedFseiban: string;
  onFseibanInputChange: (value: string) => void;
  onFseibanKey: (key: string) => void;
  onFseibanBackspace: () => void;
  onFseibanClear: () => void;
  candidates: AssemblySeibanCandidateDto[];
  candidateLoading: boolean;
  selectedCandidate: AssemblySeibanCandidateDto | null;
  onSelectCandidate: (candidate: AssemblySeibanCandidateDto) => void;
  serialNo: string;
  onSerialNoChange: (value: string) => void;
  onSerialKey: (key: string) => void;
  onSerialBackspace: () => void;
  onSerialClear: () => void;
  operatorNameSnapshot: string;
  onOperatorNameChange: (value: string) => void;
  torqueWrenchId: string;
  onTorqueWrenchIdChange: (value: string) => void;
  canStart: boolean;
  busy: boolean;
  onStart: () => void;
};

function candidateClassName(selected: boolean): string {
  return selected
    ? 'grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded border border-cyan-300 bg-cyan-900/45 px-2 py-1.5 text-left'
    : 'grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded border border-white/10 bg-slate-950/55 px-2 py-1.5 text-left hover:bg-slate-800';
}

export function AssemblyStartPane({
  fseibanInput,
  normalizedFseiban,
  onFseibanInputChange,
  onFseibanKey,
  onFseibanBackspace,
  onFseibanClear,
  candidates,
  candidateLoading,
  selectedCandidate,
  onSelectCandidate,
  serialNo,
  onSerialNoChange,
  onSerialKey,
  onSerialBackspace,
  onSerialClear,
  operatorNameSnapshot,
  onOperatorNameChange,
  torqueWrenchId,
  onTorqueWrenchIdChange,
  canStart,
  busy,
  onStart
}: Props) {
  return (
    <aside
      aria-labelledby="assembly-start-pane-heading"
      className="flex min-h-[34rem] min-w-0 flex-col gap-2 overflow-hidden rounded border border-white/15 bg-slate-950/45 p-2 xl:min-h-0"
    >
      <div className="shrink-0">
        <h2 id="assembly-start-pane-heading" className="text-[1.14rem] font-bold leading-tight text-white">
          新規開始
        </h2>
      </div>

      <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto pr-1">
        <section className="grid gap-2 rounded border border-white/10 bg-slate-900/60 p-2">
          <h3 className="text-[0.94rem] font-bold text-white/90">
            製番
          </h3>

          <label className="grid gap-1 text-xs font-semibold text-white/70">
            製番
            <Input
              value={fseibanInput}
              onChange={(event) => onFseibanInputChange(event.target.value)}
              placeholder="製番"
              className="min-h-10 text-[1.05rem] font-bold tracking-normal"
              disabled={busy}
            />
          </label>

          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-white/60">候補</span>
              <span className="text-xs font-semibold text-white/45">{candidateLoading ? '検索中' : `${candidates.length}件`}</span>
            </div>
            {normalizedFseiban.length === 0 ? (
              <p className="rounded border border-white/10 bg-slate-950/45 px-2 py-2 text-xs font-semibold text-white/55">製番を入力</p>
            ) : candidates.length === 0 && !candidateLoading ? (
              <p className="rounded border border-white/10 bg-slate-950/45 px-2 py-2 text-xs font-semibold text-white/55">候補なし</p>
            ) : (
              <div className="grid max-h-32 gap-1 overflow-y-auto">
                {candidates.map((candidate) => {
                  const selected = selectedCandidate?.fseiban === candidate.fseiban;
                  return (
                    <button
                      key={candidate.fseiban}
                      type="button"
                      className={candidateClassName(selected)}
                      onClick={() => onSelectCandidate(candidate)}
                      disabled={busy}
                    >
                      <span className="truncate text-[0.98rem] font-bold text-white">{candidate.fseiban}</span>
                      <span className="truncate text-xs font-semibold text-white/65">{candidate.machineName}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <AssemblyKeypad
            ariaLabel="製番入力パッド"
            disabled={busy}
            onKey={onFseibanKey}
            onBackspace={onFseibanBackspace}
            onClear={onFseibanClear}
          />
        </section>

        <section className="grid gap-2 rounded border border-white/10 bg-slate-900/60 p-2">
          <h3 className="text-[0.94rem] font-bold text-white/90">
            シリアル
          </h3>

          <div className="grid grid-cols-1 gap-2 min-[1500px]:grid-cols-[minmax(0,1fr)_7.5rem]">
            <label className="grid gap-1 text-xs font-semibold text-white/70">
              シリアルNo.
              <Input
                value={serialNo}
                onChange={(event) => onSerialNoChange(event.target.value)}
                placeholder="シリアルNo."
                className="min-h-10 text-[1.05rem] font-bold tracking-normal"
                disabled={busy}
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-white/70">
              作業者
              <Input
                value={operatorNameSnapshot}
                onChange={(event) => onOperatorNameChange(event.target.value)}
                placeholder="作業者"
                className="min-h-10"
                disabled={busy}
              />
            </label>
          </div>

          <AssemblyKeypad
            ariaLabel="シリアル入力パッド"
            disabled={busy}
            onKey={onSerialKey}
            onBackspace={onSerialBackspace}
            onClear={onSerialClear}
          />
        </section>

        <label className="grid gap-1 text-xs font-semibold text-white/70">
          トルクレンチ
          <Input
            value={torqueWrenchId}
            onChange={(event) => onTorqueWrenchIdChange(event.target.value)}
            className="min-h-10 text-[0.98rem] font-bold"
            disabled={busy}
          />
        </label>
      </div>

      <div className="grid shrink-0 gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 bg-slate-900/60 p-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white/55">機種名</p>
            <p className="truncate text-[1.04rem] font-bold text-white">{selectedCandidate?.machineName ?? '未選択'}</p>
          </div>
          <div className="min-w-0 text-right">
            <p className="text-xs font-semibold text-white/55">テンプレート</p>
            <p className={`truncate text-sm font-bold ${selectedCandidate?.activeTemplate ? 'text-emerald-200' : 'text-amber-200'}`}>
              {selectedCandidate ? (selectedCandidate.activeTemplate ? selectedCandidate.activeTemplate.name : 'テンプレート未登録') : '-'}
            </p>
          </div>
        </div>
        <Button type="button" variant="primary" className="min-h-12 w-full text-base" disabled={!canStart || busy} onClick={onStart}>
          {busy ? '開始中…' : '組立開始'}
        </Button>
        {selectedCandidate && !selectedCandidate.activeTemplate ? (
          <Link to={KIOSK_ASSEMBLY_LIBRARY_PATH} className={buttonClassName('ghostOnDark', 'inline-flex min-h-10 items-center justify-center')}>
            テンプレート登録
          </Link>
        ) : null}
      </div>
    </aside>
  );
}
