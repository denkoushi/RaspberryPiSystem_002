import clsx from 'clsx';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { AssemblyKeypad } from './AssemblyKeypad';
import { kioskAssemblyLibraryPath } from './assemblyRoutes';

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
  workIdMode: 'auto' | 'manual';
  onWorkIdModeChange: (mode: 'auto' | 'manual') => void;
  serialDraft: string;
  serialNos: string[];
  expectedLotQuantity: number | null;
  serialDraftDuplicate: boolean;
  onSerialDraftChange: (value: string) => void;
  onSerialKey: (key: string) => void;
  onSerialBackspace: () => void;
  onSerialClear: () => void;
  onSerialAdd: () => void;
  onSerialRemove: (serialNo: string) => void;
  autoLotQty: number | null;
  onAdjustLotQty: (delta: -1 | 1) => void;
  manualLotQtyDraft: string;
  onManualLotQtyDraftChange: (value: string) => void;
  lotQtyLoading: boolean;
  canRegisterLot: boolean;
  busy: boolean;
  onRegisterLot: () => void;
};

const FIELD =
  'w-full rounded-lg border border-[#2c3742] bg-[#0f1317] px-3 font-mono font-semibold text-[#eef3f6] placeholder:font-sans placeholder:text-[#617080] focus:border-[#35d6ae] focus:outline-none disabled:opacity-60';
const STEP =
  'inline-flex h-9 w-9 items-center justify-center rounded-md bg-[#1f2730] text-lg font-bold text-[#eef3f6] hover:bg-[#2a343f] disabled:opacity-40';
const QUIET = 'inline-flex min-h-9 items-center rounded-md px-2.5 text-[0.8125rem] font-bold text-[#97a5b2] hover:bg-[#1f2730] hover:text-[#eef3f6] disabled:opacity-50';

