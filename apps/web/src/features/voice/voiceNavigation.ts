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
  { names: ['組立'], path: KIOSK_ASSEMBLY_HOME_PATH, label: '組立' },
  { names: ['訓練', '組立の訓練'], path: KIOSK_ASSEMBLY_TRAINING_PATH, label: '組立 > 訓練' },
  { names: ['チェックシート', '組立のチェックシート'], path: KIOSK_ASSEMBLY_CHECK_SHEETS_PATH, label: '組立 > チェックシート' },
  { names: ['製品構成', '組立の製品構成'], path: KIOSK_ASSEMBLY_TRACEABILITY_PATH, label: '組立 > 製品構成' },
  { names: ['組立の記録確認'], path: KIOSK_ASSEMBLY_RECORD_APPROVALS_PATH, label: '組立 > 記録確認' },
  { names: ['組立の使う'], path: kioskAssemblyLibraryPath({ focus: 'templates' }), label: '組立 > 使う' },
  { names: ['生産スケジュール', '生産日程'], path: KIOSK_INITIAL_ROUTE_PATHS.production_schedule, label: '生産スケジュール' }
] as const;

export function resolveVoiceNavigation(transcript: string): { path: string; label: string } | null {
  let name = transcript.replace(/[、。,.!！?？]/gu, '').trim().replace(/^キット\s*/u, '');
  // Remove only command suffixes, then the optional screen suffix. Never match substrings.
  name = name.replace(/(?:を開いて|開いて|を開く|開く|に移動|へ移動|に行って|を表示)$/u, '').trim();
  name = name.replace(/(?:の画面|画面)$/u, '').trim();
  const matches = VOICE_NAVIGATION_SCREENS.filter(screen => (screen.names as readonly string[]).includes(name));
  return matches.length === 1 ? { path: matches[0].path, label: matches[0].label } : null;
}
