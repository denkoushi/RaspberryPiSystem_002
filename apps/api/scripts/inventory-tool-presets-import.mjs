/**
 * Load a supplier tool list (CSV on stdin) as pre-registered choices for the kiosk
 * registration pop-up (docs/plans/kiosk-inventory-ux-execplan.md, 2026-09-30).
 *
 * Default is a dry run that prints what would be added. `--apply` inserts the new
 * choices in one transaction; existing choices are skipped, nothing is updated or
 * deleted. To undo, `--remove` deletes exactly the choices listed by the same CSV.
 *
 * Run on Pi5 inside the running API container (find it with `docker ps | grep api`):
 *   docker exec -i -w /app/apps/api <api container> node scripts/inventory-tool-presets-import.mjs < 工具在庫一覧.csv
 *   docker exec -i -w /app/apps/api <api container> node scripts/inventory-tool-presets-import.mjs --apply < 工具在庫一覧.csv
 */
import { prisma } from '../dist/lib/prisma.js';
import { parseToolPresetCsv } from '../dist/services/item-inventory/tool-preset-csv.js';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const remove = args.includes('--remove');
  const unknown = args.filter((arg) => arg !== '--apply' && arg !== '--remove');
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown.join(' ')}`);
  if (apply && remove) throw new Error('Use either --apply or --remove');

  const { presets, warnings } = parseToolPresetCsv(await readStdin());
  const existing = await prisma.inventoryToolFieldPreset.findMany({ select: { field: true, value: true } });
  const known = new Set(existing.map((entry) => `${entry.field}\u0000${entry.value}`));
  const toAdd = presets.filter((entry) => !known.has(`${entry.field}\u0000${entry.value}`));
  const toRemove = presets.filter((entry) => known.has(`${entry.field}\u0000${entry.value}`));

  const summary = {
    mode: apply ? 'apply' : remove ? 'remove' : 'dry-run',
    parsed: presets.length,
    toAdd: remove ? [] : toAdd,
    alreadyPresent: remove ? [] : presets.length - toAdd.length,
    toRemove: remove ? toRemove : [],
    warnings,
  };
  if (apply && toAdd.length > 0) {
    await prisma.$transaction(toAdd.map((entry) => prisma.inventoryToolFieldPreset.create({ data: entry })));
    summary.result = `added ${toAdd.length}`;
  } else if (remove && toRemove.length > 0) {
    await prisma.$transaction(toRemove.map((entry) => prisma.inventoryToolFieldPreset.delete({ where: { field_value: entry } })));
    summary.result = `removed ${toRemove.length}`;
  } else {
    summary.result = apply || remove ? 'nothing to change' : 'dry run only';
  }
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
