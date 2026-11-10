export function hasSharedProductionJwtSecret(config: { NODE_ENV: string; JWT_ACCESS_SECRET: string; JWT_REFRESH_SECRET: string }): boolean {
  return config.NODE_ENV === 'production' && config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET;
}
