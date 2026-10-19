import { BlockList, isIP } from 'node:net';

const loopbackAddresses = new BlockList();
loopbackAddresses.addSubnet('127.0.0.0', 8, 'ipv4');
loopbackAddresses.addAddress('::1', 'ipv6');

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const family = isIP(address);
  if (family === 0) return false;
  return loopbackAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6');
}
