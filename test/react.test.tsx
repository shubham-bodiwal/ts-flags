// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { createFlags, defineFlags } from 'ts-flags';
import { createFlagHooks } from '../src/react';

const flags = defineFlags({
  checkout: { default: false, rules: [{ users: ['vip'], value: true }] },
  theme: { default: 'light', variants: ['light', 'dark'] },
});
const { FlagsProvider, useFlag, useFlagClient } = createFlagHooks(flags);

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

function Probe({ name, renders }: { name: 'checkout' | 'theme'; renders: Record<string, number> }) {
  const value = useFlag(name);
  renders[name] = (renders[name] ?? 0) + 1;
  return <span data-testid={name}>{String(value)}</span>;
}

describe('React binding', () => {
  it('reads flags through the provider', () => {
    render(
      <FlagsProvider context={{ userId: 'vip' }}>
        <Probe name="checkout" renders={{}} />
      </FlagsProvider>,
    );
    expect(screen.getByTestId('checkout').textContent).toBe('true');
  });

  it('re-renders only the components whose flag changed', () => {
    const client = createFlags(flags);
    const renders: Record<string, number> = {};
    render(
      <FlagsProvider client={client}>
        <Probe name="checkout" renders={renders} />
        <Probe name="theme" renders={renders} />
      </FlagsProvider>,
    );
    expect(renders).toEqual({ checkout: 1, theme: 1 });

    act(() => client.setOverrides({ theme: 'dark' }));
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(renders).toEqual({ checkout: 1, theme: 2 });

    act(() => client.setContext({ userId: 'vip' }));
    expect(renders).toEqual({ checkout: 2, theme: 2 });

    act(() => client.setContext({ userId: 'vip', attributes: { x: 1 } }));
    expect(renders).toEqual({ checkout: 2, theme: 2 });
  });

  it('follows context and config props, ignoring identical inline objects', () => {
    const renders: Record<string, number> = {};
    const view = (userId: string, theme: string) => (
      <FlagsProvider context={{ userId }} config={{ theme: { default: theme } }}>
        <Probe name="checkout" renders={renders} />
        <Probe name="theme" renders={renders} />
      </FlagsProvider>
    );
    const { rerender } = render(view('a', 'light'));
    expect(screen.getByTestId('checkout').textContent).toBe('false');
    rerender(view('vip', 'dark'));
    expect(screen.getByTestId('checkout').textContent).toBe('true');
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    const before = { ...renders };
    rerender(view('vip', 'dark'));
    expect(renders.checkout).toBe(before.checkout! + 1); // parent re-render only, no extra store update
  });

  it('applies URL overrides after mount, not during server render', () => {
    window.history.replaceState(null, '', '/?flags=theme:dark');
    const tree = (
      <FlagsProvider overrides>
        <Probe name="theme" renders={{}} />
      </FlagsProvider>
    );
    expect(renderToString(tree)).toContain('light');
    render(tree);
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });

  it('accepts override options', () => {
    render(
      <FlagsProvider overrides={{ search: '?ff=checkout:true', param: 'ff', storage: null }}>
        <Probe name="checkout" renders={{}} />
      </FlagsProvider>,
    );
    expect(screen.getByTestId('checkout').textContent).toBe('true');
  });

  it('exposes the client and throws a clear error outside the provider', () => {
    let seen: unknown;
    function Grab() {
      seen = useFlagClient();
      return null;
    }
    const client = createFlags(flags);
    render(
      <FlagsProvider client={client}>
        <Grab />
      </FlagsProvider>,
    );
    expect(seen).toBe(client);
    expect(() => render(<Probe name="theme" renders={{}} />)).toThrow('inside <FlagsProvider>');
  });
});
