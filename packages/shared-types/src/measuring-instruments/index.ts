export type MeasuringInstrumentStatus = 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
export type InspectionResult = 'PASS' | 'FAIL';

export interface MeasuringInstrument {
  id: string;
  name: string;
  managementNumber: string;
  storageLocation?: string | null;
  measurementRange?: string | null;
  calibrationExpiryDate?: string | null;
  status: MeasuringInstrumentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface InspectionItem {
  id: string;
  measuringInstrumentId: string;
  name: string;
  content: string;
  criteria: string;
  method: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface MeasuringInstrumentTag {
  id: string;
  measuringInstrumentId: string;
  rfidTagUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface InspectionRecord {
  id: string;
  measuringInstrumentId: string;
  loanId?: string | null;
  employeeId: string;
  inspectionItemId: string;
  result: InspectionResult;
  inspectedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeasuringInstrumentBorrowPayload {
  instrumentTagUid: string;
  employeeTagUid: string;
  clientId?: string;
  dueAt?: string;
  note?: string | null;
}

export interface MeasuringInstrumentReturnPayload {
  loanId: string;
  clientId?: string;
  performedByUserId?: string;
  note?: string | null;
}

export interface InspectionRecordCreatePayload {
  measuringInstrumentId: string;
  loanId?: string | null;
  employeeId: string;
  inspectionItemId: string;
  result: InspectionResult;
  inspectedAt: string;
}
