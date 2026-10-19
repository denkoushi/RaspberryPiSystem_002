/**
 * Register or reconcile the canonical torque-training catalogue.
 *
 * Dry-run is the default-safe mode for operational use:
 *
 *   pnpm --filter @raspi-system/api register:torque-training-catalog -- --dry-run
 *   pnpm --filter @raspi-system/api register:torque-training-catalog -- \
 *     --wrench-serial 702902S --legacy-m5-code OLD-M5-CODE
 *
 * The command never deletes a program or a version.  A legacy M5 code is
 * deactivated only when it is explicitly supplied.
 */

import { prisma } from '../lib/prisma.js';
import { TorqueTrainingCatalogRegistrationService } from '../services/torque-training/torque-training-catalog-registration.service.js';
import { parseTorqueTrainingCatalogArguments } from '../services/torque-training/torque-training-catalog-cli.js';

async function main(): Promise<number> {
  const options = parseTorqueTrainingCatalogArguments(process.argv.slice(2));
  const result = await new TorqueTrainingCatalogRegistrationService().register(options);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

void main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(
      '[register-torque-training-catalog] Error:',
      error instanceof Error ? error.message : String(error)
    );
    process.exitCode = 1;
  })
  .finally(() =>
    prisma.$disconnect().catch(() => {
      /* ignore */
    })
  );
