import { useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  clearImageMarkerCalloutTip,
  ImageMarkerPositionNudge,
  imageMarkerHasCalloutTip
} from '../kiosk/image-canvas';

import { AssemblyCapabilityGroupSelector } from './AssemblyCapabilityGroupSelector';
import {
  buildAutomaticAssemblyBoltSpec,
  resolveAssemblyBoltSpec
} from './assemblyTemplateDraft';
import { capabilityGroupToAssemblyBoltCondition } from './assemblyTemplateInputAssistance';

import type { AssemblyDraftBolt } from './assemblyTemplateDraft';
import type { TorqueWrenchCapabilityGroupApi } from '../../api/domains/torque-wrenches';

type Props = {
  bolt: AssemblyDraftBolt | null;
  pageLabel: string;
  capabilityGroups: TorqueWrenchCapabilityGroupApi[];
  capabilityCatalogStatus: 'loading' | 'ready' | 'error';
  busy: boolean;
  readOnly: boolean;
  inheritCondition: boolean;
  rangeStart: number;
  rangeEnd: number;
  onPatch: (boltId: string, patch: Partial<AssemblyDraftBolt>) => void;
  onDelete: () => void;
  onInheritConditionChange: (value: boolean) => void;
  onRangeStartChange: (value: number) => void;
  onRangeEndChange: (value: number) => void;
  onApplyRange: () => void;
  onRetryCapabilityCatalog: () => void;
};

function nullableNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function AssemblyTemplateBoltInspector({
  bolt,
  pageLabel,
  capabilityGroups,
  capabilityCatalogStatus,
  busy,
  readOnly,
  inheritCondition,
  rangeStart,
  rangeEnd,
  onPatch,
  onDelete,
  onInheritConditionChange,
  onRangeStartChange,
  onRangeEndChange,
  onApplyRange,
  onRetryCapabilityCatalog
}: Props) {
  const [rangeExpanded, setRangeExpanded] = useState(false);
  if (!bolt) {
    return (
      <>
        <h2 className="text-[1.02rem] font-bold">締付条件</h2>
        <div className="mt-3 rounded border border-dashed border-white/20 p-3 text-sm text-white/60">
          手順書上の締付マーカーを選択
        </div>
      </>
    );
  }

  const automaticSpec = buildAutomaticAssemblyBoltSpec(bolt);
  const effectiveSpec = resolveAssemblyBoltSpec(bolt);

  return (
    <>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[1.02rem] font-bold">締付条件</h2>
          <div className="mt-0.5 truncate text-sm font-bold">丸数字 {bolt.markerNo}</div>
          <div className="mt-0.5 truncate text-[0.68rem] text-white/55">
            ページ: {pageLabel}
          </div>
        </div>
        <Button
          type="button"
          variant="danger"
          className="min-h-10 shrink-0 !px-2 !py-1 text-xs"
          disabled={busy || readOnly}
          onClick={onDelete}
        >
          削除
        </Button>
      </div>

      <div className="mt-2 grid min-w-0 gap-2">
        <div className="flex min-h-10 min-w-0 items-center gap-1 rounded border border-white/10 bg-slate-950/60 px-1.5 py-1">
          <span className="shrink-0 text-[0.68rem] font-semibold text-white/70">
            {imageMarkerHasCalloutTip(bolt) ? '矢視 あり' : '矢視 なし'}
          </span>
          <Button
            type="button"
            variant="ghostOnDark"
            className="min-h-10 shrink-0 !px-1.5 !py-0.5 text-[0.68rem]"
            disabled={busy || readOnly || !imageMarkerHasCalloutTip(bolt)}
            onClick={() => onPatch(bolt.id, clearImageMarkerCalloutTip())}
          >
            矢視削除
          </Button>
          <ImageMarkerPositionNudge
            position={bolt}
            disabled={busy || readOnly}
            groupLabel="締付マーカーの位置調整"
            className="min-w-0 flex-1 [&>button]:min-h-10 [&>button]:min-w-0 [&>button]:flex-1 [&>button]:px-1"
            onChange={(patch) => onPatch(bolt.id, patch)}
          />
        </div>

        <label className="flex min-h-10 min-w-0 items-center gap-2 rounded border border-white/10 bg-slate-950/60 px-2 py-1 text-[0.7rem] font-semibold text-white/80">
          <input
            type="checkbox"
            checked={inheritCondition}
            disabled={busy || readOnly}
            onChange={(event) => onInheritConditionChange(event.target.checked)}
          />
          次の丸数字へこの条件を引き継ぐ
        </label>

        <Button
          type="button"
          variant="ghostOnDark"
          className="min-h-10 w-full !px-2 !py-1 text-xs"
          aria-expanded={rangeExpanded}
          onClick={() => setRangeExpanded((current) => !current)}
        >
          条件を一括反映
        </Button>
        {rangeExpanded ? (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-1 rounded border border-cyan-300/20 bg-cyan-950/20 p-1.5">
          <label className="grid min-w-0 gap-0.5 text-[0.65rem] font-semibold text-white/70">
            反映開始
            <Input
              className="h-10 min-w-0 !px-2 !py-1 text-sm"
              type="number"
              min={1}
              value={rangeStart}
              onChange={(event) => onRangeStartChange(Number(event.target.value))}
            />
          </label>
          <label className="grid min-w-0 gap-0.5 text-[0.65rem] font-semibold text-white/70">
            反映終了
            <Input
              className="h-10 min-w-0 !px-2 !py-1 text-sm"
              type="number"
              min={1}
              value={rangeEnd}
              onChange={(event) => onRangeEndChange(Number(event.target.value))}
            />
          </label>
          <Button
            type="button"
            variant="ghostOnDark"
            className="min-h-10 whitespace-nowrap !px-2 !py-1 text-[0.68rem]"
            disabled={busy || readOnly}
            onClick={onApplyRange}
          >
            条件反映
          </Button>
        </div>
        ) : null}

        <div
          data-testid="assembly-editor-bolt-fields"
          className="grid min-w-0 gap-1.5"
        >
          <AssemblyCapabilityGroupSelector
            boltId={bolt.id}
            selectedGroupId={bolt.capabilityGroupId ?? null}
            storedCondition={bolt}
            groups={capabilityGroups}
            catalogStatus={capabilityCatalogStatus}
            disabled={busy || readOnly}
            onSelect={(group) =>
              onPatch(bolt.id, capabilityGroupToAssemblyBoltCondition(group))
            }
            onRetry={onRetryCapabilityCatalog}
          />

          <div className="grid min-w-0 grid-cols-4 gap-1.5">
            {([
              ['lowerLimit', '下限'],
              ['nominalTorque', '規定'],
              ['upperLimit', '上限']
            ] as const).map(([key, label]) => (
              <label
                key={key}
                className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold text-white/70"
              >
                {label}
                <Input
                  id={`assembly-bolt-${bolt.id}-${key}`}
                  className="h-10 min-w-0 !px-2 !py-1 text-sm"
                  type="number"
                  value={bolt[key] ?? ''}
                  disabled={busy || readOnly}
                  onChange={(event) =>
                    onPatch(bolt.id, { [key]: nullableNumber(event.target.value) })
                  }
                />
              </label>
            ))}
            <label className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold text-white/70">
              単位
              <select
                id={`assembly-bolt-${bolt.id}-unit`}
                className="h-10 min-w-0 w-full rounded border border-white/10 bg-slate-950 px-1.5 text-xs text-white"
                value={bolt.unit}
                disabled={busy || readOnly}
                onChange={(event) => onPatch(bolt.id, { unit: event.target.value })}
              >
                <option value="">選択</option>
                <option value="N·m">N·m</option>
                <option value="kgf·cm">kgf·cm</option>
              </select>
            </label>
          </div>

          <div className="rounded border border-white/10 bg-slate-950/55 p-2 text-[0.68rem]">
            <div className="font-semibold text-white/70">Excel出力用ボルト仕様</div>
            <div className="mt-1 break-words font-bold text-white">
              {effectiveSpec || '締結条件の入力後に自動生成されます'}
              <span className="ml-1 text-white/45">
                （{bolt.boltSpecMode === 'custom' ? '個別指定' : '自動'}）
              </span>
            </div>
            {bolt.boltSpecMode === 'custom' ? (
              <div className="mt-2 grid gap-1">
                <Input
                  id={`assembly-bolt-${bolt.id}-boltSpecCustom`}
                  className="h-10 min-w-0 !px-2 !py-1 text-sm"
                  value={bolt.boltSpecCustom}
                  maxLength={200}
                  disabled={busy || readOnly}
                  onChange={(event) =>
                    onPatch(bolt.id, { boltSpecCustom: event.target.value })
                  }
                  onBlur={() => {
                    if (!bolt.boltSpecCustom.trim()) {
                      onPatch(bolt.id, {
                        boltSpecMode: 'auto',
                        boltSpecCustom: ''
                      });
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="ghostOnDark"
                  className="min-h-10"
                  disabled={busy || readOnly}
                  onClick={() =>
                    onPatch(bolt.id, {
                      boltSpecMode: 'auto',
                      boltSpecCustom: ''
                    })
                  }
                >
                  自動生成へ戻す
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghostOnDark"
                className="mt-2 min-h-10"
                disabled={busy || readOnly || !automaticSpec}
                onClick={() =>
                  onPatch(bolt.id, {
                    boltSpecMode: 'custom',
                    boltSpecCustom: automaticSpec
                  })
                }
              >
                表示名を個別指定
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
