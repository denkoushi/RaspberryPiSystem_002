import type { ScenarioActionType } from './loadBalancingScenario';

const PATHS: Record<ScenarioActionType, JSX.Element> = {
  outsource: (
    <>
      <path d="M3 7h11v10H3zM14 10h4l3 3v4h-7" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </>
  ),
  transfer: <path d="M4 8h14l-4-4M20 16H6l4 4" />,
  defer: <path d="M5 12h13M13 6l6 6-6 6" />
};

export function LoadBalancingActionIcon({ type }: { type: ScenarioActionType }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="h-4 w-4" aria-hidden>
      {PATHS[type]}
    </svg>
  );
}
