import type { InventoryVariantField } from '@raspi-system/shared-types';
import { Prisma, PrismaClient, InventoryImportPayloadStatus } from '@prisma/client';
import { prisma as defaultPrisma } from '../../lib/prisma.js';
import type { InventoryOptionField } from './item-inventory.fields.js';
import type { InventoryActor } from './item-inventory.errors.js';
import { assertNfcUidAvailable, runSerializable, resolveUnit } from './item-inventory.helpers.js';
import { resolveTag, resolveCompartmentByLabelNumber, listTags, listLocations, listItems, deleteItem, deleteDrawer, deleteShelf, deleteTag, dismissImport, restoreImport, changeImportStatus, listPendingImports, listPendingImportSummaries, listImportMessages, listHistory, dashboard, listUnits, createUnit, setItemUnit, updateItemDetails, createShelf, renameArea, createDrawer, upsertQuantityTag, upsertRestockTag } from './item-inventory-operations.js';
import { rotateImportPhoto, rotateInventoryItemPhoto, deleteImportPhoto, reorderImportPhotos, deleteInventoryItemPhoto, reorderInventoryItemPhotos } from './item-inventory-photos.js';
import { listToolFieldOptions, listToolFieldValues, addToolFieldValue, renameToolFieldValue, deleteToolFieldValue, toolValueVariants, mergeToolValueVariants, dismissToolValueVariants } from './item-inventory-tool-fields.js';
import { registerImport } from './item-inventory-import-registration.js';
import { bindCompartment, processTransaction, processTouchTransaction, processStockTransaction, cancelTransaction, correctStock, moveLocation, replaceItemTag } from './item-inventory-transactions.js';

export { INVENTORY_TOOL_FIELDS, INVENTORY_OPTION_FIELDS } from './item-inventory.fields.js';
export type { InventoryToolField, InventoryOptionField } from './item-inventory.fields.js';
export { InventoryInsufficientStockError, InventoryConflictError } from './item-inventory.errors.js';
export type { InventoryActor } from './item-inventory.errors.js';

export class ItemInventoryService {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  private async assertNfcUidAvailable(uid: string, db: PrismaClient | Prisma.TransactionClient): Promise<void> { return assertNfcUidAvailable(uid, db); }

  private async serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> { return runSerializable(this.db, work); }

  async resolveTag(uid: string) { return resolveTag(this.db, uid); }

  async resolveCompartmentByLabelNumber(labelNumber: number) { return resolveCompartmentByLabelNumber(this.db, labelNumber); }

  async listTags() { return listTags(this.db); }

  async listLocations() { return listLocations(this.db); }

  async listItems() { return listItems(this.db); }

  async deleteItem(itemId: string) { return deleteItem(this.db, itemId); }

  async deleteDrawer(id: string) { return deleteDrawer(this.db, id); }

  async deleteShelf(id: string) { return deleteShelf(this.db, id); }

  async deleteTag(id: string) { return deleteTag(this.db, id); }

  async dismissImport(id: string) { return dismissImport(this.db, id); }

  async restoreImport(id: string) { return restoreImport(this.db, id); }

  private async changeImportStatus(id: string, expectedStatus: InventoryImportPayloadStatus, status: InventoryImportPayloadStatus) { return changeImportStatus(this.db, id, expectedStatus, status); }

  async listPendingImports() { return listPendingImports(this.db); }

  /** Pending candidates for the kiosk item list: newest first, one thumbnail each, no manifest or mail details. */
  async listPendingImportSummaries() { return listPendingImportSummaries(this.db); }

  async rotateImportPhoto(payloadId: string, photoId: string) { return rotateImportPhoto(this.db, payloadId, photoId); }

  async rotateInventoryItemPhoto(itemId: string, photoId: string) { return rotateInventoryItemPhoto(this.db, itemId, photoId); }

  async deleteImportPhoto(payloadId: string, photoId: string) { return deleteImportPhoto(this.db, payloadId, photoId); }

  async reorderImportPhotos(payloadId: string, photoIds: string[]) { return reorderImportPhotos(this.db, payloadId, photoIds); }

  async deleteInventoryItemPhoto(itemId: string, photoId: string) { return deleteInventoryItemPhoto(this.db, itemId, photoId); }

  async reorderInventoryItemPhotos(itemId: string, photoIds: string[]) { return reorderInventoryItemPhotos(this.db, itemId, photoIds); }

  async listImportMessages() { return listImportMessages(this.db); }

  async listHistory(limit = 100, filter: { compartmentId?: string } = {}) { return listHistory(this.db, limit, filter); }

  /** Pre-registered choices plus values already used, for each field offered in the kiosk pop-up. */
  async listToolFieldOptions(): Promise<Record<InventoryOptionField, string[]>> { return listToolFieldOptions(this.db); }

  /** Each field's choices with how many items use them, for the kiosk edit mode. */
  async listToolFieldValues(): Promise<Record<InventoryOptionField, Array<{ value: string; count: number }>>> { return listToolFieldValues(this.db); }

