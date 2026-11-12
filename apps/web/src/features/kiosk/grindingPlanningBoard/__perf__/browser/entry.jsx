import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProductionScheduleGrindingPlanningBoardPage } from '../../../../../pages/kiosk/ProductionScheduleGrindingPlanningBoardPage';
import '../../../../../index.css';

// Existing fixture cutting resources (75 bars each); enable only for the extra sequence.
window.perfHarness.twoResources = ['310', '311'];
localStorage.clear();
localStorage.setItem('kiosk-planning-board-arrival-filter', JSON.stringify({ schemaVersion: 1, enabled: false }));
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={client}><ProductionScheduleGrindingPlanningBoardPage /></QueryClientProvider>
);
