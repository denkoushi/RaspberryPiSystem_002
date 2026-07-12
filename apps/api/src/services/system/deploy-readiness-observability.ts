export type DeployReadinessMetrics = {
  windowSeconds: number;
  sampleCount: number;
  serverErrorCount: number;
  errorRate: number;
};

export type DeployReadinessObservability = {
  recordResponse: (statusCode: number) => void;
  snapshot: () => DeployReadinessMetrics;
};

export function createDeployReadinessObservability(windowSeconds = 60): DeployReadinessObservability {
  const samples: Array<{ at: number; serverError: boolean }> = [];

  const prune = (now: number) => {
    const cutoff = now - windowSeconds * 1000;
    while (samples.length > 0 && samples[0]!.at < cutoff) {
      samples.shift();
    }
  };

  return {
    recordResponse(statusCode: number) {
      const now = Date.now();
      samples.push({ at: now, serverError: statusCode >= 500 });
      prune(now);
    },

    snapshot() {
      const now = Date.now();
      prune(now);
      const sampleCount = samples.length;
      const serverErrorCount = samples.filter((sample) => sample.serverError).length;
      return {
        windowSeconds,
        sampleCount,
        serverErrorCount,
        errorRate: sampleCount === 0 ? 0 : serverErrorCount / sampleCount,
      };
    },
  };
}
