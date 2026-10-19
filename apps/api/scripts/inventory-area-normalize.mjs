/**
 * Normalize stored inventory areas (full-width → half-width etc., NFKC) so that
 * existing rows match what new mail and kiosk input now store
 * (docs/plans/kiosk-inventory-ux-execplan.md, "area normalization").
 *
 * Default is a dry run that only reads and prints the plan. `--apply` first
 * writes a JSON backup of every row it will change (the file must not exist),
 * then updates all rows in one transaction. It refuses to run when two shelves
 * would end up with the same (area, shelfNumber). Re-running is safe: already
 * normalized rows are skipped. Nothing is deleted.
 *
 * Run on Pi5 (API container, working directory /app/apps/api):
 *   node scripts/inventory-area-normalize.mjs
 *   node scripts/inventory-area-normalize.mjs --apply --backup=/opt/backups/inventory-area-normalize-YYYYMMDD.json
 * Undo from the backup (refuses if a row changed after the apply):
 *   node scripts/inventory-area-normalize.mjs --restore=/opt/backups/inventory-area-normalize-YYYYMMDD.json
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { prisma } from '../dist/lib/prisma.js';
import { normalizeInventoryArea } from '../dist/services/item-inventory/inventory-area.js';

const TABLES = [
  { name: 'InventoryShelf', model: 'inventoryShelf' },
  { name: 'InventoryImportPayload', model: 'inventoryImportPayload' },
  { name: 'InventoryItem', model: 'inventoryItem' },
];

function parseArgs(argv) {
  const args = { apply: false, backup: '', restore: '' };
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true;
    else if (arg.startsWith('--backup=')) args.backup = arg.slice('--backup='.length).trim();
    else if (arg.startsWith('--restore=')) args.restore = arg.slice('--restore='.length).trim();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.apply && !args.backup) throw new Error('--apply requires --backup=<path>');
  return args;
}

async function buildPlan(client) {
  const changes = [];
  for (const table of TABLES) {
    const rows = await client[table.model].findMany({ select: { id: true, area: true, ...(table.name === 'InventoryShelf' ? { shelfNumber: true } : {}) } });
    for (const row of rows) {
      if (typeof row.area !== 'string') continue;
      const normalized = normalizeInventoryArea(row.area);
      if (normalized !== row.area) changes.push({ table: table.name, id: row.id, from: row.area, to: normalized, shelfNumber: row.shelfNumber });
    }
  }

  // Two shelves must not collapse onto the same (area, shelfNumber).
  const shelves = await client.inventoryShelf.findMany({ select: { id: true, area: true, shelfNumber: true } });
  const byKey = new Map();
  for (const shelf of shelves) {
    const key = `${normalizeInventoryArea(shelf.area)}\u0000${shelf.shelfNumber}`;
    byKey.set(key, [...(byKey.get(key) ?? []), shelf]);
  }
  const conflicts = [...byKey.values()].filter((group) => group.length > 1)
    .map((group) => group.map((shelf) => ({ id: shelf.id, area: shelf.area, shelfNumber: shelf.shelfNumber })));

  return { changes, conflicts };
}

async function apply(plan, backupPath) {
  if (existsSync(backupPath)) throw new Error(`Backup file already exists: ${backupPath}`);
  writeFileSync(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), changes: plan.changes }, null, 2));
  await prisma.$transaction(async (tx) => {
    for (const change of plan.changes) {
      const model = TABLES.find((table) => table.name === change.table).model;
      // Only rows that still hold the value we planned from are changed.
      const result = await tx[model].updateMany({ where: { id: change.id, area: change.from }, data: { area: change.to } });
      if (result.count !== 1) throw new Error(`${change.table} ${change.id} changed since the plan; nothing was written`);
    }
  });
}

async function restore(backupPath) {
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  await prisma.$transaction(async (tx) => {
    for (const change of backup.changes) {
      const model = TABLES.find((table) => table.name === change.table).model;
      const result = await tx[model].updateMany({ where: { id: change.id, area: change.to }, data: { area: change.from } });
      if (result.count !== 1) throw new Error(`${change.table} ${change.id} changed after the apply; nothing was restored`);
    }
  });
  return backup.changes.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.restore) {
    const count = await restore(args.restore);
    console.log(JSON.stringify({ mode: 'restore', restored: count }, null, 2));
    return;
  }
  const plan = await buildPlan(prisma);
  const summary = {
    mode: args.apply ? 'apply' : 'dry-run',
    changes: plan.changes,
    shelfConflicts: plan.conflicts,
  };
  if (plan.conflicts.length > 0) {
    console.log(JSON.stringify({ ...summary, result: 'refused: shelves would share an area and shelf number' }, null, 2));
    process.exitCode = 2;
    return;
  }
  if (args.apply && plan.changes.length > 0) {
    await apply(plan, args.backup);
    summary.result = `applied ${plan.changes.length} changes; backup ${args.backup}`;
  } else {
    summary.result = plan.changes.length === 0 ? 'nothing to change' : 'dry run only';
  }
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