  async addToolFieldValue(field: InventoryOptionField, value: string) { return addToolFieldValue(this.db, field, value); }

  /** Rename a choice and every item that uses it, in one transaction. */
  async renameToolFieldValue(field: InventoryOptionField, from: string, to: string) { return renameToolFieldValue(this.db, field, from, to); }

  /** Only a choice no item uses can be removed; otherwise it would come back from the items. */
  async deleteToolFieldValue(field: InventoryOptionField, value: string) { return deleteToolFieldValue(this.db, field, value); }

  async dashboard(weeks: number, machine?: string, now = new Date()) { return dashboard(this.db, weeks, machine, now); }

  async toolValueVariants() { return toolValueVariants(this.db); }

  async mergeToolValueVariants(field: InventoryVariantField, to: string, from: string[]) { return mergeToolValueVariants(this.db, field, to, from, (field, from, to) => this.renameToolFieldValue(field, from, to)); }

  async dismissToolValueVariants(field: InventoryVariantField, values: string[]) { return dismissToolValueVariants(this.db, field, values); }

  async listUnits() { return listUnits(this.db); }

  async createUnit(name: string) { return createUnit(this.db, name); }

  /** A unit must be one of the offered units; null returns the item to 個. */
  private async resolveUnit(unit: string | null): Promise<string | null> { return resolveUnit(this.db, unit); }

  async setItemUnit(itemId: string, unit: string | null) { return setItemUnit(this.db, itemId, unit); }

  /** Change one item's name and tool information; fields left out stay as they are. */
  async updateItemDetails(itemId: string, input: Partial<Record<InventoryOptionField, string>> & { unitPrice?: number | null }) { return updateItemDetails(this.db, itemId, input); }

  async createShelf(area: string, shelfNumber: number) { return createShelf(this.db, area, shelfNumber); }

  /** Rename an area (every shelf in it). Drawers, compartments, stock and tags stay attached. */
  async renameArea(from: string, to: string) { return renameArea(this.db, from, to); }

  async createDrawer(shelfId: string, drawerNumber: number) { return createDrawer(this.db, shelfId, drawerNumber); }

  async upsertQuantityTag(uid: string, quantity: number) { return upsertQuantityTag(this.db, uid, quantity); }

  async upsertRestockTag(uid: string) { return upsertRestockTag(this.db, uid); }

  async registerImport(input: {
    payloadId: string;
    mode: 'NEW_ITEM' | 'EXISTING_ITEM';
    itemId?: string;
    name?: string;
    model?: string;
    usage?: string;
    shelfId?: string;
    drawerId?: string;
    itemTagUid?: string;
    initialQuantity?: number;
    reviewNote?: string;
    unit?: string | null;
    maker?: string;
    toolName?: string;
    workMaterial?: string;
    toolSize?: string;
    actor?: InventoryActor;
  }) { return registerImport(this.db, input); }

  async bindCompartment(input: {
    itemId: string;
    shelfId: string;
    drawerId: string;
    itemTagUid: string;
    initialQuantity: number;
    actor?: InventoryActor;
  }) { return bindCompartment(this.db, input); }

  async processTransaction(input: {
    itemTagUid: string;
    expectedCompartmentId?: string;
    quantityTagUid: string;
    restockTagUid?: string;
    restock: boolean;
    idempotencyKey?: string;
    actor?: InventoryActor;
  }) { return processTransaction(this.db, input); }

  async processTouchTransaction(input: {
    compartmentId: string;
    quantity: number;
    restock?: boolean;
    expectedBeforeQuantity?: number;
    idempotencyKey?: string;
    actor?: InventoryActor;
  }) { return processTouchTransaction(this.db, input); }

  private async processStockTransaction(
    input: { restock?: boolean; expectedCompartmentId?: string; expectedBeforeQuantity?: number; idempotencyKey?: string; actor?: InventoryActor },
    resolveMovement: (tx: Prisma.TransactionClient) => Promise<{
      compartmentId: string;
      quantity: number;
      quantityTagId?: string;
      details: Prisma.InputJsonValue;
    }>,
  ) { return processStockTransaction(this.db, input, resolveMovement); }

  async cancelTransaction(id: string, actor: InventoryActor, options: { allowAnyClient?: boolean } = {}) { return cancelTransaction(this.db, id, actor, options); }

  async correctStock(
    compartmentId: string,
    desiredQuantity: number,
    actor: InventoryActor,
    note?: string,
    options: { expectedBeforeQuantity?: number } = {},
  ) { return correctStock(this.db, compartmentId, desiredQuantity, actor, note, options); }

  async moveLocation(compartmentId: string, drawerId: string, actor: InventoryActor) { return moveLocation(this.db, compartmentId, drawerId, actor); }

  async replaceItemTag(compartmentId: string, uid: string, actor: InventoryActor) { return replaceItemTag(this.db, compartmentId, uid, actor); }
}
