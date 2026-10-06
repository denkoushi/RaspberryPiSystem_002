import { KioskDigitTenkey } from '../../kiosk/KioskDigitTenkey';

const keyClass = 'h-[52px] rounded-lg border border-[#344252] bg-[#1b222a] text-2xl font-bold disabled:opacity-35';

export function ProcedureManualModelTenkey({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <KioskDigitTenkey value={value} onChange={onChange} showReset={false} showBackspace ariaLabel="機種テンキー" className="mb-2 mt-1.5 grid grid-cols-3 gap-1.5" keyClassName={`${keyClass} text-[#eef3f6]`} resetClassName={`${keyClass} text-[#9fadb9]`} />;
}

export function ProcedureManualModelMatch({ code, search }: { code: string; search: string }) {
  if (!search) return <>{code}</>;
  const parts = code.split(search);
  return <>{parts.map((part, index) => <span key={index}>{index > 0 ? <mark className="rounded-[3px] bg-[#f6b93b66] text-inherit">{search}</mark> : null}{part}</span>)}</>;
}