export function AssemblyLotRegisterRail({
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
  workIdMode,
  onWorkIdModeChange,
  serialDraft,
  serialNos,
  expectedLotQuantity,
  serialDraftDuplicate,
  onSerialDraftChange,
  onSerialKey,
  onSerialBackspace,
  onSerialClear,
  onSerialAdd,
  onSerialRemove,
  autoLotQty,
  onAdjustLotQty,
  manualLotQtyDraft,
  onManualLotQtyDraftChange,
  lotQtyLoading,
  canRegisterLot,
  busy,
  onRegisterLot
}: Props) {
  const [padTarget, setPadTarget] = useState<'fseiban' | 'serial'>('fseiban');
  const manual = workIdMode === 'manual';
  const serialLimitReached = expectedLotQuantity != null && serialNos.length >= expectedLotQuantity;
  const serialInputLocked = busy || !manual || expectedLotQuantity == null || serialLimitReached;
  const serialAddDisabled = serialInputLocked || !serialDraft || serialDraftDuplicate;
  const needsManualLotQty = !!selectedCandidate && !lotQtyLoading && autoLotQty == null;
  const padForSerial = manual && padTarget === 'serial';
  const hasTemplate = !!selectedCandidate?.activeTemplate;

  return (
    <aside
      aria-labelledby="assembly-lot-register-heading"
      className="flex min-h-[30rem] min-w-0 flex-col gap-2.5 overflow-hidden border-l border-[#27313b] bg-[#161c22] px-3.5 py-3 text-[0.9375rem] leading-tight text-[#eef3f6] xl:min-h-0 xl:pb-[4.5rem]"
    >
      <h2 id="assembly-lot-register-heading" className="shrink-0 text-sm font-black tracking-widest text-[#9fadb9]">
        ロット登録
      </h2>

      <input
        aria-label="製番"
        value={fseibanInput}
        placeholder="製番"
        disabled={busy}
        className={clsx(FIELD, 'h-11 shrink-0 text-[1.375rem] tracking-wide')}
        onFocus={() => setPadTarget('fseiban')}
        onChange={(event) => onFseibanInputChange(event.target.value)}
      />

      <div className="flex min-h-0 shrink flex-col gap-1 overflow-y-auto" aria-label="製番候補">
        {normalizedFseiban.length === 0 ? null : candidateLoading && candidates.length === 0 ? (
          <p className="text-sm text-[#617080]">検索中</p>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-[#617080]">候補なし</p>
        ) : (
          candidates.map((candidate) => {
            const selected = selectedCandidate?.fseiban === candidate.fseiban;
            return (
              <button
                key={candidate.fseiban}
                type="button"
                disabled={busy}
                aria-pressed={selected}
                className={clsx(
                  'grid min-h-10 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-md border px-2.5 py-1 text-left',
                  selected ? 'border-[#35d6ae] bg-[#35d6ae]/10' : 'border-transparent bg-[#1f2730] hover:border-[#2c3742]'
                )}
                onClick={() => onSelectCandidate(candidate)}
              >
                <span className="font-mono text-sm font-semibold tabular-nums">{candidate.fseiban}</span>
                <span className="min-w-0 break-words text-sm font-bold" title={candidate.machineName}>
                  {candidate.machineName}
                </span>
                {candidate.activeTemplate ? <span aria-hidden="true" /> : (
                  <span className="text-xs font-bold text-[#ff7d61]">手順なし</span>
                )}
              </button>
            );
          })
        )}
      </div>

      {selectedCandidate ? (
        <div className="grid shrink-0 gap-2 border-t border-[#27313b] pt-2.5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
            <p className="min-w-0 break-words text-[0.9375rem] font-bold" title={selectedCandidate.machineName}>
              {selectedCandidate.machineName}
            </p>
            <div className="row-span-2 text-right">
              {lotQtyLoading ? (
                <span className="text-sm text-[#617080]">取得中…</span>
              ) : needsManualLotQty ? (
                <input
                  aria-label="ロット数（手入力）"
                  value={manualLotQtyDraft}
                  inputMode="numeric"
                  placeholder="台数"
                  disabled={busy}
                  className={clsx(FIELD, 'h-10 w-20 text-center text-xl')}
                  onChange={(event) => onManualLotQtyDraftChange(event.target.value)}
                />
              ) : (
                <div className="flex items-center gap-1">
                  <button type="button" className={STEP} aria-label="台数を減らす" disabled={busy || (expectedLotQuantity ?? 1) <= 1} onClick={() => onAdjustLotQty(-1)}>
                    −
                  </button>
                  <span className="min-w-11 text-center font-mono text-xl font-semibold tabular-nums" aria-label="台数">
                    {expectedLotQuantity}
                  </span>
                  <button type="button" className={STEP} aria-label="台数を増やす" disabled={busy || (expectedLotQuantity ?? 500) >= 500} onClick={() => onAdjustLotQty(1)}>
                    ＋
                  </button>
                </div>
              )}
            </div>
            <p className={clsx('truncate text-[0.8125rem]', hasTemplate ? 'text-[#97a5b2]' : 'font-bold text-[#ff7d61]')}>
              {selectedCandidate.activeTemplate?.name ?? '手順なし'}
              {autoLotQty != null && expectedLotQuantity !== autoLotQty ? (
                <span className="ml-2 font-bold text-[#f6b93b]">実績 {autoLotQty}台</span>
              ) : null}
            </p>
          </div>

          {hasTemplate ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-baseline gap-2.5 font-mono text-[0.8125rem] tabular-nums text-[#97a5b2]">
                  <span className="shrink-0">
                    {manual ? '入力済み' : '発行予定'} {serialNos.length}/{expectedLotQuantity ?? '-'}
                  </span>
                  {!manual && serialNos.length > 0 ? (
                    <span className="min-w-0 truncate" title={serialNos.join(' ')}>
                      {serialNos[0]}
                      {serialNos.length > 1 ? ` … ${serialNos[serialNos.length - 1]}` : ''}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={clsx(QUIET, 'shrink-0 whitespace-nowrap', manual && 'bg-[#1f2730] text-[#eef3f6]')}
                  aria-pressed={manual}
                  disabled={busy}
                  onClick={() => {
                    setPadTarget(manual ? 'fseiban' : 'serial');
                    onWorkIdModeChange(manual ? 'auto' : 'manual');
                  }}
                >
                  ID手入力
                </button>
              </div>

              {manual ? (
                <div className="grid gap-2">
                  <div className="flex gap-2">
                    <input
                      aria-label="作業用ID追加"
                      value={serialDraft}
                      placeholder="作業用ID"
                      disabled={serialInputLocked}
                      className={clsx(FIELD, 'h-9 text-base')}
                      onFocus={() => setPadTarget('serial')}
                      onChange={(event) => onSerialDraftChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !serialAddDisabled) {
                          event.preventDefault();
                          onSerialAdd();
                        }
                      }}
                    />
                    <button type="button" className={clsx(QUIET, 'shrink-0 whitespace-nowrap border border-[#2c3742]')} disabled={serialAddDisabled} onClick={onSerialAdd}>
                      追加
                    </button>
                  </div>
                  {serialDraftDuplicate ? <p className="text-sm font-bold text-[#ff7d61]">同じIDは登録できません</p> : null}
                  <ul className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto" aria-label="作業用ID">
                    {serialNos.map((serialNo) => (
                      <li key={serialNo}>
                        <button
                          type="button"
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-[#1f2730] px-2 font-mono text-sm tabular-nums hover:bg-[#2a343f]"
                          disabled={busy}
                          aria-label={`${serialNo} を削除`}
                          onClick={() => onSerialRemove(serialNo)}
                        >
                          {serialNo}
                          <span aria-hidden="true" className="text-[#617080]">×</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <button
                type="button"
                className="h-11 rounded-md bg-[#35d6ae] text-base font-black tracking-widest text-[#04221b] hover:bg-[#5fe3c2] disabled:cursor-not-allowed disabled:bg-[#1f2730] disabled:text-[#617080]"
                disabled={!canRegisterLot || busy}
                onClick={onRegisterLot}
              >
                {busy ? '登録中…' : expectedLotQuantity != null ? `${expectedLotQuantity}台 登録` : '登録'}
              </button>
            </>
          ) : (
            <Link
              to={kioskAssemblyLibraryPath({ focus: 'procedures' })}
              className="inline-flex h-11 items-center justify-center rounded-md border border-[#2c3742] bg-[#1f2730] text-base font-bold hover:bg-[#2a343f]"
            >
              手順を作る
            </Link>
          )}
        </div>
      ) : null}

      <div className="mt-auto shrink-0">
        <AssemblyKeypad
          ariaLabel={padForSerial ? '作業用ID入力パッド' : '製番入力パッド'}
          disabled={padForSerial ? serialInputLocked : busy}
          onKey={padForSerial ? onSerialKey : onFseibanKey}
          onBackspace={padForSerial ? onSerialBackspace : onFseibanBackspace}
          onClear={padForSerial ? onSerialClear : onFseibanClear}
        />
      </div>
    </aside>
  );
}
