-- Keep enum addition separate; do not use the new value in this migration.
ALTER TYPE "InventoryImportPayloadStatus" ADD VALUE 'DISMISSED';
