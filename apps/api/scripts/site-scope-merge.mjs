/**
 * Merge an accidental site's 製番ボード data into a real site and assign
 * devices to that site (docs/plans/explicit-site-scope-execplan.md, Milestone 4b).
 *
 * Default is a dry run that only reads and prints the plan. `--apply` first
 * writes a JSON backup of every row it will change, then applies the plan in
 * one transaction. Re-running is safe: already merged items and assigned
 * devices are skipped. Nothing is deleted.
 *
 * Rules (decided with the user on 2026-09-26):
 * - Registered seibans: keep the target order and append source seibans the
 *   target does not have, in source order (limit 50).
 * - Per-item overrides: move source overrides whose item is not overridden in
 *   the target; the target wins on conflicts (conflicting source rows stay
 *   where they are). Moved overrides lose `alternateRank` so they cannot
 *   collide with the target's manual order.
 * - Global rankings are not merged.
 * - Devices without an explicit site get the target site (`--assign-devices`).
 *
 * Run on Pi5 (API container, working directory /app/apps/api):
 *   node scripts/site-scope-merge.mjs --source=Mac --target=第2工場 --assign-devices
 *   node scripts/site-scope-merge.mjs --source=Mac --target=第2工場 --assign-devices --apply --backup=/opt/backups/site-scope-merge-backup.json
 * Undo from the backup (restores the target order, moves overrides back with
 * their original alternateRank, clears the assigned device sites):
 *   node scripts/site-scope-merge.mjs --restore=/opt/backups/site-scope-merge-backup.json
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { prisma } from '../dist/lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../dist/services/production-schedule/constants.js';

const REGISTERED_SEIBAN_MAX = 50;

function parseArgs(argv) {
  const args = { source: '', target: '', apply: false, assignDevices: false, backup: '', restore: '' };
  for (const arg of argv) {
    if (arg.startsWith('--restore=')) args.restore = arg.slice('--restore='.length).trim();
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--assign-devices') args.assignDevices = true;
    else if (arg.startsWith('--source=')) args.source = arg.slice('--source='.length).trim();
    else if (arg.startsWith('--target=')) args.target = arg.slice('--target='.length).trim();
    else if (arg.startsWith('--backup=')) args.backup = arg.slice('--backup='.length).trim();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.restore) return args;
  if (!args.source || !args.target) throw new Error('--source and --target are required');
  if (args.source === args.target) throw new Error('--source and --target must differ');
  if (args.apply && !args.backup) throw new Error('--apply requires --backup=<path>');
  return args;
}

const asStringArray = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);

async function buildPlan(client, { source, target, assignDevices }) {
  const site = await client.site.findUnique({ where: { key: target } });
  if (!site) throw new Error(`Target site is not registered: ${target}`);

  const states = await client.productionScheduleGrindingPlanningBoardState.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: { in: [source, target] } }
  });
  const sourceState = states.find((state) => state.siteKey === source) ?? null;
  const targetState = states.find((state) => state.siteKey === target) ?? null;
  const targetOrder = asStringArray(targetState?.seibanOrder);
  const appended = asStringArray(sourceState?.seibanOrder).filter((fseiban) => !targetOrder.includes(fseiban));
  const mergedOrder = [...targetOrder, ...appended];
  if (mergedOrder.length > REGISTERED_SEIBAN_MAX) {
    throw new Error(`Merged registered seibans (${mergedOrder.length}) exceed the limit ${REGISTERED_SEIBAN_MAX}`);
  }

  const overrides = await client.productionScheduleGrindingPlanningBoardOverride.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: { in: [source, target] } }
  });
  const targetItemKeys = new Set(overrides.filter((row) => row.siteKey === target).map((row) => row.itemKey));
  const sourceOverrides = overrides.filter((row) => row.siteKey === source);
  const movedOverrides = sourceOverrides.filter((row) => !targetItemKeys.has(row.itemKey));
  const conflictingOverrides = sourceOverrides.filter((row) => targetItemKeys.has(row.itemKey));

  const devices = assignDevices
    ? await client.clientDevice.findMany({
        where: { siteKey: null },
        select: { id: true, name: true, location: true, siteKey: true },
        orderBy: { name: 'asc' }
      })
    : [];

  return { source, target, sourceState, targetState, targetOrder, appended, mergedOrder, movedOverrides, conflictingOverrides, devices };
}

function summarize(plan) {
  return {
    source: plan.source,
    target: plan.target,
    registeredSeibans: {
      target: plan.targetOrder,
      appendedFromSource: plan.appended,
      merged: plan.mergedOrder,
      createsTargetState: plan.targetState === null && plan.appended.length > 0
    },
    overrides: {
      move: plan.movedOverrides.length,
      moveWithAlternateRankCleared: plan.movedOverrides.filter((row) => row.alternateRank !== null).length,
      keptInSourceBecauseTargetWins: plan.conflictingOverrides.length
    },
    devicesToAssign: plan.devices.map((device) => ({ name: device.name, location: device.location }))
  };
}

async function apply(plan, backupPath) {
  const writesTargetState = plan.appended.length > 0;
  const createdTargetStateId = writesTargetState && !plan.targetState ? randomUUID() : null;
  // The expected post-merge state lets --restore refuse to overwrite later edits.
  const backup = {
    createdAt: new Date().toISOString(),
    source: plan.source,
    target: plan.target,
    sourceState: plan.sourceState,
    targetState: plan.targetState,
    createdTargetStateId,
    mergedTargetState: writesTargetState
      ? { seibanOrder: plan.mergedOrder, version: plan.targetState ? plan.targetState.version + 1 : 1 }
      : null,
    movedOverrides: plan.movedOverrides,
    devices: plan.devices
  };
  writeFileSync(backupPath, `${JSON.stringify(backup, null, 2)}\n`, { flag: 'wx' });

  await prisma.$transaction(async (tx) => {
    if (plan.appended.length > 0) {
      if (plan.targetState) {
        const updated = await tx.productionScheduleGrindingPlanningBoardState.updateMany({
          where: { id: plan.targetState.id, version: plan.targetState.version },
          data: { seibanOrder: plan.mergedOrder, version: { increment: 1 } }
        });
        if (updated.count !== 1) throw new Error('Target board state changed during the merge; re-run the dry run');
      } else {
        await tx.productionScheduleGrindingPlanningBoardState.create({
          data: {
            id: createdTargetStateId,
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            siteKey: plan.target,
            seibanOrder: plan.mergedOrder
          }
        });
      }
    }
    for (const row of plan.movedOverrides) {
      const moved = await tx.productionScheduleGrindingPlanningBoardOverride.updateMany({
        where: { id: row.id, siteKey: plan.source, version: row.version },
        data: { siteKey: plan.target, alternateRank: null, version: { increment: 1 } }
      });
      if (moved.count !== 1) throw new Error(`Override ${row.id} changed during the merge; re-run the dry run`);
    }
    if (plan.devices.length > 0) {
      const assigned = await tx.clientDevice.updateMany({
        where: { id: { in: plan.devices.map((device) => device.id) }, siteKey: null },
        data: { siteKey: plan.target }
      });
      if (assigned.count !== plan.devices.length) throw new Error('Devices changed during the merge; re-run the dry run');
    }
  });
}

const sameOrder = (left, right) => JSON.stringify(asStringArray(left)) === JSON.stringify(asStringArray(right));

/**
 * Undo a merge. Every changed row must still be exactly as the merge left it;
 * if anyone edited the target board afterwards, nothing is written.
 */
