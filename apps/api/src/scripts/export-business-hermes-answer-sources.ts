/** Export current authorized candidates; answers and private Hermes history are excluded. */
import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { exportBusinessHermesSources } from '../services/assembly/business-hermes-source-export.js';
import { prisma } from '../lib/prisma.js';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--output' || !path.isAbsolute(args[1]!)) throw new Error('Use --output /private/sources.json');
const output = args[1]!;
try {
  const document = await exportBusinessHermesSources();
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  const temporary = output + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(document), { mode: 0o600 });
  await rename(temporary, output);
  console.log(JSON.stringify({ records: document.records.length, output }));
} finally { await prisma.$disconnect(); }
