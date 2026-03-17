import { PillToggle } from '../../layout/PillToggle';

type DueManagementResourceFilterControlsProps = {
  resourceCds: string[];
  selectedResourceCd: string;
  onSelectResourceCd: (resourceCd: string) => void;
  showGrindingResources: boolean;
  onToggleGrindingResources: () => void;
  showCuttingResources: boolean;
  onToggleCuttingResources: () => void;
  disabled?: boolean;
};

export function DueManagementResourceFilterControls({
  resourceCds,
  selectedResourceCd,
  onSelectResourceCd,
  showGrindingResources,
  onToggleGrindingResources,
  showCuttingResources,
  onToggleCuttingResources,
  disabled = false
}: DueManagementResourceFilterControlsProps) {
  return (
    <div className="flex items-center gap-2">
      <select
        value={selectedResourceCd}
        onChange={(event) => onSelectResourceCd(event.target.value)}
        className="h-9 min-w-28 rounded border border-slate-300 bg-white px-2 text-xs text-black"
        disabled={disabled}
        aria-label="資源CDフィルタ"
      >
        <option value="">資源CD: 全件</option>
        {resourceCds.map((resourceCd) => (
          <option key={resourceCd} value={resourceCd}>
            {resourceCd}
          </option>
        ))}
      </select>
      <PillToggle
        isActive={showGrindingResources}
        onClick={onToggleGrindingResources}
        disabled={disabled}
        size="md"
        className="h-9 whitespace-nowrap"
        activeClassName="border-emerald-300 bg-emerald-500 text-white"
        inactiveClassName="border-white/30 bg-white/5 text-white/80 hover:bg-white/10"
      >
        研削工程
      </PillToggle>
      <PillToggle
        isActive={showCuttingResources}
        onClick={onToggleCuttingResources}
        disabled={disabled}
        size="md"
        className="h-9 whitespace-nowrap"
        activeClassName="border-emerald-300 bg-emerald-500 text-white"
        inactiveClassName="border-white/30 bg-white/5 text-white/80 hover:bg-white/10"
      >
        切削工程
      </PillToggle>
    </div>
  );
}
