import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

import { HermesA2uiPreview } from './components/hermes/HermesA2uiPreview';

import './components/hermes/hermes-floating-chat.css';

import type { BusinessHermesSignageProposal } from './api/domains/assembly';

const PAYLOAD_KEY = '__business_hermes_a2ui_print__';

function PrintSurface() {
  const proposal = useMemo(() => {
    try {
      const raw = window.localStorage.getItem(PAYLOAD_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { a2ui?: BusinessHermesSignageProposal['a2ui'] };
      return parsed.a2ui ?? null;
    } catch {
      return null;
    }
  }, []);

  if (!proposal) return <p>プレビューを読み込めません。</p>;
  return <HermesA2uiPreview proposal={proposal} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <PrintSurface />
    </main>
  </StrictMode>,
);
