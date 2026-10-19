import { useEffect, useMemo, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Input } from '../../components/ui/Input';

import { formatAssemblyEditorName } from './assemblyTemplateGuidePresentation';
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const activeGroups = useMemo(() => groups.filter((group) => group.isActive), [groups]);
  const selectedCatalogGroup =
    activeGroups.find((group) => group.id === selectedGroupId) ?? null;
  const currentGroup =
    selectedCatalogGroup &&
    doesCapabilityGroupMatchAssemblyBoltCondition(selectedCatalogGroup, storedCondition)
      ? selectedCatalogGroup
      : null;
  const filteredGroups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return activeGroups;
    return activeGroups.filter((group) =>
      `${group.name} ${group.nominalDiameter} ${group.boltLengthMm} ${group.material} ${group.strengthClass}`
        .toLocaleLowerCase()
        .includes(normalized)
    );
  }, [activeGroups, query]);

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
      className="min-w-0 rounded border border-cyan-300/20 bg-cyan-950/20 p-2"
      aria-label="適合トルクレンチグループ"
    >
      <div className="text-[0.68rem] font-semibold text-white/70">
        適合トルクレンチグループ
      </div>
      {currentGroup ? (
        <div className="mt-1 min-w-0 rounded border border-emerald-300/20 bg-emerald-950/25 p-2">
          <div className="truncate text-xs font-bold text-emerald-100" title={currentGroup.name}>
            {formatAssemblyEditorName(currentGroup.name)}
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
        <div className="mt-1 text-[0.68rem] text-white/55">未選択</div>
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
        <>
          <Button
            type="button"
            variant="secondary"
            className="mt-2 min-h-11 w-full min-w-0 !px-2 text-left text-xs"
            disabled={disabled || catalogStatus === 'loading'}
            aria-haspopup="dialog"
            aria-expanded={dialogOpen}
            onClick={() => setDialogOpen(true)}
          >
            {currentGroup ? '別のグループを選択' : '適合グループを選択'}
          </Button>
          <Dialog
            isOpen={dialogOpen}
            onClose={() => setDialogOpen(false)}
            title="適合トルクレンチグループを選択"
            description="締結条件に合う有効グループを検索して選択してください。"
            size="lg"
          >
            <div className="mt-3 grid min-w-0 gap-3">
              <Input
                aria-label="適合トルクレンチグループを検索"
                value={query}
                placeholder="グループ名・締結条件で検索"
                className="min-h-11 text-sm"
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
              />
              <div className="grid max-h-[55vh] min-w-0 gap-1 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2">
                {filteredGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      className="min-w-0 rounded border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900 hover:border-cyan-500 hover:bg-cyan-50"
                      onClick={() => {
                        if (disabled) return;
                        onSelect(group);
                        setQuery('');
                        setDialogOpen(false);
                      }}
                    >
                      <span className="block break-words font-bold">{group.name}</span>
                      <span className="mt-1 block break-words text-xs text-slate-600">{conditionLabel(group)}（{group.models.length}型番）</span>
                    </button>
                  ))}
                {filteredGroups.length === 0 ? <p className="p-2 text-sm text-slate-600">一致する有効グループがありません</p> : null}
              </div>
              <div className="flex justify-end">
                <Button type="button" variant="secondary" className="min-h-11" onClick={() => setDialogOpen(false)}>閉じる</Button>
              </div>
            </div>
          </Dialog>
        </>
      )}
    </section>
  );
}
