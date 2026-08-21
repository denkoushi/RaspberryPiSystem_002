import clsx from 'clsx';
import { Link } from 'react-router-dom';

import { buttonClassName } from '../../components/ui/Button';
import {
  kioskDenseTableRowActionStructureClassName,
  kioskDenseTableRowActionsClassName
} from '../kiosk/kioskTableDensity';
import { kioskButtonPrimaryClassName } from '../kiosk/kioskTheme';

import type { SelfInspectionTableRow } from './selfInspectionTableModel';

type Props = {
  row: SelfInspectionTableRow;
  onCandidateSelect: (id: string) => void;
  onInvalidate: (row: SelfInspectionTableRow) => void;
};

const toneClassNames: Record<SelfInspectionTableRow['statusTone'], string> = {
  danger: 'bg-red-400/20 text-red-100',
  attention: 'bg-amber-400/25 text-amber-100',
  neutral: 'bg-slate-500/35 text-white/80'
};

function identityValue(value: string | null | undefined): string {
  return value?.trim() || '—';
}

function SelfInspectionIdentity({ row }: { row: SelfInspectionTableRow }) {
  return (
    <div
      data-testid="self-inspection-item-identity"
      className="grid min-w-0 grid-cols-[minmax(0,auto)_minmax(0,1.2fr)_minmax(0,1fr)_auto] items-center gap-x-[1ch]"
    >
      <span
        data-testid="self-inspection-item-identity-fseiban"
        className="block min-w-0 truncate whitespace-nowrap text-[21px] leading-[25px] text-white"
        title={identityValue(row.fseiban)}
        aria-label={`製番 ${identityValue(row.fseiban)}`}
      >
        {identityValue(row.fseiban)}
      </span>
      <span
        data-testid="self-inspection-item-identity-machine-name"
        className="block min-w-0 truncate whitespace-nowrap text-[15.75px] leading-[25px] text-white"
        title={identityValue(row.machineName)}
        aria-label={`機種名 ${identityValue(row.machineName)}`}
      >
        {identityValue(row.machineName)}
      </span>
      <span
        data-testid="self-inspection-item-identity-fhinmei"
        className="block min-w-0 truncate whitespace-nowrap text-[21px] leading-[25px] text-white"
        title={identityValue(row.fhinmei)}
        aria-label={`品名 ${identityValue(row.fhinmei)}`}
      >
        {identityValue(row.fhinmei)}
      </span>
      <span
        data-testid="self-inspection-item-state"
        className="inline-flex min-w-0 shrink-0 items-center justify-self-end whitespace-nowrap text-xs text-white/75"
        title={row.statusLabel}
        aria-label={`状態 ${row.statusLabel}`}
      >
        <span className={clsx('inline-flex shrink-0 rounded px-1 py-0.5 font-semibold', toneClassNames[row.statusTone])}>
          {row.statusLabel}
        </span>
      </span>
    </div>
  );
}

function SelfInspectionActions({
  row,
  onCandidateSelect,
  onInvalidate
}: Props) {
  return (
    <div
      className={kioskDenseTableRowActionsClassName}
      data-testid="self-inspection-row-actions"
      aria-label="操作"
    >
      {row.kind === 'session'
        ? row.actions.map((action, index) => {
            const hasPrimary = row.actions.some((candidate) => candidate.tone === 'primary');
            const isPrimary = hasPrimary ? row.actions.findIndex((candidate) => candidate.tone === 'primary') === index : false;
            return (
              <Link
                key={`${action.href}:${action.label}`}
                to={action.href}
                className={buttonClassName(
                  isPrimary ? 'primary' : 'ghostOnDark',
                  clsx(
                    isPrimary ? kioskButtonPrimaryClassName : undefined,
                    kioskDenseTableRowActionStructureClassName,
                    'text-sm'
                  )
                )}
                title={action.label}
              >
                {action.label}
              </Link>
            );
          })
        : (
            <button
              type="button"
              className={clsx(kioskButtonPrimaryClassName, kioskDenseTableRowActionStructureClassName, 'text-sm')}
              onClick={() => onCandidateSelect(row.id)}
              title={row.action.label}
            >
              {row.action.label}
            </button>
          )}
      <button
        type="button"
        className={clsx(
          kioskDenseTableRowActionStructureClassName,
          'border border-rose-300/50 bg-rose-500/15 text-sm font-semibold text-rose-100 hover:bg-rose-500/25'
        )}
        onClick={() => onInvalidate(row)}
        title="削除"
      >
        削除
      </button>
    </div>
  );
}

export function SelfInspectionTableItem({ row, onCandidateSelect, onInvalidate }: Props) {
  return (
    <>
      <tr
        data-testid="self-inspection-item-primary-row"
        className="h-[43.3px] border-t border-white/15 bg-slate-900/45 align-middle"
      >
        <td colSpan={4} className="h-[43.3px] px-2 py-1.5 align-middle">
          <SelfInspectionIdentity row={row} />
        </td>
      </tr>
      <tr
        data-testid="self-inspection-item-secondary-row"
        className="h-[51px] border-b border-white/15 bg-slate-950/25"
      >
        <td colSpan={4} className="h-[51px] px-2 py-1 align-middle">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_38%] items-center">
            <div
              data-testid="self-inspection-item-metadata"
              className="min-w-0 overflow-hidden"
              aria-label={`${row.metadataPrimaryLine} / ${row.metadataSecondaryLine}`}
            >
              <p
                data-testid="self-inspection-item-metadata-primary"
                className="min-w-0 truncate whitespace-nowrap text-xs leading-4 text-white"
                title={row.metadataPrimaryLine}
                aria-label={row.metadataPrimaryLine}
              >
                {row.metadataPrimaryLine}
              </p>
              <p
                data-testid="self-inspection-item-metadata-secondary"
                className="min-w-0 truncate whitespace-nowrap text-xs leading-4 text-white"
                title={row.metadataSecondaryLine}
                aria-label={row.metadataSecondaryLine}
              >
                {row.metadataSecondaryLine}
              </p>
            </div>
            <SelfInspectionActions
              row={row}
              onCandidateSelect={onCandidateSelect}
              onInvalidate={onInvalidate}
            />
          </div>
        </td>
      </tr>
    </>
  );
}
