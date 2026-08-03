import {
  readProductionBuildConfig,
  resolveProductionDefaultClientKey,
} from '../../config/productionBuildConfig';

const productionBuildConfig = readProductionBuildConfig();

export const DEFAULT_CLIENT_KEY = resolveProductionDefaultClientKey(productionBuildConfig);

export const CLIENT_KEY_CONFIG = {
  storageKey: 'kiosk-client-key',
  keyPrefix: 'client-key-',
  defaultsByEnvironment: {
    mac: 'client-key-mac-kiosk1',
    linuxArm: DEFAULT_CLIENT_KEY,
    demo: 'client-demo-key'
  },
  implicitDevelopmentDefaults: productionBuildConfig.isDevelopment,
  pi4Key: 'client-key-raspberrypi4-kiosk1'
} as const;
