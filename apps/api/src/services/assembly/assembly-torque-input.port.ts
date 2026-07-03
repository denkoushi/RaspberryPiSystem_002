import type { AssemblyTorqueInputSource } from '@prisma/client';

export type TorqueInputPortSource = Lowercase<AssemblyTorqueInputSource>;

export type TorqueInputPayload = {
  value: number;
  source: TorqueInputPortSource;
  rawPayload?: unknown;
};

export const TORQUE_INPUT_PORT_SOURCES = ['manual', 'mock', 'agent'] as const;

export function toPrismaTorqueInputSource(source: TorqueInputPortSource): AssemblyTorqueInputSource {
  return source.toUpperCase() as AssemblyTorqueInputSource;
}
