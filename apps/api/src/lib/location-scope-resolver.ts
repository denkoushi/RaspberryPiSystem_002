export const DEFAULT_LOCATION_SCOPE_KEY = 'default';
const LOCATION_SEGMENT_DELIMITER = ' - ';

type ScopeKey<TScope extends string> = string & { readonly __scope: TScope };
export type SiteKey = ScopeKey<'SiteKey'>;
export type DeviceScopeKey = ScopeKey<'DeviceScopeKey'>;
export type DeviceName = ScopeKey<'DeviceName'>;
export type InfraHost = ScopeKey<'InfraHost'>;

export type ClientDeviceForScopeResolution = {
  id?: string;
  apiKey?: string;
  statusClientId?: string | null;
  name: string;
  location?: string | null;
};

export type CredentialIdentity = {
  clientDeviceId: string;
  apiKey: string;
  statusClientId: string | null;
};

export type StandardLocationScopeContext = {
  deviceScopeKey: DeviceScopeKey;
  siteKey: SiteKey;
  deviceName: DeviceName;
  infraHost: InfraHost;
  credentialIdentity: CredentialIdentity;
};

export type LocationScopeContext = StandardLocationScopeContext;

const normalizeToken = (value: string | null | undefined): string => value?.trim() ?? '';

const parseLocationSegments = (locationKey: string): { siteKey: string; deviceName: string } => {
  const normalized = normalizeToken(locationKey);
  if (!normalized) {
    return {
      siteKey: DEFAULT_LOCATION_SCOPE_KEY,
      deviceName: DEFAULT_LOCATION_SCOPE_KEY
    };
  }
  const delimiterIndex = normalized.indexOf(LOCATION_SEGMENT_DELIMITER);
  if (delimiterIndex < 0) {
    return {
      siteKey: normalized,
      deviceName: normalized
    };
  }
  const siteKey = normalizeToken(normalized.slice(0, delimiterIndex));
  const deviceName = normalizeToken(normalized.slice(delimiterIndex + LOCATION_SEGMENT_DELIMITER.length));
  return {
    siteKey: siteKey || normalized,
    deviceName: deviceName || normalized
  };
};

export const resolveSiteKeyFromScopeKey = (scopeKey: string): string => parseLocationSegments(scopeKey).siteKey;

export const resolveDeviceNameFromScopeKey = (scopeKey: string): string => parseLocationSegments(scopeKey).deviceName;

export const asSiteKey = (value: string): SiteKey => value as SiteKey;

export const asDeviceScopeKey = (value: string): DeviceScopeKey => value as DeviceScopeKey;

export const asDeviceName = (value: string): DeviceName => value as DeviceName;

export const asInfraHost = (value: string): InfraHost => value as InfraHost;

export const resolveLegacyLocationKey = (clientDevice: Pick<ClientDeviceForScopeResolution, 'location' | 'name'>): string => {
  const location = normalizeToken(clientDevice.location);
  if (location) {
    return location;
  }
  const name = normalizeToken(clientDevice.name);
  if (name) {
    return name;
  }
  return DEFAULT_LOCATION_SCOPE_KEY;
};

export const resolveDeviceScopeKey = (
  clientDevice: Pick<ClientDeviceForScopeResolution, 'location' | 'name'>
): DeviceScopeKey => asDeviceScopeKey(resolveLegacyLocationKey(clientDevice));

export const resolveSiteKey = (clientDevice: Pick<ClientDeviceForScopeResolution, 'location' | 'name'>): SiteKey =>
  asSiteKey(resolveSiteKeyFromScopeKey(resolveDeviceScopeKey(clientDevice)));

export const resolveDeviceName = (clientDevice: Pick<ClientDeviceForScopeResolution, 'location' | 'name'>): DeviceName =>
  asDeviceName(resolveDeviceNameFromScopeKey(resolveDeviceScopeKey(clientDevice)));

export const resolveInfraHost = (clientDevice: Pick<ClientDeviceForScopeResolution, 'name'>): InfraHost => {
  const host = normalizeToken(clientDevice.name);
  if (host) return asInfraHost(host);
  return asInfraHost(DEFAULT_LOCATION_SCOPE_KEY);
};

export const resolveCredentialIdentity = (
  clientDevice: Pick<ClientDeviceForScopeResolution, 'id' | 'apiKey' | 'statusClientId'>
): CredentialIdentity => ({
  clientDeviceId: normalizeToken(clientDevice.id),
  apiKey: normalizeToken(clientDevice.apiKey),
  statusClientId: clientDevice.statusClientId ?? null
});

const resolveStandardLocationScopeContext = (
  clientDevice: ClientDeviceForScopeResolution
): StandardLocationScopeContext => {
  const deviceScopeKey = resolveDeviceScopeKey(clientDevice);
  return {
    deviceScopeKey,
    siteKey: asSiteKey(resolveSiteKeyFromScopeKey(deviceScopeKey)),
    deviceName: asDeviceName(resolveDeviceNameFromScopeKey(deviceScopeKey)),
    infraHost: resolveInfraHost(clientDevice),
    credentialIdentity: resolveCredentialIdentity(clientDevice)
  };
};

export const resolveLocationScopeContext = (clientDevice: ClientDeviceForScopeResolution): StandardLocationScopeContext => {
  return resolveStandardLocationScopeContext(clientDevice);
};
