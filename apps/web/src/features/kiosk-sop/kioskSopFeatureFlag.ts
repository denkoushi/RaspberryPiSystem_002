import { readProductionBuildConfig } from '../../config/productionBuildConfig';

/** Draft SOPs are available in DEV or an explicitly enabled release build. */
const buildConfig = readProductionBuildConfig();
export const KIOSK_SOP_POPUP_ENABLED =
  buildConfig.isDevelopment || buildConfig.sopPopupEnabled;
