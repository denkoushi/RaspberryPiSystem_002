import { SelfInspectionKioskButton } from './SelfInspectionKioskButton';

export type SelfInspectionFinalJudgement = 'FINAL_OK' | 'FINAL_NG';

type JudgementValue = {
  templateItemId: string;
  operatorValueSnapshot?: string | null;
  value: string | null;
  judgementStatus?: 'NOT_EVALUATED' | SelfInspectionFinalJudgement;
};

type TemplateItem = {
  id: string;
  measurementLabel: string;
  measurementPoint: string;
};

type Props = {
  values: JudgementValue[];
  templateItems: TemplateItem[];
  selectedByItemId: Record<string, SelfInspectionFinalJudgement>;
  isSaving: boolean;
  onSelect: (templateItemId: string, status: SelfInspectionFinalJudgement) => void;
  onSave: () => void;
};

export function SelfInspectionInspectorJudgementPanel({
  values,
  templateItems,
  selectedByItemId,
  isSaving,
  onSelect,
  onSave
}: Props) {
  if (values.length === 0) return null;

  const selectedCount = values.filter((value) => {
    const status = selectedByItemId[value.templateItemId] ?? value.judgementStatus;
    return status === 'FINAL_OK' || status === 'FINAL_NG';
  }).length;
  const canSave = selectedCount === values.length;

  return (
    <div className="rounded border border-amber-300/40 bg-amber-500/10 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-amber-100">測定者NGの最終判定</p>
        <p className="text-xs font-bold text-amber-100" role="status">
          最終判定 {selectedCount}/{values.length}
        </p>
      </div>
      <div className="mt-2 space-y-2">
        {values.map((value) => {
          const item = templateItems.find((row) => row.id === value.templateItemId);
          const selectedStatus =
            selectedByItemId[value.templateItemId] ?? value.judgementStatus;
          return (
            <div
              key={value.templateItemId}
              className="rounded border border-white/15 bg-slate-950/40 p-2"
            >
              <p className="text-xs text-white/75">
                {item?.measurementLabel ?? item?.measurementPoint ?? value.templateItemId}
                {' / 測定者: '}
                {value.operatorValueSnapshot ?? '-'}
                {' / 検査員: '}
                {value.value ?? '-'}
              </p>
              <div className="mt-1 grid grid-cols-2 gap-1">
                {(['FINAL_OK', 'FINAL_NG'] as const).map((status) => (
                  <SelfInspectionKioskButton
                    key={status}
                    type="button"
                    size="actionCompact"
                    tone={status === 'FINAL_OK' ? 'success' : 'danger'}
                    pressed={selectedStatus === status}
                    disabled={isSaving}
                    onClick={() => onSelect(value.templateItemId, status)}
                  >
                    {status === 'FINAL_OK' ? '最終OK' : '最終NG'}
                  </SelfInspectionKioskButton>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <SelfInspectionKioskButton
        type="button"
        size="actionCompact"
        disabled={!canSave || isSaving}
        highlighted={canSave && !isSaving}
        onClick={onSave}
      >
        最終判定を保存
      </SelfInspectionKioskButton>
    </div>
  );
}
