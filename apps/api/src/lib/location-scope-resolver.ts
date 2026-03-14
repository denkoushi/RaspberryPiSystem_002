export const DEFAULT_LOCATION_SCOPE_KEY = 'default';
const LOCATION_SEGMENT_DELIMITER = ' - ';

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

export type LocationScopeContext = {
  legacyLocationKey: string;
  deviceScopeKey: string;
  siteKey: string;
  deviceName: string;
  infraHost: string;
  credentialIdentity: CredentialIdentity;
};

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

export const resolveDeviceScopeKey = (clientDevice: Pick<ClientDeviceForScopeResolution, 'location' | 'name'>): string =>
  resolveLegacyLocationKey(clientDevice);

export const resolveSiteKey = (clientDevice: Pick<ClientDeviceForScopeResolution, 'location' | 'name'>): string =>
  parseLocationSegments(resolveDeviceScopeKey(clientDevice)).siteKey;

export const resolveDeviceName = (clientDevice: Pick<ClientDeviceForScopeResolution, 'location' | 'name'>): string =>
  parseLocationSegments(resolveDeviceScopeKey(clientDevice)).deviceName;

export const resolveInfraHost = (clientDevice: Pick<ClientDeviceForScopeResolution, 'name'>): string => {
  const host = normalizeToken(clientDevice.name);
  if (host) return host;
  return DEFAULT_LOCATION_SCOPE_KEY;
};

export const resolveCredentialIdentity = (
  clientDevice: Pick<ClientDeviceForScopeResolution, 'id' | 'apiKey' | 'statusClientId'>
): CredentialIdentity => ({
  clientDeviceId: normalizeToken(clientDevice.id),
  apiKey: normalizeToken(clientDevice.apiKey),
  statusClientId: clientDevice.statusClientId ?? null
});

export const resolveLocationScopeContext = (clientDevice: ClientDeviceForScopeResolution): LocationScopeContext => {
  const deviceScopeKey = resolveDeviceScopeKey(clientDevice);
  return {
    legacyLocationKey: resolveLegacyLocationKey(clientDevice),
    deviceScopeKey,
    siteKey: parseLocationSegments(deviceScopeKey).siteKey,
    deviceName: parseLocationSegments(deviceScopeKey).deviceName,
    infraHost: resolveInfraHost(clientDevice),
    credentialIdentity: resolveCredentialIdentity(clientDevice)
  };
};
