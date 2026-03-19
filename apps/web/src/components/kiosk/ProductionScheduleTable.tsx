import type { TableColumnDefinition } from '../../features/kiosk/columnWidth';
import type { NormalizedScheduleRow } from '../../features/kiosk/productionSchedule/displayRowDerivation';

type ProcessingTypeOption = {
  code: string;
  label: string;
  enabled: boolean;
};

type IconComponent = (props: { className?: string }) => JSX.Element;

type ProductionScheduleTableProps = {
  tableColumns: TableColumnDefinition[];
  rowPairs: Array<[NormalizedScheduleRow, NormalizedScheduleRow | undefined]>;
  isTwoColumn: boolean;
  itemSeparatorWidth: number;
  checkWidth: number;
  itemColumnWidths: number[];
  dueDateColumnWidth: number;
  noteColumnWidth: number;
  completePending: boolean;
  orderPending: boolean;
  processingPending: boolean;
  notePending: boolean;
  dueDatePending: boolean;
  canEditProcessingOrder: boolean;
  processingTypeOptions: ProcessingTypeOption[];
  getAvailableOrders: (resourceCd: string, current: number | null) => number[];
  handleComplete: (rowId: string) => void;
  handleOrderChange: (rowId: string, resourceCd: string, nextValue: string) => void;
  handleProcessingChange: (rowId: string, nextValue: string) => void;
  openDueDatePicker: (rowId: string, currentDueDate: string | null) => void;
  startNoteEdit: (rowId: string, currentNote: string | null) => void;
  formatDueDate: (value: string | null) => string;
  PencilIcon: IconComponent;
  CalendarIcon: IconComponent;
};

type RowCellProps = {
  row: NormalizedScheduleRow;
  tableColumns: TableColumnDefinition[];
  rowClassName: string;
  completePending: boolean;
  orderPending: boolean;
  processingPending: boolean;
  notePending: boolean;
  dueDatePending: boolean;
  canEditProcessingOrder: boolean;
  processingTypeOptions: ProcessingTypeOption[];
  getAvailableOrders: (resourceCd: string, current: number | null) => number[];
  handleComplete: (rowId: string) => void;
  handleOrderChange: (rowId: string, resourceCd: string, nextValue: string) => void;
  handleProcessingChange: (rowId: string, nextValue: string) => void;
  openDueDatePicker: (rowId: string, currentDueDate: string | null) => void;
  startNoteEdit: (rowId: string, currentNote: string | null) => void;
  formatDueDate: (value: string | null) => string;
  PencilIcon: IconComponent;
  CalendarIcon: IconComponent;
};

