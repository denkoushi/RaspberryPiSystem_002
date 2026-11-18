function numericVersion(version: string) {
  return /^\d+(\.\d+)*$/.test(version) ? version.split('.').map(part => BigInt(part)) : null;
}

function compareNumericVersions(left: bigint[], right: bigint[]) {
  for (const [index, part] of left.entries()) {
    const other = right[index];
    if (other === undefined || part > other) return 1;
    if (part < other) return -1;
  }
  return left.length - right.length;
}

function installedUpstreamVersion(value: string) {
  const version = /^[a-z0-9][a-z0-9+.-]*(?::[a-z0-9][a-z0-9-]*)?=(?:\d+:)?([0-9A-Za-z.+~-]+)$/.exec(value)?.[1];
  if (!version || version.endsWith('-')) return null;
  const revision = version.lastIndexOf('-');
  const upstream = revision < 0 ? version : version.slice(0, revision);
  return numericVersion(upstream.split(/[~+]/, 1)[0]);
}

function maximumVersion(fixed: string[]) {
  let maximum: { version: string; numeric: bigint[] } | undefined;
  for (const version of fixed) {
    const numeric = numericVersion(version);
    if (!numeric) return null;
    if (!maximum || compareNumericVersions(numeric, maximum.numeric) > 0) maximum = { version, numeric };
  }
  return maximum;
}

export function maximumFixedVersion(fixed: string[]): string | null {
  return maximumVersion(fixed)?.version ?? null;
}

export function allInstalledVersionsFixed(installed: string[], fixed: string[]) {
  const threshold = maximumVersion(fixed)?.numeric;
  if (!threshold || installed.length === 0) return false;

  return installed.every(version => {
    const numeric = installedUpstreamVersion(version);
    return numeric !== null && compareNumericVersions(numeric, threshold) >= 0;
  });
}
