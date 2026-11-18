# ts-flags

Tiny, type-safe feature flags for TypeScript and React.

- **~2 kB gzipped** for the core and React binding together, zero runtime dependencies (`pnpm size` enforces a 3 kB budget)
- **Typed from one definition.** Flag names, value types and string variants are inferred, so `useFlag('newChekout')` is a compile error
- **Rules:** user ids, attributes, percentage rollouts with stable hashing, date windows
- **Dev overrides** from `?flags=` or `localStorage`
- **SSR-safe** for Next.js: deterministic evaluation, overrides applied only after hydration
- **Remote JSON config** through a small adapter, with a TTL cache and stale-on-error

## Why

Most apps start with `if (process.env.NEXT_PUBLIC_NEW_CHECKOUT === 'true')` and end up with stringly-typed flags spread across the codebase. Hosted platforms solve this well, but they bring a service, an SDK and a bill. `ts-flags` sits in between: flags live in your repo as typed data, rules run locally, and a JSON file or endpoint can change them without a deploy.

## 30-second example

```bash
npm install ts-flags
```

```ts
// flags.ts
import { defineFlags } from 'ts-flags';
import { createFlagHooks } from 'ts-flags/react';

export const flags = defineFlags({
  newCheckout: {
    default: false,
    rules: [
      { users: ['qa-1'], value: true },              // named testers
      { attributes: { plan: ['pro', 'team'] }, value: true },
      { percentage: 20, value: true },                // 20% of everyone else
    ],
  },
  theme: { default: 'light', variants: ['light', 'dark', 'auto'] },
  pageSize: { default: 20, rules: [{ attributes: { country: 'IN' }, value: 50 }] },
  holidayBanner: { default: false, rules: [{ from: '2026-12-20', until: '2027-01-02', value: true }] },
});

export const { FlagsProvider, useFlag } = createFlagHooks(flags);
```

```tsx
// app
<FlagsProvider context={{ userId: user.id, attributes: { plan: user.plan } }} overrides>
  <Checkout />
</FlagsProvider>;

function Checkout() {
  const enabled = useFlag('newCheckout'); // boolean
  const theme = useFlag('theme');         // 'light' | 'dark' | 'auto'
  return enabled ? <NewCheckout theme={theme} /> : <OldCheckout />;
}
```

Try a flag locally: `/checkout?flags=newCheckout:true,theme:dark`, or `localStorage.flags = '{"newCheckout":true}'`.

## API

### `defineFlags(defs)`

Returns `defs` unchanged and infers types. Each flag:

| Field | Type | Notes |
| --- | --- | --- |
| `default` | `boolean \| number \| string` | Fixes the flag's type |
| `variants` | `readonly T[]` | Narrows the type to a union; overrides and remote values outside it are rejected |
| `rules` | `Rule[]` | Checked in order; the first match wins |
| `salt` | `string` | Flags with the same salt bucket users identically (defaults to the flag name) |

A **rule** has a `value` plus any of these conditions, all of which must match:

| Condition | Matches when |
| --- | --- |
| `users: string[]` | `context.userId` is in the list |
| `attributes: { key: v \| v[] }` | each attribute equals `v` (or is one of `v[]`) |
| `percentage: 0–100` | the user's stable bucket is below it (needs `userId`) |
| `from`, `until` | `from <= now < until` (ISO string, epoch ms or `Date`) |

### `createFlags(defs, { context?, overrides?, config? })`

Returns a client: `get(name)`, `all()`, `context`, `setContext(ctx)`, `setOverrides(raw)`, `apply(remoteConfig)`, `subscribe(fn)`.

Precedence: **override > first matching rule > default**. Remote config replaces a flag's `rules` and/or `default` wholesale.

### `readOverrides({ search?, storage?, param = 'flags', key = 'flags' })`

Reads `localStorage[key]` as JSON, then `?param=name:value,...` on top. Returns `{}` on the server. Override strings are coerced to the flag's type; invalid values are ignored.

