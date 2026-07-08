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
  operatorNameSnapshot: string;
  onOperatorNameChange: (value: string) => void;
  selectedLotQty: number | null;
  autoLotQty: number | null;
  manualLotQtyDraft: string;
  onManualLotQtyDraftChange: (value: string) => void;
  lotQtyLoading: boolean;
  torqueWrenchId: string;
  onTorqueWrenchIdChange: (value: string) => void;
  canRegisterLot: boolean;
  busy: boolean;
  onRegisterLot: () => void;
};

function candidateClassName(selected: boolean): string {
  return selected
    ? 'grid grid-cols-[auto_minmax(0,1fr)] gap-2 rounded border border-cyan-300 bg-cyan-900/45 px-2 py-1.5 text-left'
    : 'grid grid-cols-[auto_minmax(0,1fr)] gap-2 rounded border border-white/10 bg-slate-950/55 px-2 py-1.5 text-left hover:bg-slate-800';
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
  operatorNameSnapshot,
  onOperatorNameChange,
  selectedLotQty,
  autoLotQty,
  manualLotQtyDraft,
  onManualLotQtyDraftChange,
  lotQtyLoading,
  torqueWrenchId,
  onTorqueWrenchIdChange,
  canRegisterLot,
  busy,
  onRegisterLot
}: Props) {
  const fseibanInputLocked = busy;
  const serialLimitReached = expectedLotQuantity != null && serialNos.length >= expectedLotQuantity;
  const serialInputLocked = busy || expectedLotQuantity == null || serialLimitReached;
  const serialAddDisabled = serialInputLocked || !serialDraft || serialDraftDuplicate;
  const showManualLotQtyInput = !!selectedCandidate && !lotQtyLoading && autoLotQty == null;
  const usingManualLotQty = autoLotQty == null && expectedLotQuantity != null;

  return (
    <aside
      aria-labelledby="assembly-start-pane-heading"
      className="flex min-h-[34rem] min-w-0 flex-col gap-2 overflow-hidden rounded border border-white/15 bg-slate-950/45 p-2 xl:min-h-0"
    >
      <div className="shrink-0">
        <h2 id="assembly-start-pane-heading" className="text-[1.14rem] font-bold leading-tight text-white">
          ロット登録
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
              disabled={fseibanInputLocked}
            />
          </label>

          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-white/60">候補</span>
              <span className="text-xs font-semibold text-white/45">{candidateLoading ? '検索中' : `${candidates.length}件`}</span>
            </div>
            <div className="h-32 overflow-hidden rounded border border-white/10 bg-slate-950/45">
              {normalizedFseiban.length === 0 ? (
                <p className="px-2 py-2 text-xs font-semibold text-white/55">製番を入力</p>
              ) : candidateLoading && candidates.length === 0 ? (
                <p className="px-2 py-2 text-xs font-semibold text-white/55">検索中</p>
              ) : candidates.length === 0 ? (
                <p className="px-2 py-2 text-xs font-semibold text-white/55">候補なし</p>
              ) : (
                <div className="grid h-full content-start gap-1 overflow-y-auto">
                  {candidates.map((candidate) => {
                    const selected = selectedCandidate?.fseiban === candidate.fseiban;
                    return (
                      <button
                        key={candidate.fseiban}
                        type="button"
                        className={candidateClassName(selected)}
                        onClick={() => onSelectCandidate(candidate)}
                        disabled={fseibanInputLocked}
                      >
                        <span className="shrink-0 whitespace-nowrap text-[0.98rem] font-bold tabular-nums text-white">
                          {candidate.fseiban}
                        </span>
                        <span
                          className="min-w-0 truncate text-xs font-semibold text-white/65"
                          title={candidate.machineName}
                        >
                          {candidate.machineName}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <AssemblyKeypad
            ariaLabel="製番入力パッド"
            disabled={fseibanInputLocked}
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
              シリアルNo.追加
              <Input
                value={serialDraft}
                onChange={(event) => onSerialDraftChange(event.target.value)}
                placeholder="シリアルNo."
                className="min-h-10 text-[1.05rem] font-bold tracking-normal"
                disabled={serialInputLocked}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !serialAddDisabled) {
                    event.preventDefault();
                    onSerialAdd();
                  }
                }}
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-white/70">
              作業者
              <Input
                value={operatorNameSnapshot}
                onChange={(event) => onOperatorNameChange(event.target.value)}
                placeholder="作業者（NFCタグでも入力可）"
                className="min-h-10"
                disabled={busy}
              />
            </label>
          </div>

          <AssemblyKeypad
            ariaLabel="シリアル入力パッド"
            disabled={serialInputLocked}
            onKey={onSerialKey}
            onBackspace={onSerialBackspace}
            onClear={onSerialClear}
          />

          <div className="grid gap-2 rounded border border-white/10 bg-slate-950/45 p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-white/60">
                入力済み {serialNos.length}/{expectedLotQuantity ?? '-'}
              </span>
              <Button type="button" variant="ghostOnDark" className="min-h-9 !px-3 !py-0 text-xs" disabled={serialAddDisabled} onClick={onSerialAdd}>
                追加
              </Button>
            </div>
            {selectedCandidate && lotQtyLoading ? (
              <p className="rounded border border-white/10 bg-slate-950/55 px-2 py-1.5 text-xs font-semibold text-white/70">
                ロット数を取得中…
              </p>
            ) : selectedCandidate && expectedLotQuantity == null ? (
              <p className="rounded border border-amber-300/25 bg-amber-500/10 px-2 py-1.5 text-xs font-semibold text-amber-100">
                生産実績からロット数を取得できませんでした。順番ボード等で数量を確認し、ロット数を手入力してください。
              </p>
            ) : serialDraftDuplicate ? (
              <p className="rounded border border-amber-300/25 bg-amber-500/10 px-2 py-1.5 text-xs font-semibold text-amber-100">
                同じシリアルNo.は登録できません。
              </p>
            ) : serialLimitReached ? (
              <p className="rounded border border-cyan-300/25 bg-cyan-500/10 px-2 py-1.5 text-xs font-semibold text-cyan-100">
                ロット数分のシリアルNo.を入力済みです。
              </p>
            ) : null}
            {showManualLotQtyInput ? (
              <label className="grid gap-1 text-xs font-semibold text-white/70">
                ロット数（手入力）
                <Input
                  value={manualLotQtyDraft}
                  onChange={(event) => onManualLotQtyDraftChange(event.target.value)}
                  inputMode="numeric"
                  placeholder="ロット数"
                  className="min-h-10 text-[1.05rem] font-bold tracking-normal"
                  disabled={busy}
                />
              </label>
            ) : null}
            <div className="grid max-h-36 content-start gap-1 overflow-y-auto">
              {serialNos.length === 0 ? (
                <p className="rounded border border-white/10 bg-slate-950/55 px-2 py-3 text-center text-xs font-semibold text-white/50">
                  シリアルNo.未入力
                </p>
              ) : (
                serialNos.map((serialNo, index) => (
                  <div key={serialNo} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded border border-white/10 bg-slate-900/60 px-2 py-1">
                    <span className="text-xs font-bold tabular-nums text-white/45">{index + 1}</span>
                    <span className="truncate text-sm font-bold tabular-nums text-white">{serialNo}</span>
                    <Button
                      type="button"
                      variant="ghostOnDark"
                      className="min-h-8 !px-2 !py-0 text-xs"
                      disabled={busy}
                      onClick={() => onSerialRemove(serialNo)}
                    >
                      削除
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
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
            <p
              className="truncate text-[1.04rem] font-bold text-white"
              title={selectedCandidate?.machineName}
            >
              {selectedCandidate?.machineName ?? '未選択'}
            </p>
          </div>
          <div className="min-w-0 text-right">
            <p className="text-xs font-semibold text-white/55">ロット数</p>
            <p className="truncate text-sm font-bold tabular-nums text-cyan-200">
              {autoLotQty != null && selectedLotQty != null && Number.isFinite(selectedLotQty)
                ? Number.isInteger(selectedLotQty)
                  ? String(selectedLotQty)
                  : selectedLotQty.toLocaleString('ja-JP')
                : usingManualLotQty
                  ? `${expectedLotQuantity}（手入力）`
                  : '-'}
            </p>
          </div>
          <div className="min-w-0 text-right">
            <p className="text-xs font-semibold text-white/55">テンプレート</p>
            <p className={`truncate text-sm font-bold ${selectedCandidate?.activeTemplate ? 'text-emerald-200' : 'text-amber-200'}`}>
              {selectedCandidate ? (selectedCandidate.activeTemplate ? selectedCandidate.activeTemplate.name : 'テンプレート未登録') : '-'}
            </p>
          </div>
        </div>
        <Button type="button" variant="primary" className="min-h-12 w-full text-base" disabled={!canRegisterLot || busy} onClick={onRegisterLot}>
          {busy ? '登録中…' : 'ロット登録'}
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
