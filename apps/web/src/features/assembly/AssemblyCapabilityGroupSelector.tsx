import { useEffect, useMemo, useState } from 'react';

import {
  KioskFilterCombobox,
  type KioskFilterOption
} from '../../components/kiosk/KioskFilterCombobox';
import { Button } from '../../components/ui/Button';

import { doesCapabilityGroupMatchAssemblyBoltCondition } from './assemblyTemplateInputAssistance';

import type { TorqueWrenchCapabilityGroupApi } from '../../api/domains/torque-wrenches';

type Props = {
  boltId: string;
  selectedGroupId: string | null;
  storedCondition: {
    nominalDiameter?: string | null;
    boltLengthMm?: number | null;
    material?: string | null;
    strengthClass?: string | null;
  };
  groups: TorqueWrenchCapabilityGroupApi[];
  catalogStatus: 'loading' | 'ready' | 'error';
  disabled: boolean;
  onSelect: (group: TorqueWrenchCapabilityGroupApi) => void;
  onRetry: () => void;
};

const conditionLabel = (group: TorqueWrenchCapabilityGroupApi): string =>
  `${group.nominalDiameter} / ${group.boltLengthMm}mm / ${group.material} / ${group.strengthClass}`;

export function AssemblyCapabilityGroupSelector({
  boltId,
  selectedGroupId,
  storedCondition,
  groups,
  catalogStatus,
  disabled,
  onSelect,
  onRetry
}: Props) {
  const [query, setQuery] = useState('');
  const activeGroups = useMemo(() => groups.filter((group) => group.isActive), [groups]);
  const selectedCatalogGroup =
    activeGroups.find((group) => group.id === selectedGroupId) ?? null;
  const currentGroup =
    selectedCatalogGroup &&
    doesCapabilityGroupMatchAssemblyBoltCondition(selectedCatalogGroup, storedCondition)
      ? selectedCatalogGroup
      : null;
  const options = useMemo<KioskFilterOption[]>(
    () =>
      activeGroups.map((group) => ({
        value: group.id,
        label: `${group.name} — ${conditionLabel(group)}（${group.models.length}型番）`,
        searchText: `${group.name} ${group.nominalDiameter} ${group.boltLengthMm} ${group.material} ${group.strengthClass}`.toLocaleLowerCase()
      })),
    [activeGroups]
  );

  useEffect(() => setQuery(''), [boltId]);

  const storedLabel = [
    storedCondition.nominalDiameter || '径未設定',
    storedCondition.boltLengthMm == null ? '長さ未設定' : `${storedCondition.boltLengthMm}mm`,
    storedCondition.material || '材質未設定',
    storedCondition.strengthClass || '強度未設定'
  ].join(' / ');

  return (
    <section
      id={`assembly-bolt-${boltId}-capabilityGroupId`}
      tabIndex={-1}
      className="rounded border border-cyan-300/20 bg-cyan-950/20 p-2"
      aria-label="適合トルクレンチグループ"
    >
      <div className="text-[0.68rem] font-semibold text-white/70">
        適合トルクレンチグループ
      </div>
      {currentGroup ? (
        <div className="mt-1 rounded border border-emerald-300/20 bg-emerald-950/25 p-2">
          <div className="truncate text-xs font-bold text-emerald-100">
            {currentGroup.name}
          </div>
          <div className="mt-0.5 break-words text-[0.68rem] text-white/70">
            {conditionLabel(currentGroup)}
          </div>
        </div>
      ) : selectedGroupId ? (
        <div className="mt-1 rounded border border-amber-300/25 bg-amber-950/30 p-2 text-[0.68rem] text-amber-100">
          {selectedCatalogGroup
            ? '現在のグループと保存済み締結条件が一致しません。'
            : '現在のグループは利用できません。'}{' '}
          保存値: {storedLabel}
        </div>
      ) : (
        <p className="mt-1 text-[0.68rem] text-amber-100">
          グループを選ぶと径・長さ・材質・強度区分を一括設定します。
        </p>
      )}

      {catalogStatus === 'error' ? (
        <Button
          type="button"
          variant="ghostOnDark"
          className="mt-2 min-h-10 w-full !px-2 text-xs"
          disabled={disabled}
          onClick={onRetry}
        >
          適合グループを再読込
        </Button>
      ) : (
        <KioskFilterCombobox
          ariaLabel="適合トルクレンチグループを検索"
          value={query}
          placeholder={currentGroup ? '別のグループを検索' : 'グループ名・締結条件で検索'}
          options={options}
          loading={catalogStatus === 'loading'}
          disabled={disabled}
          optionUpdateMode="live"
          emptyMessage="一致する有効グループがありません"
          className={disabled ? 'mt-2 opacity-60' : 'mt-2'}
          inputClassName="h-10 text-sm"
          onChange={setQuery}
          onSelect={(groupId) => {
            const group = activeGroups.find((candidate) => candidate.id === groupId);
            if (!group || disabled) return;
            onSelect(group);
            setQuery('');
          }}
        />
      )}
    </section>
  );
}
