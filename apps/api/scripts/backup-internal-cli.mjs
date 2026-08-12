import { pathToFileURL } from 'node:url';

const INTERNAL_BACKUP_URL = 'http://127.0.0.1:8080/api/backup/internal';

function parseOptions(argv) {
  const values = new Map();
  const allowed = new Set(['--kind', '--source', '--label']);

  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name || !allowed.has(name) || values.has(name) || value === undefined || value.startsWith('--')) {
      throw new Error('usage: backup-internal-cli --kind KIND --source SOURCE [--label LABEL]');
    }
    values.set(name, value);
  }

  const kind = values.get('--kind');
  const source = values.get('--source');
  const label = values.get('--label');
  if (!kind?.trim() || !source?.trim() || (label !== undefined && !label.trim())) {
    throw new Error('usage: backup-internal-cli --kind KIND --source SOURCE [--label LABEL]');
  }

  return { kind, source, ...(label === undefined ? {} : { label }) };
}

export async function runInternalBackupCli(
  argv,
  dependencies = {
    fetch: globalThis.fetch,
    writeStdout: (value) => process.stdout.write(value),
    writeStderr: (value) => process.stderr.write(value),
  }
) {
  let options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    dependencies.writeStderr(`${error instanceof Error ? error.message : 'invalid arguments'}\n`);
    return 2;
  }

  const payload = {
    kind: options.kind,
    source: options.source,
    ...(options.label === undefined ? {} : { metadata: { label: options.label } }),
  };

  try {
    const response = await dependencies.fetch(INTERNAL_BACKUP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const responseBody = await response.text();
    if (!response.ok) {
      dependencies.writeStderr(`internal backup request failed with HTTP ${response.status}\n`);
      return 1;
    }

    const parsed = JSON.parse(responseBody);
    if (parsed.success !== true) {
      dependencies.writeStderr('internal backup response did not report success\n');
      return 1;
    }

    dependencies.writeStdout(`${responseBody}\n`);
    return 0;
  } catch {
    dependencies.writeStderr('internal backup request failed\n');
    return 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  void runInternalBackupCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
