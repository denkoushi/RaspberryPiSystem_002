import { useMemo } from 'react';

import { buildTorqueTrainingMatrix } from './torqueTrainingMenuMatrix';
import { presentTorqueTrainingSetupReason } from './torqueTrainingWrenchPreparation';

import type { TorqueTrainingProgramApi, TorqueTrainingProgramVersionApi } from '../../../api/client';

export type TorqueTrainingProgramMatrixProps = {
  programs: TorqueTrainingProgramApi[];
  selectedVersionId: string;
  /** タグ前など、まだ選べない間は薄く表示する。 */
  disabled: boolean;
  onSelect: (versionId: string) => void;
};

function cellLabel(version: TorqueTrainingProgramVersionApi): string {
  if (version.setupState === 'READY') return version.displayName;
  return `${version.displayName}（${presentTorqueTrainingSetupReason(version.setupStateReason) ?? '対応レンチ未登録'}）`;
}

/** 訓練メニューを「材質 × 呼び径」の表で選ばせる。 */
export function TorqueTrainingProgramMatrix({ programs, selectedVersionId, disabled, onSelect }: TorqueTrainingProgramMatrixProps) {
  const matrix = useMemo(
    () => buildTorqueTrainingMatrix(programs.flatMap((program) => program.versions)),
    [programs]
  );

  if (matrix.rows.length === 0) {
    return <p className="text-base text-white/60">訓練メニューがありません</p>;
  }

  return (
    <section className="min-w-0" aria-label="訓練メニュー" data-testid="torque-training-program-matrix">
      <h3 className="mb-2 text-base font-bold text-white/60">メニュー</h3>
      <div className="overflow-x-auto">
        <div
          className="grid w-max items-center gap-2"
          style={{ gridTemplateColumns: `7rem repeat(${matrix.columns.length}, 5.5rem)` }}
        >
          {matrix.rows.map((row) => (
            <div key={row.key} className="contents">
              <div className="min-w-0 pr-2">
                <p className="truncate text-base font-bold" title={row.material}>{row.material}</p>
                <p className="truncate text-sm text-white/60">{row.strengthClass}</p>
              </div>
              {row.cells.map((version, index) => {
                const column = matrix.columns[index]!;
                if (!version) return <span key={column.key} aria-hidden="true" />;
                const ready = version.setupState === 'READY';
                const selected = version.id === selectedVersionId;
                const cellTone = selected
                  ? 'border-cyan-300 bg-cyan-300 text-slate-900'
                  : ready
                    ? 'border-white/20 bg-slate-800 text-white hover:border-cyan-300/70'
                    : 'border-dashed border-white/20 bg-transparent text-white/40';
                return (
                  <button
                    key={version.id}
                    type="button"
                    className={`grid h-16 place-content-center rounded border text-center disabled:cursor-not-allowed ${cellTone} ${disabled && ready ? 'opacity-45' : ''}`}
                    aria-label={cellLabel(version)}
                    aria-pressed={selected}
                    title={cellLabel(version)}
                    disabled={disabled || !ready}
                    onClick={() => onSelect(version.id)}
                  >
                    <span className="text-2xl font-bold leading-tight">{version.nominalDiameter}</span>
                    <span className={`text-xs ${selected ? 'text-slate-900' : 'text-white/60'}`}>
                      {ready ? `首下${version.boltLengthMm}` : '使用不可'}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
