import { describe, expect, it } from 'vitest';

import { resolveVoiceNavigation, VOICE_NAVIGATION_SCREENS } from './voiceNavigation';

describe('resolveVoiceNavigation', () => {
  it.each(['キット、訓練', '訓練を開いて', ' 訓練の画面を開いて！ ', '訓練画面に移動', '訓練へ移動', '訓練に行って', '訓練を表示', '訓練を開く', '訓練開く'])('matches training: %s', text => {
    expect(resolveVoiceNavigation(text)).toEqual({ path: '/kiosk/assembly/training', label: '組立 > 訓練' });
  });
  it.each(VOICE_NAVIGATION_SCREENS.flatMap(screen => screen.names.map(name => ({ name, path: screen.path, label: screen.label }))))('matches $name', ({ name, path, label }) => {
    expect(resolveVoiceNavigation(name)).toEqual({ path, label });
  });
  it.each(['製番 A24117 の納期はいつ', '訓練の手順を教えて', '訓練を開いてくださいませんか', '使う', '記録確認', '', '別のチェックシート', '訓練と組立'])('rejects %s', text => {
    expect(resolveVoiceNavigation(text)).toBeNull();
  });
});
