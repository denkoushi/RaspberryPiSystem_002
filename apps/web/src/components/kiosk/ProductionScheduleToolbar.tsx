import { PillToggle } from '../layout/PillToggle';
import { Row } from '../layout/Row';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

type ProductionScheduleToolbarProps = {
  inputQuery: string;
  onInputChange: (value: string) => void;
  onOpenKeyboard: () => void;
  onSearch: () => void;
  onClear: () => void;
  completedCount: number;
  incompleteCount: number;
  hasNoteOnly: boolean;
  onToggleHasNoteOnly: () => void;
  hasDueDateOnly: boolean;
  onToggleHasDueDateOnly: () => void;
  showGrindingResources: boolean;
  onToggleGrindingResources: () => void;
  showCuttingResources: boolean;
  onToggleCuttingResources: () => void;
  selectedMachineName: string;
  machineNameOptions: string[];
  onMachineNameChange: (value: string) => void;
  selectedPartName: string;
  partNameOptions: string[];
  onPartNameChange: (value: string) => void;
  disabled?: boolean;
  isFetching?: boolean;
  showFetching?: boolean;
};

export function ProductionScheduleToolbar({
  inputQuery,
  onInputChange,
  onOpenKeyboard,
  onSearch,
  onClear,
  completedCount,
  incompleteCount,
  hasNoteOnly,
  onToggleHasNoteOnly,
  hasDueDateOnly,
  onToggleHasDueDateOnly,
  showGrindingResources,
  onToggleGrindingResources,
  showCuttingResources,
  onToggleCuttingResources,
  selectedMachineName,
  machineNameOptions,
  onMachineNameChange,
  selectedPartName,
  partNameOptions,
  onPartNameChange,
  disabled = false,
  isFetching = false,
  showFetching = false
}: ProductionScheduleToolbarProps) {
  return (
    <Row className="gap-2 min-w-0 w-full">
      <Row className="gap-2 min-w-0">
        <Input
          value={inputQuery}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder="製造order番号 / 製番で検索"
          className="h-10 !w-36 shrink-0 bg-white text-slate-900"
        />
        <Row className="gap-2 min-w-0">
          <Button
            variant="secondary"
            className="h-10 px-3 whitespace-nowrap shrink-0"
            onClick={onOpenKeyboard}
            disabled={disabled}
            aria-label="キーボードを開く"
          >
            ⌨
          </Button>
          <Button
            variant="primary"
            className="h-10 whitespace-nowrap shrink-0"
            onClick={onSearch}
            disabled={disabled}
          >
            検索
          </Button>
          <Button
            variant="secondary"
            className="h-10 whitespace-nowrap shrink-0"
            onClick={onClear}
            disabled={disabled}
          >
            クリア
          </Button>
          <PillToggle
            isActive={hasNoteOnly}
            onClick={onToggleHasNoteOnly}
            disabled={disabled}
            size="md"
            className="h-10 whitespace-nowrap shrink-0"
            activeClassName="border-emerald-300 bg-emerald-500 text-white"
            inactiveClassName="border-white/30 bg-white/5 text-white/80 hover:bg-white/10"
          >
            備考あり
          </PillToggle>
          <PillToggle
            isActive={hasDueDateOnly}
            onClick={onToggleHasDueDateOnly}
            disabled={disabled}
            size="md"
            className="h-10 whitespace-nowrap shrink-0"
            activeClassName="border-emerald-300 bg-emerald-500 text-white"
            inactiveClassName="border-white/30 bg-white/5 text-white/80 hover:bg-white/10"
          >
            納期日あり
          </PillToggle>
          <PillToggle
            isActive={showGrindingResources}
            onClick={onToggleGrindingResources}
            disabled={disabled}
            size="md"
            className="h-10 whitespace-nowrap shrink-0"
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
            className="h-10 whitespace-nowrap shrink-0"
            activeClassName="border-emerald-300 bg-emerald-500 text-white"
            inactiveClassName="border-white/30 bg-white/5 text-white/80 hover:bg-white/10"
          >
            切削工程
          </PillToggle>
          <select
            value={selectedMachineName}
            onChange={(event) => onMachineNameChange(event.target.value)}
            className="h-10 min-w-36 rounded border border-slate-300 bg-white px-2 text-sm text-slate-900"
            disabled={disabled}
            aria-label="機種名フィルタ"
          >
            <option value="">機種名: 全て</option>
            {machineNameOptions.map((machineName) => (
              <option key={machineName} value={machineName}>
                {machineName}
              </option>
            ))}
          </select>
          <select
            value={selectedPartName}
            onChange={(event) => onPartNameChange(event.target.value)}
            className="h-10 min-w-36 rounded border border-slate-300 bg-white px-2 text-sm text-slate-900"
            disabled={disabled || selectedMachineName.trim().length === 0}
            aria-label="部品名フィルタ"
          >
            <option value="">部品名: 全て</option>
            {partNameOptions.map((partName) => (
              <option key={partName} value={partName}>
                {partName}
              </option>
            ))}
          </select>
          {showFetching && isFetching ? <span className="text-xs text-white/70">更新中...</span> : null}
        </Row>
      </Row>
      <div className="ml-auto flex items-center gap-2 text-sm font-semibold whitespace-nowrap">
        <span className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
          完了 {completedCount}
        </span>
        <span className="text-white/70">/</span>
        <span className="text-red-400 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
          未完 {incompleteCount}
        </span>
      </div>
    </Row>
  );
}
