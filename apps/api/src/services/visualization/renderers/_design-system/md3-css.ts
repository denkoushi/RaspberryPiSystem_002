import type { Md3Tokens } from './md3.js';

/**
 * Convert MD3 tokens (numbers/strings) into CSS variables for HTML previews.
 * Keep this module token-only (no layout logic) so renderers stay loosely coupled.
 */

function px(value: number): string {
  return `${Math.round(value)}px`;
}

export type CssVarMap = Record<string, string>;

export function tokensToCssVars(t: Md3Tokens): CssVarMap {
  return {
    '--rps-md3-scale': String(t.scale),

    '--rps-md3-color-surface-background': t.colors.surface.background,
    '--rps-md3-color-surface-container': t.colors.surface.container,
    '--rps-md3-color-surface-container-high': t.colors.surface.containerHigh,
    '--rps-md3-color-surface-container-highest': t.colors.surface.containerHighest,

    '--rps-md3-color-text-primary': t.colors.text.primary,
    '--rps-md3-color-text-secondary': t.colors.text.secondary,
    '--rps-md3-color-text-on-color': t.colors.text.onColor,

    '--rps-md3-color-outline': t.colors.outline,
    '--rps-md3-color-grid': t.colors.grid,

    '--rps-md3-color-status-success': t.colors.status.success,
    '--rps-md3-color-status-success-container': t.colors.status.successContainer,
    '--rps-md3-color-status-on-success-container': t.colors.status.onSuccessContainer,
    '--rps-md3-color-status-error': t.colors.status.error,
    '--rps-md3-color-status-error-container': t.colors.status.errorContainer,
    '--rps-md3-color-status-on-error-container': t.colors.status.onErrorContainer,
    '--rps-md3-color-status-warning': t.colors.status.warning,
    '--rps-md3-color-status-warning-container': t.colors.status.warningContainer,
    '--rps-md3-color-status-on-warning-container': t.colors.status.onWarningContainer,
    '--rps-md3-color-status-info': t.colors.status.info,
    '--rps-md3-color-status-info-container': t.colors.status.infoContainer,
    '--rps-md3-color-status-on-info-container': t.colors.status.onInfoContainer,

    '--rps-md3-color-table-header-fill': t.colors.table.headerFill,
    '--rps-md3-color-table-row-fill-even': t.colors.table.rowFillEven,
    '--rps-md3-color-table-row-fill-odd': t.colors.table.rowFillOdd,

    '--rps-md3-color-card-fill': t.colors.card.fill,
    '--rps-md3-color-card-border': t.colors.card.border,

    '--rps-md3-typography-title-size': px(t.typography.title.size),
    '--rps-md3-typography-title-weight': String(t.typography.title.weight),
    '--rps-md3-typography-header-size': px(t.typography.header.size),
    '--rps-md3-typography-header-weight': String(t.typography.header.weight),
    '--rps-md3-typography-body-size': px(t.typography.body.size),
    '--rps-md3-typography-body-weight': String(t.typography.body.weight),
    '--rps-md3-typography-label-size': px(t.typography.label.size),
    '--rps-md3-typography-label-weight': String(t.typography.label.weight),

    '--rps-md3-spacing-xs': px(t.spacing.xs),
    '--rps-md3-spacing-sm': px(t.spacing.sm),
    '--rps-md3-spacing-md': px(t.spacing.md),
    '--rps-md3-spacing-lg': px(t.spacing.lg),
    '--rps-md3-spacing-xl': px(t.spacing.xl),

    '--rps-md3-shape-radius-sm': px(t.shape.radiusSm),
    '--rps-md3-shape-radius-md': px(t.shape.radiusMd),
    '--rps-md3-shape-radius-lg': px(t.shape.radiusLg),
  };
}

export function renderCssVars(selector: string, vars: CssVarMap): string {
  const lines = Object.entries(vars)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n');
  return `${selector} {\n${lines}\n}\n`;
}

