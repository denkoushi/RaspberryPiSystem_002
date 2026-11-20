export const procedureManualButtonBase = 'min-h-12 rounded-lg border focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7cc4ff]';
export const procedureManualButtonSelected = 'border-[#f6b93b] bg-[#f6b93b] text-[#0b1a12]';
export const procedureManualButtonUnselected = 'border-[#344252]';
export const procedureManualCommonSelected = 'border-[#3ba776] bg-[#3ba77626] text-[#eef3f6]';
export const procedureManualKanaSelected = 'border-[#7cc4ff] text-[#7cc4ff]';

export const procedureManualCommonChip = (pressed: boolean) =>
  `${procedureManualButtonBase} min-h-[52px] px-[18px] text-[19px] font-bold ${pressed ? procedureManualCommonSelected : procedureManualButtonUnselected}`;
export const procedureManualCommonInput = 'h-14 w-full rounded-lg border border-[#344252] bg-[#0b0f13] px-4 text-xl text-[#eef3f6]';

export const procedureManualDialogAction = `${procedureManualButtonBase} inline-flex items-center justify-center px-4 text-[19px] font-bold disabled:opacity-40`;
export const procedureManualDialogChip = 'inline-flex min-h-11 min-w-0 items-center truncate rounded-lg border border-[#344252] px-3.5 text-xl text-[#eef3f6]';
export const procedureManualDialogInput = 'h-14 w-full min-w-0 rounded-lg border border-[#344252] bg-white px-3.5 text-[22px] text-[#0f1317] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7cc4ff] disabled:opacity-60';
export const procedureManualSymbolAction = 'inline-flex min-h-12 w-11 shrink-0 items-center justify-center rounded-lg border border-transparent text-[#9fadb9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7cc4ff] disabled:opacity-40';
