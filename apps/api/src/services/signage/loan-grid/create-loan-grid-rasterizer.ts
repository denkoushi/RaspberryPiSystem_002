import { env } from '../../../config/env.js';
import type { LoanGridRasterizerPort } from './loan-grid-rasterizer.port.js';
import type { SvgLoanGridDependencies } from './svg-loan-grid-dependencies.js';
import { SvgLegacyLoanGridRasterizer } from './svg-legacy-loan-grid-rasterizer.js';
import { PlaywrightLoanGridRasterizer } from './playwright/playwright-loan-grid-rasterizer.js';

export function createLoanGridRasterizer(deps: SvgLoanGridDependencies): LoanGridRasterizerPort {
  if (env.SIGNAGE_LOAN_GRID_ENGINE === 'playwright_html') {
    return new PlaywrightLoanGridRasterizer();
  }
  return new SvgLegacyLoanGridRasterizer(deps);
}
