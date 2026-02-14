export type Md3Tokens = {
  scale: number;
  colors: {
    surface: {
      background: string;
      container: string;
      containerHigh: string;
      containerHighest: string;
    };
    text: {
      primary: string;
      secondary: string;
      onColor: string;
    };
    outline: string;
    grid: string;
    status: {
      success: string;
      successContainer: string;
      onSuccessContainer: string;
      error: string;
      errorContainer: string;
      onErrorContainer: string;
      warning: string;
      warningContainer: string;
      onWarningContainer: string;
      info: string;
      infoContainer: string;
      onInfoContainer: string;
    };
    table: {
      headerFill: string;
      rowFillEven: string;
      rowFillOdd: string;
    };
    card: {
      fill: string;
      border: string;
    };
  };
  typography: {
    title: { size: number; weight: number };
    header: { size: number; weight: number };
    body: { size: number; weight: number };
    label: { size: number; weight: number };
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
  shape: {
    radiusSm: number;
    radiusMd: number;
    radiusLg: number;
  };
};

function px(base: number, scale: number, min: number): number {
  return Math.max(min, Math.round(base * scale));
}

/**
 * Material Design 3 (dark) tokens for server-side SVG renderers.
 * - SVG renderer cannot use CSS variables, so we provide computed numbers/strings.
 * - This module must stay "token-only" (no layout logic) to keep renderers loosely coupled.
 */
export function createMd3Tokens(params: { width: number; height: number }): Md3Tokens {
  const scale = params.width / 1920;

  // Colors are aligned to a MD3-like dark palette (high contrast for signage).
  // Keep them as plain strings so individual renderers can use them directly.
  const colors = {
    surface: {
      background: '#0f1116',
      container: '#1a1d24',
      containerHigh: '#252932',
      containerHighest: '#30343a',
    },
    text: {
      primary: '#e3e7ed',
      secondary: '#c3c7cf',
      onColor: '#0b1020',
    },
    outline: '#8d9199',
    grid: '#334155',
    status: {
      success: '#81c995',
      successContainer: '#00512b',
      onSuccessContainer: '#a0f5b8',
      error: '#f28b82',
      errorContainer: '#8c1d18',
      onErrorContainer: '#f9dedc',
      warning: '#ffb84d',
      warningContainer: '#4d3800',
      onWarningContainer: '#ffdca8',
      info: '#8ab4f8',
      infoContainer: '#2d4a7a',
      onInfoContainer: '#d6e3ff',
    },
    table: {
      headerFill: '#252932',
      rowFillEven: '#1a1d24',
      rowFillOdd: '#0f1116',
    },
    card: {
      fill: 'rgba(255,255,255,0.06)',
      border: 'rgba(255,255,255,0.12)',
    },
  } as const;

  const spacing = {
    xs: px(4, scale, 2),
    sm: px(8, scale, 4),
    md: px(16, scale, 8),
    lg: px(24, scale, 12),
    xl: px(32, scale, 16),
  };

  const typography = {
    title: { size: px(32, scale, 20), weight: 700 },
    header: { size: px(16, scale, 12), weight: 700 },
    body: { size: px(15, scale, 11), weight: 600 },
    label: { size: px(12, scale, 10), weight: 600 },
  };

  const shape = {
    radiusSm: px(8, scale, 6),
    radiusMd: px(12, scale, 8),
    radiusLg: px(16, scale, 10),
  };

  return { scale, colors, typography, spacing, shape };
}

