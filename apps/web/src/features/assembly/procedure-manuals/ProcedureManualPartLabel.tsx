export function ProcedureManualPartLabel({ partNumber, partName }: { partNumber: string; partName: string | null }) {
  return partName ? <span className="flex min-w-0 flex-col gap-0.5 py-2 break-all">
    <span className="text-xl font-bold">{partName}</span>
    <span className="font-mono text-sm font-normal text-[#9fadb9]">{partNumber}</span>
  </span> : <span className="min-w-0 break-all font-mono text-xl">{partNumber}</span>;
}
