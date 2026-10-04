import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HermesPageContextProvider, useHermesPageContext } from './HermesPageContext';

function Consumer() {
  const { pageContext, setPageContext, clearPageContext } = useHermesPageContext();
  return <>
    <output data-testid="context">{JSON.stringify(pageContext)}</output>
    <button onClick={() => setPageContext({ path: '/page', entity: { kind: 'partNumber', value: 'P' } })}>set</button>
    <button onClick={clearPageContext}>clear</button>
  </>;
}

describe('HermesPageContext', () => {
  it('shares and clears the current context', () => {
    render(<HermesPageContextProvider><Consumer /></HermesPageContextProvider>);
    expect(screen.getByTestId('context')).toHaveTextContent('null');
    fireEvent.click(screen.getByText('set'));
    expect(JSON.parse(screen.getByTestId('context').textContent ?? '')).toEqual({ path: '/page', entity: { kind: 'partNumber', value: 'P' } });
    fireEvent.click(screen.getByText('clear'));
    expect(screen.getByTestId('context')).toHaveTextContent('null');
  });

  it('leaves standalone consumers without a page context', () => {
    render(<Consumer />);
    fireEvent.click(screen.getByText('set'));
    expect(screen.getByTestId('context')).toHaveTextContent('null');
  });
});