### `jsonSource(url, { ttl = 60000, fetch?, init?, storage?, key? })`

A `FlagSource` (`{ load(): Promise<RemoteConfig> }`) that fetches JSON like:

```json
{ "newCheckout": { "rules": [{ "percentage": 50, "value": true }] }, "pageSize": { "default": 30 } }
```

Responses are cached for `ttl` ms, concurrent loads share one request, a failed refresh returns the last good config, and `storage` (e.g. `localStorage`) persists it across reloads. Use it with `client.apply(await source.load())`. Any object with a `load()` method works as a source.

### `ts-flags/react`: `createFlagHooks(defs)`

Returns `{ FlagsProvider, useFlag, useFlagClient }`, all typed against `defs`.

`<FlagsProvider>` props: `client?` (bring your own), `context?`, `config?` (a remote config snapshot), `overrides?` (`true` or `readOverrides` options). `useFlag(name)` uses `useSyncExternalStore`, so a component re-renders only when **its** flag's value changes.

### Next.js (App Router)

The React entry ships with `'use client'`. Fetch config on the server and pass plain JSON down:

```tsx
// app/layout.tsx (server component)
import { createFlags, jsonSource } from 'ts-flags';
import { flags, FlagsProvider } from './flags';

const source = jsonSource('https://example.com/flags.json', { ttl: 30_000 });

export default async function Layout({ children }: { children: React.ReactNode }) {
  const config = await source.load();
  const context = { userId: (await getSession())?.userId };
  // Server-only reads work too: createFlags(flags, { context, config }).get('newCheckout')
  return <FlagsProvider context={context} config={config} overrides>{children}</FlagsProvider>;
}
```

Server and client evaluate the same rules on the same inputs, so hydration matches. Dev overrides apply after mount. For date windows that are exactly on a boundary during a request, pass the same `context.now` to both sides.

## Design decisions

- **Definitions are plain data.** No classes or callbacks, so the same object can be serialised, sent from a server component, or replaced by remote JSON.
- **Types come from the definition, not codegen.** `defineFlags` uses a `const` type parameter to infer variants, then checks every rule value and default against the flag's type.
- **Stable bucketing.** FNV-1a with a murmur3 finaliser over `salt:userId`, mapped to 0–99.99. A user's bucket never changes, so raising a rollout from 10% to 30% only adds users. Users with no `userId` are never in a percentage rollout, which keeps server and client output identical.
- **Remote config is untrusted input.** Unknown flags, values of the wrong type, values outside `variants` and malformed rules are dropped, not thrown.
- **No network inside the client.** Fetching, polling and caching stay in the source, so the core is synchronous and easy to test.
- **Out of scope:** analytics, experiment statistics, a dashboard, streaming updates. Use a platform below when you need those.

## Comparison

| | ts-flags | LaunchDarkly | Unleash | GrowthBook | OpenFeature |
| --- | --- | --- | --- | --- | --- |
| What it is | Library | Hosted platform | Open-source platform | Open-source platform | Vendor-neutral API standard |
| Needs a service | No (optional JSON file/endpoint) | Yes (hosted) | Yes (self-hosted or hosted) | Optional (self-hosted or cloud) | Depends on the provider |
| Management UI | No | Yes | Yes | Yes | Provider's |
| Targeting + % rollouts | Yes | Yes | Yes | Yes | Provider's |
| Experiment analysis | No | Yes | Variants; analysis via external tools | Yes (built-in stats) | Provider's |
| Many server languages | No (TS/JS) | Yes | Yes | Yes | Yes |
| Good fit | Small/medium apps, flags in the repo | Large teams, governance, audit | Self-hosted control | Product experimentation | Avoiding vendor lock-in |

These tools do far more than `ts-flags`. Pick one of them when you need a dashboard for non-engineers, audit trails or experiment statistics.

## Development

```bash
pnpm install
pnpm check   # typecheck (incl. type tests) + tests with 95% coverage gate + build + size budget
```

## License

[MIT](./LICENSE) © Shubham Bhodiwal
