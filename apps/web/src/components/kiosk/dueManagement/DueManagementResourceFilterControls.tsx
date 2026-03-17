type DueManagementResourceFilterControlsProps = {
  resourceCds: string[];
  selectedResourceCd: string;
  onSelectResourceCd: (resourceCd: string) => void;
  disabled?: boolean;
};

export function DueManagementResourceFilterControls({
  resourceCds,
  selectedResourceCd,
  onSelectResourceCd,
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
    </div>
  );
}
