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
  const identity = [
    { key: 'fseiban', label: '製番', value: identityValue(row.fseiban) },
    { key: 'machine-name', label: '機種名', value: identityValue(row.machineName) },
    { key: 'fhinmei', label: '品名', value: identityValue(row.fhinmei) }
  ] as const;

  return (
    <div
      data-testid="self-inspection-item-identity"
      className="grid min-w-0 grid-cols-[30%_30%_40%] items-center"
    >
      {identity.map((item) => (
        <span
          key={item.key}
          data-testid={`self-inspection-item-identity-${item.key}`}
          className="block min-w-0 truncate whitespace-nowrap text-[21px] leading-[25px] text-white"
          title={item.value}
          aria-label={`${item.label} ${item.value}`}
        >
          {item.value}
        </span>
      ))}
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
  const stateIntentLabel = `${row.statusLabel} / ${row.intentLabel}`;
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
          <div className="grid min-w-0 grid-cols-[46%_16%_38%] items-center">
            <p
              data-testid="self-inspection-item-metadata"
              className="min-w-0 truncate whitespace-nowrap text-xs text-white/60"
              title={row.metadataLine}
              aria-label={row.metadataLine}
            >
              {row.metadataLine}
            </p>
            <p
              data-testid="self-inspection-item-state"
              className="flex min-w-0 items-center gap-1 truncate whitespace-nowrap px-1 text-xs text-white/75"
              title={stateIntentLabel}
              aria-label={stateIntentLabel}
            >
              <span className={clsx('inline-flex max-w-full shrink-0 truncate rounded px-1 py-0.5 font-semibold', toneClassNames[row.statusTone])}>
                {row.statusLabel}
              </span>
              <span className="min-w-0 truncate">{row.intentLabel}</span>
            </p>
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
