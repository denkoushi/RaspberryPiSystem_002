/** 検査図面作成/改版画面の戻り先（React Router `location.state`） */
export type InspectionDrawingLocationReturn = {
  inspectionDrawingReturnTo: string;
  inspectionDrawingReturnLabel: string;
};

function readTrimmedString(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

/**
 * 単一 `/` 始まりの pathname を正規化する（`..` 解決・クエリ/ハッシュ除去）。
 * ルート外への脱出や不正形式は null。
 */
export function normalizeInternalInspectionDrawingReturnPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return null;
  }
  if (trimmed.includes('://') || trimmed.includes('\\')) {
    return null;
  }

  const pathnameOnly = trimmed.split(/[?#]/)[0] ?? '';
  const segments = pathnameOnly.split('/').filter((segment) => segment.length > 0);
  const resolved: string[] = [];

  for (const segment of segments) {
    if (segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (resolved.length === 0) {
        return null;
      }
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }

  return resolved.length === 0 ? '/' : `/${resolved.join('/')}`;
}

/** 許可された内部戻り先 pathname か（正規化後に allowlist と完全一致） */
export function isSafeInspectionDrawingReturnPath(
  path: string,
  allowedReturnPaths: readonly string[]
): boolean {
  const normalized = normalizeInternalInspectionDrawingReturnPath(path);
  if (!normalized) {
    return false;
  }
  return allowedReturnPaths.includes(normalized);
}

/** 許可された戻り先 pathname と表示ラベルの対（ラベルは state ではなくここから決定） */
export type InspectionDrawingReturnPreset = {
  pathname: string;
  label: string;
};

export type ParseInspectionDrawingReturnOptions = {
  fallback: InspectionDrawingLocationReturn;
  returnPresets: readonly InspectionDrawingReturnPreset[];
};

function findReturnPresetByPathname(
  normalizedPathname: string,
  presets: readonly InspectionDrawingReturnPreset[]
): InspectionDrawingReturnPreset | undefined {
  return presets.find((preset) => preset.pathname === normalizedPathname);
}

export function parseInspectionDrawingReturnFromLocation(
  state: unknown,
  options: ParseInspectionDrawingReturnOptions
): InspectionDrawingLocationReturn {
  const { fallback, returnPresets } = options;
  const allowedReturnPaths = returnPresets.map((preset) => preset.pathname);

  if (!state || typeof state !== 'object') {
    return fallback;
  }

  const record = state as Record<string, unknown>;
  const to = readTrimmedString(record.inspectionDrawingReturnTo);
  if (!to || !isSafeInspectionDrawingReturnPath(to, allowedReturnPaths)) {
    return fallback;
  }

  const normalizedTo = normalizeInternalInspectionDrawingReturnPath(to);
  if (!normalizedTo) {
    return fallback;
  }

  const preset = findReturnPresetByPathname(normalizedTo, returnPresets);
  if (!preset) {
    return fallback;
  }

  return { inspectionDrawingReturnTo: normalizedTo, inspectionDrawingReturnLabel: preset.label };
}
