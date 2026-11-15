import { KIOSK_INITIAL_ROUTE_PATHS } from '@raspi-system/shared-types';

import {
  KIOSK_ASSEMBLY_HOME_PATH,
  KIOSK_ASSEMBLY_TRAINING_PATH,
  KIOSK_ASSEMBLY_CHECK_SHEETS_PATH,
  KIOSK_ASSEMBLY_TRACEABILITY_PATH,
  KIOSK_ASSEMBLY_RECORD_APPROVALS_PATH,
  kioskAssemblyLibraryPath
} from '../assembly/assemblyRoutes';

export const VOICE_NAVIGATION_SCREENS = [
  { names: ['組立'], readings: ['kumitate'], path: KIOSK_ASSEMBLY_HOME_PATH, label: '組立' },
  { names: ['訓練', '組立の訓練'], readings: ['kunren', 'kumitatenokunren'], path: KIOSK_ASSEMBLY_TRAINING_PATH, label: '組立 > 訓練' },
  { names: ['チェックシート', '組立のチェックシート'], readings: ['chekkushiito', 'kumitatenochekkushiito'], path: KIOSK_ASSEMBLY_CHECK_SHEETS_PATH, label: '組立 > チェックシート' },
  { names: ['製品構成', '組立の製品構成'], readings: ['seihinkousei', 'kumitatenoseihinkousei'], path: KIOSK_ASSEMBLY_TRACEABILITY_PATH, label: '組立 > 製品構成' },
  { names: ['組立の記録確認'], readings: ['kumitatenokirokukakunin'], path: KIOSK_ASSEMBLY_RECORD_APPROVALS_PATH, label: '組立 > 記録確認' },
  { names: ['組立の使う'], readings: ['kumitatenotsukau'], path: kioskAssemblyLibraryPath({ focus: 'templates' }), label: '組立 > 使う' },
  { names: ['生産スケジュール', '生産日程'], readings: ['seisansukejuuru', 'seisannittei'], path: KIOSK_INITIAL_ROUTE_PATHS.production_schedule, label: '生産スケジュール' }
] as const;

function normalizeRomaji(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/gu, '')
    .replace(/v/gu, 'b').replace(/[gbdzl]/gu, letter => ({ g: 'k', b: 'p', d: 't', z: 's', l: 'r' })[letter]!)
    .replace(/ou|oo|uu/gu, 'u');
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function resolveRomajiNavigation(transcript: string): { path: string; label: string } | null {
  // Gate the original transcript before removing calls or commands.
  const text = transcript.toLowerCase();
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text)
    || !/^[a-z\s\p{P}\p{S}]*$/u.test(text)) return null;
  const words = text.match(/[a-z]+/gu) ?? [];
  if (words.length < 1 || words.length > 3 || words.join('').length > 12) return null;

  let name = words.join(' ').replace(/^kitt?o\s+/u, '').replace(/\s/gu, '');
  name = name.replace(/(?:wohiraite|hiraite|wohiraku|hiraku|niidou|heidou|niitte|wohyouji)$/u, '');
  name = name.replace(/(?:nogamen|gamen)$/u, '');
  const normalized = normalizeRomaji(name);
  const candidates = VOICE_NAVIGATION_SCREENS.map(screen => {
    const readings = screen.readings.map(reading => {
      const normalizedReading = normalizeRomaji(reading);
      const distance = editDistance(normalized, normalizedReading);
      return { distance, ratio: distance / normalizedReading.length };
    }).sort((left, right) => left.distance - right.distance || left.ratio - right.ratio);
    return { screen, ...readings[0] };
  }).sort((left, right) => left.distance - right.distance);
  const best = candidates[0];
  return best.distance <= 2 && best.ratio <= 0.34 && best.distance < candidates[1].distance
    ? { path: best.screen.path, label: best.screen.label }
    : null;
}

export function resolveVoiceNavigation(transcript: string): { path: string; label: string } | null {
  let name = transcript.replace(/[、。,.!！?？]/gu, '').trim().replace(/^キット\s*/u, '');
  // Remove only command suffixes, then the optional screen suffix. Never match substrings.
  name = name.replace(/(?:を開いて|開いて|を開く|開く|に移動|へ移動|に行って|を表示)$/u, '').trim();
  name = name.replace(/(?:の画面|画面)$/u, '').trim();
  const matches = VOICE_NAVIGATION_SCREENS.filter(screen => (screen.names as readonly string[]).includes(name));
  return matches.length === 1
    ? { path: matches[0].path, label: matches[0].label }
    : resolveRomajiNavigation(transcript);
}
