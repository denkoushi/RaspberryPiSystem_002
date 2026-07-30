import { readProductionBuildConfig } from '../../config/productionBuildConfig';

export const DEFAULT_CLIENT_KEY =
  readProductionBuildConfig().defaultClientKey ?? 'client-key-raspberrypi4-kiosk1';

export const CLIENT_KEY_CONFIG = {
  storageKey: 'kiosk-client-key',
  keyPrefix: 'client-key-',
  defaultsByEnvironment: {
    mac: 'client-key-mac-kiosk1',
    linuxArm: DEFAULT_CLIENT_KEY,
    demo: 'client-demo-key'
  },
  pi4Key: 'client-key-raspberrypi4-kiosk1'
} as const;
