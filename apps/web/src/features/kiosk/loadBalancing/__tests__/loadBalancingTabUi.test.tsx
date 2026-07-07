import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  LOAD_BALANCING_PRODUCTION_SYSTEM_DISCLAIMER,
  LoadBalancingProductionSystemNote
} from '../LoadBalancingProductionSystemNote';
import { LoadBalancingTabLoadingStatus } from '../LoadBalancingTabLoadingStatus';

describe('LoadBalancingProductionSystemNote', () => {
  it('生産システム非一致の注記文言を表示する', () => {
    render(<LoadBalancingProductionSystemNote />);

    expect(screen.getByTestId('load-balancing-production-system-note')).toHaveTextContent(
      LOAD_BALANCING_PRODUCTION_SYSTEM_DISCLAIMER
    );
  });
});

describe('LoadBalancingTabLoadingStatus', () => {
  it('初回ロード中はスケルトンと注記を表示する', () => {
    render(<LoadBalancingTabLoadingStatus isInitialLoad isRefreshing={false} />);

    expect(screen.getByRole('status')).toHaveTextContent('集計を読み込み中…');
    expect(screen.getByText('初回集計には時間がかかる場合があります。')).toBeInTheDocument();
  });

  it('更新中のみ更新メッセージを表示する', () => {
    render(<LoadBalancingTabLoadingStatus isInitialLoad={false} isRefreshing />);

    expect(screen.getByRole('status')).toHaveTextContent('更新中…');
  });
});
