import { KioskDigitTenkey } from '../../kiosk/KioskDigitTenkey';

const keyClass = 'h-[52px] rounded-lg border border-[#344252] bg-[#1b222a] text-2xl font-bold disabled:opacity-35';

const columnKeyClass = 'h-12 rounded-lg border border-[#344252] bg-[#1b222a] text-2xl font-bold disabled:opacity-35';
const COLUMN_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;

export function ProcedureManualModelTenkey({ value, onChange, column = false, ariaLabel = '機種テンキー' }: { value: string; onChange: (value: string) => void; column?: boolean; ariaLabel?: string }) {
  if (column) return <KioskDigitTenkey value={value} onChange={onChange} showReset={false} showBackspace digits={COLUMN_DIGITS} ariaLabel={ariaLabel} className="mt-1.5 grid grid-cols-1 gap-1.5" keyClassName={`${columnKeyClass} text-[#eef3f6]`} resetClassName={`${columnKeyClass} text-[#9fadb9]`} />;
  return <KioskDigitTenkey value={value} onChange={onChange} showReset={false} showBackspace ariaLabel={ariaLabel} className="mb-2 mt-1.5 grid grid-cols-3 gap-1.5" keyClassName={`${keyClass} text-[#eef3f6]`} resetClassName={`${keyClass} text-[#9fadb9]`} />;
}

export function ProcedureManualModelMatch({ code, search }: { code: string; search: string }) {
  if (!search) return <>{code}</>;
  const parts = code.split(search);
  return <>{parts.map((part, index) => <span key={index}>{index > 0 ? <mark className="rounded-[3px] bg-[#f6b93b66] text-inherit">{search}</mark> : null}{part}</span>)}</>;
}