function ProductionScheduleTableCells({
  row,
  tableColumns,
  rowClassName,
  completePending,
  orderPending,
  processingPending,
  notePending,
  dueDatePending,
  canEditProcessingOrder,
  processingTypeOptions,
  getAvailableOrders,
  handleComplete,
  handleOrderChange,
  handleProcessingChange,
  openDueDatePicker,
  startNoteEdit,
  formatDueDate,
  PencilIcon,
  CalendarIcon
}: RowCellProps) {
  return (
    <>
      <td className={`px-2 py-1.5 align-middle ${rowClassName}`}>
        <button
          className={`flex h-7 w-7 items-center justify-center rounded-full border-2 bg-white text-black shadow hover:bg-slate-100 disabled:opacity-60 ${
            row.isCompleted ? 'border-slate-400' : 'border-red-500'
          }`}
          aria-label={row.isCompleted ? '未完了に戻す' : '完了にする'}
          onClick={() => handleComplete(row.id)}
          disabled={completePending}
        >
          ✓
        </button>
      </td>
      {tableColumns.map((column) => (
        <td key={`${row.id}-${column.key}`} className={`px-2 py-1.5 ${rowClassName}`}>
          {column.key === 'processingOrder' ? (
            (() => {
              const resourceCd = row.data.FSIGENCD ?? '';
              const options = getAvailableOrders(resourceCd, row.processingOrder);
              return (
                <select
                  value={row.processingOrder ?? ''}
                  onChange={(event) => handleOrderChange(row.id, resourceCd, event.target.value)}
                  disabled={
                    completePending ||
                    row.isCompleted ||
                    resourceCd.length === 0 ||
                    orderPending ||
                    !canEditProcessingOrder
                  }
                  className="h-7 w-16 rounded border border-slate-300 bg-white px-2 text-sm text-black"
                >
                  <option value="">-</option>
                  {options.map((num) => (
                    <option key={num} value={num}>
                      {num}
                    </option>
                  ))}
                </select>
              );
            })()
          ) : column.key === 'processingType' ? (
            <select
              value={row.processingType ?? ''}
              onChange={(event) => handleProcessingChange(row.id, event.target.value)}
              disabled={completePending || row.isCompleted || processingPending}
              className="h-7 w-20 min-w-0 rounded border border-slate-300 bg-white px-2 text-xs text-black"
            >
              <option value="">-</option>
              {processingTypeOptions
                .filter((option) => option.enabled)
                .map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
            </select>
          ) : (
            <span
              className={[
                column.key === 'ProductNo' || column.key === 'FSIGENCD' ? 'font-mono' : '',
                column.key === 'ProductNo' || column.key === 'FHINCD' || column.key === 'FSEIBAN'
                  ? 'break-all'
                  : '',
                column.key === 'FHINCD' ? 'line-clamp-3 min-w-0' : ''
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {row.values[column.key] || '-'}
            </span>
          )}
        </td>
      ))}
      <td className={`px-2 py-1.5 align-middle ${rowClassName}`}>
        <span className="flex items-center gap-1">
          <span
            className="min-w-0 truncate text-white/90"
            title={row.dueDate ? formatDueDate(row.dueDate) : undefined}
          >
            {formatDueDate(row.dueDate)}
          </span>
          <button
            type="button"
            onClick={() => openDueDatePicker(row.id, row.dueDate)}
            disabled={dueDatePending}
            className="flex shrink-0 items-center justify-center rounded p-1 text-white/70 hover:bg-white/20 hover:text-white disabled:opacity-50"
            aria-label="納期日を編集"
          >
            <CalendarIcon />
          </button>
        </span>
      </td>
      <td className={`px-2 py-1.5 align-middle ${rowClassName}`}>
        <span className="flex w-full min-w-0 items-center gap-1" title={row.note ?? undefined}>
          <span className="min-w-0 flex-1 overflow-hidden whitespace-normal break-words text-white/90 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
            {row.note ?? ''}
          </span>
          <button
            type="button"
            onClick={() => startNoteEdit(row.id, row.note)}
            disabled={notePending}
            className="flex shrink-0 items-center justify-center rounded p-1 text-white/70 hover:bg-white/20 hover:text-white disabled:opacity-50"
            aria-label="備考を編集"
          >
            <PencilIcon />
          </button>
        </span>
      </td>
    </>
  );
}

export function ProductionScheduleTable({
  tableColumns,
  rowPairs,
  isTwoColumn,
  itemSeparatorWidth,
  checkWidth,
  itemColumnWidths,
  dueDateColumnWidth,
  noteColumnWidth,
  completePending,
  orderPending,
  processingPending,
  notePending,
  dueDatePending,
  canEditProcessingOrder,
  processingTypeOptions,
  getAvailableOrders,
  handleComplete,
  handleOrderChange,
  handleProcessingChange,
  openDueDatePicker,
  startNoteEdit,
  formatDueDate,
  PencilIcon,
  CalendarIcon
}: ProductionScheduleTableProps) {
  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full border-collapse text-left text-xs text-white">
        <colgroup>
          <col style={{ width: checkWidth }} />
          {itemColumnWidths.map((width, index) => (
            <col key={`left-${tableColumns[index]?.key ?? index}`} style={{ width }} />
          ))}
          <col style={{ width: dueDateColumnWidth }} />
          <col style={{ width: noteColumnWidth }} />
          {isTwoColumn ? <col style={{ width: itemSeparatorWidth }} /> : null}
          {isTwoColumn
            ? [<col key="right-check" style={{ width: checkWidth }} />]
                .concat(
                  itemColumnWidths.map((width, index) => (
                    <col key={`right-${tableColumns[index]?.key ?? index}`} style={{ width }} />
                  ))
                )
                .concat([
                  <col key="right-due-date" style={{ width: dueDateColumnWidth }} />,
                  <col key="right-note" style={{ width: noteColumnWidth }} />
                ])
            : null}
        </colgroup>
        <thead className="sticky top-0 bg-slate-900">
          <tr className="border-b border-white/20 text-xs font-semibold text-white/80">
            <th className="px-2 py-3 text-center">完了</th>
            {tableColumns.map((column) => (
              <th key={`head-left-${column.key}`} className="px-2 py-3">
                {column.label}
              </th>
            ))}
            <th className="px-2 py-3">納期日</th>
            <th className="px-2 py-3">備考</th>
            {isTwoColumn ? <th aria-hidden className="px-2 py-3" /> : null}
            {isTwoColumn ? <th className="px-2 py-3 text-center">完了</th> : null}
            {isTwoColumn
              ? tableColumns.map((column) => (
                  <th key={`head-right-${column.key}`} className="px-2 py-3">
                    {column.label}
                  </th>
                ))
              : null}
            {isTwoColumn ? <th className="px-2 py-3">納期日</th> : null}
            {isTwoColumn ? <th className="px-2 py-3">備考</th> : null}
          </tr>
        </thead>
        <tbody>
          {rowPairs.map(([left, right]) => {
            const leftClass = left?.isCompleted ? 'opacity-50 grayscale' : '';
            const rightClass = right?.isCompleted ? 'opacity-50 grayscale' : '';
            return (
              <tr key={`row-${left.id}`} className="border-b border-white/10">
                <ProductionScheduleTableCells
                  row={left}
                  tableColumns={tableColumns}
                  rowClassName={leftClass}
                  completePending={completePending}
                  orderPending={orderPending}
                  processingPending={processingPending}
                  notePending={notePending}
                  dueDatePending={dueDatePending}
                  canEditProcessingOrder={canEditProcessingOrder}
                  processingTypeOptions={processingTypeOptions}
                  getAvailableOrders={getAvailableOrders}
                  handleComplete={handleComplete}
                  handleOrderChange={handleOrderChange}
                  handleProcessingChange={handleProcessingChange}
                  openDueDatePicker={openDueDatePicker}
                  startNoteEdit={startNoteEdit}
                  formatDueDate={formatDueDate}
                  PencilIcon={PencilIcon}
                  CalendarIcon={CalendarIcon}
                />
                {isTwoColumn ? <td className="px-2 py-1.5" /> : null}
                {isTwoColumn ? (
                  right ? (
                    <ProductionScheduleTableCells
                      row={right}
                      tableColumns={tableColumns}
                      rowClassName={rightClass}
                      completePending={completePending}
                      orderPending={orderPending}
                      processingPending={processingPending}
                      notePending={notePending}
                      dueDatePending={dueDatePending}
                      canEditProcessingOrder={canEditProcessingOrder}
                      processingTypeOptions={processingTypeOptions}
                      getAvailableOrders={getAvailableOrders}
                      handleComplete={handleComplete}
                      handleOrderChange={handleOrderChange}
                      handleProcessingChange={handleProcessingChange}
                      openDueDatePicker={openDueDatePicker}
                      startNoteEdit={startNoteEdit}
                      formatDueDate={formatDueDate}
                      PencilIcon={PencilIcon}
                      CalendarIcon={CalendarIcon}
                    />
                  ) : (
                    <>
                      <td className={`px-2 py-1.5 align-middle ${rightClass}`} />
                      {tableColumns.map((column) => (
                        <td key={`right-empty-${column.key}`} className={`px-2 py-1.5 ${rightClass}`} />
                      ))}
                      <td className={`px-2 py-1.5 align-middle ${rightClass}`} />
                      <td className={`px-2 py-1.5 align-middle ${rightClass}`} />
                    </>
                  )
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