async function restore(backupPath) {
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  await prisma.$transaction(async (tx) => {
    if (backup.mergedTargetState) {
      const stateId = backup.createdTargetStateId ?? backup.targetState?.id;
      const current = await tx.productionScheduleGrindingPlanningBoardState.findUnique({ where: { id: stateId } });
      if (
        !current ||
        current.version !== backup.mergedTargetState.version ||
        !sameOrder(current.seibanOrder, backup.mergedTargetState.seibanOrder)
      ) {
        throw new Error('The target 製番ボード changed after the merge; restore aborted without writing');
      }
      if (backup.createdTargetStateId) {
        await tx.productionScheduleGrindingPlanningBoardState.delete({ where: { id: stateId } });
      } else {
        await tx.productionScheduleGrindingPlanningBoardState.update({
          where: { id: stateId },
          data: { seibanOrder: backup.targetState.seibanOrder, version: { increment: 1 } }
        });
      }
    }
    for (const row of backup.movedOverrides) {
      const restored = await tx.productionScheduleGrindingPlanningBoardOverride.updateMany({
        where: { id: row.id, siteKey: backup.target, version: row.version + 1 },
        data: { siteKey: backup.source, alternateRank: row.alternateRank, version: { increment: 1 } }
      });
      if (restored.count !== 1) {
        throw new Error(`Override ${row.id} changed after the merge; restore aborted without writing`);
      }
    }
    if (backup.devices.length > 0) {
      await tx.clientDevice.updateMany({
        where: { id: { in: backup.devices.map((device) => device.id) }, siteKey: backup.target },
        data: { siteKey: null }
      });
    }
  });
  return backup;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.restore) {
    const backup = await restore(args.restore);
    process.stdout.write(
      `${JSON.stringify({ mode: 'restored', backup: args.restore, overrides: backup.movedOverrides.length, devices: backup.devices.length }, null, 2)}\n`
    );
    return;
  }
  const plan = await buildPlan(prisma, args);
  const summary = summarize(plan);
  if (!args.apply) {
    process.stdout.write(`${JSON.stringify({ mode: 'dry-run', ...summary }, null, 2)}\n`);
    return;
  }
  await apply(plan, args.backup);
  process.stdout.write(`${JSON.stringify({ mode: 'applied', backup: args.backup, ...summary }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
