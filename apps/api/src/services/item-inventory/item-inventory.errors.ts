import { DomainHttpError } from '../../lib/errors.js';

export class InventoryInsufficientStockError extends DomainHttpError {
  constructor() {
    super(409, '在庫が不足しています', 'INVENTORY_INSUFFICIENT_STOCK');
    this.name = 'InventoryInsufficientStockError';
  }
}

export class InventoryConflictError extends DomainHttpError {
  constructor(message = '在庫が更新されています。画面を再読み込みしてください') {
    super(409, message, 'INVENTORY_CONFLICT');
    this.name = 'InventoryConflictError';
  }
}

export type InventoryActor = {
  clientId?: string | null;
  performedByUserId?: string | null;
};
