/**
 * ツール管理モジュールの型定義
 */
import type { MeasuringInstrument } from '../measuring-instruments/index.js';
import type { RiggingGear } from '../rigging/index.js';
export { formatClientDeviceLocationLabel } from './client-device-location.js';
export { PHOTO_LOAN_CARD_PRIMARY_LABEL } from './loan-card-display.js';

export interface Employee {
  id: string;
  employeeCode: string;
  displayName: string;
  lastName?: string | null;
  firstName?: string | null;
  nfcTagUid?: string | null;
  department?: string | null; // 部署（例: 製造担当部門）
  section?: string | null; // セクション（例: 加工担当部署）
  contact?: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  createdAt: string;
  updatedAt: string;
}

export interface Item {
  id: string;
  itemCode: string;
  name: string;
  description?: string | null;
  nfcTagUid?: string | null;
  category?: string | null;
  storageLocation?: string | null;
  status: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientDevice {
  id: string;
  name: string;
  location?: string | null;
  defaultMode?: 'PHOTO' | 'TAG' | null; // デフォルト: 'TAG'
}

export interface Loan {
  id: string;
  borrowedAt: string;
  dueAt?: string | null;
  returnedAt?: string | null;
  notes?: string | null;
  photoUrl?: string | null; // 写真のURL（写真撮影持出機能で使用）
  photoTakenAt?: string | null; // 撮影日時（写真撮影持出機能で使用）
  employee: Employee;
  item: Item | null; // 写真撮影持出機能ではnullになる可能性がある
  measuringInstrumentId?: string | null;
  measuringInstrument?: MeasuringInstrument | null;
  riggingGearId?: string | null;
  riggingGear?: RiggingGear | null;
  client?: ClientDevice | null;
}

export interface Transaction {
  id: string;
  action: 'BORROW' | 'RETURN' | 'ADJUST';
  createdAt: string;
  loan?: Loan | null;
  actorEmployee?: Employee | null;
  performedByUser?: {
    id: string;
    username: string;
  } | null;
  client?: ClientDevice | null;
  details?: Record<string, unknown> | null;
}

export interface BorrowPayload {
  itemTagUid: string;
  employeeTagUid: string;
  clientId?: string;
  dueAt?: string;
  note?: string | null;
}

export interface ReturnPayload {
  loanId: string;
  clientId?: string;
  note?: string | null;
}
