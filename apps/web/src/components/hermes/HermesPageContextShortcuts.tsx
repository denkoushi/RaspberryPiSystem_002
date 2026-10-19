type HermesPageContextShortcutsProps = {
  partNumber: string;
  disabled: boolean;
  onChoose: (question: string) => void;
};

export function HermesPageContextShortcuts({ partNumber, disabled, onChoose }: HermesPageContextShortcutsProps) {
  return (
    <div className="hermes-page-context-shortcuts" role="group" aria-label="品番ショートカット">
      <span className="hermes-page-context-shortcuts__part" title={partNumber}>{partNumber}</span>
      <button type="button" disabled={disabled} onClick={() => onChoose('この品番の不適合')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M12 3 2 21h20L12 3Z" strokeLinejoin="round" />
          <path d="M12 9v5m0 3v1" />
        </svg>
        不適合
      </button>
      <button type="button" disabled={disabled} onClick={() => onChoose('この品番の手順書')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M6 3h9l4 4v14H6V3Z" strokeLinejoin="round" />
          <path d="M14 3v5h5M9 12h7m-7 4h7" />
        </svg>
        手順書
      </button>
    </div>
  );
}
