/**
 * ツール管理モジュールの型定義
 */

export interface Employee {
  id: string;
  employeeCode: string;
  displayName: string;
  nfcTagUid?: string | null;
  department?: string | null;
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
}

export interface Loan {
  id: string;
  borrowedAt: string;
  dueAt?: string | null;
  returnedAt?: string | null;
  notes?: string | null;
  employee: Employee;
  item: Item;
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


