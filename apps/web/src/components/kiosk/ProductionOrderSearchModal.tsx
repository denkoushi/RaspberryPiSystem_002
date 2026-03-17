import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

type ProductionOrderSearchModalProps = {
  isOpen: boolean;
  productNoInput: string;
  onInputChange: (value: string) => void;
  onClose: () => void;
  onAppendDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  selectedPartName: string;
  partNameOptions: string[];
  onPartNameChange: (value: string) => void;
  orders: string[];
  selectedOrderNumbers: string[];
  onToggleOrder: (orderNumber: string) => void;
  onConfirm: () => void;
  canConfirm: boolean;
  canSelectPart: boolean;
  isLoading: boolean;
};

const NUMBER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

export function ProductionOrderSearchModal({
  isOpen,
  productNoInput,
  onInputChange,
  onClose,
  onAppendDigit,
  onBackspace,
  onClear,
  selectedPartName,
  partNameOptions,
  onPartNameChange,
  orders,
  selectedOrderNumbers,
  onToggleOrder,
  onConfirm,
  canConfirm,
  canSelectPart,
  isLoading
}: ProductionOrderSearchModalProps) {
  const shouldShowOrders = selectedPartName.trim().length > 0;

  return (
    <Dialog isOpen={isOpen} onClose={onClose} ariaLabel="製造order番号検索" size="lg">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">製造order番号検索</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          title="閉じる"
          className="text-slate-500 hover:text-slate-700"
        >
          ✕
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="product-no-prefix" className="mb-1 block text-sm font-semibold text-slate-700">
            製造order番号（5-10桁）
          </label>
          <input
            id="product-no-prefix"
            value={productNoInput}
            onChange={(event) => onInputChange(event.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base font-semibold text-slate-900"
            inputMode="numeric"
            maxLength={10}
            placeholder="5桁以上を入力"
          />
        </div>

        <div className="grid grid-cols-5 gap-2">
          {NUMBER_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className="rounded-md border border-slate-300 bg-white py-2 text-center text-base font-semibold text-slate-900 hover:bg-slate-100"
              onClick={() => onAppendDigit(key)}
            >
              {key}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={onBackspace}>
            Backspace
          </Button>
          <Button type="button" variant="secondary" onClick={onClear}>
            Clear
          </Button>
        </div>

        <div>
          <label htmlFor="order-part-name" className="mb-1 block text-sm font-semibold text-slate-700">
            部品名
          </label>
          <select
            id="order-part-name"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
            value={selectedPartName}
            onChange={(event) => onPartNameChange(event.target.value)}
            disabled={!canSelectPart}
          >
            <option value="">部品名を選択</option>
            {partNameOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-md border border-slate-300 bg-slate-50 p-3">
          {!canSelectPart ? (
            <p className="text-sm text-slate-600">5桁以上を入力すると部品名候補を表示します。</p>
          ) : isLoading ? (
            <p className="text-sm text-slate-600">候補を読み込み中...</p>
          ) : !shouldShowOrders ? (
            <p className="text-sm text-slate-600">部品名を選択すると製造order番号が表示されます。</p>
          ) : orders.length === 0 ? (
            <p className="text-sm text-slate-600">該当する製造order番号はありません。</p>
          ) : (
            <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
              {orders.map((orderNumber) => {
                const checked = selectedOrderNumbers.includes(orderNumber);
                return (
                  <label key={orderNumber} className="flex items-center gap-2 rounded bg-white px-2 py-1 text-sm text-slate-900">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleOrder(orderNumber)}
                      className="h-4 w-4"
                    />
                    <span className="font-semibold">{orderNumber}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          キャンセル
        </Button>
        <Button type="button" variant="primary" onClick={onConfirm} disabled={!canConfirm}>
          確定
        </Button>
      </div>
    </Dialog>
  );
}
