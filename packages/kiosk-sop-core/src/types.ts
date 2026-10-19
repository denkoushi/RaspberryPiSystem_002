export type KioskSopNecessity = 'required' | 'optional';

export type KioskSopViewport = Readonly<{
  width: number;
  height: number;
  deviceScaleFactor: 1;
}>;

export type KioskSopTarget = Readonly<{
  x: number;
  y: number;
}>;

export type KioskSopStep = Readonly<{
  id: string;
  targetId: string;
  necessity: KioskSopNecessity;
  title: string;
  description: string;
  target: KioskSopTarget;
}>;

export type KioskSopSheet = Readonly<{
  id: string;
  title: string;
  summary: string;
  screenImageDataUrl: string;
  steps: readonly KioskSopStep[];
}>;

export type KioskSopScenario = Readonly<{
  id: string;
  productionRoute: string;
  fixtureId: string;
  viewport: KioskSopViewport;
  sheets: readonly KioskSopSheet[];
}>;

export type KioskSopExclusion = Readonly<{
  id: string;
  reason: string;
}>;

export type KioskSopDefinition = Readonly<{
  schemaVersion: 1;
  id: string;
  title: string;
  entrySources: readonly string[];
  supplementalWatchGlobs: readonly string[];
  exclusions: readonly KioskSopExclusion[];
  scenarios: readonly KioskSopScenario[];
}>;

export type KioskSopManifest = Readonly<{
  schemaVersion: 1;
  generatorVersion: string;
  browserVersion: string;
  definitionSha256: string;
  sourceSha256: string;
  htmlSha256: string;
  geometry: Readonly<Record<string, readonly Readonly<{
    id: string;
    targetId: string;
    target: KioskSopTarget;
    semantics: Readonly<{
      tagName: string;
      role: string | null;
      text: string;
      ariaLabel: string | null;
    }>;
  }>[]>>;
  artifacts: Readonly<Record<string, string>>;
}>;
