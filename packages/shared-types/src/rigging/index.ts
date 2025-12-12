export type RiggingStatus = 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
export type RiggingInspectionResult = 'PASS' | 'FAIL';

export interface RiggingGear {
  id: string;
  name: string;
  managementNumber: string;
  storageLocation?: string | null;
  department?: string | null;
  maxLoadTon?: number | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  thicknessMm?: number | null;
  startedAt?: string | null;
  status: RiggingStatus;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  tags?: RiggingGearTag[]; // optional tag list for admin display
}

export interface RiggingGearTag {
  id: string;
  riggingGearId: string;
  rfidTagUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface RiggingInspectionRecord {
  id: string;
  riggingGearId: string;
  loanId?: string | null;
  employeeId: string;
  result: RiggingInspectionResult;
  inspectedAt: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RiggingBorrowPayload {
  riggingTagUid?: string;
  riggingGearId?: string;
  employeeTagUid: string;
  clientId?: string;
  dueAt?: string;
  note?: string | null;
}

export interface RiggingReturnPayload {
  loanId: string;
  clientId?: string;
  performedByUserId?: string;
  note?: string | null;
}
