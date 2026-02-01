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
  hasNoteOnly: boolean;
  onToggleHasNoteOnly: () => void;
  hasDueDateOnly: boolean;
  onToggleHasDueDateOnly: () => void;
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
  hasNoteOnly,
  onToggleHasNoteOnly,
  hasDueDateOnly,
  onToggleHasDueDateOnly,
  disabled = false,
  isFetching = false,
  showFetching = false
}: ProductionScheduleToolbarProps) {
  return (
    <Row className="gap-2 min-w-0">
      <Input
        value={inputQuery}
        onChange={(event) => onInputChange(event.target.value)}
        placeholder="製造order番号 / 製番で検索"
        className="h-10 w-64 bg-white text-slate-900"
      />
      <Row className="gap-2 min-w-0">
        <Button
          variant="secondary"
          className="h-10 px-3"
          onClick={onOpenKeyboard}
          disabled={disabled}
          aria-label="キーボードを開く"
        >
          ⌨
        </Button>
        <Button variant="primary" className="h-10" onClick={onSearch} disabled={disabled}>
          検索
        </Button>
        <Button variant="secondary" className="h-10" onClick={onClear} disabled={disabled}>
          クリア
        </Button>
        <PillToggle
          isActive={hasNoteOnly}
          onClick={onToggleHasNoteOnly}
          disabled={disabled}
          size="md"
          className="h-10"
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
          className="h-10"
          activeClassName="border-emerald-300 bg-emerald-500 text-white"
          inactiveClassName="border-white/30 bg-white/5 text-white/80 hover:bg-white/10"
        >
          納期日あり
        </PillToggle>
        {showFetching && isFetching ? <span className="text-xs text-white/70">更新中...</span> : null}
      </Row>
    </Row>
  );
}
