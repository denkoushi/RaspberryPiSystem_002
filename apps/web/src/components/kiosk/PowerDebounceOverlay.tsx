import { FullScreenOverlay } from '../ui/FullScreenOverlay';

type PowerAction = 'reboot' | 'poweroff';

type PowerDebounceOverlayProps = {
  action: PowerAction | null;
};

const powerOverlayMessage: Record<PowerAction, string> = {
  reboot: '再起動を実行しています。しばらくお待ちください。',
  poweroff: 'シャットダウンを実行しています。まもなく画面が消えます。'
};

export function PowerDebounceOverlay({ action }: PowerDebounceOverlayProps) {
  const message = action ? powerOverlayMessage[action] : undefined;
  return <FullScreenOverlay isVisible={action !== null} message={message} />;
}
