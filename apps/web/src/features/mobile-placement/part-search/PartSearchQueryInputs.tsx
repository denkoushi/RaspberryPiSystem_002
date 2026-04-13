import { PART_SEARCH_TEXT_INPUT_CLASS } from './partSearchUiTokens';

export type PartSearchQueryInputsProps = {
  partQuery: string;
  machineQuery: string;
  onPartChange: (value: string) => void;
  onMachineChange: (value: string) => void;
  onPartFocus: () => void;
  onMachineFocus: () => void;
  onClearSelection: () => void;
};

/**
 * 部品名・機種名の2入力。API やパレット剪定を知らない（制御コンポーネント）。
 */
export function PartSearchQueryInputs(props: PartSearchQueryInputsProps) {
  const {
    partQuery,
    machineQuery,
    onPartChange,
    onMachineChange,
    onPartFocus,
    onMachineFocus,
    onClearSelection
  } = props;

  return (
    <>
      <input
        value={partQuery}
        onChange={(e) => {
          onPartChange(e.target.value);
          onClearSelection();
        }}
        onFocus={onPartFocus}
        placeholder="例: 脚 / アシ / FHINCD"
        aria-label="部品名（FHINMEI / FHINCD）"
        className={PART_SEARCH_TEXT_INPUT_CLASS}
        inputMode="search"
        autoComplete="off"
      />

      <input
        value={machineQuery}
        onChange={(e) => {
          onMachineChange(e.target.value);
          onClearSelection();
        }}
        onFocus={onMachineFocus}
        placeholder="例: DAD3350…"
        aria-label="機種名（登録製番ボタン下段・任意）"
        className={PART_SEARCH_TEXT_INPUT_CLASS}
        inputMode="search"
        autoComplete="off"
      />
    </>
  );
}
