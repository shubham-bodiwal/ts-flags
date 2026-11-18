import { createContext, createElement, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  createFlags,
  readOverrides,
  type Context,
  type FlagClient,
  type FlagName,
  type Flags,
  type OverrideOptions,
  type RemoteConfig,
  type ValueOf,
} from 'ts-flags';

export interface FlagsProviderProps<D extends Flags> {
  /** Bring your own client, or let the provider create one from `context` and `config`. */
  client?: FlagClient<D>;
  context?: Context;
  /** Remote config snapshot, e.g. fetched in a Next.js server component. Plain JSON, so it crosses the RSC boundary. */
  config?: RemoteConfig;
  /** Read `?flags=` and localStorage overrides after mount (never during SSR, so hydration matches). */
  overrides?: boolean | OverrideOptions;
  children?: ReactNode;
}

/**
 * Bind React to one set of flag definitions. Every hook is typed against `defs`,
 * so `useFlag('typo')` is a compile error.
 */
export function createFlagHooks<D extends Flags>(defs: D) {
  const Ctx = createContext<FlagClient<D> | null>(null);

  function FlagsProvider({ client, context, config, overrides, children }: FlagsProviderProps<D>) {
    const [own] = useState(() => client ?? createFlags(defs, { context, config }));
    const c = client ?? own;
    // JSON keys keep inline object props from re-applying on every render.
    const ctxKey = JSON.stringify(context ?? null);
    const configKey = JSON.stringify(config ?? null);
    const overridesKey = JSON.stringify(overrides ?? false);
    // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by JSON so inline objects don't re-apply
    useEffect(() => {
      if (context) c.setContext(context);
    }, [c, ctxKey]);
    // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by JSON so inline objects don't re-apply
    useEffect(() => {
      if (config) c.apply(config);
    }, [c, configKey]);
    // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by JSON so inline objects don't re-apply
    useEffect(() => {
      if (overrides) c.setOverrides(readOverrides(overrides === true ? {} : overrides));
    }, [c, overridesKey]);
    return createElement(Ctx.Provider, { value: c }, children);
  }

  function useFlagClient(): FlagClient<D> {
    const c = useContext(Ctx);
    if (!c) throw new Error('ts-flags: useFlag must be used inside <FlagsProvider>');
    return c;
  }

  /** Re-renders only when this flag's value changes. */
  function useFlag<K extends FlagName<D>>(name: K): ValueOf<D[K]> {
    const c = useFlagClient();
    const read = () => c.get(name);
    return useSyncExternalStore(c.subscribe, read, read);
  }

  return { FlagsProvider, useFlag, useFlagClient };
}
