import { Link } from 'react-router-dom';

import { buttonClassName } from '../../components/ui/Button';

import { KIOSK_ASSEMBLY_HOME_PATH } from './assemblyRoutes';

export type AssemblyWorkSessionHeaderProps = {
  productNo: string;
  modelCode: string;
  procedurePattern: string;
  /** 「要領書」or「手順書」など、左ペイン見出しから統合したモード文言 */
  procedureModeLabel: string;
  currentPositionLabel: string;
  requiredCheckLabel: string | null;
};

/**
 * オペレータ向け組立作業画面の1行ヘッダー。
 * 管理導線（テンプレ編集・Excel）は置かない。表示専用。
 */
export function AssemblyWorkSessionHeader({
  productNo,
  modelCode,
  procedurePattern,
  procedureModeLabel,
  currentPositionLabel,
  requiredCheckLabel
}: AssemblyWorkSessionHeaderProps) {
  return (
    <header className="grid shrink-0 grid-cols-[minmax(0,auto)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0 rounded border border-white/15 bg-slate-900/70 px-2 py-1">
      <div className="flex min-w-0 items-baseline gap-2 overflow-hidden whitespace-nowrap">
        <h1 className="shrink-0 text-[0.95rem] font-bold leading-none">組立作業</h1>
        <p className="min-w-0 truncate text-xs text-white/60" title={`${productNo} / ${modelCode} / ${procedurePattern}`}>
          {productNo} / {modelCode} / {procedurePattern}
        </p>
      </div>
      <div className="flex min-w-0 items-center gap-x-2 overflow-hidden whitespace-nowrap text-xs text-white/60">
        <span className="shrink-0">{procedureModeLabel}</span>
        <span className="h-3 w-px shrink-0 bg-white/15" aria-hidden="true" />
        <span className="min-w-0 truncate" title={currentPositionLabel}>
          現在 <span className="font-semibold text-white">{currentPositionLabel}</span>
        </span>
        {requiredCheckLabel ? (
          <>
            <span className="h-3 w-px shrink-0 bg-white/15" aria-hidden="true" />
            <span className="shrink-0 font-semibold text-lime-200">{requiredCheckLabel}</span>
          </>
        ) : null}
      </div>
      <div className="shrink-0">
        <Link
          to={KIOSK_ASSEMBLY_HOME_PATH}
          className={buttonClassName('ghostOnDark', 'inline-flex min-h-8 items-center !px-2.5 !py-0 text-xs')}
        >
          組立トップ
        </Link>
      </div>
    </header>
  );
}
